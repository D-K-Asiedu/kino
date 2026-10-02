import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import ffmpeg from 'fluent-ffmpeg'
import ffprobeStatic from 'ffprobe-static'
import { EncoderProfile, LIBPLACEBO_TONEMAP, ZSCALE_TONEMAP } from './encoders'

// Probing and ffmpeg arguments shared by the progressive stream (streaming.ts) and HLS (hls.ts).

// Chromium (and therefore Electron) can only decode a limited set of codecs. HEVC/H.265 has no
// decoder in Electron's Chromium build on Linux, and AC3/E-AC3/DTS audio is not supported anywhere.
// Files outside this set are converted on the fly with ffmpeg.
const SUPPORTED_VIDEO_CODECS = new Set(['h264', 'vp8', 'vp9', 'av1'])
// 10-bit H.264 (Hi10P) is not decodable by Chromium; VP9/AV1 10-bit are.
const SUPPORTED_H264_PIX_FMTS = new Set(['yuv420p', 'yuvj420p'])
const SUPPORTED_AUDIO_CODECS = new Set(['aac', 'mp3', 'opus', 'vorbis', 'flac'])
const DIRECT_CONTAINERS = new Set(['.mp4', '.m4v', '.mov', '.webm', '.mkv'])
const HDR_TRANSFERS = new Set(['smpte2084', 'arib-std-b67'])

// Software encoding can't keep 4K in real time, so CPU-encoded streams are capped at 1080p.
const SOFTWARE_MAX_HEIGHT = 1080

const ffprobePath = ffprobeStatic.path.replace('app.asar', 'app.asar.unpacked')

// Printed when the GPU can't decode a codec and ffmpeg falls back to software decoding; not a failure.
export const HWACCEL_FALLBACK_MESSAGES = /No support for codec|Failed setup for format vaapi|hwaccel initialisation returned error/

export type PlaybackMode = 'direct' | 'transcode'

export interface PlaybackInfo {
    mode: PlaybackMode
    /** Seconds, from the container. 0 when unknown. */
    duration: number
    /** Whether the video stream can be copied as-is when transcoding (only the audio needs converting). */
    copyVideo: boolean
    /**
     * Whether the conversion is served as HLS (seekable, with converted segments kept for the session).
     * Copied video can only be cut at the source's keyframes, so it uses the progressive stream instead.
     */
    hls: boolean
    reason: string | null
}

export interface MediaDetails {
    info: PlaybackInfo
    /** Container start time in seconds; packet timestamps are offset by this. */
    startTime: number
    isHdr: boolean
    height: number
}

interface ProbeCacheEntry {
    mtimeMs: number
    details: MediaDetails
}

const probeCache = new Map<string, ProbeCacheEntry>()

function ffprobe(filePath: string): Promise<ffmpeg.FfprobeData> {
    return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(filePath, (err, data) => (err ? reject(err) : resolve(data)))
    })
}

function isVideoStreamSupported(stream: ffmpeg.FfprobeStream | undefined) {
    if (!stream?.codec_name) return false
    if (!SUPPORTED_VIDEO_CODECS.has(stream.codec_name)) return false
    if (stream.codec_name === 'h264' && stream.pix_fmt && !SUPPORTED_H264_PIX_FMTS.has(stream.pix_fmt)) return false
    return true
}

export async function getMediaDetails(filePath: string): Promise<MediaDetails> {
    const stats = await fs.promises.stat(filePath)
    const cached = probeCache.get(filePath)
    if (cached && cached.mtimeMs === stats.mtimeMs) return cached.details

    const data = await ffprobe(filePath)
    // Ignore embedded cover art, which ffprobe reports as a video stream.
    const video = data.streams.find(s => s.codec_type === 'video' && s.disposition?.attached_pic !== 1)
    const audio = data.streams.find(s => s.codec_type === 'audio')
    const duration = Number(data.format?.duration) || 0

    const videoOk = isVideoStreamSupported(video)
    const audioOk = !audio || SUPPORTED_AUDIO_CODECS.has(audio.codec_name ?? '')
    const containerOk = DIRECT_CONTAINERS.has(path.extname(filePath).toLowerCase())

    let info: PlaybackInfo
    if (videoOk && audioOk && containerOk) {
        info = { mode: 'direct', duration, copyVideo: true, hls: false, reason: null }
    } else {
        const problems = [
            !videoOk && `video codec ${video?.codec_name ?? 'unknown'}${video?.pix_fmt ? ` (${video.pix_fmt})` : ''}`,
            !audioOk && `audio codec ${audio?.codec_name}`,
            !containerOk && `container ${path.extname(filePath)}`,
        ].filter(Boolean)
        // The HLS playlist is laid out from the duration, so it's needed up front.
        const hls = !videoOk && duration > 0
        info = { mode: 'transcode', duration, copyVideo: videoOk, hls, reason: `Unsupported ${problems.join(', ')}` }
    }

    const details: MediaDetails = {
        info,
        startTime: Number(data.format?.start_time) || 0,
        isHdr: HDR_TRANSFERS.has(String(video?.color_transfer ?? '')),
        height: Number(video?.height) || 0,
    }
    probeCache.set(filePath, { mtimeMs: stats.mtimeMs, details })
    return details
}

export async function getPlaybackInfo(filePath: string): Promise<PlaybackInfo> {
    return (await getMediaDetails(filePath)).info
}

/** Timestamp (absolute, seconds) of the last video keyframe at or before `target`, or null. */
function findKeyframeBefore(filePath: string, target: number): Promise<number | null> {
    return new Promise((resolve) => {
        // Packet flags are enough to spot keyframes, so nothing needs decoding.
        const proc = spawn(ffprobePath, [
            '-v', 'error', '-select_streams', 'v:0',
            '-show_entries', 'packet=pts_time,flags', '-of', 'csv=p=0',
            '-read_intervals', `${Math.max(0, target - 30)}%${target + 0.1}`,
            filePath,
        ], { stdio: ['ignore', 'pipe', 'ignore'] })
        let output = ''
        proc.stdout.on('data', (chunk) => { output += chunk })
        proc.on('error', () => resolve(null))
        proc.on('close', () => {
            let best: number | null = null
            for (const line of output.split('\n')) {
                const [pts, flags] = line.split(',')
                const time = Number(pts)
                if (!flags?.startsWith('K') || !Number.isFinite(time) || time > target + 0.001) continue
                if (best === null || time > best) best = time
            }
            resolve(best)
        })
    })
}

/**
 * Where a progressive stream requested at `start` really begins. Copied video can only start on a
 * keyframe, and ffmpeg starts the stream there, so the player must use this as its time offset.
 */
export async function resolveStreamStart(filePath: string, start: number): Promise<number> {
    const requested = Math.max(0, start)
    const { info, startTime } = await getMediaDetails(filePath)
    if (info.mode !== 'transcode' || !info.copyVideo || requested === 0) return requested
    const keyframe = await findKeyframeBefore(filePath, startTime + requested)
    return keyframe === null ? requested : Math.max(0, keyframe - startTime)
}

// Remember which encoder worked per file, so later streams skip setups already known to fail on it.
const workingProfileByFile = new Map<string, EncoderProfile>()

export function profilesForFile(filePath: string, profiles: EncoderProfile[]) {
    const known = workingProfileByFile.get(filePath)
    return known && profiles.includes(known) ? profiles.slice(profiles.indexOf(known)) : profiles
}

export function rememberWorkingProfile(filePath: string, profile: EncoderProfile) {
    workingProfileByFile.set(filePath, profile)
}

interface VideoArgOptions {
    /** Force a keyframe every this many seconds (and nowhere else), so HLS segments cut exactly there. */
    segmentSeconds?: number
}

/** Video arguments for re-encoding: `input` goes before `-i`, `output` after the stream maps. */
export function buildVideoArgs(profile: EncoderProfile, media: MediaDetails, options: VideoArgOptions = {}): { input: string[], output: string[] } {
    const hardware = profile.encoder !== 'libx264'
    const scaleHeight = !hardware && media.height > SOFTWARE_MAX_HEIGHT ? SOFTWARE_MAX_HEIGHT : null
    const pixFmt = hardware ? 'nv12' : 'yuv420p'

    const filters: string[] = []
    if (media.isHdr && profile.toneMapper === 'libplacebo') {
        filters.push(`libplacebo=${scaleHeight ? `w=-2:h=${scaleHeight}:` : ''}${LIBPLACEBO_TONEMAP}:format=${pixFmt}`)
    } else if (media.isHdr && profile.toneMapper === 'zscale') {
        if (scaleHeight) filters.push(`zscale=w=-2:h=${scaleHeight}`)
        filters.push(...ZSCALE_TONEMAP, `format=${pixFmt}`)
    } else {
        if (scaleHeight) filters.push(`scale=-2:${scaleHeight}`)
        filters.push(`format=${pixFmt}`)
    }
    if (hardware) filters.push('hwupload')

    const input = hardware
        // Decode on the GPU where the driver supports the codec; ffmpeg falls back to software otherwise.
        // Decoded frames come back to system memory so the same filters work either way.
        ? ['-init_hw_device', `vaapi=va:${profile.vaapiDevice}`, '-filter_hw_device', 'va', '-hwaccel', 'vaapi', '-hwaccel_device', 'va']
        : []

    const encoder = {
        libx264: ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21'],
        h264_vaapi: ['-c:v', 'h264_vaapi', '-qp', '21'],
        vp9_vaapi: ['-c:v', 'vp9_vaapi', '-global_quality', '80'],
    }[profile.encoder]

    const keyframes = options.segmentSeconds
        ? [
            '-force_key_frames', `expr:gte(t,n_forced*${options.segmentSeconds})`, '-g', '720',
            ...(profile.encoder === 'libx264' ? ['-sc_threshold', '0'] : []),
        ]
        // Short GOPs keep fragments small, so the first frame arrives quickly.
        : ['-g', '48']

    return { input, output: ['-vf', filters.join(','), ...encoder, ...keyframes] }
}

export const AUDIO_ARGS = ['-c:a', 'aac', '-ac', '2', '-b:a', '192k']

import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import ffmpeg from 'fluent-ffmpeg'
import ffprobeStatic from 'ffprobe-static'
import { EncoderProfile, LIBPLACEBO_TONEMAP, ZSCALE_TONEMAP } from './encoders'

// Probing and ffmpeg arguments shared by the progressive stream (streaming.ts) and HLS (hls.ts).

// Chromium (and therefore Electron) can only decode a limited set of codecs. The baseline below is
// decodable everywhere. What else works depends on the platform and GPU (HEVC on macOS and many
// Windows machines, never on Linux), so the player reports it at startup (setDecoderSupport). Files
// outside the supported set are converted on the fly with ffmpeg.
const BASELINE_VIDEO_CODECS = new Set(['vp8', 'vp9', 'av1'])
const PIX_FMTS_8BIT = new Set(['yuv420p', 'yuvj420p'])
const PIX_FMTS_10BIT = new Set(['yuv420p10le'])
const BASELINE_AUDIO_CODECS = new Set(['aac', 'mp3', 'opus', 'vorbis', 'flac'])
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
    videoCodec: string | null
    /** Reordered frames; ffmpeg adjusts -ss for these (see streaming.ts buildArgs). */
    videoHasBFrames: boolean
}

/** Codecs beyond the baseline that the player can decode on this machine (see src/lib/decoderSupport.ts). */
export interface DecoderSupport {
    hevc: boolean
    hevc10: boolean
    h264_10bit: boolean
    ac3: boolean
    eac3: boolean
    dts: boolean
}

const DECODER_SUPPORT_KEYS: (keyof DecoderSupport)[] = ['hevc', 'hevc10', 'h264_10bit', 'ac3', 'eac3', 'dts']
const OPTIONAL_AUDIO_CODECS: Record<string, keyof DecoderSupport> = { ac3: 'ac3', eac3: 'eac3', dts: 'dts' }

// Until the player reports in, only the baseline counts as supported.
let decoderSupport: Partial<DecoderSupport> = {}

export function setDecoderSupport(support: unknown) {
    const reported = (support ?? {}) as Record<string, unknown>
    decoderSupport = Object.fromEntries(DECODER_SUPPORT_KEYS.map(key => [key, reported[key] === true]))
    console.log('[media] decoder support:', DECODER_SUPPORT_KEYS.filter(key => decoderSupport[key]).join(', ') || 'baseline only')
}

interface ProbeCacheEntry {
    mtimeMs: number
    data: ffmpeg.FfprobeData
}

// Raw ffprobe output; the playback decision is made per call, since decoder support and failures change.
const probeCache = new Map<string, ProbeCacheEntry>()

// How far each file has fallen back this session after playback failed in the player (see forceConversion).
const playbackFailures = new Map<string, number>()

function ffprobe(filePath: string): Promise<ffmpeg.FfprobeData> {
    return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(filePath, (err, data) => (err ? reject(err) : resolve(data)))
    })
}

function isVideoStreamSupported(stream: ffmpeg.FfprobeStream | undefined) {
    if (!stream?.codec_name) return false
    if (BASELINE_VIDEO_CODECS.has(stream.codec_name)) return true
    const pixFmt = stream.pix_fmt ?? ''
    if (stream.codec_name === 'h264') {
        return !pixFmt || PIX_FMTS_8BIT.has(pixFmt) || (!!decoderSupport.h264_10bit && PIX_FMTS_10BIT.has(pixFmt))
    }
    if (stream.codec_name === 'hevc') {
        return (!!decoderSupport.hevc && PIX_FMTS_8BIT.has(pixFmt)) || (!!decoderSupport.hevc10 && PIX_FMTS_10BIT.has(pixFmt))
    }
    return false
}

function isAudioCodecSupported(codec: string) {
    if (BASELINE_AUDIO_CODECS.has(codec)) return true
    const key = OPTIONAL_AUDIO_CODECS[codec]
    return !!key && !!decoderSupport[key]
}

// Playback options from cheapest to most work. A failure moves a file one step down.
const Level = { Direct: 0, CopyVideo: 1, Reencode: 2 } as const

function decidePlayback(filePath: string, data: ffmpeg.FfprobeData): { info: PlaybackInfo, video: ffmpeg.FfprobeStream | undefined } {
    // Ignore embedded cover art, which ffprobe reports as a video stream.
    const video = data.streams.find(s => s.codec_type === 'video' && s.disposition?.attached_pic !== 1)
    const audio = data.streams.find(s => s.codec_type === 'audio')
    const duration = Number(data.format?.duration) || 0

    const videoOk = isVideoStreamSupported(video)
    const audioOk = !audio || isAudioCodecSupported(audio.codec_name ?? '')
    const containerOk = DIRECT_CONTAINERS.has(path.extname(filePath).toLowerCase())

    const natural = videoOk && audioOk && containerOk ? Level.Direct : videoOk ? Level.CopyVideo : Level.Reencode
    const level = Math.min(Level.Reencode, natural + (playbackFailures.get(filePath) ?? 0))

    if (level === Level.Direct) return { info: { mode: 'direct', duration, copyVideo: true, hls: false, reason: null }, video }

    const problems = [
        !videoOk && `video codec ${video?.codec_name ?? 'unknown'}${video?.pix_fmt ? ` (${video.pix_fmt})` : ''}`,
        !audioOk && `audio codec ${audio?.codec_name}`,
        !containerOk && `container ${path.extname(filePath)}`,
    ].filter(Boolean)
    const reason = level > natural
        ? `${natural === Level.Direct ? 'Direct playback' : 'Copying the video'} failed in the player`
        : `Unsupported ${problems.join(', ')}`
    // Copied video can only be cut at keyframes, so only re-encoded video uses HLS. Its playlist is
    // laid out from the duration, so that's needed up front.
    const copyVideo = level === Level.CopyVideo
    return { info: { mode: 'transcode', duration, copyVideo, hls: !copyVideo && duration > 0, reason }, video }
}

export async function getMediaDetails(filePath: string): Promise<MediaDetails> {
    const stats = await fs.promises.stat(filePath)
    let cached = probeCache.get(filePath)
    if (!cached || cached.mtimeMs !== stats.mtimeMs) {
        cached = { mtimeMs: stats.mtimeMs, data: await ffprobe(filePath) }
        probeCache.set(filePath, cached)
    }

    const { info, video } = decidePlayback(filePath, cached.data)
    return {
        info,
        startTime: Number(cached.data.format?.start_time) || 0,
        isHdr: HDR_TRANSFERS.has(String(video?.color_transfer ?? '')),
        height: Number(video?.height) || 0,
        videoCodec: video?.codec_name ?? null,
        videoHasBFrames: Number(video?.has_b_frames) > 0,
    }
}

/**
 * The player couldn't play the file the way getMediaDetails chose: fall back one step (direct ->
 * copy the video -> re-encode) for the rest of the session. Returns the new playback info, or null
 * when the file is already fully re-encoded and there is nothing left to try.
 */
export async function forceConversion(filePath: string): Promise<PlaybackInfo | null> {
    const { info } = await getMediaDetails(filePath)
    if (info.mode === 'transcode' && !info.copyVideo) return null
    playbackFailures.set(filePath, (playbackFailures.get(filePath) ?? 0) + 1)
    const next = (await getMediaDetails(filePath)).info
    console.warn(`[media] ${info.mode === 'direct' ? 'direct playback' : 'copied video'} failed, falling back to ${next.copyVideo ? 'copying the video' : 're-encoding'}: ${filePath}`)
    return next
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
            // Segments from different runs end up side by side in the player (seeking back, and on
            // Windows every restart). B-frames shift timestamps differently per run, which leaves
            // holes where they meet, so HLS output has none.
            ...(profile.encoder === 'vp9_vaapi' ? [] : ['-bf', '0']),
        ]
        // Short GOPs keep fragments small, so the first frame arrives quickly.
        : ['-g', '48']

    return { input, output: ['-vf', filters.join(','), ...encoder, ...keyframes] }
}

export const AUDIO_ARGS = ['-c:a', 'aac', '-ac', '2', '-b:a', '192k']

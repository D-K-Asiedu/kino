import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import ffmpeg from 'fluent-ffmpeg'
import ffprobeStatic from 'ffprobe-static'
import { EncoderProfile, LIBPLACEBO_TONEMAP, ZSCALE_TONEMAP, encoderArgs, encoderDeviceArgs, encoderPixelFormat, isHardwareEncoder } from './encoders'

// Probing and ffmpeg arguments shared by the progressive stream (streaming.ts) and HLS (hls.ts).

// Chromium (and therefore Electron) can only decode a limited set of codecs. The baseline below is
// decodable everywhere. What else works depends on the platform and GPU (HEVC on macOS and many
// Windows machines, never on Linux), so the player reports it at startup (setDecoderSupport). Files
// outside the supported set are converted on the fly with ffmpeg.
const BASELINE_VIDEO_CODECS = new Set(['vp8', 'vp9', 'av1'])
const PIX_FMTS_8BIT = new Set(['yuv420p', 'yuvj420p'])
const PIX_FMTS_10BIT = new Set(['yuv420p10le'])
// Any 10-bit (or deeper) layout, for deciding whether a conversion should keep 10 bits.
const HIGH_BIT_DEPTH_PIX_FMT = /p1[0-6](le|be)$/
const BASELINE_AUDIO_CODECS = new Set(['aac', 'mp3', 'opus', 'vorbis', 'flac'])
const DIRECT_CONTAINERS = new Set(['.mp4', '.m4v', '.mov', '.webm', '.mkv'])
const HDR_TRANSFERS = new Set(['smpte2084', 'arib-std-b67'])
// ffprobe's field_order for interlaced video (top/bottom field first, coded or displayed).
const INTERLACED_FIELD_ORDERS = new Set(['tt', 'bb', 'tb', 'bt'])

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
    /** Source video has more than 8 bits per channel. */
    isHighBitDepth: boolean
    height: number
    videoCodec: string | null
    /** ffprobe index of the video stream that plays (cover art is skipped); null when there is none. */
    videoStreamIndex: number | null
    /** Source is interlaced (DVD, broadcast TV) and is deinterlaced when re-encoded. */
    interlaced: boolean
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
    size: number
    data: Promise<ffmpeg.FfprobeData>
}

// Raw ffprobe output, shared by everything that needs to know about a file (playback decision, track
// lists, subtitles), so opening a video runs ffprobe once. The playback decision is made per call,
// since decoder support and failures change. Oldest entries are dropped past the limit.
const PROBE_CACHE_LIMIT = 200
const probeCache = new Map<string, ProbeCacheEntry>()

// How far each file has fallen back this session after playback failed in the player (see forceConversion).
const playbackFailures = new Map<string, number>()

function ffprobe(filePath: string): Promise<ffmpeg.FfprobeData> {
    return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(filePath, (err, data) => (err ? reject(err) : resolve(data)))
    })
}

/** ffprobe output for a file; cached until the file changes. */
export async function probeMedia(filePath: string): Promise<ffmpeg.FfprobeData> {
    const stats = await fs.promises.stat(filePath)
    let cached = probeCache.get(filePath)
    if (cached && cached.mtimeMs === stats.mtimeMs && cached.size === stats.size) {
        // Move to the end, so the least recently used entry is the first key.
        probeCache.delete(filePath)
        probeCache.set(filePath, cached)
        return cached.data
    }
    const entry: ProbeCacheEntry = { mtimeMs: stats.mtimeMs, size: stats.size, data: ffprobe(filePath) }
    cached = entry
    probeCache.set(filePath, entry)
    // A failed probe isn't kept; the next call tries again.
    entry.data.catch(() => {
        if (probeCache.get(filePath) === entry) probeCache.delete(filePath)
    })
    while (probeCache.size > PROBE_CACHE_LIMIT) probeCache.delete(probeCache.keys().next().value as string)
    return entry.data
}

/** The stream that plays as the picture: embedded cover art, which ffprobe reports as video, is skipped. */
function findVideoStream(data: ffmpeg.FfprobeData) {
    return data.streams.find(s => s.codec_type === 'video' && s.disposition?.attached_pic !== 1)
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

/** Whether the player can decode this audio codec itself; other codecs are converted to AAC. */
export function isAudioCodecSupported(codec: string) {
    if (BASELINE_AUDIO_CODECS.has(codec)) return true
    const key = OPTIONAL_AUDIO_CODECS[codec]
    return !!key && !!decoderSupport[key]
}

// Playback options from cheapest to most work. A failure moves a file one step down.
const Level = { Direct: 0, CopyVideo: 1, Reencode: 2 } as const

function decidePlayback(filePath: string, data: ffmpeg.FfprobeData): { info: PlaybackInfo, video: ffmpeg.FfprobeStream | undefined } {
    const video = findVideoStream(data)
    const audio = data.streams.find(s => s.codec_type === 'audio')
    const duration = Number(data.format?.duration) || 0

    // Chromium doesn't deinterlace, so interlaced video is re-encoded (and deinterlaced) even when
    // its codec would play directly.
    const interlaced = INTERLACED_FIELD_ORDERS.has(String(video?.field_order ?? ''))
    const videoOk = isVideoStreamSupported(video) && !interlaced
    const audioOk = !audio || isAudioCodecSupported(audio.codec_name ?? '')
    const containerOk = DIRECT_CONTAINERS.has(path.extname(filePath).toLowerCase())

    const natural = videoOk && audioOk && containerOk ? Level.Direct : videoOk ? Level.CopyVideo : Level.Reencode
    const level = Math.min(Level.Reencode, natural + (playbackFailures.get(filePath) ?? 0))

    if (level === Level.Direct) return { info: { mode: 'direct', duration, copyVideo: true, hls: false, reason: null }, video }

    const problems = [
        !videoOk && (interlaced
            ? 'interlaced video'
            : `video codec ${video?.codec_name ?? 'unknown'}${video?.pix_fmt ? ` (${video.pix_fmt})` : ''}`),
        !audioOk && `audio codec ${audio?.codec_name}`,
        !containerOk && `container ${path.extname(filePath)}`,
    ].filter(Boolean)
    const reason = level > natural
        ? `${natural === Level.Direct ? 'Direct playback' : 'Copying the video'} failed in the player`
        : `Needs converting: ${problems.join(', ')}`
    // Copied video can only be cut at keyframes, so only re-encoded video uses HLS. Its playlist is
    // laid out from the duration, so that's needed up front.
    const copyVideo = level === Level.CopyVideo
    return { info: { mode: 'transcode', duration, copyVideo, hls: !copyVideo && duration > 0, reason }, video }
}

export async function getMediaDetails(filePath: string): Promise<MediaDetails> {
    const data = await probeMedia(filePath)
    const { info, video } = decidePlayback(filePath, data)
    return {
        info,
        startTime: Number(data.format?.start_time) || 0,
        isHdr: HDR_TRANSFERS.has(String(video?.color_transfer ?? '')),
        isHighBitDepth: HIGH_BIT_DEPTH_PIX_FMT.test(String(video?.pix_fmt ?? '')),
        height: Number(video?.height) || 0,
        videoCodec: video?.codec_name ?? null,
        videoStreamIndex: video ? video.index : null,
        interlaced: INTERLACED_FIELD_ORDERS.has(String(video?.field_order ?? '')),
        videoHasBFrames: Number(video?.has_b_frames) > 0,
    }
}

/** `-map` arguments for the picture and one audio track (the first when `audioStreamIndex` is null). */
export function streamMapArgs(media: MediaDetails, audioStreamIndex: number | null) {
    return [
        '-map', media.videoStreamIndex !== null ? `0:${media.videoStreamIndex}` : '0:v:0',
        '-map', audioStreamIndex !== null ? `0:${audioStreamIndex}` : '0:a:0?',
    ]
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

// Keyframes already looked up, per file, so seeking around the same place again costs nothing.
const KEYFRAME_CACHE_FILES = 4
const keyframeCache = new Map<string, Map<number, number | null>>()

/** Timestamp (absolute, seconds) of the last video keyframe at or before `target`, or null. */
function findKeyframeBefore(filePath: string, streamIndex: number | null, target: number): Promise<number | null> {
    return new Promise((resolve) => {
        // Packet flags are enough to spot keyframes, so nothing needs decoding.
        const proc = spawn(ffprobePath, [
            '-v', 'error', '-select_streams', streamIndex !== null ? String(streamIndex) : 'v:0',
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
    const { info, startTime, videoStreamIndex } = await getMediaDetails(filePath)
    // Applies whenever the video is copied, including a directly playable file that is being
    // converted for the sake of an audio track the player can't decode.
    if (!info.copyVideo || requested === 0) return requested

    let known = keyframeCache.get(filePath)
    if (!known) {
        known = new Map()
        keyframeCache.set(filePath, known)
        while (keyframeCache.size > KEYFRAME_CACHE_FILES) keyframeCache.delete(keyframeCache.keys().next().value as string)
    }
    const key = Math.round(requested * 1000)
    let keyframe = known.get(key)
    if (keyframe === undefined) {
        keyframe = await findKeyframeBefore(filePath, videoStreamIndex, startTime + requested)
        known.set(key, keyframe)
    }
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
    const scaleHeight = !isHardwareEncoder(profile.encoder) && media.height > SOFTWARE_MAX_HEIGHT ? SOFTWARE_MAX_HEIGHT : null
    // 10-bit sources lose shades in conversion to 8-bit, which shows as banding in dark scenes, so they
    // stay 10-bit where the encoder allows. HDR is tone-mapped down to 8-bit SDR either way.
    const tenBit = profile.tenBit && media.isHighBitDepth && !media.isHdr
    const pixFmt = encoderPixelFormat(profile.encoder, tenBit)
    const device = encoderDeviceArgs(profile, true)

    const filters: string[] = []
    // Only frames flagged as interlaced are touched, so progressive parts of mixed sources stay as they are.
    if (media.interlaced) filters.push('bwdif=mode=send_frame:parity=auto:deint=interlaced')
    if (media.isHdr && profile.toneMapper === 'libplacebo') {
        filters.push(`libplacebo=${scaleHeight ? `w=-2:h=${scaleHeight}:` : ''}${LIBPLACEBO_TONEMAP}:format=${pixFmt}`)
    } else if (media.isHdr && profile.toneMapper === 'zscale') {
        if (scaleHeight) filters.push(`zscale=w=-2:h=${scaleHeight}`)
        filters.push(...ZSCALE_TONEMAP, `format=${pixFmt}`)
    } else {
        if (scaleHeight) filters.push(`scale=-2:${scaleHeight}`)
        filters.push(`format=${pixFmt}`)
    }
    filters.push(...device.filters)

    return {
        input: device.input,
        output: ['-vf', filters.join(','), ...encoderArgs(profile.encoder, scaleHeight ?? media.height, options.segmentSeconds)],
    }
}

export const AUDIO_ARGS = ['-c:a', 'aac', '-ac', '2', '-b:a', '192k']

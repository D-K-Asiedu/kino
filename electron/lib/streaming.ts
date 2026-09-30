import { spawn, ChildProcess } from 'child_process'
import { Readable } from 'stream'
import fs from 'fs'
import path from 'path'
import ffmpeg from 'fluent-ffmpeg'
import ffmpegStatic from 'ffmpeg-static'

// Chromium (and therefore Electron) can only decode a limited set of codecs. HEVC/H.265 has no
// decoder in Electron's Chromium build on Linux, and AC3/E-AC3/DTS audio is not supported anywhere.
// Files outside this set are converted on the fly with ffmpeg into a fragmented MP4 stream.
const SUPPORTED_VIDEO_CODECS = new Set(['h264', 'vp8', 'vp9', 'av1'])
// 10-bit H.264 (Hi10P) is not decodable by Chromium; VP9/AV1 10-bit are.
const SUPPORTED_H264_PIX_FMTS = new Set(['yuv420p', 'yuvj420p'])
const SUPPORTED_AUDIO_CODECS = new Set(['aac', 'mp3', 'opus', 'vorbis', 'flac'])
const DIRECT_CONTAINERS = new Set(['.mp4', '.m4v', '.mov', '.webm', '.mkv'])

const ffmpegPath = ffmpegStatic?.replace('app.asar', 'app.asar.unpacked') || 'ffmpeg'

// ffmpeg reports these when the player drops a stream mid-write (seek, close); they're not failures.
const EXPECTED_DISCONNECT_ERRORS = /Connection reset by peer|Broken pipe|Error muxing a packet|Error submitting a packet/

export type PlaybackMode = 'direct' | 'transcode'

export interface PlaybackInfo {
    mode: PlaybackMode
    /** Seconds, from the container. 0 when unknown. */
    duration: number
    /** Whether the video stream can be copied as-is when transcoding (only the audio needs converting). */
    copyVideo: boolean
    reason: string | null
}

interface ProbeCacheEntry {
    mtimeMs: number
    info: PlaybackInfo
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

export async function getPlaybackInfo(filePath: string): Promise<PlaybackInfo> {
    const stats = await fs.promises.stat(filePath)
    const cached = probeCache.get(filePath)
    if (cached && cached.mtimeMs === stats.mtimeMs) return cached.info

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
        info = { mode: 'direct', duration, copyVideo: true, reason: null }
    } else {
        const problems = [
            !videoOk && `video codec ${video?.codec_name ?? 'unknown'}${video?.pix_fmt ? ` (${video.pix_fmt})` : ''}`,
            !audioOk && `audio codec ${audio?.codec_name}`,
            !containerOk && `container ${path.extname(filePath)}`,
        ].filter(Boolean)
        info = { mode: 'transcode', duration, copyVideo: videoOk, reason: `Unsupported ${problems.join(', ')}` }
    }

    probeCache.set(filePath, { mtimeMs: stats.mtimeMs, info })
    return info
}

// Only one video plays at a time, so any running conversion is stopped before a new one starts.
const activeProcesses = new Set<ChildProcess>()

export function stopAllStreams() {
    for (const proc of activeProcesses) {
        proc.stdout?.destroy()
        proc.kill('SIGKILL')
    }
    activeProcesses.clear()
}

interface StreamRequest {
    filePath: string
    /** Seconds into the file to start from. */
    start: number
    /** ffprobe stream index of the audio track to use; first audio track when null. */
    audioStreamIndex: number | null
}

export async function createTranscodeResponse({ filePath, start, audioStreamIndex }: StreamRequest): Promise<Response> {
    const info = await getPlaybackInfo(filePath)
    stopAllStreams()

    const videoArgs = info.copyVideo
        // Copied streams can only be cut at the source's keyframes, so fragment by duration instead.
        ? ['-c:v', 'copy', '-movflags', 'empty_moov+default_base_moof', '-frag_duration', '2000000']
        // Short GOPs keep fragments small, so the first frame arrives quickly.
        : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p', '-g', '48',
            '-movflags', 'frag_keyframe+empty_moov+default_base_moof']

    const args = [
        '-hide_banner', '-nostdin', '-v', 'error',
        '-ss', String(Math.max(0, start)),
        '-i', filePath,
        '-map', '0:v:0',
        '-map', audioStreamIndex !== null ? `0:${audioStreamIndex}` : '0:a:0?',
        '-sn', '-dn',
        ...videoArgs,
        '-c:a', 'aac', '-ac', '2', '-b:a', '192k',
        '-f', 'mp4', 'pipe:1',
    ]

    const proc = spawn(ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let cancelled = false
    activeProcesses.add(proc)
    proc.on('close', () => activeProcesses.delete(proc))
    proc.stderr?.on('data', (chunk) => {
        // Write errors after the player dropped the stream (seek, close) are expected.
        const message = String(chunk).trim()
        if (cancelled || !message || EXPECTED_DISCONNECT_ERRORS.test(message)) return
        console.error(`[stream] ffmpeg: ${message}`)
    })
    proc.on('error', (err) => console.error('[stream] failed to start ffmpeg:', err))

    // When the player drops the request (seek, close), the web stream is cancelled, which
    // destroys stdout; ffmpeg then exits on the broken pipe. Kill it explicitly as well.
    proc.stdout!.on('close', () => {
        cancelled = true
        if (proc.exitCode === null) proc.kill('SIGKILL')
    })

    return new Response(Readable.toWeb(proc.stdout!) as ReadableStream, {
        status: 200,
        headers: {
            'Content-Type': 'video/mp4',
            'Cache-Control': 'no-store',
        },
    })
}

/** Handler for kino-stream://play/?path=...&start=...&audio=... */
export async function handleStreamRequest(request: Request): Promise<Response> {
    try {
        const url = new URL(request.url)
        const filePath = url.searchParams.get('path')
        if (!filePath) return new Response('Missing path', { status: 400 })
        const audio = url.searchParams.get('audio')
        return await createTranscodeResponse({
            filePath,
            start: Number(url.searchParams.get('start')) || 0,
            audioStreamIndex: audio !== null && audio !== '' ? Number(audio) : null,
        })
    } catch (err) {
        console.error('[stream] request failed:', err)
        return new Response('Stream failed', { status: 500 })
    }
}

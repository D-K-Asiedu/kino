import { spawn, ChildProcess } from 'child_process'
import { Readable } from 'stream'
import { EncoderProfile, bundledFfmpegPath, describeProfile, getEncoderProfiles } from './encoders'
import { AUDIO_ARGS, HWACCEL_FALLBACK_MESSAGES, MediaDetails, buildVideoArgs, getMediaDetails, profilesForFile, rememberWorkingProfile } from './media'
import { handleHlsRequest, stopHlsSessions } from './hls'

// Progressive conversion: ffmpeg writes one fragmented MP4 to stdout, which is streamed to the
// player. Used when the video stream is copied (only audio/container need converting), since copied
// video can't be cut into the fixed segments HLS needs. Re-encoded video goes through hls.ts.

// ffmpeg reports these when the player drops a stream mid-write (seek, close); they're not failures.
const EXPECTED_DISCONNECT_ERRORS = /Connection reset by peer|Broken pipe|Error muxing a packet|Error submitting a packet/

// Only one video plays at a time, so any running conversion is stopped before a new one starts.
const activeProcesses = new Set<ChildProcess>()
// Bumped whenever streams are stopped, so a stream still being set up knows it was superseded.
let streamGeneration = 0

function stopProgressiveStreams() {
    streamGeneration++
    for (const proc of activeProcesses) {
        proc.stdout?.destroy()
        proc.kill('SIGKILL')
    }
    activeProcesses.clear()
}

export function stopAllStreams() {
    stopProgressiveStreams()
    stopHlsSessions()
}

/** Start encoder detection early so the first converted video doesn't wait for it. */
export function warmUpEncoders() {
    void getEncoderProfiles()
}

interface StreamRequest {
    filePath: string
    /** Seconds into the file to start from. */
    start: number
    /** ffprobe stream index of the audio track to use; first audio track when null. */
    audioStreamIndex: number | null
}

function buildArgs(profile: EncoderProfile, media: MediaDetails, { filePath, start, audioStreamIndex }: StreamRequest) {
    const video = media.info.copyVideo
        // Copied streams can only be cut at the source's keyframes, so fragment by duration instead.
        ? { input: [], output: ['-c:v', 'copy', '-movflags', 'empty_moov+default_base_moof', '-frag_duration', '2000000'] }
        : (() => {
            const args = buildVideoArgs(profile, media)
            return { input: args.input, output: [...args.output, '-movflags', 'frag_keyframe+empty_moov+default_base_moof'] }
        })()
    // Copied video starts at the keyframe at or before -ss. `start` is normally that keyframe
    // already (see resolveStreamStart); nudge past it so rounding can't land on the previous one.
    const seek = Math.max(0, start) + (media.info.copyVideo && start > 0 ? 0.01 : 0)
    return [
        '-hide_banner', '-nostdin', '-v', 'error',
        ...video.input,
        '-ss', seek.toFixed(3),
        '-i', filePath,
        '-map', '0:v:0',
        '-map', audioStreamIndex !== null ? `0:${audioStreamIndex}` : '0:a:0?',
        '-sn', '-dn',
        ...video.output,
        ...AUDIO_ARGS,
        '-f', 'mp4', 'pipe:1',
    ]
}

interface RunningStream {
    proc: ChildProcess
    stderr: () => string
    cancel: () => void
}

function startFfmpeg(ffmpegPath: string, args: string[]): RunningStream {
    const proc = spawn(ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let cancelled = false
    let stderr = ''
    activeProcesses.add(proc)
    proc.on('close', () => activeProcesses.delete(proc))
    proc.stderr?.on('data', (chunk) => {
        stderr += chunk
        // Write errors after the player dropped the stream (seek, close) are expected.
        const message = String(chunk)
            .split('\n')
            .filter(line => line.trim() && !HWACCEL_FALLBACK_MESSAGES.test(line))
            .join('\n')
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

    return {
        proc,
        stderr: () => stderr,
        cancel: () => {
            cancelled = true
            proc.stdout?.destroy()
            proc.kill('SIGKILL')
        },
    }
}

/** Resolves true once ffmpeg has written output, false if it exits without writing any. */
function waitForOutput(proc: ChildProcess): Promise<boolean> {
    const stdout = proc.stdout!
    return new Promise((resolve) => {
        const finish = (ok: boolean) => {
            stdout.off('readable', onReadable)
            proc.off('close', onClose)
            resolve(ok)
        }
        const onReadable = () => {
            if (stdout.readableLength > 0) finish(true)
        }
        const onClose = () => finish(stdout.readableLength > 0)
        stdout.on('readable', onReadable)
        proc.on('close', onClose)
    })
}

export async function createTranscodeResponse(request: StreamRequest): Promise<Response> {
    const media = await getMediaDetails(request.filePath)
    stopAllStreams()
    const generation = streamGeneration

    let profiles = await getEncoderProfiles()
    if (media.info.copyVideo) {
        // Only the audio is encoded, so the video encoder doesn't matter; one attempt per binary,
        // bundled first since the static build starts noticeably faster than a system ffmpeg.
        profiles = profiles
            .filter((p, i) => profiles.findIndex(q => q.ffmpegPath === p.ffmpegPath) === i)
            .sort((a, b) => Number(b.ffmpegPath === bundledFfmpegPath) - Number(a.ffmpegPath === bundledFfmpegPath))
    }
    profiles = profilesForFile(request.filePath, profiles)

    for (const profile of profiles) {
        const stream = startFfmpeg(profile.ffmpegPath, buildArgs(profile, media, request))
        const producedOutput = await waitForOutput(stream.proc)

        if (generation !== streamGeneration) {
            // A newer request took over while this one was starting.
            stream.cancel()
            return new Response(null, { status: 204 })
        }
        if (!producedOutput) {
            const lastError = stream.stderr().trim().split('\n').pop()
            console.warn(`[stream] ${describeProfile(profile)} failed, trying next: ${lastError || 'no output'}`)
            continue
        }

        rememberWorkingProfile(request.filePath, profile)
        return new Response(Readable.toWeb(stream.proc.stdout!) as ReadableStream, {
            status: 200,
            headers: {
                'Content-Type': 'video/mp4',
                'Cache-Control': 'no-store',
            },
        })
    }

    return new Response('Stream failed', { status: 500 })
}

/** Handler for kino-stream://play/?path=...&start=...&audio=... and kino-stream://hls/... */
export async function handleStreamRequest(request: Request): Promise<Response> {
    try {
        const url = new URL(request.url)
        if (url.host === 'hls') return await handleHlsRequest(url)

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

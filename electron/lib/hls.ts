import { ChildProcess, spawn } from 'child_process'
import crypto from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { EncoderProfile, describeProfile, getEncoderProfiles } from './encoders'
import { AUDIO_ARGS, HWACCEL_FALLBACK_MESSAGES, MediaDetails, buildVideoArgs, getMediaDetails, profilesForFile, rememberWorkingProfile } from './media'

// On-demand HLS for re-encoded video. The playlist lists every segment of the movie up front, so the
// player can seek anywhere; ffmpeg is (re)started at whichever segment is requested and writes
// segments to a temp folder, where they stay for the session so seeking back is instant.
//
// URLs:  kino-stream://hls/index.m3u8?path=...&audio=...&start=...   (playlist, opens a session)
//        kino-stream://hls/<token>/init.mp4 | seg_<n>.m4s

export const SEGMENT_SECONDS = 3
// A request this many segments past what the encoder is working on waits for it; further restarts it.
const MAX_WAIT_AHEAD = 2
// The encoder pauses (or, on Windows, stops) once it is this many segments past the player's latest request (~60s).
const MAX_ENCODE_AHEAD = 20
// Sessions nobody has requested anything from for this long are removed (encoder and segments).
const IDLE_TIMEOUT_MS = 2 * 60 * 1000
const POLL_MS = 100

const CORS_HEADERS = { 'Access-Control-Allow-Origin': '*' }
// Pausing the encoder relies on SIGSTOP/SIGCONT, which Windows doesn't have; there it is stopped and restarted.
const CAN_PAUSE = process.platform !== 'win32'

const HLS_ROOT = path.join(os.tmpdir(), 'kino-hls')
const PROCESS_DIR = path.join(HLS_ROOT, String(process.pid))

interface HlsSource {
    filePath: string
    audioStreamIndex: number | null
    /** Segment to encode first when the player asks for the init segment before any media segment. */
    startSegment: number
    /** Set when the player closes; stops late requests from restarting work. */
    closed: boolean
}

interface EncoderRun {
    id: number
    proc: ChildProcess
    profile: EncoderProfile
    /** First segment this run produces. */
    start: number
    /** Next segment this run will finish. */
    next: number
    initPath: string
    producedAny: boolean
    paused: boolean
    exited: boolean
    /** Stopped on purpose (seek, session end), so its exit isn't a failure. */
    stopped: boolean
    stderr: string
}

const sources = new Map<string, HlsSource>()
let current: HlsSession | null = null
let staleDirsCleaned = false

function sourceToken(filePath: string, audioStreamIndex: number | null) {
    return crypto.createHash('sha1').update(`${filePath}\0${audioStreamIndex ?? ''}`).digest('hex').slice(0, 16)
}

function isProcessAlive(pid: number) {
    try {
        process.kill(pid, 0)
        return true
    } catch (err) {
        return (err as NodeJS.ErrnoException).code === 'EPERM'
    }
}

/** Remove segment folders left behind by Kino processes that didn't shut down cleanly. */
async function cleanStaleDirs() {
    if (staleDirsCleaned) return
    staleDirsCleaned = true
    const entries = await fs.promises.readdir(HLS_ROOT).catch(() => [] as string[])
    await Promise.all(entries
        .filter(name => name !== String(process.pid) && !isProcessAlive(Number(name)))
        .map(name => fs.promises.rm(path.join(HLS_ROOT, name), { recursive: true, force: true }).catch(() => undefined)))
}

function respondText(body: string, status: number) {
    return new Response(body, { status, headers: CORS_HEADERS })
}

class HlsSession {
    readonly dir: string
    destroyed = false
    private run: EncoderRun | null = null
    private runCount = 0
    private completed = new Set<number>()
    private initPath: string | null = null
    private profileIndex = 0
    /** Once a profile has produced segments it is kept, so every segment shares one init segment. */
    private profileLocked = false
    private lastRequested = 0
    /** Counts segment requests; only the newest may start or restart the encoder. */
    private requestCount = 0
    private lastActivity = Date.now()
    private timer: NodeJS.Timeout

    private static sessionCount = 0

    constructor(
        readonly token: string,
        private readonly source: HlsSource,
        private readonly media: MediaDetails,
        private readonly profiles: EncoderProfile[],
    ) {
        this.dir = path.join(PROCESS_DIR, `${token}-${++HlsSession.sessionCount}`)
        fs.mkdirSync(this.dir, { recursive: true })
        this.timer = setInterval(() => this.tick(), POLL_MS)
    }

    get segmentCount() {
        return Math.max(1, Math.ceil(this.media.info.duration / SEGMENT_SECONDS))
    }

    playlist() {
        const base = `kino-stream://hls/${this.token}`
        const lines = [
            '#EXTM3U',
            '#EXT-X-VERSION:7',
            `#EXT-X-TARGETDURATION:${SEGMENT_SECONDS + 1}`,
            '#EXT-X-PLAYLIST-TYPE:VOD',
            '#EXT-X-MEDIA-SEQUENCE:0',
            '#EXT-X-INDEPENDENT-SEGMENTS',
            `#EXT-X-MAP:URI="${base}/init.mp4"`,
        ]
        const count = this.segmentCount
        for (let i = 0; i < count; i++) {
            const duration = i < count - 1 ? SEGMENT_SECONDS : this.media.info.duration - SEGMENT_SECONDS * (count - 1)
            lines.push(`#EXTINF:${Math.max(0.001, duration).toFixed(6)},`, `${base}/seg_${i}.m4s`)
        }
        lines.push('#EXT-X-ENDLIST', '')
        return lines.join('\n')
    }

    async serveInit(): Promise<Response> {
        this.touch(null)
        for (let attempt = 0; attempt <= this.profiles.length; attempt++) {
            if (this.destroyed) return respondText('Session closed', 410)
            if (this.initPath) return this.serveFile(this.initPath)
            // The init segment exists once a run has produced its first segment.
            const run = this.run && !this.run.exited ? this.run : this.startRun(this.source.startSegment)
            if (!run) break
            await this.waitUntil(() => this.initPath !== null, run)
        }
        return respondText('Conversion failed', 500)
    }

    async serveSegment(index: number): Promise<Response> {
        if (!Number.isInteger(index) || index < 0 || index >= this.segmentCount) return respondText('No such segment', 404)
        this.touch(index)
        const request = ++this.requestCount
        for (let attempt = 0; attempt <= this.profiles.length; attempt++) {
            if (this.destroyed) return respondText('Session closed', 410)
            if (this.completed.has(index)) return this.serveFile(this.segmentPath(index))
            // The player abandons a pending segment when it seeks. Its request can't be cancelled from
            // here, so an older request must not restart the encoder away from the newest one.
            if (attempt > 0 && request !== this.requestCount) return respondText('Superseded', 503)
            const run = this.runFor(index)
            if (!run) break
            await this.waitUntil(() => this.completed.has(index), run)
        }
        return respondText('Conversion failed', 500)
    }

    async destroy() {
        if (this.destroyed) return
        this.destroyed = true
        clearInterval(this.timer)
        const run = this.run
        this.stopRun(run)
        if (run && !run.exited) await new Promise(resolve => run.proc.once('close', resolve))
        await fs.promises.rm(this.dir, { recursive: true, force: true }).catch(() => undefined)
    }

    private segmentPath(index: number) {
        return path.join(this.dir, `seg_${index}.m4s`)
    }

    private async serveFile(filePath: string) {
        const data = await fs.promises.readFile(filePath)
        return new Response(data, { status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'video/mp4', 'Cache-Control': 'no-store' } })
    }

    private touch(index: number | null) {
        this.lastActivity = Date.now()
        if (index === null) return
        this.lastRequested = index
        const run = this.run
        if (run?.paused && run.next - index <= MAX_ENCODE_AHEAD / 2) {
            run.proc.kill('SIGCONT')
            run.paused = false
        }
    }

    /** The run that will produce `index`: the current one if it's about to, otherwise a new one. */
    private runFor(index: number): EncoderRun | null {
        const run = this.run
        if (run && !run.exited && index >= run.start && index <= run.next + MAX_WAIT_AHEAD) return run
        return this.startRun(index)
    }

    private startRun(start: number): EncoderRun | null {
        this.stopRun(this.run)
        const profile = this.profiles[this.profileIndex]
        if (!profile) return null

        const id = ++this.runCount
        const initName = `init_${id}.mp4`
        const offset = start * SEGMENT_SECONDS
        const video = buildVideoArgs(profile, this.media, { segmentSeconds: SEGMENT_SECONDS })
        const args = [
            '-hide_banner', '-nostdin', '-v', 'error',
            ...video.input,
            '-ss', offset.toFixed(3),
            '-i', this.source.filePath,
            '-map', '0:v:0',
            '-map', this.source.audioStreamIndex !== null ? `0:${this.source.audioStreamIndex}` : '0:a:0?',
            '-sn', '-dn',
            ...video.output,
            ...AUDIO_ARGS,
            // Each run's timestamps restart at 0; shift them to the segment's place in the movie.
            '-output_ts_offset', offset.toFixed(3),
            '-f', 'hls',
            '-hls_time', String(SEGMENT_SECONDS),
            '-hls_segment_type', 'fmp4',
            '-hls_fmp4_init_filename', initName,
            '-start_number', String(start),
            '-hls_list_size', '0',
            // Segments are written as .tmp and renamed when complete, so an existing file is a finished one.
            '-hls_flags', 'temp_file',
            // Output names are relative to cwd: ffmpeg places the init segment beside the playlist by
            // splitting its path on '/' only, so a Windows path would put it in the working directory.
            '-hls_segment_filename', 'seg_%d.m4s',
            `run_${id}.m3u8`,
        ]

        const proc = spawn(profile.ffmpegPath, args, { cwd: this.dir, stdio: ['ignore', 'ignore', 'pipe'] })
        const run: EncoderRun = {
            id, proc, profile, start, next: start, initPath: path.join(this.dir, initName),
            producedAny: false, paused: false, exited: false, stopped: false, stderr: '',
        }
        proc.stderr?.on('data', (chunk) => {
            run.stderr += chunk
            const message = String(chunk)
                .split('\n')
                .filter(line => line.trim() && !HWACCEL_FALLBACK_MESSAGES.test(line))
                .join('\n')
            if (!run.stopped && message) console.error(`[hls] ffmpeg: ${message}`)
        })
        proc.on('error', (err) => console.error('[hls] failed to start ffmpeg:', err))
        proc.on('close', () => {
            run.exited = true
            this.collect(run)
            if (!run.producedAny && !run.stopped && !this.profileLocked) {
                const lastError = run.stderr.trim().split('\n').pop()
                console.warn(`[hls] ${describeProfile(profile)} failed, trying next: ${lastError || 'no output'}`)
                this.profileIndex++
            }
        })

        this.run = run
        return run
    }

    private stopRun(run: EncoderRun | null) {
        if (!run || run.exited) return
        run.stopped = true
        run.proc.kill('SIGKILL')
    }

    /** Record segments the run has finished since the last check. */
    private collect(run: EncoderRun) {
        while (run.next < this.segmentCount) {
            if (this.completed.has(run.next) && run.producedAny) {
                // Caught up with segments an earlier run already made; re-encoding them is wasted work.
                this.stopRun(run)
                return
            }
            if (!fs.existsSync(this.segmentPath(run.next))) break
            this.completed.add(run.next)
            run.next++
            if (!run.producedAny) {
                run.producedAny = true
                if (!this.profileLocked) {
                    this.profileLocked = true
                    // Every run writes an equivalent init segment; the first one serves the whole session.
                    this.initPath = run.initPath
                    rememberWorkingProfile(this.source.filePath, run.profile)
                }
            }
        }
        if (!run.exited && !run.paused && run.next - 1 - this.lastRequested > MAX_ENCODE_AHEAD) {
            if (CAN_PAUSE) {
                run.proc.kill('SIGSTOP')
                run.paused = true
            } else {
                // No SIGSTOP on Windows: stop instead. The player asks for the first missing segment
                // while it still has ~30s buffered, and runFor() starts a new run there.
                this.stopRun(run)
            }
        }
    }

    private tick() {
        if (Date.now() - this.lastActivity > IDLE_TIMEOUT_MS) {
            if (current === this) current = null
            void this.destroy()
            return
        }
        if (this.run && !this.run.exited) this.collect(this.run)
    }

    /** Wait until `done()` holds; false if the run ends or is replaced first. */
    private async waitUntil(done: () => boolean, run: EncoderRun): Promise<boolean> {
        while (!this.destroyed) {
            if (done()) return true
            if (run.exited || this.run !== run) return done()
            await new Promise(resolve => setTimeout(resolve, POLL_MS))
        }
        return false
    }
}

async function sessionFor(token: string): Promise<HlsSession | null> {
    const source = sources.get(token)
    if (!source || source.closed) return null
    if (current?.token === token && !current.destroyed) return current

    const [media, profiles] = await Promise.all([getMediaDetails(source.filePath), getEncoderProfiles(), cleanStaleDirs()])
    // Another request may have opened it while this one was waiting.
    if (current?.token === token && !current.destroyed) return current
    // Only one video plays at a time.
    void current?.destroy()
    current = new HlsSession(token, source, media, profilesForFile(source.filePath, profiles))
    return current
}

/** Close all sessions (player closed or app quitting); late requests for them are refused. */
export function stopHlsSessions(): Promise<void> {
    for (const source of sources.values()) source.closed = true
    const session = current
    current = null
    return session?.destroy() ?? Promise.resolve()
}

/** On quit: stop all sessions and remove this process's segment folder. */
export async function removeHlsFiles() {
    await stopHlsSessions()
    // A replaced session's ffmpeg may still be exiting; Windows can't delete files it holds open.
    await fs.promises.rm(PROCESS_DIR, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }).catch(() => undefined)
}

export async function handleHlsRequest(url: URL): Promise<Response> {
    if (url.pathname === '/index.m3u8') {
        const filePath = url.searchParams.get('path')
        if (!filePath) return respondText('Missing path', 400)
        const audio = url.searchParams.get('audio')
        const audioStreamIndex = audio !== null && audio !== '' ? Number(audio) : null
        const start = Math.max(0, Number(url.searchParams.get('start')) || 0)

        const token = sourceToken(filePath, audioStreamIndex)
        sources.set(token, { filePath, audioStreamIndex, startSegment: Math.floor(start / SEGMENT_SECONDS), closed: false })
        const session = await sessionFor(token)
        if (!session) return respondText('Not found', 404)
        return new Response(session.playlist(), {
            status: 200,
            headers: { ...CORS_HEADERS, 'Content-Type': 'application/vnd.apple.mpegurl', 'Cache-Control': 'no-store' },
        })
    }

    const match = url.pathname.match(/^\/([0-9a-f]+)\/(init\.mp4|seg_(\d+)\.m4s)$/)
    if (!match) return respondText('Not found', 404)
    const session = await sessionFor(match[1])
    if (!session) return respondText('Session closed', 410)
    return match[3] === undefined ? session.serveInit() : session.serveSegment(Number(match[3]))
}

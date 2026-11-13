import { spawn } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import ffmpegStatic from 'ffmpeg-static'

// Picks how converted streams are encoded. Encoding on the GPU uses a fraction of the CPU time of
// software encoding, so every GPU encoder the platform could have is tried, on the bundled ffmpeg
// and on a system ffmpeg (which may have VAAPI and libplacebo where the bundled static build
// doesn't). Every candidate is test-run once; streams fall back down the list on failure.

export type VideoEncoder =
    | 'h264_nvenc' | 'h264_qsv' | 'h264_amf' | 'h264_videotoolbox'
    | 'h264_vaapi' | 'vp9_vaapi' | 'libx264'
export type ToneMapper = 'libplacebo' | 'zscale'

export interface EncoderProfile {
    ffmpegPath: string
    encoder: VideoEncoder
    /** VAAPI render node, for the VAAPI encoders. */
    vaapiDevice: string | null
    /** How this ffmpeg converts HDR to SDR; null when it can't. */
    toneMapper: ToneMapper | null
    /** Whether the encoder can keep 10-bit sources at 10 bits (avoids banding in dark scenes). */
    tenBit: boolean
}

export const bundledFfmpegPath = ffmpegStatic?.replace('app.asar', 'app.asar.unpacked') || null

interface EncoderSpec {
    /** Where the encoder can exist; it is only test-run there. */
    platforms: NodeJS.Platform[]
    /** Frames are uploaded to a VAAPI device (Linux); the others take frames from system memory. */
    vaapi: boolean
    /** Codec and quality arguments. `height` is the output height. */
    quality: (height: number) => string[]
    /** Extra arguments that make forced keyframes real IDR frames, which HLS segments must start with. */
    forcedIdr: string[]
    /** Chromium decodes 10-bit VP9 (profile 2) everywhere, but not 10-bit H.264, so only VP9 gets a 10-bit mode. */
    tenBit: boolean
}

// Best first. The Windows and macOS encoders were written from ffmpeg's documentation and have not
// been run on that hardware; the startup test (testEncoder) keeps any that misbehave out of use.
const ENCODERS: Record<VideoEncoder, EncoderSpec> = {
    h264_nvenc: {
        platforms: ['win32', 'linux'], vaapi: false, tenBit: false,
        quality: () => ['-c:v', 'h264_nvenc', '-preset', 'p4', '-rc', 'vbr', '-cq', '23', '-b:v', '0'],
        forcedIdr: ['-forced-idr', '1'],
    },
    h264_qsv: {
        platforms: ['win32'], vaapi: false, tenBit: false,
        quality: () => ['-c:v', 'h264_qsv', '-preset', 'veryfast', '-global_quality', '23'],
        forcedIdr: ['-forced_idr', '1'],
    },
    h264_amf: {
        platforms: ['win32'], vaapi: false, tenBit: false,
        quality: () => ['-c:v', 'h264_amf', '-quality', 'speed', '-rc', 'cqp', '-qp_i', '22', '-qp_p', '22'],
        forcedIdr: ['-forced_idr', '1'],
    },
    h264_videotoolbox: {
        platforms: ['darwin'], vaapi: false, tenBit: false,
        // Constant quality only exists on Apple Silicon, so a bitrate is used; it works on every Mac.
        quality: height => ['-c:v', 'h264_videotoolbox', '-b:v', height > 1080 ? '20M' : height > 720 ? '8M' : '4M'],
        forcedIdr: [],
    },
    // h264_vaapi needs the full Intel/AMD VA driver (e.g. RPM Fusion's intel-media-driver on Fedora);
    // distro "free" drivers often only expose VP9, which Chromium also plays inside MP4.
    // VAAPI drivers may pick a rate-control mode that ignores the quality setting (Intel's iHD picks
    // ICQ and ends up below the source's bitrate), so constant-QP is requested explicitly.
    h264_vaapi: {
        platforms: ['linux'], vaapi: true, tenBit: false,
        quality: () => ['-c:v', 'h264_vaapi', '-rc_mode', 'CQP', '-qp', '21'],
        forcedIdr: [],
    },
    vp9_vaapi: {
        platforms: ['linux'], vaapi: true, tenBit: true,
        // VP9 quantizer index, 0-255 (lower is better).
        quality: () => ['-c:v', 'vp9_vaapi', '-rc_mode', 'CQP', '-global_quality', '60'],
        forcedIdr: [],
    },
    libx264: {
        platforms: ['win32', 'linux', 'darwin'], vaapi: false, tenBit: false,
        quality: () => ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21'],
        forcedIdr: [],
    },
}

const ENCODER_ORDER = Object.keys(ENCODERS) as VideoEncoder[]
const HARDWARE_ENCODERS = ENCODER_ORDER.filter(encoder => encoder !== 'libx264' && ENCODERS[encoder].platforms.includes(process.platform))

export function isHardwareEncoder(encoder: VideoEncoder) {
    return encoder !== 'libx264'
}

/** Pixel format of the frames handed to the encoder. */
export function encoderPixelFormat(encoder: VideoEncoder, tenBit: boolean) {
    if (encoder === 'libx264') return 'yuv420p'
    return tenBit ? 'p010' : 'nv12'
}

/** Arguments before `-i` and at the end of the filter chain that put frames where the encoder wants them. */
export function encoderDeviceArgs(profile: EncoderProfile, hardwareDecode: boolean): { input: string[], filters: string[] } {
    if (!ENCODERS[profile.encoder].vaapi) return { input: [], filters: [] }
    return {
        input: [
            '-init_hw_device', `vaapi=va:${profile.vaapiDevice}`, '-filter_hw_device', 'va',
            // Decode on the GPU where the driver supports the codec; ffmpeg falls back to software otherwise.
            // Decoded frames come back to system memory so the same filters work either way.
            ...(hardwareDecode ? ['-hwaccel', 'vaapi', '-hwaccel_device', 'va'] : []),
        ],
        filters: ['hwupload'],
    }
}

/**
 * Encoder arguments. With `segmentSeconds`, a keyframe is forced every that many seconds (and nowhere
 * else), so HLS segments cut exactly there.
 */
export function encoderArgs(encoder: VideoEncoder, height: number, segmentSeconds?: number): string[] {
    const spec = ENCODERS[encoder]
    const keyframes = segmentSeconds
        ? [
            '-force_key_frames', `expr:gte(t,n_forced*${segmentSeconds})`, '-g', '720',
            ...spec.forcedIdr,
            ...(encoder === 'libx264' ? ['-sc_threshold', '0'] : []),
            // Segments from different runs end up side by side in the player (seeking back, and on
            // Windows every restart). B-frames shift timestamps differently per run, which leaves
            // holes where they meet, so HLS output has none.
            ...(encoder === 'vp9_vaapi' ? [] : ['-bf', '0']),
        ]
        // Short GOPs keep fragments small, so the first frame arrives quickly.
        : ['-g', '48']
    return [...spec.quality(height), ...keyframes]
}

export const LIBPLACEBO_TONEMAP = 'tonemapping=bt.2390:colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=tv'
export const ZSCALE_TONEMAP = ['zscale=t=linear:npl=100', 'format=gbrpf32le', 'zscale=p=bt709',
    'tonemap=tonemap=hable:desat=0', 'zscale=t=bt709:m=bt709:r=tv']

const TEST_INPUT = ['-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=24:duration=0.2']

function ffmpegSucceeds(ffmpegPath: string, args: string[], options: { cwd?: string, nullOutput?: boolean } = {}): Promise<boolean> {
    const output = options.nullOutput === false ? [] : ['-f', 'null', '-']
    return new Promise((resolve) => {
        const proc = spawn(ffmpegPath, ['-hide_banner', '-nostdin', '-v', 'error', ...args, ...output], { stdio: 'ignore', cwd: options.cwd })
        const timer = setTimeout(() => proc.kill('SIGKILL'), 15000)
        proc.on('error', () => {
            clearTimeout(timer)
            resolve(false)
        })
        proc.on('close', (code) => {
            clearTimeout(timer)
            resolve(code === 0)
        })
    })
}

function findOnPath(name: string): string | null {
    const executable = process.platform === 'win32' ? `${name}.exe` : name
    for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
        if (!dir) continue
        const candidate = path.join(dir, executable)
        try {
            fs.accessSync(candidate, fs.constants.X_OK)
            return candidate
        } catch {
            // not here
        }
    }
    return null
}

function vaapiRenderNodes(): string[] {
    if (process.platform !== 'linux') return []
    try {
        return fs.readdirSync('/dev/dri')
            .filter(name => name.startsWith('renderD'))
            .sort()
            .map(name => `/dev/dri/${name}`)
    } catch {
        return []
    }
}

async function detectToneMapper(ffmpegPath: string): Promise<ToneMapper | null> {
    if (await ffmpegSucceeds(ffmpegPath, [...TEST_INPUT, '-vf', `libplacebo=${LIBPLACEBO_TONEMAP}:format=yuv420p`])) return 'libplacebo'
    if (await ffmpegSucceeds(ffmpegPath, [...TEST_INPUT, '-vf', [...ZSCALE_TONEMAP, 'format=yuv420p'].join(',')])) return 'zscale'
    return null
}

let testRunCount = 0

/**
 * Whether a GPU encoder works for streaming: it must encode, and it must put keyframes exactly where
 * asked. An encoder that ignores forced keyframes produces HLS segments of the wrong length, which
 * stalls playback, so the test writes 4 one-second segments and checks that all of them appear.
 */
async function testEncoder(ffmpegPath: string, profile: Pick<EncoderProfile, 'encoder' | 'vaapiDevice'>, tenBit: boolean): Promise<boolean> {
    const dir = path.join(os.tmpdir(), `kino-encoder-test-${process.pid}-${++testRunCount}`)
    const device = encoderDeviceArgs(profile as EncoderProfile, false)
    try {
        await fs.promises.mkdir(dir, { recursive: true })
        const ok = await ffmpegSucceeds(ffmpegPath, [
            ...device.input,
            '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=24:duration=4',
            '-vf', [`format=${encoderPixelFormat(profile.encoder, tenBit)}`, ...device.filters].join(','),
            ...encoderArgs(profile.encoder, 360, 1),
            '-f', 'hls', '-hls_time', '1', '-hls_segment_type', 'fmp4', '-hls_fmp4_init_filename', 'init.mp4',
            '-hls_list_size', '0', '-hls_segment_filename', 'seg_%d.m4s', 'test.m3u8',
        ], { cwd: dir, nullOutput: false })
        if (!ok) return false
        const segments = (await fs.promises.readdir(dir)).filter(name => /^seg_\d+\.m4s$/.test(name))
        return segments.length === 4
    } catch {
        return false
    } finally {
        await fs.promises.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => undefined)
    }
}

async function detectHardwareEncoder(ffmpegPath: string, encoder: VideoEncoder, vaapiDevices: string[]): Promise<{ device: string | null, tenBit: boolean } | null> {
    const spec = ENCODERS[encoder]
    // VAAPI encoders are tried on each GPU; the others find their own device.
    const devices = spec.vaapi ? vaapiDevices : [null]
    for (const device of devices) {
        if (!await testEncoder(ffmpegPath, { encoder, vaapiDevice: device }, false)) continue
        const tenBit = spec.tenBit && await testEncoder(ffmpegPath, { encoder, vaapiDevice: device }, true)
        return { device, tenBit }
    }
    return null
}

/** Encoders this build of ffmpeg was compiled with; saves test-running ones that can't exist. */
function listEncoders(ffmpegPath: string): Promise<Set<string>> {
    return new Promise((resolve) => {
        const proc = spawn(ffmpegPath, ['-hide_banner', '-encoders'], { stdio: ['ignore', 'pipe', 'ignore'] })
        let output = ''
        proc.stdout.on('data', (chunk) => { output += chunk })
        proc.on('error', () => resolve(new Set()))
        proc.on('close', () => resolve(new Set(output.split('\n').map(line => line.trim().split(/\s+/)[1]).filter(Boolean))))
    })
}

async function detectBinary(ffmpegPath: string, devices: string[]): Promise<EncoderProfile[]> {
    const compiled = await listEncoders(ffmpegPath)
    const candidates = HARDWARE_ENCODERS.filter(encoder => compiled.has(encoder))
    const [toneMapper, hasLibx264, ...hardware] = await Promise.all([
        detectToneMapper(ffmpegPath),
        ffmpegSucceeds(ffmpegPath, [...TEST_INPUT, '-c:v', 'libx264', '-preset', 'ultrafast']),
        ...candidates.map(encoder => detectHardwareEncoder(ffmpegPath, encoder, devices)),
    ])

    const profiles: EncoderProfile[] = []
    candidates.forEach((encoder, i) => {
        const found = hardware[i]
        if (found) profiles.push({ ffmpegPath, encoder, vaapiDevice: found.device, toneMapper, tenBit: found.tenBit })
    })
    if (hasLibx264) profiles.push({ ffmpegPath, encoder: 'libx264', vaapiDevice: null, toneMapper, tenBit: false })
    return profiles
}

const TONE_MAPPER_RANK = (toneMapper: ToneMapper | null) => toneMapper === 'libplacebo' ? 0 : toneMapper === 'zscale' ? 1 : 2

async function detectProfiles(): Promise<EncoderProfile[]> {
    const binaries: string[] = []
    const seen = new Set<string>()
    // The bundled build comes first so it wins ties.
    for (const candidate of [bundledFfmpegPath, findOnPath('ffmpeg')]) {
        if (!candidate) continue
        const resolved = fs.existsSync(candidate) ? fs.realpathSync(candidate) : candidate
        if (seen.has(resolved)) continue
        seen.add(resolved)
        binaries.push(candidate)
    }

    const devices = vaapiRenderNodes()
    const results = await Promise.all(binaries.map(binary => detectBinary(binary, devices)))
    // Stable sort: GPU encoders first, then the best tone-mapping, then bundled before system.
    return results.flat().sort((a, b) =>
        ENCODER_ORDER.indexOf(a.encoder) - ENCODER_ORDER.indexOf(b.encoder) || TONE_MAPPER_RANK(a.toneMapper) - TONE_MAPPER_RANK(b.toneMapper))
}

let profilesPromise: Promise<EncoderProfile[]> | null = null

/** Usable encoder setups, best first. Detection runs once; call early to warm it up. */
export function getEncoderProfiles(): Promise<EncoderProfile[]> {
    profilesPromise ??= detectProfiles()
        .catch((err) => {
            console.error('[stream] encoder detection failed:', err)
            return []
        })
        .then((profiles) => {
            if (profiles.length === 0) {
                // Nothing passed the tests; still try the plain software path.
                profiles = [{ ffmpegPath: bundledFfmpegPath || 'ffmpeg', encoder: 'libx264', vaapiDevice: null, toneMapper: null, tenBit: false }]
            }
            console.log('[stream] encoders:', profiles.map(describeProfile).join(' > '))
            return profiles
        })
    return profilesPromise
}

export function describeProfile(profile: EncoderProfile) {
    const binary = profile.ffmpegPath === bundledFfmpegPath ? 'bundled' : profile.ffmpegPath
    return `${profile.encoder}${profile.vaapiDevice ? `@${profile.vaapiDevice}` : ''} (${binary}, tonemap: ${profile.toneMapper ?? 'none'}${profile.tenBit ? ', 10-bit' : ''})`
}

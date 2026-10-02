import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import ffmpegStatic from 'ffmpeg-static'

// Picks how converted streams are encoded. The bundled ffmpeg is a static build without hardware
// support, so a system ffmpeg is also considered: it may have VAAPI (GPU encoding) and libplacebo
// (GPU tone-mapping). Every candidate is test-run once; streams fall back down the list on failure.

export type VideoEncoder = 'h264_vaapi' | 'vp9_vaapi' | 'libx264'
export type ToneMapper = 'libplacebo' | 'zscale'

export interface EncoderProfile {
    ffmpegPath: string
    encoder: VideoEncoder
    /** VAAPI render node, for the hardware encoders. */
    vaapiDevice: string | null
    /** How this ffmpeg converts HDR to SDR; null when it can't. */
    toneMapper: ToneMapper | null
}

export const bundledFfmpegPath = ffmpegStatic?.replace('app.asar', 'app.asar.unpacked') || null

// h264_vaapi needs the full Intel/AMD VA driver (e.g. RPM Fusion's intel-media-driver on Fedora);
// distro "free" drivers often only expose VP9, which Chromium also plays inside MP4.
const HARDWARE_ENCODERS: VideoEncoder[] = ['h264_vaapi', 'vp9_vaapi']

export const LIBPLACEBO_TONEMAP = 'tonemapping=bt.2390:colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=tv'
export const ZSCALE_TONEMAP = ['zscale=t=linear:npl=100', 'format=gbrpf32le', 'zscale=p=bt709',
    'tonemap=tonemap=hable:desat=0', 'zscale=t=bt709:m=bt709:r=tv']

const TEST_INPUT = ['-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=24:duration=0.2']

function ffmpegSucceeds(ffmpegPath: string, args: string[], timeoutMs = 10000): Promise<boolean> {
    return new Promise((resolve) => {
        const proc = spawn(ffmpegPath, ['-hide_banner', '-nostdin', '-v', 'error', ...args, '-f', 'null', '-'], { stdio: 'ignore' })
        const timer = setTimeout(() => proc.kill('SIGKILL'), timeoutMs)
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

async function detectHardwareEncoder(ffmpegPath: string, encoder: VideoEncoder, devices: string[]): Promise<string | null> {
    for (const device of devices) {
        const ok = await ffmpegSucceeds(ffmpegPath, [
            '-init_hw_device', `vaapi=va:${device}`, '-filter_hw_device', 'va',
            ...TEST_INPUT, '-vf', 'format=nv12,hwupload', '-c:v', encoder,
        ])
        if (ok) return device
    }
    return null
}

async function detectBinary(ffmpegPath: string, devices: string[]): Promise<EncoderProfile[]> {
    const [toneMapper, hasLibx264, ...hardwareDevices] = await Promise.all([
        detectToneMapper(ffmpegPath),
        ffmpegSucceeds(ffmpegPath, [...TEST_INPUT, '-c:v', 'libx264', '-preset', 'ultrafast']),
        ...HARDWARE_ENCODERS.map(encoder => detectHardwareEncoder(ffmpegPath, encoder, devices)),
    ])

    const profiles: EncoderProfile[] = []
    HARDWARE_ENCODERS.forEach((encoder, i) => {
        const vaapiDevice = hardwareDevices[i]
        if (vaapiDevice) profiles.push({ ffmpegPath, encoder, vaapiDevice, toneMapper })
    })
    if (hasLibx264) profiles.push({ ffmpegPath, encoder: 'libx264', vaapiDevice: null, toneMapper })
    return profiles
}

const ENCODER_RANK: Record<VideoEncoder, number> = { h264_vaapi: 0, vp9_vaapi: 1, libx264: 2 }
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
        ENCODER_RANK[a.encoder] - ENCODER_RANK[b.encoder] || TONE_MAPPER_RANK(a.toneMapper) - TONE_MAPPER_RANK(b.toneMapper))
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
                profiles = [{ ffmpegPath: bundledFfmpegPath || 'ffmpeg', encoder: 'libx264', vaapiDevice: null, toneMapper: null }]
            }
            console.log('[stream] encoders:', profiles.map(describeProfile).join(' > '))
            return profiles
        })
    return profilesPromise
}

export function describeProfile(profile: EncoderProfile) {
    const binary = profile.ffmpegPath === bundledFfmpegPath ? 'bundled' : profile.ffmpegPath
    return `${profile.encoder}${profile.vaapiDevice ? `@${profile.vaapiDevice}` : ''} (${binary}, tonemap: ${profile.toneMapper ?? 'none'})`
}

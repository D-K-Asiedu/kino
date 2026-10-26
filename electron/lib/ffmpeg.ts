import ffmpeg from 'fluent-ffmpeg'
import ffmpegStatic from 'ffmpeg-static'
import ffprobeStatic from 'ffprobe-static'
import path from 'path'

import { app } from 'electron'

// Configure ffmpeg paths
const ffmpegPath = ffmpegStatic?.replace('app.asar', 'app.asar.unpacked') || ''
const ffprobePath = ffprobeStatic.path.replace('app.asar', 'app.asar.unpacked')

if (ffmpegPath) ffmpeg.setFfmpegPath(ffmpegPath)
if (ffprobePath) ffmpeg.setFfprobePath(ffprobePath)

export interface MediaMetadata {
    audioTracks: {
        index: number
        language: string
        label: string
        codec: string
        channels: number
    }[]
    subtitleTracks: {
        index: number
        language: string
        label: string
        codec: string
        isDefault: boolean
        /** Only covers signs/songs (forced subtitles), not dialogue. */
        isForced: boolean
    }[]
}

// Bitmap subtitles the player can't draw: they are images, so they can't be converted to WebVTT either.
// PGS is drawn as images by the renderer (libpgs).
const UNSUPPORTED_SUBTITLE_CODECS = new Set(['dvd_subtitle', 'dvb_subtitle', 'xsub'])

const FORCED_SUBTITLE_TITLE = /\b(signs?|songs?|forced)\b/i

export async function getMediaMetadata(filePath: string): Promise<MediaMetadata> {
    return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(filePath, (err, metadata) => {
            if (err) {
                console.error('ffprobe error:', err)
                reject(err)
                return
            }

            const audioTracks = metadata.streams
                .filter(s => s.codec_type === 'audio')
                .map((s, i) => ({
                    index: s.index,
                    language: s.tags?.language || 'und',
                    label: s.tags?.title || `Audio ${i + 1}`,
                    codec: s.codec_name || 'unknown',
                    channels: s.channels || 2
                }))

            const subtitleTracks = metadata.streams
                .filter(s => s.codec_type === 'subtitle' && !UNSUPPORTED_SUBTITLE_CODECS.has(s.codec_name || ''))
                .map((s, i) => ({
                    index: s.index,
                    language: s.tags?.language || 'und',
                    label: s.tags?.title || `Subtitle ${i + 1}`,
                    codec: s.codec_name || 'unknown',
                    isDefault: s.disposition?.default === 1,
                    isForced: s.disposition?.forced === 1 || FORCED_SUBTITLE_TITLE.test(s.tags?.title || '')
                }))

            resolve({ audioTracks, subtitleTracks })
        })
    })
}

export async function extractSubtitle(filePath: string, trackIndex: number): Promise<string> {
    const tempDir = app.getPath('temp')
    const outputPath = path.join(tempDir, `kino_sub_${path.basename(filePath)}_${trackIndex}.vtt`)

    return new Promise((resolve, reject) => {
        ffmpeg(filePath)
            .output(outputPath)
            .outputOptions([
                `-map 0:${trackIndex}`,
                '-f webvtt',
                '-y'
            ])
            .on('end', () => resolve(outputPath))
            .on('error', (err) => reject(err))
            .run()
    })
}

export async function extractSubtitleContent(filePath: string, trackIndex: number): Promise<string> {
    const vttPath = await extractSubtitle(filePath, trackIndex)
    const fs = await import('fs/promises')
    return fs.readFile(vttPath, 'utf-8')
}

/** Copy a PGS track out as a .sup file (no re-encoding) and return its bytes for the renderer to draw. */
export async function extractPgsSubtitle(filePath: string, trackIndex: number): Promise<Buffer> {
    const tempDir = app.getPath('temp')
    const outputPath = path.join(tempDir, `kino_sub_${path.basename(filePath)}_${trackIndex}.sup`)

    await new Promise<void>((resolve, reject) => {
        ffmpeg(filePath)
            .output(outputPath)
            .outputOptions([
                `-map 0:${trackIndex}`,
                '-c copy',
                '-f sup',
                '-y'
            ])
            .on('end', () => resolve())
            .on('error', (err) => reject(err))
            .run()
    })

    const fs = await import('fs/promises')
    try {
        return await fs.readFile(outputPath)
    } finally {
        await fs.rm(outputPath, { force: true })
    }
}

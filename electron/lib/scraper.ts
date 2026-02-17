import fs from 'fs-extra'
import path from 'path'
import ffmpeg from 'fluent-ffmpeg'
import { app } from 'electron'
import ffmpegPath from 'ffmpeg-static'
import ffprobePath from 'ffprobe-static'

// Set ffmpeg and ffprobe paths
if (ffmpegPath) {
    ffmpeg.setFfmpegPath(ffmpegPath.replace('app.asar', 'app.asar.unpacked'))
} else {
    console.error('ffmpeg-static not found')
}

if (ffprobePath && ffprobePath.path) {
    ffmpeg.setFfprobePath(ffprobePath.path.replace('app.asar', 'app.asar.unpacked'))
} else {
    console.error('ffprobe-static not found')
}

interface VideoMetadata {
    duration?: number
    width?: number
    height?: number
    codec?: string
    size?: number
}

export async function fetchMetadata(movie: any, options?: { forceThumbnail?: boolean }): Promise<any> {
    try {
        const fileStats = await getFileStats(movie.file_path)
        // Extract video file metadata using ffprobe
        const videoMeta = await getVideoMetadata(movie.file_path)

        // Generate thumbnail from video
        const thumbnailPath = await generateThumbnail(
            movie.file_path,
            movie.id,
            videoMeta.duration,
            { force: options?.forceThumbnail }
        )

        return {
            ...movie,
            // Keep parsed title and year from filename
            title: movie.title,
            original_title: movie.title,
            year: movie.year,
            plot: videoMeta.duration ? `Duration: ${formatDuration(videoMeta.duration)}` : null,
            poster_path: thumbnailPath, // Path to generated thumbnail
            backdrop_path: null,
            rating: null,
            file_mtime: fileStats?.mtimeMs ?? movie.file_mtime ?? null,
            file_size: fileStats?.size ?? movie.file_size ?? null,
        }
    } catch (error) {
        console.error('Error extracting metadata:', error)
        // Return original movie data if extraction fails
        return movie
    }
}

async function getVideoMetadata(filePath: string): Promise<VideoMetadata> {
    return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(filePath, (err, metadata) => {
            if (err) {
                reject(err)
                return
            }

            const videoStream = metadata.streams.find(s => s.codec_type === 'video')

            resolve({
                duration: typeof metadata.format.duration === 'number' ? metadata.format.duration : parseFloat(metadata.format.duration || '0'),
                width: videoStream?.width,
                height: videoStream?.height,
                codec: videoStream?.codec_name,
                size: metadata.format.size
            })
        })
    })
}

export async function generateThumbnailToPath(
    videoPath: string,
    outputPath: string,
    duration?: number,
    options?: { force?: boolean }
): Promise<string | null> {
    try {
        const outputDir = path.dirname(outputPath)
        await fs.ensureDir(outputDir)
        const tempThumbnailPath = `${outputPath}.tmp`

        // If thumbnail already exists and is valid, return it
        if (!options?.force && await isThumbnailValid(outputPath)) {
            return outputPath
        }

        if (options?.force) {
            await fs.remove(outputPath).catch(() => null)
        }

        // Calculate timestamp (10% into the video, or 10 seconds if duration unknown)
        let timestamp = 10
        if (typeof duration === 'number' && !isNaN(duration) && duration > 0) {
            timestamp = duration * 0.1
        }

        return new Promise((resolve, _reject) => {
            ffmpeg(videoPath)
                .screenshots({
                    timestamps: [timestamp],
                    filename: path.basename(tempThumbnailPath),
                    folder: outputDir,
                    size: '640x?' // Maintain aspect ratio, width 640px
                })
                .on('end', () => {
                    fs.pathExists(tempThumbnailPath)
                        .then((exists) => {
                            if (!exists) return null
                            return fs.move(tempThumbnailPath, outputPath, { overwrite: true })
                        })
                        .then(() => {
                            console.log(`Thumbnail generated at ${outputPath}`)
                            resolve(outputPath)
                        })
                        .catch((err) => {
                            console.error(`Failed to finalize thumbnail for ${outputPath}:`, err)
                            resolve(null)
                        })
                })
                .on('error', (err) => {
                    console.error(`Failed to generate thumbnail for ${outputPath}:`, err)
                    fs.remove(tempThumbnailPath).catch(() => null)
                    resolve(null) // Return null instead of rejecting
                })
        })
    } catch (error) {
        console.error('Thumbnail generation error:', error)
        return null
    }
}

async function generateThumbnail(
    videoPath: string,
    movieId: number,
    duration?: number,
    options?: { force?: boolean }
): Promise<string | null> {
    const thumbnailsDir = path.join(app.getPath('userData'), 'thumbnails')
    const thumbnailPath = path.join(thumbnailsDir, `${movieId}.jpg`)
    return generateThumbnailToPath(videoPath, thumbnailPath, duration, options)
}

async function isThumbnailValid(thumbnailPath: string): Promise<boolean> {
    try {
        const stat = await fs.stat(thumbnailPath)
        return stat.size > 0
    } catch {
        return false
    }
}

async function getFileStats(filePath: string): Promise<{ mtimeMs: number; size: number } | null> {
    try {
        const stat = await fs.stat(filePath)
        return { mtimeMs: stat.mtimeMs, size: stat.size }
    } catch (err) {
        console.error('Failed to stat file:', filePath, err)
        return null
    }
}

function formatDuration(seconds: number): string {
    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)

    if (hours > 0) {
        return `${hours}h ${minutes}m`
    }
    return `${minutes}m`
}

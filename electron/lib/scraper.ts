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

export async function fetchMetadata(movie: any): Promise<any> {
    try {
        // Extract video file metadata using ffprobe
        const videoMeta = await getVideoMetadata(movie.file_path)

        // Generate thumbnail from video
        const thumbnailPath = await generateThumbnail(movie.file_path, movie.id, videoMeta.duration)

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
                duration: metadata.format.duration,
                width: videoStream?.width,
                height: videoStream?.height,
                codec: videoStream?.codec_name,
                size: metadata.format.size
            })
        })
    })
}

async function generateThumbnail(videoPath: string, movieId: number, duration?: number): Promise<string | null> {
    try {
        // Create thumbnails directory if it doesn't exist
        const thumbnailsDir = path.join(app.getPath('userData'), 'thumbnails')
        await fs.ensureDir(thumbnailsDir)

        const thumbnailPath = path.join(thumbnailsDir, `${movieId}.jpg`)

        // If thumbnail already exists, return it
        if (await fs.pathExists(thumbnailPath)) {
            return thumbnailPath
        }

        // Calculate timestamp (10% into the video, or 10 seconds if duration unknown)
        const timestamp = duration ? duration * 0.1 : 10

        return new Promise((resolve, _reject) => {
            ffmpeg(videoPath)
                .screenshots({
                    timestamps: [timestamp],
                    filename: `${movieId}.jpg`,
                    folder: thumbnailsDir,
                    size: '640x?' // Maintain aspect ratio, width 640px
                })
                .on('end', () => {
                    console.log(`Thumbnail generated for movie ${movieId}`)
                    resolve(thumbnailPath)
                })
                .on('error', (err) => {
                    console.error(`Failed to generate thumbnail for movie ${movieId}:`, err)
                    resolve(null) // Return null instead of rejecting
                })
        })
    } catch (error) {
        console.error('Thumbnail generation error:', error)
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

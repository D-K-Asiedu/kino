import { watch, FSWatcher } from 'chokidar'
import path from 'path'
import fs from 'fs-extra'
import * as db from './database'
import { BrowserWindow } from 'electron'
import { fetchMetadata } from './scraper'
import { generateDefaultPlaylists } from './playlists'

let watcher: FSWatcher | null = null

const VIDEO_EXTENSIONS = ['.mkv', '.mp4', '.avi', '.mov', '.wmv']

export function startWatcher() {
    const paths = db.getWatchPaths().map((row: any) => row.path)

    if (paths.length === 0) return

    if (watcher) {
        watcher.close()
    }

    watcher = watch(paths, {
        ignored: /(^|[\/\\])\../, // ignore dotfiles
        persistent: true,
        depth: 5,
        ignoreInitial: true // We handle initial sync manually
    })

    watcher
        .on('add', (filePath) => {
            const ext = path.extname(filePath).toLowerCase()
            if (VIDEO_EXTENSIONS.includes(ext)) {
                handleFileAdd(filePath)
            }
        })
        .on('unlink', (filePath) => {
            handleFileRemove(filePath)
        })

    syncLibrary()
}

function syncLibrary() {
    console.log('Watcher: Syncing library...')
    const movies = db.getMovies()
    const watchPaths = db.getWatchPaths().map((row: any) => row.path)

    // 1. Check for removed files
    let removedCount = 0
    movies.forEach((movie: any) => {
        if (!fs.existsSync(movie.file_path)) {
            console.log('Watcher: Found missing file during sync:', movie.file_path)
            handleFileRemove(movie.file_path)
            removedCount++
        }
    })

    // 2. Check for new files
    let addedCount = 0
    const scanDirectory = (dir: string) => {
        try {
            if (!fs.existsSync(dir)) return

            const files = fs.readdirSync(dir)
            for (const file of files) {
                const fullPath = path.join(dir, file)
                const stat = fs.statSync(fullPath)

                if (stat.isDirectory()) {
                    // Simple recursion limit check could be added here if needed
                    scanDirectory(fullPath)
                } else {
                    const ext = path.extname(fullPath).toLowerCase()
                    if (VIDEO_EXTENSIONS.includes(ext)) {
                        if (!db.movieExists(fullPath)) {
                            console.log('Watcher: Found new file during sync:', fullPath)
                            handleFileAdd(fullPath)
                            addedCount++
                        }
                    }
                }
            }
        } catch (err) {
            console.error('Watcher: Error scanning directory:', dir, err)
        }
    }

    watchPaths.forEach(p => scanDirectory(p))

    // 3. Check for missing thumbnails
    let thumbnailGenCount = 0
    movies.forEach((movie: any) => {
        const hasThumbnail = movie.poster_path && fs.existsSync(movie.poster_path)
        const isInvalidThumbnail = movie.poster_path && movie.poster_path.endsWith('undefined.jpg')

        if (!hasThumbnail || isInvalidThumbnail) {
            console.log('Watcher: Missing or invalid thumbnail for:', movie.title, 'ID:', movie.id)
            thumbnailGenCount++
            fetchMetadata(movie).then((enriched: any) => {
                if (enriched && enriched.poster_path) {
                    db.updateMovie(movie.id, enriched)
                    notifyRenderer('library-updated')
                }
            }).catch((err: any) => console.error('Watcher: Failed to generate thumbnail for', movie.title, err))
        }
    })

    if (addedCount > 0 || removedCount > 0 || thumbnailGenCount > 0) {
        console.log(`Watcher: Sync complete. Removed ${removedCount}, Added ${addedCount}, Generating thumbnails for ${thumbnailGenCount}.`)
        generateDefaultPlaylists()
        notifyRenderer('library-updated')
        notifyRenderer('playlists-updated')
    } else {
        console.log('Watcher: Sync complete. No changes.')
    }
}

export function updateWatcher() {
    startWatcher()
}

function handleFileAdd(filePath: string) {
    console.log('Watcher: File add event detected for:', filePath)
    // Check if already exists
    if (db.movieExists(filePath)) {
        console.log('Watcher: File already exists in DB, skipping:', filePath)
        return
    }

    const filename = path.basename(filePath)
    const parsed = parseFilename(filename)

    const movie = {
        title: parsed.title,
        original_title: parsed.title, // Placeholder
        year: parsed.year,
        plot: '',
        poster_path: '',
        backdrop_path: '',
        rating: 0,
        file_path: filePath
    }

    try {
        const info = db.addMovie(movie)
        notifyRenderer('library-updated')

        // Fetch metadata in background
        const movieWithId = { ...movie, id: info.lastInsertRowid }
        fetchMetadata(movieWithId).then((enriched: any) => {
            if (enriched) {
                db.updateMovie(info.lastInsertRowid, enriched)
                notifyRenderer('library-updated')
            }
        }).catch((err: any) => console.error('Metadata fetch failed:', err))

        // Auto-generate playlists
        generateDefaultPlaylists()
        notifyRenderer('playlists-updated')

    } catch (err) {
        console.error('Failed to add movie:', err)
    }
}

function handleFileRemove(filePath: string) {
    console.log('Watcher: File remove event detected for:', filePath)
    try {
        const result = db.removeMovieByPath(filePath)
        console.log('Watcher: Database removal result:', result)

        // Cleanup empty playlists
        db.deleteEmptyPlaylists()

        notifyRenderer('library-updated')
        notifyRenderer('playlists-updated')
    } catch (err) {
        console.error('Watcher: Failed to remove movie:', err)
    }
}

function parseFilename(filename: string) {
    // Simple parser: "Movie.Name.2023.mkv" -> title: "Movie Name", year: 2023
    const name = filename.replace(/\.[^/.]+$/, "") // remove extension

    const yearMatch = name.match(/(19|20)\d{2}/)
    let year = yearMatch ? parseInt(yearMatch[0]) : undefined

    let title = name
    if (yearMatch) {
        title = name.substring(0, yearMatch.index).trim()
    }

    // Replace dots/underscores with spaces
    title = title.replace(/[._]/g, ' ').trim()

    return { title, year }
}

function notifyRenderer(channel: string, data?: any) {
    const wins = BrowserWindow.getAllWindows()
    wins.forEach(win => win.webContents.send(channel, data))
}

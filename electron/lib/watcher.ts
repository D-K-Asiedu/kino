import { watch, FSWatcher } from 'chokidar'
import path from 'path'
import fs from 'fs-extra'
import * as db from './database'
import { BrowserWindow, app } from 'electron'
import { fetchMetadata } from './scraper'
import { generateDefaultPlaylists } from './playlists'

let watcher: FSWatcher | null = null

const MAX_METADATA_CONCURRENCY = 2
let metadataWorkers = 0
let libraryUpdateTimer: NodeJS.Timeout | null = null
let playlistUpdateTimer: NodeJS.Timeout | null = null
let suppressLibraryUpdates = false
let suppressPlaylistUpdates = false
let pendingLibraryUpdate = false
let pendingPlaylistUpdate = false
let metadataUpdatePending = false

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

    db.resetRunningMetadataJobs()
    void processMetadataQueue()

    void syncLibrary()
}

async function syncLibrary() {
    console.log('Watcher: Syncing library...')
    const movies = db.getMovies()
    const knownMoviePaths = new Set((movies as any[]).map((movie) => movie.file_path as string))
    const watchPaths = db.getWatchPaths().map((row: any) => row.path)
    suppressLibraryUpdates = true
    suppressPlaylistUpdates = true
    if (libraryUpdateTimer) {
        clearTimeout(libraryUpdateTimer)
        libraryUpdateTimer = null
        pendingLibraryUpdate = true
    }
    if (playlistUpdateTimer) {
        clearTimeout(playlistUpdateTimer)
        playlistUpdateTimer = null
        pendingPlaylistUpdate = true
    }

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
    const scanDirectory = async (dir: string) => {
        try {
            if (!fs.existsSync(dir)) return

            const entries = await fs.readdir(dir, { withFileTypes: true })
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name)

                if (entry.isDirectory()) {
                    // Simple recursion limit check could be added here if needed
                    await scanDirectory(fullPath)
                } else if (entry.isFile()) {
                    const ext = path.extname(fullPath).toLowerCase()
                    if (VIDEO_EXTENSIONS.includes(ext)) {
                        if (!knownMoviePaths.has(fullPath)) {
                            console.log('Watcher: Found new file during sync:', fullPath)
                            knownMoviePaths.add(fullPath)
                            handleFileAdd(fullPath, { skipExistsCheck: true })
                            addedCount++
                        }
                    }
                }
            }
        } catch (err) {
            console.error('Watcher: Error scanning directory:', dir, err)
        }
    }

    for (const p of watchPaths) {
        await scanDirectory(p)
    }
    suppressLibraryUpdates = false
    suppressPlaylistUpdates = false
    if (pendingLibraryUpdate) {
        pendingLibraryUpdate = false
        scheduleLibraryUpdate()
    }
    if (pendingPlaylistUpdate) {
        pendingPlaylistUpdate = false
        schedulePlaylistUpdate()
    }

    // 3. Check for missing thumbnails
    let thumbnailGenCount = 0
    movies.forEach((movie: any) => {
        if (!fs.existsSync(movie.file_path)) return

        const stats = getFileStatSnapshot(movie.file_path)
        const fingerprintChanged = stats
            ? movie.file_mtime !== stats.mtimeMs || movie.file_size !== stats.size
            : false

        const hasThumbnail = movie.poster_path && fs.existsSync(movie.poster_path) && isNonEmptyFile(movie.poster_path)
        const isInvalidThumbnail = movie.poster_path && movie.poster_path.endsWith('undefined.jpg')

        if (!hasThumbnail || isInvalidThumbnail || fingerprintChanged) {
            console.log('Watcher: Thumbnail refresh needed for:', movie.title, 'ID:', movie.id)
            thumbnailGenCount++
            enqueueMetadataJob(movie.id, fingerprintChanged)
        }
    })

    if (addedCount > 0 || removedCount > 0 || thumbnailGenCount > 0) {
        console.log(`Watcher: Sync complete. Removed ${removedCount}, Added ${addedCount}, Generating thumbnails for ${thumbnailGenCount}.`)
        scheduleLibraryUpdate()
    } else {
        console.log('Watcher: Sync complete. No changes.')
    }
}

export function updateWatcher() {
    startWatcher()
}

export function triggerMetadataProcessing() {
    void processMetadataQueue()
}

function handleFileAdd(filePath: string, options?: { skipExistsCheck?: boolean }) {
    console.log('Watcher: File add event detected for:', filePath)
    // Check if already exists
    if (!options?.skipExistsCheck && db.movieExists(filePath)) {
        console.log('Watcher: File already exists in DB, skipping:', filePath)
        return
    }

    const filename = path.basename(filePath)
    const parsed = parseFilename(filename)

    const stats = getFileStatSnapshot(filePath)
    const movie = {
        title: parsed.title,
        original_title: parsed.title, // Placeholder
        year: parsed.year,
        plot: '',
        poster_path: '',
        backdrop_path: '',
        rating: 0,
        file_path: filePath,
        file_mtime: stats?.mtimeMs ?? null,
        file_size: stats?.size ?? null,
    }

    try {
        const info = db.addMovie(movie)
        scheduleLibraryUpdate()

        // Fetch metadata in background
        enqueueMetadataJob(info.lastInsertRowid)
        schedulePlaylistUpdate()

    } catch (err) {
        console.error('Failed to add movie:', err)
    }
}

function handleFileRemove(filePath: string) {
    console.log('Watcher: File remove event detected for:', filePath)
    try {
        const movie = db.getMovieByPath(filePath)
        const result = db.removeMovieByPath(filePath)
        console.log('Watcher: Database removal result:', result)
        if (movie?.id) {
            void deleteThumbnailForMovie(movie.id)
        }
        scheduleLibraryUpdate()
        schedulePlaylistUpdate()
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

function scheduleLibraryUpdate() {
    if (suppressLibraryUpdates) {
        pendingLibraryUpdate = true
        return
    }

    if (libraryUpdateTimer) return
    libraryUpdateTimer = setTimeout(() => {
        libraryUpdateTimer = null
        if (pendingLibraryUpdate) {
            pendingLibraryUpdate = false
        }
        notifyRenderer('library-updated')
    }, 250)
}

function schedulePlaylistUpdate() {
    if (suppressPlaylistUpdates) {
        pendingPlaylistUpdate = true
        return
    }

    if (playlistUpdateTimer) return
    playlistUpdateTimer = setTimeout(() => {
        playlistUpdateTimer = null
        const result = generateDefaultPlaylists()
        if (result.created > 0 || result.added > 0) {
            console.log(`Watcher: Playlist sync generated ${result.created} playlists and added ${result.added} entries.`)
        }
        notifyRenderer('playlists-updated')
    }, 250)
}

function enqueueMetadataJob(id: number | bigint, force = false) {
    db.enqueueMetadataJob(id, force)
    void processMetadataQueue()
}

async function processMetadataQueue() {
    while (metadataWorkers < MAX_METADATA_CONCURRENCY) {
        const job = db.claimNextMetadataJob()
        if (!job) return

        const movie = db.getMovieById(job.movie_id)
        if (!movie) {
            db.completeMetadataJob(job.movie_id)
            continue
        }

        metadataWorkers++
        fetchMetadata(movie, { forceThumbnail: !!job.force })
            .then((enriched: any) => {
                if (enriched) {
                    db.updateMovie(movie.id, enriched)
                    metadataUpdatePending = true
                }
                db.completeMetadataJob(movie.id)
            })
            .catch((err: any) => {
                console.error('Metadata fetch failed:', err)
                db.failMetadataJob(movie.id, String(err?.message || err))
            })
            .finally(() => {
                metadataWorkers--
                if (metadataWorkers === 0 && metadataUpdatePending) {
                    metadataUpdatePending = false
                    scheduleLibraryUpdate()
                }
                void processMetadataQueue()
            })
    }
}

function getFileStatSnapshot(filePath: string): { mtimeMs: number; size: number } | null {
    try {
        const stat = fs.statSync(filePath)
        return { mtimeMs: stat.mtimeMs, size: stat.size }
    } catch {
        return null
    }
}

function isNonEmptyFile(filePath: string): boolean {
    try {
        const stat = fs.statSync(filePath)
        return stat.size > 0
    } catch {
        return false
    }
}

async function deleteThumbnailForMovie(movieId: number | bigint) {
    try {
        const thumbnailsDir = path.join(app.getPath('userData'), 'thumbnails')
        const thumbnailPath = path.join(thumbnailsDir, `${movieId}.jpg`)
        await fs.remove(thumbnailPath)
    } catch (err) {
        console.error('Failed to delete thumbnail for movie', movieId, err)
    }
}

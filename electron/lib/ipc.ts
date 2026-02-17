import { ipcMain, dialog } from 'electron'
import * as db from './database'
import { updateWatcher } from './watcher'
import {
    getSecureStatus,
    setSecurePassword,
    unlockSecure,
    lockSecure,
    resetSecure,
    listSecureItems,
    importMovieToSecure,
    importMovieWithPassword,
    prepareSecurePlayback,
    releaseSecurePlayback,
    deleteSecureItem
} from './secure'
import { BrowserWindow } from 'electron'

function notifyRenderer(channel: string, data?: any) {
    const wins = BrowserWindow.getAllWindows()
    wins.forEach(win => win.webContents.send(channel, data))
}

export function registerIPC() {
    ipcMain.handle('db:get-library', () => db.getMovies())
    ipcMain.handle('db:add-movie', (_, movie) => db.addMovie(movie))
    ipcMain.handle('db:get-watch-paths', () => db.getWatchPaths())
    ipcMain.handle('db:add-watch-path', (_, path) => db.addWatchPath(path))
    ipcMain.handle('db:remove-watch-path', (_, id) => {
        // Get the watch path before removing it
        const watchPath = db.getWatchPathById(id)
        if (watchPath) {
            // Remove all movies from this watch path
            db.removeMoviesByWatchPath(watchPath.path)
            console.log(`Removed movies from watch path: ${watchPath.path}`)
        }
        return db.removeWatchPath(id)
    })
    ipcMain.handle('settings:get', (_, key) => db.getSetting(key))
    ipcMain.handle('settings:set', (_, key, value) => db.setSetting(key, value))

    // Playlist handlers
    ipcMain.handle('db:create-playlist', (_, name) => {
        // When manually creating a playlist, clear it from deleted list if it was there
        db.clearDeletedFolderPlaylist(name)
        return db.createPlaylist(name)
    })
    ipcMain.handle('db:get-playlists', () => db.getPlaylists())
    ipcMain.handle('db:delete-playlist', (_, id) => {
        // Get playlist name before deletion to track it
        const playlist = db.getPlaylistById(id)
        if (playlist) {
            // Mark this folder name as deleted so it won't be auto-regenerated
            db.markFolderPlaylistDeleted(playlist.name)
            console.log(`Playlist "${playlist.name}" marked as deleted (won't auto-regenerate)`)
        }
        return db.deletePlaylist(id)
    })
    ipcMain.handle('db:add-movie-to-playlist', (_, playlistId, movieId) => db.addMovieToPlaylist(playlistId, movieId))
    ipcMain.handle('db:remove-movie-from-playlist', (_, playlistId, movieId) => db.removeMovieFromPlaylist(playlistId, movieId))
    ipcMain.handle('db:get-playlist-movies', (_, playlistId) => db.getPlaylistMovies(playlistId))

    // Playback Progress handlers
    ipcMain.handle('db:update-playback-progress', (_, movieId, progress) => db.updatePlaybackProgress(movieId, progress))
    ipcMain.handle('db:get-playback-progress', (_, movieId) => db.getPlaybackProgress(movieId))

    ipcMain.handle('db:generate-default-playlists', async () => {
        const { generateDefaultPlaylists } = await import('./playlists')
        return generateDefaultPlaylists()
    })

    ipcMain.handle('dialog:open-directory', async () => {
        const result = await dialog.showOpenDialog({
            properties: ['openDirectory']
        })
        return result.canceled ? null : result.filePaths[0]
    })

    ipcMain.handle('watcher:update', () => {
        updateWatcher()
    })

    ipcMain.handle('thumbnails:regenerate', async () => {
        const { fetchMetadata } = await import('./scraper')
        const movies = db.getMovies()

        console.log(`Regenerating thumbnails for ${movies.length} movies...`)

        let successCount = 0
        for (const movie of movies) {
            try {
                const enriched = await fetchMetadata(movie as any)
                if (enriched && enriched.poster_path) {
                    db.updateMovie((movie as any).id, enriched)
                    successCount++
                }
            } catch (err) {
                console.error(`Failed to generate thumbnail for ${(movie as any).title}:`, err)
            }
        }

        console.log(`Generated ${successCount} thumbnails`)
        return { total: movies.length, success: successCount }
    })
    ipcMain.handle('media:get-metadata', async (_, filePath) => {
        const { getMediaMetadata } = await import('./ffmpeg')
        return getMediaMetadata(filePath)
    })

    ipcMain.handle('media:extract-subtitle', async (_, filePath, trackIndex) => {
        const { extractSubtitle } = await import('./ffmpeg')
        return extractSubtitle(filePath, trackIndex)
    })

    ipcMain.handle('media:extract-subtitle-content', async (_, filePath, trackIndex) => {
        const { extractSubtitleContent } = await import('./ffmpeg')
        return extractSubtitleContent(filePath, trackIndex)
    })

    // Secure folder handlers
    ipcMain.handle('secure:status', () => getSecureStatus())
    ipcMain.handle('secure:set-password', async (_, password: string) => {
        setSecurePassword(password)
        return { ok: true }
    })
    ipcMain.handle('secure:unlock', async (_, password: string) => {
        unlockSecure(password)
        return { ok: true }
    })
    ipcMain.handle('secure:lock', async () => {
        await lockSecure()
        return { ok: true }
    })
    ipcMain.handle('secure:reset', async () => {
        await resetSecure()
        return { ok: true }
    })
    ipcMain.handle('secure:list', async () => {
        return listSecureItems()
    })
    ipcMain.handle('secure:import-movie', async (_, movie: any) => {
        try {
            await importMovieToSecure(movie)
            notifyRenderer('library-updated')
            notifyRenderer('playlists-updated')
            return { ok: true }
        } catch (err: any) {
            throw new Error(err?.message || 'Secure import failed')
        }
    })
    ipcMain.handle('secure:import-movie-with-password', async (_, movie: any, password: string) => {
        try {
            await importMovieWithPassword(movie, password)
            notifyRenderer('library-updated')
            notifyRenderer('playlists-updated')
            return { ok: true }
        } catch (err: any) {
            throw new Error(err?.message || 'Secure import failed')
        }
    })
    ipcMain.handle('secure:prepare-playback', async (_, itemId: number) => {
        return prepareSecurePlayback(itemId)
    })
    ipcMain.handle('secure:release-playback', async (_, tempPath: string) => {
        await releaseSecurePlayback(tempPath)
        return { ok: true }
    })
    ipcMain.handle('secure:delete-item', async (_, itemId: number) => {
        await deleteSecureItem(itemId)
        return { ok: true }
    })
}

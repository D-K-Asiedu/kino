import { ipcMain, dialog, app, shell } from 'electron'
import * as db from './database'
import path from 'path'
import { updateWatcher, triggerMetadataProcessing, pruneMoviesOutsideWatchPaths, addLibraryFile } from './watcher'
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
    deleteSecureItem,
    getSecureThumbnail,
    restoreSecureItem
} from './secure'
import { BrowserWindow } from 'electron'

function notifyRenderer(channel: string, data?: any) {
    const wins = BrowserWindow.getAllWindows()
    wins.forEach(win => win.webContents.send(channel, data))
}

export function registerIPC() {
    ipcMain.handle('db:get-library', () => db.getMovies())
    ipcMain.handle('db:get-library-page', (_, query) => db.getLibraryPage(query))
    ipcMain.handle('db:add-movie', (_, movie) => db.addMovie(movie))
    ipcMain.handle('db:get-watch-paths', () => db.getWatchPaths())
    ipcMain.handle('db:add-watch-path', (_, path) => db.addWatchPath(path))
    ipcMain.handle('db:remove-watch-path', (_, id) => {
        const result = db.removeWatchPath(id)
        // Movies still covered by another (overlapping) watch folder are kept
        pruneMoviesOutsideWatchPaths()
        return result
    })
    ipcMain.handle('settings:get', (_, key) => db.getSetting(key))
    ipcMain.handle('settings:set', (_, key, value) => db.setSetting(key, value))
    ipcMain.handle('db:get-home-data', () => db.getHomeData())
    ipcMain.handle('db:get-shows', () => db.getShows())
    ipcMain.handle('db:get-folder', (_, folderPath: string | null) => db.getFolderContents(folderPath))
    // Takes a library video's id rather than a path, so the renderer can only reveal library files.
    ipcMain.handle('shell:show-video-in-folder', (_, movieId: number) => {
        const movie = db.getMovieById(Number(movieId))
        if (!movie?.file_path) return false
        shell.showItemInFolder(movie.file_path)
        return true
    })
    ipcMain.handle('db:get-show-episodes', (_, showTitle: string) => db.getShowEpisodes(String(showTitle)))

    // Playlist handlers
    ipcMain.handle('db:create-playlist', (_, name) => {
        // When manually creating a playlist, clear it from deleted list if it was there
        db.clearDeletedFolderPlaylist(name)
        const result = db.createPlaylist(name)
        notifyRenderer('playlists-updated')
        return result
    })
    ipcMain.handle('db:get-playlists', () => db.getPlaylists())
    ipcMain.handle('db:get-playlists-overview', () => db.getPlaylistsOverview())
    ipcMain.handle('db:delete-playlist', (_, id) => {
        // Get playlist name before deletion to track it
        const playlist = db.getPlaylistById(id)
        if (playlist) {
            // Mark this folder name as deleted so it won't be auto-regenerated
            db.markFolderPlaylistDeleted(playlist.name)
            console.log(`Playlist "${playlist.name}" marked as deleted (won't auto-regenerate)`)
        }
        const result = db.deletePlaylist(id)
        notifyRenderer('playlists-updated')
        return result
    })
    ipcMain.handle('db:add-movie-to-playlist', (_, playlistId, movieId) => {
        const result = db.addMovieToPlaylist(playlistId, movieId)
        notifyRenderer('playlists-updated')
        return result
    })
    ipcMain.handle('db:remove-movie-from-playlist', (_, playlistId, movieId) => {
        const result = db.removeMovieFromPlaylist(playlistId, movieId)
        notifyRenderer('playlists-updated')
        return result
    })
    ipcMain.handle('db:get-playlist-movies', (_, playlistId) => db.getPlaylistMovies(playlistId))
    ipcMain.handle('db:update-playlist-last-watched', (_, playlistId) => db.updatePlaylistLastWatched(playlistId))

    // Video progress handlers
    ipcMain.handle('db:get-playback-progress', (_, movieId) => db.getPlaybackProgress(movieId))
    ipcMain.handle('db:update-playback-progress', (_, movieId, progress, duration) => {
        const result = db.updatePlaybackProgress(movieId, progress, duration)
        notifyRenderer('playback-progress-updated', { movieId, progress, duration })
        return result
    })

    ipcMain.handle('db:generate-default-playlists', async () => {
        const { generateDefaultPlaylists } = await import('./playlists')
        const result = await generateDefaultPlaylists()
        notifyRenderer('playlists-updated')
        return result
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
        const movies = db.getMovies()
        console.log(`Queueing thumbnail regeneration for ${movies.length} movies...`)

        for (const movie of movies) {
            if ((movie as any).id) {
                db.enqueueMetadataJob((movie as any).id, true)
            }
        }

        triggerMetadataProcessing()

        return { total: movies.length, queued: movies.length }
    })
    ipcMain.handle('thumbnails:regenerate-one', async (_, movieId: number) => {
        if (!movieId) return { queued: 0 }
        db.enqueueMetadataJob(movieId, true)
        triggerMetadataProcessing()
        return { queued: 1 }
    })
    ipcMain.handle('media:get-playback-info', async (_, filePath) => {
        const { getPlaybackInfo } = await import('./media')
        return getPlaybackInfo(filePath)
    })

    ipcMain.handle('media:set-decoder-support', async (_, support: unknown) => {
        const { setDecoderSupport } = await import('./media')
        setDecoderSupport(support)
    })

    ipcMain.handle('media:force-conversion', async (_, filePath: string) => {
        const { forceConversion } = await import('./media')
        return forceConversion(filePath)
    })

    ipcMain.handle('media:resolve-stream-start', async (_, filePath: string, start: number) => {
        const { resolveStreamStart } = await import('./media')
        return resolveStreamStart(filePath, start)
    })

    ipcMain.handle('media:stop-streams', async () => {
        const { stopAllStreams } = await import('./streaming')
        const { removePrivateSubtitles } = await import('./subtitles')
        stopAllStreams()
        void removePrivateSubtitles()
    })

    ipcMain.handle('media:get-metadata', async (_, filePath) => {
        const { getMediaMetadata } = await import('./ffmpeg')
        return getMediaMetadata(filePath)
    })

    ipcMain.handle('media:get-subtitle', async (_, filePath: string, trackId: string, plainText?: boolean) => {
        const { getSubtitle } = await import('./subtitles')
        return getSubtitle(filePath, String(trackId), plainText === true)
    })

    ipcMain.handle('media:prefetch-subtitles', async (_, filePath) => {
        const { prefetchSubtitles } = await import('./subtitles')
        prefetchSubtitles(filePath)
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
    ipcMain.handle('secure:restore-item', async (event, itemId: number) => {
        const result = await restoreSecureItem(itemId, async (originalName) => {
            const libraryFolder = (db.getWatchPaths() as { path: string }[])[0]?.path
            const options: Electron.SaveDialogOptions = {
                title: 'Restore video',
                buttonLabel: 'Restore',
                defaultPath: path.join(libraryFolder ?? app.getPath('videos'), originalName),
            }
            const win = BrowserWindow.fromWebContents(event.sender)
            const choice = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
            return choice.canceled ? null : choice.filePath ?? null
        })
        if (!result) return { canceled: true }
        const inLibrary = addLibraryFile(result.filePath)
        return { canceled: false, filePath: result.filePath, inLibrary }
    })
    ipcMain.handle('secure:get-thumbnail', async (_, itemId: number) => {
        const path = await getSecureThumbnail(itemId)
        return { path }
    })
}

import path from 'path'
import * as db from './database'

interface Movie {
    id: number
    file_path: string
    [key: string]: any
}

interface Playlist {
    id: number
    name: string
    [key: string]: any
}

export function generateDefaultPlaylists() {
    const movies = db.getMovies() as Movie[]
    const playlists = db.getPlaylists() as Playlist[]
    const playlistMap = new Map(playlists.map(p => [p.name, p.id]))
    
    // Get list of folder names that user has explicitly deleted
    const deletedFolders = new Set(db.getAllDeletedFolderPlaylists())

    const groupedMovies = new Map<string, Movie[]>()

    // Group movies by parent folder
    for (const movie of movies) {
        const dirPath = path.dirname(movie.file_path)
        const folderName = path.basename(dirPath)

        if (!groupedMovies.has(folderName)) {
            groupedMovies.set(folderName, [])
        }
        groupedMovies.get(folderName)?.push(movie)
    }

    let createdCount = 0
    let addedCount = 0

    // Create playlists and add movies
    for (const [folderName, group] of groupedMovies) {
        // Skip if folder has only 1 movie (optional, but good for noise reduction)
        if (group.length < 2) continue
        
        // Skip if user has explicitly deleted this folder's playlist
        if (deletedFolders.has(folderName)) {
            console.log(`Skipping deleted folder playlist: ${folderName}`)
            continue
        }

        let playlistId = playlistMap.get(folderName)

        if (!playlistId) {
            db.createPlaylist(folderName)
            // Re-fetch to get ID (a bit inefficient but safe)
            const newPlaylist = (db.getPlaylists() as Playlist[]).find(p => p.name === folderName)
            if (newPlaylist) {
                playlistId = newPlaylist.id
                playlistMap.set(folderName, playlistId)
                createdCount++
            }
        }

        if (playlistId) {
            for (const movie of group) {
                db.addMovieToPlaylist(playlistId, movie.id)
                addedCount++
            }
        }
    }

    // Cleanup any empty playlists that might exist
    db.deleteEmptyPlaylists()

    return { created: createdCount, added: addedCount }
}

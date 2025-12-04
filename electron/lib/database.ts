import Database from 'better-sqlite3'
import path from 'path'
import { app } from 'electron'

// Defer database initialization until app is ready
let db: Database.Database | null = null
let dbPath: string | null = null

function getDB(): Database.Database {
  if (!db) {
    dbPath = path.join(app.getPath('userData'), 'kino.db')
    db = new Database(dbPath)
    db.pragma('foreign_keys = ON')
  }
  return db
}

export function initDB() {
  getDB().exec(`
    CREATE TABLE IF NOT EXISTS movies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      original_title TEXT,
      year INTEGER,
      plot TEXT,
      poster_path TEXT,
      backdrop_path TEXT,
      rating REAL,
      file_path TEXT UNIQUE NOT NULL,
      added_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS watch_paths (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT UNIQUE NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
    CREATE TABLE IF NOT EXISTS playlists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS playlist_movies (
      playlist_id INTEGER,
      movie_id INTEGER,
      added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (playlist_id, movie_id),
      FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE,
      FOREIGN KEY (movie_id) REFERENCES movies(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS playback_progress (
      movie_id INTEGER PRIMARY KEY,
      progress REAL NOT NULL,
      last_watched DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (movie_id) REFERENCES movies(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS deleted_folder_playlists (
      folder_name TEXT PRIMARY KEY,
      deleted_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `)
}

export function getMovies() {
  return getDB().prepare('SELECT * FROM movies ORDER BY added_at DESC').all()
}

export function movieExists(filePath: string): boolean {
  const result = getDB().prepare('SELECT 1 FROM movies WHERE file_path = ?').get(filePath)
  return !!result
}

export function addMovie(movie: any) {
  const stmt = getDB().prepare(`
    INSERT OR IGNORE INTO movies (title, original_title, year, plot, poster_path, backdrop_path, rating, file_path)
    VALUES (@title, @original_title, @year, @plot, @poster_path, @backdrop_path, @rating, @file_path)
  `)
  return stmt.run(movie)
}

export function getWatchPaths() {
  return getDB().prepare('SELECT * FROM watch_paths').all()
}

export function addWatchPath(watchPath: string) {
  const stmt = getDB().prepare('INSERT OR IGNORE INTO watch_paths (path) VALUES (?)')
  return stmt.run(watchPath)
}

export function removeWatchPath(id: number) {
  return getDB().prepare('DELETE FROM watch_paths WHERE id = ?').run(id)
}

export function getSetting(key: string) {
  const row = getDB().prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
  return row ? row.value : null
}

export function setSetting(key: string, value: string) {
  const stmt = getDB().prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
  return stmt.run(key, value)
}

export function updateMovie(id: number | bigint, movie: any) {
  const stmt = getDB().prepare(`
    UPDATE movies
    SET title = @title,
        original_title = @original_title,
        year = @year,
        plot = @plot,
        poster_path = @poster_path,
        backdrop_path = @backdrop_path,
        rating = @rating
    WHERE id = @id
  `)
  return stmt.run({ ...movie, id })
}

export function removeMovieByPath(filePath: string) {
  console.log('Database: Attempting to remove movie with path:', filePath)
  const result = getDB().prepare('DELETE FROM movies WHERE file_path = ?').run(filePath)
  console.log('Database: Removal result:', result)
  return result
}

export function removeMoviesByWatchPath(watchPath: string) {
  // Normalize the path and add trailing separator to ensure we match the exact folder
  const normalizedPath = watchPath.endsWith(path.sep) ? watchPath : watchPath + path.sep
  console.log('Database: Removing movies from watch path:', normalizedPath)
  
  // Use LIKE with escape for paths starting with the watch path
  const result = getDB().prepare(`
    DELETE FROM movies 
    WHERE file_path LIKE ? ESCAPE '\\'
       OR file_path = ?
  `).run(`${normalizedPath.replace(/[%_]/g, '\\$&')}%`, watchPath)
  
  console.log('Database: Removed', result.changes, 'movies from watch path')
  return result
}

export function getWatchPathById(id: number) {
  return getDB().prepare('SELECT * FROM watch_paths WHERE id = ?').get(id) as { id: number; path: string } | undefined
}

// Playlist functions
export function createPlaylist(name: string) {
  return getDB().prepare('INSERT INTO playlists (name) VALUES (?)').run(name)
}

export function getPlaylists() {
  return getDB().prepare('SELECT * FROM playlists ORDER BY created_at DESC').all()
}

export function getPlaylistById(id: number) {
  return getDB().prepare('SELECT * FROM playlists WHERE id = ?').get(id) as { id: number; name: string; created_at: string } | undefined
}

export function deletePlaylist(id: number) {
  return getDB().prepare('DELETE FROM playlists WHERE id = ?').run(id)
}

// Deleted folder playlists tracking (prevents auto-regeneration)
export function markFolderPlaylistDeleted(folderName: string) {
  return getDB().prepare('INSERT OR REPLACE INTO deleted_folder_playlists (folder_name) VALUES (?)').run(folderName)
}

export function isFolderPlaylistDeleted(folderName: string): boolean {
  const result = getDB().prepare('SELECT 1 FROM deleted_folder_playlists WHERE folder_name = ?').get(folderName)
  return !!result
}

export function clearDeletedFolderPlaylist(folderName: string) {
  return getDB().prepare('DELETE FROM deleted_folder_playlists WHERE folder_name = ?').run(folderName)
}

export function getAllDeletedFolderPlaylists(): string[] {
  const rows = getDB().prepare('SELECT folder_name FROM deleted_folder_playlists').all() as { folder_name: string }[]
  return rows.map(r => r.folder_name)
}

export function deleteEmptyPlaylists() {
  const result = getDB().prepare(`
    DELETE FROM playlists 
    WHERE id NOT IN (SELECT DISTINCT playlist_id FROM playlist_movies)
  `).run()
  if (result.changes > 0) {
    console.log(`Database: Deleted ${result.changes} empty playlists`)
  }
  return result
}

export function addMovieToPlaylist(playlistId: number, movieId: number) {
  return getDB().prepare('INSERT OR IGNORE INTO playlist_movies (playlist_id, movie_id) VALUES (?, ?)').run(playlistId, movieId)
}

export function removeMovieFromPlaylist(playlistId: number, movieId: number) {
  return getDB().prepare('DELETE FROM playlist_movies WHERE playlist_id = ? AND movie_id = ?').run(playlistId, movieId)
}

export function getPlaylistMovies(playlistId: number) {
  return getDB().prepare(`
    SELECT m.*, pm.added_at as playlist_added_at
    FROM movies m
    JOIN playlist_movies pm ON m.id = pm.movie_id
    WHERE pm.playlist_id = ?
    ORDER BY pm.added_at DESC
  `).all(playlistId)
}

// Playback Progress functions
export function updatePlaybackProgress(movieId: number, progress: number) {
  const stmt = getDB().prepare(`
    INSERT OR REPLACE INTO playback_progress (movie_id, progress, last_watched)
    VALUES (?, ?, CURRENT_TIMESTAMP)
  `)
  return stmt.run(movieId, progress)
}

export function getPlaybackProgress(movieId: number) {
  const row = getDB().prepare('SELECT progress FROM playback_progress WHERE movie_id = ?').get(movieId) as { progress: number } | undefined
  return row ? row.progress : 0
}

// Export getDB for direct access if needed
export { getDB }
export default getDB

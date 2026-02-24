import Database from 'better-sqlite3'
import path from 'path'
import { app } from 'electron'

// Defer database initialization until app is ready
let db: Database.Database | null = null
let dbPath: string | null = null
const statementCache = new Map<string, Database.Statement>()

function cachedStmt<T extends Database.Statement = Database.Statement>(sql: string): T {
  let statement = statementCache.get(sql)
  if (!statement) {
    statement = getDB().prepare(sql)
    statementCache.set(sql, statement)
  }
  return statement as T
}

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
      file_mtime INTEGER,
      file_size INTEGER,
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

    CREATE TABLE IF NOT EXISTS secure_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      original_title TEXT,
      year INTEGER,
      plot TEXT,
      poster_path TEXT,
      backdrop_path TEXT,
      rating REAL,
      original_name TEXT NOT NULL,
      encrypted_path TEXT UNIQUE NOT NULL,
      added_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS metadata_jobs (
      movie_id INTEGER PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      force INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (movie_id) REFERENCES movies(id) ON DELETE CASCADE
    );
  `)

  ensureMovieColumns()
  ensurePlaybackProgressColumns()
  ensureIndexes()
}

function ensurePlaybackProgressColumns() {
  const columns = getDB().prepare('PRAGMA table_info(playback_progress)').all() as { name: string }[]
  const names = new Set(columns.map(col => col.name))

  if (!names.has('duration')) {
    getDB().exec('ALTER TABLE playback_progress ADD COLUMN duration REAL DEFAULT 0')
  }

  ensurePlaylistColumns()
}

function ensureMovieColumns() {
  const columns = getDB().prepare('PRAGMA table_info(movies)').all() as { name: string }[]
  const names = new Set(columns.map(col => col.name))

  if (!names.has('file_mtime')) {
    getDB().exec('ALTER TABLE movies ADD COLUMN file_mtime INTEGER')
  }
  if (!names.has('file_size')) {
    getDB().exec('ALTER TABLE movies ADD COLUMN file_size INTEGER')
  }
}

function ensureIndexes() {
  getDB().exec(`
    CREATE INDEX IF NOT EXISTS idx_movies_added_at ON movies (added_at DESC);
    CREATE INDEX IF NOT EXISTS idx_movies_title_nocase ON movies (title COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS idx_playlists_created_at ON playlists (created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_playlists_last_watched ON playlists (last_watched DESC);
    CREATE INDEX IF NOT EXISTS idx_playlist_movies_movie_id ON playlist_movies (movie_id);
    CREATE INDEX IF NOT EXISTS idx_playlist_movies_playlist_added ON playlist_movies (playlist_id, added_at DESC);
    CREATE INDEX IF NOT EXISTS idx_playback_progress_last_watched ON playback_progress (last_watched DESC);
    CREATE INDEX IF NOT EXISTS idx_metadata_jobs_status_updated ON metadata_jobs (status, updated_at);
  `)
}

export function getMovies() {
  return cachedStmt('SELECT * FROM movies ORDER BY added_at DESC').all()
}

interface LibraryPageQuery {
  searchQuery?: string
  filterBy?: string
  sortBy?: string
  limit?: number
  offset?: number
}

export function getLibraryPage(query?: LibraryPageQuery) {
  const limit = Math.max(1, Math.min(200, Number(query?.limit ?? 120)))
  const offset = Math.max(0, Number(query?.offset ?? 0))
  const searchQuery = String(query?.searchQuery ?? '').trim().toLowerCase()
  const filterBy = String(query?.filterBy ?? 'all')
  const sortBy = String(query?.sortBy ?? 'recent')

  const whereClauses: string[] = []
  const whereArgs: Array<string | number> = []

  if (searchQuery) {
    whereClauses.push('LOWER(title) LIKE ?')
    whereArgs.push(`%${searchQuery}%`)
  }

  switch (filterBy) {
    case 'rated':
      whereClauses.push('rating IS NOT NULL')
      break
    case 'unrated':
      whereClauses.push('rating IS NULL')
      break
    case 'year-2020s':
      whereClauses.push('year >= 2020')
      break
    case 'year-2010s':
      whereClauses.push('year BETWEEN 2010 AND 2019')
      break
    case 'year-2000s':
      whereClauses.push('year BETWEEN 2000 AND 2009')
      break
    case 'year-1990s':
      whereClauses.push('year BETWEEN 1990 AND 1999')
      break
    case 'year-1980s':
      whereClauses.push('year BETWEEN 1980 AND 1989')
      break
    case 'year-older':
      whereClauses.push('year < 1980')
      break
    default:
      break
  }

  const orderBySql = (() => {
    switch (sortBy) {
      case 'title-asc':
        return 'title COLLATE NOCASE ASC'
      case 'title-desc':
        return 'title COLLATE NOCASE DESC'
      case 'year-desc':
        return 'year DESC, added_at DESC'
      case 'year-asc':
        return 'year ASC, added_at DESC'
      case 'rating-desc':
        return 'rating DESC, added_at DESC'
      case 'rating-asc':
        return 'rating ASC, added_at DESC'
      case 'recent':
      default:
        return 'added_at DESC'
    }
  })()

  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : ''
  const countSql = `SELECT COUNT(*) as count FROM movies ${whereSql}`
  const itemsSql = `
    SELECT *
    FROM movies
    ${whereSql}
    ORDER BY ${orderBySql}
    LIMIT ? OFFSET ?
  `

  const total = ((getDB().prepare(countSql).get(...whereArgs) as { count: number } | undefined)?.count) ?? 0
  const items = getDB().prepare(itemsSql).all(...whereArgs, limit, offset)
  const nextOffset = offset + items.length

  return {
    items,
    total,
    limit,
    offset,
    hasMore: nextOffset < total,
    nextOffset,
  }
}

export function movieExists(filePath: string): boolean {
  const result = cachedStmt('SELECT 1 FROM movies WHERE file_path = ?').get(filePath)
  return !!result
}

export function addMovie(movie: any) {
  const stmt = cachedStmt(`
    INSERT OR IGNORE INTO movies (title, original_title, year, plot, poster_path, backdrop_path, rating, file_path, file_mtime, file_size)
    VALUES (@title, @original_title, @year, @plot, @poster_path, @backdrop_path, @rating, @file_path, @file_mtime, @file_size)
  `)
  return stmt.run(movie)
}

export function getWatchPaths() {
  return cachedStmt('SELECT * FROM watch_paths').all()
}

export function addWatchPath(watchPath: string) {
  const stmt = cachedStmt('INSERT OR IGNORE INTO watch_paths (path) VALUES (?)')
  return stmt.run(watchPath)
}

export function removeWatchPath(id: number) {
  return cachedStmt('DELETE FROM watch_paths WHERE id = ?').run(id)
}

export function getSetting(key: string) {
  const row = cachedStmt('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
  return row ? row.value : null
}

export function setSetting(key: string, value: string) {
  const stmt = cachedStmt('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
  return stmt.run(key, value)
}

export function removeSetting(key: string) {
  const stmt = cachedStmt('DELETE FROM settings WHERE key = ?')
  return stmt.run(key)
}

export function updateMovie(id: number | bigint, movie: any) {
  const stmt = cachedStmt(`
    UPDATE movies
    SET title = @title,
        original_title = @original_title,
        year = @year,
        plot = @plot,
        poster_path = @poster_path,
        backdrop_path = @backdrop_path,
        rating = @rating,
        file_mtime = @file_mtime,
        file_size = @file_size
    WHERE id = @id
  `)
  return stmt.run({ ...movie, id })
}

export function getMovieById(id: number | bigint) {
  return cachedStmt('SELECT * FROM movies WHERE id = ?').get(id) as any | undefined
}

export function getMovieByPath(filePath: string) {
  return cachedStmt('SELECT * FROM movies WHERE file_path = ?').get(filePath) as any | undefined
}

export function getMoviesByWatchPath(watchPath: string) {
  const normalizedPath = watchPath.endsWith(path.sep) ? watchPath : watchPath + path.sep
  return getDB().prepare(`
    SELECT * FROM movies
    WHERE file_path LIKE ? ESCAPE '\\'
       OR file_path = ?
  `).all(`${normalizedPath.replace(/[%_]/g, '\\$&')}%`, watchPath)
}

export function removeMovieByPath(filePath: string) {
  console.log('Database: Attempting to remove movie with path:', filePath)
  const result = cachedStmt('DELETE FROM movies WHERE file_path = ?').run(filePath)
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

export function enqueueMetadataJob(movieId: number | bigint, force = false) {
  const stmt = cachedStmt(`
    INSERT INTO metadata_jobs (movie_id, status, attempts, force, updated_at)
    VALUES (?, 'pending', 0, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(movie_id) DO UPDATE SET
      status = 'pending',
      attempts = 0,
      force = excluded.force,
      updated_at = CURRENT_TIMESTAMP
  `)
  return stmt.run(movieId, force ? 1 : 0)
}

export function claimNextMetadataJob() {
  const claim = getDB().transaction(() => {
    const job = cachedStmt(`
      SELECT * FROM metadata_jobs
      WHERE status = 'pending'
      ORDER BY updated_at ASC
      LIMIT 1
    `).get() as any | undefined

    if (!job) return undefined

    cachedStmt(`
      UPDATE metadata_jobs
      SET status = 'running', attempts = attempts + 1, updated_at = CURRENT_TIMESTAMP
      WHERE movie_id = ?
    `).run(job.movie_id)

    return job
  })

  return claim()
}

export function completeMetadataJob(movieId: number | bigint) {
  return cachedStmt('DELETE FROM metadata_jobs WHERE movie_id = ?').run(movieId)
}

export function failMetadataJob(movieId: number | bigint, error: string) {
  return cachedStmt(`
    UPDATE metadata_jobs
    SET status = 'failed', last_error = ?, updated_at = CURRENT_TIMESTAMP
    WHERE movie_id = ?
  `).run(error, movieId)
}

export function resetRunningMetadataJobs() {
  return cachedStmt(`
    UPDATE metadata_jobs
    SET status = 'pending', updated_at = CURRENT_TIMESTAMP
    WHERE status = 'running'
  `).run()
}

export function getWatchPathById(id: number) {
  return cachedStmt('SELECT * FROM watch_paths WHERE id = ?').get(id) as { id: number; path: string } | undefined
}

// Playlist functions
export function ensurePlaylistColumns() {
  const columns = getDB().prepare('PRAGMA table_info(playlists)').all() as { name: string }[]
  const names = new Set(columns.map(col => col.name))

  if (!names.has('last_watched')) {
    getDB().exec('ALTER TABLE playlists ADD COLUMN last_watched DATETIME')
  }
}

export function createPlaylist(name: string) {
  return cachedStmt('INSERT INTO playlists (name) VALUES (?)').run(name)
}

export function getPlaylists() {
  return cachedStmt('SELECT * FROM playlists ORDER BY created_at DESC').all()
}

export function updatePlaylistLastWatched(id: number) {
  const stmt = cachedStmt('UPDATE playlists SET last_watched = CURRENT_TIMESTAMP WHERE id = ?')
  return stmt.run(id)
}

export function getPlaylistById(id: number) {
  return cachedStmt('SELECT * FROM playlists WHERE id = ?').get(id) as { id: number; name: string; created_at: string } | undefined
}

export function deletePlaylist(id: number) {
  return cachedStmt('DELETE FROM playlists WHERE id = ?').run(id)
}

// Deleted folder playlists tracking (prevents auto-regeneration)
export function markFolderPlaylistDeleted(folderName: string) {
  return cachedStmt('INSERT OR REPLACE INTO deleted_folder_playlists (folder_name) VALUES (?)').run(folderName)
}

export function isFolderPlaylistDeleted(folderName: string): boolean {
  const result = cachedStmt('SELECT 1 FROM deleted_folder_playlists WHERE folder_name = ?').get(folderName)
  return !!result
}

export function clearDeletedFolderPlaylist(folderName: string) {
  return cachedStmt('DELETE FROM deleted_folder_playlists WHERE folder_name = ?').run(folderName)
}

export function getAllDeletedFolderPlaylists(): string[] {
  const rows = cachedStmt('SELECT folder_name FROM deleted_folder_playlists').all() as { folder_name: string }[]
  return rows.map(r => r.folder_name)
}

export function deleteEmptyPlaylists() {
  const result = cachedStmt(`
    DELETE FROM playlists 
    WHERE id NOT IN (SELECT DISTINCT playlist_id FROM playlist_movies)
  `).run()
  if (result.changes > 0) {
    console.log(`Database: Deleted ${result.changes} empty playlists`)
  }
  return result
}

export function addMovieToPlaylist(playlistId: number, movieId: number) {
  return cachedStmt('INSERT OR IGNORE INTO playlist_movies (playlist_id, movie_id) VALUES (?, ?)').run(playlistId, movieId)
}

export function removeMovieFromPlaylist(playlistId: number, movieId: number) {
  return cachedStmt('DELETE FROM playlist_movies WHERE playlist_id = ? AND movie_id = ?').run(playlistId, movieId)
}

export function getPlaylistMovies(playlistId: number) {
  return cachedStmt(`
    SELECT m.*, pm.added_at as playlist_added_at
    FROM movies m
    JOIN playlist_movies pm ON m.id = pm.movie_id
    WHERE pm.playlist_id = ?
    ORDER BY pm.added_at DESC
  `).all(playlistId)
}

// Secure items
export function addSecureItem(item: any) {
  const stmt = cachedStmt(`
    INSERT INTO secure_items (title, original_title, year, plot, poster_path, backdrop_path, rating, original_name, encrypted_path)
    VALUES (@title, @original_title, @year, @plot, @poster_path, @backdrop_path, @rating, @original_name, @encrypted_path)
  `)
  return stmt.run(item)
}

export function getSecureItems() {
  return cachedStmt('SELECT * FROM secure_items ORDER BY added_at DESC').all()
}

export function getSecureItemById(id: number) {
  return cachedStmt('SELECT * FROM secure_items WHERE id = ?').get(id) as any | undefined
}

export function updateSecureItemPosterPath(id: number, posterPath: string | null) {
  return cachedStmt('UPDATE secure_items SET poster_path = ? WHERE id = ?').run(posterPath, id)
}

export function deleteSecureItem(id: number) {
  return cachedStmt('DELETE FROM secure_items WHERE id = ?').run(id)
}

export function deleteSecureItemByPath(encryptedPath: string) {
  return cachedStmt('DELETE FROM secure_items WHERE encrypted_path = ?').run(encryptedPath)
}

export function deleteAllSecureItems() {
  return cachedStmt('DELETE FROM secure_items').run()
}

// Playback Progress functions
export function updatePlaybackProgress(movieId: number, progress: number, duration: number = 0) {
  const stmt = cachedStmt(`
    INSERT OR REPLACE INTO playback_progress (movie_id, progress, duration, last_watched)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
  `)
  return stmt.run(movieId, progress, duration)
}

export function getPlaybackProgress(movieId: number) {
  const row = cachedStmt('SELECT progress FROM playback_progress WHERE movie_id = ?').get(movieId) as { progress: number } | undefined
  return row ? row.progress : 0
}

function getRotatingSlice(table: 'movies' | 'playlists', limit: number) {
  const countSql = table === 'movies'
    ? 'SELECT COUNT(*) as count FROM movies'
    : 'SELECT COUNT(*) as count FROM playlists'
  const listSql = table === 'movies'
    ? 'SELECT * FROM movies ORDER BY id ASC LIMIT ? OFFSET ?'
    : 'SELECT * FROM playlists ORDER BY id ASC LIMIT ? OFFSET ?'

  const total = (cachedStmt(countSql).get() as { count: number } | undefined)?.count ?? 0
  if (total <= 0) return []

  // Rotate hourly for variety without expensive ORDER BY RANDOM scans.
  const seed = Math.floor(Date.now() / (60 * 60 * 1000))
  const offset = total > limit ? seed % total : 0
  const primary = cachedStmt(listSql).all(limit, offset) as any[]
  if (primary.length >= limit || primary.length >= total) return primary

  const remaining = limit - primary.length
  const wrap = cachedStmt(table === 'movies'
    ? 'SELECT * FROM movies ORDER BY id ASC LIMIT ?'
    : 'SELECT * FROM playlists ORDER BY id ASC LIMIT ?').all(remaining) as any[]
  return primary.concat(wrap)
}

function getPlaylistPreviewMovieMap(playlistIds: number[]) {
  const uniqueIds = [...new Set(playlistIds)].filter((id) => Number.isFinite(id))
  const previewMap = new Map<number, any[]>()
  if (uniqueIds.length === 0) return previewMap

  const placeholders = uniqueIds.map(() => '?').join(', ')
  const rows = getDB().prepare(`
    WITH ranked AS (
      SELECT
        pm.playlist_id,
        pm.added_at as playlist_added_at,
        m.*,
        ROW_NUMBER() OVER (PARTITION BY pm.playlist_id ORDER BY pm.added_at DESC) as rn
      FROM playlist_movies pm
      JOIN movies m ON m.id = pm.movie_id
      WHERE pm.playlist_id IN (${placeholders})
    )
    SELECT * FROM ranked
    WHERE rn <= 4
    ORDER BY playlist_id, playlist_added_at DESC
  `).all(...uniqueIds) as any[]

  for (const row of rows) {
    const playlistId = Number(row.playlist_id)
    const { playlist_id: _playlistId, rn: _rn, ...movie } = row
    const current = previewMap.get(playlistId)
    if (current) {
      current.push(movie)
    } else {
      previewMap.set(playlistId, [movie])
    }
  }

  return previewMap
}

function withPlaylistPreviewMovies(playlists: any[], previewMap: Map<number, any[]>) {
  return playlists.map((playlist) => ({
    ...playlist,
    movies: previewMap.get(Number(playlist.id)) ?? []
  }))
}

// Home Page Data
export function getHomeData() {
  const continueWatching = cachedStmt(`
    SELECT m.*, p.progress, p.duration, p.last_watched 
    FROM movies m 
    JOIN playback_progress p ON m.id = p.movie_id 
    ORDER BY p.last_watched DESC 
    LIMIT 10
  `).all()

  const recentlyAdded = cachedStmt(`
    SELECT * FROM movies 
    ORDER BY added_at DESC 
    LIMIT 10
  `).all()

  const randomSuggestions = getRotatingSlice('movies', 6)

  const lastWatchedPlaylistIdSetting = getSetting('last_watched_playlist_id')
  let lastWatchedPlaylist = null
  if (lastWatchedPlaylistIdSetting) {
    const playlistId = parseInt(lastWatchedPlaylistIdSetting, 10)
    if (!isNaN(playlistId)) {
      const playlistInfo = getPlaylistById(playlistId)
      if (playlistInfo) {
        const movies = getPlaylistMovies(playlistId)
        lastWatchedPlaylist = {
          ...playlistInfo,
          movies
        }
      }
    }
  }

  const recentlyWatchedPlaylists = cachedStmt(`
    SELECT * FROM playlists 
    WHERE last_watched IS NOT NULL 
    ORDER BY last_watched DESC 
    LIMIT 10
  `).all() as any[]

  const latestPlaylists = cachedStmt(`
    SELECT * FROM playlists 
    ORDER BY created_at DESC 
    LIMIT 10
  `).all() as any[]

  const recommendedPlaylists = getRotatingSlice('playlists', 10) as any[]
  const allPlaylistIds = [
    ...recentlyWatchedPlaylists.map((playlist) => Number(playlist.id)),
    ...latestPlaylists.map((playlist) => Number(playlist.id)),
    ...recommendedPlaylists.map((playlist) => Number(playlist.id)),
  ]
  const previewMap = getPlaylistPreviewMovieMap(allPlaylistIds)

  return {
    continueWatching,
    recentlyAdded,
    randomSuggestions,
    lastWatchedPlaylist,
    recentlyWatchedPlaylists: withPlaylistPreviewMovies(recentlyWatchedPlaylists, previewMap),
    latestPlaylists: withPlaylistPreviewMovies(latestPlaylists, previewMap),
    recommendedPlaylists: withPlaylistPreviewMovies(recommendedPlaylists, previewMap)
  }
}

// Export getDB for direct access if needed
export { getDB }
export default getDB

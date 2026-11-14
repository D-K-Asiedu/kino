import Database from 'better-sqlite3'
import path from 'path'
import { app } from 'electron'
import type { Classification } from './classify'
import { pickNextUp, sortEpisodes, watchedFraction, WATCHED_FRACTION } from '../../src/lib/episodes'

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
  // Filled in by classify.ts; show_title is null for movies.
  if (!names.has('show_title')) {
    getDB().exec('ALTER TABLE movies ADD COLUMN show_title TEXT')
  }
  if (!names.has('season')) {
    getDB().exec('ALTER TABLE movies ADD COLUMN season INTEGER')
  }
  if (!names.has('episode')) {
    getDB().exec('ALTER TABLE movies ADD COLUMN episode INTEGER')
  }
  if (!names.has('episode_title')) {
    getDB().exec('ALTER TABLE movies ADD COLUMN episode_title TEXT')
  }
}

function ensureIndexes() {
  getDB().exec(`
    CREATE INDEX IF NOT EXISTS idx_movies_added_at ON movies (added_at DESC);
    CREATE INDEX IF NOT EXISTS idx_movies_title_nocase ON movies (title COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS idx_movies_show_title ON movies (show_title);
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
  /** 'videos' leaves out TV episodes, which the Shows view lists instead. */
  kind?: 'videos' | 'all'
  searchQuery?: string
  filterBy?: string
  rating?: string
  decade?: string
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

  if (query?.kind === 'videos') {
    whereClauses.push('show_title IS NULL')
  }

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

  // Combinable filters: rating and decade can be applied together.
  switch (String(query?.rating ?? 'all')) {
    case 'rated':
      whereClauses.push('rating IS NOT NULL')
      break
    case 'unrated':
      whereClauses.push('rating IS NULL')
      break
    default:
      break
  }

  switch (String(query?.decade ?? 'all')) {
    case '2020s':
      whereClauses.push('year >= 2020')
      break
    case '2010s':
      whereClauses.push('year BETWEEN 2010 AND 2019')
      break
    case '2000s':
      whereClauses.push('year BETWEEN 2000 AND 2009')
      break
    case '1990s':
      whereClauses.push('year BETWEEN 1990 AND 1999')
      break
    case '1980s':
      whereClauses.push('year BETWEEN 1980 AND 1989')
      break
    case 'older':
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
    SELECT m.*, p.progress, p.duration
    FROM movies m
    LEFT JOIN playback_progress p ON p.movie_id = m.id
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

// Title, year and show fields are owned by applyClassifications, so a metadata job that started
// before a re-classification can't write a stale title back.
export function updateMovie(id: number | bigint, movie: any) {
  const stmt = cachedStmt(`
    UPDATE movies
    SET plot = @plot,
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

// Compared in JS rather than with SQL LIKE: Windows paths are full of backslashes, which
// LIKE ... ESCAPE '\' treats as escape characters. path.relative also handles mixed
// separators, trailing separators, drive roots, and is case-insensitive on win32.
function isPathInside(filePath: string, dirPath: string) {
  const relative = path.relative(dirPath, filePath)
  if (relative === '') return true
  return !path.isAbsolute(relative) && relative.split(path.sep)[0] !== '..'
}

// Hidden folders inside a library folder (".Trash-1000", ".snapshots") aren't part of the library.
function isInsideLibraryFolder(filePath: string, dirPath: string) {
  if (!isPathInside(filePath, dirPath)) return false
  return !path.relative(dirPath, filePath).split(path.sep).some((segment) => segment.startsWith('.'))
}

export function isInsideWatchPaths(filePath: string) {
  return (getWatchPaths() as { path: string }[]).some((row) => isInsideLibraryFolder(filePath, row.path))
}

export function removeMoviesOutsideWatchPaths() {
  const watchPaths = (getWatchPaths() as { path: string }[]).map((row) => row.path)
  const movies = cachedStmt('SELECT id, file_path FROM movies').all() as { id: number; file_path: string }[]
  const orphaned = movies.filter((movie) => !watchPaths.some((watchPath) => isInsideLibraryFolder(movie.file_path, watchPath)))
  if (orphaned.length === 0) return orphaned

  const remove = cachedStmt('DELETE FROM movies WHERE id = ?')
  getDB().transaction(() => {
    for (const movie of orphaned) remove.run(movie.id)
  })()

  console.log('Database: Removed', orphaned.length, 'movies outside watch paths')
  return orphaned
}

export function removeMovieByPath(filePath: string) {
  console.log('Database: Attempting to remove movie with path:', filePath)
  const result = cachedStmt('DELETE FROM movies WHERE file_path = ?').run(filePath)
  console.log('Database: Removal result:', result)
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
    SELECT m.*, pm.added_at as playlist_added_at, p.progress, p.duration
    FROM movies m
    JOIN playlist_movies pm ON m.id = pm.movie_id
    LEFT JOIN playback_progress p ON p.movie_id = m.id
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

// Movies with their saved playback position (null when never watched), for progress bars on cards.
const MOVIE_WITH_PROGRESS_SQL = `
  SELECT m.*, p.progress, p.duration
  FROM movies m
  LEFT JOIN playback_progress p ON p.movie_id = m.id
`

function getRotatingSlice(table: 'movies' | 'playlists', limit: number) {
  const countSql = table === 'movies'
    ? 'SELECT COUNT(*) as count FROM movies WHERE show_title IS NULL'
    : 'SELECT COUNT(*) as count FROM playlists'
  const listSql = table === 'movies'
    ? `${MOVIE_WITH_PROGRESS_SQL} WHERE m.show_title IS NULL ORDER BY m.id ASC LIMIT ? OFFSET ?`
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
    ? `${MOVIE_WITH_PROGRESS_SQL} WHERE m.show_title IS NULL ORDER BY m.id ASC LIMIT ?`
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

function getPlaylistMovieCounts(playlistIds: number[]) {
  const uniqueIds = [...new Set(playlistIds)].filter((id) => Number.isFinite(id))
  const counts = new Map<number, number>()
  if (uniqueIds.length === 0) return counts

  const placeholders = uniqueIds.map(() => '?').join(', ')
  const rows = getDB().prepare(`
    SELECT playlist_id, COUNT(*) as count
    FROM playlist_movies
    WHERE playlist_id IN (${placeholders})
    GROUP BY playlist_id
  `).all(...uniqueIds) as { playlist_id: number; count: number }[]

  for (const row of rows) {
    counts.set(Number(row.playlist_id), row.count)
  }
  return counts
}

function withPlaylistPreviewMovies(playlists: any[], previewMap: Map<number, any[]>) {
  const counts = getPlaylistMovieCounts(playlists.map((playlist) => Number(playlist.id)))
  return playlists.map((playlist) => ({
    ...playlist,
    movie_count: counts.get(Number(playlist.id)) ?? 0,
    movies: previewMap.get(Number(playlist.id)) ?? []
  }))
}

// All playlists with up to 4 preview movies and their real movie count, for the Playlists page
export function getPlaylistsOverview() {
  const playlists = getPlaylists() as any[]
  const previewMap = getPlaylistPreviewMovieMap(playlists.map((playlist) => Number(playlist.id)))
  return withPlaylistPreviewMovies(playlists, previewMap)
}

// Home Page Data
export function getHomeData() {
  const continueWatching = getContinueWatching(10)

  // Episodes have their own "Shows" row, so a new season doesn't flood this one.
  const recentlyAdded = cachedStmt(`
    ${MOVIE_WITH_PROGRESS_SQL}
    WHERE m.show_title IS NULL
    ORDER BY m.added_at DESC
    LIMIT 10
  `).all()

  const shows = getShows().slice(0, 12)

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
    shows,
    randomSuggestions,
    lastWatchedPlaylist,
    recentlyWatchedPlaylists: withPlaylistPreviewMovies(recentlyWatchedPlaylists, previewMap),
    latestPlaylists: withPlaylistPreviewMovies(latestPlaylists, previewMap),
    recommendedPlaylists: withPlaylistPreviewMovies(recommendedPlaylists, previewMap)
  }
}

// ---- Shows -------------------------------------------------------------------------------

/** Writes classify.ts results, touching only rows whose title or show fields changed. */
export function applyClassifications(classifications: Map<number, Classification>) {
  const rows = cachedStmt('SELECT id, title, year, show_title, season, episode, episode_title FROM movies').all() as any[]
  const update = cachedStmt(`
    UPDATE movies
    SET title = @title, year = @year, show_title = @show_title, season = @season,
        episode = @episode, episode_title = @episode_title
    WHERE id = @id
  `)
  let changed = 0
  getDB().transaction(() => {
    for (const row of rows) {
      const next = classifications.get(row.id)
      if (!next) continue
      if (
        row.title === next.title && row.year === next.year && row.show_title === next.show_title &&
        row.season === next.season && row.episode === next.episode && row.episode_title === next.episode_title
      ) continue
      update.run({ id: row.id, ...next })
      changed++
    }
  })()
  return changed
}

const EPISODE_SQL = `
  SELECT m.*, p.progress, p.duration, p.last_watched
  FROM movies m
  LEFT JOIN playback_progress p ON p.movie_id = m.id
  WHERE m.show_title IS NOT NULL
`

export interface ShowSummary {
  title: string
  episode_count: number
  season_count: number
  watched_count: number
  poster_path: string | null
  last_added: string
  last_watched: string | null
  /** What "Continue" plays; null once everything up to the latest episode is watched. */
  next_up: any | null
  next_up_resume: boolean
}

export function getShows(): ShowSummary[] {
  const rows = cachedStmt(EPISODE_SQL).all() as any[]
  const byShow = new Map<string, any[]>()
  for (const row of rows) {
    const list = byShow.get(row.show_title)
    if (list) list.push(row)
    else byShow.set(row.show_title, [row])
  }

  const shows: ShowSummary[] = []
  for (const [title, unsorted] of byShow) {
    const episodes = sortEpisodes(unsorted)
    const nextUp = pickNextUp(episodes)
    const seasons = new Set(episodes.map((ep) => ep.season).filter((season) => season !== null))
    let lastAdded = ''
    let lastWatched: string | null = null
    for (const ep of episodes) {
      if (ep.added_at > lastAdded) lastAdded = ep.added_at
      if (ep.last_watched && (!lastWatched || ep.last_watched > lastWatched)) lastWatched = ep.last_watched
    }
    shows.push({
      title,
      episode_count: episodes.length,
      season_count: seasons.size,
      watched_count: episodes.filter((ep) => watchedFraction(ep) >= WATCHED_FRACTION).length,
      // The first episode's frame stands in for a poster until real artwork exists.
      poster_path: episodes.find((ep) => ep.poster_path)?.poster_path ?? null,
      last_added: lastAdded,
      last_watched: lastWatched,
      next_up: nextUp?.episode ?? null,
      next_up_resume: nextUp?.resume ?? false,
    })
  }

  // Shows being watched first, then the newest additions.
  return shows.sort((a, b) =>
    (b.last_watched ?? '').localeCompare(a.last_watched ?? '') || b.last_added.localeCompare(a.last_added)
  )
}

export function getShowEpisodes(showTitle: string) {
  return sortEpisodes(cachedStmt(`${EPISODE_SQL} AND m.show_title = ?`).all(showTitle) as any[])
}

/**
 * Recently watched movies plus one entry per show. For a show that's the episode to watch
 * next, so finishing S2 E5 puts S2 E6 here instead of the finished episode.
 */
function getContinueWatching(limit: number) {
  const recent = cachedStmt(`
    SELECT m.*, p.progress, p.duration, p.last_watched
    FROM movies m
    JOIN playback_progress p ON m.id = p.movie_id
    ORDER BY p.last_watched DESC
    LIMIT 200
  `).all() as any[]

  const items: any[] = []
  const seenShows = new Set<string>()
  for (const row of recent) {
    if (items.length >= limit) break
    if (!row.show_title) {
      items.push(row)
      continue
    }
    if (seenShows.has(row.show_title)) continue
    seenShows.add(row.show_title)
    const next = pickNextUp(getShowEpisodes(row.show_title))
    if (!next) continue // caught up
    // Sort position stays that of the show's last watch.
    items.push({ ...next.episode, last_watched: row.last_watched })
  }
  return items
}

/**
 * One-off clean-up for libraries from before shows existed: drops the playlists that were
 * generated from season folders ("s1", "Season4Part1"), since those episodes now live under
 * Shows. Only playlists named after the folder of every video in them, all of them episodes,
 * are removed, so playlists people made themselves stay.
 */
export function removeEpisodeFolderPlaylists() {
  const MIGRATION_KEY = 'migration_episode_folder_playlists_removed'
  if (getSetting(MIGRATION_KEY)) return 0

  const rows = cachedStmt(`
    SELECT pl.id, pl.name, m.file_path, m.show_title
    FROM playlists pl
    JOIN playlist_movies pm ON pm.playlist_id = pl.id
    JOIN movies m ON m.id = pm.movie_id
  `).all() as { id: number; name: string; file_path: string; show_title: string | null }[]

  const verdict = new Map<number, boolean>()
  for (const row of rows) {
    const fromFolder = path.basename(path.dirname(row.file_path)) === row.name && row.show_title !== null
    verdict.set(row.id, (verdict.get(row.id) ?? true) && fromFolder)
  }
  const toDelete = [...verdict].filter(([, remove]) => remove).map(([id]) => id)

  getDB().transaction(() => {
    for (const id of toDelete) deletePlaylist(id)
    setSetting(MIGRATION_KEY, new Date().toISOString())
  })()
  if (toDelete.length > 0) console.log(`Database: Removed ${toDelete.length} season-folder playlists now covered by Shows`)
  return toDelete.length
}

// ---- Folders -----------------------------------------------------------------------------

const fileNameCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

export interface FolderSummary {
  path: string
  name: string
  video_count: number
  /** Thumbnails of the first few videos inside, in name order, for the card collage. */
  previews: string[]
}

/**
 * One folder of the library as it is on disk: its subfolders (that contain videos) and the
 * videos directly inside it. Built from the indexed videos, so hidden folders and non-video
 * files never appear. Without a path (or with one outside the library folders) it lists the
 * library folders themselves, or opens the only one there is.
 */
export function getFolderContents(requestedPath?: string | null) {
  const roots = (getWatchPaths() as { path: string }[]).map((row) => path.resolve(row.path))
  const rows = (cachedStmt(MOVIE_WITH_PROGRESS_SQL).all() as any[])
    .sort((a, b) => fileNameCollator.compare(a.file_path, b.file_path))

  const requested = requestedPath ? path.resolve(requestedPath) : null
  let current = requested && roots.some((root) => isPathInside(requested, root)) ? requested : null
  if (!current && roots.length === 1) current = roots[0]

  const summarize = (dir: string, name: string, inside: any[]): FolderSummary => ({
    path: dir,
    name,
    video_count: inside.length,
    previews: inside.filter((row) => row.poster_path).slice(0, 4).map((row) => row.poster_path as string),
  })

  if (!current) {
    return {
      path: null,
      breadcrumbs: [] as { name: string; path: string | null }[],
      folders: roots.map((root) => summarize(root, root, rows.filter((row) => isPathInside(row.file_path, root)))),
      videos: [] as any[],
    }
  }

  const children = new Map<string, any[]>()
  const videos: any[] = []
  for (const row of rows) {
    if (!isPathInside(row.file_path, current)) continue
    const [first, ...restParts] = path.relative(current, row.file_path).split(path.sep)
    if (restParts.length === 0) {
      videos.push({ ...row, file_name: first })
    } else {
      const childPath = path.join(current, first)
      const list = children.get(childPath)
      if (list) list.push(row)
      else children.set(childPath, [row])
    }
  }

  const root = roots
    .filter((candidate) => isPathInside(current!, candidate))
    .sort((a, b) => b.length - a.length)[0]
  const breadcrumbs: { name: string; path: string | null }[] = []
  if (roots.length > 1) breadcrumbs.push({ name: 'Library folders', path: null })
  breadcrumbs.push({ name: path.basename(root) || root, path: root })
  let walked = root
  for (const part of path.relative(root, current).split(path.sep).filter(Boolean)) {
    walked = path.join(walked, part)
    breadcrumbs.push({ name: part, path: walked })
  }

  return {
    path: current,
    breadcrumbs,
    folders: [...children].map(([dir, inside]) => summarize(dir, path.basename(dir), inside)),
    videos,
  }
}

// Export getDB for direct access if needed
export { getDB }
export default getDB

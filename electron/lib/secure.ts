import path from 'path'
import fs from 'fs-extra'
import crypto from 'crypto'
import { app } from 'electron'
import { pipeline } from 'stream/promises'
import * as db from './database'
import { generateThumbnailToPath } from './scraper'
import { isProcessAlive } from './processes'

const VAULT_DIR = () => path.join(app.getPath('userData'), 'secure-vault')
const CACHE_ROOT = () => path.join(app.getPath('temp'), 'kino-secure-cache')
// Each Kino process decrypts into its own folder, so cleaning up never touches files another
// running copy is playing.
const CACHE_DIR = () => path.join(CACHE_ROOT(), String(process.pid))
const THUMB_VAULT_DIR = () => path.join(VAULT_DIR(), 'thumbnails')
const LOG_PATH = () => path.join(app.getPath('userData'), 'kino-debug.log')

const MAGIC = Buffer.from('KINOSEC1')
const VERSION = 1
const IV_LENGTH = 12
const TAG_LENGTH = 16
const HEADER_LENGTH = MAGIC.length + 1 + IV_LENGTH

const SETTINGS_KEYS = {
  authSalt: 'secure_auth_salt',
  authHash: 'secure_auth_hash',
  keySalt: 'secure_key_salt'
}

let unlockedKey: Buffer | null = null
const cachePaths = new Set<string>()
const PLAYBACK_CACHE_TTL_MS = 2 * 60 * 1000

type PlaybackCacheEntry = {
  itemId: number
  tempPath: string
  refs: number
  evictTimer: ReturnType<typeof setTimeout> | null
}

const playbackCacheByItem = new Map<number, PlaybackCacheEntry>()
const playbackCacheByPath = new Map<string, PlaybackCacheEntry>()
const playbackPrepareInFlight = new Map<number, Promise<{ tempPath: string }>>()
const thumbnailInFlight = new Map<number, Promise<string>>()

function logSecure(message: string, error?: unknown) {
  const timestamp = new Date().toISOString()
  const suffix = error instanceof Error ? `\n${error.stack}` : error ? `\n${String(error)}` : ''
  const line = `[${timestamp}] [SECURE] ${message}${suffix}\n`
  try {
    fs.appendFileSync(LOG_PATH(), line)
  } catch {
    console.log(line)
  }
}

function toBase64(buf: Buffer) {
  return buf.toString('base64')
}

function fromBase64(value: string) {
  return Buffer.from(value, 'base64')
}

function deriveKey(password: string, salt: Buffer) {
  return crypto.scryptSync(password, salt, 32)
}

function hasPassword() {
  const authHash = db.getSetting(SETTINGS_KEYS.authHash)
  const authSalt = db.getSetting(SETTINGS_KEYS.authSalt)
  const keySalt = db.getSetting(SETTINGS_KEYS.keySalt)
  return !!(authHash && authSalt && keySalt)
}

function ensureVaultDirs() {
  fs.ensureDirSync(VAULT_DIR())
  fs.ensureDirSync(THUMB_VAULT_DIR())
  fs.ensureDirSync(CACHE_DIR())
}


async function encryptFile(sourcePath: string, destPath: string, key: Buffer) {
  ensureVaultDirs()
  const iv = crypto.randomBytes(IV_LENGTH)
  const header = Buffer.concat([MAGIC, Buffer.from([VERSION]), iv])
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)

  await fs.promises.mkdir(path.dirname(destPath), { recursive: true })
  const writeStream = fs.createWriteStream(destPath)
  writeStream.write(header)

  await pipeline(
    fs.createReadStream(sourcePath),
    cipher,
    writeStream
  )

  const tag = cipher.getAuthTag()
  await fs.promises.appendFile(destPath, tag)
}

async function decryptFile(
  sourcePath: string,
  destPath: string,
  key: Buffer,
  options: { signal?: AbortSignal; exclusive?: boolean } = {}
) {
  ensureVaultDirs()
  const stats = await fs.promises.stat(sourcePath)
  if (stats.size <= HEADER_LENGTH + TAG_LENGTH) {
    throw new Error('Invalid secure file')
  }

  const fd = await fs.promises.open(sourcePath, 'r')
  const headerBuf = Buffer.alloc(HEADER_LENGTH)
  await fd.read(headerBuf, 0, HEADER_LENGTH, 0)

  const magic = headerBuf.subarray(0, MAGIC.length)
  if (!magic.equals(MAGIC)) {
    await fd.close()
    throw new Error('Invalid secure file header')
  }

  const version = headerBuf.readUInt8(MAGIC.length)
  if (version !== VERSION) {
    await fd.close()
    throw new Error('Unsupported secure file version')
  }

  const ivStart = MAGIC.length + 1
  const iv = headerBuf.subarray(ivStart, ivStart + IV_LENGTH)

  const tagPos = stats.size - TAG_LENGTH
  const tagBuf = Buffer.alloc(TAG_LENGTH)
  await fd.read(tagBuf, 0, TAG_LENGTH, tagPos)
  await fd.close()

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tagBuf)

  await fs.promises.mkdir(path.dirname(destPath), { recursive: true })
  await pipeline(
    fs.createReadStream(sourcePath, { start: HEADER_LENGTH, end: tagPos - 1 }),
    decipher,
    fs.createWriteStream(destPath, { flags: options.exclusive ? 'wx' : 'w' }),
    { signal: options.signal }
  )
}

function requireUnlocked() {
  if (!unlockedKey) {
    throw new Error('Secure folder is locked')
  }
}

export function getSecureStatus() {
  return {
    hasPassword: hasPassword(),
    isUnlocked: !!unlockedKey
  }
}

export function setSecurePassword(password: string) {
  if (hasPassword()) {
    throw new Error('Password already set')
  }
  logSecure('Setting secure password')
  const authSalt = crypto.randomBytes(16)
  const keySalt = crypto.randomBytes(16)
  const authHash = deriveKey(password, authSalt)

  db.setSetting(SETTINGS_KEYS.authSalt, toBase64(authSalt))
  db.setSetting(SETTINGS_KEYS.keySalt, toBase64(keySalt))
  db.setSetting(SETTINGS_KEYS.authHash, toBase64(authHash))

  unlockedKey = deriveKey(password, keySalt)
  ensureVaultDirs()
}

export function unlockSecure(password: string) {
  if (!hasPassword()) {
    throw new Error('Password not set')
  }
  logSecure('Unlock attempt')
  const authSalt = fromBase64(db.getSetting(SETTINGS_KEYS.authSalt) as string)
  const keySalt = fromBase64(db.getSetting(SETTINGS_KEYS.keySalt) as string)
  const storedHash = db.getSetting(SETTINGS_KEYS.authHash) as string
  const authHash = deriveKey(password, authSalt)

  if (!crypto.timingSafeEqual(authHash, fromBase64(storedHash))) {
    logSecure('Unlock failed: invalid password')
    throw new Error('Invalid password')
  }

  unlockedKey = deriveKey(password, keySalt)
  logSecure('Unlocked successfully')
}

export async function lockSecure() {
  unlockedKey = null
  thumbnailInFlight.clear()
  playbackPrepareInFlight.clear()

  for (const entry of playbackCacheByItem.values()) {
    if (entry.evictTimer) {
      clearTimeout(entry.evictTimer)
      entry.evictTimer = null
    }
  }
  playbackCacheByItem.clear()
  playbackCacheByPath.clear()

  for (const p of cachePaths) {
    try {
      await fs.promises.unlink(p)
    } catch {
      // ignore
    }
  }
  cachePaths.clear()
  thumbnailCache.clear()
  logSecure('Locked and cache cleared')
}

/** Lock the vault and delete every decrypted file this process made. Called on quit. */
export async function shutdownSecure() {
  await cancelSecureRestores()
  await lockSecure()
  // The player or ffmpeg may still be letting go of a file; Windows can't delete files held open.
  await fs.promises.rm(CACHE_DIR(), { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }).catch(() => undefined)
}

/**
 * Delete decrypted files left by Kino runs that didn't quit cleanly (crash, force-kill, power loss),
 * and by versions that kept them loose in the cache folder.
 */
export async function removeStaleSecureCache() {
  const root = CACHE_ROOT()
  const names = await fs.promises.readdir(root).catch(() => [] as string[])
  const stale = names.filter(name => name !== String(process.pid) && !(/^\d+$/.test(name) && isProcessAlive(Number(name))))
  await Promise.all(stale.map(name =>
    fs.promises.rm(path.join(root, name), { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => undefined)
  ))
  if (stale.length > 0) logSecure(`Removed ${stale.length} decrypted leftovers from earlier runs`)
}

export async function resetSecure() {
  logSecure('Reset secure folder')
  await cancelSecureRestores()
  await lockSecure()
  db.deleteAllSecureItems()
  db.removeSetting(SETTINGS_KEYS.authSalt)
  db.removeSetting(SETTINGS_KEYS.keySalt)
  db.removeSetting(SETTINGS_KEYS.authHash)
  await fs.remove(VAULT_DIR())
  await fs.remove(CACHE_DIR())
}

export function listSecureItems() {
  requireUnlocked()
  const items = db.getSecureItems() as any[]
  return items.map(item => ({ ...item, poster_path: null }))
}

export async function importMovieToSecure(movie: any) {
  requireUnlocked()
  if (!unlockedKey) throw new Error('Secure folder is locked')
  const sourcePath = movie.file_path
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    throw new Error('File not found')
  }

  const encryptedName = `${crypto.randomBytes(16).toString('hex')}.bin`
  const encryptedPath = path.join(VAULT_DIR(), encryptedName)

  const originalName = path.basename(sourcePath)
  let encryptedThumbnailPath: string | null = null

  try {
    logSecure(`Encrypting file: ${sourcePath}`)
    await encryptFile(sourcePath, encryptedPath, unlockedKey)
    encryptedThumbnailPath = await createEncryptedSecureThumbnail(sourcePath)

    await deleteLibraryThumbnail(movie)

    db.addSecureItem({
      title: movie.title,
      original_title: movie.original_title,
      year: movie.year,
      plot: movie.plot,
      poster_path: encryptedThumbnailPath,
      backdrop_path: movie.backdrop_path,
      rating: movie.rating,
      original_name: originalName,
      encrypted_path: encryptedPath
    })

    await fs.promises.unlink(sourcePath)
    db.removeMovieByPath(sourcePath)
    logSecure(`Imported secure item: ${encryptedPath}`)
  } catch (err) {
    db.deleteSecureItemByPath(encryptedPath)
    await fs.promises.unlink(encryptedPath).catch(() => undefined)
    if (encryptedThumbnailPath) {
      await fs.promises.unlink(encryptedThumbnailPath).catch(() => undefined)
    }
    logSecure(`Import failed for: ${sourcePath}`, err)
    throw err
  }
}

export async function importMovieWithPassword(movie: any, password: string) {
  if (!hasPassword()) {
    setSecurePassword(password)
  } else {
    unlockSecure(password)
  }

  try {
    await importMovieToSecure(movie)
  } finally {
    await lockSecure()
  }
}

export async function prepareSecurePlayback(itemId: number) {
  requireUnlocked()
  if (!unlockedKey) throw new Error('Secure folder is locked')
  const item = db.getSecureItemById(itemId)
  if (!item) throw new Error('Secure item not found')

  const cachedEntry = playbackCacheByItem.get(itemId)
  if (cachedEntry && await existsNonEmpty(cachedEntry.tempPath)) {
    retainPlaybackCacheEntry(cachedEntry)
    logSecure(`Reused secure playback cache: ${cachedEntry.tempPath}`)
    return { tempPath: cachedEntry.tempPath }
  }
  if (cachedEntry) {
    await deletePlaybackCacheEntry(cachedEntry)
  }

  const inFlight = playbackPrepareInFlight.get(itemId)
  if (inFlight) {
    return inFlight
  }

  const task = (async () => {
    const ext = path.extname(item.original_name || '') || '.mp4'
    const safeName = `${item.id}-${Date.now()}${ext}`
    const tempPath = path.join(CACHE_DIR(), safeName)

    await decryptFile(item.encrypted_path, tempPath, unlockedKey)
    cachePaths.add(tempPath)

    const entry: PlaybackCacheEntry = {
      itemId,
      tempPath,
      refs: 1,
      evictTimer: null
    }
    playbackCacheByItem.set(itemId, entry)
    playbackCacheByPath.set(tempPath, entry)

    logSecure(`Prepared secure playback: ${tempPath}`)
    return { tempPath }
  })()

  playbackPrepareInFlight.set(itemId, task)
  try {
    return await task
  } finally {
    playbackPrepareInFlight.delete(itemId)
  }
}

export async function releaseSecurePlayback(tempPath: string) {
  if (!tempPath) return
  const entry = playbackCacheByPath.get(tempPath)
  if (!entry) {
    cachePaths.delete(tempPath)
    try {
      await fs.promises.unlink(tempPath)
    } catch {
      // ignore
    }
    return
  }

  entry.refs = Math.max(0, entry.refs - 1)
  schedulePlaybackEviction(entry)
}

export async function deleteSecureItem(itemId: number) {
  requireUnlocked()
  const item = db.getSecureItemById(itemId)
  if (!item) return
  await removeFromVault(item)
}

async function removeFromVault(item: any) {
  await deletePlaybackCacheForItem(item.id)
  await fs.promises.unlink(item.encrypted_path).catch(() => undefined)
  if (item.poster_path) {
    await fs.promises.unlink(item.poster_path).catch(() => undefined)
  }
  db.deleteSecureItem(item.id)
  await deleteCachedThumbnail(item.id)
}

type RestoreTask = { controller: AbortController; done: Promise<unknown> }
const restoresInFlight = new Map<number, RestoreTask>()
// Leave room for the filesystem's own bookkeeping so a restore can't fill the disk to the last byte.
const RESTORE_SPACE_MARGIN = 64 * 1024 * 1024

/**
 * Decrypt a vault item back to a normal file, then remove it from the vault.
 * The vault copy is only deleted once the decrypted file is complete, verified and in place.
 * Returns null when the user cancels the location prompt.
 */
export async function restoreSecureItem(
  itemId: number,
  chooseDestination: (originalName: string) => Promise<string | null>
) {
  requireUnlocked()
  if (restoresInFlight.has(itemId)) throw new Error('This video is already being restored.')
  const item = db.getSecureItemById(itemId)
  if (!item) throw new Error('Secure item not found')

  const controller = new AbortController()
  const task = runRestore(item, chooseDestination, controller.signal)
  restoresInFlight.set(itemId, { controller, done: task.catch(() => undefined) })
  try {
    return await task
  } finally {
    restoresInFlight.delete(itemId)
  }
}

async function runRestore(
  item: any,
  chooseDestination: (originalName: string) => Promise<string | null>,
  signal: AbortSignal
) {
  const chosen = await chooseDestination(item.original_name)
  if (!chosen || signal.aborted) return null

  // The folder may have locked while the save dialog was open.
  const key = unlockedKey
  if (!key) throw new Error('Secure folder is locked')

  let target = path.resolve(chosen)
  const originalExt = path.extname(item.original_name || '')
  if (!path.extname(target) && originalExt) target += originalExt
  if (isInsideDir(target, VAULT_DIR()) || isInsideDir(target, CACHE_DIR())) {
    throw new Error('Choose a folder outside Kino’s secure storage.')
  }

  const dir = path.dirname(target)
  const encryptedSize = (await fs.promises.stat(item.encrypted_path)).size
  await ensureFreeSpace(dir, encryptedSize - HEADER_LENGTH - TAG_LENGTH)

  // Hidden, and not a video extension, so the library watcher ignores it until it's renamed.
  const partialPath = path.join(dir, `.${path.basename(target)}.${crypto.randomBytes(4).toString('hex')}.partial`)
  logSecure(`Restoring secure item ${item.id} to ${target}`)
  try {
    // GCM only confirms the data is intact once the last block is read; a failure there rejects this.
    await decryptFile(item.encrypted_path, partialPath, key, { signal, exclusive: true })
    await fs.promises.rename(partialPath, target)
  } catch (err) {
    await fs.promises.rm(partialPath, { force: true }).catch(() => undefined)
    logSecure(`Restore failed for secure item ${item.id}`, err)
    throw new Error(describeRestoreError(err, signal))
  }

  await removeFromVault(item)
  logSecure(`Restored secure item ${item.id}`)
  return { filePath: target, title: item.title as string }
}

/** Stop restores in progress and wait for their partial files to be removed. */
export async function cancelSecureRestores() {
  const tasks = [...restoresInFlight.values()]
  for (const task of tasks) task.controller.abort()
  await Promise.all(tasks.map(task => task.done))
}

function describeRestoreError(err: unknown, signal: AbortSignal) {
  if (signal.aborted) return 'The restore was cancelled.'
  const code = (err as NodeJS.ErrnoException)?.code
  if (code === 'ENOSPC') return 'There isn’t enough free space in that folder.'
  if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS') return 'Kino can’t write to that folder.'
  if (/authenticate/i.test((err as Error)?.message ?? '')) {
    return 'The encrypted file is damaged, so it can’t be restored. It has been left in the Secure Folder.'
  }
  return (err as Error)?.message || 'Restore failed.'
}

async function ensureFreeSpace(dir: string, bytes: number) {
  let available: number
  try {
    const stats = await fs.promises.statfs(dir)
    available = Number(stats.bavail) * Number(stats.bsize)
  } catch {
    return // Can't tell; the write itself will fail cleanly if space runs out.
  }
  if (available < bytes + RESTORE_SPACE_MARGIN) {
    throw new Error(`Not enough free space: the video needs ${formatBytes(bytes)} and ${formatBytes(available)} is available.`)
  }
}

function formatBytes(bytes: number) {
  const gb = bytes / 1024 ** 3
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${Math.ceil(bytes / 1024 ** 2)} MB`
}

function isInsideDir(filePath: string, dir: string) {
  const relative = path.relative(dir, filePath)
  return relative === '' || (!path.isAbsolute(relative) && relative.split(path.sep)[0] !== '..')
}

const thumbnailCache = new Map<number, string>()

export async function getSecureThumbnail(itemId: number) {
  requireUnlocked()
  if (!unlockedKey) throw new Error('Secure folder is locked')

  const cached = thumbnailCache.get(itemId)
  if (cached && await existsNonEmpty(cached)) {
    return cached
  }

  const pending = thumbnailInFlight.get(itemId)
  if (pending) {
    return pending
  }

  const task = (async () => {
    const item = db.getSecureItemById(itemId)
    if (!item) throw new Error('Secure item not found')

    const thumbnailPath = path.join(CACHE_DIR(), `thumb-${item.id}.jpg`)

    if (item.poster_path && await existsNonEmpty(item.poster_path)) {
      try {
        await decryptFile(item.poster_path, thumbnailPath, unlockedKey)
        cachePaths.add(thumbnailPath)
        thumbnailCache.set(itemId, thumbnailPath)
        return thumbnailPath
      } catch (err) {
        logSecure(`Failed to decrypt secure thumbnail for item ${itemId}; regenerating`, err)
        db.updateSecureItemPosterPath(itemId, null)
        await fs.remove(item.poster_path).catch(() => undefined)
      }
    }

    const ext = path.extname(item.original_name || '') || '.mp4'
    const tempVideoName = `${item.id}-${Date.now()}-${Math.random().toString(16).slice(2)}${ext}`
    const tempVideoPath = path.join(CACHE_DIR(), tempVideoName)

    await decryptFile(item.encrypted_path, tempVideoPath, unlockedKey)
    cachePaths.add(tempVideoPath)

    try {
      const posterPath = await generateThumbnailToPath(tempVideoPath, thumbnailPath, undefined, { force: true })
      if (!posterPath) {
        throw new Error('Thumbnail generation failed')
      }

      cachePaths.add(thumbnailPath)
      thumbnailCache.set(itemId, posterPath)

      try {
        const encryptedThumbnailPath = await encryptExistingThumbnail(posterPath)
        if (encryptedThumbnailPath) {
          db.updateSecureItemPosterPath(itemId, encryptedThumbnailPath)
        }
      } catch (err) {
        logSecure(`Failed to persist secure thumbnail for item ${itemId}`, err)
      }

      return posterPath
    } finally {
      cachePaths.delete(tempVideoPath)
      await fs.remove(tempVideoPath).catch(() => undefined)
    }
  })()

  thumbnailInFlight.set(itemId, task)
  try {
    return await task
  } finally {
    thumbnailInFlight.delete(itemId)
  }
}

async function deleteCachedThumbnail(itemId: number | bigint) {
  const cached = thumbnailCache.get(Number(itemId))
  if (cached) {
    thumbnailCache.delete(Number(itemId))
    await fs.remove(cached).catch(() => undefined)
  }
}

function retainPlaybackCacheEntry(entry: PlaybackCacheEntry) {
  if (entry.evictTimer) {
    clearTimeout(entry.evictTimer)
    entry.evictTimer = null
  }
  entry.refs += 1
}

function schedulePlaybackEviction(entry: PlaybackCacheEntry) {
  if (entry.refs > 0) return
  if (entry.evictTimer) return

  entry.evictTimer = setTimeout(() => {
    void deletePlaybackCacheEntry(entry)
  }, PLAYBACK_CACHE_TTL_MS)
}

async function deletePlaybackCacheForItem(itemId: number) {
  const entry = playbackCacheByItem.get(itemId)
  if (!entry) return
  await deletePlaybackCacheEntry(entry)
}

async function deletePlaybackCacheEntry(entry: PlaybackCacheEntry) {
  if (entry.evictTimer) {
    clearTimeout(entry.evictTimer)
    entry.evictTimer = null
  }

  playbackCacheByItem.delete(entry.itemId)
  playbackCacheByPath.delete(entry.tempPath)
  cachePaths.delete(entry.tempPath)
  await fs.remove(entry.tempPath).catch(() => undefined)
}

async function createEncryptedSecureThumbnail(videoPath: string) {
  if (!unlockedKey) return null

  const tempThumbPath = path.join(
    CACHE_DIR(),
    `secure-import-thumb-${Date.now()}-${Math.random().toString(16).slice(2)}.jpg`
  )

  try {
    const generated = await generateThumbnailToPath(videoPath, tempThumbPath, undefined, { force: true })
    if (!generated || !await existsNonEmpty(generated)) {
      return null
    }
    return await encryptExistingThumbnail(generated)
  } catch (err) {
    logSecure(`Failed to pre-generate secure thumbnail for ${videoPath}`, err)
    return null
  } finally {
    await fs.remove(tempThumbPath).catch(() => undefined)
  }
}

async function encryptExistingThumbnail(thumbnailPath: string) {
  if (!unlockedKey) return null
  if (!await existsNonEmpty(thumbnailPath)) return null

  const encryptedThumbnailPath = path.join(
    THUMB_VAULT_DIR(),
    `${crypto.randomBytes(16).toString('hex')}.bin`
  )

  await encryptFile(thumbnailPath, encryptedThumbnailPath, unlockedKey)
  return encryptedThumbnailPath
}

async function existsNonEmpty(filePath: string) {
  try {
    const stat = await fs.stat(filePath)
    return stat.size > 0
  } catch {
    return false
  }
}

async function deleteLibraryThumbnail(movie: any) {
  try {
    if (movie?.poster_path) {
      await fs.remove(movie.poster_path)
      return
    }
    if (movie?.id) {
      const thumbnailsDir = path.join(app.getPath('userData'), 'thumbnails')
      const thumbnailPath = path.join(thumbnailsDir, `${movie.id}.jpg`)
      await fs.remove(thumbnailPath)
    }
  } catch (err) {
    logSecure('Failed to delete library thumbnail during secure import', err)
  }
}

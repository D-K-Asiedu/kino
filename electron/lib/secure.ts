import path from 'path'
import fs from 'fs-extra'
import crypto from 'crypto'
import { app } from 'electron'
import { pipeline } from 'stream/promises'
import * as db from './database'
import { generateThumbnailToPath } from './scraper'

const VAULT_DIR = () => path.join(app.getPath('userData'), 'secure-vault')
const CACHE_DIR = () => path.join(app.getPath('temp'), 'kino-secure-cache')
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

async function decryptFile(sourcePath: string, destPath: string, key: Buffer) {
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
    fs.createWriteStream(destPath)
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

export async function resetSecure() {
  logSecure('Reset secure folder')
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

  try {
    logSecure(`Encrypting file: ${sourcePath}`)
    await encryptFile(sourcePath, encryptedPath, unlockedKey)

    await deleteLibraryThumbnail(movie)

    db.addSecureItem({
      title: movie.title,
      original_title: movie.original_title,
      year: movie.year,
      plot: movie.plot,
      poster_path: null,
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

  const ext = path.extname(item.original_name || '') || '.mp4'
  const safeName = `${item.id}-${Date.now()}${ext}`
  const tempPath = path.join(CACHE_DIR(), safeName)

  await decryptFile(item.encrypted_path, tempPath, unlockedKey)
  cachePaths.add(tempPath)

  logSecure(`Prepared secure playback: ${tempPath}`)
  return { tempPath }
}

export async function releaseSecurePlayback(tempPath: string) {
  if (!tempPath) return
  cachePaths.delete(tempPath)
  try {
    await fs.promises.unlink(tempPath)
  } catch {
    // ignore
  }
}

export async function deleteSecureItem(itemId: number) {
  requireUnlocked()
  const item = db.getSecureItemById(itemId)
  if (!item) return

  await fs.promises.unlink(item.encrypted_path).catch(() => undefined)
  db.deleteSecureItem(itemId)
  await deleteCachedThumbnail(itemId)
}

const thumbnailCache = new Map<number, string>()

export async function getSecureThumbnail(itemId: number) {
  requireUnlocked()
  if (!unlockedKey) throw new Error('Secure folder is locked')

  const cached = thumbnailCache.get(itemId)
  if (cached && await existsNonEmpty(cached)) {
    return cached
  }

  const item = db.getSecureItemById(itemId)
  if (!item) throw new Error('Secure item not found')

  const ext = path.extname(item.original_name || '') || '.mp4'
  const tempVideoName = `${item.id}-${Date.now()}-${Math.random().toString(16).slice(2)}${ext}`
  const tempVideoPath = path.join(CACHE_DIR(), tempVideoName)
  const thumbnailPath = path.join(CACHE_DIR(), `thumb-${item.id}.jpg`)

  await decryptFile(item.encrypted_path, tempVideoPath, unlockedKey)
  cachePaths.add(tempVideoPath)

  try {
    const posterPath = await generateThumbnailToPath(tempVideoPath, thumbnailPath, undefined, { force: true })
    if (!posterPath) {
      throw new Error('Thumbnail generation failed')
    }
    cachePaths.add(thumbnailPath)
    thumbnailCache.set(itemId, posterPath)
    return posterPath
  } finally {
    cachePaths.delete(tempVideoPath)
    await fs.remove(tempVideoPath).catch(() => undefined)
  }
}

async function deleteCachedThumbnail(itemId: number | bigint) {
  const cached = thumbnailCache.get(Number(itemId))
  if (cached) {
    thumbnailCache.delete(Number(itemId))
    await fs.remove(cached).catch(() => undefined)
  }
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

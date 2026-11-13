import { spawn } from 'child_process'
import crypto from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { app } from 'electron'
import type { FfprobeData, FfprobeStream } from 'fluent-ffmpeg'
import { bundledFfmpegPath } from './encoders'
import { probeMedia } from './media'

// Subtitles come from two places: tracks inside the video file, and subtitle files beside it.
//
// The player gets each track in the form it can show best:
//   vtt  - plain text subtitles (SRT and similar), shown by Chromium's own <track> support
//   ass  - styled subtitles (fonts, colours, positioned signs, karaoke), drawn by libass in the player
//          together with the fonts attached to the video
//   pgs  - Blu-ray image subtitles, drawn from the .sup bytes
//
// Getting a track out of a video means reading the whole file, which takes a while for a large film,
// so all tracks (and fonts) are extracted in one pass and kept on disk: the next time the video is
// opened, its subtitles are there immediately.

export type SubtitleFormat = 'vtt' | 'ass' | 'pgs'

export interface SubtitleTrackInfo {
    /** Stream index for tracks inside the file; an opaque id for subtitle files beside it. */
    id: string
    language: string
    label: string
    codec: string
    format: SubtitleFormat
    isDefault: boolean
    /** Only covers signs/songs (forced subtitles), not dialogue. */
    isForced: boolean
    /** Comes from a separate file next to the video. */
    external: boolean
}

export type SubtitlePayload =
    | { format: 'vtt', text: string }
    | { format: 'ass', text: string, fonts: string[] }
    | { format: 'pgs', bytes: Buffer }

const ASS_CODECS = new Set(['ass', 'ssa'])
const PGS_CODEC = 'hdmv_pgs_subtitle'
// Image and broadcast formats the player can't draw; they can't be converted to text either.
const UNSUPPORTED_CODECS = new Set(['dvd_subtitle', 'dvb_subtitle', 'dvb_teletext', 'xsub', 'ttml', 'arib_caption'])
const FORCED_TITLE = /\b(signs?|songs?|forced)\b/i
const FONT_EXTENSIONS = new Set(['.ttf', '.otf', '.ttc', '.woff', '.woff2'])
const FONT_FILE = /^\d+\.(ttf|otf|ttc|woff2?)$/

const EXTERNAL_EXTENSIONS: Record<string, SubtitleFormat> = {
    '.srt': 'vtt', '.vtt': 'vtt', '.smi': 'vtt', '.sub': 'vtt',
    '.ass': 'ass', '.ssa': 'ass',
    '.sup': 'pgs',
}
const SUBTITLE_FOLDERS = new Set(['subs', 'sub', 'subtitles'])
const VIDEO_FILE = /\.(mkv|mp4|m4v|avi|mov|wmv|webm|ts|m2ts|mts|mpg|mpeg|flv|ogv|3gp|vob|divx|asf)$/i

// Extracted subtitles are kept up to this total size; the least recently used videos go first.
const CACHE_LIMIT_BYTES = 500 * 1024 * 1024

const ffmpegPath = bundledFfmpegPath || 'ffmpeg'

function streamFormat(codec: string): SubtitleFormat {
    return ASS_CODECS.has(codec) ? 'ass' : codec === PGS_CODEC ? 'pgs' : 'vtt'
}

function formatExtension(format: SubtitleFormat) {
    return format === 'pgs' ? 'sup' : format
}

// ---------------------------------------------------------------------------------------------
// Subtitle files beside the video
// ---------------------------------------------------------------------------------------------

const LANGUAGES: Record<string, string> = {
    en: 'eng', eng: 'eng', english: 'eng', es: 'spa', spa: 'spa', spanish: 'spa', fr: 'fre', fre: 'fre', fra: 'fre', french: 'fre',
    de: 'ger', ger: 'ger', deu: 'ger', german: 'ger', it: 'ita', ita: 'ita', italian: 'ita', pt: 'por', por: 'por', portuguese: 'por',
    ru: 'rus', rus: 'rus', russian: 'rus', ja: 'jpn', jpn: 'jpn', japanese: 'jpn', ko: 'kor', kor: 'kor', korean: 'kor',
    zh: 'chi', chi: 'chi', zho: 'chi', chinese: 'chi', ar: 'ara', ara: 'ara', arabic: 'ara', hi: 'hin', hin: 'hin', hindi: 'hin',
    nl: 'dut', dut: 'dut', nld: 'dut', dutch: 'dut', sv: 'swe', swe: 'swe', swedish: 'swe', no: 'nor', nor: 'nor', norwegian: 'nor',
    da: 'dan', dan: 'dan', danish: 'dan', fi: 'fin', fin: 'fin', finnish: 'fin', pl: 'pol', pol: 'pol', polish: 'pol',
    tr: 'tur', tur: 'tur', turkish: 'tur', el: 'gre', gre: 'gre', ell: 'gre', greek: 'gre', he: 'heb', heb: 'heb', hebrew: 'heb',
    cs: 'cze', cze: 'cze', ces: 'cze', czech: 'cze', hu: 'hun', hun: 'hun', hungarian: 'hun', ro: 'rum', rum: 'rum', ron: 'rum', romanian: 'rum',
    th: 'tha', tha: 'tha', thai: 'tha', vi: 'vie', vie: 'vie', vietnamese: 'vie', id: 'ind', ind: 'ind', indonesian: 'ind',
    uk: 'ukr', ukr: 'ukr', ukrainian: 'ukr', bg: 'bul', bul: 'bul', bulgarian: 'bul', hr: 'hrv', hrv: 'hrv', croatian: 'hrv',
    sr: 'srp', srp: 'srp', serbian: 'srp', sk: 'slo', slo: 'slo', slk: 'slo', slovak: 'slo', sl: 'slv', slv: 'slv', slovenian: 'slv',
    ms: 'may', may: 'may', msa: 'may', malay: 'may', fa: 'per', per: 'per', fas: 'per', persian: 'per', bn: 'ben', ben: 'ben', bengali: 'ben',
    ta: 'tam', tam: 'tam', tamil: 'tam', te: 'tel', tel: 'tel', telugu: 'tel', et: 'est', est: 'est', estonian: 'est',
    lv: 'lav', lav: 'lav', latvian: 'lav', lt: 'lit', lit: 'lit', lithuanian: 'lit', ca: 'cat', cat: 'cat', catalan: 'cat',
    fil: 'fil', filipino: 'fil', tagalog: 'fil', is: 'ice', ice: 'ice', isl: 'ice', icelandic: 'ice',
}

// "eng" -> "English": the first full name listed for each code.
const LANGUAGE_NAMES: Record<string, string> = {}
for (const [word, code] of Object.entries(LANGUAGES)) {
    if (word.length > 3 && !LANGUAGE_NAMES[code]) LANGUAGE_NAMES[code] = word[0].toUpperCase() + word.slice(1)
}

interface ExternalSubtitle extends SubtitleTrackInfo {
    path: string
}

function describeExternal(subtitlePath: string, videoBase: string): ExternalSubtitle {
    const ext = path.extname(subtitlePath).toLowerCase()
    let name = path.basename(subtitlePath, path.extname(subtitlePath))
    // "Movie.en.forced.srt" next to "Movie.mkv": what's left after the video's name describes the track.
    if (name.toLowerCase().startsWith(videoBase.toLowerCase())) name = name.slice(videoBase.length)
    const words = name.split(/[\s._\-()[\]]+/).filter(Boolean)
    // Two-letter words are only read as a language code when they stand alone ("Movie.no.srt"), so
    // ordinary words in a longer name ("It Is No Dream") aren't mistaken for one.
    const languageWord = words.find(word => LANGUAGES[word.toLowerCase()] && (word.length > 2 || words.length <= 2))
    const language = languageWord ? LANGUAGES[languageWord.toLowerCase()] : 'und'
    // The label is whatever else the name says ("British SDH"); a bare code ("eng.srt") becomes the language's name.
    const described = words.filter(word => word !== languageWord && !/^\d+$/.test(word)).join(' ').trim()
    const label = described || (language !== 'und' ? LANGUAGE_NAMES[language] : '')
    return {
        id: `x${crypto.createHash('sha1').update(subtitlePath).digest('hex').slice(0, 12)}`,
        path: subtitlePath,
        language,
        label: label || path.basename(subtitlePath),
        codec: ext.slice(1),
        format: EXTERNAL_EXTENSIONS[ext],
        isDefault: false,
        isForced: FORCED_TITLE.test(name),
        external: true,
    }
}

/** Subtitle files that belong to a video: same name beside it, or inside a Subs folder. */
async function findExternalSubtitles(filePath: string): Promise<ExternalSubtitle[]> {
    const dir = path.dirname(filePath)
    const videoBase = path.basename(filePath, path.extname(filePath))
    const entries = await fs.promises.readdir(dir, { withFileTypes: true }).catch(() => [])
    const isSubtitle = (name: string) => path.extname(name).toLowerCase() in EXTERNAL_EXTENSIONS
    const matchesVideo = (name: string) => name.toLowerCase().startsWith(videoBase.toLowerCase())
    // A lone video in its folder owns every subtitle in the Subs folder; otherwise names must match.
    const onlyVideo = entries.filter(entry => entry.isFile() && VIDEO_FILE.test(entry.name)).length <= 1

    const found: string[] = []
    const names = new Set(entries.map(entry => entry.name.toLowerCase()))
    for (const entry of entries) {
        if (entry.isFile() && isSubtitle(entry.name) && matchesVideo(entry.name)) {
            // A .sub with an .idx beside it is VobSub (images), which can't be shown.
            if (/\.sub$/i.test(entry.name) && names.has(entry.name.toLowerCase().replace(/\.sub$/, '.idx'))) continue
            found.push(path.join(dir, entry.name))
        } else if (entry.isDirectory() && SUBTITLE_FOLDERS.has(entry.name.toLowerCase())) {
            const folder = path.join(dir, entry.name)
            const inner = await fs.promises.readdir(folder, { withFileTypes: true }).catch(() => [])
            for (const item of inner) {
                if (item.isFile() && isSubtitle(item.name) && (onlyVideo || matchesVideo(item.name))) {
                    found.push(path.join(folder, item.name))
                } else if (item.isDirectory() && item.name.toLowerCase() === videoBase.toLowerCase()) {
                    // Subs/<episode name>/<language>.srt, the usual layout for a season in one folder.
                    const episode = path.join(folder, item.name)
                    const files = await fs.promises.readdir(episode).catch(() => [] as string[])
                    found.push(...files.filter(isSubtitle).map(name => path.join(episode, name)))
                }
            }
        }
    }
    return found.sort().map(subtitlePath => describeExternal(subtitlePath, videoBase))
}

/** Text of a subtitle file. They are often not UTF-8, which would show as garbled accents. */
function decodeText(bytes: Buffer): string {
    if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes)
    if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes)
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    } catch {
        // Not UTF-8: Windows-1252 is by far the most common encoding of older subtitle files.
        return new TextDecoder('windows-1252').decode(bytes)
    }
}

function srtToVtt(srt: string): string {
    const body = srt
        .replace(/^﻿/, '')
        .replace(/\r\n?/g, '\n')
        // 0:01:02,500 -> 00:01:02.500
        .replace(/(\d{1,2}):(\d{2}):(\d{2})[,.](\d{3})/g, (_match, h: string, m: string, s: string, ms: string) => `${h.padStart(2, '0')}:${m}:${s}.${ms}`)
        // Positioning tags from ASS that some SRT files carry; WebVTT would show them as text.
        .replace(/\{\\[^}]*\}/g, '')
    return `WEBVTT\n\n${body}`
}

function runFfmpeg(args: string[], cwd?: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const proc = spawn(ffmpegPath, ['-hide_banner', '-nostdin', '-v', 'error', '-y', ...args], { cwd, stdio: ['ignore', 'ignore', 'pipe'] })
        let stderr = ''
        proc.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-2000) })
        proc.on('error', reject)
        proc.on('close', code => (code === 0 ? resolve() : reject(new Error(stderr.trim().split('\n').pop() || `ffmpeg exited with ${code}`))))
    })
}

/** Convert a text subtitle file of any format ffmpeg reads to WebVTT. */
async function convertToVtt(text: string, extension: string): Promise<string> {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'kino-sub-'))
    try {
        await fs.promises.writeFile(path.join(dir, `in${extension}`), text, 'utf-8')
        await runFfmpeg(['-i', `in${extension}`, '-f', 'webvtt', 'out.vtt'], dir)
        return await fs.promises.readFile(path.join(dir, 'out.vtt'), 'utf-8')
    } finally {
        await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => undefined)
    }
}

async function readExternalSubtitle(subtitle: ExternalSubtitle, plainText: boolean): Promise<SubtitlePayload> {
    const bytes = await fs.promises.readFile(subtitle.path)
    if (subtitle.format === 'pgs') return { format: 'pgs', bytes }
    const text = decodeText(bytes)
    const extension = path.extname(subtitle.path).toLowerCase()
    if (subtitle.format === 'ass' && !plainText) return { format: 'ass', text, fonts: [] }
    if (extension === '.vtt') return { format: 'vtt', text }
    if (extension === '.srt') return { format: 'vtt', text: srtToVtt(text) }
    return { format: 'vtt', text: await convertToVtt(text, extension) }
}

// ---------------------------------------------------------------------------------------------
// Tracks inside the video
// ---------------------------------------------------------------------------------------------

function embeddedTracks(data: FfprobeData): SubtitleTrackInfo[] {
    return data.streams
        .filter(s => s.codec_type === 'subtitle' && !UNSUPPORTED_CODECS.has(s.codec_name || ''))
        .map((s, i) => ({
            id: String(s.index),
            language: s.tags?.language || 'und',
            label: s.tags?.title || `Subtitle ${i + 1}`,
            codec: s.codec_name || 'unknown',
            format: streamFormat(s.codec_name || ''),
            isDefault: s.disposition?.default === 1,
            isForced: s.disposition?.forced === 1 || FORCED_TITLE.test(s.tags?.title || ''),
            external: false,
        }))
}

function fontAttachments(data: FfprobeData): { index: number, fileName: string }[] {
    const fonts: { index: number, fileName: string }[] = []
    for (const stream of data.streams as FfprobeStream[]) {
        if (stream.codec_type !== 'attachment') continue
        let ext = path.extname(String(stream.tags?.filename ?? '')).toLowerCase()
        if (!FONT_EXTENSIONS.has(ext)) {
            if (stream.codec_name !== 'ttf' && stream.codec_name !== 'otf') continue
            ext = `.${stream.codec_name}`
        }
        // Named by stream index, never by the name stored in the file, which could point anywhere.
        fonts.push({ index: stream.index, fileName: `${stream.index}${ext}` })
    }
    return fonts
}

/** Videos decrypted from the secure folder live here; nothing derived from them may outlast playback. */
function isPrivateFile(filePath: string) {
    return path.resolve(filePath).startsWith(path.join(app.getPath('temp'), 'kino-secure-cache') + path.sep)
}

const cacheRoot = () => path.join(app.getPath('userData'), 'cache', 'subtitles')
const privateRoot = () => path.join(os.tmpdir(), `kino-subs-${process.pid}`)

interface ExtractedSubtitles {
    key: string
    dir: string
    fonts: string[]
}

// Folders the font URLs may be served from, by cache key.
const servedDirs = new Map<string, string>()
const extractions = new Map<string, Promise<ExtractedSubtitles>>()

async function extractionKey(filePath: string) {
    const stats = await fs.promises.stat(filePath)
    return crypto.createHash('sha1').update(`${filePath}\0${stats.size}\0${stats.mtimeMs}`).digest('hex').slice(0, 24)
}

async function extractInto(filePath: string, dir: string, data: FfprobeData) {
    const tracks = embeddedTracks(data)
    const fonts = tracks.some(track => track.format === 'ass') ? fontAttachments(data) : []
    await fs.promises.mkdir(path.join(dir, 'fonts'), { recursive: true })

    const outputArgs = (track: SubtitleTrackInfo) => {
        const file = `${track.id}.${formatExtension(track.format)}`
        return track.format === 'ass' ? ['-map', `0:${track.id}`, '-c:s', 'copy', '-f', 'ass', file]
            : track.format === 'pgs' ? ['-map', `0:${track.id}`, '-c:s', 'copy', '-f', 'sup', file]
                : ['-map', `0:${track.id}`, '-c:s', 'webvtt', '-f', 'webvtt', file]
    }
    const fontArgs = fonts.flatMap(font => [`-dump_attachment:${font.index}`, path.join('fonts', font.fileName)])

    try {
        // One pass over the file for everything: reading it is what takes the time, not the tracks.
        await runFfmpeg([...fontArgs, '-i', filePath, ...tracks.flatMap(outputArgs)], dir)
    } catch (err) {
        console.warn('[subtitles] extracting all tracks at once failed, extracting them one by one:', (err as Error).message)
        let extracted = 0
        for (const track of tracks) {
            const args = [...(extracted === 0 ? fontArgs : []), '-i', filePath, ...outputArgs(track)]
            await runFfmpeg(args, dir).then(() => extracted++, error => console.warn(`[subtitles] track ${track.id} failed:`, (error as Error).message))
        }
        if (extracted === 0) throw err
    }

    const written = new Set(await fs.promises.readdir(path.join(dir, 'fonts')).catch(() => [] as string[]))
    const manifest = { fonts: fonts.map(font => font.fileName).filter(name => written.has(name)) }
    await fs.promises.writeFile(path.join(dir, 'complete.json'), JSON.stringify(manifest))
    return manifest.fonts
}

async function extractSubtitles(filePath: string): Promise<ExtractedSubtitles> {
    const key = await extractionKey(filePath)
    const isPrivate = isPrivateFile(filePath)
    const dir = path.join(isPrivate ? privateRoot() : cacheRoot(), key)
    const manifestPath = path.join(dir, 'complete.json')

    try {
        const manifest = JSON.parse(await fs.promises.readFile(manifestPath, 'utf-8')) as { fonts: string[] }
        // Mark as recently used, for pruning.
        const now = new Date()
        void fs.promises.utimes(manifestPath, now, now).catch(() => undefined)
        servedDirs.set(key, dir)
        return { key, dir, fonts: manifest.fonts ?? [] }
    } catch {
        // Not extracted yet.
    }

    const partial = `${dir}.partial-${process.pid}`
    await fs.promises.rm(partial, { recursive: true, force: true })
    try {
        const fonts = await extractInto(filePath, partial, await probeMedia(filePath))
        await fs.promises.rm(dir, { recursive: true, force: true })
        await fs.promises.rename(partial, dir)
        servedDirs.set(key, dir)
        if (!isPrivate) void pruneSubtitleCache()
        return { key, dir, fonts }
    } catch (err) {
        await fs.promises.rm(partial, { recursive: true, force: true }).catch(() => undefined)
        throw err
    }
}

function extractedSubtitles(filePath: string): Promise<ExtractedSubtitles> {
    let pending = extractions.get(filePath)
    if (!pending) {
        const started = extractSubtitles(filePath)
        pending = started
        extractions.set(filePath, started)
        // Nothing is remembered here once it's done: the folder on disk is the cache.
        const forget = () => {
            if (extractions.get(filePath) === started) extractions.delete(filePath)
        }
        started.then(forget, forget)
    }
    return pending
}

/** Remove the least recently used videos' subtitles once the cache is over its size limit. */
export async function pruneSubtitleCache() {
    try {
        const root = cacheRoot()
        const names = await fs.promises.readdir(root).catch(() => [] as string[])
        const entries: { dir: string, usedAt: number, size: number }[] = []
        for (const name of names) {
            const dir = path.join(root, name)
            const partialOwner = name.match(/\.partial-(\d+)$/)
            if (partialOwner) {
                // Left behind by a run that was interrupted.
                if (Number(partialOwner[1]) !== process.pid) await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => undefined)
                continue
            }
            const manifest = await fs.promises.stat(path.join(dir, 'complete.json')).catch(() => null)
            if (!manifest) {
                await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => undefined)
                continue
            }
            let size = 0
            for (const folder of [dir, path.join(dir, 'fonts')]) {
                for (const file of await fs.promises.readdir(folder).catch(() => [] as string[])) {
                    size += (await fs.promises.stat(path.join(folder, file)).catch(() => null))?.size ?? 0
                }
            }
            entries.push({ dir, usedAt: manifest.mtimeMs, size })
        }

        let total = entries.reduce((sum, entry) => sum + entry.size, 0)
        for (const entry of entries.sort((a, b) => a.usedAt - b.usedAt)) {
            if (total <= CACHE_LIMIT_BYTES) break
            await fs.promises.rm(entry.dir, { recursive: true, force: true }).catch(() => undefined)
            servedDirs.delete(path.basename(entry.dir))
            total -= entry.size
        }
    } catch (err) {
        console.warn('[subtitles] pruning the cache failed:', err)
    }
}

/** Remove subtitles extracted from secure-folder videos; called when playback ends and on quit. */
export async function removePrivateSubtitles() {
    const root = privateRoot()
    for (const [key, dir] of servedDirs) {
        if (dir.startsWith(root + path.sep)) servedDirs.delete(key)
    }
    await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => undefined)
}

// ---------------------------------------------------------------------------------------------
// What the player calls
// ---------------------------------------------------------------------------------------------

export async function listSubtitleTracks(filePath: string): Promise<SubtitleTrackInfo[]> {
    const [data, external] = await Promise.all([
        probeMedia(filePath),
        // The secure folder holds single decrypted files; there is nothing beside them.
        isPrivateFile(filePath) ? [] : findExternalSubtitles(filePath),
    ])
    return [...embeddedTracks(data), ...external.map(({ path: _path, ...track }) => track)]
}

/**
 * One subtitle track, ready for the player. `plainText` asks for styled (ASS) subtitles as plain
 * WebVTT instead, for when the styled renderer can't run.
 */
export async function getSubtitle(filePath: string, trackId: string, plainText = false): Promise<SubtitlePayload> {
    if (trackId.startsWith('x')) {
        const subtitle = (await findExternalSubtitles(filePath)).find(track => track.id === trackId)
        if (!subtitle) throw new Error('Subtitle file not found')
        return readExternalSubtitle(subtitle, plainText)
    }

    const track = embeddedTracks(await probeMedia(filePath)).find(t => t.id === trackId)
    if (!track) throw new Error(`No subtitle track ${trackId}`)
    const extracted = await extractedSubtitles(filePath)
    const file = path.join(extracted.dir, `${track.id}.${formatExtension(track.format)}`)

    if (track.format === 'pgs') return { format: 'pgs', bytes: await fs.promises.readFile(file) }
    const text = await fs.promises.readFile(file, 'utf-8')
    if (track.format === 'vtt') return { format: 'vtt', text }
    if (plainText) return { format: 'vtt', text: await convertToVtt(text, '.ass') }
    return {
        format: 'ass',
        text,
        fonts: extracted.fonts.map(name => `kino-stream://fonts/${extracted.key}/${name}`),
    }
}

/** Start extracting a file's subtitles ahead of time, e.g. when the subtitle menu opens. */
export function prefetchSubtitles(filePath: string) {
    probeMedia(filePath)
        .then(data => (embeddedTracks(data).length > 0 ? extractedSubtitles(filePath) : undefined))
        .catch(() => undefined)
}

const FONT_TYPES: Record<string, string> = {
    '.ttf': 'font/ttf', '.otf': 'font/otf', '.ttc': 'font/collection', '.woff': 'font/woff', '.woff2': 'font/woff2',
}

/** Handler for kino-stream://fonts/<key>/<file>: a font attached to a video, for the styled subtitle renderer. */
export async function handleFontRequest(url: URL): Promise<Response> {
    const headers = { 'Access-Control-Allow-Origin': '*' }
    const [, key, name] = url.pathname.split('/')
    const dir = servedDirs.get(key ?? '')
    if (!dir || !name || !FONT_FILE.test(name)) return new Response('Not found', { status: 404, headers })
    try {
        const data = await fs.promises.readFile(path.join(dir, 'fonts', name))
        return new Response(data, { status: 200, headers: { ...headers, 'Content-Type': FONT_TYPES[path.extname(name)] ?? 'application/octet-stream' } })
    } catch {
        return new Response('Not found', { status: 404, headers })
    }
}

import path from 'path'

/**
 * Works out what each video is from its filename and the folders it sits in: a movie
 * ("Michael (2026) [1080p]") or an episode of a show ("TBBT/s2/The.Big.Bang.Theory.S02E05…").
 * Pure string work, no file access, so it can re-run over the whole library cheaply.
 */

export interface Classification {
    /** Readable title used everywhere a single line is shown (player, toasts, search). */
    title: string
    year: number | null
    show_title: string | null
    season: number | null
    episode: number | null
    episode_title: string | null
}

interface ParsedName {
    /** Text before the episode/season marker, or the movie title. */
    name: string
    year: number | null
    season: number | null
    episode: number | null
    /** True when only a season was found ("Show Season 4 - Finale"). */
    seasonOnly: boolean
    /** Text after the episode marker, e.g. "Judgment" in "S04E17-Judgment". */
    rest: string
}

// Release tags that end the useful part of a name. Kept to tokens that are never real
// title words ("max", "web", "dv" and friends are left out so "Mad Max" survives).
const JUNK = new RegExp(
    '(?:^|[\\s\\-])(?:' + [
        '\\d{3,4}[pi]', '4k', 'uhd', 'hdr10\\+?', 'hdr', 'dovi', 'sdr', '10[- ]?bit', '8[- ]?bit',
        'x26[45]', 'h[ .]?26[45]', 'hevc', 'avc', 'av1', 'xvid', 'divx', 'vp9',
        'web[- ]?dl', 'web[- ]?rip', 'bluray', 'blu[- ]ray', 'bdrip', 'brrip', 'bdremux', 'remux',
        'dvdrip', 'hdtv', 'hdrip', 'amzn', 'dsnp', 'hmax', 'atvp', 'pcok',
        'aac(?:\\d(?:[ .]\\d)?)?', 'e?ac3', 'e-ac-3', 'ddp?(?:\\d(?:[ .]\\d)?)?', 'dts(?:-hd)?', 'truehd', 'atmos', 'flac',
        '\\d+ch', '[257][ .][01]', 'repack', 'proper', 'internal', 'esubs?', 'dual[- ]audio', 'yts(?:\\s.*)?', 'yify', 'rarbg',
    ].join('|') + ')(?=$|[\\s\\-])',
    'i'
)

const YEAR = /(?:^|[\s(])((?:19|20)\d{2})(?=$|[\s)])/g

// Episode markers, most specific first. Each captures (season?, episode).
const EPISODE_PATTERNS: { re: RegExp; season: number | null; episode: number }[] = [
    // S04E17, S02 E01, S1E13, S01E01-E02
    { re: /(?:^|[\s\-])S(\d{1,2})\s*[-.]?\s*E(\d{1,3})(?:-?E\d{1,3})?(?=$|[^a-z0-9])/i, season: 1, episode: 2 },
    // 1x05
    { re: /(?:^|[\s\-])(\d{1,2})x(\d{2,3})(?=$|[^a-z0-9])/i, season: 1, episode: 2 },
    // Season 1 Episode 3
    { re: /(?:^|[\s\-])Season\s*(\d{1,2})\s*[-,]?\s*(?:Episode|Ep\.?)\s*(\d{1,3})(?=$|[^a-z0-9])/i, season: 1, episode: 2 },
    // "S1 - 01" (common anime naming)
    { re: /(?:^|[\s\-])S(\d{1,2})\s+-\s+(\d{1,3})(?:v\d)?(?=$|[^a-z0-9])/i, season: 1, episode: 2 },
    // Episode 5, Ep 05, E05
    { re: /(?:^|[\s\-])(?:Episode|Ep\.?)\s*(\d{1,3})(?=$|[^a-z0-9])/i, season: null, episode: 1 },
    { re: /(?:^|[\s\-])E(\d{2,3})(?=$|[^a-z0-9])/i, season: null, episode: 1 },
    // "Show - 05" (absolute anime numbering)
    { re: /\s-\s(\d{1,3})(?:v\d)?(?=$|\s)/, season: null, episode: 1 },
]

const SEASON_ONLY = /(?:^|[\s\-])(?:Season\s*(\d{1,2})|S(\d{1,2}))(?=$|[^a-z0-9])/i

/** "s1", "Season 2", "Season4Part1", "Series 3", "Specials" */
const SEASON_FOLDER = /^(?:(?:season|series|s)\s*(\d{1,3})(?:\s*(?:part|pt|p)\s*\d+)?|specials?|extras)$/i

function normalize(raw: string) {
    let s = raw
    // Group tags, CRC hashes and the like: [Kayoanime], [7EA91300], {tag}
    s = s.replace(/\[[^\]]*\]|\{[^}]*\}/g, ' ')
    // Keep "(2026)" as a bare year, drop other parenthesised notes
    s = s.replace(/\(((?:19|20)\d{2})\)/g, ' $1 ').replace(/\([^)]*\)/g, ' ')
    s = s.replace(/_/g, ' ')
    // Dotted release names ("The.Big.Bang.Theory.S02E01") have no spaces of their own
    if (!/\s/.test(s.trim())) s = s.replace(/\./g, ' ')
    return s.replace(/\s+/g, ' ').trim()
}

function cutAtJunk(s: string) {
    const m = JUNK.exec(s)
    return m ? s.slice(0, m.index) : s
}

function tidy(s: string) {
    return s
        .replace(/^[\s\-–—.,:;]+|[\s\-–—.,:;]+$/g, '')
        .replace(/\s+/g, ' ')
        .trim()
}

/** Title-case names that arrive all lowercase ("the office" → "The Office"). */
function smartCase(s: string) {
    if (s !== s.toLowerCase()) return s
    return s.replace(/(^|\s)(\p{L})/gu, (_, sp, ch) => sp + ch.toUpperCase())
}

function findYear(s: string): { year: number; index: number } | null {
    let last: { year: number; index: number } | null = null
    for (const m of s.matchAll(YEAR)) {
        const index = m.index! + m[0].indexOf(m[1])
        if (index === 0) continue // "2012.mkv" is a title, not a year
        last = { year: Number(m[1]), index }
    }
    return last
}

function stripTrailingYear(s: string) {
    return s.replace(/\s(?:19|20)\d{2}$/, '')
}

export function parseName(raw: string): ParsedName {
    const s = normalize(raw)

    for (const pattern of EPISODE_PATTERNS) {
        const m = pattern.re.exec(s)
        if (!m) continue
        const before = s.slice(0, m.index)
        const yearInfo = findYear(before)
        return {
            name: tidy(stripTrailingYear(tidy(cutAtJunk(before)))),
            year: yearInfo?.year ?? null,
            season: pattern.season ? Number(m[pattern.season]) : null,
            episode: Number(m[pattern.episode]),
            seasonOnly: false,
            rest: tidy(cutAtJunk(s.slice(m.index + m[0].length))),
        }
    }

    const seasonMatch = SEASON_ONLY.exec(s)
    if (seasonMatch) {
        const before = s.slice(0, seasonMatch.index)
        return {
            name: tidy(stripTrailingYear(tidy(cutAtJunk(before)))),
            year: findYear(before)?.year ?? null,
            season: Number(seasonMatch[1] ?? seasonMatch[2]),
            episode: null,
            seasonOnly: true,
            rest: tidy(cutAtJunk(s.slice(seasonMatch.index + seasonMatch[0].length))),
        }
    }

    const yearInfo = findYear(s)
    const name = yearInfo ? s.slice(0, yearInfo.index) : cutAtJunk(s)
    return {
        name: tidy(cutAtJunk(name)),
        year: yearInfo?.year ?? null,
        season: null,
        episode: null,
        seasonOnly: false,
        rest: '',
    }
}

type FolderInfo =
    | { kind: 'season'; season: number | null }
    | { kind: 'show'; name: string; season: number | null }
    | { kind: 'plain'; name: string }

function parseFolder(dirName: string): FolderInfo {
    const s = normalize(dirName)
    const seasonFolder = SEASON_FOLDER.exec(s)
    if (seasonFolder) {
        return { kind: 'season', season: seasonFolder[1] ? Number(seasonFolder[1]) : 0 }
    }
    const parsed = parseName(dirName)
    // "The Gentlemen S02 (2026) 1080p…", "The.Legend.of.Vox.Machina.S04", "Lanterns.2026.S01E03…"
    if ((parsed.season !== null || parsed.episode !== null) && parsed.name) {
        return { kind: 'show', name: parsed.name, season: parsed.season }
    }
    return { kind: 'plain', name: tidy(cutAtJunk(stripTrailingYear(s))) }
}

const STOP_WORDS = new Set(['the', 'a', 'an', 'of', 'and', 'on', 'in', 'no', 'to'])

function words(s: string) {
    return s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(w => w && !STOP_WORDS.has(w))
}

export function showKey(name: string) {
    return name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

function hasMarker(parsed: ParsedName) {
    return parsed.episode !== null || parsed.seasonOnly
}

function pad(n: number) {
    return String(n).padStart(2, '0')
}

function episodeTitleLine(show: string, season: number | null, episode: number | null, episodeTitle: string | null) {
    const code = season !== null && episode !== null
        ? `S${pad(season)}E${pad(episode)}`
        : season !== null
            ? `Season ${season}`
            : episode !== null
                ? `Episode ${episode}`
                : null
    return [show, code, episodeTitle].filter(Boolean).join(' · ')
}

interface FileInput {
    id: number
    file_path: string
}

interface Candidate {
    parsed: ParsedName
    isEpisode: boolean
    season: number | null
    /** Folder-derived group, when the folders say which show this is. */
    groupDir: string | null
    folderName: string | null
}

/**
 * Classifies every library file at once, because a file's show often only becomes clear
 * from its neighbours: "[Kayoanime] - S03E01" in "Titan Attack/Season3" belongs to the same
 * show as "Shingeki no Kyojin S1 - 01" in "Titan Attack/Season1".
 */
export function classifyLibrary(files: FileInput[], watchRoots: string[]): Map<number, Classification> {
    const rootFor = (filePath: string) => {
        let best: string | null = null
        for (const root of watchRoots) {
            const rel = path.relative(root, filePath)
            if (!rel.startsWith('..') && !path.isAbsolute(rel) && (!best || root.length > best.length)) best = root
        }
        return best
    }

    // Folders that hold season folders are show folders, even for loose files directly inside them.
    const knownShowDirs = new Set<string>()

    const analyse = (file: FileInput): Candidate => {
        const parsed = parseName(path.parse(file.file_path).name)
        const root = rootFor(file.file_path)
        let season = parsed.season
        let sawSeasonFolder = false
        let groupDir: string | null = null
        let folderName: string | null = null

        let dir = path.dirname(file.file_path)
        while (root && dir.length > root.length && path.relative(root, dir) !== '') {
            const info = parseFolder(path.basename(dir))
            if (info.kind === 'season') {
                season ??= info.season
                sawSeasonFolder = true
            } else if (info.kind === 'show') {
                season ??= info.season
                // Several "Show S01…", "Show S02…" folders side by side are one show
                groupDir = path.join(path.dirname(dir), `\0${showKey(info.name)}`)
                folderName = info.name
                break
            } else {
                if (sawSeasonFolder || knownShowDirs.has(dir) || (!parsed.name && hasMarker(parsed))) {
                    groupDir = dir
                    folderName = info.name
                }
                break
            }
            dir = path.dirname(dir)
        }

        if (sawSeasonFolder && groupDir && !groupDir.includes('\0')) knownShowDirs.add(groupDir)

        const isEpisode = parsed.episode !== null || parsed.seasonOnly || sawSeasonFolder || groupDir !== null

        return { parsed, isEpisode, season, groupDir, folderName }
    }

    // Two passes: the first finds show folders, the second lets loose files join them.
    files.forEach(analyse)
    const candidates = files.map(file => ({ file, c: analyse(file) }))

    // Group episodes, then pick each group's display name.
    const groups = new Map<string, { folderName: string | null; members: typeof candidates }>()
    for (const entry of candidates) {
        const { c } = entry
        if (!c.isEpisode) continue
        const key = c.groupDir ?? (c.parsed.name && hasMarker(c.parsed) ? `name:${showKey(c.parsed.name)}` : null)
        if (!key) {
            c.isEpisode = false
            continue
        }
        const group = groups.get(key) ?? { folderName: c.folderName, members: [] }
        group.members.push(entry)
        groups.set(key, group)
    }

    const showNameFor = new Map<number, string>()
    const canonicalByKey = new Map<string, string>()
    for (const group of groups.values()) {
        const counts = new Map<string, { name: string; count: number }>()
        for (const { c } of group.members) {
            // "Pilot.mkv" in "Show/Season 1" names an episode, not the show
            if (!c.parsed.name || !hasMarker(c.parsed)) continue
            const k = showKey(c.parsed.name)
            const entry = counts.get(k) ?? { name: c.parsed.name, count: 0 }
            entry.count++
            counts.set(k, entry)
        }
        const ranked = [...counts.values()].sort((a, b) => b.count - a.count)
        // Prefer a filename name that shares a word with the folder ("Attack on Titan" for
        // "Titan Attack") over one that doesn't ("Shingeki no Kyojin").
        const folderWords = new Set(words(group.folderName ?? ''))
        const matching = ranked.find(r => words(r.name).some(w => folderWords.has(w)))
        let name = smartCase((matching ?? ranked[0])?.name ?? group.folderName ?? '')
        if (!name) continue
        const canonical = canonicalByKey.get(showKey(name))
        if (canonical) name = canonical
        else canonicalByKey.set(showKey(name), name)
        for (const { file } of group.members) showNameFor.set(file.id, name)
    }

    const videosPerDir = new Map<string, number>()
    for (const file of files) {
        const dir = path.dirname(file.file_path)
        videosPerDir.set(dir, (videosPerDir.get(dir) ?? 0) + 1)
    }

    /**
     * Downloads usually come as "Inception (2010)/<file>". When the file name gives no year
     * ("movie.mkv", "abc-inception-1080p.mkv") but its folder holds only that video and names
     * a year, the folder is the better source for the title.
     */
    const movieFromFolder = (filePath: string): { title: string; year: number } | null => {
        const dir = path.dirname(filePath)
        if (videosPerDir.get(dir) !== 1 || watchRoots.some(root => path.relative(root, dir) === '')) return null
        const folder = parseName(path.basename(dir))
        if (folder.year === null || !folder.name || hasMarker(folder)) return null
        return { title: smartCase(folder.name), year: folder.year }
    }

    const result = new Map<number, Classification>()
    for (const { file, c } of candidates) {
        const show = showNameFor.get(file.id)
        if (show) {
            const titleText = hasMarker(c.parsed) ? c.parsed.rest : c.parsed.name
            const episodeTitle = titleText && /\p{L}/u.test(titleText) ? smartCase(titleText) : null
            result.set(file.id, {
                title: episodeTitleLine(show, c.season, c.parsed.episode, episodeTitle),
                year: c.parsed.year,
                show_title: show,
                season: c.season,
                episode: c.parsed.episode,
                episode_title: episodeTitle,
            })
        } else {
            // Not an episode: a movie. Fall back to the raw file name if parsing left nothing.
            const name = hasMarker(c.parsed)
                ? [c.parsed.name, c.parsed.rest].filter(Boolean).join(' ')
                : c.parsed.name
            const fromFolder = c.parsed.year === null ? movieFromFolder(file.file_path) : null
            result.set(file.id, {
                title: fromFolder?.title ?? smartCase(name || path.parse(file.file_path).name),
                year: fromFolder?.year ?? c.parsed.year,
                show_title: null,
                season: null,
                episode: null,
                episode_title: null,
            })
        }
    }
    return result
}

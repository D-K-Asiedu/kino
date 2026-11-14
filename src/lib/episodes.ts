/**
 * Episode helpers shared by the renderer and the main process (Home's "Continue watching"),
 * so both agree on episode order and what "watched" means.
 */

export interface EpisodeLike {
    id: number
    title: string
    show_title?: string | null
    season?: number | null
    episode?: number | null
    episode_title?: string | null
    progress?: number | null
    duration?: number | null
    last_watched?: string | null
}

/** Past this fraction an episode counts as watched (credits are usually the last ~10%). */
export const WATCHED_FRACTION = 0.9

export function watchedFraction(ep: EpisodeLike) {
    return ep.progress && ep.duration ? Math.min(1, ep.progress / ep.duration) : 0
}

export function isWatched(ep: EpisodeLike) {
    return watchedFraction(ep) >= WATCHED_FRACTION
}

export function isInProgress(ep: EpisodeLike) {
    return (ep.progress ?? 0) > 5 && !isWatched(ep)
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/** Season, then episode number; specials and unnumbered files after the numbered ones. */
export function compareEpisodes(a: EpisodeLike, b: EpisodeLike) {
    const sa = a.season ?? Number.MAX_SAFE_INTEGER
    const sb = b.season ?? Number.MAX_SAFE_INTEGER
    if (sa !== sb) return sa - sb
    const ea = a.episode ?? Number.MAX_SAFE_INTEGER
    const eb = b.episode ?? Number.MAX_SAFE_INTEGER
    if (ea !== eb) return ea - eb
    return collator.compare(a.episode_title ?? a.title, b.episode_title ?? b.title)
}

export function sortEpisodes<T extends EpisodeLike>(episodes: T[]) {
    return [...episodes].sort(compareEpisodes)
}

export interface NextUp<T> {
    episode: T
    /** True when this episode has a saved position to resume from. */
    resume: boolean
}

/**
 * What "Continue" should play: the last-watched episode if it isn't finished, otherwise the
 * next unwatched one after it. Null once the latest episode is watched and nothing follows.
 * `episodes` must already be in episode order.
 */
export function pickNextUp<T extends EpisodeLike>(episodes: T[]): NextUp<T> | null {
    if (episodes.length === 0) return null
    let latest: T | null = null
    for (const ep of episodes) {
        if (ep.last_watched && (!latest || ep.last_watched > (latest.last_watched ?? ''))) latest = ep
    }
    if (!latest) return { episode: episodes[0], resume: false }
    if (!isWatched(latest)) return { episode: latest, resume: isInProgress(latest) }
    const after = episodes.slice(episodes.indexOf(latest) + 1).find(ep => !isWatched(ep))
    return after ? { episode: after, resume: isInProgress(after) } : null
}

/** "S4 E17", "S4", "E5", or null when the file carries no numbers. */
export function episodeCode(ep: EpisodeLike) {
    if (ep.season != null && ep.episode != null) return `S${ep.season} E${ep.episode}`
    if (ep.season != null) return ep.season === 0 ? 'Special' : `S${ep.season}`
    if (ep.episode != null) return `E${ep.episode}`
    return null
}

/** The episode's own name: "Judgment", "Episode 17", or the file's title as a last resort. */
export function episodeName(ep: EpisodeLike) {
    if (ep.episode_title) return ep.episode_title
    if (ep.episode != null) return `Episode ${ep.episode}`
    return ep.title
}

/** One line under a show name: "S4 E17 · Judgment". */
export function episodeSubtitle(ep: EpisodeLike) {
    const code = episodeCode(ep)
    if (ep.episode_title) return code ? `${code} · ${ep.episode_title}` : ep.episode_title
    return code ?? ep.title
}

export function seasonLabel(season: number | null) {
    if (season === null) return 'Other'
    if (season === 0) return 'Specials'
    return `Season ${season}`
}

export function showPath(showTitle: string) {
    return `/shows/${encodeURIComponent(showTitle)}`
}

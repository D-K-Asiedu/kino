import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Check, ChevronLeft, MoreHorizontal, Play, RotateCcw } from 'lucide-react'
import { Movie } from '../types'
import { Poster } from '../components/Poster'
import { VideoPlayer } from '../components/VideoPlayer'
import { MenuAnchor, MovieActionsMenu } from '../components/MovieActionsMenu'
import { MoveToSecureDialog } from '../components/MoveToSecureDialog'
import { useFeedback } from '../components/Feedback'
import { showMeta } from '../components/ShowCard'
import { useCoalescedIpcRefresh } from '../hooks/useCoalescedIpcRefresh'
import { formatTimeLeft } from '../lib/format'
import {
    episodeCode,
    episodeName,
    isInProgress,
    isWatched,
    pickNextUp,
    seasonLabel,
    watchedFraction,
} from '../lib/episodes'

type StartMode = 'prompt' | 'resume' | 'restart'

/** The scraper stores the length as "Duration: 1h 2m" in plot. */
function lengthLabel(ep: Movie) {
    if (ep.plot?.startsWith('Duration: ')) return ep.plot.slice('Duration: '.length)
    if (ep.duration && ep.duration > 0) return `${Math.max(1, Math.round(ep.duration / 60))}m`
    return null
}

export function ShowPage() {
    const { title: encodedTitle } = useParams<{ title: string }>()
    const showTitle = encodedTitle ? decodeURIComponent(encodedTitle) : ''
    const [episodes, setEpisodes] = useState<Movie[] | null>(null)
    const [selectedSeason, setSelectedSeason] = useState<number | null | undefined>(undefined)
    const [playing, setPlaying] = useState<Movie | null>(null)
    const [startMode, setStartMode] = useState<StartMode>('prompt')

    const fetchEpisodes = useCallback(async () => {
        try {
            // Already in episode order (season, then episode number).
            setEpisodes(await window.ipcRenderer.invoke('db:get-show-episodes', showTitle) as Movie[])
        } catch (err) {
            console.error('Failed to load show:', err)
            setEpisodes([])
        }
    }, [showTitle])

    // Progress events keep watched marks and "Continue" current while an episode plays.
    const { runNow: refreshEpisodes } = useCoalescedIpcRefresh(
        fetchEpisodes,
        ['library-updated', 'playback-progress-updated'],
        { delayMs: 300 }
    )

    useEffect(() => {
        setEpisodes(null)
        setSelectedSeason(undefined)
        void refreshEpisodes()
    }, [showTitle, refreshEpisodes])

    const seasons = useMemo(() => {
        const groups: { season: number | null; episodes: Movie[] }[] = []
        for (const ep of episodes ?? []) {
            const season = ep.season ?? null
            const last = groups[groups.length - 1]
            if (last && last.season === season) last.episodes.push(ep)
            else groups.push({ season, episodes: [ep] })
        }
        return groups
    }, [episodes])

    const nextUp = useMemo(() => (episodes ? pickNextUp(episodes) : null), [episodes])

    // Open on the season you're up to; keep the user's choice after that.
    useEffect(() => {
        if (selectedSeason !== undefined || seasons.length === 0) return
        setSelectedSeason(nextUp?.episode.season ?? seasons[0].season)
    }, [seasons, nextUp, selectedSeason])

    const currentSeason = seasons.find(group => group.season === selectedSeason) ?? seasons[0]

    const play = (ep: Movie, mode: StartMode = 'prompt') => {
        setStartMode(mode)
        setPlaying(ep)
    }

    if (episodes === null) {
        return (
            <div className="p-8 max-w-[1920px] mx-auto">
                <div className="h-5 w-20 rounded bg-white/[0.04] mb-4" />
                <div className="h-[min(40vh,360px)] rounded-2xl bg-white/[0.04]" />
            </div>
        )
    }

    if (episodes.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-full text-textMuted gap-3">
                <p>Show not found</p>
                <Link to="/library?view=shows" className="text-primary hover:underline text-sm">Back to Shows</Link>
            </div>
        )
    }

    const watchedCount = episodes.filter(isWatched).length
    const seasonCount = seasons.filter(group => group.season !== null).length
    const heroEpisode = nextUp?.episode ?? episodes[0]
    const playingIndex = playing ? episodes.findIndex(ep => ep.id === playing.id) : -1

    const primaryAction = nextUp
        ? {
            label: `${nextUp.resume ? 'Resume' : 'Play'}${episodeCode(nextUp.episode) ? ` ${episodeCode(nextUp.episode)}` : ''}`,
            onClick: () => play(nextUp.episode, nextUp.resume ? 'resume' : 'restart'),
        }
        : {
            label: 'Watch again',
            onClick: () => play(episodes[0], 'restart'),
        }

    return (
        <div className="p-8 max-w-[1920px] mx-auto pb-24">
            <Link
                to="/library?view=shows"
                className="inline-flex items-center gap-1 -ml-1 mb-3 pr-2 py-0.5 rounded-md text-sm text-textMuted hover:text-white transition-colors"
            >
                <ChevronLeft className="w-4 h-4" />
                Shows
            </Link>

            <section className="relative h-[min(40vh,360px)] min-h-[260px] rounded-2xl overflow-hidden bg-surface ring-1 ring-white/5">
                <Poster
                    path={heroEpisode.backdrop_path || heroEpisode.poster_path}
                    title={showTitle}
                    plainFallback
                    className="absolute inset-0 w-full h-full object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-r from-background via-background/75 to-transparent" />
                <div className="absolute inset-0 bg-gradient-to-t from-background/90 via-transparent to-transparent" />

                <div className="relative h-full flex flex-col justify-end p-8 max-w-2xl">
                    <h1 className="text-4xl font-semibold tracking-tight text-white line-clamp-2 drop-shadow-lg">{showTitle}</h1>
                    <p className="mt-2 text-sm text-white/70">
                        {showMeta({ season_count: seasonCount, episode_count: episodes.length })}
                        {watchedCount > 0 && ` · ${watchedCount === episodes.length ? 'all' : watchedCount} watched`}
                    </p>
                    {nextUp && (
                        <p className="mt-1 text-sm text-white/50 truncate">
                            {nextUp.resume ? 'Continue' : 'Up next'}: {episodeName(nextUp.episode)}
                            {nextUp.resume && nextUp.episode.duration
                                ? ` · ${formatTimeLeft(nextUp.episode.duration - (nextUp.episode.progress ?? 0))}`
                                : ''}
                        </p>
                    )}
                    <div className="mt-5 flex items-center gap-3">
                        <button
                            onClick={primaryAction.onClick}
                            className="flex items-center gap-2.5 px-6 py-3 rounded-xl bg-white text-black font-semibold hover:bg-white/90 active:scale-[0.98] transition-all shadow-xl shadow-black/30"
                        >
                            {nextUp ? <Play className="w-4 h-4 fill-current" /> : <RotateCcw className="w-4 h-4" />}
                            {primaryAction.label}
                        </button>
                        {nextUp && nextUp.episode.id !== episodes[0].id && (
                            <button
                                onClick={() => play(episodes[0], 'restart')}
                                className="flex items-center gap-2 px-5 py-3 rounded-xl bg-white/10 hover:bg-white/15 text-white font-medium backdrop-blur-md border border-white/10 transition-colors"
                            >
                                <RotateCcw className="w-4 h-4" />
                                From the start
                            </button>
                        )}
                    </div>
                </div>
            </section>

            {seasons.length > 1 && (
                <div role="tablist" aria-label="Seasons" className="flex flex-wrap gap-2 mt-8">
                    {seasons.map(group => {
                        const selected = group === currentSeason
                        const done = group.episodes.every(isWatched)
                        return (
                            <button
                                key={String(group.season)}
                                role="tab"
                                aria-selected={selected}
                                onClick={() => setSelectedSeason(group.season)}
                                className={`flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-medium border transition-colors ${selected
                                    ? 'bg-white text-black border-white'
                                    : 'bg-white/5 text-white/80 border-white/10 hover:bg-white/10 hover:text-white'}`}
                            >
                                {seasonLabel(group.season)}
                                {done && <Check className="w-3.5 h-3.5" aria-label="watched" />}
                            </button>
                        )
                    })}
                </div>
            )}

            <div className="mt-6">
                <div className="flex items-baseline justify-between mb-3">
                    <h2 className="text-lg font-semibold text-white">{seasonLabel(currentSeason.season)}</h2>
                    <span className="text-sm text-textMuted">
                        {currentSeason.episodes.length} {currentSeason.episodes.length === 1 ? 'episode' : 'episodes'}
                    </span>
                </div>
                <ol className="space-y-1">
                    {currentSeason.episodes.map(ep => (
                        <EpisodeRow
                            key={ep.id}
                            episode={ep}
                            isNext={nextUp?.episode.id === ep.id}
                            onPlay={() => play(ep)}
                        />
                    ))}
                </ol>
            </div>

            {playing && (
                <VideoPlayer
                    movie={playing}
                    startMode={startMode}
                    onClose={() => setPlaying(null)}
                    onNext={() => playingIndex >= 0 && playingIndex < episodes.length - 1 && play(episodes[playingIndex + 1])}
                    onPrevious={() => playingIndex > 0 && play(episodes[playingIndex - 1])}
                    hasNext={playingIndex >= 0 && playingIndex < episodes.length - 1}
                    hasPrevious={playingIndex > 0}
                />
            )}
        </div>
    )
}

function EpisodeRow({ episode, isNext, onPlay }: { episode: Movie; isNext: boolean; onPlay: () => void }) {
    const { toast } = useFeedback()
    const [menuAnchor, setMenuAnchor] = useState<MenuAnchor | null>(null)
    const [secureDialogOpen, setSecureDialogOpen] = useState(false)
    const closeMenu = useCallback(() => setMenuAnchor(null), [])

    const fraction = watchedFraction(episode)
    const watched = isWatched(episode)
    const inProgress = isInProgress(episode)
    const length = lengthLabel(episode)

    return (
        <li
            className={`group relative flex items-center gap-4 p-2 rounded-xl transition-colors hover:bg-white/[0.04] ${isNext ? 'bg-white/[0.03]' : ''}`}
            onContextMenu={(e) => {
                e.preventDefault()
                setMenuAnchor({ x: e.clientX, y: e.clientY })
            }}
        >
            <button
                onClick={onPlay}
                aria-label={`Play ${episode.title}`}
                className="flex flex-1 min-w-0 items-center gap-4 text-left rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
                <div className="relative w-40 flex-none aspect-video rounded-lg overflow-hidden bg-surfaceHighlight">
                    <Poster
                        path={episode.poster_path}
                        title={episodeName(episode)}
                        plainFallback
                        className={`w-full h-full object-cover transition-opacity ${watched ? 'opacity-60' : ''}`}
                    />
                    <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/30">
                        <Play className="w-6 h-6 text-white fill-current" />
                    </div>
                    {fraction > 0 && !watched && (
                        <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/20">
                            <div className="h-full bg-primary" style={{ width: `${fraction * 100}%` }} />
                        </div>
                    )}
                </div>

                <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2 min-w-0">
                        {episode.episode != null && (
                            <span className="flex-none text-sm font-medium tabular-nums text-textMuted">{episode.episode}</span>
                        )}
                        <span className={`truncate font-medium ${watched ? 'text-white/60' : 'text-white'}`}>{episodeName(episode)}</span>
                        {isNext && (
                            <span className="flex-none text-[11px] font-semibold uppercase tracking-wider text-primary">
                                {inProgress ? 'Continue' : 'Up next'}
                            </span>
                        )}
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-xs text-textMuted">
                        {watched ? (
                            <span className="flex items-center gap-1 text-white/50"><Check className="w-3.5 h-3.5" /> Watched</span>
                        ) : inProgress && episode.duration ? (
                            <span>{formatTimeLeft(episode.duration - (episode.progress ?? 0))}</span>
                        ) : length ? (
                            <span>{length}</span>
                        ) : null}
                    </div>
                </div>
            </button>

            <button
                onMouseDown={(e) => menuAnchor && e.stopPropagation()}
                onClick={(e) => {
                    if (menuAnchor) {
                        setMenuAnchor(null)
                        return
                    }
                    const rect = e.currentTarget.getBoundingClientRect()
                    setMenuAnchor({ x: rect.right, y: rect.bottom + 6, alignRight: true })
                }}
                className={`flex-none p-2 rounded-full text-textMuted hover:text-white hover:bg-white/10 transition-opacity focus-visible:opacity-100 ${menuAnchor ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                aria-label={`More actions for ${episode.title}`}
                aria-haspopup="menu"
                aria-expanded={!!menuAnchor}
            >
                <MoreHorizontal className="w-4 h-4" />
            </button>

            {menuAnchor && (
                <MovieActionsMenu
                    movie={episode}
                    anchor={menuAnchor}
                    onClose={closeMenu}
                    onPlay={onPlay}
                    onMoveToSecure={() => setSecureDialogOpen(true)}
                />
            )}
            {secureDialogOpen && (
                <MoveToSecureDialog
                    movie={episode}
                    onClose={() => setSecureDialogOpen(false)}
                    onMoved={() => {
                        setSecureDialogOpen(false)
                        toast(`Moved “${episode.title}” to Secure Folder`)
                    }}
                />
            )}
        </li>
    )
}

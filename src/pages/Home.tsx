import { useCallback, useEffect, useMemo, useState } from 'react'
import { MovieCard } from '../components/MovieCard'
import { PlaylistCard } from '../components/PlaylistCard'
import { HorizontalScroller } from '../components/HorizontalScroller'
import { VideoPlayer } from '../components/VideoPlayer'
import { Poster } from '../components/Poster'
import { HomeSkeleton } from '../components/Skeleton'
import { Movie, Playlist } from '../types'
import { FolderPlus, Play, RotateCcw, Star } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { useCoalescedIpcRefresh } from '../hooks/useCoalescedIpcRefresh'
import { formatTimeLeft } from '../lib/format'

type WatchingMovie = Movie & { progress: number; duration: number; last_watched: string }
type PlaylistWithMovies = Playlist & { movies: Movie[] }

interface HomeData {
    continueWatching: WatchingMovie[]
    recentlyAdded: Movie[]
    randomSuggestions: Movie[]
    lastWatchedPlaylist: PlaylistWithMovies | null
    recentlyWatchedPlaylists?: PlaylistWithMovies[]
    latestPlaylists?: PlaylistWithMovies[]
    recommendedPlaylists?: PlaylistWithMovies[]
}

type StartMode = 'prompt' | 'resume' | 'restart'

function SectionHeading({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
    return (
        <div className="flex items-baseline justify-between gap-4 mb-4">
            <h2 className="text-xl font-semibold text-white tracking-tight">{children}</h2>
            {action}
        </div>
    )
}

export function Home() {
    const navigate = useNavigate()
    const [data, setData] = useState<HomeData | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [selectedMovie, setSelectedMovie] = useState<Movie | null>(null)
    const [playlistContext, setPlaylistContext] = useState<Movie[] | null>(null)
    const [startMode, setStartMode] = useState<StartMode>('prompt')

    const fetchHomeData = useCallback(async () => {
        try {
            if (!data) {
                setLoading(true)
            }
            const homeData = await window.ipcRenderer.invoke('db:get-home-data')
            setData(homeData)
            setError(null)
        } catch (err: any) {
            setError(err.message || 'Failed to load home data')
            console.error('Error fetching home data:', err)
        } finally {
            setLoading(false)
        }
    }, [data])

    const { runNow: refreshHomeData } = useCoalescedIpcRefresh(
        fetchHomeData,
        ['library-updated', 'playlists-updated'],
        { delayMs: 180 }
    )

    useEffect(() => {
        void refreshHomeData()
    }, [refreshHomeData])

    // One "Playlists" row: recently watched first, then newest, then recommendations.
    const playlists = useMemo(() => {
        if (!data) return []
        const seen = new Set<number>()
        const merged: PlaylistWithMovies[] = []
        for (const playlist of [
            ...(data.recentlyWatchedPlaylists ?? []),
            ...(data.latestPlaylists ?? []),
            ...(data.recommendedPlaylists ?? []),
        ]) {
            if (seen.has(playlist.id)) continue
            seen.add(playlist.id)
            merged.push(playlist)
        }
        return merged
    }, [data])

    if (error) {
        return (
            <div className="flex items-center justify-center h-screen">
                <div className="text-center">
                    <p className="text-red-400 mb-4">Error: {error}</p>
                    <button
                        onClick={() => {
                            void refreshHomeData()
                        }}
                        className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-blue-700 transition-colors"
                    >
                        Retry
                    </button>
                </div>
            </div>
        )
    }

    if (loading || !data) {
        return <HomeSkeleton />
    }

    const handlePlayMovie = (movie: Movie, contextList?: Movie[], mode: StartMode = 'prompt') => {
        setPlaylistContext(contextList || null)
        setStartMode(mode)
        setSelectedMovie(movie)
    }

    const handleNext = () => {
        if (!selectedMovie || !playlistContext) return
        const currentIndex = playlistContext.findIndex(m => m.id === selectedMovie.id)
        if (currentIndex >= 0 && currentIndex < playlistContext.length - 1) {
            setSelectedMovie(playlistContext[currentIndex + 1])
        }
    }

    const handlePrevious = () => {
        if (!selectedMovie || !playlistContext) return
        const currentIndex = playlistContext.findIndex(m => m.id === selectedMovie.id)
        if (currentIndex > 0) {
            setSelectedMovie(playlistContext[currentIndex - 1])
        }
    }

    const getCurrentIndex = () => {
        if (!selectedMovie || !playlistContext) return -1
        return playlistContext.findIndex(m => m.id === selectedMovie.id)
    }

    const heroWatching = data.continueWatching[0]
    const heroMovie: Movie | undefined = heroWatching ?? data.recentlyAdded[0]
    const moreContinueWatching = data.continueWatching.slice(1)
    const recentlyAdded = heroWatching ? data.recentlyAdded : data.recentlyAdded.slice(1)

    const isEmpty = !heroMovie && playlists.length === 0 && data.randomSuggestions.length === 0

    return (
        <>
            <div className="p-8 max-w-[1920px] mx-auto pb-24 space-y-12">
                {isEmpty && (
                    <div className="flex flex-col items-center justify-center text-center min-h-[60vh]">
                        <div className="w-14 h-14 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center mb-5">
                            <FolderPlus className="w-6 h-6 text-primary" />
                        </div>
                        <h1 className="text-3xl font-semibold text-white tracking-tight">Your library is empty</h1>
                        <p className="mt-2 text-textMuted max-w-sm">
                            Add a folder with your videos and Kino will pick them up automatically.
                        </p>
                        <button
                            onClick={() => navigate('/settings')}
                            className="mt-6 flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary hover:bg-primary/90 text-white font-semibold transition-colors"
                        >
                            <FolderPlus className="w-4 h-4" />
                            Add a folder
                        </button>
                    </div>
                )}

                {heroMovie && (
                    <HomeHero
                        movie={heroMovie}
                        watching={heroWatching}
                        onPlay={(mode) => handlePlayMovie(heroMovie, heroWatching ? undefined : data.recentlyAdded, mode)}
                    />
                )}

                {moreContinueWatching.length > 0 && (
                    <section>
                        <SectionHeading>Continue Watching</SectionHeading>
                        <HorizontalScroller>
                            {moreContinueWatching.map(movie => (
                                <div key={movie.id} className="w-[300px] snap-start flex-none">
                                    <MovieCard
                                        movie={movie}
                                        progress={movie.duration > 0 ? movie.progress / movie.duration : 0}
                                        remainingSeconds={movie.duration > 0 ? movie.duration - movie.progress : undefined}
                                        onClick={() => handlePlayMovie(movie, undefined, 'resume')}
                                    />
                                </div>
                            ))}
                        </HorizontalScroller>
                    </section>
                )}

                {recentlyAdded.length > 0 && (
                    <section>
                        <SectionHeading>Recently Added</SectionHeading>
                        <HorizontalScroller>
                            {recentlyAdded.map(movie => (
                                <div key={movie.id} className="w-[300px] snap-start flex-none">
                                    <MovieCard
                                        movie={movie}
                                        onClick={() => handlePlayMovie(movie, recentlyAdded)}
                                    />
                                </div>
                            ))}
                        </HorizontalScroller>
                    </section>
                )}

                {playlists.length > 0 && (
                    <section>
                        <SectionHeading
                            action={
                                <Link to="/playlists" className="text-sm text-textMuted hover:text-white transition-colors">
                                    See all
                                </Link>
                            }
                        >
                            Playlists
                        </SectionHeading>
                        <HorizontalScroller>
                            {playlists.map(playlist => (
                                <div key={playlist.id} className="w-[300px] snap-start flex-none">
                                    <PlaylistCard
                                        playlist={playlist}
                                        onClick={() => navigate(`/playlists/${playlist.id}`)}
                                    />
                                </div>
                            ))}
                        </HorizontalScroller>
                    </section>
                )}

                {data.randomSuggestions.length > 0 && (
                    <section>
                        <SectionHeading>Suggestions For You</SectionHeading>
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-6">
                            {data.randomSuggestions.map(movie => (
                                <MovieCard
                                    key={movie.id}
                                    movie={movie}
                                    onClick={() => handlePlayMovie(movie, data.randomSuggestions)}
                                />
                            ))}
                        </div>
                    </section>
                )}
            </div>

            {selectedMovie && (
                <VideoPlayer
                    movie={selectedMovie}
                    startMode={startMode}
                    onClose={() => setSelectedMovie(null)}
                    onNext={playlistContext ? handleNext : undefined}
                    onPrevious={playlistContext ? handlePrevious : undefined}
                    hasNext={playlistContext ? (getCurrentIndex() >= 0 && getCurrentIndex() < playlistContext.length - 1) : false}
                    hasPrevious={playlistContext ? (getCurrentIndex() > 0) : false}
                />
            )}
        </>
    )
}

function HomeHero({ movie, watching, onPlay }: {
    movie: Movie
    watching?: WatchingMovie
    onPlay: (mode: StartMode) => void
}) {
    const fraction = watching && watching.duration > 0 ? Math.min(1, watching.progress / watching.duration) : 0
    const meta = [
        movie.year ? String(movie.year) : null,
        watching && watching.duration > 0 ? formatTimeLeft(watching.duration - watching.progress) : null,
    ].filter(Boolean) as string[]

    return (
        <section className="relative h-[min(52vh,480px)] min-h-[320px] rounded-2xl overflow-hidden bg-surface ring-1 ring-white/5">
            <Poster
                path={movie.backdrop_path || movie.poster_path}
                title={movie.title}
                plainFallback
                className="absolute inset-0 w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-r from-background via-background/75 to-transparent" />
            <div className="absolute inset-0 bg-gradient-to-t from-background/90 via-transparent to-transparent" />

            <div className="relative h-full flex flex-col justify-end p-8 md:p-10 max-w-2xl">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
                    {watching ? 'Continue watching' : 'New in your library'}
                </p>
                <h1 className="mt-3 text-4xl md:text-5xl font-semibold tracking-tight text-white line-clamp-2 drop-shadow-lg">
                    {movie.title}
                </h1>

                <div className="mt-3 flex items-center gap-3 text-sm text-white/70">
                    {meta.map((item, i) => (
                        <span key={item} className="flex items-center gap-3">
                            {i > 0 && <span className="text-white/25">•</span>}
                            {item}
                        </span>
                    ))}
                    {movie.rating != null && (
                        <span className="flex items-center gap-3">
                            {meta.length > 0 && <span className="text-white/25">•</span>}
                            <span className="flex items-center gap-1 text-yellow-400">
                                <Star className="w-3.5 h-3.5 fill-current" />
                                {movie.rating.toFixed(1)}
                            </span>
                        </span>
                    )}
                </div>

                {movie.plot && (
                    <p className="mt-3 text-white/60 line-clamp-2 max-w-xl">{movie.plot}</p>
                )}

                {watching && (
                    <div className="mt-5 w-72 max-w-full h-1 rounded-full bg-white/15 overflow-hidden">
                        <div className="h-full bg-primary" style={{ width: `${fraction * 100}%` }} />
                    </div>
                )}

                <div className="mt-6 flex items-center gap-3">
                    <button
                        onClick={() => onPlay(watching ? 'resume' : 'prompt')}
                        className="flex items-center gap-2.5 px-6 py-3 rounded-xl bg-white text-black font-semibold hover:bg-white/90 active:scale-[0.98] transition-all shadow-xl shadow-black/30"
                    >
                        <Play className="w-4 h-4 fill-current" />
                        {watching ? 'Resume' : 'Play'}
                    </button>
                    {watching && (
                        <button
                            onClick={() => onPlay('restart')}
                            className="flex items-center gap-2 px-5 py-3 rounded-xl bg-white/10 hover:bg-white/15 text-white font-medium backdrop-blur-md border border-white/10 transition-colors"
                        >
                            <RotateCcw className="w-4 h-4" />
                            Start over
                        </button>
                    )}
                </div>
            </div>
        </section>
    )
}

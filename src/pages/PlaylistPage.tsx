import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Movie, Playlist } from '../types'
import { MovieCard } from '../components/MovieCard'
import { VideoPlayer } from '../components/VideoPlayer'
import { VirtualMovieGrid } from '../components/VirtualMovieGrid'
import { MovieGridSkeleton } from '../components/Skeleton'
import { ActiveFilterChips, MovieFilterControls } from '../components/MovieFilterControls'
import { useFeedback } from '../components/Feedback'
import { DEFAULT_FILTERS, DEFAULT_SORT, MovieFilters, countActiveFilters, matchesFilters, sortMovies } from '../lib/movieFilters'
import { ChevronLeft, Film, Trash2 } from 'lucide-react'
import { useCoalescedIpcRefresh } from '../hooks/useCoalescedIpcRefresh'

export function PlaylistPage() {
    const { id } = useParams<{ id: string }>()
    const navigate = useNavigate()
    const { confirm, toast } = useFeedback()
    const [playlist, setPlaylist] = useState<Playlist | null>(null)
    const [movies, setMovies] = useState<Movie[]>([])
    const [selectedMovie, setSelectedMovie] = useState<Movie | null>(null)
    const [filters, setFilters] = useState<MovieFilters>(DEFAULT_FILTERS)
    const [sortBy, setSortBy] = useState(DEFAULT_SORT)
    const [loading, setLoading] = useState(true)

    const fetchPlaylistData = useCallback(async () => {
        if (!id) return
        if (!playlist) {
            setLoading(true)
        }
        try {
            // We need to get playlist details first. 
            // Currently we don't have a direct "get playlist by id" but we can filter from all playlists
            // or add a new IPC. For now, let's filter from all playlists to avoid backend changes if possible,
            // but a direct fetch is better. Let's just fetch all and find it for now.
            const playlists: Playlist[] = await window.ipcRenderer.invoke('db:get-playlists')
            const current = playlists.find(p => p.id === Number(id))
            setPlaylist(current || null)

            if (current) {
                const playlistMovies = await window.ipcRenderer.invoke('db:get-playlist-movies', current.id)
                setMovies(playlistMovies)
            }
        } catch (err) {
            console.error('Failed to load playlist:', err)
        } finally {
            setLoading(false)
        }
    }, [id, playlist])

    const { runNow: refreshPlaylistData } = useCoalescedIpcRefresh(
        fetchPlaylistData,
        ['playlists-updated', 'library-updated'],
        { delayMs: 170 }
    )

    useEffect(() => {
        void refreshPlaylistData()
    }, [id, refreshPlaylistData])

    const handleRemoveFromPlaylist = async (movie: Movie) => {
        if (!playlist) return

        const ok = await confirm({
            title: 'Remove from playlist?',
            message: `“${movie.title}” will be removed from “${playlist.name}”. It stays in your library.`,
            confirmLabel: 'Remove',
            destructive: true,
        })
        if (!ok) return
        await window.ipcRenderer.invoke('db:remove-movie-from-playlist', playlist.id, movie.id)
        void refreshPlaylistData()
        toast(`Removed from “${playlist.name}”`)
    }

    const handleDeletePlaylist = async () => {
        if (!playlist) return
        const ok = await confirm({
            title: `Delete “${playlist.name}”?`,
            message: 'The playlist will be removed. The videos stay in your library.',
            confirmLabel: 'Delete',
            destructive: true,
        })
        if (!ok) return
        await window.ipcRenderer.invoke('db:delete-playlist', playlist.id)
        toast(`Deleted “${playlist.name}”`)
        navigate('/playlists')
    }

    const visibleMovies = useMemo(() => {
        return sortMovies(movies.filter(movie => matchesFilters(movie, filters)), sortBy)
    }, [movies, filters, sortBy])

    useEffect(() => {
        if (selectedMovie && !visibleMovies.some(movie => movie.id === selectedMovie.id)) {
            setSelectedMovie(null)
        }
    }, [selectedMovie, visibleMovies])

    const handlePlayMovie = async (movie: Movie) => {
        setSelectedMovie(movie)
        if (playlist) {
            // Save the current playlist as the last watched in settings (legacy)
            await window.ipcRenderer.invoke('settings:set', 'last_watched_playlist_id', playlist.id.toString());
            // Update the last watched timestamp for this playlist in the database
            await window.ipcRenderer.invoke('db:update-playlist-last-watched', playlist.id);
        }
    }

    const handleNext = () => {
        if (!selectedMovie) return
        const currentIndex = visibleMovies.findIndex(m => m.id === selectedMovie.id)
        if (currentIndex >= 0 && currentIndex < visibleMovies.length - 1) {
            setSelectedMovie(visibleMovies[currentIndex + 1])
        }
    }

    const handlePrevious = () => {
        if (!selectedMovie) return
        const currentIndex = visibleMovies.findIndex(m => m.id === selectedMovie.id)
        if (currentIndex > 0) {
            setSelectedMovie(visibleMovies[currentIndex - 1])
        }
    }

    const getCurrentIndex = () => {
        if (!selectedMovie) return -1
        return visibleMovies.findIndex(m => m.id === selectedMovie.id)
    }

    if (loading) {
        return (
            <div className="p-8 max-w-[1920px] mx-auto">
                <div className="h-9 w-64 rounded bg-white/[0.04] mb-2" />
                <div className="h-5 w-24 rounded bg-white/[0.04] mb-8" />
                <MovieGridSkeleton />
            </div>
        )
    }

    if (!playlist) {
        return (
            <div className="flex flex-col items-center justify-center h-full text-textMuted gap-3">
                <p>Playlist not found</p>
                <Link to="/playlists" className="text-primary hover:underline text-sm">Back to Playlists</Link>
            </div>
        )
    }

    return (
        <div className="p-8 max-w-[1920px] mx-auto">
            <Link
                to="/playlists"
                className="inline-flex items-center gap-1 -ml-1 mb-3 pr-2 py-0.5 rounded-md text-sm text-textMuted hover:text-white transition-colors"
            >
                <ChevronLeft className="w-4 h-4" />
                Playlists
            </Link>
            <header className="flex items-center justify-between gap-6 mb-8">
                <div className="min-w-0">
                    <h1 className="text-3xl font-semibold text-white tracking-tight truncate">{playlist.name}</h1>
                    <p className="text-textMuted mt-1">
                        {countActiveFilters(filters) > 0
                            ? `${visibleMovies.length} of ${movies.length} ${movies.length === 1 ? 'movie' : 'movies'}`
                            : `${movies.length} ${movies.length === 1 ? 'movie' : 'movies'}`}
                    </p>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                    <MovieFilterControls
                        filters={filters}
                        onFiltersChange={setFilters}
                        sortBy={sortBy}
                        onSortChange={setSortBy}
                    />
                    <button
                        onClick={() => void handleDeletePlaylist()}
                        className="p-2 rounded-lg text-textMuted hover:text-red-400 hover:bg-red-500/10 transition-colors"
                        title="Delete playlist"
                        aria-label="Delete playlist"
                    >
                        <Trash2 className="w-4 h-4" />
                    </button>
                </div>
            </header>

            <ActiveFilterChips filters={filters} onFiltersChange={setFilters} />

            <VirtualMovieGrid
                items={visibleMovies}
                getItemKey={(movie) => movie.id}
                renderItem={(movie) => (
                    <MovieCard
                        movie={movie}
                        onClick={() => handlePlayMovie(movie)}
                        onRemoveFromPlaylist={() => void handleRemoveFromPlaylist(movie)}
                    />
                )}
            />

            {movies.length === 0 && (
                <div className="text-center py-16 text-textMuted">
                    <Film className="w-12 h-12 mx-auto mb-4 opacity-20" />
                    <p className="text-white">This playlist is empty</p>
                    <p className="text-sm mt-1">
                        Use the <span className="text-white">⋯</span> menu on any video in the{' '}
                        <Link to="/library" className="text-primary hover:underline">Library</Link> to add it here.
                    </p>
                </div>
            )}

            {movies.length > 0 && visibleMovies.length === 0 && (
                <div className="text-center py-16 text-textMuted">
                    <p className="text-white">No matches</p>
                    <p className="text-sm mt-1">Try removing a filter.</p>
                </div>
            )}

            {selectedMovie && (
                <VideoPlayer
                    movie={selectedMovie}
                    onClose={() => setSelectedMovie(null)}
                    onNext={handleNext}
                    onPrevious={handlePrevious}
                    hasNext={getCurrentIndex() >= 0 && getCurrentIndex() < visibleMovies.length - 1}
                    hasPrevious={getCurrentIndex() > 0}
                />
            )}
        </div>
    )
}

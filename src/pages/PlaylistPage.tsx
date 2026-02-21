import { useState, useEffect, useMemo, useRef } from 'react'
import { useParams } from 'react-router-dom'
import { Movie, Playlist } from '../types'
import { MovieCard } from '../components/MovieCard'
import { VideoPlayer } from '../components/VideoPlayer'
import { Trash2, Film, SlidersHorizontal, ArrowUpDown, ChevronDown, Check } from 'lucide-react'

export function PlaylistPage() {
    const { id } = useParams<{ id: string }>()
    const [playlist, setPlaylist] = useState<Playlist | null>(null)
    const [movies, setMovies] = useState<Movie[]>([])
    const [selectedMovie, setSelectedMovie] = useState<Movie | null>(null)
    const [filterBy, setFilterBy] = useState('all')
    const [sortBy, setSortBy] = useState('recent')
    const [loading, setLoading] = useState(true)
    const [showFilterMenu, setShowFilterMenu] = useState(false)
    const [showSortMenu, setShowSortMenu] = useState(false)
    const filterMenuRef = useRef<HTMLDivElement | null>(null)
    const sortMenuRef = useRef<HTMLDivElement | null>(null)

    const fetchPlaylistData = async () => {
        if (!id) return
        setLoading(true)
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
    }

    useEffect(() => {
        fetchPlaylistData()

        const handleUpdate = () => {
            fetchPlaylistData()
        }

        window.ipcRenderer.on('playlists-updated', handleUpdate)
        window.ipcRenderer.on('library-updated', handleUpdate) // Also listen for library updates as they might affect playlist content

        return () => {
            window.ipcRenderer.off('playlists-updated', handleUpdate)
            window.ipcRenderer.off('library-updated', handleUpdate)
        }
    }, [id])

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (filterMenuRef.current && !filterMenuRef.current.contains(event.target as Node)) {
                setShowFilterMenu(false)
            }
            if (sortMenuRef.current && !sortMenuRef.current.contains(event.target as Node)) {
                setShowSortMenu(false)
            }
        }

        document.addEventListener('mousedown', handleClickOutside)
        return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [])

    const handleRemoveFromPlaylist = async (e: React.MouseEvent, movieId: number) => {
        e.stopPropagation()
        if (!playlist) return

        if (confirm('Remove this movie from playlist?')) {
            await window.ipcRenderer.invoke('db:remove-movie-from-playlist', playlist.id, movieId)
            fetchPlaylistData()
        }
    }

    const matchesFilter = (movie: Movie) => {
        switch (filterBy) {
            case 'rated':
                return movie.rating !== null
            case 'unrated':
                return movie.rating === null
            case 'year-2020s':
                return movie.year !== null && movie.year >= 2020
            case 'year-2010s':
                return movie.year !== null && movie.year >= 2010 && movie.year <= 2019
            case 'year-2000s':
                return movie.year !== null && movie.year >= 2000 && movie.year <= 2009
            case 'year-1990s':
                return movie.year !== null && movie.year >= 1990 && movie.year <= 1999
            case 'year-1980s':
                return movie.year !== null && movie.year >= 1980 && movie.year <= 1989
            case 'year-older':
                return movie.year !== null && movie.year < 1980
            default:
                return true
        }
    }

    const sortMovies = (list: Movie[]) => {
        const sorted = [...list]
        switch (sortBy) {
            case 'title-asc':
                return sorted.sort((a, b) => a.title.localeCompare(b.title))
            case 'title-desc':
                return sorted.sort((a, b) => b.title.localeCompare(a.title))
            case 'year-desc':
                return sorted.sort((a, b) => (b.year ?? -Infinity) - (a.year ?? -Infinity))
            case 'year-asc':
                return sorted.sort((a, b) => (a.year ?? Infinity) - (b.year ?? Infinity))
            case 'rating-desc':
                return sorted.sort((a, b) => (b.rating ?? -Infinity) - (a.rating ?? -Infinity))
            case 'rating-asc':
                return sorted.sort((a, b) => (a.rating ?? Infinity) - (b.rating ?? Infinity))
            case 'recent':
            default:
                return sorted.sort(
                    (a, b) => new Date(b.added_at).getTime() - new Date(a.added_at).getTime()
                )
        }
    }

    const visibleMovies = useMemo(() => {
        const filtered = movies.filter(matchesFilter)
        return sortMovies(filtered)
    }, [movies, filterBy, sortBy])

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

    const filterOptions = [
        { value: 'all', label: 'All movies' },
        { value: 'rated', label: 'Rated only' },
        { value: 'unrated', label: 'Unrated only' },
        { value: 'year-2020s', label: '2020s' },
        { value: 'year-2010s', label: '2010s' },
        { value: 'year-2000s', label: '2000s' },
        { value: 'year-1990s', label: '1990s' },
        { value: 'year-1980s', label: '1980s' },
        { value: 'year-older', label: 'Before 1980' },
    ]

    const sortOptions = [
        { value: 'recent', label: 'Recently added' },
        { value: 'title-asc', label: 'Title A-Z' },
        { value: 'title-desc', label: 'Title Z-A' },
        { value: 'year-desc', label: 'Year (newest)' },
        { value: 'year-asc', label: 'Year (oldest)' },
        { value: 'rating-desc', label: 'Rating (high)' },
        { value: 'rating-asc', label: 'Rating (low)' },
    ]

    if (loading) {
        return (
            <div className="flex items-center justify-center h-full">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
        )
    }

    if (!playlist) {
        return (
            <div className="flex items-center justify-center h-full text-textMuted">
                <p>Playlist not found</p>
            </div>
        )
    }

    return (
        <div className="p-8 max-w-[1920px] mx-auto">
            <header className="flex items-center justify-between mb-8">
                <div>
                    <h2 className="text-3xl font-bold text-white tracking-tight">{playlist.name}</h2>
                    <p className="text-textMuted mt-1">
                        {visibleMovies.length}
                        {visibleMovies.length === 1 ? ' movie' : ' movies'}
                        {filterBy !== 'all' ? ` of ${movies.length}` : ''}
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    <div className="relative" ref={filterMenuRef}>
                        <button
                            onClick={() => {
                                setShowFilterMenu(!showFilterMenu)
                                setShowSortMenu(false)
                            }}
                            className={`flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${showFilterMenu || filterBy !== 'all' ? 'text-white bg-white/10' : 'text-textMuted hover:text-white hover:bg-white/5'}`}
                            aria-label="Filter playlist movies"
                        >
                            <SlidersHorizontal className="w-4 h-4" />
                            <span>{filterOptions.find(o => o.value === filterBy)?.label}</span>
                            <ChevronDown className={`w-3.5 h-3.5 opacity-50 transition-transform ${showFilterMenu ? 'rotate-180' : ''}`} />
                        </button>
                        {showFilterMenu && (
                            <div className="absolute right-0 mt-2 w-56 bg-surface/95 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl overflow-hidden z-50 animate-in fade-in slide-in-from-top-2">
                                <div className="p-2">
                                    {filterOptions.map(option => (
                                        <button
                                            key={option.value}
                                            onClick={() => {
                                                setFilterBy(option.value)
                                                setShowFilterMenu(false)
                                            }}
                                            className="w-full text-left px-2 py-1.5 text-sm text-gray-300 hover:bg-white/10 hover:text-white rounded flex items-center justify-between transition-colors"
                                        >
                                            <span>{option.label}</span>
                                            {filterBy === option.value && (
                                                <Check className="w-3.5 h-3.5 text-green-400" />
                                            )}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                    <div className="relative" ref={sortMenuRef}>
                        <button
                            onClick={() => {
                                setShowSortMenu(!showSortMenu)
                                setShowFilterMenu(false)
                            }}
                            className={`flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${showSortMenu || sortBy !== 'recent' ? 'text-white bg-white/10' : 'text-textMuted hover:text-white hover:bg-white/5'}`}
                            aria-label="Sort playlist movies"
                        >
                            <ArrowUpDown className="w-4 h-4" />
                            <span>{sortOptions.find(o => o.value === sortBy)?.label}</span>
                            <ChevronDown className={`w-3.5 h-3.5 opacity-50 transition-transform ${showSortMenu ? 'rotate-180' : ''}`} />
                        </button>
                        {showSortMenu && (
                            <div className="absolute right-0 mt-2 w-56 bg-surface/95 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl overflow-hidden z-50 animate-in fade-in slide-in-from-top-2">
                                <div className="p-2">
                                    {sortOptions.map(option => (
                                        <button
                                            key={option.value}
                                            onClick={() => {
                                                setSortBy(option.value)
                                                setShowSortMenu(false)
                                            }}
                                            className="w-full text-left px-2 py-1.5 text-sm text-gray-300 hover:bg-white/10 hover:text-white rounded flex items-center justify-between transition-colors"
                                        >
                                            <span>{option.label}</span>
                                            {sortBy === option.value && (
                                                <Check className="w-3.5 h-3.5 text-green-400" />
                                            )}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </header>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                {visibleMovies.map((movie) => (
                    <div key={movie.id} className="relative group">
                        <MovieCard
                            movie={movie}
                            onClick={() => handlePlayMovie(movie)}
                        />
                        <button
                            onClick={(e) => handleRemoveFromPlaylist(e, movie.id)}
                            className="absolute top-2 right-2 p-2 text-white bg-red-500/80 hover:bg-red-600 rounded-full opacity-0 group-hover:opacity-100 transition-opacity shadow-lg z-10"
                            title="Remove from playlist"
                        >
                            <Trash2 className="w-4 h-4" />
                        </button>
                    </div>
                ))}
            </div>

            {movies.length === 0 && (
                <div className="text-center py-12 text-textMuted">
                    <Film className="w-12 h-12 mx-auto mb-4 opacity-20" />
                    <p>This playlist is empty.</p>
                    <p className="text-sm mt-2">Go to the library to add movies.</p>
                </div>
            )}

            {movies.length > 0 && visibleMovies.length === 0 && (
                <div className="text-center py-12 text-textMuted">
                    <Film className="w-12 h-12 mx-auto mb-4 opacity-20" />
                    <p>No movies match your filters.</p>
                    <p className="text-sm mt-2">Try a different filter or sort.</p>
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

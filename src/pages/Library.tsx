import { useEffect, useMemo, useRef, useState } from 'react'
import { MovieCard } from '../components/MovieCard'
import { VideoPlayer } from '../components/VideoPlayer'
import { Movie } from '../types'
import { Search, SlidersHorizontal, ArrowUpDown, ChevronDown, Check } from 'lucide-react'

export function Library() {
    const [movies, setMovies] = useState<Movie[]>([])
    const [searchQuery, setSearchQuery] = useState('')
    const [filterBy, setFilterBy] = useState('all')
    const [sortBy, setSortBy] = useState('recent')
    const [selectedMovie, setSelectedMovie] = useState<Movie | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [showFilterMenu, setShowFilterMenu] = useState(false)
    const [showSortMenu, setShowSortMenu] = useState(false)
    const filterMenuRef = useRef<HTMLDivElement | null>(null)
    const sortMenuRef = useRef<HTMLDivElement | null>(null)

    const fetchMovies = async () => {
        try {
            setLoading(true)
            const data = await window.ipcRenderer.invoke('db:get-library')
            setMovies(data)
            setError(null)
        } catch (err: any) {
            setError(err.message || 'Failed to load movies')
            console.error('Error fetching movies:', err)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        fetchMovies()

        // Listen for library updates
        const handleLibraryUpdate = () => {
            fetchMovies()
        }

        window.ipcRenderer.on('library-updated', handleLibraryUpdate)

        return () => {
            window.ipcRenderer.off('library-updated', handleLibraryUpdate)
        }
    }, [])

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
        const query = searchQuery.trim().toLowerCase()
        const searched = query
            ? movies.filter(movie => movie.title.toLowerCase().includes(query))
            : movies
        const filtered = searched.filter(matchesFilter)
        return sortMovies(filtered)
    }, [movies, searchQuery, filterBy, sortBy])

    useEffect(() => {
        if (selectedMovie && !visibleMovies.some(movie => movie.id === selectedMovie.id)) {
            setSelectedMovie(null)
        }
    }, [selectedMovie, visibleMovies])

    if (error) {
        return (
            <div className="flex items-center justify-center h-screen">
                <div className="text-center">
                    <p className="text-red-400 mb-4">Error: {error}</p>
                    <button
                        onClick={fetchMovies}
                        className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-blue-700 transition-colors"
                    >
                        Retry
                    </button>
                </div>
            </div>
        )
    }

    const handlePlayMovie = (movie: Movie) => {
        setSelectedMovie(movie)
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

    return (
        <div className="p-8 max-w-[1920px] mx-auto">
            <header className="flex items-center justify-between mb-8">
                <div>
                    <h2 className="text-3xl font-bold text-white tracking-tight">Library</h2>
                    <p className="text-textMuted mt-1">
                        {visibleMovies.length}
                        {visibleMovies.length === 1 ? ' movie' : ' movies'}
                        {searchQuery.trim() || filterBy !== 'all' ? ` of ${movies.length}` : ''} in your collection
                    </p>
                </div>

                <div className="flex items-center gap-3">
                    <div className="relative group">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-textMuted group-focus-within:text-primary transition-colors" />
                        <input
                            type="text"
                            placeholder="Search movies..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="bg-surfaceHighlight text-sm text-white pl-10 pr-4 py-2 rounded-full border border-transparent focus:border-primary/50 focus:bg-surface focus:outline-none transition-all w-64"
                        />
                    </div>
                    <div className="relative" ref={filterMenuRef}>
                        <button
                            onClick={() => {
                                setShowFilterMenu(!showFilterMenu)
                                setShowSortMenu(false)
                            }}
                            className="flex items-center gap-2 bg-surface/80 text-sm text-white px-3 py-2 rounded-full border border-white/10 hover:bg-surfaceHighlight/80 transition-all shadow-sm min-w-[170px]"
                            aria-label="Filter movies"
                        >
                            <SlidersHorizontal className="w-4 h-4 text-textMuted" />
                            <span className="flex-1 text-left">{filterOptions.find(o => o.value === filterBy)?.label}</span>
                            <ChevronDown className={`w-4 h-4 text-textMuted transition-transform ${showFilterMenu ? 'rotate-180' : ''}`} />
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
                            className="flex items-center gap-2 bg-surface/80 text-sm text-white px-3 py-2 rounded-full border border-white/10 hover:bg-surfaceHighlight/80 transition-all shadow-sm min-w-[170px]"
                            aria-label="Sort movies"
                        >
                            <ArrowUpDown className="w-4 h-4 text-textMuted" />
                            <span className="flex-1 text-left">{sortOptions.find(o => o.value === sortBy)?.label}</span>
                            <ChevronDown className={`w-4 h-4 text-textMuted transition-transform ${showSortMenu ? 'rotate-180' : ''}`} />
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

            {loading ? (
                <div className="flex items-center justify-center h-64">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                </div>
            ) : (
                <>
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                        {visibleMovies.map((movie) => (
                            <MovieCard
                                key={movie.id}
                                movie={movie}
                                onClick={() => handlePlayMovie(movie)}
                            />
                        ))}
                    </div>
                    {visibleMovies.length === 0 && (
                        <div className="text-center py-12 text-textMuted">
                            <p>No movies match your search or filters.</p>
                        </div>
                    )}
                </>
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

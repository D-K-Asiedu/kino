import { useCallback, useEffect, useRef, useState } from 'react'
import { MovieCard } from '../components/MovieCard'
import { VideoPlayer } from '../components/VideoPlayer'
import { VirtualMovieGrid } from '../components/VirtualMovieGrid'
import { Movie } from '../types'
import { Search, SlidersHorizontal, ArrowUpDown, ChevronDown, Check } from 'lucide-react'
import { useCoalescedIpcRefresh } from '../hooks/useCoalescedIpcRefresh'

const PAGE_SIZE = 120

export function Library() {
    const [movies, setMovies] = useState<Movie[]>([])
    const [totalMovies, setTotalMovies] = useState(0)
    const [hasMore, setHasMore] = useState(false)
    const [loadingMore, setLoadingMore] = useState(false)
    const [searchQuery, setSearchQuery] = useState('')
    const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('')
    const [filterBy, setFilterBy] = useState('all')
    const [sortBy, setSortBy] = useState('recent')
    const [selectedMovie, setSelectedMovie] = useState<Movie | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [showFilterMenu, setShowFilterMenu] = useState(false)
    const [showSortMenu, setShowSortMenu] = useState(false)
    const filterMenuRef = useRef<HTMLDivElement | null>(null)
    const sortMenuRef = useRef<HTMLDivElement | null>(null)

    useEffect(() => {
        const timer = window.setTimeout(() => {
            setDebouncedSearchQuery(searchQuery)
        }, 180)
        return () => window.clearTimeout(timer)
    }, [searchQuery])

    const fetchMoviesPage = useCallback(async (offset = 0, replace = true) => {
        try {
            if (replace) {
                setLoading(true)
            } else {
                setLoadingMore(true)
            }
            const page = await window.ipcRenderer.invoke('db:get-library-page', {
                searchQuery: debouncedSearchQuery,
                filterBy,
                sortBy,
                limit: PAGE_SIZE,
                offset,
            }) as {
                items: Movie[]
                total: number
                hasMore: boolean
            }

            if (replace) {
                setMovies(page.items)
            } else {
                setMovies(prev => {
                    if (page.items.length === 0) return prev
                    const seen = new Set(prev.map(m => m.id))
                    const additions = page.items.filter(m => !seen.has(m.id))
                    return additions.length > 0 ? prev.concat(additions) : prev
                })
            }
            setTotalMovies(page.total)
            setHasMore(page.hasMore)
            setError(null)
        } catch (err: any) {
            setError(err.message || 'Failed to load movies')
            console.error('Error fetching movies:', err)
        } finally {
            setLoading(false)
            setLoadingMore(false)
        }
    }, [debouncedSearchQuery, filterBy, sortBy])

    const fetchInitialMovies = useCallback(async () => {
        await fetchMoviesPage(0, true)
    }, [fetchMoviesPage])

    const fetchMoreMovies = useCallback(async () => {
        if (loading || loadingMore || !hasMore) return
        await fetchMoviesPage(movies.length, false)
    }, [fetchMoviesPage, hasMore, loading, loadingMore, movies.length])

    const { runNow: refreshMovies } = useCoalescedIpcRefresh(
        fetchInitialMovies,
        ['library-updated'],
        { delayMs: 140 }
    )

    useEffect(() => {
        void refreshMovies()
    }, [refreshMovies, debouncedSearchQuery, filterBy, sortBy])

    useEffect(() => {
        const scrollRoot = document.getElementById('app-scroll-root')
        if (!scrollRoot) return

        let rafId: number | null = null
        const onScroll = () => {
            if (rafId !== null) return
            rafId = requestAnimationFrame(() => {
                rafId = null
                if (loading || loadingMore || !hasMore) return
                const remaining = scrollRoot.scrollHeight - (scrollRoot.scrollTop + scrollRoot.clientHeight)
                if (remaining < 700) {
                    void fetchMoreMovies()
                }
            })
        }

        scrollRoot.addEventListener('scroll', onScroll, { passive: true })
        return () => {
            scrollRoot.removeEventListener('scroll', onScroll)
            if (rafId !== null) {
                cancelAnimationFrame(rafId)
            }
        }
    }, [fetchMoreMovies, hasMore, loading, loadingMore])

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

    useEffect(() => {
        if (selectedMovie && !movies.some(movie => movie.id === selectedMovie.id)) {
            setSelectedMovie(null)
        }
    }, [selectedMovie, movies])

    if (error) {
        return (
            <div className="flex items-center justify-center h-screen">
                <div className="text-center">
                    <p className="text-red-400 mb-4">Error: {error}</p>
                    <button
                        onClick={() => {
                            void refreshMovies()
                        }}
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
        const currentIndex = movies.findIndex(m => m.id === selectedMovie.id)
        if (currentIndex >= 0 && currentIndex < movies.length - 1) {
            setSelectedMovie(movies[currentIndex + 1])
        }
    }

    const handlePrevious = () => {
        if (!selectedMovie) return
        const currentIndex = movies.findIndex(m => m.id === selectedMovie.id)
        if (currentIndex > 0) {
            setSelectedMovie(movies[currentIndex - 1])
        }
    }

    const getCurrentIndex = () => {
        if (!selectedMovie) return -1
        return movies.findIndex(m => m.id === selectedMovie.id)
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
                        {movies.length}
                        {movies.length === 1 ? ' movie' : ' movies'}
                        {totalMovies > movies.length ? ` of ${totalMovies}` : ''} loaded
                    </p>
                </div>

                <div className="flex items-center gap-3">
                    <div className="relative group">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-textMuted group-focus-within:text-primary transition-colors" />
                        <input
                            type="text"
                            placeholder="Search..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="bg-white/5 text-sm text-white pl-10 pr-4 py-1.5 rounded-lg border border-white/10 focus:border-white/20 focus:bg-white/10 focus:outline-none transition-all w-64 placeholder:text-textMuted/60"
                        />
                    </div>
                    <div className="relative" ref={filterMenuRef}>
                        <button
                            onClick={() => {
                                setShowFilterMenu(!showFilterMenu)
                                setShowSortMenu(false)
                            }}
                            className={`flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${showFilterMenu || filterBy !== 'all' ? 'text-white bg-white/10' : 'text-textMuted hover:text-white hover:bg-white/5'}`}
                            aria-label="Filter movies"
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
                            aria-label="Sort movies"
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

            {loading ? (
                <div className="flex items-center justify-center h-64">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                </div>
            ) : (
                <>
                    <VirtualMovieGrid
                        items={movies}
                        getItemKey={(movie) => movie.id}
                        renderItem={(movie) => (
                            <MovieCard
                                movie={movie}
                                onClick={() => handlePlayMovie(movie)}
                            />
                        )}
                    />
                    {movies.length === 0 && (
                        <div className="text-center py-12 text-textMuted">
                            <p>No movies match your search or filters.</p>
                        </div>
                    )}
                    {movies.length > 0 && hasMore && (
                        <div className="py-6 text-center text-textMuted text-sm">
                            {loadingMore ? 'Loading more movies...' : 'Scroll to load more'}
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
                    hasNext={getCurrentIndex() >= 0 && getCurrentIndex() < movies.length - 1}
                    hasPrevious={getCurrentIndex() > 0}
                />
            )}
        </div>
    )
}

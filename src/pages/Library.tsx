import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { MovieCard } from '../components/MovieCard'
import { VideoPlayer } from '../components/VideoPlayer'
import { VirtualMovieGrid } from '../components/VirtualMovieGrid'
import { MovieGridSkeleton } from '../components/Skeleton'
import { ActiveFilterChips, MovieFilterControls } from '../components/MovieFilterControls'
import { DEFAULT_FILTERS, DEFAULT_SORT, MovieFilters, countActiveFilters } from '../lib/movieFilters'
import { Movie } from '../types'
import { FolderPlus, Search, X } from 'lucide-react'
import { useCoalescedIpcRefresh } from '../hooks/useCoalescedIpcRefresh'
import { usePlaybackProgressUpdates } from '../hooks/usePlaybackProgressUpdates'

const PAGE_SIZE = 120

export function Library() {
    const location = useLocation()
    const navigate = useNavigate()
    const searchInputRef = useRef<HTMLInputElement>(null)
    const [movies, setMovies] = useState<Movie[]>([])
    const [totalMovies, setTotalMovies] = useState(0)
    const [hasMore, setHasMore] = useState(false)
    const [loadingMore, setLoadingMore] = useState(false)
    const [searchQuery, setSearchQuery] = useState('')
    const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('')
    const [filters, setFilters] = useState<MovieFilters>(DEFAULT_FILTERS)
    const [sortBy, setSortBy] = useState(DEFAULT_SORT)
    const [selectedMovie, setSelectedMovie] = useState<Movie | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    // Global Ctrl+K / "/" shortcut navigates here with a fresh focusSearch token.
    const focusSearchToken = (location.state as { focusSearch?: number } | null)?.focusSearch
    useEffect(() => {
        if (focusSearchToken) {
            searchInputRef.current?.focus()
            searchInputRef.current?.select()
        }
    }, [focusSearchToken])

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
                rating: filters.rating,
                decade: filters.decade,
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
    }, [debouncedSearchQuery, filters, sortBy])

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
    }, [refreshMovies, debouncedSearchQuery, filters, sortBy])

    usePlaybackProgressUpdates(setMovies)

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

    const isNarrowed = debouncedSearchQuery.trim() !== '' || countActiveFilters(filters) > 0
    const libraryIsEmpty = !loading && totalMovies === 0 && !isNarrowed

    return (
        <div className="p-8 max-w-[1920px] mx-auto">
            <header className="flex items-center justify-between gap-6 mb-8">
                <div>
                    <h1 className="text-3xl font-semibold text-white tracking-tight">Library</h1>
                    <p className="text-textMuted mt-1">
                        {loading ? '\u00a0' : `${totalMovies.toLocaleString()} ${totalMovies === 1 ? 'movie' : 'movies'}`}
                    </p>
                </div>

                <div className="flex items-center gap-3">
                    <div className="relative group">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-textMuted group-focus-within:text-primary transition-colors" />
                        <input
                            ref={searchInputRef}
                            type="text"
                            placeholder="Search..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Escape') {
                                    setSearchQuery('')
                                    e.currentTarget.blur()
                                }
                            }}
                            className="bg-white/5 text-sm text-white pl-10 pr-14 py-1.5 rounded-lg border border-white/10 focus:border-white/20 focus:bg-white/10 focus:outline-none transition-all w-64 placeholder:text-textMuted/60"
                            aria-label="Search library"
                        />
                        {searchQuery ? (
                            <button
                                onClick={() => {
                                    setSearchQuery('')
                                    searchInputRef.current?.focus()
                                }}
                                className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded text-textMuted hover:text-white"
                                aria-label="Clear search"
                            >
                                <X className="w-3.5 h-3.5" />
                            </button>
                        ) : (
                            <kbd className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-[10px] font-sans text-textMuted/70 border border-white/10 rounded px-1.5 py-0.5">
                                Ctrl K
                            </kbd>
                        )}
                    </div>
                    <MovieFilterControls
                        filters={filters}
                        onFiltersChange={setFilters}
                        sortBy={sortBy}
                        onSortChange={setSortBy}
                    />
                </div>
            </header>

            <ActiveFilterChips filters={filters} onFiltersChange={setFilters} />

            {loading ? (
                <MovieGridSkeleton />
            ) : libraryIsEmpty ? (
                <div className="flex flex-col items-center justify-center text-center py-24">
                    <div className="w-14 h-14 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center mb-5">
                        <FolderPlus className="w-6 h-6 text-primary" />
                    </div>
                    <h2 className="text-xl font-semibold text-white">No videos yet</h2>
                    <p className="mt-2 text-textMuted max-w-sm">
                        Add a folder in Settings and Kino will scan it for videos.
                    </p>
                    <button
                        onClick={() => navigate('/settings')}
                        className="mt-6 flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary hover:bg-primary/90 text-white font-semibold transition-colors"
                    >
                        <FolderPlus className="w-4 h-4" />
                        Add a folder
                    </button>
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
                        <div className="text-center py-16 text-textMuted">
                            <p className="text-white">No matches</p>
                            <p className="text-sm mt-1">Try a different search or remove a filter.</p>
                        </div>
                    )}
                    {movies.length > 0 && hasMore && (
                        <div className="pt-6">
                            {loadingMore ? <MovieGridSkeleton count={4} /> : <div className="h-8" />}
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

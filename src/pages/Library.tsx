import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { MovieCard } from '../components/MovieCard'
import { ShowCard } from '../components/ShowCard'
import { FolderBrowser } from '../components/FolderBrowser'
import { Dropdown } from '../components/Dropdown'
import { VideoPlayer } from '../components/VideoPlayer'
import { VirtualMovieGrid } from '../components/VirtualMovieGrid'
import { MovieGridSkeleton } from '../components/Skeleton'
import { ActiveFilterChips, MovieFilterControls } from '../components/MovieFilterControls'
import { DEFAULT_FILTERS, DEFAULT_SORT, MovieFilters, countActiveFilters } from '../lib/movieFilters'
import { Movie, Show } from '../types'
import { ArrowUpDown, Film, FolderPlus, FolderTree, Search, Tv, X } from 'lucide-react'
import { showPath } from '../lib/episodes'
import { useCoalescedIpcRefresh } from '../hooks/useCoalescedIpcRefresh'
import { usePlaybackProgressUpdates } from '../hooks/usePlaybackProgressUpdates'

const PAGE_SIZE = 120

// Videos is everything that isn't a TV episode: movies, but also clips, lectures, home videos.
type LibraryView = 'videos' | 'shows' | 'folders'
const VIEWS: LibraryView[] = ['videos', 'shows', 'folders']
const VIEW_STORAGE_KEY = 'kino_library_view'

const SHOW_SORT_OPTIONS = [
    { value: 'watched', label: 'Recently watched' },
    { value: 'added', label: 'Recently added' },
    { value: 'title-asc', label: 'Title A–Z' },
]
const DEFAULT_SHOW_SORT = 'watched'

const titleCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

function readStoredView(): LibraryView {
    try {
        const stored = window.localStorage.getItem(VIEW_STORAGE_KEY) as LibraryView | null
        return stored && VIEWS.includes(stored) ? stored : 'videos'
    } catch {
        return 'videos'
    }
}

export function Library() {
    const location = useLocation()
    const navigate = useNavigate()
    const [searchParams, setSearchParams] = useSearchParams()
    // In the URL so Back from a show page lands on the Shows tab again.
    const viewParam = searchParams.get('view') as LibraryView | null
    const view: LibraryView = viewParam && VIEWS.includes(viewParam) ? viewParam : readStoredView()
    const folderPath = searchParams.get('path')
    const setView = (next: LibraryView) => {
        try {
            window.localStorage.setItem(VIEW_STORAGE_KEY, next)
        } catch {
            // Remembering the tab is a convenience only
        }
        setSearchParams({ view: next }, { replace: true, state: location.state })
    }
    // Pushed, not replaced, so Back goes up a folder.
    const openFolder = (path: string | null) => {
        setSearchQuery('')
        setSearchParams(path ? { view: 'folders', path } : { view: 'folders' })
    }
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
    const [shows, setShows] = useState<Show[] | null>(null)
    const [showSort, setShowSort] = useState(DEFAULT_SHOW_SORT)

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
                kind: 'videos',
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
            setError(err.message || 'Failed to load videos')
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

    // Shows are few enough to load whole; also gives the tab its count.
    const fetchShows = useCallback(async () => {
        try {
            setShows(await window.ipcRenderer.invoke('db:get-shows') as Show[])
        } catch (err) {
            console.error('Error fetching shows:', err)
        }
    }, [])
    const { runNow: refreshShows } = useCoalescedIpcRefresh(
        fetchShows,
        ['library-updated', 'playback-progress-updated'],
        { delayMs: 200 }
    )
    useEffect(() => {
        void refreshShows()
    }, [refreshShows])

    const visibleShows = useMemo(() => {
        if (!shows) return []
        const query = debouncedSearchQuery.trim().toLowerCase()
        const matching = query ? shows.filter(show => show.title.toLowerCase().includes(query)) : shows
        const sorted = [...matching]
        if (showSort === 'title-asc') sorted.sort((a, b) => titleCollator.compare(a.title, b.title))
        else if (showSort === 'added') sorted.sort((a, b) => b.last_added.localeCompare(a.last_added))
        return sorted // 'watched' is the backend's order
    }, [shows, debouncedSearchQuery, showSort])

    useEffect(() => {
        const scrollRoot = document.getElementById('app-scroll-root')
        if (!scrollRoot || view !== 'videos') return

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
    }, [fetchMoreMovies, hasMore, loading, loadingMore, view])

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

    const isSearching = debouncedSearchQuery.trim() !== ''
    const isNarrowed = isSearching || countActiveFilters(filters) > 0
    const showsLoaded = shows !== null
    const showCount = shows?.length ?? 0
    const libraryIsEmpty = !loading && showsLoaded && totalMovies === 0 && showCount === 0 && !isNarrowed
    // While searching videos, point at shows that match too, since they live on the other tab.
    const matchingShowCount = view === 'videos' && isSearching ? visibleShows.length : 0

    const summary = view === 'folders'
        ? 'Your library as it is on disk'
        : view === 'videos'
        ? (loading ? '\u00a0' : `${totalMovies.toLocaleString()} ${totalMovies === 1 ? 'video' : 'videos'}`)
        : (!showsLoaded ? '\u00a0' : `${showCount.toLocaleString()} ${showCount === 1 ? 'show' : 'shows'}`)

    return (
        <div className="p-8 max-w-[1920px] mx-auto">
            <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-4 mb-6">
                <div>
                    <h1 className="text-3xl font-semibold text-white tracking-tight">Library</h1>
                    <p className="text-textMuted mt-1">{summary}</p>
                </div>

                <div className="flex items-center gap-3">
                    <div className="relative group">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-textMuted group-focus-within:text-primary transition-colors" />
                        <input
                            ref={searchInputRef}
                            type="text"
                            placeholder={view === 'shows' ? 'Search shows...' : view === 'folders' ? 'Search this folder...' : 'Search videos...'}
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
                    {view === 'videos' ? (
                        <MovieFilterControls
                            filters={filters}
                            onFiltersChange={setFilters}
                            sortBy={sortBy}
                            onSortChange={setSortBy}
                        />
                    ) : view === 'folders' ? null : (
                        <Dropdown
                            icon={ArrowUpDown}
                            label={SHOW_SORT_OPTIONS.find(o => o.value === showSort)?.label ?? 'Sort'}
                            ariaLabel="Sort shows"
                            active={showSort !== DEFAULT_SHOW_SORT}
                            sections={[{ options: SHOW_SORT_OPTIONS, value: showSort, onChange: setShowSort }]}
                        />
                    )}
                </div>
            </header>

            {!libraryIsEmpty && (
                <div role="tablist" aria-label="Library sections" className="inline-flex items-center gap-1 p-1 mb-8 rounded-xl bg-white/[0.04] border border-white/[0.06]">
                    <ViewTab
                        icon={Film}
                        label="Videos"
                        count={loading || isNarrowed ? null : totalMovies}
                        selected={view === 'videos'}
                        onSelect={() => setView('videos')}
                    />
                    <ViewTab
                        icon={Tv}
                        label="Shows"
                        count={showsLoaded && !isSearching ? showCount : null}
                        selected={view === 'shows'}
                        onSelect={() => setView('shows')}
                    />
                    <ViewTab
                        icon={FolderTree}
                        label="Folders"
                        count={null}
                        selected={view === 'folders'}
                        onSelect={() => setView('folders')}
                    />
                </div>
            )}

            {view === 'videos' && <ActiveFilterChips filters={filters} onFiltersChange={setFilters} />}

            {view === 'folders' ? (
                <FolderBrowser path={folderPath} onNavigate={openFolder} searchQuery={debouncedSearchQuery} />
            ) : view === 'shows' ? (
                !showsLoaded ? (
                    <MovieGridSkeleton />
                ) : showCount === 0 ? (
                    <div className="flex flex-col items-center justify-center text-center py-24">
                        <div className="w-14 h-14 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center mb-5">
                            <Tv className="w-6 h-6 text-primary" />
                        </div>
                        <h2 className="text-xl font-semibold text-white">No shows yet</h2>
                        <p className="mt-2 text-textMuted max-w-sm">
                            Episodes are grouped into shows when their file or folder names include a season or
                            episode number, like <span className="text-white/80">S01E02</span> or a <span className="text-white/80">Season 1</span> folder.
                        </p>
                    </div>
                ) : (
                    <>
                        <VirtualMovieGrid
                            items={visibleShows}
                            getItemKey={(show) => show.title}
                            renderItem={(show) => (
                                <ShowCard show={show} onClick={() => navigate(showPath(show.title))} />
                            )}
                        />
                        {visibleShows.length === 0 && (
                            <div className="text-center py-16 text-textMuted">
                                <p className="text-white">No matching shows</p>
                                <p className="text-sm mt-1">Try a different search.</p>
                            </div>
                        )}
                    </>
                )
            ) : loading ? (
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
                    {movies.length === 0 && !isNarrowed && (
                        <div className="text-center py-16 text-textMuted">
                            <p className="text-white">No videos</p>
                            <p className="text-sm mt-1">Everything in your library is a TV episode, listed under Shows.</p>
                        </div>
                    )}
                    {movies.length === 0 && isNarrowed && matchingShowCount === 0 && (
                        <div className="text-center py-16 text-textMuted">
                            <p className="text-white">No matches</p>
                            <p className="text-sm mt-1">Try a different search or remove a filter.</p>
                        </div>
                    )}
                    {matchingShowCount > 0 && (
                        <div className={movies.length === 0 ? 'text-center py-16' : 'mt-10 text-center'}>
                            <button
                                onClick={() => setView('shows')}
                                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-sm text-white transition-colors"
                            >
                                <Tv className="w-4 h-4 text-primary" />
                                {matchingShowCount === 1 ? '1 show matches' : `${matchingShowCount} shows match`} “{debouncedSearchQuery.trim()}”
                            </button>
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

function ViewTab({ icon: Icon, label, count, selected, onSelect }: {
    icon: typeof Film
    label: string
    count: number | null
    selected: boolean
    onSelect: () => void
}) {
    return (
        <button
            role="tab"
            aria-selected={selected}
            onClick={onSelect}
            className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${selected
                ? 'bg-white/10 text-white shadow-sm'
                : 'text-textMuted hover:text-white'}`}
        >
            <Icon className="w-4 h-4" />
            {label}
            {count !== null && (
                <span className={`text-xs tabular-nums ${selected ? 'text-white/60' : 'text-textMuted/70'}`}>{count}</span>
            )}
        </button>
    )
}

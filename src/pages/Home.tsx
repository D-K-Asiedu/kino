import { useEffect, useState } from 'react'
import { MovieCard } from '../components/MovieCard'
import { PlaylistCard } from '../components/PlaylistCard'
import { HorizontalScroller } from '../components/HorizontalScroller'
import { VideoPlayer } from '../components/VideoPlayer'
import { Movie, Playlist } from '../types'
import { Play, Clock, Sparkles, ListVideo, MonitorPlay } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

interface HomeData {
    continueWatching: (Movie & { progress: number; duration: number; last_watched: string })[]
    recentlyAdded: Movie[]
    randomSuggestions: Movie[]
    lastWatchedPlaylist: (Playlist & { movies: Movie[] }) | null
    recentlyWatchedPlaylists?: (Playlist & { movies: Movie[] })[]
    latestPlaylists?: (Playlist & { movies: Movie[] })[]
    recommendedPlaylists?: (Playlist & { movies: Movie[] })[]
}

export function Home() {
    const navigate = useNavigate()
    const [data, setData] = useState<HomeData | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [selectedMovie, setSelectedMovie] = useState<Movie | null>(null)
    const [playlistContext, setPlaylistContext] = useState<Movie[] | null>(null)

    const fetchHomeData = async () => {
        try {
            setLoading(true)
            const homeData = await window.ipcRenderer.invoke('db:get-home-data')
            setData(homeData)
            setError(null)
        } catch (err: any) {
            setError(err.message || 'Failed to load home data')
            console.error('Error fetching home data:', err)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        fetchHomeData()

        const handleUpdate = () => {
            fetchHomeData()
        }

        window.ipcRenderer.on('library-updated', handleUpdate)
        window.ipcRenderer.on('playlists-updated', handleUpdate)

        return () => {
            window.ipcRenderer.off('library-updated', handleUpdate)
            window.ipcRenderer.off('playlists-updated', handleUpdate)
        }
    }, [])

    if (error) {
        return (
            <div className="flex items-center justify-center h-screen">
                <div className="text-center">
                    <p className="text-red-400 mb-4">Error: {error}</p>
                    <button
                        onClick={fetchHomeData}
                        className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-blue-700 transition-colors"
                    >
                        Retry
                    </button>
                </div>
            </div>
        )
    }

    if (loading || !data) {
        return (
            <div className="flex items-center justify-center h-screen">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
        )
    }

    const handlePlayMovie = (movie: Movie, contextList?: Movie[]) => {
        setPlaylistContext(contextList || null)
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

    return (
        <>
            <div className="p-8 max-w-[1920px] mx-auto pb-24 space-y-12">
                <header className="mb-10">
                    <h2 className="text-4xl font-bold text-white tracking-tight flex items-center gap-3">
                        <MonitorPlay className="w-8 h-8 text-primary" />
                        Welcome Back
                    </h2>
                    <p className="text-textMuted mt-2 text-lg">
                        Ready for your next feature presentation?
                    </p>
                </header>

                {data.continueWatching.length > 0 && (
                    <section>
                        <div className="flex items-center gap-2 mb-4">
                            <Clock className="w-5 h-5 text-primary" />
                            <h3 className="text-xl font-bold text-white tracking-wide">Continue Watching</h3>
                        </div>
                        <HorizontalScroller>
                            {data.continueWatching.map(movie => (
                                <div key={movie.id} className="min-w-[280px] max-w-[320px] snap-start flex-none">
                                    <MovieCard
                                        movie={movie}
                                        progress={movie.duration > 0 ? movie.progress / movie.duration : 0}
                                        onClick={() => handlePlayMovie(movie)}
                                    />
                                </div>
                            ))}
                        </HorizontalScroller>
                    </section>
                )}

                {data.recentlyWatchedPlaylists && data.recentlyWatchedPlaylists.length > 0 && (
                    <section>
                        <div className="flex items-center gap-2 mb-4">
                            <ListVideo className="w-5 h-5 text-primary" />
                            <h3 className="text-xl font-bold text-white tracking-wide">Recently Watched Playlists</h3>
                        </div>
                        <HorizontalScroller>
                            {data.recentlyWatchedPlaylists.map(playlist => (
                                <div key={playlist.id} className="min-w-[280px] max-w-[320px] snap-start flex-none">
                                    <PlaylistCard
                                        playlist={playlist}
                                        onClick={() => navigate(`/playlists/${playlist.id}`)}
                                    />
                                </div>
                            ))}
                        </HorizontalScroller>
                    </section>
                )}

                {data.latestPlaylists && data.latestPlaylists.length > 0 && (
                    <section>
                        <div className="flex items-center gap-2 mb-4">
                            <ListVideo className="w-5 h-5 text-primary" />
                            <h3 className="text-xl font-bold text-white tracking-wide">Latest Playlists</h3>
                        </div>
                        <HorizontalScroller>
                            {data.latestPlaylists.map(playlist => (
                                <div key={playlist.id} className="min-w-[280px] max-w-[320px] snap-start flex-none">
                                    <PlaylistCard
                                        playlist={playlist}
                                        onClick={() => navigate(`/playlists/${playlist.id}`)}
                                    />
                                </div>
                            ))}
                        </HorizontalScroller>
                    </section>
                )}

                {data.recommendedPlaylists && data.recommendedPlaylists.length > 0 && (
                    <section>
                        <div className="flex items-center gap-2 mb-4">
                            <Sparkles className="w-5 h-5 text-primary" />
                            <h3 className="text-xl font-bold text-white tracking-wide">Recommended Playlists</h3>
                        </div>
                        <HorizontalScroller>
                            {data.recommendedPlaylists.map(playlist => (
                                <div key={playlist.id} className="min-w-[280px] max-w-[320px] snap-start flex-none">
                                    <PlaylistCard
                                        playlist={playlist}
                                        onClick={() => navigate(`/playlists/${playlist.id}`)}
                                    />
                                </div>
                            ))}
                        </HorizontalScroller>
                    </section>
                )}

                {data.recentlyAdded.length > 0 && (
                    <section>
                        <div className="flex items-center gap-2 mb-4">
                            <Sparkles className="w-5 h-5 text-primary" />
                            <h3 className="text-xl font-bold text-white tracking-wide">Recently Added</h3>
                        </div>
                        <HorizontalScroller>
                            {data.recentlyAdded.map(movie => (
                                <div key={movie.id} className="min-w-[280px] max-w-[320px] snap-start flex-none">
                                    <MovieCard
                                        movie={movie}
                                        onClick={() => handlePlayMovie(movie, data.recentlyAdded)}
                                    />
                                </div>
                            ))}
                        </HorizontalScroller>
                    </section>
                )}

                {data.randomSuggestions.length > 0 && (
                    <section>
                        <div className="flex items-center gap-2 mb-4">
                            <Play className="w-5 h-5 text-primary" />
                            <h3 className="text-xl font-bold text-white tracking-wide">Suggestions For You</h3>
                        </div>
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

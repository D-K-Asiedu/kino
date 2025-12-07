import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { Movie, Playlist } from '../types'
import { MovieCard } from '../components/MovieCard'
import { VideoPlayer } from '../components/VideoPlayer'
import { Trash2, Film } from 'lucide-react'

export function PlaylistPage() {
    const { id } = useParams<{ id: string }>()
    const [playlist, setPlaylist] = useState<Playlist | null>(null)
    const [movies, setMovies] = useState<Movie[]>([])
    const [selectedMovie, setSelectedMovie] = useState<Movie | null>(null)
    const [loading, setLoading] = useState(true)

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

    const handleRemoveFromPlaylist = async (e: React.MouseEvent, movieId: number) => {
        e.stopPropagation()
        if (!playlist) return

        if (confirm('Remove this movie from playlist?')) {
            await window.ipcRenderer.invoke('db:remove-movie-from-playlist', playlist.id, movieId)
            fetchPlaylistData()
        }
    }

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

    return (
        <div className="p-8 max-w-[1920px] mx-auto">
            <header className="mb-8">
                <h2 className="text-3xl font-bold text-white tracking-tight">{playlist.name}</h2>
                <p className="text-textMuted mt-1">
                    {movies.length} {movies.length === 1 ? 'movie' : 'movies'}
                </p>
            </header>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                {movies.map((movie) => (
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

            {selectedMovie && (
                <VideoPlayer
                    movie={selectedMovie}
                    onClose={() => setSelectedMovie(null)}
                    onNext={handleNext}
                    onPrevious={handlePrevious}
                    hasNext={getCurrentIndex() < movies.length - 1}
                    hasPrevious={getCurrentIndex() > 0}
                />
            )}
        </div>
    )
}

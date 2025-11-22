import { useState, useEffect } from 'react'
import { Movie, Playlist } from '../types'
import { MovieCard } from './MovieCard'
import { ArrowLeft, Trash2 } from 'lucide-react'

interface PlaylistDetailProps {
    playlist: Playlist
    onBack: () => void
    onPlayMovie: (movie: Movie) => void
}

export function PlaylistDetail({ playlist, onBack, onPlayMovie }: PlaylistDetailProps) {
    const [movies, setMovies] = useState<Movie[]>([])
    const [loading, setLoading] = useState(true)

    const fetchMovies = async () => {
        setLoading(true)
        const data = await window.ipcRenderer.invoke('db:get-playlist-movies', playlist.id)
        setMovies(data)
        setLoading(false)
    }

    useEffect(() => {
        fetchMovies()
    }, [playlist.id])

    const handleRemoveFromPlaylist = async (e: React.MouseEvent, movieId: number) => {
        e.stopPropagation()
        if (confirm('Remove this movie from playlist?')) {
            await window.ipcRenderer.invoke('db:remove-movie-from-playlist', playlist.id, movieId)
            fetchMovies()
        }
    }

    return (
        <div>
            <div className="flex items-center gap-4 mb-8">
                <button
                    onClick={onBack}
                    className="p-2 text-textMuted hover:text-white hover:bg-surfaceHighlight rounded-full transition-colors"
                >
                    <ArrowLeft className="w-6 h-6" />
                </button>
                <div>
                    <h2 className="text-2xl font-bold text-white">{playlist.name}</h2>
                    <p className="text-textMuted">
                        {movies.length} {movies.length === 1 ? 'movie' : 'movies'}
                    </p>
                </div>
            </div>

            {loading ? (
                <div className="flex items-center justify-center h-64">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                </div>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                    {movies.map((movie) => (
                        <div key={movie.id} className="relative group">
                            <MovieCard
                                movie={movie}
                                onClick={() => onPlayMovie(movie)}
                            />
                            <button
                                onClick={(e) => handleRemoveFromPlaylist(e, movie.id)}
                                className="absolute top-2 right-2 p-2 text-white bg-red-500/80 hover:bg-red-600 rounded-full opacity-0 group-hover:opacity-100 transition-opacity shadow-lg"
                                title="Remove from playlist"
                            >
                                <Trash2 className="w-4 h-4" />
                            </button>
                        </div>
                    ))}
                </div>
            )}

            {!loading && movies.length === 0 && (
                <div className="text-center py-12 text-textMuted">
                    <p>This playlist is empty.</p>
                    <p className="text-sm mt-2">Go to the library to add movies.</p>
                </div>
            )}
        </div>
    )
}

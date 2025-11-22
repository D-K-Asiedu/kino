import { useEffect, useState } from 'react'
import { MovieCard } from '../components/MovieCard'
import { VideoPlayer } from '../components/VideoPlayer'
import { Movie } from '../types'
import { Search } from 'lucide-react'

export function Library() {
    const [movies, setMovies] = useState<Movie[]>([])
    const [searchQuery, setSearchQuery] = useState('')
    const [selectedMovie, setSelectedMovie] = useState<Movie | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

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

    const filteredMovies = movies.filter(movie =>
        movie.title.toLowerCase().includes(searchQuery.toLowerCase())
    )

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

    return (
        <div className="p-8 max-w-[1920px] mx-auto">
            <header className="flex items-center justify-between mb-8">
                <div>
                    <h2 className="text-3xl font-bold text-white tracking-tight">Library</h2>
                    <p className="text-textMuted mt-1">
                        {filteredMovies.length} {filteredMovies.length === 1 ? 'movie' : 'movies'} in your collection
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
                </div>
            </header>

            {loading ? (
                <div className="flex items-center justify-center h-64">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                </div>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                    {filteredMovies.map((movie) => (
                        <MovieCard
                            key={movie.id}
                            movie={movie}
                            onClick={() => setSelectedMovie(movie)}
                        />
                    ))}
                </div>
            )}

            {selectedMovie && (
                <VideoPlayer
                    movie={selectedMovie}
                    onClose={() => setSelectedMovie(null)}
                />
            )}
        </div>
    )
}

import { Playlist, Movie } from '../types'
import { Play, Film, ListVideo, Trash2 } from 'lucide-react'
import { Poster } from './Poster'

interface PlaylistCardProps {
    playlist: Playlist & { movies?: Movie[] }
    onClick?: () => void
    /** Shows a delete button on hover when provided. */
    onDelete?: () => void
}

export function PlaylistCard({ playlist, onClick, onDelete }: PlaylistCardProps) {
    // Up to 4 movies for the grid thumbnail; empty slots are rendered as plain tiles
    const thumbnailMovies = playlist.movies ? playlist.movies.slice(0, 4) : []
    const gridItems: (Movie | null)[] = [...thumbnailMovies]
    while (gridItems.length < 4) {
        gridItems.push(null)
    }

    // movies holds only preview items, so prefer the real count when the backend provides it
    const videoCount = playlist.movie_count ?? playlist.movies?.length ?? 0

    return (
        <div className="group relative">
            <div
                role="button"
                tabIndex={0}
                aria-label={`Open playlist ${playlist.name}`}
                className="relative cursor-pointer rounded-xl"
                onClick={onClick}
                onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        onClick?.()
                    }
                }}
            >
                <div className="relative aspect-video rounded-xl overflow-hidden bg-surfaceHighlight shadow-lg transition-all duration-300 group-hover:shadow-2xl group-hover:shadow-primary/10 group-hover:scale-[1.02]">

                    {/* 2x2 Grid of Posters */}
                    <div className="absolute inset-0 grid grid-cols-2 grid-rows-2 gap-0.5 bg-black/50">
                        {gridItems.map((movie, idx) => (
                            <div key={idx} className="relative w-full h-full bg-surface overflow-hidden">
                                {movie && (
                                    <Poster
                                        path={movie.poster_path}
                                        title={movie.title}
                                        plainFallback
                                        className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-all duration-500 group-hover:scale-110"
                                    />
                                )}
                            </div>
                        ))}
                    </div>

                    {thumbnailMovies.length === 0 && (
                        <div className="absolute inset-0 flex items-center justify-center">
                            <ListVideo className="w-8 h-8 text-white/15" />
                        </div>
                    )}

                    {/* Hover Play Button Overlay */}
                    <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300 bg-black/20">
                        <div className="w-14 h-14 rounded-full bg-primary/90 flex items-center justify-center shadow-2xl transform scale-75 group-hover:scale-100 transition-all duration-300">
                            <Play className="w-6 h-6 text-white fill-current ml-1" />
                        </div>
                    </div>
                </div>

                {/* Title & Meta below card */}
                <div className="mt-3">
                    <h3 className="font-medium text-text text-base line-clamp-2">{playlist.name}</h3>
                    <div className="flex items-center gap-1.5 text-textMuted text-xs mt-0.5">
                        <Film className="w-3 h-3" />
                        <span>{videoCount} {videoCount === 1 ? 'video' : 'videos'}</span>
                    </div>
                </div>
            </div>

            {onDelete && (
                <button
                    onClick={onDelete}
                    className="absolute top-2 right-2 p-1.5 rounded-full bg-black/60 hover:bg-red-500 text-white backdrop-blur-md border border-white/10 shadow-lg transition-all duration-200 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                    aria-label={`Delete playlist ${playlist.name}`}
                    title="Delete playlist"
                >
                    <Trash2 className="w-4 h-4" />
                </button>
            )}
        </div>
    )
}

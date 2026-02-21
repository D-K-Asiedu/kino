import { Playlist, Movie } from '../types'
import { Play, ListVideo, Film } from 'lucide-react'

// Inline SVG placeholder for missing posters
const PLACEHOLDER_POSTER = `data:image/svg+xml,${encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">
  <rect fill="#1f2937" width="640" height="360"/>
  <text x="50%" y="50%" fill="#9ca3af" font-family="system-ui, sans-serif" font-size="24" text-anchor="middle" dominant-baseline="middle">No Poster</text>
</svg>
`)}`

interface PlaylistCardProps {
    playlist: Playlist & { movies?: Movie[] }
    onClick?: () => void
}

export function PlaylistCard({ playlist, onClick }: PlaylistCardProps) {
    // Get up to 4 movies for the grid thumbnail
    const thumbnailMovies = playlist.movies ? playlist.movies.slice(0, 4) : []

    // Fill the rest with placeholders if less than 4
    const gridItems = [...thumbnailMovies]
    while (gridItems.length < 4) {
        gridItems.push(null as any) // Use null to represent an empty slot
    }

    // Default total video count, preferring the actual array length if available
    const videoCount = playlist.movies ? playlist.movies.length : (playlist.movie_count || 0)

    return (
        <div
            className="group relative cursor-pointer"
            onClick={onClick}
        >
            <div className="relative aspect-video rounded-xl overflow-hidden bg-surfaceHighlight shadow-lg transition-all duration-300 group-hover:shadow-2xl group-hover:shadow-primary/10 group-hover:scale-[1.02]">

                {/* 2x2 Grid of Posters */}
                <div className="absolute inset-0 grid grid-cols-2 grid-rows-2 gap-0.5 bg-black/50">
                    {gridItems.map((movie, idx) => {
                        const posterUrl = movie?.poster_path
                            ? `media://${encodeURIComponent(movie.poster_path)}`
                            : PLACEHOLDER_POSTER

                        return (
                            <div key={idx} className="relative w-full h-full bg-surface">
                                <img
                                    src={posterUrl}
                                    alt={movie?.title || 'Empty Slot'}
                                    className={`w-full h-full object-cover transition-transform duration-500 group-hover:scale-110 ${!movie ? 'opacity-30' : 'opacity-80 group-hover:opacity-100'}`}
                                    loading="lazy"
                                />
                            </div>
                        )
                    })}
                </div>

                {/* Dark Gradient Overlay for text readability */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent transition-opacity duration-300" />

                {/* Hover Play Button Overlay */}
                <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300 bg-black/10 backdrop-blur-[1px]">
                    <div className="w-14 h-14 rounded-full bg-primary/90 flex items-center justify-center shadow-2xl transform scale-75 group-hover:scale-100 transition-all duration-300">
                        <Play className="w-6 h-6 text-white fill-current ml-1" />
                    </div>
                </div>

                {/* Information Overlay */}
                <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/90 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col justify-end p-4 pointer-events-none">
                    <div className="transform translate-y-4 group-hover:translate-y-0 transition-transform duration-300">
                        <div className="flex items-center gap-2 text-primary drop-shadow-md">
                            <ListVideo className="w-4 h-4" />
                            <span className="text-xs font-bold uppercase tracking-wider">Playlist</span>
                        </div>
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
    )
}

import { useState, useEffect, useRef } from 'react'
import { Movie, Playlist } from '../types'
import { Star, Calendar, Plus, Check, X } from 'lucide-react'

interface MovieCardProps {
    movie: Movie
    onClick?: () => void
}

// Inline SVG placeholder for missing posters (no network dependency)
const PLACEHOLDER_POSTER = `data:image/svg+xml,${encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">
  <rect fill="#1f2937" width="640" height="360"/>
  <text x="50%" y="50%" fill="#9ca3af" font-family="system-ui, sans-serif" font-size="24" text-anchor="middle" dominant-baseline="middle">No Poster</text>
</svg>
`)}`

export function MovieCard({ movie, onClick }: MovieCardProps) {
    const [showPlaylistSelector, setShowPlaylistSelector] = useState(false)
    const [playlists, setPlaylists] = useState<Playlist[]>([])
    const [addedToPlaylist, setAddedToPlaylist] = useState<number | null>(null)
    const [isCreating, setIsCreating] = useState(false)
    const [newPlaylistName, setNewPlaylistName] = useState('')
    const selectorRef = useRef<HTMLDivElement>(null)
    const [imgError, setImgError] = useState(false)

    // Properly encode Windows paths for the media:// protocol
    const posterUrl = movie.poster_path && !imgError
        ? `media://${encodeURIComponent(movie.poster_path)}`
        : PLACEHOLDER_POSTER

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (selectorRef.current && !selectorRef.current.contains(event.target as Node)) {
                setShowPlaylistSelector(false)
                setIsCreating(false)
                setNewPlaylistName('')
            }
        }

        if (showPlaylistSelector) {
            document.addEventListener('mousedown', handleClickOutside)
        }

        return () => {
            document.removeEventListener('mousedown', handleClickOutside)
        }
    }, [showPlaylistSelector])

    const fetchPlaylists = async () => {
        const data = await window.ipcRenderer.invoke('db:get-playlists')
        setPlaylists(data)
    }

    const handleAddToPlaylistClick = async (e: React.MouseEvent) => {
        e.stopPropagation()
        if (!showPlaylistSelector) {
            await fetchPlaylists()
        }
        setShowPlaylistSelector(!showPlaylistSelector)
    }

    const handlePlaylistSelect = async (e: React.MouseEvent, playlistId: number) => {
        e.stopPropagation()
        try {
            await window.ipcRenderer.invoke('db:add-movie-to-playlist', playlistId, movie.id)
            setAddedToPlaylist(playlistId)
            setTimeout(() => {
                setAddedToPlaylist(null)
                setShowPlaylistSelector(false)
            }, 1500)
        } catch (err) {
            console.error('Failed to add to playlist:', err)
        }
    }

    const handleCreatePlaylist = async (e: React.FormEvent) => {
        e.preventDefault()
        e.stopPropagation()
        if (!newPlaylistName.trim()) return

        try {
            await window.ipcRenderer.invoke('db:create-playlist', newPlaylistName)
            await fetchPlaylists()
            setNewPlaylistName('')
            setIsCreating(false)
        } catch (err) {
            console.error('Failed to create playlist:', err)
        }
    }

    return (
        <div
            className="group relative cursor-pointer"
            onClick={onClick}
        >
            <div className="relative">
                <div className="relative aspect-video rounded-xl overflow-hidden bg-surfaceHighlight shadow-lg transition-all duration-300 group-hover:shadow-2xl group-hover:shadow-primary/10 group-hover:scale-[1.02]">
                    <img
                        src={posterUrl}
                        alt={movie.title}
                        className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                        loading="lazy"
                        onError={() => setImgError(true)}
                    />

                    {/* Gradient Overlay */}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col justify-end p-4">
                        <div className="transform translate-y-4 group-hover:translate-y-0 transition-transform duration-300">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3 text-xs text-gray-300">
                                    {movie.year && (
                                        <div className="flex items-center gap-1">
                                            <Calendar className="w-3 h-3" />
                                            <span>{movie.year}</span>
                                        </div>
                                    )}
                                    {movie.rating && (
                                        <div className="flex items-center gap-1 text-yellow-400">
                                            <Star className="w-3 h-3 fill-current" />
                                            <span>{movie.rating.toFixed(1)}</span>
                                        </div>
                                    )}
                                </div>

                                <button
                                    onClick={handleAddToPlaylistClick}
                                    className="p-2 bg-white/10 hover:bg-primary text-white rounded-full backdrop-blur-sm transition-colors shadow-lg"
                                    title="Add to playlist"
                                >
                                    <Plus className="w-4 h-4" />
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Playlist Selector */}
                {showPlaylistSelector && (
                    <div
                        ref={selectorRef}
                        className="absolute bottom-14 right-4 w-64 bg-surface/95 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl overflow-hidden z-50 animate-in fade-in slide-in-from-bottom-2"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-center justify-between p-3 border-b border-white/5 bg-white/5">
                            <span className="text-xs font-bold text-white uppercase tracking-wider">Add to Playlist</span>
                            <button
                                onClick={(e) => {
                                    e.stopPropagation()
                                    setShowPlaylistSelector(false)
                                }}
                                className="text-textMuted hover:text-white transition-colors"
                            >
                                <X className="w-3.5 h-3.5" />
                            </button>
                        </div>

                        <div className="p-2">
                            {isCreating ? (
                                <form onSubmit={handleCreatePlaylist} className="mb-2">
                                    <div className="flex gap-2">
                                        <input
                                            type="text"
                                            value={newPlaylistName}
                                            onChange={(e) => setNewPlaylistName(e.target.value)}
                                            placeholder="Name..."
                                            className="flex-1 bg-black/40 text-white text-xs px-2 py-1.5 rounded border border-white/10 focus:border-primary/50 focus:ring-1 focus:ring-primary/50 focus:outline-none placeholder:text-textMuted/50"
                                            autoFocus
                                            onClick={(e) => e.stopPropagation()}
                                        />
                                        <button
                                            type="submit"
                                            className="px-2 py-1 bg-primary text-white text-xs rounded hover:bg-primary/90 transition-colors"
                                        >
                                            Add
                                        </button>
                                    </div>
                                </form>
                            ) : (
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation()
                                        setIsCreating(true)
                                    }}
                                    className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-textMuted hover:text-primary hover:bg-primary/10 rounded transition-colors mb-1"
                                >
                                    <Plus className="w-3 h-3" />
                                    <span>Create New Playlist</span>
                                </button>
                            )}

                            <div className="max-h-48 overflow-y-auto custom-scrollbar space-y-0.5">
                                {playlists.length === 0 ? (
                                    <div className="px-2 py-4 text-xs text-textMuted text-center italic">
                                        No playlists yet
                                    </div>
                                ) : (
                                    playlists.map((playlist) => (
                                        <button
                                            key={playlist.id}
                                            onClick={(e) => handlePlaylistSelect(e, playlist.id)}
                                            className="w-full text-left px-2 py-1.5 text-sm text-gray-300 hover:bg-white/10 hover:text-white rounded flex items-center justify-between group/item transition-colors"
                                        >
                                            <span className="truncate">{playlist.name}</span>
                                            {addedToPlaylist === playlist.id && (
                                                <Check className="w-3.5 h-3.5 text-green-400" />
                                            )}
                                        </button>
                                    ))
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Title below card */}
            <div className="mt-3">
                <h3 className="font-medium text-text text-base line-clamp-2">{movie.title}</h3>
                <p className="text-textMuted text-xs mt-0.5">{movie.year}</p>
            </div>
        </div>
    )
}

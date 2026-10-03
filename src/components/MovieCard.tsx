import { useCallback, useEffect, useState } from 'react'
import { Movie } from '../types'
import { MoreHorizontal, Play, Star } from 'lucide-react'
import { Poster } from './Poster'
import { MenuAnchor, MovieActionsMenu } from './MovieActionsMenu'
import { MoveToSecureDialog } from './MoveToSecureDialog'
import { useFeedback } from './Feedback'
import { formatTimeLeft } from '../lib/format'

interface MovieCardProps {
    movie: Movie
    onClick?: () => void
    /** Watched fraction, 0–1. Shows a progress bar on the poster. Defaults to the movie's saved progress. */
    progress?: number
    /** When set, replaces the year/rating line with "42 min left". */
    remainingSeconds?: number
    onRemoveFromPlaylist?: () => void
}

export function MovieCard({ movie, onClick, progress, remainingSeconds, onRemoveFromPlaylist }: MovieCardProps) {
    const { toast } = useFeedback()
    const [menuAnchor, setMenuAnchor] = useState<MenuAnchor | null>(null)
    const [secureDialogOpen, setSecureDialogOpen] = useState(false)
    const [thumbnailRegenRequested, setThumbnailRegenRequested] = useState(false)

    useEffect(() => {
        setThumbnailRegenRequested(false)
    }, [movie.poster_path])

    const handlePosterError = () => {
        if (thumbnailRegenRequested || !movie.poster_path) return
        setThumbnailRegenRequested(true)
        void window.ipcRenderer.invoke('thumbnails:regenerate-one', movie.id).catch((err: unknown) => {
            console.error('Failed to queue thumbnail regeneration:', err)
        })
    }

    const closeMenu = useCallback(() => setMenuAnchor(null), [])

    const openMenuFromButton = (e: React.MouseEvent<HTMLButtonElement>) => {
        e.stopPropagation()
        if (menuAnchor) {
            setMenuAnchor(null)
            return
        }
        const rect = e.currentTarget.getBoundingClientRect()
        setMenuAnchor({ x: rect.right, y: rect.bottom + 6, alignRight: true })
    }

    const handleContextMenu = (e: React.MouseEvent) => {
        e.preventDefault()
        setMenuAnchor({ x: e.clientX, y: e.clientY })
    }

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.target !== e.currentTarget) return
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onClick?.()
        } else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
            e.preventDefault()
            const rect = e.currentTarget.getBoundingClientRect()
            setMenuAnchor({ x: rect.left + 12, y: rect.top + 12 })
        }
    }

    const watchedFraction = progress ?? (movie.progress && movie.duration ? movie.progress / movie.duration : 0)
    const showProgress = watchedFraction > 0

    return (
        <>
            <div className="group relative" onContextMenu={handleContextMenu}>
                <div
                    role="button"
                    tabIndex={0}
                    aria-label={`Play ${movie.title}`}
                    onClick={onClick}
                    onKeyDown={handleKeyDown}
                    className="relative cursor-pointer rounded-xl"
                >
                    <div className="relative aspect-video rounded-xl overflow-hidden bg-surfaceHighlight shadow-lg transition-all duration-300 group-hover:shadow-2xl group-hover:shadow-primary/10 group-hover:scale-[1.02]">
                        <Poster
                            path={movie.poster_path}
                            title={movie.title}
                            onError={handlePosterError}
                            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                        />

                        {/* Hover Play Button Overlay */}
                        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300 bg-black/20 pointer-events-none">
                            <div className="w-14 h-14 rounded-full bg-primary/90 flex items-center justify-center shadow-2xl transform scale-75 group-hover:scale-100 transition-all duration-300">
                                <Play className="w-6 h-6 text-white fill-current ml-1" />
                            </div>
                        </div>

                        {/* Progress Bar (visible even without hover) */}
                        {showProgress && (
                            <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/20">
                                <div
                                    className="h-full bg-primary"
                                    style={{ width: `${Math.min(100, Math.max(0, watchedFraction * 100))}%` }}
                                />
                            </div>
                        )}
                    </div>
                </div>

                {/* More actions */}
                <button
                    // Stop the menu's outside-click handler so a second click toggles it closed.
                    onMouseDown={(e) => menuAnchor && e.stopPropagation()}
                    onClick={openMenuFromButton}
                    className={`absolute top-2 right-2 p-1.5 rounded-full bg-black/60 hover:bg-black/80 text-white backdrop-blur-md border border-white/10 shadow-lg transition-opacity duration-200 focus-visible:opacity-100 ${menuAnchor ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                    aria-label={`More actions for ${movie.title}`}
                    aria-haspopup="menu"
                    aria-expanded={!!menuAnchor}
                >
                    <MoreHorizontal className="w-4 h-4" />
                </button>

                {/* Title & meta below card */}
                <div className="mt-3">
                    <h3 className="font-medium text-text text-base line-clamp-2">{movie.title}</h3>
                    <div className="flex items-center gap-2 text-textMuted text-xs mt-0.5 h-4">
                        {remainingSeconds !== undefined ? (
                            <span>{formatTimeLeft(remainingSeconds)}</span>
                        ) : (
                            <>
                                {movie.year && <span>{movie.year}</span>}
                                {movie.year && movie.rating != null && <span className="text-white/20">•</span>}
                                {movie.rating != null && (
                                    <span className="flex items-center gap-1 text-yellow-400/90">
                                        <Star className="w-3 h-3 fill-current" />
                                        {movie.rating.toFixed(1)}
                                    </span>
                                )}
                            </>
                        )}
                    </div>
                </div>
            </div>

            {menuAnchor && (
                <MovieActionsMenu
                    movie={movie}
                    anchor={menuAnchor}
                    onClose={closeMenu}
                    onPlay={onClick}
                    onRemoveFromPlaylist={onRemoveFromPlaylist}
                    onMoveToSecure={() => setSecureDialogOpen(true)}
                />
            )}

            {secureDialogOpen && (
                <MoveToSecureDialog
                    movie={movie}
                    onClose={() => setSecureDialogOpen(false)}
                    onMoved={() => {
                        setSecureDialogOpen(false)
                        toast(`Moved “${movie.title}” to Secure Folder`)
                    }}
                />
            )}
        </>
    )
}

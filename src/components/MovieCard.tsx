import { useState, useEffect, useRef } from 'react'
import { Movie, Playlist } from '../types'
import { Star, Calendar, Plus, Check, X, Lock, Play } from 'lucide-react'

interface MovieCardProps {
    movie: Movie
    onClick?: () => void
    progress?: number
}

// Inline SVG placeholder for missing posters (no network dependency)
const PLACEHOLDER_POSTER = `data:image/svg+xml,${encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">
  <rect fill="#1f2937" width="640" height="360"/>
  <text x="50%" y="50%" fill="#9ca3af" font-family="system-ui, sans-serif" font-size="24" text-anchor="middle" dominant-baseline="middle">No Poster</text>
</svg>
`)}`

export function MovieCard({ movie, onClick, progress }: MovieCardProps) {
    const [showPlaylistSelector, setShowPlaylistSelector] = useState(false)
    const [playlists, setPlaylists] = useState<Playlist[]>([])
    const [addedToPlaylist, setAddedToPlaylist] = useState<number | null>(null)
    const [isCreating, setIsCreating] = useState(false)
    const [newPlaylistName, setNewPlaylistName] = useState('')
    const selectorRef = useRef<HTMLDivElement>(null)
    const [imgError, setImgError] = useState(false)
    const [thumbnailRegenRequested, setThumbnailRegenRequested] = useState(false)
    const [secureModalOpen, setSecureModalOpen] = useState(false)
    const [secureMode, setSecureMode] = useState<'confirm' | 'create' | 'unlock'>('unlock')
    const [securePassword, setSecurePassword] = useState('')
    const [secureConfirm, setSecureConfirm] = useState('')
    const [secureError, setSecureError] = useState<string | null>(null)
    const [secureBusy, setSecureBusy] = useState(false)

    // Properly encode Windows paths for the media:// protocol
    const posterUrl = movie.poster_path && !imgError
        ? `media://${encodeURIComponent(movie.poster_path)}`
        : PLACEHOLDER_POSTER

    useEffect(() => {
        // Reset image error when poster path changes so we can retry loading
        setImgError(false)
        setThumbnailRegenRequested(false)
    }, [movie.poster_path])

    useEffect(() => {
        if (!imgError || thumbnailRegenRequested) return
        if (!movie.poster_path) return
        setThumbnailRegenRequested(true)
        void window.ipcRenderer.invoke('thumbnails:regenerate-one', movie.id).catch((err: any) => {
            console.error('Failed to queue thumbnail regeneration:', err)
        })
    }, [imgError, thumbnailRegenRequested, movie.id, movie.poster_path])

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

    const handleMoveToSecure = async (e: React.MouseEvent) => {
        e.stopPropagation()
        const status = await window.ipcRenderer.invoke('secure:status')
        setSecureMode(status.isUnlocked ? 'confirm' : (status.hasPassword ? 'unlock' : 'create'))
        setSecurePassword('')
        setSecureConfirm('')
        setSecureError(null)
        setSecureModalOpen(true)
    }

    const handleSecureSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setSecureError(null)
        if (secureBusy) return
        if (secureMode === 'confirm') {
            // no password needed
        } else if (secureMode === 'create') {
            if (securePassword.length < 6) {
                setSecureError('Password must be at least 6 characters.')
                return
            }
            if (securePassword !== secureConfirm) {
                setSecureError('Passwords do not match.')
                return
            }
        } else {
            if (!securePassword) {
                setSecureError('Password is required.')
                return
            }
        }
        try {
            setSecureBusy(true)
            if (secureMode === 'confirm') {
                await window.ipcRenderer.invoke('secure:import-movie', movie)
            } else {
                await window.ipcRenderer.invoke('secure:import-movie-with-password', movie, securePassword)
            }
            setSecureModalOpen(false)
        } catch (err) {
            setSecureError((err as any)?.message || 'Failed to move to Secure Folder.')
        } finally {
            setSecureBusy(false)
        }
    }

    return (
        <>
            {secureModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={() => !secureBusy && setSecureModalOpen(false)}>
                    <div
                        className="w-full max-w-md mx-4 bg-surface/95 border border-white/10 rounded-2xl p-6 shadow-2xl"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-center gap-3 mb-4">
                            <div className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center">
                                <Lock className="w-4 h-4 text-white/70" />
                            </div>
                            <div>
                                <p className="text-white font-semibold">
                                    {secureMode === 'confirm'
                                        ? 'Move to Secure Folder'
                                        : secureMode === 'create'
                                            ? 'Create Secure Password'
                                            : 'Unlock Secure Folder'}
                                </p>
                                <p className="text-xs text-textMuted">
                                    {secureMode === 'confirm'
                                        ? 'This will encrypt the video and remove it from your library.'
                                        : secureMode === 'create'
                                            ? 'This will encrypt the video and set up your vault.'
                                            : 'Enter your password to encrypt and move this video.'}
                                </p>
                            </div>
                        </div>

                        {secureError && (
                            <div className="mb-3 text-xs text-red-200 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                                {secureError}
                            </div>
                        )}

                        <form onSubmit={handleSecureSubmit} className="space-y-3">
                            {secureMode !== 'confirm' && (
                                <>
                                    <input
                                        type="password"
                                        value={securePassword}
                                        onChange={(e) => setSecurePassword(e.target.value)}
                                        placeholder={secureMode === 'create' ? 'New password' : 'Password'}
                                        className="w-full bg-black/30 text-white text-sm px-3 py-2.5 rounded-lg border border-white/10 focus:border-primary/50 focus:ring-1 focus:ring-primary/40 focus:outline-none"
                                        autoFocus
                                        disabled={secureBusy}
                                    />
                                    {secureMode === 'create' && (
                                        <input
                                            type="password"
                                            value={secureConfirm}
                                            onChange={(e) => setSecureConfirm(e.target.value)}
                                            placeholder="Confirm password"
                                            className="w-full bg-black/30 text-white text-sm px-3 py-2.5 rounded-lg border border-white/10 focus:border-primary/50 focus:ring-1 focus:ring-primary/40 focus:outline-none"
                                            disabled={secureBusy}
                                        />
                                    )}
                                </>
                            )}
                            <div className="flex items-center justify-between pt-2">
                                <button
                                    type="button"
                                    onClick={() => setSecureModalOpen(false)}
                                    className="text-xs text-textMuted hover:text-white transition-colors"
                                    disabled={secureBusy}
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                                    disabled={secureBusy}
                                >
                                    {secureMode === 'confirm'
                                        ? 'Move to Secure'
                                        : secureMode === 'create'
                                            ? 'Create & Move'
                                            : 'Move to Secure'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

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

                        {/* Hover Play Button Overlay */}
                        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300 bg-black/10 backdrop-blur-[1px] pointer-events-none">
                            <div className="w-14 h-14 rounded-full bg-primary/90 flex items-center justify-center shadow-2xl transform scale-75 group-hover:scale-100 transition-all duration-300">
                                <Play className="w-6 h-6 text-white fill-current ml-1" />
                            </div>
                        </div>

                        {/* Gradient Overlay for Bottom Utilities */}
                        <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/80 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col justify-end p-4 pointer-events-none">
                            <div className="transform translate-y-4 group-hover:translate-y-0 transition-transform duration-300 pointer-events-auto">
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

                                    <div className="flex items-center gap-2">
                                        <button
                                            onClick={handleMoveToSecure}
                                            className="p-2 bg-white/10 hover:bg-white/20 text-white rounded-full backdrop-blur-sm transition-colors shadow-lg"
                                            title="Move to Secure Folder"
                                        >
                                            <Lock className="w-4 h-4" />
                                        </button>
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
                    </div>

                    {/* Progress Bar (Visible even without hover) */}
                    {progress !== undefined && progress > 0 && (
                        <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/20">
                            <div
                                className="h-full bg-primary"
                                style={{ width: `${Math.min(100, Math.max(0, progress * 100))}%` }}
                            />
                        </div>
                    )}

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
        </>
    )
}

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight, ListPlus, Lock, Play, Plus, Trash2 } from 'lucide-react'
import { Movie, Playlist } from '../types'
import { useFeedback } from './Feedback'

export interface MenuAnchor {
    x: number
    y: number
    /** Align the menu's right edge to x (used for the ⋯ button); otherwise its left edge. */
    alignRight?: boolean
}

interface MovieActionsMenuProps {
    movie: Movie
    anchor: MenuAnchor
    onClose: () => void
    onPlay?: () => void
    onRemoveFromPlaylist?: () => void
    onMoveToSecure: () => void
}

const VIEWPORT_MARGIN = 8

const itemClass = 'w-full flex items-center gap-3 px-3 py-2 text-sm text-gray-200 rounded-lg outline-none transition-colors hover:bg-white/10 hover:text-white focus-visible:bg-white/10 focus-visible:text-white'

export function MovieActionsMenu({ movie, anchor, onClose, onPlay, onRemoveFromPlaylist, onMoveToSecure }: MovieActionsMenuProps) {
    const { toast } = useFeedback()
    const menuRef = useRef<HTMLDivElement>(null)
    const [view, setView] = useState<'main' | 'playlists'>('main')
    const [playlists, setPlaylists] = useState<Playlist[] | null>(null)
    const [isCreating, setIsCreating] = useState(false)
    const [newPlaylistName, setNewPlaylistName] = useState('')
    const [position, setPosition] = useState<{ left: number; top: number } | null>(null)

    // Place the menu at the anchor, flipped/clamped so it never leaves the window.
    useLayoutEffect(() => {
        const menu = menuRef.current
        if (!menu) return
        const { width, height } = menu.getBoundingClientRect()
        let left = anchor.alignRight ? anchor.x - width : anchor.x
        let top = anchor.y
        if (top + height > window.innerHeight - VIEWPORT_MARGIN) {
            top = Math.max(VIEWPORT_MARGIN, anchor.y - height)
        }
        left = Math.min(Math.max(VIEWPORT_MARGIN, left), window.innerWidth - width - VIEWPORT_MARGIN)
        setPosition({ left, top })
    }, [anchor, view, isCreating, playlists])

    useEffect(() => {
        const handlePointerDown = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose()
        }
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.stopPropagation()
                onClose()
            }
        }
        const handleScroll = (e: Event) => {
            if (menuRef.current && e.target instanceof Node && menuRef.current.contains(e.target)) return
            onClose()
        }
        document.addEventListener('mousedown', handlePointerDown)
        window.addEventListener('keydown', handleKeyDown, true)
        window.addEventListener('scroll', handleScroll, true)
        window.addEventListener('resize', onClose)
        window.addEventListener('blur', onClose)
        return () => {
            document.removeEventListener('mousedown', handlePointerDown)
            window.removeEventListener('keydown', handleKeyDown, true)
            window.removeEventListener('scroll', handleScroll, true)
            window.removeEventListener('resize', onClose)
            window.removeEventListener('blur', onClose)
        }
    }, [onClose])

    useEffect(() => {
        if (isCreating) return
        menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus()
    }, [view, playlists, isCreating])

    const loadPlaylists = async () => {
        const data = await window.ipcRenderer.invoke('db:get-playlists')
        setPlaylists(data)
    }

    const openPlaylists = () => {
        setView('playlists')
        void loadPlaylists()
    }

    const handleAdd = async (playlist: Playlist) => {
        try {
            await window.ipcRenderer.invoke('db:add-movie-to-playlist', playlist.id, movie.id)
            toast(`Added to “${playlist.name}”`)
        } catch (err) {
            console.error('Failed to add to playlist:', err)
            toast('Couldn’t add to playlist', 'error')
        }
        onClose()
    }

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault()
        const name = newPlaylistName.trim()
        if (!name) return
        try {
            const result = await window.ipcRenderer.invoke('db:create-playlist', name) as { lastInsertRowid: number | bigint }
            await handleAdd({ id: Number(result.lastInsertRowid), name, created_at: '' })
            return
        } catch (err) {
            console.error('Failed to create playlist:', err)
            toast('Couldn’t create playlist', 'error')
        }
        setNewPlaylistName('')
        setIsCreating(false)
    }

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (isCreating) return
        const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])
        const index = items.indexOf(document.activeElement as HTMLButtonElement)
        if (e.key === 'ArrowDown') {
            e.preventDefault()
            items[(index + 1) % items.length]?.focus()
        } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            items[(index - 1 + items.length) % items.length]?.focus()
        } else if (e.key === 'ArrowLeft' && view === 'playlists') {
            e.preventDefault()
            setView('main')
        } else if (e.key === 'Tab') {
            e.preventDefault()
            onClose()
        }
    }

    return createPortal(
        <div
            ref={menuRef}
            role="menu"
            aria-label={`Actions for ${movie.title}`}
            onKeyDown={handleKeyDown}
            onClick={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.preventDefault()}
            className="fixed z-[90] w-60 p-1.5 bg-surface/95 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl animate-in fade-in zoom-in-95 duration-100"
            style={position ?? { left: anchor.x, top: anchor.y, visibility: 'hidden' }}
        >
            {view === 'main' ? (
                <>
                    {onPlay && (
                        <button role="menuitem" className={itemClass} onClick={() => { onClose(); onPlay() }}>
                            <Play className="w-4 h-4" />
                            Play
                        </button>
                    )}
                    <button role="menuitem" className={itemClass} onClick={openPlaylists}>
                        <ListPlus className="w-4 h-4" />
                        <span className="flex-1 text-left">Add to playlist</span>
                        <ChevronRight className="w-4 h-4 text-white/40" />
                    </button>
                    {onRemoveFromPlaylist && (
                        <button role="menuitem" className={itemClass} onClick={() => { onClose(); onRemoveFromPlaylist() }}>
                            <Trash2 className="w-4 h-4" />
                            Remove from playlist
                        </button>
                    )}
                    <div className="my-1.5 h-px bg-white/5" />
                    <button role="menuitem" className={itemClass} onClick={() => { onClose(); onMoveToSecure() }}>
                        <Lock className="w-4 h-4" />
                        Move to Secure Folder…
                    </button>
                </>
            ) : (
                <>
                    <button
                        role="menuitem"
                        className={`${itemClass} text-white/60`}
                        onClick={() => setView('main')}
                    >
                        <ChevronLeft className="w-4 h-4" />
                        Add to playlist
                    </button>
                    <div className="my-1 h-px bg-white/5" />
                    <div className="max-h-56 overflow-y-auto">
                        {playlists === null ? (
                            <p className="px-3 py-3 text-xs text-textMuted">Loading…</p>
                        ) : playlists.length === 0 ? (
                            <p className="px-3 py-3 text-xs text-textMuted">No playlists yet</p>
                        ) : (
                            playlists.map(playlist => (
                                <button key={playlist.id} role="menuitem" className={itemClass} onClick={() => void handleAdd(playlist)}>
                                    <span className="truncate">{playlist.name}</span>
                                </button>
                            ))
                        )}
                    </div>
                    <div className="my-1 h-px bg-white/5" />
                    {isCreating ? (
                        <form onSubmit={handleCreate} className="flex gap-1.5 p-1">
                            <input
                                type="text"
                                value={newPlaylistName}
                                onChange={(e) => setNewPlaylistName(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Escape') {
                                        e.stopPropagation()
                                        setIsCreating(false)
                                    }
                                }}
                                placeholder="Playlist name"
                                className="flex-1 min-w-0 bg-black/40 text-white text-sm px-2.5 py-1.5 rounded-md border border-white/10 focus:border-primary/50 focus:outline-none placeholder:text-textMuted/60"
                                autoFocus
                            />
                            <button
                                type="submit"
                                className="px-2.5 py-1.5 bg-primary text-white text-xs font-semibold rounded-md hover:bg-primary/90 transition-colors"
                            >
                                Add
                            </button>
                        </form>
                    ) : (
                        <button role="menuitem" className={`${itemClass} text-primary hover:text-primary`} onClick={() => setIsCreating(true)}>
                            <Plus className="w-4 h-4" />
                            New playlist
                        </button>
                    )}
                </>
            )}
        </div>,
        document.body
    )
}

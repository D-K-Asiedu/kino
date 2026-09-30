import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FolderTree, ListVideo, Plus, Search, X } from 'lucide-react'
import { PlaylistCard } from '../components/PlaylistCard'
import { MovieGridSkeleton } from '../components/Skeleton'
import { useFeedback } from '../components/Feedback'
import { useCoalescedIpcRefresh } from '../hooks/useCoalescedIpcRefresh'
import { Movie, Playlist } from '../types'

type PlaylistWithMovies = Playlist & { movies: Movie[]; movie_count: number }

export function Playlists() {
    const navigate = useNavigate()
    const { confirm, toast } = useFeedback()
    const [playlists, setPlaylists] = useState<PlaylistWithMovies[]>([])
    const [loading, setLoading] = useState(true)
    const [searchQuery, setSearchQuery] = useState('')
    const [isCreating, setIsCreating] = useState(false)
    const [newPlaylistName, setNewPlaylistName] = useState('')
    const createInputRef = useRef<HTMLInputElement>(null)

    const fetchPlaylists = useCallback(async () => {
        try {
            const data = await window.ipcRenderer.invoke('db:get-playlists-overview')
            setPlaylists(data)
        } catch (err) {
            console.error('Failed to load playlists:', err)
        } finally {
            setLoading(false)
        }
    }, [])

    const { runNow: refreshPlaylists } = useCoalescedIpcRefresh(
        fetchPlaylists,
        ['playlists-updated', 'library-updated'],
        { delayMs: 150 }
    )

    useEffect(() => {
        void refreshPlaylists()
    }, [refreshPlaylists])

    useEffect(() => {
        if (isCreating) createInputRef.current?.focus()
    }, [isCreating])

    const visiblePlaylists = useMemo(() => {
        const query = searchQuery.trim().toLowerCase()
        if (!query) return playlists
        return playlists.filter(p => p.name.toLowerCase().includes(query))
    }, [playlists, searchQuery])

    const stopCreating = () => {
        setNewPlaylistName('')
        setIsCreating(false)
    }

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault()
        const name = newPlaylistName.trim()
        if (!name) return
        try {
            await window.ipcRenderer.invoke('db:create-playlist', name)
            toast(`Created “${name}”`)
            stopCreating()
            void refreshPlaylists()
        } catch (err) {
            console.error('Failed to create playlist:', err)
            toast('Couldn’t create playlist', 'error')
        }
    }

    const handleGenerate = async () => {
        const ok = await confirm({
            title: 'Create playlists from folders?',
            message: 'Kino will group your videos by the folder they live in and create a playlist for each one.',
            confirmLabel: 'Create playlists',
        })
        if (!ok) return
        try {
            const result = await window.ipcRenderer.invoke('db:generate-default-playlists')
            toast(`Created ${result.created} ${result.created === 1 ? 'playlist' : 'playlists'} and added ${result.added} videos`)
            void refreshPlaylists()
        } catch (err) {
            console.error('Failed to generate playlists:', err)
            toast('Couldn’t create playlists from folders', 'error')
        }
    }

    const handleDelete = async (playlist: Playlist) => {
        const ok = await confirm({
            title: `Delete “${playlist.name}”?`,
            message: 'The playlist will be removed. The videos stay in your library.',
            confirmLabel: 'Delete',
            destructive: true,
        })
        if (!ok) return
        await window.ipcRenderer.invoke('db:delete-playlist', playlist.id)
        toast(`Deleted “${playlist.name}”`)
        void refreshPlaylists()
    }

    return (
        <div className="p-8 max-w-[1920px] mx-auto">
            <header className="flex items-center justify-between gap-6 mb-8">
                <div>
                    <h1 className="text-3xl font-semibold text-white tracking-tight">Playlists</h1>
                    <p className="text-textMuted mt-1">
                        {loading ? ' ' : `${playlists.length} ${playlists.length === 1 ? 'playlist' : 'playlists'}`}
                    </p>
                </div>

                <div className="flex items-center gap-3">
                    {playlists.length > 0 && (
                        <div className="relative group">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-textMuted group-focus-within:text-primary transition-colors" />
                            <input
                                type="text"
                                placeholder="Find a playlist..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Escape') {
                                        setSearchQuery('')
                                        e.currentTarget.blur()
                                    }
                                }}
                                className="bg-white/5 text-sm text-white pl-10 pr-8 py-1.5 rounded-lg border border-white/10 focus:border-white/20 focus:bg-white/10 focus:outline-none transition-all w-56 placeholder:text-textMuted/60"
                                aria-label="Find a playlist"
                            />
                            {searchQuery && (
                                <button
                                    onClick={() => setSearchQuery('')}
                                    className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded text-textMuted hover:text-white"
                                    aria-label="Clear search"
                                >
                                    <X className="w-3.5 h-3.5" />
                                </button>
                            )}
                        </div>
                    )}

                    <button
                        onClick={handleGenerate}
                        className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-lg text-textMuted hover:text-white hover:bg-white/5 transition-colors"
                        title="Group videos by folder into playlists"
                    >
                        <FolderTree className="w-4 h-4" />
                        <span>From folders</span>
                    </button>

                    {isCreating ? (
                        <form onSubmit={handleCreate} className="flex items-center gap-2">
                            <input
                                ref={createInputRef}
                                type="text"
                                value={newPlaylistName}
                                onChange={(e) => setNewPlaylistName(e.target.value)}
                                onKeyDown={(e) => e.key === 'Escape' && stopCreating()}
                                onBlur={() => !newPlaylistName && stopCreating()}
                                placeholder="Playlist name"
                                className="w-52 bg-black/30 text-white text-sm px-3 py-1.5 rounded-lg border border-primary/50 ring-1 ring-primary/40 focus:outline-none placeholder:text-textMuted/60"
                                aria-label="New playlist name"
                            />
                            <button
                                type="submit"
                                className="px-3 py-1.5 rounded-lg bg-primary hover:bg-primary/90 text-white text-sm font-semibold transition-colors"
                            >
                                Create
                            </button>
                        </form>
                    ) : (
                        <button
                            onClick={() => setIsCreating(true)}
                            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-primary hover:bg-primary/90 text-white text-sm font-semibold transition-colors"
                        >
                            <Plus className="w-4 h-4" />
                            New playlist
                        </button>
                    )}
                </div>
            </header>

            {loading ? (
                <MovieGridSkeleton count={8} />
            ) : playlists.length === 0 ? (
                <div className="flex flex-col items-center justify-center text-center py-24">
                    <div className="w-14 h-14 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center mb-5">
                        <ListVideo className="w-6 h-6 text-primary" />
                    </div>
                    <h2 className="text-xl font-semibold text-white">No playlists yet</h2>
                    <p className="mt-2 text-textMuted max-w-sm">
                        Create one, or let Kino build playlists from the folders your videos live in.
                    </p>
                    <div className="mt-6 flex items-center gap-3">
                        <button
                            onClick={() => setIsCreating(true)}
                            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary hover:bg-primary/90 text-white font-semibold transition-colors"
                        >
                            <Plus className="w-4 h-4" />
                            New playlist
                        </button>
                        <button
                            onClick={handleGenerate}
                            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-white font-medium border border-white/10 transition-colors"
                        >
                            <FolderTree className="w-4 h-4" />
                            Create from folders
                        </button>
                    </div>
                </div>
            ) : visiblePlaylists.length === 0 ? (
                <div className="text-center py-16 text-textMuted">
                    <p className="text-white">No matches</p>
                    <p className="text-sm mt-1">No playlist is named like “{searchQuery.trim()}”.</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                    {visiblePlaylists.map(playlist => (
                        <PlaylistCard
                            key={playlist.id}
                            playlist={playlist}
                            onClick={() => navigate(`/playlists/${playlist.id}`)}
                            onDelete={() => void handleDelete(playlist)}
                        />
                    ))}
                </div>
            )}
        </div>
    )
}

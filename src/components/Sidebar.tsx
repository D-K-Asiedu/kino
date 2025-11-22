import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Film, Settings, MonitorPlay, ListMusic, Plus, Trash2, RefreshCw } from 'lucide-react'
import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { useEffect, useState } from 'react'
import { Playlist } from '../types'

export function Sidebar() {
    const location = useLocation()
    const navigate = useNavigate()
    const [playlists, setPlaylists] = useState<Playlist[]>([])
    const [isCreating, setIsCreating] = useState(false)
    const [newPlaylistName, setNewPlaylistName] = useState('')

    const fetchPlaylists = async () => {
        const data = await window.ipcRenderer.invoke('db:get-playlists')
        setPlaylists(data)
    }

    useEffect(() => {
        fetchPlaylists()

        const handlePlaylistUpdate = () => {
            fetchPlaylists()
        }

        window.ipcRenderer.on('playlists-updated', handlePlaylistUpdate)

        return () => {
            window.ipcRenderer.off('playlists-updated', handlePlaylistUpdate)
        }
    }, [])

    const handleCreatePlaylist = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!newPlaylistName.trim()) return

        await window.ipcRenderer.invoke('db:create-playlist', newPlaylistName)
        setNewPlaylistName('')
        setIsCreating(false)
        fetchPlaylists()
    }

    const handleDeletePlaylist = async (e: React.MouseEvent, id: number) => {
        e.preventDefault()
        e.stopPropagation()
        if (confirm('Are you sure you want to delete this playlist?')) {
            await window.ipcRenderer.invoke('db:delete-playlist', id)
            fetchPlaylists()
            if (location.pathname === `/playlists/${id}`) {
                navigate('/')
            }
        }
    }

    const handleGeneratePlaylists = async () => {
        if (confirm('Generate playlists from folders? This will group movies by their parent directory.')) {
            const result = await window.ipcRenderer.invoke('db:generate-default-playlists')
            alert(`Created ${result.created} playlists and added ${result.added} movies.`)
            fetchPlaylists()
        }
    }

    const navItems = [
        { path: '/', label: 'Library', icon: Film },
        { path: '/settings', label: 'Settings', icon: Settings },
    ]

    return (
        <div className="w-64 h-full flex flex-col bg-surface/90 backdrop-blur-2xl border-r border-white/5 relative z-50">
            {/* Logo Section */}
            <div className="p-6 flex items-center gap-3 mb-2">
                <div className="w-8 h-8 bg-gradient-to-br from-primary to-primary/50 rounded-lg flex items-center justify-center shadow-lg shadow-primary/20 ring-1 ring-white/10">
                    <MonitorPlay className="w-4 h-4 text-white" />
                </div>
                <div>
                    <h1 className="text-lg font-bold text-white tracking-tight leading-none">Kino</h1>
                    <p className="text-[10px] text-textMuted font-medium uppercase tracking-wider mt-0.5">Personal Media</p>
                </div>
            </div>

            <nav className="flex-1 px-3 py-2 space-y-6 overflow-y-auto custom-scrollbar">
                {/* Main Menu */}
                <div className="space-y-1">
                    <p className="px-3 text-[10px] font-bold text-textMuted/50 uppercase tracking-widest mb-2">Menu</p>
                    {navItems.map((item) => {
                        const isActive = location.pathname === item.path
                        const Icon = item.icon

                        return (
                            <Link
                                key={item.path}
                                to={item.path}
                                className={twMerge(
                                    clsx(
                                        "flex items-center gap-3 px-3 py-2 rounded-lg transition-all duration-200 group relative overflow-hidden",
                                        isActive
                                            ? "bg-white/10 text-white shadow-sm ring-1 ring-white/5"
                                            : "text-textMuted hover:bg-white/5 hover:text-white"
                                    )
                                )}
                            >
                                {isActive && (
                                    <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-4 bg-primary rounded-r-full" />
                                )}
                                <Icon className={clsx("w-4 h-4 transition-colors", isActive ? "text-primary" : "text-textMuted group-hover:text-white")} />
                                <span className="font-medium text-sm">{item.label}</span>
                            </Link>
                        )
                    })}
                </div>

                {/* Playlists */}
                <div className="space-y-1">
                    <div className="px-3 mb-2">
                        <div className="flex items-center justify-between mb-2">
                            <p className="text-[10px] font-bold text-textMuted/50 uppercase tracking-widest">Playlists</p>
                            <button
                                onClick={handleGeneratePlaylists}
                                className="text-textMuted hover:text-primary transition-colors p-1 hover:bg-white/5 rounded"
                                title="Refresh playlists"
                            >
                                <RefreshCw className="w-3 h-3" />
                            </button>
                        </div>
                        <button
                            onClick={() => setIsCreating(true)}
                            className="flex items-center gap-3 px-3 py-2 w-full rounded-lg text-textMuted hover:bg-white/5 hover:text-white transition-all duration-200 group border border-dashed border-white/10 hover:border-white/20"
                        >
                            <div className="w-4 h-4 flex items-center justify-center rounded bg-white/5 group-hover:bg-white/10 transition-colors">
                                <Plus className="w-3 h-3" />
                            </div>
                            <span className="font-medium text-sm">New Playlist</span>
                        </button>
                    </div>

                    {isCreating && (
                        <form onSubmit={handleCreatePlaylist} className="px-3 mb-2">
                            <input
                                type="text"
                                value={newPlaylistName}
                                onChange={(e) => setNewPlaylistName(e.target.value)}
                                placeholder="Playlist name..."
                                className="w-full bg-black/20 text-white text-sm px-3 py-1.5 rounded-md border border-white/10 focus:border-primary/50 focus:ring-1 focus:ring-primary/50 focus:outline-none placeholder:text-textMuted/50 transition-all"
                                autoFocus
                                onBlur={() => !newPlaylistName && setIsCreating(false)}
                            />
                        </form>
                    )}

                    <div className="space-y-0.5">
                        {playlists.map((playlist) => {
                            const isActive = location.pathname === `/playlists/${playlist.id}`
                            return (
                                <Link
                                    key={playlist.id}
                                    to={`/playlists/${playlist.id}`}
                                    className={twMerge(
                                        clsx(
                                            "flex items-center justify-between px-3 py-2 rounded-lg transition-all duration-200 group relative",
                                            isActive
                                                ? "bg-white/5 text-white"
                                                : "text-textMuted hover:bg-white/5 hover:text-white"
                                        )
                                    )}
                                >
                                    <div className="flex items-center gap-3 overflow-hidden">
                                        <ListMusic className={clsx("w-4 h-4 flex-shrink-0 transition-colors", isActive ? "text-primary" : "text-textMuted group-hover:text-primary")} />
                                        <span className="font-medium text-sm truncate">{playlist.name}</span>
                                    </div>
                                    <button
                                        onClick={(e) => handleDeletePlaylist(e, playlist.id)}
                                        className="opacity-0 group-hover:opacity-100 text-textMuted hover:text-red-400 transition-all duration-200 p-1 hover:bg-white/5 rounded"
                                    >
                                        <Trash2 className="w-3 h-3" />
                                    </button>
                                </Link>
                            )
                        })}
                    </div>
                </div>
            </nav>

            {/* Footer */}
            <div className="p-4 border-t border-white/5">
                <div className="flex items-center justify-center">
                    <p className="text-[10px] text-textMuted/30 font-medium hover:text-textMuted transition-colors cursor-default">
                        v0.1.0
                    </p>
                </div>
            </div>
        </div>
    )
}

import { useEffect, useMemo, useRef, useState } from 'react'
import { Lock, Unlock, Play, Trash2, EyeOff, ArchiveRestore, Loader2 } from 'lucide-react'
import { SecureItem, Movie } from '../types'
import { VideoPlayer } from '../components/VideoPlayer'
import { Poster } from '../components/Poster'
import { useFeedback } from '../components/Feedback'

export function SecureFolder() {
    const { confirm, toast } = useFeedback()
    const [loading, setLoading] = useState(true)
    const [hasPassword, setHasPassword] = useState(false)
    const [isUnlocked, setIsUnlocked] = useState(false)
    const [items, setItems] = useState<SecureItem[]>([])
    const [password, setPassword] = useState('')
    const [confirmPassword, setConfirmPassword] = useState('')
    const [error, setError] = useState<string | null>(null)
    const [selectedMovie, setSelectedMovie] = useState<Movie | null>(null)
    const [activeTempPath, setActiveTempPath] = useState<string | null>(null)
    const activeTempPathRef = useRef<string | null>(null)
    const [thumbs, setThumbs] = useState<Record<number, string>>({})
    const [restoringIds, setRestoringIds] = useState<Set<number>>(new Set())

    const refreshStatus = async () => {
        const status = await window.ipcRenderer.invoke('secure:status')
        setHasPassword(status.hasPassword)
        setIsUnlocked(status.isUnlocked)
    }

    const fetchItems = async () => {
        const data = await window.ipcRenderer.invoke('secure:list')
        setItems(data)
    }

    useEffect(() => {
        const init = async () => {
            setLoading(true)
            try {
                await refreshStatus()
            } finally {
                setLoading(false)
            }
        }
        init()
    }, [])

    useEffect(() => {
        if (isUnlocked) {
            fetchItems()
        } else {
            setItems([])
            setThumbs({})
        }
    }, [isUnlocked])

    useEffect(() => {
        activeTempPathRef.current = activeTempPath
    }, [activeTempPath])

    useEffect(() => {
        return () => {
            window.ipcRenderer.invoke('secure:lock')
            if (activeTempPathRef.current) {
                window.ipcRenderer.invoke('secure:release-playback', activeTempPathRef.current)
            }
        }
    }, [])

    const handleSetPassword = async (e: React.FormEvent) => {
        e.preventDefault()
        setError(null)
        if (!password || password.length < 6) {
            setError('Password must be at least 6 characters.')
            return
        }
        if (password !== confirmPassword) {
            setError('Passwords do not match.')
            return
        }
        try {
            await window.ipcRenderer.invoke('secure:set-password', password)
            setPassword('')
            setConfirmPassword('')
            await refreshStatus()
        } catch (err: any) {
            setError(err.message || 'Failed to set password.')
        }
    }

    const handleUnlock = async (e: React.FormEvent) => {
        e.preventDefault()
        setError(null)
        try {
            await window.ipcRenderer.invoke('secure:unlock', password)
            setPassword('')
            await refreshStatus()
        } catch (err: any) {
            setError(err.message || 'Failed to unlock.')
        }
    }

    const handleLock = async () => {
        await window.ipcRenderer.invoke('secure:lock')
        setSelectedMovie(null)
        if (activeTempPath) {
            await window.ipcRenderer.invoke('secure:release-playback', activeTempPath)
            setActiveTempPath(null)
        }
        await refreshStatus()
        setThumbs({})
    }

    const handleReset = async () => {
        const ok = await confirm({
            title: 'Reset Secure Folder?',
            message: 'This permanently deletes every video inside it and removes your password. This can’t be undone.',
            confirmLabel: 'Reset and delete',
            destructive: true,
        })
        if (!ok) return
        setError(null)
        await window.ipcRenderer.invoke('secure:reset')
        setPassword('')
        setConfirmPassword('')
        setSelectedMovie(null)
        if (activeTempPath) {
            await window.ipcRenderer.invoke('secure:release-playback', activeTempPath)
            setActiveTempPath(null)
        }
        await refreshStatus()
        setThumbs({})
    }

    const handlePlay = async (item: SecureItem) => {
        try {
            if (activeTempPath) {
                await window.ipcRenderer.invoke('secure:release-playback', activeTempPath)
                setActiveTempPath(null)
            }
            const result = await window.ipcRenderer.invoke('secure:prepare-playback', item.id)
            const tempPath = result.tempPath as string
            setActiveTempPath(tempPath)
            setSelectedMovie({
                id: item.id,
                title: item.title,
                original_title: item.original_title,
                year: item.year,
                plot: item.plot,
                poster_path: item.poster_path,
                backdrop_path: item.backdrop_path,
                rating: item.rating,
                file_path: tempPath,
                added_at: item.added_at
            })
        } catch (err: any) {
            setError(err.message || 'Failed to play secure item.')
        }
    }

    const handleDelete = async (item: SecureItem) => {
        const ok = await confirm({
            title: `Delete “${item.title}”?`,
            message: 'The encrypted copy will be permanently deleted from the Secure Folder.',
            confirmLabel: 'Delete',
            destructive: true,
        })
        if (!ok) return
        await window.ipcRenderer.invoke('secure:delete-item', item.id)
        fetchItems()
        toast(`Deleted “${item.title}”`)
    }

    const handleRestore = async (item: SecureItem) => {
        const ok = await confirm({
            title: `Restore “${item.title}”?`,
            message: 'The video will be decrypted and saved as a normal file in a folder you choose, then removed from the Secure Folder.',
            confirmLabel: 'Choose location',
        })
        if (!ok) return
        setRestoringIds((prev) => new Set(prev).add(item.id))
        try {
            const result = await window.ipcRenderer.invoke('secure:restore-item', item.id)
            if (result?.canceled) return
            if (result.inLibrary) {
                toast(`Restored “${item.title}” to your library`, 'success')
            } else {
                toast(`Saved “${item.title}” to ${result.filePath}. That folder isn’t in your library, so it won’t show up there.`, 'info')
            }
            setThumbs((prev) => {
                const next = { ...prev }
                delete next[item.id]
                return next
            })
            fetchItems().catch(() => undefined)
        } catch (err: any) {
            toast(cleanIpcError(err) || 'Restore failed.', 'error')
        } finally {
            setRestoringIds((prev) => {
                const next = new Set(prev)
                next.delete(item.id)
                return next
            })
        }
    }

    const heroNote = useMemo(() => {
        if (!hasPassword) return 'Create a private space for videos you want hidden and encrypted.'
        if (!isUnlocked) return 'Unlock to access your secure library.'
        return 'Only visible while unlocked. Files stay encrypted on disk.'
    }, [hasPassword, isUnlocked])

    const requestThumbnail = async (itemId: number) => {
        if (!isUnlocked) return null
        try {
            const result = await window.ipcRenderer.invoke('secure:get-thumbnail', itemId)
            const path = result?.path as string | undefined
            if (!path) return null
            setThumbs((prev) => prev[itemId] ? prev : { ...prev, [itemId]: path })
            return path
        } catch {
            return null
        }
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center h-full">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
        )
    }

    return (
        <div className="p-8 max-w-[1920px] mx-auto">
            <header className="flex items-center justify-between mb-8">
                <div>
                    <h2 className="text-3xl font-semibold text-white tracking-tight flex items-center gap-3">
                        <span className="inline-flex w-9 h-9 rounded-xl bg-white/5 items-center justify-center border border-white/10">
                            {isUnlocked ? <Unlock className="w-4 h-4 text-primary" /> : <Lock className="w-4 h-4 text-white/60" />}
                        </span>
                        Secure Folder
                    </h2>
                    <p className="text-textMuted mt-1">{heroNote}</p>
                </div>
                {isUnlocked && (
                    <button
                        onClick={handleLock}
                        className="px-4 py-2 rounded-full text-sm font-medium bg-white/5 hover:bg-white/10 text-white/70 hover:text-white transition-colors"
                    >
                        Lock
                    </button>
                )}
            </header>

            {error && (
                <div className="mb-6 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-200 text-sm">
                    {error}
                </div>
            )}

            {!hasPassword && (
                <div className="max-w-md mx-auto mt-12 bg-surface/80 border border-white/10 rounded-2xl p-6 shadow-xl">
                    <div className="flex items-center gap-3 mb-4">
                        <div className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center">
                            <Lock className="w-4 h-4 text-white/70" />
                        </div>
                        <div>
                            <p className="text-white font-semibold">Set a Secure Password</p>
                            <p className="text-xs text-textMuted">If you forget it, you can reset and wipe this folder.</p>
                        </div>
                    </div>
                    <form onSubmit={handleSetPassword} className="space-y-3">
                        <input
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="New password"
                            className="w-full bg-black/30 text-white text-sm px-3 py-2.5 rounded-lg border border-white/10 focus:border-primary/50 focus:ring-1 focus:ring-primary/40 focus:outline-none"
                        />
                        <input
                            type="password"
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            placeholder="Confirm password"
                            className="w-full bg-black/30 text-white text-sm px-3 py-2.5 rounded-lg border border-white/10 focus:border-primary/50 focus:ring-1 focus:ring-primary/40 focus:outline-none"
                        />
                        <button
                            type="submit"
                            className="w-full py-2.5 rounded-lg bg-primary text-white font-semibold text-sm hover:bg-primary/90 transition-colors"
                        >
                            Create Secure Folder
                        </button>
                    </form>
                </div>
            )}

            {hasPassword && !isUnlocked && (
                <div className="max-w-md mx-auto mt-12 bg-surface/80 border border-white/10 rounded-2xl p-6 shadow-xl">
                    <div className="flex items-center gap-3 mb-4">
                        <div className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center">
                            <EyeOff className="w-4 h-4 text-white/70" />
                        </div>
                        <div>
                            <p className="text-white font-semibold">Locked</p>
                            <p className="text-xs text-textMuted">Enter your password to unlock.</p>
                        </div>
                    </div>
                    <form onSubmit={handleUnlock} className="space-y-3">
                        <input
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="Password"
                            className="w-full bg-black/30 text-white text-sm px-3 py-2.5 rounded-lg border border-white/10 focus:border-primary/50 focus:ring-1 focus:ring-primary/40 focus:outline-none"
                        />
                        <button
                            type="submit"
                            className="w-full py-2.5 rounded-lg bg-primary text-white font-semibold text-sm hover:bg-primary/90 transition-colors"
                        >
                            Unlock
                        </button>
                    </form>
                    <button
                        onClick={handleReset}
                        className="mt-4 text-xs text-textMuted hover:text-red-300 transition-colors"
                    >
                        Forgot password? Reset and delete everything.
                    </button>
                </div>
            )}

            {isUnlocked && (
                <>
                    {items.length === 0 ? (
                        <div className="mt-20 text-center text-textMuted">
                            <p className="text-sm">Nothing inside yet.</p>
                            <p className="text-xs mt-1">Use the lock icon on a movie to move it here.</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                            {items.map((item) => {
                                return (
                                    <SecureItemCard
                                        key={item.id}
                                        item={item}
                                        posterPath={thumbs[item.id] ?? null}
                                        onPlay={handlePlay}
                                        onDelete={handleDelete}
                                        onRestore={handleRestore}
                                        restoring={restoringIds.has(item.id)}
                                        requestThumbnail={requestThumbnail}
                                        isUnlocked={isUnlocked}
                                    />
                                )
                            })}
                        </div>
                    )}
                </>
            )}
            {selectedMovie && (
                <VideoPlayer
                    movie={selectedMovie}
                    disableProgress
                    onClose={async () => {
                        setSelectedMovie(null)
                        if (activeTempPath) {
                            await window.ipcRenderer.invoke('secure:release-playback', activeTempPath)
                            setActiveTempPath(null)
                        }
                    }}
                />
            )}
        </div>
    )
}

function SecureItemCard({
    item,
    posterPath,
    onPlay,
    onDelete,
    onRestore,
    restoring,
    requestThumbnail,
    isUnlocked,
}: {
    item: SecureItem
    posterPath: string | null
    onPlay: (item: SecureItem) => void
    onDelete: (item: SecureItem) => void
    onRestore: (item: SecureItem) => void
    restoring: boolean
    requestThumbnail: (itemId: number) => Promise<string | null>
    isUnlocked: boolean
}) {
    const [requested, setRequested] = useState(false)
    const [loadingThumb, setLoadingThumb] = useState(false)
    const ref = useRef<HTMLDivElement | null>(null)

    useEffect(() => {
        if (!isUnlocked || requested) return
        const node = ref.current
        if (!node) return

        const observer = new IntersectionObserver(
            (entries) => {
                for (const entry of entries) {
                    if (entry.isIntersecting) {
                        setRequested(true)
                        setLoadingThumb(true)
                        void requestThumbnail(item.id).then((path) => {
                            if (!path) setLoadingThumb(false)
                        })
                        observer.disconnect()
                        return
                    }
                }
            },
            { rootMargin: '200px' }
        )

        observer.observe(node)
        return () => observer.disconnect()
    }, [isUnlocked, requested, requestThumbnail, item.id])

    return (
        <div
            ref={ref}
            className="group relative"
        >
            <div className="relative aspect-video rounded-xl overflow-hidden bg-surfaceHighlight shadow-lg transition-all duration-300 group-hover:shadow-2xl group-hover:shadow-primary/10 group-hover:scale-[1.02]">
                {loadingThumb && (
                    <div className="absolute inset-0 z-10 bg-black/20 overflow-hidden">
                        <div className="absolute inset-0 animate-pulse bg-gradient-to-r from-transparent via-white/10 to-transparent" />
                    </div>
                )}
                <Poster
                    path={posterPath}
                    title={item.title}
                    className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                    onLoad={() => setLoadingThumb(false)}
                    onError={() => setLoadingThumb(false)}
                />
                {restoring && (
                    <div className="absolute inset-0 z-20 bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center gap-2 text-white">
                        <Loader2 className="w-5 h-5 animate-spin" />
                        <span className="text-xs font-medium">Restoring…</span>
                    </div>
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-end p-4">
                    <div className="w-full flex items-center justify-between">
                        <button
                            onClick={() => onPlay(item)}
                            className="p-2 bg-white/10 hover:bg-primary text-white rounded-full backdrop-blur-sm transition-colors shadow-lg"
                            title="Play"
                        >
                            <Play className="w-4 h-4 fill-current" />
                        </button>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => onRestore(item)}
                                className="p-2 bg-white/10 hover:bg-primary text-white rounded-full backdrop-blur-sm transition-colors shadow-lg"
                                title="Restore to a folder"
                            >
                                <ArchiveRestore className="w-4 h-4" />
                            </button>
                            <button
                                onClick={() => onDelete(item)}
                                className="p-2 bg-white/10 hover:bg-red-500 text-white rounded-full backdrop-blur-sm transition-colors shadow-lg"
                                title="Delete"
                            >
                                <Trash2 className="w-4 h-4" />
                            </button>
                        </div>
                    </div>
                </div>
            </div>
            <div className="mt-3">
                <h3 className="font-medium text-text text-base line-clamp-2">{item.title}</h3>
                <p className="text-textMuted text-xs mt-0.5">{item.year ?? ''}</p>
            </div>
        </div>
    )
}

/** ipcRenderer.invoke wraps main-process errors as "Error invoking remote method '…': Error: <message>". */
function cleanIpcError(err: any): string {
    const message = String(err?.message ?? '')
    return message.replace(/^Error invoking remote method '[^']*': (?:Error: )?/, '')
}

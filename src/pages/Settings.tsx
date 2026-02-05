import { useEffect, useState, useRef } from 'react'
import { WatchPath } from '../types'
import { FolderPlus, Trash2, RefreshCw, Folder } from 'lucide-react'

function PathMarquee({ text }: { text: string }) {
    const wrapperRef = useRef<HTMLDivElement | null>(null)
    const [overflow, setOverflow] = useState(false)

    useEffect(() => {
        const el = wrapperRef.current
        if (!el) return

        const check = () => {
            // scrollWidth > clientWidth indicates overflow
            setOverflow(el.scrollWidth > el.clientWidth)
        }

        check()
        const ro = new ResizeObserver(check)
        ro.observe(el)
        window.addEventListener('resize', check)

        return () => {
            ro.disconnect()
            window.removeEventListener('resize', check)
        }
    }, [text])

    return (
        <div ref={wrapperRef} className="marquee-track" data-overflow={overflow}>
            <span className="marquee-content block text-sm font-mono text-text whitespace-nowrap">{text}</span>
        </div>
    )
}

export function Settings() {
    const [watchPaths, setWatchPaths] = useState<WatchPath[]>([])
    const [loading, setLoading] = useState(true)
    const [regenerating, setRegenerating] = useState(false)

    const fetchWatchPaths = async () => {
        try {
            const paths = await window.ipcRenderer.invoke('db:get-watch-paths')
            setWatchPaths(paths)
        } catch (err) {
            console.error('Error fetching watch paths:', err)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        fetchWatchPaths()
    }, [])

    const handleAddPath = async () => {
        try {
            const result = await window.ipcRenderer.invoke('dialog:open-directory')
            if (result) {
                await window.ipcRenderer.invoke('db:add-watch-path', result)
                await window.ipcRenderer.invoke('watcher:update')
                fetchWatchPaths()
            }
        } catch (err) {
            console.error('Error adding watch path:', err)
        }
    }

    const handleRemovePath = async (id: number) => {
        try {
            await window.ipcRenderer.invoke('db:remove-watch-path', id)
            await window.ipcRenderer.invoke('watcher:update')
            fetchWatchPaths()
        } catch (err) {
            console.error('Error removing watch path:', err)
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
        <div className="p-8 max-w-4xl mx-auto">
            <h1 className="text-3xl font-bold text-white mb-8 tracking-tight">Settings</h1>

            {/* Watch Paths Section */}
            <section className="mb-12">
                <div className="flex items-center justify-between mb-6">
                    <div>
                        <h2 className="text-xl font-semibold text-white">Watch Folders</h2>
                        <p className="text-textMuted text-sm mt-1">
                            Manage folders to scan for video files
                        </p>
                    </div>
                    <button
                        onClick={handleAddPath}
                        className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-blue-600 text-white rounded-lg transition-colors shadow-lg shadow-primary/20"
                    >
                        <FolderPlus className="w-4 h-4" />
                        <span>Add Folder</span>
                    </button>
                </div>

                <div className="bg-surface rounded-xl border border-surfaceHighlight overflow-hidden">
                    {watchPaths.length > 0 ? (
                        <div className="divide-y divide-surfaceHighlight">
                            {watchPaths.map((path) => (
                                <div
                                    key={path.id}
                                    className="flex items-center justify-between p-4 hover:bg-surfaceHighlight/50 transition-colors"
                                >
                                    <div className="flex items-center gap-3 overflow-hidden w-full">
                                        <div className="w-10 h-10 rounded-lg bg-surfaceHighlight flex items-center justify-center flex-shrink-0">
                                            <Folder className="w-5 h-5 text-textMuted" />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                                    <PathMarquee text={path.path} />
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => handleRemovePath(path.id)}
                                        className="p-2 text-textMuted hover:text-red-500 hover:bg-red-500/10 rounded-lg transition-colors"
                                        title="Remove folder"
                                    >
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="p-8 text-center text-textMuted">
                            <Folder className="w-12 h-12 mx-auto mb-3 opacity-20" />
                            <p>No watch folders configured</p>
                        </div>
                    )}
                </div>
            </section>

            {/* Thumbnail Regeneration */}
            <section>
                <div className="bg-surface rounded-xl border border-surfaceHighlight p-6">
                    <div className="flex items-start justify-between gap-6">
                        <div>
                            <h2 className="text-xl font-semibold text-white">Thumbnails</h2>
                            <p className="text-textMuted text-sm mt-1">
                                Regenerate thumbnails for all movies in your library. This may take a while.
                            </p>
                        </div>
                        <button
                            onClick={async () => {
                                if (regenerating) return
                                try {
                                    setRegenerating(true)
                                    const result = await window.ipcRenderer.invoke('thumbnails:regenerate')
                                    alert(`Generated ${result.success} / ${result.total} thumbnails`)
                                    fetchWatchPaths() // Trigger refresh
                                } catch (err) {
                                    console.error('Error regenerating thumbnails:', err)
                                    alert('Failed to regenerate thumbnails')
                                } finally {
                                    setRegenerating(false)
                                }
                            }}
                            disabled={regenerating}
                            className="flex items-center gap-2 px-4 py-2 bg-surfaceHighlight hover:bg-surfaceHighlight/80 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            <RefreshCw className={`w-4 h-4 ${regenerating ? 'animate-spin' : ''}`} />
                            <span>{regenerating ? 'Regenerating...' : 'Regenerate All'}</span>
                        </button>
                    </div>
                </div>
            </section>
        </div>
    )
}

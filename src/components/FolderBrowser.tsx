import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronRight, Folder, FolderOpen, HardDrive } from 'lucide-react'
import { Movie } from '../types'
import { MovieCard } from './MovieCard'
import { Poster } from './Poster'
import { VideoPlayer } from './VideoPlayer'
import { VirtualMovieGrid } from './VirtualMovieGrid'
import { MovieGridSkeleton } from './Skeleton'
import { useCoalescedIpcRefresh } from '../hooks/useCoalescedIpcRefresh'
import { formatFileSize, formatTimeLeft } from '../lib/format'

interface FolderSummary {
    path: string
    name: string
    video_count: number
    previews: string[]
}

type FolderVideo = Movie & { file_name: string; file_size?: number | null }

interface FolderContents {
    path: string | null
    breadcrumbs: { name: string; path: string | null }[]
    folders: FolderSummary[]
    videos: FolderVideo[]
}

interface FolderBrowserProps {
    path: string | null
    onNavigate: (path: string | null) => void
    /** Narrows the current folder's subfolders and files by name. */
    searchQuery: string
}

export function FolderBrowser({ path, onNavigate, searchQuery }: FolderBrowserProps) {
    const [contents, setContents] = useState<FolderContents | null>(null)
    const [playing, setPlaying] = useState<FolderVideo | null>(null)

    const fetchFolder = useCallback(async () => {
        try {
            setContents(await window.ipcRenderer.invoke('db:get-folder', path) as FolderContents)
        } catch (err) {
            console.error('Failed to load folder:', err)
        }
    }, [path])

    const { runNow: refreshFolder } = useCoalescedIpcRefresh(
        fetchFolder,
        ['library-updated', 'playback-progress-updated'],
        { delayMs: 250 }
    )

    useEffect(() => {
        setContents(null)
        void refreshFolder()
    }, [path, refreshFolder])

    const query = searchQuery.trim().toLowerCase()
    const folders = useMemo(
        () => (contents?.folders ?? []).filter(folder => !query || folder.name.toLowerCase().includes(query)),
        [contents, query]
    )
    const videos = useMemo(
        () => (contents?.videos ?? []).filter(video => !query || video.file_name.toLowerCase().includes(query)),
        [contents, query]
    )

    if (!contents) return <MovieGridSkeleton />

    const isRootList = contents.path === null
    const playingIndex = playing ? videos.findIndex(video => video.id === playing.id) : -1

    return (
        <div>
            {contents.breadcrumbs.length > 0 && (
                <nav aria-label="Folder path" className="flex flex-wrap items-center gap-1 mb-6 text-sm">
                    {contents.breadcrumbs.map((crumb, i) => {
                        const isLast = i === contents.breadcrumbs.length - 1
                        return (
                            <span key={`${crumb.path}-${i}`} className="flex items-center gap-1 min-w-0">
                                {i > 0 && <ChevronRight className="w-3.5 h-3.5 text-white/25 flex-none" />}
                                {isLast ? (
                                    <span className="px-1.5 py-0.5 text-white font-medium truncate" aria-current="page">{crumb.name}</span>
                                ) : (
                                    <button
                                        onClick={() => onNavigate(crumb.path)}
                                        className="px-1.5 py-0.5 rounded-md text-textMuted hover:text-white hover:bg-white/5 transition-colors truncate"
                                    >
                                        {crumb.name}
                                    </button>
                                )}
                            </span>
                        )
                    })}
                </nav>
            )}

            {folders.length > 0 && (
                <section className="mb-10">
                    <h2 className="text-sm font-medium uppercase tracking-wider text-textMuted mb-4">
                        {isRootList ? 'Library folders' : 'Folders'}
                    </h2>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-5">
                        {folders.map(folder => (
                            <FolderCard
                                key={folder.path}
                                folder={folder}
                                isRoot={isRootList}
                                onOpen={() => onNavigate(folder.path)}
                            />
                        ))}
                    </div>
                </section>
            )}

            {videos.length > 0 && (
                <section>
                    {folders.length > 0 && (
                        <h2 className="text-sm font-medium uppercase tracking-wider text-textMuted mb-4">Videos</h2>
                    )}
                    <VirtualMovieGrid
                        items={videos}
                        getItemKey={(video) => video.id}
                        renderItem={(video) => (
                            <MovieCard
                                movie={video}
                                titleOverride={video.file_name}
                                metaOverride={<VideoMeta video={video} />}
                                onClick={() => setPlaying(video)}
                            />
                        )}
                    />
                </section>
            )}

            {folders.length === 0 && videos.length === 0 && (
                <div className="text-center py-16 text-textMuted">
                    <FolderOpen className="w-10 h-10 mx-auto mb-4 opacity-20" />
                    <p className="text-white">{query ? 'Nothing here matches' : 'No videos in this folder'}</p>
                    {query && <p className="text-sm mt-1">Search only looks inside the folder you’re in.</p>}
                </div>
            )}

            {playing && (
                <VideoPlayer
                    movie={playing}
                    onClose={() => setPlaying(null)}
                    onNext={() => playingIndex >= 0 && playingIndex < videos.length - 1 && setPlaying(videos[playingIndex + 1])}
                    onPrevious={() => playingIndex > 0 && setPlaying(videos[playingIndex - 1])}
                    hasNext={playingIndex >= 0 && playingIndex < videos.length - 1}
                    hasPrevious={playingIndex > 0}
                />
            )}
        </div>
    )
}

function VideoMeta({ video }: { video: FolderVideo }) {
    const size = formatFileSize(video.file_size)
    const started = (video.progress ?? 0) > 5 && !!video.duration
    const parts = [
        size,
        started ? formatTimeLeft(video.duration! - video.progress!) : null,
    ].filter(Boolean) as string[]
    return (
        <>
            {parts.map((part, i) => (
                <span key={part} className="flex items-center gap-2">
                    {i > 0 && <span className="text-white/20">•</span>}
                    {part}
                </span>
            ))}
        </>
    )
}

function FolderCard({ folder, isRoot, onOpen }: { folder: FolderSummary; isRoot: boolean; onOpen: () => void }) {
    // A full collage needs four thumbnails; with fewer, one large frame looks better than empty tiles.
    const collage = folder.previews.length >= 4

    return (
        <button
            onClick={onOpen}
            className="group self-start text-left rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-primary"
            aria-label={`Open folder ${folder.name}`}
        >
            <div className="relative aspect-video rounded-xl overflow-hidden bg-surfaceHighlight shadow-lg transition-all duration-300 group-hover:shadow-2xl group-hover:shadow-primary/10 group-hover:scale-[1.02]">
                {collage ? (
                    <div className="absolute inset-0 grid grid-cols-2 grid-rows-2 gap-0.5 bg-black/50">
                        {folder.previews.slice(0, 4).map((poster, i) => (
                            <div key={i} className="relative bg-surface overflow-hidden">
                                <Poster
                                    path={poster}
                                    title={folder.name}
                                    plainFallback
                                    className="w-full h-full object-cover opacity-70 group-hover:opacity-90 transition-opacity"
                                />
                            </div>
                        ))}
                    </div>
                ) : (
                    <Poster
                        path={folder.previews[0]}
                        title={folder.name}
                        plainFallback
                        className="absolute inset-0 w-full h-full object-cover opacity-70 group-hover:opacity-90 transition-opacity"
                    />
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
                <div className="absolute left-2.5 bottom-2.5 flex items-center gap-1.5 px-2 py-1 rounded-md bg-black/60 backdrop-blur-md border border-white/10 text-[11px] font-medium text-white/85">
                    {isRoot ? <HardDrive className="w-3 h-3" /> : <Folder className="w-3 h-3" />}
                    {folder.video_count}
                </div>
            </div>
            <p className="mt-2.5 text-sm font-medium text-text line-clamp-2 break-words" title={folder.name}>{folder.name}</p>
        </button>
    )
}

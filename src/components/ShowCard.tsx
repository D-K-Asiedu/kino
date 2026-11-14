import { Check, Tv } from 'lucide-react'
import { Show } from '../types'
import { Poster } from './Poster'
import { episodeCode } from '../lib/episodes'

interface ShowCardProps {
    show: Show
    onClick?: () => void
}

export function showMeta(show: Pick<Show, 'season_count' | 'episode_count'>) {
    const parts: string[] = []
    if (show.season_count > 1) parts.push(`${show.season_count} seasons`)
    parts.push(`${show.episode_count} ${show.episode_count === 1 ? 'episode' : 'episodes'}`)
    return parts.join(' · ')
}

export function ShowCard({ show, onClick }: ShowCardProps) {
    const watchedFraction = show.episode_count > 0 ? show.watched_count / show.episode_count : 0
    const allWatched = show.episode_count > 0 && show.watched_count >= show.episode_count
    const nextCode = show.last_watched && show.next_up ? episodeCode(show.next_up) : null

    return (
        <div className="group relative">
            <div
                role="button"
                tabIndex={0}
                aria-label={`Open ${show.title}`}
                onClick={onClick}
                onKeyDown={(e) => {
                    if (e.target !== e.currentTarget) return
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        onClick?.()
                    }
                }}
                className="relative cursor-pointer rounded-xl"
            >
                <div className="relative aspect-video rounded-xl overflow-hidden bg-surfaceHighlight shadow-lg transition-all duration-300 group-hover:shadow-2xl group-hover:shadow-primary/10 group-hover:scale-[1.02]">
                    <Poster
                        path={show.poster_path}
                        title={show.title}
                        className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                    />
                    {/* The frame is just the first episode, so a scrim keeps the show name the focus */}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent pointer-events-none" />

                    <div className="absolute left-3 top-3 flex items-center gap-1.5 px-2 py-1 rounded-md bg-black/60 backdrop-blur-md border border-white/10 text-[11px] font-medium text-white/85">
                        <Tv className="w-3 h-3" />
                        {show.episode_count}
                    </div>

                    {allWatched && (
                        <div className="absolute right-3 top-3 flex items-center gap-1 px-2 py-1 rounded-md bg-black/60 backdrop-blur-md border border-white/10 text-[11px] font-medium text-white/85">
                            <Check className="w-3 h-3" />
                            Watched
                        </div>
                    )}

                    {nextCode && (
                        <div className="absolute left-3 bottom-3 text-xs font-medium text-white/90">
                            {show.next_up_resume ? 'Resume' : 'Up next'} · {nextCode}
                        </div>
                    )}

                    {watchedFraction > 0 && !allWatched && (
                        <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/20">
                            <div className="h-full bg-primary" style={{ width: `${watchedFraction * 100}%` }} />
                        </div>
                    )}
                </div>

                <div className="mt-3">
                    <h3 className="font-medium text-text text-base line-clamp-2">{show.title}</h3>
                    <p className="text-textMuted text-xs mt-0.5 h-4">{showMeta(show)}</p>
                </div>
            </div>
        </div>
    )
}

import { useEffect, useState } from 'react'
import { Film } from 'lucide-react'
import { twMerge } from 'tailwind-merge'

interface PosterProps {
    path: string | null | undefined
    title: string
    className?: string
    /** Hide the title text in the fallback (e.g. when the title is already shown on top). */
    plainFallback?: boolean
    onError?: () => void
    onLoad?: () => void
}

// Deterministic hue per title so fallbacks look varied but stable between renders.
function hueFor(title: string) {
    let hash = 0
    for (let i = 0; i < title.length; i++) {
        hash = (hash * 31 + title.charCodeAt(i)) | 0
    }
    return Math.abs(hash) % 360
}

export function Poster({ path, title, className = '', plainFallback = false, onError, onLoad }: PosterProps) {
    const [failed, setFailed] = useState(false)

    useEffect(() => {
        setFailed(false)
    }, [path])

    if (!path || failed) {
        const hue = hueFor(title)
        return (
            <div
                className={twMerge('relative flex items-center justify-center overflow-hidden', className)}
                style={{ background: `linear-gradient(135deg, hsl(${hue} 35% 22%), hsl(${(hue + 40) % 360} 30% 10%))` }}
                aria-label={title}
                role="img"
            >
                {!plainFallback && (
                    <>
                        <Film className="absolute right-3 bottom-3 w-5 h-5 text-white/15" />
                        <span className="px-4 text-center text-white/70 font-semibold text-lg leading-tight line-clamp-2">
                            {title}
                        </span>
                    </>
                )}
            </div>
        )
    }

    return (
        <img
            src={`media://${encodeURIComponent(path)}`}
            alt={title}
            className={className}
            loading="lazy"
            onLoad={onLoad}
            onError={() => {
                setFailed(true)
                onError?.()
            }}
        />
    )
}

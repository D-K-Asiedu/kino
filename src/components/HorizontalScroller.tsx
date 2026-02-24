import { useRef, useState, useEffect, useCallback } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

interface HorizontalScrollerProps {
    children: React.ReactNode
    className?: string
}

export function HorizontalScroller({ children, className = '' }: HorizontalScrollerProps) {
    const scrollContainerRef = useRef<HTMLDivElement>(null)
    const rafRef = useRef<number | null>(null)
    const [showLeftArrow, setShowLeftArrow] = useState(false)
    const [showRightArrow, setShowRightArrow] = useState(false)

    const checkScrollCapabilities = useCallback(() => {
        if (!scrollContainerRef.current) return

        const { scrollLeft, scrollWidth, clientWidth } = scrollContainerRef.current

        // Use a small epsilon (1px) to account for floating point pixel rounding
        const canScrollLeft = scrollLeft > 1
        const canScrollRight = scrollLeft < scrollWidth - clientWidth - 1
        setShowLeftArrow(prev => (prev === canScrollLeft ? prev : canScrollLeft))
        setShowRightArrow(prev => (prev === canScrollRight ? prev : canScrollRight))
    }, [])

    const scheduleScrollCheck = useCallback(() => {
        if (rafRef.current !== null) {
            cancelAnimationFrame(rafRef.current)
        }
        rafRef.current = requestAnimationFrame(() => {
            rafRef.current = null
            checkScrollCapabilities()
        })
    }, [checkScrollCapabilities])

    // Track container size and direct child list changes without observing every card node.
    useEffect(() => {
        if (!scrollContainerRef.current) return

        const container = scrollContainerRef.current
        const resizeObserver = new ResizeObserver(scheduleScrollCheck)
        const mutationObserver = new MutationObserver(scheduleScrollCheck)
        const handleLoad = () => scheduleScrollCheck()
        resizeObserver.observe(container)
        mutationObserver.observe(container, { childList: true })
        container.addEventListener('load', handleLoad, true)
        scheduleScrollCheck()

        return () => {
            resizeObserver.disconnect()
            mutationObserver.disconnect()
            container.removeEventListener('load', handleLoad, true)
            if (rafRef.current !== null) {
                cancelAnimationFrame(rafRef.current)
                rafRef.current = null
            }
        }
    }, [scheduleScrollCheck])

    // Run another check when React children update to catch layout changes after paint.
    useEffect(() => {
        scheduleScrollCheck()
    }, [children, scheduleScrollCheck])

    const scroll = (direction: 'left' | 'right') => {
        if (scrollContainerRef.current) {
            const clientWidth = scrollContainerRef.current.clientWidth
            // Scroll by roughly 80% of the visible container width
            const scrollAmount = direction === 'left' ? -clientWidth * 0.8 : clientWidth * 0.8

            scrollContainerRef.current.scrollBy({
                left: scrollAmount,
                behavior: 'smooth'
            })
        }
    }

    return (
        <div className="relative group/scroller">
            {/* Left Arrow */}
            {showLeftArrow && (
                <div className="absolute left-0 top-0 bottom-6 w-24 bg-gradient-to-r from-background via-background/80 to-transparent z-10 flex items-center justify-start pointer-events-none opacity-0 group-hover/scroller:opacity-100 transition-opacity duration-300">
                    <button
                        onClick={() => scroll('left')}
                        className="pointer-events-auto ml-2 p-3 rounded-full bg-black/50 hover:bg-primary hover:scale-110 text-white backdrop-blur-md border border-white/10 shadow-xl transition-all duration-300"
                        aria-label="Scroll left"
                    >
                        <ChevronLeft className="w-6 h-6" />
                    </button>
                </div>
            )}

            {/* Scroll Container */}
            <div
                ref={scrollContainerRef}
                onScroll={scheduleScrollCheck}
                className={`flex gap-6 overflow-x-auto pb-6 snap-x snap-mandatory no-scrollbar ${className}`}
            >
                {children}
            </div>

            {/* Right Arrow */}
            {showRightArrow && (
                <div className="absolute right-0 top-0 bottom-6 w-24 bg-gradient-to-l from-background via-background/80 to-transparent z-10 flex items-center justify-end pointer-events-none opacity-0 group-hover/scroller:opacity-100 transition-opacity duration-300">
                    <button
                        onClick={() => scroll('right')}
                        className="pointer-events-auto mr-2 p-3 rounded-full bg-black/50 hover:bg-primary hover:scale-110 text-white backdrop-blur-md border border-white/10 shadow-xl transition-all duration-300"
                        aria-label="Scroll right"
                    >
                        <ChevronRight className="w-6 h-6" />
                    </button>
                </div>
            )}
        </div>
    )
}

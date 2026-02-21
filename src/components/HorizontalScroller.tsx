import { useRef, useState, useEffect } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

interface HorizontalScrollerProps {
    children: React.ReactNode
    className?: string
}

export function HorizontalScroller({ children, className = '' }: HorizontalScrollerProps) {
    const scrollContainerRef = useRef<HTMLDivElement>(null)
    const [showLeftArrow, setShowLeftArrow] = useState(false)
    const [showRightArrow, setShowRightArrow] = useState(false)
    // Add a state to trigger re-renders to ensure we catch late-loading content width changes
    const [contentWidthChanged, setContentWidthChanged] = useState(0)

    const checkScrollCapabilities = () => {
        if (!scrollContainerRef.current) return

        const { scrollLeft, scrollWidth, clientWidth } = scrollContainerRef.current

        // Use a small epsilon (1px) to account for floating point pixel rounding
        setShowLeftArrow(scrollLeft > 1)
        setShowRightArrow(scrollLeft < scrollWidth - clientWidth - 1)
    }

    // Set up ResizeObserver to handle dynamic content loading
    useEffect(() => {
        if (!scrollContainerRef.current) return

        const resizeObserver = new ResizeObserver(() => {
            setContentWidthChanged(prev => prev + 1)
        })

        resizeObserver.observe(scrollContainerRef.current)
        // Also observe the children container directly if possible, or just re-check
        Array.from(scrollContainerRef.current.children).forEach(child => {
            resizeObserver.observe(child)
        })

        return () => resizeObserver.disconnect()
    }, [children])

    // Checking separately whenever resize happens or component updates
    useEffect(() => {
        checkScrollCapabilities()
        // Wait a frame and check again to ensure layout is settled
        requestAnimationFrame(checkScrollCapabilities)
    }, [contentWidthChanged, children])

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
                onScroll={checkScrollCapabilities}
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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

const SCROLL_ROOT_ID = 'app-scroll-root'

interface VirtualMovieGridProps<T> {
    items: T[]
    getItemKey: (item: T, index: number) => string | number
    renderItem: (item: T, index: number) => React.ReactNode
    className?: string
    gapPx?: number
    overscanRows?: number
    minItemsToVirtualize?: number
}

interface ViewportMetrics {
    containerWidth: number
    containerTopInScrollContent: number
    scrollTop: number
    viewportHeight: number
}

const DEFAULT_METRICS: ViewportMetrics = {
    containerWidth: 0,
    containerTopInScrollContent: 0,
    scrollTop: 0,
    viewportHeight: 0,
}

export function VirtualMovieGrid<T>({
    items,
    getItemKey,
    renderItem,
    className = '',
    gapPx = 24,
    overscanRows = 2,
    minItemsToVirtualize = 80,
}: VirtualMovieGridProps<T>) {
    const containerRef = useRef<HTMLDivElement | null>(null)
    const rafRef = useRef<number | null>(null)
    const [metrics, setMetrics] = useState<ViewportMetrics>(DEFAULT_METRICS)

    const getScrollRoot = useCallback(() => {
        return document.getElementById(SCROLL_ROOT_ID)
    }, [])

    const updateMetrics = useCallback(() => {
        const container = containerRef.current
        const root = getScrollRoot()
        if (!container || !root) return

        const rootRect = root.getBoundingClientRect()
        const containerRect = container.getBoundingClientRect()
        const scrollTop = root.scrollTop
        const containerTopInScrollContent = scrollTop + (containerRect.top - rootRect.top)

        setMetrics((prev) => {
            const next: ViewportMetrics = {
                containerWidth: container.clientWidth,
                containerTopInScrollContent,
                scrollTop,
                viewportHeight: root.clientHeight,
            }
            if (
                prev.containerWidth === next.containerWidth &&
                prev.containerTopInScrollContent === next.containerTopInScrollContent &&
                prev.scrollTop === next.scrollTop &&
                prev.viewportHeight === next.viewportHeight
            ) {
                return prev
            }
            return next
        })
    }, [getScrollRoot])

    const scheduleMetricsUpdate = useCallback(() => {
        if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
        rafRef.current = requestAnimationFrame(() => {
            rafRef.current = null
            updateMetrics()
        })
    }, [updateMetrics])

    useEffect(() => {
        const root = getScrollRoot()
        const container = containerRef.current
        if (!root || !container) return

        const resizeObserver = new ResizeObserver(() => {
            scheduleMetricsUpdate()
        })
        resizeObserver.observe(container)
        root.addEventListener('scroll', scheduleMetricsUpdate, { passive: true })
        window.addEventListener('resize', scheduleMetricsUpdate)
        scheduleMetricsUpdate()

        return () => {
            resizeObserver.disconnect()
            root.removeEventListener('scroll', scheduleMetricsUpdate)
            window.removeEventListener('resize', scheduleMetricsUpdate)
            if (rafRef.current !== null) {
                cancelAnimationFrame(rafRef.current)
                rafRef.current = null
            }
        }
    }, [getScrollRoot, scheduleMetricsUpdate])

    const columns = useMemo(() => {
        const width = metrics.containerWidth
        if (width >= 1024) return 4
        if (width >= 768) return 3
        if (width >= 640) return 2
        return 1
    }, [metrics.containerWidth])

    const virtualize = useMemo(() => {
        return items.length >= minItemsToVirtualize && metrics.containerWidth > 0 && metrics.viewportHeight > 0
    }, [items.length, minItemsToVirtualize, metrics.containerWidth, metrics.viewportHeight])

    const virtualWindow = useMemo(() => {
        if (!virtualize || columns <= 0) return null

        const cardWidth = (metrics.containerWidth - (columns - 1) * gapPx) / columns
        const estimatedCardHeight = cardWidth * (9 / 16) + 54
        const rowHeight = estimatedCardHeight + gapPx
        const totalRows = Math.max(1, Math.ceil(items.length / columns))
        const contentHeight = Math.max(totalRows * rowHeight - gapPx, 0)

        const visibleTop = Math.max(0, metrics.scrollTop - metrics.containerTopInScrollContent)
        const visibleBottom = visibleTop + metrics.viewportHeight
        const startRow = Math.max(0, Math.floor(visibleTop / rowHeight) - overscanRows)
        const endRow = Math.min(totalRows - 1, Math.ceil(visibleBottom / rowHeight) + overscanRows)

        const startIndex = startRow * columns
        const endExclusive = Math.min(items.length, (endRow + 1) * columns)
        const offsetY = startRow * rowHeight

        return {
            startIndex,
            endExclusive,
            offsetY,
            contentHeight,
        }
    }, [virtualize, columns, metrics, gapPx, items.length, overscanRows])

    return (
        <div ref={containerRef} className={className}>
            {!virtualize || !virtualWindow ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                    {items.map((item, index) => (
                        <div key={getItemKey(item, index)}>
                            {renderItem(item, index)}
                        </div>
                    ))}
                </div>
            ) : (
                <div className="relative" style={{ height: virtualWindow.contentHeight }}>
                    <div
                        className="absolute left-0 right-0"
                        style={{ transform: `translateY(${virtualWindow.offsetY}px)` }}
                    >
                        <div
                            className="grid gap-6"
                            style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
                        >
                            {items.slice(virtualWindow.startIndex, virtualWindow.endExclusive).map((item, idx) => {
                                const index = virtualWindow.startIndex + idx
                                return (
                                    <div key={getItemKey(item, index)}>
                                        {renderItem(item, index)}
                                    </div>
                                )
                            })}
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}

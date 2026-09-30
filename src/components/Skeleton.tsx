function Shimmer({ className = '' }: { className?: string }) {
    return (
        <div className={`relative overflow-hidden bg-white/[0.04] ${className}`}>
            <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-white/[0.05] to-transparent" />
        </div>
    )
}

export function MovieCardSkeleton() {
    return (
        <div>
            <Shimmer className="aspect-video rounded-xl" />
            <Shimmer className="mt-3 h-4 w-3/4 rounded" />
            <Shimmer className="mt-2 h-3 w-1/4 rounded" />
        </div>
    )
}

export function MovieGridSkeleton({ count = 12 }: { count?: number }) {
    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
            {Array.from({ length: count }, (_, i) => <MovieCardSkeleton key={i} />)}
        </div>
    )
}

export function HomeSkeleton() {
    return (
        <div className="p-8 max-w-[1920px] mx-auto space-y-12">
            <Shimmer className="h-[min(52vh,480px)] rounded-2xl" />
            {[0, 1].map(row => (
                <div key={row}>
                    <Shimmer className="h-5 w-48 rounded mb-4" />
                    <div className="flex gap-6 overflow-hidden">
                        {Array.from({ length: 5 }, (_, i) => (
                            <div key={i} className="w-[300px] flex-none">
                                <MovieCardSkeleton />
                            </div>
                        ))}
                    </div>
                </div>
            ))}
        </div>
    )
}

import { Movie } from '../types'

export type RatingFilter = 'all' | 'rated' | 'unrated'
export type DecadeFilter = 'all' | '2020s' | '2010s' | '2000s' | '1990s' | '1980s' | 'older'

export interface MovieFilters {
    rating: RatingFilter
    decade: DecadeFilter
}

export const DEFAULT_FILTERS: MovieFilters = { rating: 'all', decade: 'all' }
export const DEFAULT_SORT = 'recent'

export const RATING_OPTIONS: { value: RatingFilter; label: string }[] = [
    { value: 'all', label: 'Any rating' },
    { value: 'rated', label: 'Rated' },
    { value: 'unrated', label: 'Unrated' },
]

export const DECADE_OPTIONS: { value: DecadeFilter; label: string }[] = [
    { value: 'all', label: 'Any year' },
    { value: '2020s', label: '2020s' },
    { value: '2010s', label: '2010s' },
    { value: '2000s', label: '2000s' },
    { value: '1990s', label: '1990s' },
    { value: '1980s', label: '1980s' },
    { value: 'older', label: 'Before 1980' },
]

export const SORT_OPTIONS = [
    { value: 'recent', label: 'Recently added' },
    { value: 'title-asc', label: 'Title A–Z' },
    { value: 'title-desc', label: 'Title Z–A' },
    { value: 'year-desc', label: 'Year (newest)' },
    { value: 'year-asc', label: 'Year (oldest)' },
    { value: 'rating-desc', label: 'Rating (high)' },
    { value: 'rating-asc', label: 'Rating (low)' },
]

const DECADE_RANGES: Record<Exclude<DecadeFilter, 'all'>, [number, number]> = {
    '2020s': [2020, Infinity],
    '2010s': [2010, 2019],
    '2000s': [2000, 2009],
    '1990s': [1990, 1999],
    '1980s': [1980, 1989],
    older: [-Infinity, 1979],
}

export function countActiveFilters(filters: MovieFilters) {
    return (filters.rating !== 'all' ? 1 : 0) + (filters.decade !== 'all' ? 1 : 0)
}

export function matchesFilters(movie: Movie, filters: MovieFilters) {
    if (filters.rating === 'rated' && movie.rating === null) return false
    if (filters.rating === 'unrated' && movie.rating !== null) return false
    if (filters.decade !== 'all') {
        if (movie.year === null) return false
        const [min, max] = DECADE_RANGES[filters.decade]
        if (movie.year < min || movie.year > max) return false
    }
    return true
}

export function sortMovies(list: Movie[], sortBy: string) {
    const sorted = [...list]
    switch (sortBy) {
        case 'title-asc':
            return sorted.sort((a, b) => a.title.localeCompare(b.title))
        case 'title-desc':
            return sorted.sort((a, b) => b.title.localeCompare(a.title))
        case 'year-desc':
            return sorted.sort((a, b) => (b.year ?? -Infinity) - (a.year ?? -Infinity))
        case 'year-asc':
            return sorted.sort((a, b) => (a.year ?? Infinity) - (b.year ?? Infinity))
        case 'rating-desc':
            return sorted.sort((a, b) => (b.rating ?? -Infinity) - (a.rating ?? -Infinity))
        case 'rating-asc':
            return sorted.sort((a, b) => (a.rating ?? Infinity) - (b.rating ?? Infinity))
        case 'recent':
        default:
            return sorted.sort(
                (a, b) => new Date(b.added_at).getTime() - new Date(a.added_at).getTime()
            )
    }
}

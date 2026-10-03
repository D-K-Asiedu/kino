import { ArrowUpDown, SlidersHorizontal, X } from 'lucide-react'
import { Dropdown } from './Dropdown'
import {
    DECADE_OPTIONS,
    DEFAULT_FILTERS,
    DEFAULT_SORT,
    DecadeFilter,
    MovieFilters,
    RATING_OPTIONS,
    RatingFilter,
    SORT_OPTIONS,
    countActiveFilters,
} from '../lib/movieFilters'

interface MovieFilterControlsProps {
    filters: MovieFilters
    onFiltersChange: (filters: MovieFilters) => void
    sortBy: string
    onSortChange: (sortBy: string) => void
    /** The page's default sort; any other sort is highlighted as active. */
    defaultSort?: string
}

export function MovieFilterControls({ filters, onFiltersChange, sortBy, onSortChange, defaultSort = DEFAULT_SORT }: MovieFilterControlsProps) {
    const activeCount = countActiveFilters(filters)

    return (
        <>
            <Dropdown
                icon={SlidersHorizontal}
                label={activeCount > 0 ? `Filters · ${activeCount}` : 'Filters'}
                ariaLabel="Filter movies"
                active={activeCount > 0}
                closeOnSelect={false}
                sections={[
                    {
                        title: 'Rating',
                        options: RATING_OPTIONS,
                        value: filters.rating,
                        onChange: (value) => onFiltersChange({ ...filters, rating: value as RatingFilter }),
                    },
                    {
                        title: 'Year',
                        options: DECADE_OPTIONS,
                        value: filters.decade,
                        onChange: (value) => onFiltersChange({ ...filters, decade: value as DecadeFilter }),
                    },
                ]}
            />
            <Dropdown
                icon={ArrowUpDown}
                label={SORT_OPTIONS.find(o => o.value === sortBy)?.label ?? 'Sort'}
                ariaLabel="Sort movies"
                active={sortBy !== defaultSort}
                sections={[{ options: SORT_OPTIONS, value: sortBy, onChange: onSortChange }]}
            />
        </>
    )
}

/** Removable chips for the filters currently applied, shown under a page header. */
export function ActiveFilterChips({ filters, onFiltersChange }: Pick<MovieFilterControlsProps, 'filters' | 'onFiltersChange'>) {
    if (countActiveFilters(filters) === 0) return null

    const chips: { key: keyof MovieFilters; label: string }[] = []
    if (filters.rating !== 'all') {
        chips.push({ key: 'rating', label: RATING_OPTIONS.find(o => o.value === filters.rating)!.label })
    }
    if (filters.decade !== 'all') {
        chips.push({ key: 'decade', label: DECADE_OPTIONS.find(o => o.value === filters.decade)!.label })
    }

    return (
        <div className="flex flex-wrap items-center gap-2 -mt-4 mb-6">
            {chips.map(chip => (
                <button
                    key={chip.key}
                    onClick={() => onFiltersChange({ ...filters, [chip.key]: 'all' })}
                    className="group flex items-center gap-1.5 pl-3 pr-2 py-1 rounded-full bg-primary/10 border border-primary/20 text-sm text-white hover:bg-primary/20 transition-colors"
                    aria-label={`Remove ${chip.label} filter`}
                >
                    {chip.label}
                    <X className="w-3.5 h-3.5 text-white/60 group-hover:text-white" />
                </button>
            ))}
            {chips.length > 1 && (
                <button
                    onClick={() => onFiltersChange(DEFAULT_FILTERS)}
                    className="px-2 py-1 text-sm text-textMuted hover:text-white transition-colors"
                >
                    Clear all
                </button>
            )}
        </div>
    )
}

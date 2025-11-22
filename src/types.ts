export interface Movie {
    id: number
    title: string
    original_title: string | null
    year: number | null
    plot: string | null
    poster_path: string | null
    backdrop_path: string | null
    rating: number | null
    file_path: string
    added_at: string
}

export interface Playlist {
    id: number
    name: string
    created_at: string
    movie_count?: number // Optional, might be useful for UI
}

export interface AudioTrack {
    id: string
    kind: string
    label: string
    language: string
    enabled: boolean
}

export interface AudioTrackList extends EventTarget {
    length: number
    [index: number]: AudioTrack
    getTrackById(id: string): AudioTrack | null
    [Symbol.iterator](): IterableIterator<AudioTrack>
}

export interface VideoElementWithTracks extends HTMLVideoElement {
    audioTracks: AudioTrackList
    // textTracks is already in HTMLVideoElement but we might need to cast or ensure it's available
}

export interface WatchPath {
    id: number
    path: string
}

export interface Setting {
    key: string
    value: string
}

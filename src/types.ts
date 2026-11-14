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
    /** Saved playback position and length in seconds; null/absent when never watched. */
    progress?: number | null
    duration?: number | null
    last_watched?: string | null
    /** Set for TV episodes (worked out from file and folder names); null for movies. */
    show_title?: string | null
    season?: number | null
    episode?: number | null
    episode_title?: string | null
}

export interface Show {
    title: string
    episode_count: number
    season_count: number
    watched_count: number
    poster_path: string | null
    last_added: string
    last_watched: string | null
    /** What "Continue" plays; null once everything up to the latest episode is watched. */
    next_up: Movie | null
    next_up_resume: boolean
}

export interface Playlist {
    id: number
    name: string
    created_at: string
    movie_count?: number // Optional, might be useful for UI
}

export interface SecureItem {
    id: number
    title: string
    original_title: string | null
    year: number | null
    plot: string | null
    poster_path: string | null
    backdrop_path: string | null
    rating: number | null
    original_name: string
    encrypted_path: string
    added_at: string
}

export interface AudioTrack {
    id: string
    kind: string
    label: string
    language: string
    enabled: boolean
    codec?: string
    channels?: number
    /** False when the player can't decode the track itself and it has to be converted. */
    supported?: boolean
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

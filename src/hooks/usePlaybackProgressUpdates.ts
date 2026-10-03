import { Dispatch, SetStateAction, useEffect } from 'react'
import { Movie } from '../types'

interface PlaybackProgressUpdate {
    movieId: number
    progress: number
    duration: number
}

/** Patches saved playback progress into an already-loaded movie list, so card progress bars stay current. */
export function usePlaybackProgressUpdates(setMovies: Dispatch<SetStateAction<Movie[]>>) {
    useEffect(() => {
        const handleUpdate = (_event: unknown, update: PlaybackProgressUpdate) => {
            setMovies(prev => {
                if (!prev.some(movie => movie.id === update.movieId)) return prev
                return prev.map(movie => movie.id === update.movieId
                    ? { ...movie, progress: update.progress, duration: update.duration }
                    : movie)
            })
        }
        return window.ipcRenderer.on('playback-progress-updated', handleUpdate)
    }, [setMovies])
}

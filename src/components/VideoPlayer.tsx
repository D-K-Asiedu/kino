import {
    Play, Pause, Volume2, VolumeX, Maximize, Minimize,
    SkipBack, SkipForward, ChevronLeft, Gauge, MessageSquare, Languages,
    History, RotateCcw, Settings, Check, Keyboard
} from 'lucide-react'
import { useEffect, useRef, useState, useCallback } from 'react'
import { Movie, VideoElementWithTracks, AudioTrack } from '../types'

interface VideoPlayerProps {
    movie: Movie
    onClose: () => void
    onNext?: () => void
    onPrevious?: () => void
    hasNext?: boolean
    hasPrevious?: boolean
}

type SettingsTab = 'main' | 'audio' | 'subtitles' | 'speed' | 'shortcuts'

const STORAGE_KEYS = {
    playbackRate: 'kino_preferred_speed',
    subtitle: 'kino_preferred_subtitle_language',
    audio: 'kino_preferred_audio_language'
}

const getStoredValue = (key: string) => {
    if (typeof window === 'undefined') return null
    return window.localStorage.getItem(key)
}

const setStoredValue = (key: string, value: string) => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(key, value)
}

const removeStoredValue = (key: string) => {
    if (typeof window === 'undefined') return
    window.localStorage.removeItem(key)
}

export function VideoPlayer({ movie, onClose, onNext, onPrevious, hasNext, hasPrevious }: VideoPlayerProps) {
    const videoRef = useRef<HTMLVideoElement>(null)
    const containerRef = useRef<HTMLDivElement>(null)
    const controlsTimeoutRef = useRef<NodeJS.Timeout>()

    // State
    const [isPlaying, setIsPlaying] = useState(true)
    const [currentTime, setCurrentTime] = useState(0)
    const [duration, setDuration] = useState(0)
    const [volume, setVolume] = useState(1)
    const [isMuted, setIsMuted] = useState(false)
    const [isFullscreen, setIsFullscreen] = useState(false)
    const [showControls, setShowControls] = useState(true)
    const [playbackRate, setPlaybackRate] = useState(() => {
        const storedValue = getStoredValue(STORAGE_KEYS.playbackRate)
        const parsed = storedValue ? parseFloat(storedValue) : NaN
        return Number.isFinite(parsed) && parsed > 0 ? parsed : 1
    })
    const [audioTracks, setAudioTracks] = useState<AudioTrack[]>([])
    const [textTracks, setTextTracks] = useState<TextTrack[]>([])

    // Settings Menu State
    const [showSettings, setShowSettings] = useState(false)
    const [settingsTab, setSettingsTab] = useState<SettingsTab>('main')

    const [savedProgress, setSavedProgress] = useState<number | null>(null)
    const [showResumePrompt, setShowResumePrompt] = useState(false)
    const [isBuffering, setIsBuffering] = useState(false)
    const [hoverTime, setHoverTime] = useState<number | null>(null)
    const [hoverPosition, setHoverPosition] = useState<number | null>(null)
    const [clickFeedback, setClickFeedback] = useState<'play' | 'pause' | 'forward' | 'rewind' | null>(null)

    // Time Display State
    const [showRemainingTime, setShowRemainingTime] = useState(false)

    // Up Next Overlay State
    const [showUpNext, setShowUpNext] = useState(false)

    // Initialize volume from localStorage
    useEffect(() => {
        const savedVolume = localStorage.getItem('kino_volume')
        if (savedVolume !== null) {
            const vol = parseFloat(savedVolume)
            setVolume(vol)
            setIsMuted(vol === 0)
            if (videoRef.current) {
                videoRef.current.volume = vol
                videoRef.current.muted = vol === 0
            }
        }
    }, [])

    // Helper: Format time (seconds -> MM:SS)
    const formatTime = (time: number) => {
        const isNegative = time < 0
        const absoluteTime = Math.abs(time)
        const minutes = Math.floor(absoluteTime / 60)
        const seconds = Math.floor(absoluteTime % 60)
        return `${isNegative ? '-' : ''}${minutes}:${seconds.toString().padStart(2, '0')}`
    }

    // Controls Visibility Logic
    const showControlsHandler = useCallback(() => {
        setShowControls(true)
        if (controlsTimeoutRef.current) {
            clearTimeout(controlsTimeoutRef.current)
        }
        if (isPlaying && !showSettings) { // Don't hide if settings menu is open
            controlsTimeoutRef.current = setTimeout(() => {
                setShowControls(false)
            }, 3000)
        }
    }, [isPlaying, showSettings])

    useEffect(() => {
        if (!isPlaying || showSettings) {
            setShowControls(true)
            if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current)
        } else {
            showControlsHandler()
        }
    }, [isPlaying, showSettings, showControlsHandler])

    // Playback Tracking
    useEffect(() => {
        const loadProgress = async () => {
            try {
                const progress = await window.ipcRenderer.invoke('db:get-playback-progress', movie.id)
                if (progress && progress > 5) { // Only resume if watched more than 5 seconds
                    setSavedProgress(progress)
                    // Seek to the saved point so the user sees where they left off
                    if (videoRef.current) {
                        videoRef.current.currentTime = progress
                        videoRef.current.pause()
                    }
                    setShowResumePrompt(true)
                    setIsPlaying(false) // Pause initially
                }
            } catch (err) {
                console.error('Failed to load playback progress:', err)
            }
        }
        loadProgress()
    }, [movie.id])

    useEffect(() => {
        setCurrentTime(0)
        setDuration(0)
        setSavedProgress(null)
        setShowResumePrompt(false)
        setAudioTracks([])
        setTextTracks([])
        if (videoRef.current) {
            const existingTracks = videoRef.current.querySelectorAll('track')
            existingTracks.forEach(t => {
                if (t.track) {
                    t.track.mode = 'disabled'
                }
                t.remove()
            })

            const textTrackList = videoRef.current.textTracks
            for (let i = 0; i < textTrackList.length; i++) {
                textTrackList[i].mode = 'disabled'
            }

            videoRef.current.currentTime = 0
        }
    }, [movie.id])

    useEffect(() => {
        if (videoRef.current) {
            videoRef.current.playbackRate = playbackRate
        }
    }, [movie.id, playbackRate])

    // Save progress periodically
    useEffect(() => {
        const interval = setInterval(() => {
            if (isPlaying && videoRef.current) {
                const time = videoRef.current.currentTime
                if (time > 5 && duration > 0 && time < duration - 10) { // Don't save if at start or very end
                    window.ipcRenderer.invoke('db:update-playback-progress', movie.id, time)
                }
            }
        }, 5000)

        return () => clearInterval(interval)
    }, [isPlaying, movie.id, duration])

    // Save on unmount
    useEffect(() => {
        return () => {
            if (videoRef.current) {
                const time = videoRef.current.currentTime
                if (time > 5) {
                    window.ipcRenderer.invoke('db:update-playback-progress', movie.id, time)
                }
            }
        }
    }, [movie.id])

    // Show up next overlay when video is 90% complete
    useEffect(() => {
        if (duration > 0 && currentTime > 0) {
            const progress = currentTime / duration
            if (progress >= 0.9 && (hasNext || hasPrevious)) {
                setShowUpNext(true)
            } else {
                setShowUpNext(false)
            }
        }
    }, [currentTime, duration, hasNext, hasPrevious])

    // Video Actions
    const togglePlay = () => {
        if (videoRef.current) {
            if (videoRef.current.paused) {
                videoRef.current.play()
                setClickFeedback('play')
            } else {
                videoRef.current.pause()
                setClickFeedback('pause')
            }
            setTimeout(() => setClickFeedback(null), 500)
        }
    }

    const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
        const time = parseFloat(e.target.value)
        if (videoRef.current) {
            videoRef.current.currentTime = time
            setCurrentTime(time)
        }
    }

    const skip = (seconds: number) => {
        if (videoRef.current) {
            videoRef.current.currentTime += seconds
            setClickFeedback(seconds > 0 ? 'forward' : 'rewind')
            setTimeout(() => setClickFeedback(null), 500)
        }
    }

    const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newVolume = parseFloat(e.target.value)
        setVolume(newVolume)
        localStorage.setItem('kino_volume', newVolume.toString())
        if (videoRef.current) {
            videoRef.current.volume = newVolume
            setIsMuted(newVolume === 0)
        }
    }

    const toggleMute = () => {
        if (videoRef.current) {
            const newMutedState = !isMuted
            videoRef.current.muted = newMutedState
            setIsMuted(newMutedState)
            if (newMutedState) {
                setVolume(0)
                localStorage.setItem('kino_volume', '0')
            } else {
                setVolume(1)
                videoRef.current.volume = 1
                localStorage.setItem('kino_volume', '1')
            }
        }
    }

    const toggleFullscreen = () => {
        if (!document.fullscreenElement) {
            containerRef.current?.requestFullscreen()
            setIsFullscreen(true)
        } else {
            document.exitFullscreen()
            setIsFullscreen(false)
        }
    }

    const changePlaybackRate = (rate: number) => {
        setPlaybackRate(rate)
        setStoredValue(STORAGE_KEYS.playbackRate, rate.toString())
        if (videoRef.current) {
            videoRef.current.playbackRate = rate
        }
        setSettingsTab('main')
    }

    const handleLoadedMetadata = async () => {
        setDuration(videoRef.current?.duration || 0)

        try {
            // Fetch metadata from backend
            const metadata = await window.ipcRenderer.invoke('media:get-metadata', movie.file_path)
            const storedAudioLang = getStoredValue(STORAGE_KEYS.audio)
            const storedSubtitleLang = getStoredValue(STORAGE_KEYS.subtitle)

            // Set Audio Tracks
            if (metadata.audioTracks && metadata.audioTracks.length > 0) {
                const tracks = metadata.audioTracks.map((t: any) => ({
                    id: t.index.toString(),
                    kind: 'main',
                    label: t.label,
                    language: t.language,
                    enabled: t.index === 1 // Default to first track usually
                }))
                setAudioTracks(tracks)
                if (storedAudioLang) {
                    const index = tracks.findIndex(track => (track.language && track.language === storedAudioLang) || (track.label && track.label === storedAudioLang))
                    if (index >= 0) {
                        setTimeout(() => toggleAudioTrack(index), 0)
                    }
                }
            }

            // Set Subtitle Tracks
            if (metadata.subtitleTracks && metadata.subtitleTracks.length > 0) {
                const tracks = metadata.subtitleTracks.map((t: any) => ({
                    id: t.index.toString(),
                    kind: 'subtitles',
                    label: t.label,
                    language: t.language,
                    mode: 'hidden' as TextTrackMode
                }))
                // Add to state but don't add to video yet until selected
                setTextTracks(tracks as any)
                if (storedSubtitleLang) {
                    const subtitleIndex = tracks.findIndex(track => (track.language && track.language === storedSubtitleLang) || (track.label && track.label === storedSubtitleLang))
                    if (subtitleIndex >= 0) {
                        setTimeout(() => toggleSubtitleTrack(subtitleIndex, tracks), 100)
                    }
                }
            }
        } catch (err) {
            console.error('Failed to load media metadata:', err)
        }
    }

    const toggleAudioTrack = (index: number) => {
        if (videoRef.current) {
            const videoEl = videoRef.current as unknown as VideoElementWithTracks
            const wasPlaying = !videoRef.current.paused
            const currentTime = videoRef.current.currentTime

            if (videoEl.audioTracks) {
                for (let i = 0; i < videoEl.audioTracks.length; i++) {
                    videoEl.audioTracks[i].enabled = i === index
                }

                // Update state
                const tracks: AudioTrack[] = []
                for (let i = 0; i < videoEl.audioTracks.length; i++) {
                    tracks.push(videoEl.audioTracks[i])
                }
                setAudioTracks(tracks)
                const selectedTrack = videoEl.audioTracks[index]
                const audioIdentifier = selectedTrack?.language || selectedTrack?.label
                if (audioIdentifier) {
                    setStoredValue(STORAGE_KEYS.audio, audioIdentifier)
                }
            }

            // Force a seek to the current time to ensure the media pipeline updates
            videoRef.current.currentTime = currentTime

            if (wasPlaying) {
                // Attempt to play immediately
                const playPromise = videoRef.current.play()

                if (playPromise !== undefined) {
                    playPromise.catch(error => {
                        console.log("Playback interrupted during audio switch, waiting for 'canplay'...", error)

                        // If immediate play fails (e.g. because of buffering), wait for the next 'canplay' event
                        const onCanPlay = () => {
                            if (videoRef.current) {
                                videoRef.current.play().catch(e => console.error("Retry play failed:", e))
                                videoRef.current.removeEventListener('canplay', onCanPlay)
                            }
                        }
                        videoRef.current?.addEventListener('canplay', onCanPlay)
                    })
                }
            }
        }
        setSettingsTab('main')
    }

    const toggleSubtitleTrack = async (index: number, trackSource?: TextTrack[]) => {
        const trackList = trackSource ?? textTracks
        const track = trackList[index]
        if (!track) return

        // If it's already showing, hide it
        if (track.mode === 'showing') {
            disableSubtitles()
            return
        }

        try {
            const vttContent = await window.ipcRenderer.invoke('media:extract-subtitle-content', movie.file_path, parseInt((track as any).id))
            const blob = new Blob([vttContent], { type: 'text/vtt' })
            const url = URL.createObjectURL(blob)

            // Create or update track element
            if (videoRef.current) {
                // Remove existing tracks
                const existingTracks = videoRef.current.querySelectorAll('track')
                existingTracks.forEach(t => t.remove())

                const trackEl = document.createElement('track')
                trackEl.kind = 'subtitles'
                trackEl.label = track.label
                trackEl.srclang = track.language
                trackEl.src = url
                trackEl.default = true
                videoRef.current.appendChild(trackEl)

                // Update state
                const newTracks = trackList.map((t, i) => ({
                    ...t,
                    mode: i === index ? 'showing' : 'hidden'
                }))
                setTextTracks(newTracks as any)

                // Force mode to showing
                setTimeout(() => {
                    if (trackEl.track) {
                        trackEl.track.mode = 'showing'
                    }
                }, 100)
            }
            const subtitleIdentifier = track.language || track.label
            if (subtitleIdentifier) {
                setStoredValue(STORAGE_KEYS.subtitle, subtitleIdentifier)
            }
        } catch (err) {
            console.error('Failed to load subtitle:', err)
        }

        setSettingsTab('main')
    }

    const disableSubtitles = () => {
        if (videoRef.current) {
            const existingTracks = videoRef.current.querySelectorAll('track')
            existingTracks.forEach(t => t.remove())

            const newTracks = textTracks.map(t => ({ ...t, mode: 'hidden' }))
            setTextTracks(newTracks as any)
        }
        removeStoredValue(STORAGE_KEYS.subtitle)
        setSettingsTab('main')
    }

    const handleResume = () => {
        if (videoRef.current && savedProgress) {
            videoRef.current.currentTime = savedProgress
            setCurrentTime(savedProgress)
            setIsPlaying(true)
            videoRef.current.play()
        }
        setShowResumePrompt(false)
    }

    const handleRestart = () => {
        if (videoRef.current) {
            videoRef.current.currentTime = 0
            setCurrentTime(0)
            setIsPlaying(true)
            videoRef.current.play()
        }
        setShowResumePrompt(false)
    }

    // Double Click Handling
    const handleDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
        const rect = e.currentTarget.getBoundingClientRect()
        const x = e.clientX - rect.left
        const width = rect.width

        if (x < width * 0.3) {
            // Left 30% - Rewind
            skip(-10)
        } else if (x > width * 0.7) {
            // Right 30% - Forward
            skip(10)
        } else {
            // Center 40% - Fullscreen
            toggleFullscreen()
        }
    }

    // Keyboard Shortcuts
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            showControlsHandler()

            switch (e.key.toLowerCase()) {
                case ' ':
                case 'k':
                    e.preventDefault()
                    togglePlay()
                    break
                case 'arrowleft':
                    e.preventDefault()
                    skip(e.shiftKey ? -30 : -10)
                    break
                case 'arrowright':
                    e.preventDefault()
                    skip(e.shiftKey ? 30 : 10)
                    break
                case 'arrowup':
                    e.preventDefault()
                    setVolume(v => Math.min(1, v + 0.1))
                    if (videoRef.current) videoRef.current.volume = Math.min(1, volume + 0.1)
                    break
                case 'arrowdown':
                    e.preventDefault()
                    setVolume(v => Math.max(0, v - 0.1))
                    if (videoRef.current) videoRef.current.volume = Math.max(0, volume - 0.1)
                    break
                case 'f':
                    toggleFullscreen()
                    break
                case 'm':
                    toggleMute()
                    break
                case 'escape':
                    if (document.fullscreenElement) {
                        document.exitFullscreen()
                        setIsFullscreen(false)
                    } else if (showSettings) {
                        setShowSettings(false)
                    } else {
                        onClose()
                    }
                    break
                case 'n':
                    if (hasNext && onNext) {
                        onNext()
                    }
                    break
                case 'p':
                    if (hasPrevious && onPrevious) {
                        onPrevious()
                    }
                    break
            }
        }

        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [onClose, volume, showControlsHandler, showSettings])

    // Settings Menu Content
    const renderSettingsContent = () => {
        switch (settingsTab) {
            case 'main':
                return (
                    <div className="flex flex-col gap-1 min-w-[240px]">
                        <button
                            onClick={() => setSettingsTab('audio')}
                            className="flex items-center justify-between px-3 py-2 rounded hover:bg-white/10 text-sm text-white transition-colors"
                        >
                            <div className="flex items-center gap-2">
                                <Languages className="w-4 h-4" />
                                <span>Audio</span>
                            </div>
                            <div className="flex items-center gap-1 text-white/50 text-xs">
                                <span>{audioTracks.find(t => t.enabled)?.label || 'Default'}</span>
                                <ChevronLeft className="w-4 h-4 rotate-180" />
                            </div>
                        </button>
                        <button
                            onClick={() => setSettingsTab('subtitles')}
                            className="flex items-center justify-between px-3 py-2 rounded hover:bg-white/10 text-sm text-white transition-colors"
                        >
                            <div className="flex items-center gap-2">
                                <MessageSquare className="w-4 h-4" />
                                <span>Subtitles</span>
                            </div>
                            <div className="flex items-center gap-1 text-white/50 text-xs">
                                <span>{textTracks.find(t => t.mode === 'showing')?.label || 'Off'}</span>
                                <ChevronLeft className="w-4 h-4 rotate-180" />
                            </div>
                        </button>
                        <button
                            onClick={() => setSettingsTab('speed')}
                            className="flex items-center justify-between px-3 py-2 rounded hover:bg-white/10 text-sm text-white transition-colors"
                        >
                            <div className="flex items-center gap-2">
                                <Gauge className="w-4 h-4" />
                                <span>Speed</span>
                            </div>
                            <div className="flex items-center gap-1 text-white/50 text-xs">
                                <span>{playbackRate}x</span>
                                <ChevronLeft className="w-4 h-4 rotate-180" />
                            </div>
                        </button>
                        <button
                            onClick={() => setSettingsTab('shortcuts')}
                            className="flex items-center justify-between px-3 py-2 rounded hover:bg-white/10 text-sm text-white transition-colors"
                        >
                            <div className="flex items-center gap-2">
                                <Keyboard className="w-4 h-4" />
                                <span>Shortcuts</span>
                            </div>
                            <ChevronLeft className="w-4 h-4 rotate-180 text-white/50" />
                        </button>
                    </div>
                )
            case 'audio':
                return (
                    <div className="flex flex-col gap-1 min-w-[240px]">
                        <button
                            onClick={() => setSettingsTab('main')}
                            className="flex items-center gap-2 px-3 py-2 mb-2 rounded hover:bg-white/10 text-sm text-white/70 hover:text-white transition-colors border-b border-white/10"
                        >
                            <ChevronLeft className="w-4 h-4" />
                            <span>Back</span>
                        </button>
                        {audioTracks.length === 0 && (
                            <div className="px-3 py-2 text-sm text-white/50">No audio tracks available</div>
                        )}
                        {audioTracks.map((track, i) => (
                            <button
                                key={i}
                                onClick={() => toggleAudioTrack(i)}
                                className="flex items-center justify-between px-3 py-2 rounded hover:bg-white/10 text-sm text-white transition-colors"
                            >
                                <span>{track.label || `Track ${i + 1}`} {track.language && `(${track.language})`}</span>
                                {track.enabled && <Check className="w-4 h-4 text-primary" />}
                            </button>
                        ))}
                    </div>
                )
            case 'subtitles':
                return (
                    <div className="flex flex-col gap-1 min-w-[240px]">
                        <button
                            onClick={() => setSettingsTab('main')}
                            className="flex items-center gap-2 px-3 py-2 mb-2 rounded hover:bg-white/10 text-sm text-white/70 hover:text-white transition-colors border-b border-white/10"
                        >
                            <ChevronLeft className="w-4 h-4" />
                            <span>Back</span>
                        </button>
                        <button
                            onClick={disableSubtitles}
                            className="flex items-center justify-between px-3 py-2 rounded hover:bg-white/10 text-sm text-white transition-colors"
                        >
                            <span>Off</span>
                            {textTracks.every(t => t.mode === 'hidden') && <Check className="w-4 h-4 text-primary" />}
                        </button>
                        {textTracks.map((track, i) => (
                            <button
                                key={i}
                                onClick={() => toggleSubtitleTrack(i)}
                                className="flex items-center justify-between px-3 py-2 rounded hover:bg-white/10 text-sm text-white transition-colors"
                            >
                                <span>{track.label || `Track ${i + 1}`} {track.language && `(${track.language})`}</span>
                                {track.mode === 'showing' && <Check className="w-4 h-4 text-primary" />}
                            </button>
                        ))}
                    </div>
                )
            case 'speed':
                return (
                    <div className="flex flex-col gap-1 min-w-[240px]">
                        <button
                            onClick={() => setSettingsTab('main')}
                            className="flex items-center gap-2 px-3 py-2 mb-2 rounded hover:bg-white/10 text-sm text-white/70 hover:text-white transition-colors border-b border-white/10"
                        >
                            <ChevronLeft className="w-4 h-4" />
                            <span>Back</span>
                        </button>
                        {[0.5, 0.75, 1, 1.25, 1.5, 2].map((rate) => (
                            <button
                                key={rate}
                                onClick={() => changePlaybackRate(rate)}
                                className="flex items-center justify-between px-3 py-2 rounded hover:bg-white/10 text-sm text-white transition-colors"
                            >
                                <span>{rate}x</span>
                                {playbackRate === rate && <Check className="w-4 h-4 text-primary" />}
                            </button>
                        ))}
                    </div>
                )
            case 'shortcuts':
                return (
                    <div className="flex flex-col gap-1 min-w-[240px]">
                        <button
                            onClick={() => setSettingsTab('main')}
                            className="flex items-center gap-2 px-3 py-2 mb-2 rounded hover:bg-white/10 text-sm text-white/70 hover:text-white transition-colors border-b border-white/10"
                        >
                            <ChevronLeft className="w-4 h-4" />
                            <span>Back</span>
                        </button>
                        <div className="px-3 py-1 space-y-2">
                            <div className="flex justify-between text-xs text-white/80">
                                <span>Play/Pause</span>
                                <span className="font-mono bg-white/10 px-1 rounded">Space</span>
                            </div>
                            <div className="flex justify-between text-xs text-white/80">
                                <span>Rewind 10s</span>
                                <span className="font-mono bg-white/10 px-1 rounded">←</span>
                            </div>
                            <div className="flex justify-between text-xs text-white/80">
                                <span>Rewind 30s</span>
                                <span className="font-mono bg-white/10 px-1 rounded">Shift + ←</span>
                            </div>
                            <div className="flex justify-between text-xs text-white/80">
                                <span>Forward 10s</span>
                                <span className="font-mono bg-white/10 px-1 rounded">→</span>
                            </div>
                            <div className="flex justify-between text-xs text-white/80">
                                <span>Forward 30s</span>
                                <span className="font-mono bg-white/10 px-1 rounded">Shift + →</span>
                            </div>
                            <div className="flex justify-between text-xs text-white/80">
                                <span>Volume Up</span>
                                <span className="font-mono bg-white/10 px-1 rounded">↑</span>
                            </div>
                            <div className="flex justify-between text-xs text-white/80">
                                <span>Volume Down</span>
                                <span className="font-mono bg-white/10 px-1 rounded">↓</span>
                            </div>
                            <div className="flex justify-between text-xs text-white/80">
                                <span>Fullscreen</span>
                                <span className="font-mono bg-white/10 px-1 rounded">F</span>
                            </div>
                            <div className="flex justify-between text-xs text-white/80">
                                <span>Mute</span>
                                <span className="font-mono bg-white/10 px-1 rounded">M</span>
                            </div>
                            <div className="flex justify-between text-xs text-white/80">
                                <span>Next Video</span>
                                <span className="font-mono bg-white/10 px-1 rounded">N</span>
                            </div>
                            <div className="flex justify-between text-xs text-white/80">
                                <span>Previous Video</span>
                                <span className="font-mono bg-white/10 px-1 rounded">P</span>
                            </div>
                        </div>
                    </div>
                )
        }
    }

    return (
        <div
            ref={containerRef}
            className="fixed inset-0 z-50 bg-black flex items-center justify-center group select-none"
            onMouseMove={showControlsHandler}
            onMouseLeave={() => isPlaying && !showSettings && setShowControls(false)}
        >
            {/* Video Element */}
            <div
                className="relative w-full h-full"
                onDoubleClick={handleDoubleClick}
                onClick={togglePlay}
            >
                <video
                    ref={videoRef}
                    className="w-full h-full object-contain"
                    autoPlay
                    src={`media://${encodeURIComponent(movie.file_path)}`}
                    onTimeUpdate={() => setCurrentTime(videoRef.current?.currentTime || 0)}
                    onLoadedMetadata={handleLoadedMetadata}
                    onPlay={() => {
                        setIsPlaying(true)
                        setIsBuffering(false)
                    }}
                    onPause={() => setIsPlaying(false)}
                    onEnded={() => setIsPlaying(false)}
                    onWaiting={() => setIsBuffering(true)}
                    onPlaying={() => setIsBuffering(false)}
                />
            </div>

            {/* Top Header */}
            <div className={`absolute top-0 left-0 right-0 p-6 bg-gradient-to-b from-black/80 to-transparent transition-opacity duration-300 z-20 ${showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <button
                            onClick={onClose}
                            className="text-white/80 hover:text-white hover:bg-white/10 p-2 rounded-full transition-colors pointer-events-auto"
                        >
                            <ChevronLeft className="w-8 h-8" />
                        </button>
                        <div>
                            <h2 className="text-xl font-bold text-white drop-shadow-md">{movie.title}</h2>
                            {movie.year && <p className="text-white/60 text-sm">{movie.year}</p>}
                        </div>
                    </div>
                </div>
            </div>

            {/* Center Play/Pause Animation/Button */}
            {!isPlaying && !showResumePrompt && !isBuffering && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/20 backdrop-blur-[2px] z-10 pointer-events-none">
                    <button
                        onClick={togglePlay}
                        className="p-6 bg-white/10 hover:bg-white/20 rounded-full backdrop-blur-md transition-all transform hover:scale-110 pointer-events-auto"
                    >
                        <Play className="w-16 h-16 text-white fill-white" />
                    </button>
                </div>
            )}

            {/* Click Feedback Animation */}
            {clickFeedback && (
                <div className="absolute inset-0 flex items-center justify-center z-20 pointer-events-none">
                    <div className="p-6 bg-black/40 rounded-full backdrop-blur-md animate-out fade-out zoom-out duration-500">
                        {clickFeedback === 'play' && <Play className="w-12 h-12 text-white fill-white" />}
                        {clickFeedback === 'pause' && <Pause className="w-12 h-12 text-white fill-white" />}
                        {clickFeedback === 'forward' && <SkipForward className="w-12 h-12 text-white fill-white" />}
                        {clickFeedback === 'rewind' && <SkipBack className="w-12 h-12 text-white fill-white" />}
                    </div>
                </div>
            )}

            {/* Buffering Indicator */}
            {isBuffering && (
                <div className="absolute inset-0 flex items-center justify-center z-20 pointer-events-none">
                    <div className="animate-spin rounded-full h-16 w-16 border-t-4 border-b-4 border-primary"></div>
                </div>
            )}

            {/* Up Next Overlay */}
            {showUpNext && !showResumePrompt && (
                <div className="absolute bottom-28 right-8 z-30 animate-in slide-in-from-right fade-in duration-500">
                    <div className="max-w-sm transform transition-all animate-in zoom-in-95 slide-in-from-bottom-4 duration-500">
                        <div className="flex flex-col gap-3 w-full">
                            {hasNext && onNext && (
                                <button
                                    onClick={onNext}
                                    className="flex items-center justify-center gap-3 px-8 py-3.5 rounded-xl bg-white text-black hover:bg-white/90 transition-all font-bold text-sm tracking-wide hover:scale-105 active:scale-95 shadow-xl shadow-white/10"
                                >
                                    <SkipForward className="w-4 h-4 fill-current" />
                                    NEXT VIDEO
                                </button>
                            )}
                            {hasPrevious && onPrevious && (
                                <button
                                    onClick={onPrevious}
                                    className="flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl bg-white/5 hover:bg-white/10 text-white/70 hover:text-white transition-all font-medium text-sm border border-white/5 hover:border-white/10 backdrop-blur-md"
                                >
                                    <SkipBack className="w-4 h-4" />
                                    Previous Video
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Resume Prompt */}
            {showResumePrompt && (
                <div className="absolute inset-0 flex items-center justify-center z-30 animate-in fade-in duration-500">
                    {/* Dark gradient overlay to make text pop but keep video visible */}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-black/40 backdrop-blur-[1px]" />

                    <div className="relative max-w-md w-full mx-6 transform transition-all animate-in zoom-in-95 slide-in-from-bottom-4 duration-500">
                        <div className="flex flex-col items-start">
                            <div className="flex items-center gap-3 mb-6">
                                <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center backdrop-blur-md border border-primary/10">
                                    <History className="w-5 h-5 text-primary" />
                                </div>
                                <span className="text-primary font-medium tracking-wide uppercase text-xs">Resume Playback</span>
                            </div>

                            <h3 className="text-4xl font-bold text-white mb-2 tracking-tight drop-shadow-lg">
                                Continue Watching?
                            </h3>

                            <p className="text-white/70 mb-8 text-lg font-light">
                                You left off at <span className="text-white font-medium">{formatTime(savedProgress || 0)}</span>
                            </p>

                            <div className="flex items-center gap-4 w-full sm:w-auto">
                                <button
                                    onClick={handleResume}
                                    className="flex-1 sm:flex-none flex items-center justify-center gap-3 px-8 py-3.5 rounded-xl bg-white text-black hover:bg-white/90 transition-all font-bold text-sm tracking-wide hover:scale-105 active:scale-95 shadow-xl shadow-white/10"
                                >
                                    <Play className="w-4 h-4 fill-current" />
                                    RESUME
                                </button>

                                <button
                                    onClick={handleRestart}
                                    className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl bg-white/5 hover:bg-white/10 text-white/70 hover:text-white transition-all font-medium text-sm border border-white/5 hover:border-white/10 backdrop-blur-md"
                                >
                                    <RotateCcw className="w-4 h-4" />
                                    Start Over
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Bottom Controls */}
            <div className={`absolute bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-black/90 via-black/60 to-transparent transition-opacity duration-300 z-20 ${showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
                {/* Progress Bar */}
                <div
                    className="mb-4 group/progress relative h-2 flex items-center cursor-pointer pointer-events-auto"
                    onMouseMove={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect()
                        const x = e.clientX - rect.left
                        const percentage = x / rect.width
                        setHoverTime(percentage * duration)
                        setHoverPosition(x)
                    }}
                    onMouseLeave={() => {
                        setHoverTime(null)
                        setHoverPosition(null)
                    }}
                >
                    {/* Time Tooltip */}
                    {hoverTime !== null && hoverPosition !== null && (
                        <div
                            className="absolute bottom-4 -translate-x-1/2 bg-black/80 text-white text-xs px-2 py-1 rounded border border-white/10 pointer-events-none whitespace-nowrap z-30"
                            style={{ left: hoverPosition }}
                        >
                            {formatTime(hoverTime)}
                        </div>
                    )}

                    <input
                        type="range"
                        min="0"
                        max={duration}
                        value={currentTime}
                        onChange={handleSeek}
                        className="absolute inset-0 w-full h-full opacity-0 z-20 cursor-pointer"
                    />
                    <div className="w-full h-1 bg-white/20 rounded-full overflow-hidden group-hover/progress:h-2 transition-all">
                        <div
                            className="h-full bg-primary relative"
                            style={{ width: `${(currentTime / duration) * 100}%` }}
                        >
                            <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow-lg scale-0 group-hover/progress:scale-100 transition-transform" />
                        </div>
                    </div>
                </div>

                <div className="flex items-center justify-between pointer-events-auto">
                    <div className="flex items-center gap-4">
                        <button onClick={togglePlay} className="text-white hover:text-primary transition-colors">
                            {isPlaying ? <Pause className="w-8 h-8 fill-current" /> : <Play className="w-8 h-8 fill-current" />}
                        </button>

                        <div className="flex items-center gap-2 text-white/80 hover:text-white transition-colors group/volume">
                            <button onClick={toggleMute}>
                                {isMuted || volume === 0 ? <VolumeX className="w-6 h-6" /> : <Volume2 className="w-6 h-6" />}
                            </button>
                            <input
                                type="range"
                                min="0"
                                max="1"
                                step="0.1"
                                value={isMuted ? 0 : volume}
                                onChange={handleVolumeChange}
                                className="w-0 overflow-hidden group-hover/volume:w-24 transition-all duration-300 h-1 bg-white/20 rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:rounded-full"
                            />
                        </div>

                        <button
                            onClick={() => setShowRemainingTime(!showRemainingTime)}
                            className="text-sm text-white/80 hover:text-white font-medium tabular-nums min-w-[100px] text-left transition-colors"
                        >
                            {showRemainingTime
                                ? formatTime(currentTime - duration)
                                : `${formatTime(currentTime)} / ${formatTime(duration)}`
                            }
                        </button>
                    </div>

                    <div className="flex items-center gap-4 relative">
                        {/* Next/Previous Buttons */}
                        {hasPrevious && onPrevious && (
                            <button
                                onClick={onPrevious}
                                className="text-white/70 hover:text-white transition-colors"
                                title="Previous video (P)"
                            >
                                <SkipBack className="w-6 h-6" />
                            </button>
                        )}

                        {hasNext && onNext && (
                            <button
                                onClick={onNext}
                                className="text-white/70 hover:text-white transition-colors"
                                title="Next video (N)"
                            >
                                <SkipForward className="w-6 h-6" />
                            </button>
                        )}

                        {/* Settings Menu */}
                        {showSettings && (
                            <div className="absolute bottom-14 right-0 bg-black/90 backdrop-blur-md border border-white/10 rounded-xl p-2 min-w-[240px] shadow-2xl z-50 animate-in fade-in slide-in-from-bottom-2 duration-200">
                                {renderSettingsContent()}
                            </div>
                        )}

                        <button
                            onClick={() => {
                                setShowSettings(!showSettings)
                                setSettingsTab('main')
                            }}
                            className={`text-white/70 hover:text-white transition-colors ${showSettings ? 'text-white rotate-90' : ''} transform duration-300`}
                        >
                            <Settings className="w-6 h-6" />
                        </button>

                        <button onClick={toggleFullscreen} className="text-white/70 hover:text-white transition-colors">
                            {isFullscreen ? <Minimize className="w-6 h-6" /> : <Maximize className="w-6 h-6" />}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )
}

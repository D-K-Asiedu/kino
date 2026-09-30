import {
    Play, Pause, Volume2, VolumeX, Maximize, Minimize,
    SkipBack, SkipForward, ChevronLeft, Gauge, MessageSquare, Languages,
    History, RotateCcw, Settings, Check, Keyboard, PictureInPicture2, Type, X
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
    disableProgress?: boolean
    /** 'prompt' asks whether to resume saved progress; 'resume'/'restart' skip the question. */
    startMode?: 'prompt' | 'resume' | 'restart'
}

type SettingsTab = 'main' | 'audio' | 'subtitles' | 'subtitleSize' | 'speed'

type SubtitleSize = 'small' | 'medium' | 'large' | 'xlarge'

const SUBTITLE_SIZES: { value: SubtitleSize; label: string }[] = [
    { value: 'small', label: 'Small' },
    { value: 'medium', label: 'Medium' },
    { value: 'large', label: 'Large' },
    { value: 'xlarge', label: 'Extra large' },
]

const SHORTCUTS: { keys: string[]; label: string }[] = [
    { keys: ['Space', 'K'], label: 'Play / Pause' },
    { keys: ['←'], label: 'Rewind 10s' },
    { keys: ['Shift', '←'], label: 'Rewind 30s' },
    { keys: ['→'], label: 'Forward 10s' },
    { keys: ['Shift', '→'], label: 'Forward 30s' },
    { keys: ['↑'], label: 'Volume up' },
    { keys: ['↓'], label: 'Volume down' },
    { keys: ['M'], label: 'Mute' },
    { keys: ['F'], label: 'Fullscreen' },
    { keys: ['I'], label: 'Picture in Picture' },
    { keys: ['N'], label: 'Next video' },
    { keys: ['P'], label: 'Previous video' },
    { keys: ['?'], label: 'Show shortcuts' },
    { keys: ['Esc'], label: 'Close player' },
]

const STORAGE_KEYS = {
    playbackRate: 'kino_preferred_speed',
    subtitle: 'kino_preferred_subtitle_language',
    audio: 'kino_preferred_audio_language',
    subtitleSize: 'kino_subtitle_size'
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

interface PlaybackInfo {
    mode: 'direct' | 'transcode'
    duration: number
    copyVideo: boolean
    reason: string | null
}

interface ActiveSubtitle {
    vtt: string
    label: string
    language: string
}

const VTT_TIMESTAMP = /(?:(\d+):)?(\d{2}):(\d{2})\.(\d{3})/g

const formatVttTimestamp = (seconds: number) => {
    const totalMs = Math.max(0, Math.round(seconds * 1000))
    const h = Math.floor(totalMs / 3600000)
    const m = Math.floor((totalMs % 3600000) / 60000)
    const s = Math.floor((totalMs % 60000) / 1000)
    const ms = totalMs % 1000
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`
}

/** Shift every cue earlier by offsetSeconds, so cues line up with a stream that starts mid-file. */
const shiftVttCues = (vtt: string, offsetSeconds: number) => {
    if (offsetSeconds <= 0) return vtt
    return vtt
        .split('\n')
        .map(line => {
            if (!line.includes('-->')) return line
            return line.replace(VTT_TIMESTAMP, (_match, h, m, sec, ms) => {
                const value = Number(h ?? 0) * 3600 + Number(m) * 60 + Number(sec) + Number(ms) / 1000
                return formatVttTimestamp(value - offsetSeconds)
            })
        })
        .join('\n')
}

export function VideoPlayer({ movie, onClose, onNext, onPrevious, hasNext, hasPrevious, disableProgress, startMode = 'prompt' }: VideoPlayerProps) {
    const videoRef = useRef<HTMLVideoElement>(null)
    const containerRef = useRef<HTMLDivElement>(null)
    const controlsTimeoutRef = useRef<NodeJS.Timeout>()
    const bufferingTimeoutRef = useRef<NodeJS.Timeout>()
    const lastUiTimeRef = useRef(0)
    const subtitleObjectUrlRef = useRef<string | null>(null)
    const pendingSeekTimeRef = useRef<number | null>(null)
    const isScrubbingRef = useRef(false)
    const suppressBufferingUntilRef = useRef(0)
    const volumeOsdTimeoutRef = useRef<NodeJS.Timeout>()
    // Effective volume for rapid key repeats, which fire faster than React re-renders.
    const effectiveVolumeRef = useRef(1)
    // Only the first movie honours startMode; next/previous episodes use the normal prompt.
    const startModeRef = useRef(startMode)
    // Converted streams (see electron/lib/streaming.ts) restart at the seek position, so the
    // element's currentTime is relative to streamOffsetRef. Direct playback always has offset 0.
    const isTranscodeRef = useRef(false)
    const streamOffsetRef = useRef(0)
    const audioStreamIndexRef = useRef<number | null>(null)
    const activeSubtitleRef = useRef<ActiveSubtitle | null>(null)
    // Direct playback: position to seek to once metadata has loaded (resume point).
    const pendingStartTimeRef = useRef(0)
    // While a new stream loads the element reports paused, so remember whether playback should
    // continue once it's ready (null = no stream load pending).
    const pendingPlayIntentRef = useRef<boolean | null>(null)
    const tracksLoadedForMovieRef = useRef<number | null>(null)

    // State
    const [isPlaying, setIsPlaying] = useState(true)
    const [currentTime, setCurrentTime] = useState(0)
    const [duration, setDuration] = useState(0)
    const [volume, setVolume] = useState(1)
    const [isMuted, setIsMuted] = useState(false)
    const [isFullscreen, setIsFullscreen] = useState(false)
    const [isPictureInPicture, setIsPictureInPicture] = useState(false)
    const [isPictureInPictureSupported, setIsPictureInPictureSupported] = useState(false)
    const [showControls, setShowControls] = useState(true)
    const [playbackRate, setPlaybackRate] = useState(() => {
        const storedValue = getStoredValue(STORAGE_KEYS.playbackRate)
        const parsed = storedValue ? parseFloat(storedValue) : NaN
        return Number.isFinite(parsed) && parsed > 0 ? parsed : 1
    })
    const [audioTracks, setAudioTracks] = useState<AudioTrack[]>([])
    const [textTracks, setTextTracks] = useState<TextTrack[]>([])
    const [playbackInfo, setPlaybackInfo] = useState<PlaybackInfo | null>(null)
    const [videoSrc, setVideoSrc] = useState<string | undefined>(undefined)
    const [autoPlayEnabled, setAutoPlayEnabled] = useState(true)
    const [playbackError, setPlaybackError] = useState<string | null>(null)

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
    const [isScrubbing, setIsScrubbing] = useState(false)

    // Up Next Overlay State
    const [showUpNext, setShowUpNext] = useState(false)

    const [showShortcuts, setShowShortcuts] = useState(false)
    const [showVolumeOsd, setShowVolumeOsd] = useState(false)
    const [subtitleSize, setSubtitleSize] = useState<SubtitleSize>(() => {
        const stored = getStoredValue(STORAGE_KEYS.subtitleSize)
        return SUBTITLE_SIZES.some(s => s.value === stored) ? stored as SubtitleSize : 'medium'
    })

    const revokeSubtitleObjectUrl = useCallback(() => {
        if (subtitleObjectUrlRef.current) {
            URL.revokeObjectURL(subtitleObjectUrlRef.current)
            subtitleObjectUrlRef.current = null
        }
    }, [])

    const clearBufferingTimeout = useCallback(() => {
        if (bufferingTimeoutRef.current) {
            clearTimeout(bufferingTimeoutRef.current)
            bufferingTimeoutRef.current = undefined
        }
    }, [])

    const hideBufferingIndicator = useCallback(() => {
        clearBufferingTimeout()
        setIsBuffering(false)
    }, [clearBufferingTimeout])

    /** Position in the movie (seconds), accounting for converted streams that start mid-file. */
    const getAbsoluteTime = useCallback(() => {
        const video = videoRef.current
        if (!video) return 0
        return (isTranscodeRef.current ? streamOffsetRef.current : 0) + video.currentTime
    }, [])

    const buildStreamUrl = useCallback((start: number, audioStreamIndex: number | null) => {
        const params = new URLSearchParams({
            path: movie.file_path,
            start: start.toFixed(3),
            audio: audioStreamIndex === null ? '' : String(audioStreamIndex),
        })
        return `kino-stream://play/?${params.toString()}`
    }, [movie.file_path])

    /** (Re)attach the selected subtitle, shifted to match the current stream offset. */
    const attachActiveSubtitle = useCallback(() => {
        const video = videoRef.current
        const subtitle = activeSubtitleRef.current
        if (!video) return

        video.querySelectorAll('track').forEach(t => t.remove())
        revokeSubtitleObjectUrl()
        if (!subtitle) return

        const offset = isTranscodeRef.current ? streamOffsetRef.current : 0
        const url = URL.createObjectURL(new Blob([shiftVttCues(subtitle.vtt, offset)], { type: 'text/vtt' }))
        const trackEl = document.createElement('track')
        trackEl.kind = 'subtitles'
        trackEl.label = subtitle.label
        trackEl.srclang = subtitle.language
        trackEl.src = url
        trackEl.default = true
        video.appendChild(trackEl)
        subtitleObjectUrlRef.current = url

        setTimeout(() => {
            if (trackEl.track) {
                trackEl.track.mode = 'showing'
            }
        }, 100)
    }, [revokeSubtitleObjectUrl])

    /** Whether the user expects playback to be running (true while a paused-looking stream is loading). */
    const isPlaybackIntended = useCallback(() => {
        return pendingPlayIntentRef.current ?? !(videoRef.current?.paused ?? true)
    }, [])

    /** Converted playback: start a new stream at `time` (seconds into the movie). */
    const startStreamAt = useCallback((time: number, play: boolean) => {
        pendingPlayIntentRef.current = play
        streamOffsetRef.current = Math.max(0, time)
        setAutoPlayEnabled(play)
        setPlaybackError(null)
        setVideoSrc(buildStreamUrl(streamOffsetRef.current, audioStreamIndexRef.current))
        lastUiTimeRef.current = streamOffsetRef.current
        setCurrentTime(streamOffsetRef.current)
        if (activeSubtitleRef.current) attachActiveSubtitle()
    }, [attachActiveSubtitle, buildStreamUrl])

    const performSeek = useCallback((time: number) => {
        const video = videoRef.current
        if (!video || !Number.isFinite(time)) return

        const clampedTime = duration > 0 ? Math.max(0, Math.min(time, duration)) : Math.max(0, time)
        const seekableVideo = video as HTMLVideoElement & { fastSeek?: (seekTime: number) => void }

        // Treat user seeks as expected stalls; don't flash the spinner immediately.
        suppressBufferingUntilRef.current = Date.now() + 400
        hideBufferingIndicator()

        if (isTranscodeRef.current) {
            // A converted stream can only seek within what has already arrived; anything else
            // restarts the conversion at the target position.
            const relative = clampedTime - streamOffsetRef.current
            const { buffered } = video
            let isBuffered = false
            for (let i = 0; i < buffered.length; i++) {
                if (relative >= buffered.start(i) - 0.5 && relative <= buffered.end(i)) {
                    isBuffered = true
                    break
                }
            }
            if (isBuffered) {
                video.currentTime = Math.max(0, relative)
                pendingSeekTimeRef.current = clampedTime
                lastUiTimeRef.current = clampedTime
                setCurrentTime(clampedTime)
            } else {
                pendingSeekTimeRef.current = clampedTime
                startStreamAt(clampedTime, isPlaybackIntended())
            }
            return
        }

        try {
            if (typeof seekableVideo.fastSeek === 'function') {
                seekableVideo.fastSeek(clampedTime)
            } else {
                video.currentTime = clampedTime
            }
        } catch {
            video.currentTime = clampedTime
        }

        pendingSeekTimeRef.current = clampedTime
        lastUiTimeRef.current = clampedTime
        setCurrentTime(clampedTime)
    }, [duration, hideBufferingIndicator, startStreamAt, isPlaybackIntended])

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

    // Picture-in-Picture support and state tracking
    useEffect(() => {
        setIsPictureInPictureSupported(!!document.pictureInPictureEnabled)
    }, [])

    useEffect(() => {
        const video = videoRef.current
        if (!video) return

        const handleEnter = () => setIsPictureInPicture(true)
        const handleLeave = () => setIsPictureInPicture(false)

        video.addEventListener('enterpictureinpicture', handleEnter)
        video.addEventListener('leavepictureinpicture', handleLeave)

        return () => {
            video.removeEventListener('enterpictureinpicture', handleEnter)
            video.removeEventListener('leavepictureinpicture', handleLeave)
        }
    }, [])

    useEffect(() => {
        return () => {
            if (document.pictureInPictureElement) {
                document.exitPictureInPicture().catch(() => undefined)
            }
            clearBufferingTimeout()
            revokeSubtitleObjectUrl()
        }
    }, [clearBufferingTimeout, revokeSubtitleObjectUrl])

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

    // Load source: decide between direct playback and on-the-fly conversion, and where to start.
    useEffect(() => {
        let cancelled = false

        const init = async () => {
            setPlaybackError(null)
            setPlaybackInfo(null)
            setVideoSrc(undefined)

            let info: PlaybackInfo = { mode: 'direct', duration: 0, copyVideo: true, reason: null }
            try {
                info = await window.ipcRenderer.invoke('media:get-playback-info', movie.file_path)
            } catch (err) {
                console.error('Failed to probe media, trying direct playback:', err)
            }

            let progress = 0
            if (!disableProgress) {
                try {
                    progress = Number(await window.ipcRenderer.invoke('db:get-playback-progress', movie.id)) || 0
                } catch (err) {
                    console.error('Failed to load playback progress:', err)
                }
            }
            if (cancelled) return

            const mode = startModeRef.current
            startModeRef.current = 'prompt'
            // Only resume if watched more than 5 seconds
            const startAt = progress > 5 && mode !== 'restart' ? progress : 0
            const showPrompt = startAt > 0 && mode === 'prompt'

            isTranscodeRef.current = info.mode === 'transcode'
            streamOffsetRef.current = 0
            audioStreamIndexRef.current = null
            pendingStartTimeRef.current = 0
            setPlaybackInfo(info)
            if (info.duration > 0) setDuration(info.duration)

            if (showPrompt) {
                // Show the frame where the user left off, paused, behind the prompt
                setSavedProgress(progress)
                setShowResumePrompt(true)
                setIsPlaying(false)
            }
            setAutoPlayEnabled(!showPrompt)
            lastUiTimeRef.current = startAt
            setCurrentTime(startAt)

            if (info.mode === 'transcode') {
                streamOffsetRef.current = startAt
                setVideoSrc(buildStreamUrl(startAt, null))
            } else {
                pendingStartTimeRef.current = startAt
                setVideoSrc(`media://${encodeURIComponent(movie.file_path)}`)
            }
        }

        void init()
        return () => {
            cancelled = true
        }
    }, [movie.id, movie.file_path, disableProgress, buildStreamUrl])

    // Stop any running conversion when the player closes
    useEffect(() => {
        return () => {
            void window.ipcRenderer.invoke('media:stop-streams').catch(() => undefined)
        }
    }, [])

    useEffect(() => {
        lastUiTimeRef.current = 0
        setCurrentTime(0)
        setDuration(0)
        setSavedProgress(null)
        setShowResumePrompt(false)
        setAudioTracks([])
        setTextTracks([])
        activeSubtitleRef.current = null
        tracksLoadedForMovieRef.current = null
        revokeSubtitleObjectUrl()
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
        }
    }, [movie.id, revokeSubtitleObjectUrl])

    useEffect(() => {
        if (videoRef.current) {
            // Loading a new source resets playbackRate to defaultPlaybackRate, so set both.
            videoRef.current.defaultPlaybackRate = playbackRate
            videoRef.current.playbackRate = playbackRate
        }
    }, [movie.id, playbackRate, videoSrc])

    // Save progress periodically
    useEffect(() => {
        const interval = setInterval(() => {
            if (disableProgress) return
            if (isPlaying && videoRef.current) {
                const time = getAbsoluteTime()
                if (time > 5 && duration > 0 && time < duration - 10) { // Don't save if at start or very end
                    window.ipcRenderer.invoke('db:update-playback-progress', movie.id, time, duration)
                }
            }
        }, 5000)

        return () => clearInterval(interval)
    }, [isPlaying, movie.id, duration, disableProgress, getAbsoluteTime])

    // Save on unmount
    useEffect(() => {
        return () => {
            if (disableProgress) return
            if (videoRef.current) {
                const time = getAbsoluteTime()
                if (time > 5) {
                    window.ipcRenderer.invoke('db:update-playback-progress', movie.id, time, duration)
                }
            }
        }
    }, [movie.id, duration, disableProgress, getAbsoluteTime])

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

    const handleTimeUpdate = useCallback(() => {
        const video = videoRef.current
        if (!video) return
        if (isScrubbingRef.current) return

        const time = getAbsoluteTime()
        const prev = lastUiTimeRef.current
        const nearEnd = duration > 0 && duration - time < 0.25
        if (Math.abs(time - prev) >= 0.25 || time === 0 || nearEnd) {
            lastUiTimeRef.current = time
            setCurrentTime(time)
        }
    }, [duration, getAbsoluteTime])

    // Video Actions
    const togglePlay = () => {
        // An explicit play/pause overrides whatever a pending stream load intended.
        pendingPlayIntentRef.current = null
        setAutoPlayEnabled(true)
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
        if (!Number.isFinite(time)) return

        pendingSeekTimeRef.current = time
        lastUiTimeRef.current = time
        setCurrentTime(time)

        // Keyboard adjustments on the range input should still seek immediately.
        if (!isScrubbingRef.current) {
            performSeek(time)
        }
    }

    const beginScrubSeek = () => {
        isScrubbingRef.current = true
        setIsScrubbing(true)
        hideBufferingIndicator()
    }

    const commitScrubSeek = () => {
        if (!isScrubbingRef.current) return

        isScrubbingRef.current = false
        setIsScrubbing(false)

        if (pendingSeekTimeRef.current !== null) {
            performSeek(pendingSeekTimeRef.current)
        }
    }

    const skip = (seconds: number) => {
        if (videoRef.current) {
            performSeek(getAbsoluteTime() + seconds)
            setClickFeedback(seconds > 0 ? 'forward' : 'rewind')
            setTimeout(() => setClickFeedback(null), 500)
        }
    }

    const applyVolume = (level: number) => {
        const newVolume = Math.round(Math.min(1, Math.max(0, level)) * 100) / 100
        effectiveVolumeRef.current = newVolume
        setVolume(newVolume)
        setIsMuted(newVolume === 0)
        localStorage.setItem('kino_volume', newVolume.toString())
        if (videoRef.current) {
            videoRef.current.volume = newVolume
            videoRef.current.muted = newVolume === 0
        }
    }

    const flashVolumeOsd = () => {
        setShowVolumeOsd(true)
        if (volumeOsdTimeoutRef.current) clearTimeout(volumeOsdTimeoutRef.current)
        volumeOsdTimeoutRef.current = setTimeout(() => setShowVolumeOsd(false), 1200)
    }

    useEffect(() => {
        return () => {
            if (volumeOsdTimeoutRef.current) clearTimeout(volumeOsdTimeoutRef.current)
        }
    }, [])

    const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        applyVolume(parseFloat(e.target.value))
    }

    useEffect(() => {
        effectiveVolumeRef.current = isMuted ? 0 : volume
    }, [volume, isMuted])

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

    const togglePictureInPicture = useCallback(async () => {
        if (!videoRef.current || !document.pictureInPictureEnabled) return
        try {
            if (document.pictureInPictureElement) {
                await document.exitPictureInPicture()
            } else {
                await videoRef.current.requestPictureInPicture()
            }
        } catch {
            // Ignore PiP failures (e.g., unsupported or blocked)
        }
    }, [])

    const changePlaybackRate = (rate: number) => {
        setPlaybackRate(rate)
        setStoredValue(STORAGE_KEYS.playbackRate, rate.toString())
        if (videoRef.current) {
            videoRef.current.defaultPlaybackRate = rate
            videoRef.current.playbackRate = rate
        }
        setSettingsTab('main')
    }

    const handleLoadedMetadata = async () => {
        const video = videoRef.current
        if (isTranscodeRef.current) {
            // The element only knows the length of the stream so far; use the file's real duration.
            if (playbackInfo?.duration) setDuration(playbackInfo.duration)
        } else {
            setDuration(video?.duration || 0)
            if (video && pendingStartTimeRef.current > 0) {
                video.currentTime = pendingStartTimeRef.current
                pendingStartTimeRef.current = 0
            }
        }

        // Converted streams fire loadedmetadata on every seek restart; load track lists once per movie.
        if (tracksLoadedForMovieRef.current === movie.id) return
        tracksLoadedForMovieRef.current = movie.id

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
                    const index = tracks.findIndex((track: { language: string; label: string }) =>
                        (track.language && track.language === storedAudioLang) || (track.label && track.label === storedAudioLang)
                    )
                    if (index >= 0) {
                        setTimeout(() => toggleAudioTrack(index, tracks), 0)
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
                    const subtitleIndex = tracks.findIndex((track: { language: string; label: string }) =>
                        (track.language && track.language === storedSubtitleLang) || (track.label && track.label === storedSubtitleLang)
                    )
                    if (subtitleIndex >= 0) {
                        setTimeout(() => toggleSubtitleTrack(subtitleIndex, tracks), 100)
                    }
                }
            }
        } catch (err) {
            console.error('Failed to load media metadata:', err)
        }
    }

    const toggleAudioTrack = (index: number, trackSource?: AudioTrack[]) => {
        if (isTranscodeRef.current) {
            // Converted streams carry a single audio track; switching restarts the stream with the new one.
            const trackList = trackSource ?? audioTracks
            const track = trackList[index]
            if (!track) return
            const streamIndex = Number(track.id)
            const activeIndex = audioStreamIndexRef.current ?? Number(trackList[0]?.id)
            setAudioTracks(trackList.map((t, i) => ({ ...t, enabled: i === index })))
            const audioIdentifier = track.language || track.label
            if (audioIdentifier) {
                setStoredValue(STORAGE_KEYS.audio, audioIdentifier)
            }
            if (streamIndex !== activeIndex) {
                audioStreamIndexRef.current = streamIndex
                startStreamAt(getAbsoluteTime(), isPlaybackIntended())
            }
            setSettingsTab('main')
            return
        }

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

            if (videoRef.current) {
                activeSubtitleRef.current = { vtt: vttContent, label: track.label, language: track.language }
                attachActiveSubtitle()

                const newTracks = trackList.map((t, i) => ({
                    ...t,
                    mode: i === index ? 'showing' : 'hidden'
                }))
                setTextTracks(newTracks as any)
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
        activeSubtitleRef.current = null
        if (videoRef.current) {
            const existingTracks = videoRef.current.querySelectorAll('track')
            existingTracks.forEach(t => t.remove())

            const newTracks = textTracks.map(t => ({ ...t, mode: 'hidden' }))
            setTextTracks(newTracks as any)
        }
        revokeSubtitleObjectUrl()
        removeStoredValue(STORAGE_KEYS.subtitle)
        setSettingsTab('main')
    }

    const handleResume = () => {
        // The source was already loaded at the saved position; just start playing.
        setAutoPlayEnabled(true)
        if (videoRef.current && savedProgress) {
            lastUiTimeRef.current = savedProgress
            setCurrentTime(savedProgress)
            setIsPlaying(true)
            void videoRef.current.play().catch(() => undefined)
        }
        setShowResumePrompt(false)
    }

    const handleRestart = () => {
        setAutoPlayEnabled(true)
        if (isTranscodeRef.current) {
            startStreamAt(0, true)
        } else if (videoRef.current) {
            pendingStartTimeRef.current = 0
            videoRef.current.currentTime = 0
            lastUiTimeRef.current = 0
            setCurrentTime(0)
            void videoRef.current.play().catch(() => undefined)
        }
        setIsPlaying(true)
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
                    applyVolume(effectiveVolumeRef.current + 0.1)
                    flashVolumeOsd()
                    break
                case 'arrowdown':
                    e.preventDefault()
                    applyVolume(effectiveVolumeRef.current - 0.1)
                    flashVolumeOsd()
                    break
                case 'f':
                    toggleFullscreen()
                    break
                case 'm':
                    toggleMute()
                    flashVolumeOsd()
                    break
                case '?':
                    e.preventDefault()
                    setShowShortcuts(v => !v)
                    break
                case 'i':
                    togglePictureInPicture()
                    break
                case 'escape':
                    if (showShortcuts) {
                        setShowShortcuts(false)
                    } else if (document.fullscreenElement) {
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
    }, [onClose, volume, isMuted, showControlsHandler, showSettings, showShortcuts, togglePictureInPicture, hasNext, hasPrevious, onNext, onPrevious])

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
                            onClick={() => setSettingsTab('subtitleSize')}
                            className="flex items-center justify-between px-3 py-2 rounded hover:bg-white/10 text-sm text-white transition-colors"
                        >
                            <div className="flex items-center gap-2">
                                <Type className="w-4 h-4" />
                                <span>Subtitle size</span>
                            </div>
                            <div className="flex items-center gap-1 text-white/50 text-xs">
                                <span>{SUBTITLE_SIZES.find(s => s.value === subtitleSize)?.label}</span>
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
                            onClick={() => {
                                setShowSettings(false)
                                setShowShortcuts(true)
                            }}
                            className="flex items-center justify-between px-3 py-2 rounded hover:bg-white/10 text-sm text-white transition-colors"
                        >
                            <div className="flex items-center gap-2">
                                <Keyboard className="w-4 h-4" />
                                <span>Keyboard shortcuts</span>
                            </div>
                            <span className="font-mono text-xs text-white/50 bg-white/10 px-1.5 rounded">?</span>
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
            case 'subtitleSize':
                return (
                    <div className="flex flex-col gap-1 min-w-[240px]">
                        <button
                            onClick={() => setSettingsTab('main')}
                            className="flex items-center gap-2 px-3 py-2 mb-2 rounded hover:bg-white/10 text-sm text-white/70 hover:text-white transition-colors border-b border-white/10"
                        >
                            <ChevronLeft className="w-4 h-4" />
                            <span>Subtitle size</span>
                        </button>
                        {SUBTITLE_SIZES.map(size => (
                            <button
                                key={size.value}
                                onClick={() => {
                                    setSubtitleSize(size.value)
                                    setStoredValue(STORAGE_KEYS.subtitleSize, size.value)
                                    setSettingsTab('main')
                                }}
                                className="flex items-center justify-between px-3 py-2 rounded hover:bg-white/10 text-sm text-white transition-colors"
                            >
                                <span>{size.label}</span>
                                {subtitleSize === size.value && <Check className="w-4 h-4 text-primary" />}
                            </button>
                        ))}
                    </div>
                )
        }
    }

    return (
        <div
            ref={containerRef}
            data-video-player
            data-subtitle-size={subtitleSize}
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
                    autoPlay={autoPlayEnabled}
                    src={videoSrc}
                    onError={() => {
                        const error = videoRef.current?.error
                        if (!error || !videoSrc) return
                        console.error('Video playback error:', error.code, error.message)
                        hideBufferingIndicator()
                        setPlaybackError(
                            playbackInfo?.mode === 'transcode'
                                ? 'Kino couldn’t convert this video for playback.'
                                : 'This video format isn’t supported.'
                        )
                    }}
                    onTimeUpdate={handleTimeUpdate}
                    onLoadedMetadata={handleLoadedMetadata}
                    onPlay={() => {
                        setIsPlaying(true)
                        hideBufferingIndicator()
                    }}
                    onPause={() => {
                        setIsPlaying(false)
                        hideBufferingIndicator()
                    }}
                    onEnded={() => {
                        setIsPlaying(false)
                        hideBufferingIndicator()
                    }}
                    onWaiting={() => {
                        if (isScrubbingRef.current || Date.now() < suppressBufferingUntilRef.current) {
                            return
                        }

                        clearBufferingTimeout()
                        bufferingTimeoutRef.current = setTimeout(() => {
                            if (isScrubbingRef.current) return
                            if (Date.now() < suppressBufferingUntilRef.current) return
                            setIsBuffering(true)
                        }, 200)
                    }}
                    onPlaying={() => {
                        pendingPlayIntentRef.current = null
                        hideBufferingIndicator()
                    }}
                    onCanPlay={() => {
                        // A stream that was meant to stay paused has loaded; normal state from here.
                        if (pendingPlayIntentRef.current === false) pendingPlayIntentRef.current = null
                    }}
                    onSeeked={() => {
                        // A short grace period prevents spinner flash on successful seeks.
                        suppressBufferingUntilRef.current = Date.now() + 150
                        hideBufferingIndicator()
                    }}
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
                            <div className="flex items-center gap-2 text-sm">
                                {movie.year && <span className="text-white/60">{movie.year}</span>}
                                {playbackInfo?.mode === 'transcode' && (
                                    <span
                                        className="px-1.5 py-0.5 rounded bg-white/10 text-white/60 text-[11px] font-medium"
                                        title={`${playbackInfo.reason ?? 'Unsupported format'} — converting while playing. Seeking far ahead takes a moment.`}
                                    >
                                        Converted
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Center Play/Pause Overlay removed per UX request */}

            {/* Click Feedback Animation */}
            {clickFeedback && (
                <div className="absolute inset-0 flex items-center justify-center z-20 pointer-events-none">
                    <div className="p-6 bg-black/40 rounded-full backdrop-blur-md animate-out fade-out zoom-out-75 fill-mode-forwards duration-500">
                        {clickFeedback === 'play' && <Play className="w-12 h-12 text-white fill-white" />}
                        {clickFeedback === 'pause' && <Pause className="w-12 h-12 text-white fill-white" />}
                        {clickFeedback === 'forward' && <SkipForward className="w-12 h-12 text-white fill-white" />}
                        {clickFeedback === 'rewind' && <SkipBack className="w-12 h-12 text-white fill-white" />}
                    </div>
                </div>
            )}

            {/* Volume OSD (keyboard volume changes) */}
            {showVolumeOsd && (
                <div className="absolute top-24 left-1/2 -translate-x-1/2 z-30 pointer-events-none animate-in fade-in duration-150">
                    <div className="flex items-center gap-3 px-4 py-2.5 rounded-full bg-black/70 backdrop-blur-md border border-white/10">
                        {isMuted || volume === 0 ? <VolumeX className="w-5 h-5 text-white" /> : <Volume2 className="w-5 h-5 text-white" />}
                        <div className="w-32 h-1 rounded-full bg-white/20 overflow-hidden">
                            <div className="h-full bg-white transition-[width] duration-150" style={{ width: `${(isMuted ? 0 : volume) * 100}%` }} />
                        </div>
                        <span className="w-9 text-right text-sm font-medium tabular-nums text-white">
                            {Math.round((isMuted ? 0 : volume) * 100)}
                        </span>
                    </div>
                </div>
            )}

            {/* Keyboard Shortcuts Overlay */}
            {showShortcuts && (
                <div
                    className="absolute inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-150"
                    onClick={() => setShowShortcuts(false)}
                >
                    <div
                        className="w-full max-w-lg mx-6 bg-surface/95 border border-white/10 rounded-2xl p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-150"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-center justify-between mb-5">
                            <h3 className="text-lg font-semibold text-white">Keyboard shortcuts</h3>
                            <button
                                onClick={() => setShowShortcuts(false)}
                                className="p-1.5 rounded-lg text-white/60 hover:text-white hover:bg-white/10 transition-colors"
                                aria-label="Close shortcuts"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2.5">
                            {SHORTCUTS.map(shortcut => (
                                <div key={shortcut.label} className="flex items-center justify-between gap-4 text-sm">
                                    <span className="text-white/70">{shortcut.label}</span>
                                    <span className="flex gap-1">
                                        {shortcut.keys.map(key => (
                                            <kbd key={key} className="min-w-[1.75rem] text-center font-sans text-xs text-white bg-white/10 border border-white/10 rounded-md px-1.5 py-0.5">
                                                {key}
                                            </kbd>
                                        ))}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* Probing the file / waiting for the first frame of a converted stream */}
            {!videoSrc && !playbackError && (
                <div className="absolute inset-0 flex items-center justify-center z-20 pointer-events-none">
                    <div className="animate-spin rounded-full h-16 w-16 border-t-4 border-b-4 border-primary"></div>
                </div>
            )}

            {/* Playback Error */}
            {playbackError && (
                <div className="absolute inset-0 flex items-center justify-center z-30 pointer-events-none">
                    <div className="max-w-md mx-6 text-center pointer-events-auto">
                        <p className="text-xl font-semibold text-white">{playbackError}</p>
                        <p className="mt-2 text-sm text-white/60 break-all">{movie.file_path}</p>
                        <button
                            onClick={onClose}
                            className="mt-6 px-5 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-white font-medium border border-white/10 transition-colors"
                        >
                            Close
                        </button>
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
                        value={isScrubbing ? (pendingSeekTimeRef.current ?? currentTime) : currentTime}
                        onChange={handleSeek}
                        onPointerDown={beginScrubSeek}
                        onPointerUp={commitScrubSeek}
                        onPointerCancel={commitScrubSeek}
                        onMouseDown={beginScrubSeek}
                        onMouseUp={commitScrubSeek}
                        onTouchStart={beginScrubSeek}
                        onTouchEnd={commitScrubSeek}
                        onBlur={commitScrubSeek}
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

                        {isPictureInPictureSupported && (
                            <button
                                onClick={togglePictureInPicture}
                                className={`transition-colors ${isPictureInPicture ? 'text-primary' : 'text-white/70 hover:text-white'}`}
                                title="Picture in Picture (I)"
                            >
                                <PictureInPicture2 className="w-6 h-6" />
                            </button>
                        )}

                        <button onClick={toggleFullscreen} className="text-white/70 hover:text-white transition-colors">
                            {isFullscreen ? <Minimize className="w-6 h-6" /> : <Maximize className="w-6 h-6" />}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )
}

import { isAudioCodecSupported, probeMedia } from './media'
import { SubtitleTrackInfo, listSubtitleTracks } from './subtitles'

export interface AudioTrackInfo {
    /** ffprobe stream index. */
    index: number
    language: string
    label: string
    codec: string
    channels: number
    isDefault: boolean
    /** The player can decode this codec itself; other tracks are converted to AAC while playing. */
    supported: boolean
}

export interface MediaMetadata {
    audioTracks: AudioTrackInfo[]
    subtitleTracks: SubtitleTrackInfo[]
}

/** The audio and subtitle tracks the player offers for a file. */
export async function getMediaMetadata(filePath: string): Promise<MediaMetadata> {
    const [data, subtitleTracks] = await Promise.all([probeMedia(filePath), listSubtitleTracks(filePath)])
    const audioTracks = data.streams
        .filter(s => s.codec_type === 'audio')
        .map((s, i) => ({
            index: s.index,
            language: s.tags?.language || 'und',
            label: s.tags?.title || `Audio ${i + 1}`,
            codec: s.codec_name || 'unknown',
            channels: s.channels || 2,
            isDefault: s.disposition?.default === 1,
            supported: isAudioCodecSupported(s.codec_name || ''),
        }))
    return { audioTracks, subtitleTracks }
}

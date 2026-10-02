// Asks Chromium which optional codecs it can decode on this machine, so the main process only
// converts what really needs it (electron/lib/media.ts keeps a baseline that works everywhere).
// HEVC, for example, decodes on macOS and on many Windows GPUs, but never on Linux.

const PROBES = {
    hevc: 'video/mp4; codecs="hvc1.1.6.L120.90"',
    hevc10: 'video/mp4; codecs="hvc1.2.4.L120.90"',
    h264_10bit: 'video/mp4; codecs="avc1.6E0028"',
    ac3: 'audio/mp4; codecs="ac-3"',
    eac3: 'audio/mp4; codecs="ec-3"',
    dts: 'audio/mp4; codecs="dtsc"',
}

export type DecoderSupport = Record<keyof typeof PROBES, boolean>

export function detectDecoderSupport(): DecoderSupport {
    const video = document.createElement('video')
    const canDecode = (type: string) => typeof MediaSource !== 'undefined'
        ? MediaSource.isTypeSupported(type)
        : video.canPlayType(type) !== ''
    return Object.fromEntries(Object.entries(PROBES).map(([key, type]) => [key, canDecode(type)])) as DecoderSupport
}

/** Report this machine's decoder support to the main process; call once at startup. */
export function reportDecoderSupport() {
    void window.ipcRenderer.invoke('media:set-decoder-support', detectDecoderSupport())
        .catch((err: unknown) => console.error('Failed to report decoder support:', err))
}

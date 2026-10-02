/// <reference types="vite/client" />

declare const __APP_VERSION__: string

// hls.js ships no types for its light build (no subtitles/alt-audio/DRM); it has the same API.
declare module 'hls.js/light' {
    export * from 'hls.js'
    export { default } from 'hls.js'
}

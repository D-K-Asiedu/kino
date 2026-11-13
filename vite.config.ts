import { defineConfig } from 'vite'
import path from 'node:path'
import { readFileSync } from 'node:fs'
import electron from 'vite-plugin-electron/simple'
import react from '@vitejs/plugin-react'

const pkg = JSON.parse(readFileSync(path.join(__dirname, 'package.json'), 'utf-8')) as { version: string }

// https://vitejs.dev/config/
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  // The styled-subtitle renderer (jassub) runs libass in a module worker that imports its WebAssembly glue.
  worker: {
    format: 'es',
  },
  // It finds its worker, WebAssembly and default font relative to its own file, which the dev
  // server's dependency pre-bundling would move; its CommonJS dependencies still need pre-bundling.
  optimizeDeps: {
    exclude: ['jassub'],
    include: ['jassub > rvfc-polyfill', 'jassub > throughput'],
  },
  plugins: [
    react(),
    electron({
      main: {
        // Shortcut of `build.lib.entry`.
        entry: 'electron/main.ts',
        vite: {
          build: {
            rollupOptions: {
              external: ['better-sqlite3', 'ffmpeg-static', 'ffprobe-static', 'fluent-ffmpeg'],
            },
          },
        },
      },
      preload: {
        // Shortcut of `build.rollupOptions.input`.
        // Preload scripts may contain Web assets, so use the `build.rollupOptions.input` instead `build.lib.entry`.
        input: path.join(__dirname, 'electron/preload.ts'),
      },
      // Ployfill the Electron and Node.js API for Renderer process.
      // If you want use Node.js in Renderer process, the `nodeIntegration` needs to be enabled in the Main process.
      // See 👉 https://github.com/electron-vite/vite-plugin-electron-renderer
      renderer: process.env.NODE_ENV === 'test'
        // https://github.com/electron-vite/vite-plugin-electron-renderer/issues/78#issuecomment-2053600808
        ? undefined
        : {},
    }),
  ],
})

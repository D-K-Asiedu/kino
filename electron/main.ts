import { app, BrowserWindow, protocol } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import { initDB } from './lib/database'
import { registerIPC } from './lib/ipc'
import { startWatcher } from './lib/watcher'
import { generateDefaultPlaylists } from './lib/playlists'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

process.env.APP_ROOT = path.join(__dirname, '..')

export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

// Register the scheme as privileged
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'media',
    privileges: {
      secure: true,
      supportFetchAPI: true,
      bypassCSP: true,
      stream: true
    }
  }
])

// Enable experimental features for audio/video tracks
app.commandLine.appendSwitch('enable-experimental-web-platform-features')

let win: BrowserWindow | null

function createWindow() {
  win = new BrowserWindow({
    icon: path.join(process.env.VITE_PUBLIC, 'electron-vite.svg'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
    },
  })

  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('main-process-message', (new Date).toLocaleString())
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
    win = null
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

app.whenReady().then(async () => {
  // Register protocol handler
  protocol.handle('media', async (request) => {
    const url = request.url.replace('media://', '')
    const filePath = decodeURIComponent(url)

    console.log('Media request:', { url, filePath })

    try {
      const stats = await fs.promises.stat(filePath)
      const fileSize = stats.size
      const range = request.headers.get('Range')

      const getMimeType = (filename: string) => {
        const ext = path.extname(filename).toLowerCase()
        switch (ext) {
          case '.mp4': return 'video/mp4'
          case '.mkv': return 'video/x-matroska'
          case '.webm': return 'video/webm'
          case '.avi': return 'video/x-msvideo'
          case '.mov': return 'video/quicktime'
          case '.vtt': return 'text/vtt'
          default: return 'application/octet-stream'
        }
      }

      const mimeType = getMimeType(filePath)

      if (range) {
        const parts = range.replace(/bytes=/, "").split("-")
        const start = parseInt(parts[0], 10)
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1
        const chunksize = (end - start) + 1

        const stream = fs.createReadStream(filePath, { start, end })

        return new Response(stream as any, {
          status: 206,
          headers: {
            'Content-Range': `bytes ${start}-${end}/${fileSize}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': chunksize.toString(),
            'Content-Type': mimeType,
          }
        })
      } else {
        const stream = fs.createReadStream(filePath)
        return new Response(stream as any, {
          status: 200,
          headers: {
            'Content-Length': fileSize.toString(),
            'Content-Type': mimeType,
          }
        })
      }
    } catch (error) {
      console.error('Error serving media:', error)
      return new Response('Not Found', { status: 404 })
    }
  })

  initDB()
  console.log('Database initialized')

  registerIPC()
  startWatcher()
  generateDefaultPlaylists()
  createWindow()
})

import { app, BrowserWindow, protocol, dialog } from 'electron'
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

// Setup logging to file for debugging production issues
const logPath = app.isPackaged 
  ? path.join(app.getPath('userData'), 'kino-debug.log')
  : path.join(__dirname, '..', 'kino-debug.log')

function writeLog(level: string, message: string, error?: Error) {
  const timestamp = new Date().toISOString()
  const logMessage = `[${timestamp}] [${level}] ${message}${error ? `\n${error.stack}` : ''}\n`
  
  try {
    fs.appendFileSync(logPath, logMessage)
  } catch {
    // Fallback to console if file write fails
    console.log(logMessage)
  }
  
  // Also log to console for dev mode
  if (!app.isPackaged) {
    console.log(logMessage)
  }
}

// Global error handlers
process.on('uncaughtException', (error) => {
  writeLog('ERROR', 'Uncaught Exception:', error)
  dialog.showErrorBox('Kino - Fatal Error', `An unexpected error occurred:\n\n${error.message}\n\nCheck logs at: ${logPath}`)
  app.quit()
})

process.on('unhandledRejection', (reason, promise) => {
  writeLog('ERROR', `Unhandled Rejection at: ${promise}, reason: ${reason}`)
})

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
  writeLog('INFO', 'App ready, starting initialization...')
  
  try {
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
    writeLog('INFO', 'Media protocol handler registered')

    try {
      initDB()
      writeLog('INFO', 'Database initialized successfully')
    } catch (dbError) {
      writeLog('ERROR', 'Database initialization failed:', dbError as Error)
      throw dbError
    }

    try {
      registerIPC()
      writeLog('INFO', 'IPC handlers registered')
    } catch (ipcError) {
      writeLog('ERROR', 'IPC registration failed:', ipcError as Error)
      throw ipcError
    }

    try {
      startWatcher()
      writeLog('INFO', 'File watcher started')
    } catch (watcherError) {
      writeLog('ERROR', 'Watcher start failed:', watcherError as Error)
      // Non-critical, continue
    }

    try {
      generateDefaultPlaylists()
      writeLog('INFO', 'Default playlists generated')
    } catch (playlistError) {
      writeLog('ERROR', 'Playlist generation failed:', playlistError as Error)
      // Non-critical, continue
    }

    createWindow()
    writeLog('INFO', 'Main window created')
    
  } catch (error) {
    writeLog('ERROR', 'Fatal error during app initialization:', error as Error)
    dialog.showErrorBox('Kino - Startup Error', `Failed to start Kino:\n\n${(error as Error).message}\n\nCheck logs at: ${logPath}`)
    app.quit()
  }
})

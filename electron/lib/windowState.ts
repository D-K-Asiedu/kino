import { app, BrowserWindow, Rectangle, screen } from 'electron'
import fs from 'fs'
import path from 'path'

// Small enough for a laptop, big enough that the sidebar and video grid don't break.
const MIN_WIDTH = 960
const MIN_HEIGHT = 600
// First launch: this size, or 85% of the screen if that's smaller.
const DEFAULT_WIDTH = 1440
const DEFAULT_HEIGHT = 900
const DEFAULT_SCREEN_FRACTION = 0.85
// A saved position is only reused if at least this much of the window lands on a screen.
const MIN_VISIBLE_WIDTH = 200
const MIN_VISIBLE_HEIGHT = 100

interface SavedState {
    x: number
    y: number
    width: number
    height: number
    maximized: boolean
}

const statePath = () => path.join(app.getPath('userData'), 'window-state.json')

const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

function readState(): Partial<SavedState> {
    try {
        const parsed = JSON.parse(fs.readFileSync(statePath(), 'utf8'))
        return parsed && typeof parsed === 'object' ? parsed : {}
    } catch {
        return {}
    }
}

function visibleArea(a: Rectangle, b: Rectangle) {
    const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
    const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
    return { width: Math.max(0, width), height: Math.max(0, height) }
}

/**
 * Size and position for the main window: last session's, if they still fit a connected screen,
 * otherwise a centred default. A window last seen on a monitor that's been unplugged comes back
 * on the primary screen.
 */
export function initialWindowState() {
    const saved = readState()
    const hasSize = isNumber(saved.width) && isNumber(saved.height) && saved.width > 0 && saved.height > 0
    const hasPosition = hasSize && isNumber(saved.x) && isNumber(saved.y)
    const savedBounds = hasPosition ? { x: saved.x!, y: saved.y!, width: saved.width!, height: saved.height! } : null

    let area = screen.getPrimaryDisplay().workArea
    if (savedBounds) {
        const matching = screen.getDisplayMatching(savedBounds).workArea
        const visible = visibleArea(savedBounds, matching)
        if (visible.width >= MIN_VISIBLE_WIDTH && visible.height >= MIN_VISIBLE_HEIGHT) area = matching
    }

    const minWidth = Math.min(MIN_WIDTH, area.width)
    const minHeight = Math.min(MIN_HEIGHT, area.height)
    const width = Math.max(minWidth, Math.min(
        hasSize ? saved.width! : Math.min(DEFAULT_WIDTH, Math.round(area.width * DEFAULT_SCREEN_FRACTION)),
        area.width
    ))
    const height = Math.max(minHeight, Math.min(
        hasSize ? saved.height! : Math.min(DEFAULT_HEIGHT, Math.round(area.height * DEFAULT_SCREEN_FRACTION)),
        area.height
    ))

    let bounds: Rectangle = {
        x: Math.round(area.x + (area.width - width) / 2),
        y: Math.round(area.y + (area.height - height) / 2),
        width,
        height,
    }
    if (savedBounds) {
        const candidate = { x: savedBounds.x, y: savedBounds.y, width, height }
        const visible = visibleArea(candidate, area)
        // The title bar must be reachable, or the window can't be dragged back.
        const titleBarOnScreen = candidate.y >= area.y && candidate.y < area.y + area.height - MIN_VISIBLE_HEIGHT
        if (visible.width >= MIN_VISIBLE_WIDTH && visible.height >= MIN_VISIBLE_HEIGHT && titleBarOnScreen) {
            bounds = candidate
        }
    }

    return { bounds, minWidth, minHeight, maximized: saved.maximized === true }
}

/** Save the window's size, position and maximized state as they change, for the next launch. */
export function trackWindowState(win: BrowserWindow, initial: { bounds: Rectangle; maximized: boolean }) {
    // Bounds are only taken while the window is in its normal state, so un-maximizing next session
    // returns to the size the user chose rather than the full screen.
    let normalBounds = initial.bounds
    let maximized = initial.maximized
    let timer: ReturnType<typeof setTimeout> | null = null

    const capture = () => {
        if (win.isDestroyed() || win.isFullScreen() || win.isMinimized()) return
        maximized = win.isMaximized()
        if (!maximized) normalBounds = win.getBounds()
    }
    const snapshot = (): SavedState => ({ ...normalBounds, maximized })

    const scheduleSave = () => {
        capture()
        if (timer) clearTimeout(timer)
        // Written as it changes too, so a crash doesn't lose it.
        timer = setTimeout(() => {
            timer = null
            void fs.promises.writeFile(statePath(), JSON.stringify(snapshot())).catch(() => undefined)
        }, 500)
    }

    win.on('resize', scheduleSave)
    win.on('move', scheduleSave)
    win.on('maximize', scheduleSave)
    win.on('unmaximize', scheduleSave)
    const saveNow = () => {
        if (timer) clearTimeout(timer)
        timer = null
        try {
            fs.writeFileSync(statePath(), JSON.stringify(snapshot()))
        } catch {
            // Not worth interrupting a close over; the next launch falls back to the default.
        }
    }
    win.on('close', () => {
        capture()
        saveNow()
    })
    // Some ways of closing skip 'close'; the window can't be queried by now, so this saves the last
    // state captured.
    win.on('closed', saveNow)
}

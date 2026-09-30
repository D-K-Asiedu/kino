import { useEffect } from 'react'
import { HashRouter, Routes, Route, useNavigate } from 'react-router-dom'
import { Sidebar } from './components/Sidebar'
import { FeedbackProvider } from './components/Feedback'
import { Home } from './pages/Home'
import { Library } from './pages/Library'
import { Settings } from './pages/Settings'
import { PlaylistPage } from './pages/PlaylistPage'
import { Playlists } from './pages/Playlists'
import { SecureFolder } from './pages/SecureFolder'

function isTypingTarget(target: EventTarget | null) {
    if (!(target instanceof HTMLElement)) return false
    return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

/** Ctrl/Cmd+K or "/" jumps to the library search from anywhere (except while a video is open). */
function GlobalShortcuts() {
    const navigate = useNavigate()

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (document.querySelector('[data-video-player]')) return
            const isSearchCombo = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k'
            const isSlash = e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && !isTypingTarget(e.target)
            if (!isSearchCombo && !isSlash) return
            e.preventDefault()
            navigate('/library', { state: { focusSearch: Date.now() } })
        }
        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [navigate])

    return null
}

function App() {
    return (
        <HashRouter>
            <FeedbackProvider>
                <GlobalShortcuts />
                <div className="flex h-screen bg-background text-text overflow-hidden">
                    <Sidebar />
                    <main id="app-scroll-root" className="flex-1 overflow-y-auto relative">
                        <Routes>
                            <Route path="/" element={<Home />} />
                            <Route path="/library" element={<Library />} />
                            <Route path="/playlists" element={<Playlists />} />
                            <Route path="/playlists/:id" element={<PlaylistPage />} />
                            <Route path="/settings" element={<Settings />} />
                            <Route path="/secure" element={<SecureFolder />} />
                        </Routes>
                    </main>
                </div>
            </FeedbackProvider>
        </HashRouter>
    )
}

export default App

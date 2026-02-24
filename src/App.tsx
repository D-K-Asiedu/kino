import { HashRouter, Routes, Route } from 'react-router-dom'
import { Sidebar } from './components/Sidebar'
import { Home } from './pages/Home'
import { Library } from './pages/Library'
import { Settings } from './pages/Settings'
import { PlaylistPage } from './pages/PlaylistPage'
import { SecureFolder } from './pages/SecureFolder'

function App() {
    return (
        <HashRouter>
            <div className="flex h-screen bg-background text-text overflow-hidden">
                <Sidebar />
                <main id="app-scroll-root" className="flex-1 overflow-y-auto relative">
                    <Routes>
                        <Route path="/" element={<Home />} />
                        <Route path="/library" element={<Library />} />
                        <Route path="/playlists/:id" element={<PlaylistPage />} />
                        <Route path="/settings" element={<Settings />} />
                        <Route path="/secure" element={<SecureFolder />} />
                    </Routes>
                </main>
            </div>
        </HashRouter>
    )
}

export default App

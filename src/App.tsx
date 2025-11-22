import { HashRouter, Routes, Route } from 'react-router-dom'
import { Sidebar } from './components/Sidebar'
import { Library } from './pages/Library'
import { Settings } from './pages/Settings'
import { PlaylistPage } from './pages/PlaylistPage'

function App() {
    return (
        <HashRouter>
            <div className="flex h-screen bg-background text-text overflow-hidden">
                <Sidebar />
                <main className="flex-1 overflow-y-auto relative">
                    <Routes>
                        <Route path="/" element={<Library />} />
                        <Route path="/playlists/:id" element={<PlaylistPage />} />
                        <Route path="/settings" element={<Settings />} />
                    </Routes>
                </main>
            </div>
        </HashRouter>
    )
}

export default App

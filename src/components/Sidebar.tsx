import { Link, useLocation } from 'react-router-dom'
import { Film, Settings, ListVideo, Lock, Home, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { useCallback, useEffect, useState } from 'react'

const COLLAPSED_STORAGE_KEY = 'kino_sidebar_collapsed'

function readCollapsed() {
    try {
        return window.localStorage.getItem(COLLAPSED_STORAGE_KEY) === '1'
    } catch {
        return false
    }
}

const navItems = [
    { path: '/', label: 'Home', icon: Home },
    { path: '/library', label: 'Library', icon: Film },
    { path: '/playlists', label: 'Playlists', icon: ListVideo },
    { path: '/settings', label: 'Settings', icon: Settings },
]

function isNavItemActive(itemPath: string, pathname: string) {
    if (itemPath === '/') return pathname === '/'
    // Nested routes (e.g. /playlists/3) keep their section highlighted
    return pathname === itemPath || pathname.startsWith(`${itemPath}/`)
}

export function Sidebar() {
    const location = useLocation()
    const [collapsed, setCollapsed] = useState(readCollapsed)

    const toggleCollapsed = useCallback(() => {
        setCollapsed(prev => {
            const next = !prev
            try {
                window.localStorage.setItem(COLLAPSED_STORAGE_KEY, next ? '1' : '0')
            } catch {
                // Storage unavailable; the preference just won't persist.
            }
            return next
        })
    }, [])

    // Ctrl/Cmd+B toggles the sidebar
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b' && !document.querySelector('[data-video-player]')) {
                e.preventDefault()
                toggleCollapsed()
            }
        }
        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [toggleCollapsed])

    return (
        <div
            className={clsx(
                'h-full flex flex-col flex-shrink-0 bg-surface/90 backdrop-blur-2xl border-r border-white/5 relative z-40 transition-[width] duration-200',
                collapsed ? 'w-[72px]' : 'w-64'
            )}
        >
            {/* Wordmark */}
            <div className={clsx('flex items-center h-20 mb-1', collapsed ? 'justify-center' : 'justify-between pl-6 pr-3')}>
                {!collapsed && (
                    <Link to="/" className="rounded-md" aria-label="Kino home">
                        <span className="text-[28px] font-semibold tracking-tight text-white leading-none">
                            kino<span className="text-primary">.</span>
                        </span>
                    </Link>
                )}
                <button
                    onClick={toggleCollapsed}
                    className="p-2 rounded-lg text-textMuted hover:text-white hover:bg-white/5 transition-colors"
                    title={collapsed ? 'Expand sidebar (Ctrl+B)' : 'Collapse sidebar (Ctrl+B)'}
                    aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                >
                    {collapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
                </button>
            </div>

            <nav className="flex-1 px-3 py-2 overflow-y-auto overflow-x-hidden no-scrollbar">
                <div className="space-y-1">
                    {!collapsed && (
                        <p className="px-3 text-[11px] font-semibold text-textMuted/60 uppercase tracking-widest mb-2">Menu</p>
                    )}
                    {navItems.map((item) => {
                        const isActive = isNavItemActive(item.path, location.pathname)
                        const Icon = item.icon

                        return (
                            <Link
                                key={item.path}
                                to={item.path}
                                title={collapsed ? item.label : undefined}
                                aria-current={isActive ? 'page' : undefined}
                                className={twMerge(
                                    clsx(
                                        'flex items-center gap-3 px-3 py-2 rounded-lg transition-all duration-200 group relative overflow-hidden',
                                        collapsed && 'justify-center',
                                        isActive
                                            ? 'bg-white/10 text-white shadow-sm ring-1 ring-white/5'
                                            : 'text-textMuted hover:bg-white/5 hover:text-white'
                                    )
                                )}
                            >
                                {isActive && (
                                    <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-4 bg-primary rounded-r-full" />
                                )}
                                <Icon className={clsx('w-4 h-4 flex-shrink-0 transition-colors', isActive ? 'text-primary' : 'text-textMuted group-hover:text-white')} />
                                {!collapsed && <span className="font-medium text-sm">{item.label}</span>}
                            </Link>
                        )
                    })}
                </div>
            </nav>

            {/* Footer */}
            <div className="p-4 border-t border-white/5">
                <div className={clsx('flex items-center', collapsed ? 'flex-col gap-2' : 'justify-between')}>
                    <Link
                        to="/secure"
                        className="text-textMuted/40 hover:text-textMuted transition-colors p-1 rounded hover:bg-white/5"
                        title="Secure Folder"
                        aria-label="Secure Folder"
                    >
                        <Lock className="w-3.5 h-3.5" />
                    </Link>
                    {!collapsed && (
                        <p className="text-[10px] text-textMuted/30 font-medium hover:text-textMuted transition-colors cursor-default">
                            v{__APP_VERSION__}
                        </p>
                    )}
                </div>
            </div>
        </div>
    )
}

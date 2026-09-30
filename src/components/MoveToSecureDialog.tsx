import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Lock } from 'lucide-react'
import { Movie } from '../types'

type SecureMode = 'confirm' | 'create' | 'unlock'

interface MoveToSecureDialogProps {
    movie: Movie
    onClose: () => void
    onMoved: () => void
}

const COPY: Record<SecureMode, { title: string; body: string; action: string }> = {
    confirm: {
        title: 'Move to Secure Folder',
        body: 'This will encrypt the video and remove it from your library.',
        action: 'Move to Secure',
    },
    create: {
        title: 'Create Secure Password',
        body: 'This will encrypt the video and set up your vault.',
        action: 'Create & Move',
    },
    unlock: {
        title: 'Unlock Secure Folder',
        body: 'Enter your password to encrypt and move this video.',
        action: 'Move to Secure',
    },
}

const inputClass = 'w-full bg-black/30 text-white text-sm px-3 py-2.5 rounded-lg border border-white/10 focus:border-primary/50 focus:ring-1 focus:ring-primary/40 focus:outline-none'

export function MoveToSecureDialog({ movie, onClose, onMoved }: MoveToSecureDialogProps) {
    const [mode, setMode] = useState<SecureMode | null>(null)
    const [password, setPassword] = useState('')
    const [confirmPassword, setConfirmPassword] = useState('')
    const [error, setError] = useState<string | null>(null)
    const [busy, setBusy] = useState(false)

    useEffect(() => {
        let cancelled = false
        void window.ipcRenderer.invoke('secure:status').then((status: { isUnlocked: boolean; hasPassword: boolean }) => {
            if (cancelled) return
            setMode(status.isUnlocked ? 'confirm' : (status.hasPassword ? 'unlock' : 'create'))
        })
        return () => {
            cancelled = true
        }
    }, [])

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && !busy) {
                e.stopPropagation()
                onClose()
            }
        }
        window.addEventListener('keydown', handleKeyDown, true)
        return () => window.removeEventListener('keydown', handleKeyDown, true)
    }, [busy, onClose])

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (busy || !mode) return
        setError(null)

        if (mode === 'create') {
            if (password.length < 6) {
                setError('Password must be at least 6 characters.')
                return
            }
            if (password !== confirmPassword) {
                setError('Passwords do not match.')
                return
            }
        } else if (mode === 'unlock' && !password) {
            setError('Password is required.')
            return
        }

        try {
            setBusy(true)
            if (mode === 'confirm') {
                await window.ipcRenderer.invoke('secure:import-movie', movie)
            } else {
                await window.ipcRenderer.invoke('secure:import-movie-with-password', movie, password)
            }
            onMoved()
        } catch (err) {
            setError((err as Error)?.message || 'Failed to move to Secure Folder.')
        } finally {
            setBusy(false)
        }
    }

    if (!mode) return null
    const copy = COPY[mode]

    return createPortal(
        <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm animate-in fade-in duration-150"
            onClick={() => !busy && onClose()}
        >
            <div
                role="dialog"
                aria-modal="true"
                className="w-full max-w-md mx-4 bg-surface border border-white/10 rounded-2xl p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-150"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center">
                        <Lock className="w-4 h-4 text-white/70" />
                    </div>
                    <div className="min-w-0">
                        <p className="text-white font-semibold">{copy.title}</p>
                        <p className="text-xs text-textMuted">{copy.body}</p>
                    </div>
                </div>

                <p className="mb-4 text-sm text-white/80 truncate">“{movie.title}”</p>

                {error && (
                    <div className="mb-3 text-xs text-red-200 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                        {error}
                    </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-3">
                    {mode !== 'confirm' && (
                        <>
                            <input
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder={mode === 'create' ? 'New password' : 'Password'}
                                className={inputClass}
                                autoFocus
                                disabled={busy}
                            />
                            {mode === 'create' && (
                                <input
                                    type="password"
                                    value={confirmPassword}
                                    onChange={(e) => setConfirmPassword(e.target.value)}
                                    placeholder="Confirm password"
                                    className={inputClass}
                                    disabled={busy}
                                />
                            )}
                        </>
                    )}
                    <div className="flex items-center justify-end gap-2 pt-2">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 rounded-lg text-sm font-medium text-white/80 hover:text-white hover:bg-white/10 transition-colors"
                            disabled={busy}
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            autoFocus={mode === 'confirm'}
                            className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                            disabled={busy}
                        >
                            {busy ? 'Encrypting…' : copy.action}
                        </button>
                    </div>
                </form>
            </div>
        </div>,
        document.body
    )
}

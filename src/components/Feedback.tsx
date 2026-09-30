import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react'

type ToastTone = 'success' | 'error' | 'info'

interface Toast {
    id: number
    message: string
    tone: ToastTone
}

interface ConfirmOptions {
    title: string
    message?: string
    confirmLabel?: string
    cancelLabel?: string
    destructive?: boolean
}

interface PendingConfirm extends ConfirmOptions {
    resolve: (value: boolean) => void
}

interface FeedbackContextValue {
    toast: (message: string, tone?: ToastTone) => void
    confirm: (options: ConfirmOptions) => Promise<boolean>
}

const FeedbackContext = createContext<FeedbackContextValue | null>(null)

const TOAST_DURATION_MS = 3500

export function FeedbackProvider({ children }: { children: React.ReactNode }) {
    const [toasts, setToasts] = useState<Toast[]>([])
    const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null)
    const nextIdRef = useRef(1)
    const pendingConfirmRef = useRef<PendingConfirm | null>(null)

    const dismissToast = useCallback((id: number) => {
        setToasts(prev => prev.filter(t => t.id !== id))
    }, [])

    const toast = useCallback((message: string, tone: ToastTone = 'success') => {
        const id = nextIdRef.current++
        setToasts(prev => [...prev.slice(-3), { id, message, tone }])
        window.setTimeout(() => dismissToast(id), TOAST_DURATION_MS)
    }, [dismissToast])

    const confirm = useCallback((options: ConfirmOptions) => {
        return new Promise<boolean>((resolve) => {
            // A new request supersedes any dialog still open.
            pendingConfirmRef.current?.resolve(false)
            const pending = { ...options, resolve }
            pendingConfirmRef.current = pending
            setPendingConfirm(pending)
        })
    }, [])

    const settleConfirm = useCallback((value: boolean) => {
        pendingConfirmRef.current?.resolve(value)
        pendingConfirmRef.current = null
        setPendingConfirm(null)
    }, [])

    return (
        <FeedbackContext.Provider value={{ toast, confirm }}>
            {children}
            {pendingConfirm && <ConfirmDialog options={pendingConfirm} onSettle={settleConfirm} />}
            {createPortal(
                <div className="fixed bottom-6 right-6 z-[110] flex flex-col gap-2 pointer-events-none" aria-live="polite">
                    {toasts.map(t => (
                        <ToastItem key={t.id} toast={t} onDismiss={() => dismissToast(t.id)} />
                    ))}
                </div>,
                document.body
            )}
        </FeedbackContext.Provider>
    )
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
    const Icon = toast.tone === 'error' ? XCircle : toast.tone === 'info' ? Info : CheckCircle2
    const iconColor = toast.tone === 'error' ? 'text-red-400' : 'text-primary'

    return (
        <div className="pointer-events-auto flex items-center gap-3 min-w-[260px] max-w-sm pl-4 pr-2 py-3 rounded-xl bg-surface/95 backdrop-blur-xl border border-white/10 shadow-2xl animate-in fade-in slide-in-from-bottom-2 duration-200">
            <Icon className={`w-4 h-4 flex-shrink-0 ${iconColor}`} />
            <p className="flex-1 text-sm text-white">{toast.message}</p>
            <button
                onClick={onDismiss}
                className="p-1 rounded-md text-textMuted hover:text-white hover:bg-white/10 transition-colors"
                aria-label="Dismiss"
            >
                <X className="w-3.5 h-3.5" />
            </button>
        </div>
    )
}

function ConfirmDialog({ options, onSettle }: { options: ConfirmOptions; onSettle: (value: boolean) => void }) {
    const cancelRef = useRef<HTMLButtonElement>(null)
    const confirmRef = useRef<HTMLButtonElement>(null)

    useEffect(() => {
        // Destructive actions default focus to Cancel so a stray Enter can't delete anything.
        const target = options.destructive ? cancelRef.current : confirmRef.current
        target?.focus()

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.preventDefault()
                e.stopPropagation()
                onSettle(false)
            }
        }
        window.addEventListener('keydown', handleKeyDown, true)
        return () => window.removeEventListener('keydown', handleKeyDown, true)
    }, [options.destructive, onSettle])

    return createPortal(
        <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm animate-in fade-in duration-150"
            onClick={() => onSettle(false)}
        >
            <div
                role="alertdialog"
                aria-modal="true"
                aria-labelledby="kino-confirm-title"
                className="w-full max-w-md mx-4 bg-surface border border-white/10 rounded-2xl p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-150"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-start gap-4">
                    {options.destructive && (
                        <div className="w-10 h-10 flex-shrink-0 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center">
                            <AlertTriangle className="w-4 h-4 text-red-400" />
                        </div>
                    )}
                    <div>
                        <h2 id="kino-confirm-title" className="text-lg font-semibold text-white">{options.title}</h2>
                        {options.message && <p className="mt-1 text-sm text-textMuted">{options.message}</p>}
                    </div>
                </div>
                <div className="flex justify-end gap-2 mt-6">
                    <button
                        ref={cancelRef}
                        onClick={() => onSettle(false)}
                        className="px-4 py-2 rounded-lg text-sm font-medium text-white/80 hover:text-white hover:bg-white/10 transition-colors"
                    >
                        {options.cancelLabel ?? 'Cancel'}
                    </button>
                    <button
                        ref={confirmRef}
                        onClick={() => onSettle(true)}
                        className={`px-4 py-2 rounded-lg text-sm font-semibold text-white transition-colors ${options.destructive ? 'bg-red-500 hover:bg-red-600' : 'bg-primary hover:bg-primary/90'}`}
                    >
                        {options.confirmLabel ?? 'Confirm'}
                    </button>
                </div>
            </div>
        </div>,
        document.body
    )
}

export function useFeedback() {
    const ctx = useContext(FeedbackContext)
    if (!ctx) throw new Error('useFeedback must be used inside <FeedbackProvider>')
    return ctx
}

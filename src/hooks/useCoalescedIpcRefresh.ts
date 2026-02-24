import { useCallback, useEffect, useMemo, useRef } from 'react'

interface UseCoalescedIpcRefreshOptions {
    delayMs?: number
}

export function useCoalescedIpcRefresh(
    task: () => Promise<void>,
    channels: string[],
    options?: UseCoalescedIpcRefreshOptions
) {
    const delayMs = options?.delayMs ?? 150
    const taskRef = useRef(task)
    const timerRef = useRef<number | null>(null)
    const inFlightRef = useRef(false)
    const rerunAfterFlightRef = useRef(false)
    const mountedRef = useRef(true)
    const channelsKey = useMemo(() => channels.join('\u0000'), [channels])

    useEffect(() => {
        taskRef.current = task
    }, [task])

    useEffect(() => {
        return () => {
            mountedRef.current = false
            if (timerRef.current !== null) {
                window.clearTimeout(timerRef.current)
                timerRef.current = null
            }
        }
    }, [])

    const runNow = useCallback(async () => {
        if (!mountedRef.current) return

        if (inFlightRef.current) {
            rerunAfterFlightRef.current = true
            return
        }

        inFlightRef.current = true
        try {
            await taskRef.current()
        } finally {
            inFlightRef.current = false
            if (rerunAfterFlightRef.current && mountedRef.current) {
                rerunAfterFlightRef.current = false
                void runNow()
            }
        }
    }, [])

    const scheduleRefresh = useCallback(() => {
        if (!mountedRef.current) return
        if (timerRef.current !== null) {
            window.clearTimeout(timerRef.current)
        }
        timerRef.current = window.setTimeout(() => {
            timerRef.current = null
            void runNow()
        }, delayMs)
    }, [delayMs, runNow])

    useEffect(() => {
        const eventChannels = channelsKey ? channelsKey.split('\u0000') : []
        if (eventChannels.length === 0) return

        const handleEvent = () => {
            scheduleRefresh()
        }

        for (const channel of eventChannels) {
            window.ipcRenderer.on(channel, handleEvent)
        }

        return () => {
            for (const channel of eventChannels) {
                window.ipcRenderer.off(channel, handleEvent)
            }
        }
    }, [channelsKey, scheduleRefresh])

    return {
        runNow,
        scheduleRefresh,
    }
}

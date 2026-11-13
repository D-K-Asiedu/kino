/** Whether a process with this id is running. Used to spot temp folders left by Kino runs that crashed. */
export function isProcessAlive(pid: number) {
    if (!Number.isInteger(pid) || pid <= 0) return false
    try {
        process.kill(pid, 0)
        return true
    } catch (err) {
        return (err as NodeJS.ErrnoException).code === 'EPERM'
    }
}

/** "1 h 5 min left", "42 min left", "<1 min left" */
export function formatTimeLeft(seconds: number) {
    const totalMinutes = Math.round(Math.max(0, seconds) / 60)
    if (totalMinutes < 1) return '<1 min left'
    const hours = Math.floor(totalMinutes / 60)
    const minutes = totalMinutes % 60
    if (hours === 0) return `${minutes} min left`
    return minutes === 0 ? `${hours} h left` : `${hours} h ${minutes} min left`
}

/** "1.4 GB", "530 MB" */
export function formatFileSize(bytes: number | null | undefined) {
    if (!bytes || bytes <= 0) return null
    const units = ['B', 'KB', 'MB', 'GB', 'TB']
    let value = bytes
    let unit = 0
    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024
        unit++
    }
    return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`
}

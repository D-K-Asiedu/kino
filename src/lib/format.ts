/** "1 h 5 min left", "42 min left", "<1 min left" */
export function formatTimeLeft(seconds: number) {
    const totalMinutes = Math.round(Math.max(0, seconds) / 60)
    if (totalMinutes < 1) return '<1 min left'
    const hours = Math.floor(totalMinutes / 60)
    const minutes = totalMinutes % 60
    if (hours === 0) return `${minutes} min left`
    return minutes === 0 ? `${hours} h left` : `${hours} h ${minutes} min left`
}

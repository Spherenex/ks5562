export function formatDelayMs(ms) {
  if (typeof ms !== 'number') {
    return null
  }
  return ms < 1000 ? `${Math.max(0, ms).toFixed(0)} ms` : `${(ms / 1000).toFixed(1)} s`
}

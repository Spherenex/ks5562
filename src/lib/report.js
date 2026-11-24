const CSV_COLUMNS = [
  { header: 'Date and time', get: (record) => (typeof record.startTime === 'number' ? new Date(record.startTime).toLocaleString() : '') },
  { header: 'Pole ID', get: (record) => record.poleId ?? record.section ?? '' },
  { header: 'Fault type', get: (record) => record.faultType ?? '' },
  { header: 'Voltage before fault (V)', get: (record) => record.voltageBefore ?? '' },
  { header: 'Voltage during fault (V)', get: (record) => record.voltageDuring ?? '' },
  { header: 'Voltage after fault (V)', get: (record) => record.voltageAfter ?? '' },
  { header: 'Current (A)', get: (record) => record.peakCurrent ?? record.currentDuring ?? '' },
  { header: 'Detection delay (ms)', get: (record) => record.detectionDelayMs ?? '' },
  { header: 'Relay action', get: (record) => record.relayAction ?? '' },
  { header: 'Restoration status', get: (record) => (record.clearTime ? record.restorationStatus ?? 'Restored' : 'Ongoing') },
]

function escapeCsvCell(value) {
  const text = String(value ?? '')
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function buildFaultHistoryCsv(events) {
  const headerRow = CSV_COLUMNS.map((column) => escapeCsvCell(column.header)).join(',')
  const rows = events.map((record) => CSV_COLUMNS.map((column) => escapeCsvCell(column.get(record))).join(','))
  return [headerRow, ...rows].join('\r\n')
}

export function downloadTextFile(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

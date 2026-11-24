import { formatDelayMs } from '../lib/format'

function formatDateTime(ms) {
  return typeof ms === 'number' ? new Date(ms).toLocaleString() : '—'
}

function formatVoltage(value) {
  return typeof value === 'number' ? `${value.toFixed(1)} V` : '—'
}

function formatCurrent(value) {
  return typeof value === 'number' ? `${value.toFixed(3)} A` : '—'
}

function formatDelay(ms) {
  return formatDelayMs(ms) ?? '—'
}

function formatDuration(startMs, clearMs) {
  if (typeof startMs !== 'number') {
    return '—'
  }
  if (typeof clearMs !== 'number') {
    return 'Ongoing'
  }
  const durationMs = clearMs - startMs
  return durationMs < 1000 ? `${durationMs.toFixed(0)} ms` : `${(durationMs / 1000).toFixed(1)} s`
}

function statusTone(record) {
  if (!record.clearTime) {
    return 'critical'
  }
  return record.restorationStatus?.startsWith('Restored') ? 'good' : 'warning'
}

function FaultHistoryTable({ events }) {
  if (events.length === 0) {
    return (
      <div className="fault-history__empty">
        <p>No fault events recorded yet. This table fills in automatically the first time a fault is detected and logs to Firebase.</p>
      </div>
    )
  }

  return (
    <div className="fault-history__scroll">
      <table className="fault-history">
        <thead>
          <tr>
            <th scope="col">Date &amp; time</th>
            <th scope="col">Section</th>
            <th scope="col">Fault type</th>
            <th scope="col">V before</th>
            <th scope="col">V during</th>
            <th scope="col">V after</th>
            <th scope="col">Current</th>
            <th scope="col">Detection delay</th>
            <th scope="col">Duration</th>
            <th scope="col">Relay action</th>
            <th scope="col">Restoration status</th>
          </tr>
        </thead>
        <tbody>
          {events.map((record) => (
            <tr key={record.id}>
              <td>{formatDateTime(record.startTime)}</td>
              <td>{record.section ?? record.poleId ?? '—'}</td>
              <td>{record.faultType ?? '—'}</td>
              <td>{formatVoltage(record.voltageBefore)}</td>
              <td>{formatVoltage(record.voltageDuring)}</td>
              <td>{formatVoltage(record.voltageAfter)}</td>
              <td>{formatCurrent(record.peakCurrent ?? record.currentDuring)}</td>
              <td>{formatDelay(record.detectionDelayMs)}</td>
              <td>{formatDuration(record.startTime, record.clearTime)}</td>
              <td>{record.relayAction ?? '—'}</td>
              <td>
                <span className={`fault-history__status fault-history__status--${statusTone(record)}`}>
                  {record.clearTime ? record.restorationStatus ?? 'Restored' : 'Ongoing'}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default FaultHistoryTable

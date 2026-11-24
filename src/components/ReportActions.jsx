import { buildFaultHistoryCsv, downloadTextFile } from '../lib/report'

function ReportActions({ events }) {
  function handleDownloadCsv() {
    const csv = buildFaultHistoryCsv(events)
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    downloadTextFile(`grid-fault-report-${stamp}.csv`, csv, 'text/csv;charset=utf-8')
  }

  function handlePrint() {
    window.print()
  }

  return (
    <div className="report-actions">
      <button
        type="button"
        className="report-actions__button report-actions__button--primary"
        onClick={handleDownloadCsv}
        disabled={events.length === 0}
      >
        Download CSV report
      </button>
      <button type="button" className="report-actions__button" onClick={handlePrint}>
        Print / save as PDF
      </button>
    </div>
  )
}

export default ReportActions

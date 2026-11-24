import { useState } from 'react'
import { buildStepPath, clampFraction } from '../lib/chartPaths'

const WIDTH = 420
const HEIGHT = 220
const MARGIN_LEFT = 48
const MARGIN_RIGHT = 18
const PLOT_TOP = 30
const PLOT_BOTTOM = HEIGHT - 34

function formatTime(value) {
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function FaultSignalChart({ history }) {
  const [hoverIndex, setHoverIndex] = useState(null)

  if (history.length < 2) {
    return (
      <div className="trend-card trend-card--empty">
        <p className="trend-card__label">Fault Detection Signal</p>
        <p className="trend-card__empty-text">Collecting live readings&hellip;</p>
      </div>
    )
  }

  const lastIndex = history.length - 1
  const times = history.map((sample) => sample.time)
  const xs = times.map((_, index) => MARGIN_LEFT + (index / lastIndex) * (WIDTH - MARGIN_LEFT - MARGIN_RIGHT))
  const states = history.map((sample) => Boolean(sample.faultStatus))
  const path = buildStepPath(states, xs, PLOT_TOP, PLOT_BOTTOM)
  const latest = states[lastIndex]

  function handlePointerMove(event) {
    const rect = event.currentTarget.getBoundingClientRect()
    const fraction = clampFraction((event.clientX - rect.left) / rect.width)
    setHoverIndex(Math.round(fraction * lastIndex))
  }

  function handlePointerLeave() {
    setHoverIndex(null)
  }

  const hoverX = hoverIndex === null ? null : xs[hoverIndex]
  const tooltipLeftPct = hoverIndex === null ? 0 : (hoverX / WIDTH) * 100

  return (
    <div className="trend-card">
      <div className="trend-card__head">
        <p className="trend-card__label">Fault Detection Signal</p>
        <p className="trend-card__value" style={{ color: latest ? 'var(--status-critical)' : 'var(--wave-power)' }}>
          {latest ? 'FAULT' : 'CLEAR'}
        </p>
      </div>

      <div className="trend-card__plot">
        <svg
          className="trend-card__svg"
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          preserveAspectRatio="none"
          onPointerMove={handlePointerMove}
          onPointerLeave={handlePointerLeave}
          role="img"
          aria-label={`Fault detection signal over the last ${history.length} polls, currently ${latest ? 'fault active' : 'clear'}`}
        >
          <line x1={MARGIN_LEFT} y1={PLOT_BOTTOM} x2={WIDTH - MARGIN_RIGHT} y2={PLOT_BOTTOM} className="trend-card__gridline-y" />
          <line x1={MARGIN_LEFT} y1={PLOT_TOP} x2={WIDTH - MARGIN_RIGHT} y2={PLOT_TOP} className="trend-card__gridline-y" />

          <text x={MARGIN_LEFT - 6} y={PLOT_TOP} className="trend-card__axis-label trend-card__axis-label--y">
            Fault
          </text>
          <text x={MARGIN_LEFT - 6} y={PLOT_BOTTOM} className="trend-card__axis-label trend-card__axis-label--y">
            Normal
          </text>

          <path d={path} className="trend-card__line" style={{ stroke: 'var(--status-critical)' }} />

          {hoverIndex === null ? null : <line x1={hoverX} y1={0} x2={hoverX} y2={HEIGHT} className="trend-card__crosshair" />}
        </svg>

        {hoverIndex === null ? null : (
          <div className="trend-card__tooltip" style={{ left: `${tooltipLeftPct}%` }}>
            <p className="trend-card__tooltip-value">{states[hoverIndex] ? 'Fault active' : 'Normal'}</p>
            <p className="trend-card__tooltip-time">{formatTime(times[hoverIndex])}</p>
          </div>
        )}
      </div>

      <p className="trend-card__caption">
        High = the device's Fault_Status flag is active, low = normal — the same signal that drives relay isolation.
      </p>
    </div>
  )
}

export default FaultSignalChart

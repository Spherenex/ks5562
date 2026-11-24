import { useState } from 'react'

const WIDTH = 760
const LANE_HEIGHT = 60
const LANE_GAP = 10
const MARGIN = 14

const LANES = [
  { key: 'relay1', label: 'Relay 1 (A-B)', colorVar: '--wave-voltage' },
  { key: 'relay2', label: 'Relay 2 (B-C)', colorVar: '--wave-current' },
  { key: 'relay3', label: 'Relay 3 (C-D)', colorVar: '--wave-power' },
  { key: 'relay4', label: 'Relay 4 (D-E)', colorVar: '--status-critical' },
]

function laneY(index) {
  return index * (LANE_HEIGHT + LANE_GAP)
}

function buildStepPath(states, xs, laneTop) {
  const highY = laneTop + MARGIN
  const lowY = laneTop + LANE_HEIGHT - MARGIN
  let d = ''
  let prevY = null

  states.forEach((isClosed, index) => {
    const y = isClosed ? highY : lowY
    const x = xs[index]

    if (index === 0) {
      d += `M${x},${y}`
    } else {
      d += ` L${x},${prevY} L${x},${y}`
    }
    prevY = y
  })

  return d
}

function clampIndex(value, max) {
  return Math.min(max, Math.max(0, value))
}

function RelayTimingChart({ history }) {
  const [hoverIndex, setHoverIndex] = useState(null)

  if (history.length < 2) {
    return (
      <div className="timing-chart timing-chart--empty">
        <p>Collecting relay history — the timeline fills in as each fifteen-second poll arrives.</p>
      </div>
    )
  }

  const lastIndex = history.length - 1
  const xs = history.map((_, index) => MARGIN + (index / lastIndex) * (WIDTH - MARGIN * 2))
  const height = laneY(LANES.length - 1) + LANE_HEIGHT

  function handlePointerMove(event) {
    const rect = event.currentTarget.getBoundingClientRect()
    const fraction = clampIndex((event.clientX - rect.left) / rect.width, 1)
    setHoverIndex(Math.round(fraction * lastIndex))
  }

  function handlePointerLeave() {
    setHoverIndex(null)
  }

  const active = hoverIndex === null ? null : history[hoverIndex]
  const crosshairX = hoverIndex === null ? null : xs[hoverIndex]
  const tooltipLeftPct = hoverIndex === null ? 0 : (crosshairX / WIDTH) * 100

  return (
    <div className="timing-chart">
      <div className="timing-chart__legend">
        {LANES.map((lane) => (
          <span className="timing-chart__legend-item" key={lane.key}>
            <span className="timing-chart__legend-key" style={{ background: `var(${lane.colorVar})` }} />
            {lane.label}
          </span>
        ))}
      </div>

      <div className="timing-chart__plot">
        <svg
          className="timing-chart__svg"
          viewBox={`0 0 ${WIDTH} ${height}`}
          preserveAspectRatio="none"
          onPointerMove={handlePointerMove}
          onPointerLeave={handlePointerLeave}
          role="img"
          aria-label="Relay state history for the last recorded polls"
        >
          {LANES.map((lane, laneIndex) => {
            const top = laneY(laneIndex)
            const states = history.map((sample) => Number(sample[lane.key]) === 1)
            return (
              <g key={lane.key}>
                <line
                  x1={MARGIN}
                  y1={top + LANE_HEIGHT - MARGIN}
                  x2={WIDTH - MARGIN}
                  y2={top + LANE_HEIGHT - MARGIN}
                  className="timing-chart__baseline"
                />
                <path
                  d={buildStepPath(states, xs, top)}
                  className="timing-chart__line"
                  style={{ stroke: `var(${lane.colorVar})` }}
                />
              </g>
            )
          })}

          {crosshairX !== null ? (
            <line x1={crosshairX} y1="0" x2={crosshairX} y2={height} className="timing-chart__crosshair" />
          ) : null}
        </svg>

        {active ? (
          <div className="timing-chart__tooltip" style={{ left: `${tooltipLeftPct}%` }}>
            <p className="timing-chart__tooltip-time">{new Date(active.time).toLocaleTimeString()}</p>
            {LANES.map((lane) => (
              <p className="timing-chart__tooltip-row" key={lane.key}>
                <span className="timing-chart__legend-key" style={{ background: `var(${lane.colorVar})` }} />
                {lane.label}
                <strong>{Number(active[lane.key]) === 1 ? 'Open' : 'Closed'}</strong>
              </p>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}

export default RelayTimingChart

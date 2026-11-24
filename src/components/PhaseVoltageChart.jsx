import { useState } from 'react'
import { buildAreaPath, buildSmoothPath, clampFraction } from '../lib/chartPaths'

const WIDTH = 420
const HEIGHT = 220
const MARGIN_LEFT = 48
const MARGIN_RIGHT = 18
const PLOT_TOP = 16
const PLOT_BOTTOM = HEIGHT - 34
const Y_TICK_COUNT = 4
const X_TICK_COUNT = 4

const PHASE_SERIES = [
  { key: 'a', label: 'Phase A', colorVar: '--wave-voltage' },
  { key: 'b', label: 'Phase B', colorVar: '--wave-current' },
  { key: 'c', label: 'Phase C', colorVar: '--wave-power' },
]
const SINGLE_SERIES = [{ key: null, label: 'Line Voltage', colorVar: '--wave-voltage' }]

function formatTime(value) {
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function readValue(sample, key) {
  const value = key ? sample.phaseVoltages?.[key] : sample.voltage
  return typeof value === 'number' ? value : null
}

// 3-phase voltage vs time, as specified — but the connected hardware currently
// publishes a single line-voltage reading, not per-phase A/B/C channels. This
// renders the real 3-phase lines the moment the firmware starts sending
// phaseVoltages, and otherwise falls back to the one honest channel we have.
function PhaseVoltageChart({ history }) {
  const [hoverIndex, setHoverIndex] = useState(null)

  const hasPhaseData = history.some((sample) => PHASE_SERIES.some((series) => typeof sample.phaseVoltages?.[series.key] === 'number'))
  const seriesDefs = hasPhaseData ? PHASE_SERIES : SINGLE_SERIES
  const title = hasPhaseData ? '3-Phase Voltage' : 'Line Voltage'

  if (history.length < 2) {
    return (
      <div className="trend-card trend-card--empty">
        <p className="trend-card__label">{title}</p>
        <p className="trend-card__empty-text">Collecting live readings&hellip;</p>
      </div>
    )
  }

  const lastIndex = history.length - 1
  const times = history.map((sample) => sample.time)
  const seriesValues = seriesDefs.map((series) => history.map((sample) => readValue(sample, series.key)))

  const allValues = seriesValues.flat().filter((value) => typeof value === 'number')
  const minValue = Math.min(...allValues)
  const maxValue = Math.max(...allValues)
  const span = maxValue - minValue || Math.max(Math.abs(maxValue), 1) * 0.1 || 1
  const paddedMin = minValue - span * 0.08
  const paddedMax = maxValue + span * 0.08
  const paddedSpan = paddedMax - paddedMin

  const xs = times.map((_, index) => MARGIN_LEFT + (index / lastIndex) * (WIDTH - MARGIN_LEFT - MARGIN_RIGHT))
  const yFor = (value) => PLOT_BOTTOM - ((value - paddedMin) / paddedSpan) * (PLOT_BOTTOM - PLOT_TOP)
  const seriesPoints = seriesValues.map((values) => values.map((value, index) => [xs[index], yFor(value ?? paddedMin)]))

  const yTicks = Array.from({ length: Y_TICK_COUNT + 1 }, (_, tickIndex) => ({
    key: tickIndex,
    value: paddedMax - (tickIndex / Y_TICK_COUNT) * paddedSpan,
    y: PLOT_TOP + (tickIndex / Y_TICK_COUNT) * (PLOT_BOTTOM - PLOT_TOP),
  }))

  const xTickIndices = [
    ...new Set(Array.from({ length: X_TICK_COUNT + 1 }, (_, tickIndex) => Math.round((tickIndex / X_TICK_COUNT) * lastIndex))),
  ]
  const xTicks = xTickIndices.map((index) => ({
    index,
    x: xs[index],
    anchor: index === 0 ? 'start' : index === lastIndex ? 'end' : 'middle',
  }))

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
        <p className="trend-card__label">{title}</p>
        {hasPhaseData ? (
          <div className="trend-card__legend">
            {seriesDefs.map((series, seriesIndex) => {
              const latest = seriesValues[seriesIndex][lastIndex]
              return (
                <span key={series.label} className="trend-card__legend-item">
                  <span className="trend-card__legend-dot" style={{ background: `var(${series.colorVar})` }} />
                  {typeof latest === 'number' ? latest.toFixed(1) : '—'}
                  <span className="trend-card__unit">V</span>
                </span>
              )
            })}
          </div>
        ) : (
          <p className="trend-card__value" style={{ color: `var(${seriesDefs[0].colorVar})` }}>
            {typeof seriesValues[0][lastIndex] === 'number' ? seriesValues[0][lastIndex].toFixed(1) : '—'}
            <span className="trend-card__unit">V</span>
          </p>
        )}
      </div>

      <div className="trend-card__plot">
        <svg
          className="trend-card__svg"
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          preserveAspectRatio="none"
          onPointerMove={handlePointerMove}
          onPointerLeave={handlePointerLeave}
          role="img"
          aria-label={`${title} trend over the last ${history.length} polls`}
        >
          {yTicks.map((tick) => (
            <line key={tick.key} x1={MARGIN_LEFT} y1={tick.y} x2={WIDTH - MARGIN_RIGHT} y2={tick.y} className="trend-card__gridline-y" />
          ))}
          {xTicks.map((tick) => (
            <line key={tick.index} x1={tick.x} y1={PLOT_TOP} x2={tick.x} y2={PLOT_BOTTOM} className="trend-card__gridline-x" />
          ))}

          {yTicks.map((tick) => (
            <text key={tick.key} x={MARGIN_LEFT - 6} y={tick.y} className="trend-card__axis-label trend-card__axis-label--y">
              {tick.value.toFixed(1)}
            </text>
          ))}
          {xTicks.map((tick) => (
            <text key={tick.index} x={tick.x} y={PLOT_BOTTOM + 14} textAnchor={tick.anchor} className="trend-card__axis-label trend-card__axis-label--x">
              {formatTime(times[tick.index])}
            </text>
          ))}

          {seriesDefs.length === 1 ? (
            <path d={buildAreaPath(seriesPoints[0], PLOT_BOTTOM)} className="trend-card__area" style={{ fill: `var(${seriesDefs[0].colorVar})` }} />
          ) : null}

          {seriesPoints.map((points, seriesIndex) => (
            <path
              key={seriesDefs[seriesIndex].label}
              d={buildSmoothPath(points)}
              className="trend-card__line"
              style={{ stroke: `var(${seriesDefs[seriesIndex].colorVar})` }}
            />
          ))}

          {hoverIndex === null ? null : (
            <>
              <line x1={hoverX} y1={PLOT_TOP} x2={hoverX} y2={PLOT_BOTTOM} className="trend-card__crosshair" />
              {seriesPoints.map((points, seriesIndex) => (
                <circle
                  key={seriesDefs[seriesIndex].label}
                  cx={points[hoverIndex][0]}
                  cy={points[hoverIndex][1]}
                  r="4"
                  className="trend-card__hover-dot"
                  style={{ fill: `var(${seriesDefs[seriesIndex].colorVar})` }}
                />
              ))}
            </>
          )}
        </svg>

        {hoverIndex === null ? null : (
          <div className="trend-card__tooltip" style={{ left: `${tooltipLeftPct}%` }}>
            {seriesDefs.map((series, seriesIndex) => (
              <p key={series.label} className="trend-card__tooltip-value">
                {series.label}: {typeof seriesValues[seriesIndex][hoverIndex] === 'number' ? seriesValues[seriesIndex][hoverIndex].toFixed(1) : '—'} V
              </p>
            ))}
            <p className="trend-card__tooltip-time">{new Date(times[hoverIndex]).toLocaleTimeString()}</p>
          </div>
        )}
      </div>

      <p className="trend-card__caption">
        {hasPhaseData
          ? 'Per-phase line voltage reported directly by the connected hardware.'
          : 'The connected hardware currently publishes one line-voltage channel — per-phase A/B/C telemetry will plot here automatically once the firmware reports it.'}
      </p>
    </div>
  )
}

export default PhaseVoltageChart

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

function formatValue(value, decimals) {
  return typeof value === 'number' ? value.toFixed(decimals) : '—'
}

function formatTime(value) {
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function TrendCard({ label, unit, decimals, colorVar, series, times, caption }) {
  const [hoverIndex, setHoverIndex] = useState(null)

  if (series.length < 2) {
    return (
      <div className="trend-card trend-card--empty">
        <p className="trend-card__label">{label}</p>
        <p className="trend-card__empty-text">Collecting live readings&hellip;</p>
      </div>
    )
  }

  const lastIndex = series.length - 1
  const minValue = Math.min(...series)
  const maxValue = Math.max(...series)
  const span = maxValue - minValue || Math.max(Math.abs(maxValue), 1) * 0.1 || 1
  const paddedMin = minValue - span * 0.08
  const paddedMax = maxValue + span * 0.08
  const paddedSpan = paddedMax - paddedMin

  const xs = series.map((_, index) => MARGIN_LEFT + (index / lastIndex) * (WIDTH - MARGIN_LEFT - MARGIN_RIGHT))
  const ys = series.map((value) => PLOT_BOTTOM - ((value - paddedMin) / paddedSpan) * (PLOT_BOTTOM - PLOT_TOP))
  const points = xs.map((x, index) => [x, ys[index]])

  const yTicks = Array.from({ length: Y_TICK_COUNT + 1 }, (_, tickIndex) => ({
    key: tickIndex,
    value: paddedMax - (tickIndex / Y_TICK_COUNT) * paddedSpan,
    y: PLOT_TOP + (tickIndex / Y_TICK_COUNT) * (PLOT_BOTTOM - PLOT_TOP),
  }))

  const xTickIndices = [...new Set(Array.from({ length: X_TICK_COUNT + 1 }, (_, tickIndex) => Math.round((tickIndex / X_TICK_COUNT) * lastIndex)))]
  const xTicks = xTickIndices.map((index) => ({
    index,
    x: xs[index],
    anchor: index === 0 ? 'start' : index === lastIndex ? 'end' : 'middle',
  }))

  const latest = series[lastIndex]

  function handlePointerMove(event) {
    const rect = event.currentTarget.getBoundingClientRect()
    const fraction = clampFraction((event.clientX - rect.left) / rect.width)
    setHoverIndex(Math.round(fraction * lastIndex))
  }

  function handlePointerLeave() {
    setHoverIndex(null)
  }

  const hoverX = hoverIndex === null ? null : xs[hoverIndex]
  const hoverY = hoverIndex === null ? null : ys[hoverIndex]
  const tooltipLeftPct = hoverIndex === null ? 0 : (hoverX / WIDTH) * 100

  return (
    <div className="trend-card">
      <div className="trend-card__head">
        <p className="trend-card__label">{label}</p>
        <p className="trend-card__value" style={{ color: `var(${colorVar})` }}>
          {formatValue(latest, decimals)}
          <span className="trend-card__unit">{unit}</span>
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
          aria-label={`${label} trend over the last ${series.length} polls, latest ${formatValue(latest, decimals)} ${unit}`}
        >
          {yTicks.map((tick) => (
            <line
              key={tick.key}
              x1={MARGIN_LEFT}
              y1={tick.y}
              x2={WIDTH - MARGIN_RIGHT}
              y2={tick.y}
              className="trend-card__gridline-y"
            />
          ))}
          {xTicks.map((tick) => (
            <line
              key={tick.index}
              x1={tick.x}
              y1={PLOT_TOP}
              x2={tick.x}
              y2={PLOT_BOTTOM}
              className="trend-card__gridline-x"
            />
          ))}

          {yTicks.map((tick) => (
            <text key={tick.key} x={MARGIN_LEFT - 6} y={tick.y} className="trend-card__axis-label trend-card__axis-label--y">
              {tick.value.toFixed(decimals)}
            </text>
          ))}
          {xTicks.map((tick) => (
            <text
              key={tick.index}
              x={tick.x}
              y={PLOT_BOTTOM + 14}
              textAnchor={tick.anchor}
              className="trend-card__axis-label trend-card__axis-label--x"
            >
              {formatTime(times[tick.index])}
            </text>
          ))}

          <path d={buildAreaPath(points, PLOT_BOTTOM)} className="trend-card__area" style={{ fill: `var(${colorVar})` }} />
          <path d={buildSmoothPath(points)} className="trend-card__line" style={{ stroke: `var(${colorVar})` }} />

          {points.map(([x, y], index) => (
            <circle
              key={index}
              cx={x}
              cy={y}
              r="2.5"
              className="trend-card__point"
              style={{ fill: `var(${colorVar})` }}
            />
          ))}

          <circle
            cx={xs[lastIndex]}
            cy={ys[lastIndex]}
            r="4"
            className="trend-card__end-dot"
            style={{ fill: `var(${colorVar})` }}
          />

          {hoverIndex === null ? null : (
            <>
              <line x1={hoverX} y1={PLOT_TOP} x2={hoverX} y2={PLOT_BOTTOM} className="trend-card__crosshair" />
              <circle cx={hoverX} cy={hoverY} r="4" className="trend-card__hover-dot" style={{ fill: `var(${colorVar})` }} />
            </>
          )}
        </svg>

        {hoverIndex === null ? null : (
          <div className="trend-card__tooltip" style={{ left: `${tooltipLeftPct}%` }}>
            <p className="trend-card__tooltip-value">
              {formatValue(series[hoverIndex], decimals)} {unit}
            </p>
            <p className="trend-card__tooltip-time">{new Date(times[hoverIndex]).toLocaleTimeString()}</p>
          </div>
        )}
      </div>

      <p className="trend-card__caption">{caption}</p>
    </div>
  )
}

function ReadingsTrendChart({ history }) {
  const times = history.map((sample) => sample.time)
  const currentSeries = history.map((sample) => (typeof sample.current === 'number' ? sample.current : 0))
  const powerSeries = history.map((sample) =>
    typeof sample.voltage === 'number' && typeof sample.current === 'number' ? sample.voltage * sample.current : 0,
  )

  const pollCaption = `Live trend across the last ${history.length} polls, refreshed every three seconds.`

  return (
    <div className="trend-grid">
      <TrendCard
        label="Current"
        unit="A"
        decimals={3}
        colorVar="--wave-current"
        series={currentSeries}
        times={times}
        caption={pollCaption}
      />
      <TrendCard
        label="Power"
        unit="W"
        decimals={2}
        colorVar="--wave-power"
        series={powerSeries}
        times={times}
        caption="Computed as voltage × current at each poll."
      />
    </div>
  )
}

export default ReadingsTrendChart

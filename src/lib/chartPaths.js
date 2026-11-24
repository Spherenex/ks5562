export function clampFraction(value) {
  return Math.min(1, Math.max(0, value))
}

export function buildLinePath(points) {
  return points.map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
}

// Catmull-Rom to cubic-bezier conversion — smooths the trace while still
// passing exactly through every real reading, so it reads like the sensor
// data rather than an approximation of it.
export function buildSmoothPath(points) {
  if (points.length < 3) {
    return buildLinePath(points)
  }

  let d = `M${points[0][0].toFixed(1)},${points[0][1].toFixed(1)}`

  for (let index = 0; index < points.length - 1; index += 1) {
    const p0 = points[index === 0 ? index : index - 1]
    const p1 = points[index]
    const p2 = points[index + 1]
    const p3 = points[index + 2 < points.length ? index + 2 : index + 1]

    const cp1x = p1[0] + (p2[0] - p0[0]) / 6
    const cp1y = p1[1] + (p2[1] - p0[1]) / 6
    const cp2x = p2[0] - (p3[0] - p1[0]) / 6
    const cp2y = p2[1] - (p3[1] - p1[1]) / 6

    d += ` C${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`
  }

  return d
}

export function buildAreaPath(points, baselineY) {
  const [firstX] = points[0]
  const [lastX] = points[points.length - 1]
  return `${buildSmoothPath(points)} L${lastX.toFixed(1)},${baselineY} L${firstX.toFixed(1)},${baselineY} Z`
}

export function buildStepPath(states, xs, highY, lowY) {
  let d = ''
  let prevY = null

  states.forEach((isHigh, index) => {
    const y = isHigh ? highY : lowY
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

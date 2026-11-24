// The firmware's Fault_Section string has no fixed schema across builds — it may
// arrive as "A-B", "AB", "SECTION 2", "RELAY2", etc. These helpers resolve it to a
// segment index so the animation and locator bar can point at the faulted span.

function compact(value) {
  return String(value ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
}

export function resolveFaultSegmentIndex(faultSection, segments) {
  if (typeof faultSection !== 'string' || !segments?.length) {
    return -1
  }

  const raw = faultSection.trim().toUpperCase()
  if (!raw || ['NONE', 'NULL', 'NA', 'N/A', '-'].includes(raw)) {
    return -1
  }

  const key = compact(raw)
  const byName = segments.findIndex((segment) => {
    const ends = compact(segment.section)
    if (!ends) {
      return false
    }
    const reversed = ends.split('').reverse().join('')
    return key === ends || key === reversed || key.endsWith(ends)
  })
  if (byName !== -1) {
    return byName
  }

  const digits = raw.match(/\d+/)
  if (digits) {
    const number = Number(digits[0])
    if (number >= 1 && number <= segments.length) {
      return number - 1
    }
  }

  return -1
}

// When the device flags a fault but doesn't name a section we recognise, the first
// isolated span is the best available evidence of where it is — flagged `inferred`
// so the UI can say so rather than presenting a guess as a reading.
export function locateFault({ isFault, faultSection, segments }) {
  if (!isFault) {
    return { index: -1, inferred: false }
  }

  const index = resolveFaultSegmentIndex(faultSection, segments)
  if (index !== -1) {
    return { index, inferred: false }
  }

  const isolated = (segments || []).findIndex((segment) => !segment.isOpen)
  return isolated === -1 ? { index: -1, inferred: false } : { index: isolated, inferred: true }
}

// The hardware only ever reports the instantaneous state (voltage, current, relay
// positions, which section is faulted). It has no memory of its own — every fault
// "event" (start time, detection delay, before/during/after readings, which relay
// acted, when it restored) is reconstructed here by watching that live stream poll
// to poll and noticing transitions. Detection delay is therefore bounded by the
// dashboard's poll interval, not a hardware-timestamped trip time.

export function describeRelayAction(beforeStates, afterStates) {
  if (!beforeStates || !afterStates) {
    return 'Not observed'
  }

  const changed = afterStates.filter((relay) => {
    const before = beforeStates.find((candidate) => candidate.key === relay.key)
    return before && before.isOpen !== relay.isOpen
  })

  if (changed.length === 0) {
    return 'No relay change observed'
  }

  return changed.map((relay) => `${relay.label} ${relay.isOpen ? 'opened — section isolated' : 'closed — section restored'}`).join('; ')
}

// The device detects faults purely by a current-threshold trip on a section, with
// no voltage-waveform or phase-angle sensing, so an overcurrent trip is the only
// classification it can honestly support.
export function classifyFaultType(sample) {
  const section = sample.faultSection && sample.faultSection !== 'NONE' ? ` — ${sample.faultSection}` : ''
  return `Overcurrent trip${section}`
}

export function buildFaultStartRecord({ sample, previousSample, timestamp }) {
  const detectionDelayMs = previousSample ? timestamp - previousSample.timestamp : null

  return {
    poleId: sample.faultSection,
    section: sample.faultSection,
    faultType: classifyFaultType(sample),
    startTime: timestamp,
    clearTime: null,
    detectionDelayMs,
    voltageBefore: previousSample ? previousSample.voltage : null,
    voltageDuring: sample.voltage,
    voltageAfter: null,
    currentDuring: sample.currentMagnitude,
    peakCurrent: sample.currentMagnitude,
    relayAction: describeRelayAction(previousSample?.relayStates, sample.relayStates),
    autoRestoreEnabled: sample.autoRestore ?? null,
    recloseAttempt: sample.recloseAttempt ?? null,
    restorationStatus: 'Ongoing',
  }
}

export function buildFaultClearPatch({ sample, timestamp, relayStatesAtStart, peakCurrentSoFar }) {
  return {
    clearTime: timestamp,
    voltageAfter: sample.voltage,
    peakCurrent: Math.max(peakCurrentSoFar ?? 0, sample.currentMagnitude ?? 0),
    relayAction: describeRelayAction(relayStatesAtStart, sample.relayStates),
    restorationStatus: sample.autoRestore ? 'Restored automatically' : 'Restored manually',
  }
}

// The initial Firebase history fetch and the live poll loop's optimistic local
// updates both write to the same fault-events list from independent async paths.
// A blind replace from whichever resolves last can silently drop a record the
// other path just added, so every update goes through this id-keyed merge instead.
export function mergeFaultEvents(base, incoming) {
  const byId = new Map(base.map((record) => [record.id, record]))
  incoming.forEach((record) => byId.set(record.id, record))
  return [...byId.values()].sort((a, b) => (b.startTime ?? 0) - (a.startTime ?? 0))
}

export function computePoleStatuses(relayStates, nodeLabels) {
  return nodeLabels.map((label, index) => {
    const leftSegment = relayStates[index - 1]
    const rightSegment = relayStates[index]
    const neighbors = [leftSegment, rightSegment].filter(Boolean)
    const energized = neighbors.length === 0 ? null : neighbors.some((segment) => segment.isOpen)
    return {
      label,
      energized,
      neighborSections: neighbors.map((segment) => segment.section),
    }
  })
}

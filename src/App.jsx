import { useEffect, useRef, useState } from 'react'
import './App.css'
import { firebaseConfig } from './firebaseConfig'
import LedgerRow from './components/LedgerRow'
import ProcessAnimation from './components/ProcessAnimation'
import FaultDetectionStepper from './components/FaultDetectionStepper'
import PoleStatusStrip from './components/PoleStatusStrip'
import PhaseVoltageChart from './components/PhaseVoltageChart'
import FaultSignalChart from './components/FaultSignalChart'
import ReadingsTrendChart from './components/ReadingsTrendChart'
import RelayTimingChart from './components/RelayTimingChart'
import FaultHistoryTable from './components/FaultHistoryTable'
import ReportActions from './components/ReportActions'
import { buildFaultClearPatch, buildFaultStartRecord, computePoleStatuses, mergeFaultEvents } from './lib/faultEvents'
import { fetchFaultHistory, patchFaultRecord, pushFaultStart } from './lib/faultLog'
import { formatDelayMs } from './lib/format'
import { CHARGING_RELAY_KEY, desiredChargingRelayValue, setChargingRelay } from './lib/chargingRelay'

const DATABASE_ROOT = firebaseConfig.databaseURL.replace(/\/$/, '')
const FAULT_SYSTEM_PATH = 'Grid_Fault_System'
const REFRESH_INTERVAL_MS = 3000
const HISTORY_LIMIT = 40
const NORMAL_CURRENT_AMPS = 1
const NODE_LABELS = ['A', 'B', 'C', 'D', 'E']
const RECENTLY_RESTORED_WINDOW_MS = 8000
const RELAY_SECTIONS = [
  { key: 'Relay1', historyKey: 'relay1', label: 'Relay 1', section: 'A-B' },
  { key: 'Relay2', historyKey: 'relay2', label: 'Relay 2', section: 'B-C' },
  { key: 'Relay3', historyKey: 'relay3', label: 'Relay 3', section: 'C-D' },
  { key: 'Relay4', historyKey: 'relay4', label: 'Relay 4', section: 'D-E' },
]

function buildDatabaseUrl() {
  return `${DATABASE_ROOT}/${FAULT_SYSTEM_PATH}.json?t=${Date.now()}`
}

function toFiniteNumber(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function toBoolean(value) {
  return value === true
}

function normalizeStatus(value, fallback) {
  return typeof value === 'string' && value.trim() ? value.trim().toUpperCase() : fallback
}

function relayRow(relay, rawValue) {
  const isOpen = Number(rawValue) === 1
  return {
    label: `${relay.label} (${relay.section})`,
    value: isOpen ? 'Open' : 'Closed',
    tone: isOpen ? 'good' : 'warning',
    hint: isOpen ? `${relay.section} available` : `${relay.section} isolated`,
  }
}

// Optional per-phase voltage fields — not sent by the currently connected hardware
// (it reports one Voltage channel), but read here so the 3-phase graph switches on
// automatically the moment firmware starts publishing them, without a code change.
function extractPhaseVoltages(payload) {
  const a = toFiniteNumber(payload?.Voltage_A ?? payload?.VA ?? payload?.Va)
  const b = toFiniteNumber(payload?.Voltage_B ?? payload?.VB ?? payload?.Vb)
  const c = toFiniteNumber(payload?.Voltage_C ?? payload?.VC ?? payload?.Vc)
  return a === null && b === null && c === null ? null : { a, b, c }
}

function normalizeFaultTelemetry(payload) {
  const voltage = toFiniteNumber(payload?.Voltage)
  const currentRaw = toFiniteNumber(payload?.Current)
  const currentMagnitude = typeof currentRaw === 'number' ? Math.abs(currentRaw) : null
  const systemStatus = normalizeStatus(payload?.System_Status, 'UNKNOWN')
  const faultSection = normalizeStatus(payload?.Fault_Section, 'NONE')
  const faultStatus = toBoolean(payload?.Fault_Status)
  const autoRestore = toBoolean(payload?.Auto_Restore)
  const recloseAttempt = toBoolean(payload?.Reclose_Attempt)
  const relayStates = RELAY_SECTIONS.map((relay) => {
    const value = payload?.[relay.key] ?? 0
    return {
      ...relay,
      value,
      isOpen: Number(value) === 1,
    }
  })
  const openRelayCount = relayStates.filter((relay) => relay.isOpen).length
  const currentRatio =
    typeof currentMagnitude === 'number' && NORMAL_CURRENT_AMPS > 0 ? currentMagnitude / NORMAL_CURRENT_AMPS : null
  const currentPerOpenRelay =
    typeof currentMagnitude === 'number' && openRelayCount > 0 ? currentMagnitude / openRelayCount : null
  const poleStatuses = computePoleStatuses(relayStates, NODE_LABELS)
  const phaseVoltages = extractPhaseVoltages(payload)
  const chargingRaw = payload?.[CHARGING_RELAY_KEY]
  const batteryCharging = chargingRaw === undefined || chargingRaw === null ? null : Number(chargingRaw) === 1

  return {
    autoRestore,
    batteryCharging,
    currentMagnitude,
    currentPerOpenRelay,
    currentRatio,
    faultSection,
    faultStatus,
    phaseVoltages,
    poleStatuses,
    recloseAttempt,
    relayStates,
    systemStatus,
    voltage,
  }
}

function App() {
  const [data, setData] = useState(null)
  const [history, setHistory] = useState([])
  const [faultEvents, setFaultEvents] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const [lastUpdated, setLastUpdated] = useState('')

  const previousSampleRef = useRef(null)
  const activeFaultRef = useRef(null)
  const wasFaultRef = useRef(false)
  const lastClearTimeRef = useRef(null)
  const [recentlyRestored, setRecentlyRestored] = useState(false)
  const chargingWriteRef = useRef(null)
  const [chargingWriteError, setChargingWriteError] = useState('')

  useEffect(() => {
    let isActive = true
    let intervalId = null

    // Fault-transition detection reads wasFaultRef/activeFaultRef, which the history
    // fetch below also seeds (e.g. resuming a fault left "Ongoing" from a prior
    // session). Awaiting that fetch before the first poll — rather than racing it
    // against the poll loop — means a fault starting right at page load can never be
    // silently skipped because the cloud history hadn't loaded yet.
    async function bootstrapFaultHistory() {
      try {
        const loaded = await fetchFaultHistory()
        if (!isActive) {
          return
        }
        setFaultEvents((previous) => mergeFaultEvents(previous, loaded))
        const openEvent = loaded.find((record) => !record.clearTime)
        if (openEvent) {
          activeFaultRef.current = {
            localKey: openEvent.id,
            firebaseIdPromise: Promise.resolve(openEvent.id),
            relayStatesAtStart: null,
            peakCurrent: openEvent.peakCurrent ?? openEvent.currentDuring ?? 0,
          }
          wasFaultRef.current = true
        } else if (typeof loaded[0]?.clearTime === 'number') {
          lastClearTimeRef.current = loaded[0].clearTime
          setRecentlyRestored(Date.now() - loaded[0].clearTime < RECENTLY_RESTORED_WINDOW_MS)
        }
      } catch {
        // The history log is a cloud-persisted nice-to-have — the live dashboard
        // still works even if this initial fetch fails (offline, rules, etc.).
      }
    }

    async function loadFaultSystem() {
      try {
        if (!isActive) {
          return
        }

        setError('')

        const response = await fetch(buildDatabaseUrl(), {
          headers: {
            Accept: 'application/json',
          },
          cache: 'no-store',
        })

        if (!response.ok) {
          throw new Error(`Firebase request failed with status ${response.status}`)
        }

        const payload = await response.json()

        if (!isActive) {
          return
        }

        setData(payload)
        setLastUpdated(new Date().toLocaleString())

        const sample = normalizeFaultTelemetry(payload)
        const timestamp = Date.now()
        const isFaultSample = sample.faultStatus === true || sample.systemStatus === 'FAULT'

        // Battery charging relay: hold 2relay1 at 1 normally, drop it to 0 during a fault.
        // Only write when the stored value differs, and never while the same write is in flight.
        const desiredCharging = desiredChargingRelayValue(isFaultSample)
        if (
          payload &&
          Number(payload[CHARGING_RELAY_KEY]) !== desiredCharging &&
          chargingWriteRef.current !== desiredCharging
        ) {
          chargingWriteRef.current = desiredCharging
          setChargingRelay(desiredCharging)
            .then(() => {
              if (!isActive) {
                return
              }
              setChargingWriteError('')
              setData((previous) => (previous ? { ...previous, [CHARGING_RELAY_KEY]: desiredCharging } : previous))
            })
            .catch((writeError) => {
              if (isActive) {
                setChargingWriteError(writeError instanceof Error ? writeError.message : 'Write failed')
              }
            })
            .finally(() => {
              if (chargingWriteRef.current === desiredCharging) {
                chargingWriteRef.current = null
              }
            })
        }

        setHistory((previous) =>
          [
            ...previous,
            {
              time: timestamp,
              voltage: sample.voltage,
              current: sample.currentMagnitude,
              currentMagnitude: sample.currentMagnitude,
              phaseVoltages: sample.phaseVoltages,
              relay1: sample.relayStates[0]?.value ?? 0,
              relay2: sample.relayStates[1]?.value ?? 0,
              relay3: sample.relayStates[2]?.value ?? 0,
              relay4: sample.relayStates[3]?.value ?? 0,
              systemStatus: sample.systemStatus,
              faultStatus: sample.faultStatus,
              faultSection: sample.faultSection,
            },
          ].slice(-HISTORY_LIMIT),
        )

        if (isFaultSample && !wasFaultRef.current) {
          const record = buildFaultStartRecord({
            sample,
            previousSample: previousSampleRef.current,
            timestamp,
          })
          const localKey = `local-${timestamp}`
          const firebaseIdPromise = pushFaultStart(record).catch(() => null)

          activeFaultRef.current = {
            localKey,
            firebaseIdPromise,
            relayStatesAtStart: previousSampleRef.current?.relayStates ?? null,
            peakCurrent: sample.currentMagnitude ?? 0,
          }
          setFaultEvents((previous) => [{ id: localKey, ...record }, ...previous])
        } else if (isFaultSample && wasFaultRef.current && activeFaultRef.current) {
          const peakCurrent = Math.max(activeFaultRef.current.peakCurrent ?? 0, sample.currentMagnitude ?? 0)
          activeFaultRef.current.peakCurrent = peakCurrent
          const { localKey } = activeFaultRef.current
          setFaultEvents((previous) =>
            previous.map((record) =>
              record.id === localKey
                ? { ...record, voltageDuring: sample.voltage, currentDuring: sample.currentMagnitude, peakCurrent }
                : record,
            ),
          )
        } else if (!isFaultSample && wasFaultRef.current && activeFaultRef.current) {
          const { localKey, firebaseIdPromise, relayStatesAtStart, peakCurrent } = activeFaultRef.current
          const patch = buildFaultClearPatch({ sample, timestamp, relayStatesAtStart, peakCurrentSoFar: peakCurrent })
          setFaultEvents((previous) => previous.map((record) => (record.id === localKey ? { ...record, ...patch } : record)))
          firebaseIdPromise.then((id) => {
            if (id) {
              patchFaultRecord(id, patch).catch(() => {})
            }
          })
          activeFaultRef.current = null
          lastClearTimeRef.current = timestamp
        }

        wasFaultRef.current = isFaultSample

        setRecentlyRestored(
          lastClearTimeRef.current !== null && timestamp - lastClearTimeRef.current < RECENTLY_RESTORED_WINDOW_MS,
        )

        previousSampleRef.current = {
          voltage: sample.voltage,
          relayStates: sample.relayStates,
          timestamp,
        }
      } catch (loadError) {
        if (!isActive) {
          return
        }

        setError(loadError instanceof Error ? loadError.message : 'Unable to load Firebase data')
      } finally {
        if (isActive) {
          setIsLoading(false)
        }
      }
    }

    async function start() {
      await bootstrapFaultHistory()
      if (!isActive) {
        return
      }
      loadFaultSystem()
      intervalId = window.setInterval(loadFaultSystem, REFRESH_INTERVAL_MS)
    }

    start()

    return () => {
      isActive = false
      if (intervalId) {
        window.clearInterval(intervalId)
      }
    }
  }, [])

  const normalized = data === null ? null : normalizeFaultTelemetry(data)
  const isFault = normalized?.faultStatus === true || normalized?.systemStatus === 'FAULT'
  const latestFaultEvent = faultEvents[0] ?? null

  const statusLine = error
    ? 'Unable to reach the register'
    : isLoading && data === null
      ? 'Reading register...'
      : lastUpdated
        ? `Last synced ${lastUpdated}`
        : 'Awaiting first transmission'

  return (
    <main className="report">
      <header className={`report__masthead report__masthead--${data === null ? 'neutral' : isFault ? 'critical' : 'good'}`}>
        <p className="report__kicker">Automated Telemetry &middot; Realtime Database</p>
        <h1 className="report__title">The Grid Fault Register</h1>
        <p className="report__subtitle">
          Live voltage, current, relay position, and fault status from the <em>{FAULT_SYSTEM_PATH}</em> Firebase node.
        </p>

        <div className="report__rule" aria-hidden="true" />

        <dl className="report__meta">
          <div className="report__meta-item">
            <dt>Source</dt>
            <dd>
              <code>{`${DATABASE_ROOT}/${FAULT_SYSTEM_PATH}.json`}</code>
            </dd>
          </div>
          <div className="report__meta-item">
            <dt>Standing</dt>
            <dd>
              <span className={`report__standing-badge report__standing-badge--${isFault ? 'critical' : 'good'}`}>
                {data === null ? 'Unknown' : isFault ? 'Fault in progress' : 'Normal operation'}
              </span>
            </dd>
          </div>
          <div className="report__meta-item">
            <dt>Dispatch</dt>
            <dd>{statusLine}</dd>
          </div>
        </dl>
      </header>

      {error ? (
        <section className="report__notice report__notice--critical">
          <h2>Database request failed</h2>
          <p>{error}</p>
          <p className="report__notice-subtle">
            If Firebase rules require authentication, this page will need an authenticated SDK flow instead of public
            REST access.
          </p>
        </section>
      ) : null}

      {isLoading && data === null ? (
        <section className="report__notice">
          <p>Reading the {FAULT_SYSTEM_PATH} record for the first time...</p>
        </section>
      ) : data === null && !error ? (
        <section className="report__notice">
          <p>No entry found at {FAULT_SYSTEM_PATH}.</p>
        </section>
      ) : data === null ? null : (
        <>
          <section className="report__section report__card">
            <h2 className="report__section-title">Live Feeder Animation &amp; Fault Detection Flow</h2>
            <ProcessAnimation
              segments={normalized?.relayStates.map((relay) => ({
                section: relay.section,
                label: relay.label,
                isOpen: relay.isOpen,
              }))}
              voltage={normalized?.voltage}
              current={normalized?.currentMagnitude}
              batteryCharging={normalized?.batteryCharging ?? null}
              chargingTarget={desiredChargingRelayValue(isFault) === 1}
              chargingWriteError={chargingWriteError}
              currentRatio={normalized?.currentRatio}
              isFault={isFault}
              faultSection={normalized?.faultSection}
              systemStatus={normalized?.systemStatus}
            />
            <FaultDetectionStepper isFault={isFault} recentlyRestored={recentlyRestored} />
          </section>

          <div className="report__grid">
            <section className="report__section report__card">
              <h2 className="report__section-title">I. System Standing</h2>
              <table className="ledger">
                <tbody>
                  <LedgerRow
                    label="System Status"
                    value={normalized?.systemStatus ?? '-'}
                    tone={normalized?.systemStatus === 'FAULT' ? 'critical' : 'good'}
                  />
                  <LedgerRow
                    label="Fault Status"
                    value={normalized?.faultStatus ? 'Active Fault' : 'No Fault'}
                    tone={normalized?.faultStatus ? 'critical' : 'good'}
                  />
                  <LedgerRow label="Fault Section" value={normalized?.faultSection ?? '-'} tone="info" />
                  <LedgerRow
                    label="Auto Restore"
                    value={normalized?.autoRestore ? 'Enabled' : 'Disabled'}
                    tone={normalized?.autoRestore ? 'good' : 'warning'}
                  />
                  <LedgerRow
                    label="Reclose Attempt"
                    value={normalized?.recloseAttempt ? 'In progress' : 'Idle'}
                    tone={normalized?.recloseAttempt ? 'warning' : 'good'}
                  />
                  <LedgerRow
                    label={`Battery Charging (${CHARGING_RELAY_KEY})`}
                    value={
                      normalized?.batteryCharging === null
                        ? '-'
                        : normalized?.batteryCharging
                          ? 'Charging (1)'
                          : 'Not charging (0)'
                    }
                    tone={normalized?.batteryCharging === false ? 'critical' : 'good'}
                    hint={
                      chargingWriteError
                        ? `${chargingWriteError} — check database write rules`
                        : 'Set automatically: 1 in normal operation, 0 while a fault is active'
                    }
                  />
                </tbody>
              </table>
            </section>

            <section className="report__section report__card">
              <h2 className="report__section-title">II. Electrical Readings</h2>
              <table className="ledger">
                <tbody>
                  <LedgerRow
                    label="Voltage"
                    value={typeof normalized?.voltage === 'number' ? `${normalized.voltage.toFixed(1)} V` : '-'}
                    tone="info"
                  />
                  <LedgerRow
                    label="Current"
                    value={typeof normalized?.currentMagnitude === 'number' ? `${normalized.currentMagnitude.toFixed(3)} A` : '-'}
                    tone="info"
                  />
                  <LedgerRow
                    label="Current Rise"
                    value={
                      typeof normalized?.currentRatio === 'number'
                        ? `${Math.max(0, (normalized.currentRatio - 1) * 100).toFixed(0)}% above normal`
                        : '-'
                    }
                    tone={isFault ? 'critical' : 'good'}
                  />
                </tbody>
              </table>
            </section>

            <section className="report__section report__card">
              <h2 className="report__section-title">III. Relay Position</h2>
              <table className="ledger">
                <tbody>
                  {normalized?.relayStates.map((relay) => {
                    const relayDisplay = relayRow(relay, relay.value)
                    return (
                      <LedgerRow
                        key={relay.key}
                        label={relayDisplay.label}
                        value={relayDisplay.value}
                        tone={relayDisplay.tone}
                        hint={relayDisplay.hint}
                      />
                    )
                  })}
                </tbody>
              </table>
            </section>
          </div>

          <section className="report__section report__card">
            <h2 className="report__section-title">IV. Pole Status</h2>
            <PoleStatusStrip poleStatuses={normalized?.poleStatuses ?? []} faultSection={normalized?.faultSection} />
          </section>

          <section className="report__section report__card">
            <h2 className="report__section-title">V. Fault Timing &amp; Detection</h2>
            {latestFaultEvent ? (
              <table className="ledger">
                <tbody>
                  <LedgerRow label="Fault Type" value={latestFaultEvent.faultType ?? '-'} tone="info" />
                  <LedgerRow label="Location" value={latestFaultEvent.section ?? '-'} tone="info" />
                  <LedgerRow
                    label="Detected At"
                    value={typeof latestFaultEvent.startTime === 'number' ? new Date(latestFaultEvent.startTime).toLocaleString() : '-'}
                    tone="info"
                  />
                  <LedgerRow
                    label="Detection Delay"
                    value={formatDelayMs(latestFaultEvent.detectionDelayMs) ?? 'Not observed (already active on connect)'}
                    tone="info"
                    hint="Measured between dashboard polls, ~3 s resolution — not a hardware-timestamped trip time."
                  />
                  <LedgerRow
                    label="Restoration Status"
                    value={latestFaultEvent.clearTime ? latestFaultEvent.restorationStatus ?? 'Restored' : 'Ongoing — section isolated'}
                    tone={latestFaultEvent.clearTime ? 'good' : 'critical'}
                  />
                </tbody>
              </table>
            ) : (
              <p className="report__notice-subtle">No fault has been logged yet — this panel fills in the moment one is detected.</p>
            )}
          </section>

          <section className="report__section report__card">
            <h2 className="report__section-title">VI. Output Graphs</h2>
            <div className="trend-grid">
              <PhaseVoltageChart history={history} />
              <FaultSignalChart history={history} />
            </div>
            <ReadingsTrendChart history={history} />
          </section>

          <section className="report__section report__card">
            <h2 className="report__section-title">VII. Relay Timing</h2>
            <RelayTimingChart history={history} />
          </section>

          <section className="report__section report__card">
            <div className="report__section-header">
              <h2 className="report__section-title">VIII. Fault History</h2>
              <ReportActions events={faultEvents} />
            </div>
            <FaultHistoryTable events={faultEvents} />
          </section>
        </>
      )}

      <footer className="report__footer">
        <div className="report__rule" aria-hidden="true" />
        <p>Synced from Firebase every three seconds &middot; Grid Fault Monitor</p>
      </footer>
    </main>
  )
}

export default App

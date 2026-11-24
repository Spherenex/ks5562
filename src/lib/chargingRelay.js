import { firebaseConfig } from '../firebaseConfig'

const DATABASE_ROOT = firebaseConfig.databaseURL.replace(/\/$/, '')

// Battery-charging relay field read by the hardware: 1 = charging, 0 = not charging.
// The dashboard holds it at 1 during normal operation and drops it to 0 while a
// fault is active, so the battery is never charged into a faulted feeder.
export const CHARGING_RELAY_KEY = '2relay1'
const CHARGING_RELAY_PATH = `Grid_Fault_System/${CHARGING_RELAY_KEY}`

export function desiredChargingRelayValue(isFault) {
  return isFault ? 0 : 1
}

export async function setChargingRelay(value) {
  const response = await fetch(`${DATABASE_ROOT}/${CHARGING_RELAY_PATH}.json`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(value),
  })

  if (!response.ok) {
    throw new Error(`Failed to set ${CHARGING_RELAY_KEY} (status ${response.status})`)
  }

  return value
}

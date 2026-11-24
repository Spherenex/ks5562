import { firebaseConfig } from '../firebaseConfig'

const DATABASE_ROOT = firebaseConfig.databaseURL.replace(/\/$/, '')
const HISTORY_PATH = 'Grid_Fault_System/History'
const HISTORY_LOAD_LIMIT = 100

export async function fetchFaultHistory() {
  const url = `${DATABASE_ROOT}/${HISTORY_PATH}.json?orderBy=%22%24key%22&limitToLast=${HISTORY_LOAD_LIMIT}`
  const response = await fetch(url, { headers: { Accept: 'application/json' }, cache: 'no-store' })

  if (!response.ok) {
    throw new Error(`Failed to load fault history (status ${response.status})`)
  }

  const payload = await response.json()

  if (!payload || typeof payload !== 'object') {
    return []
  }

  return Object.entries(payload)
    .map(([id, record]) => ({ id, ...record }))
    .sort((a, b) => (b.startTime ?? 0) - (a.startTime ?? 0))
}

export async function pushFaultStart(record) {
  const url = `${DATABASE_ROOT}/${HISTORY_PATH}.json`
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(record),
  })

  if (!response.ok) {
    throw new Error(`Failed to log fault start (status ${response.status})`)
  }

  const payload = await response.json()
  return payload.name
}

export async function patchFaultRecord(id, patch) {
  const url = `${DATABASE_ROOT}/${HISTORY_PATH}/${id}.json`
  const response = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })

  if (!response.ok) {
    throw new Error(`Failed to log fault clearance (status ${response.status})`)
  }

  return response.json()
}

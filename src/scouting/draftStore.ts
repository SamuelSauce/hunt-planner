import { scoutWorkspaceKey, type ScoutWorkspace } from './model'

const DATABASE_NAME = 'hunt-planner-scouting'
const STORE_NAME = 'guest-drafts'
const DATABASE_VERSION = 1

export async function loadGuestScoutDraft(state: string, huntNumber: string) {
  const db = await openDatabase()
  if (!db) return null
  return new Promise<ScoutWorkspace | null>((resolve) => {
    const request = db
      .transaction(STORE_NAME, 'readonly')
      .objectStore(STORE_NAME)
      .get(scoutWorkspaceKey(state, huntNumber))
    request.onsuccess = () => resolve(isScoutWorkspace(request.result) ? request.result : null)
    request.onerror = () => resolve(null)
  })
}

export async function saveGuestScoutDraft(workspace: ScoutWorkspace) {
  const db = await openDatabase()
  if (!db) return
  await new Promise<void>((resolve) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite')
    transaction.objectStore(STORE_NAME).put(
      workspace,
      scoutWorkspaceKey(workspace.state, workspace.huntNumber),
    )
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => resolve()
  })
}

export async function clearGuestScoutDraft(state: string, huntNumber: string) {
  const db = await openDatabase()
  if (!db) return
  await new Promise<void>((resolve) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite')
    transaction.objectStore(STORE_NAME).delete(scoutWorkspaceKey(state, huntNumber))
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => resolve()
  })
}

function openDatabase() {
  if (typeof indexedDB === 'undefined') return Promise.resolve<IDBDatabase | null>(null)
  return new Promise<IDBDatabase | null>((resolve) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => resolve(null)
  })
}

function isScoutWorkspace(value: unknown): value is ScoutWorkspace {
  if (!value || typeof value !== 'object') return false
  const workspace = value as Partial<ScoutWorkspace>
  return (
    workspace.version === 1 &&
    typeof workspace.state === 'string' &&
    typeof workspace.huntNumber === 'string' &&
    Array.isArray(workspace.layers) &&
    Array.isArray(workspace.pins)
  )
}

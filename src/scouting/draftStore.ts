import {
  scoutLibraryFromWorkspaces,
  type ScoutLibrary,
  type ScoutWorkspace,
} from './model'

const DATABASE_NAME = 'hunt-planner-scouting'
const STORE_NAME = 'guest-drafts'
const DATABASE_VERSION = 1
const GLOBAL_LIBRARY_KEY = 'global-library-v2'

export async function loadGuestScoutLibrary() {
  const db = await openDatabase()
  if (!db) return null
  const direct = await readValue(db, GLOBAL_LIBRARY_KEY)
  if (isScoutLibrary(direct)) return direct

  const legacy = await readAllValues(db)
  const workspaces = legacy.filter(isScoutWorkspace)
  if (workspaces.length === 0) return null

  const library = scoutLibraryFromWorkspaces(workspaces)
  await saveGuestScoutLibrary(library)
  await deleteLegacyDrafts(db)
  return library
}

export async function saveGuestScoutLibrary(library: ScoutLibrary) {
  const db = await openDatabase()
  if (!db) return
  await new Promise<void>((resolve) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite')
    transaction.objectStore(STORE_NAME).put(library, GLOBAL_LIBRARY_KEY)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => resolve()
  })
}

export async function clearGuestScoutLibrary() {
  const db = await openDatabase()
  if (!db) return
  await new Promise<void>((resolve) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite')
    transaction.objectStore(STORE_NAME).clear()
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => resolve()
  })
}

function readValue(db: IDBDatabase, key: IDBValidKey) {
  return new Promise<unknown>((resolve) => {
    const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(key)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => resolve(null)
  })
}

function readAllValues(db: IDBDatabase) {
  return new Promise<unknown[]>((resolve) => {
    const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll()
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => resolve([])
  })
}

function deleteLegacyDrafts(db: IDBDatabase) {
  return new Promise<void>((resolve) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite')
    const store = transaction.objectStore(STORE_NAME)
    const request = store.getAllKeys()
    request.onsuccess = () => {
      request.result
        .filter((key) => key !== GLOBAL_LIBRARY_KEY)
        .forEach((key) => store.delete(key))
    }
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

function isScoutLibrary(value: unknown): value is ScoutLibrary {
  if (!value || typeof value !== 'object') return false
  const library = value as Partial<ScoutLibrary>
  return (
    library.version === 2 &&
    Array.isArray(library.layers) &&
    Array.isArray(library.pins)
  )
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

import { getFirebaseIdToken } from '../firebase'
import type { ScoutWorkspace } from './model'

export type ScoutShare = {
  id: string
  version: 1
  title: string
  workspace: ScoutWorkspace
  createdAt: number
}

export type ScoutShareReceipt = {
  id: string
  title: string
  layerCount: number
  pinCount: number
  createdAt: number
}

export class ScoutAuthError extends Error {
  constructor() {
    super('Sign in to sync scout layers.')
    this.name = 'ScoutAuthError'
  }
}

export async function loadScoutWorkspace(state: string, huntNumber: string) {
  const params = new URLSearchParams({ state, hunt: huntNumber })
  const response = await scoutFetch(`/api/maps/workspace?${params}`)
  const payload = await readResponse<{ workspace: ScoutWorkspace | null }>(response)
  return payload.workspace
}

export async function saveScoutWorkspace(workspace: ScoutWorkspace) {
  const response = await scoutFetch('/api/maps/workspace', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ workspace }),
  })
  const payload = await readResponse<{ workspace: ScoutWorkspace }>(response)
  return payload.workspace
}

export async function createScoutShare(
  workspace: ScoutWorkspace,
  {
    title,
    layerIds,
    includeNotes,
  }: {
    title: string
    layerIds: string[]
    includeNotes: boolean
  },
) {
  const response = await scoutFetch('/api/maps/shares', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      workspace,
      title,
      layerIds,
      includeNotes,
    }),
  })
  const payload = await readResponse<{ share: ScoutShareReceipt }>(response)
  return payload.share
}

export async function loadScoutShare(shareId: string) {
  const response = await fetch(`/api/maps/shares/${encodeURIComponent(shareId)}`, {
    headers: { Accept: 'application/json' },
  })
  const payload = await readResponse<{ share: ScoutShare }>(response)
  return payload.share
}

async function scoutFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  let token = await getFirebaseIdToken()
  if (!token) throw new ScoutAuthError()

  let response = await fetch(input, withIdentity(init, token))
  if (response.status === 401) {
    token = await getFirebaseIdToken(true)
    if (token) response = await fetch(input, withIdentity(init, token))
  }
  return response
}

function withIdentity(init: RequestInit, token: string) {
  const headers = new Headers(init.headers)
  headers.delete('Authorization')
  headers.set('X-Firebase-ID-Token', token)
  return { ...init, headers }
}

async function readResponse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({})) as T & { error?: string }
  if (response.status === 401) throw new ScoutAuthError()
  if (!response.ok) throw new Error(payload.error || 'Scout layers could not be synced.')
  return payload
}

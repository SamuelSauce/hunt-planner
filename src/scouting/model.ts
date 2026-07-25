import type { FeatureCollection, Point } from 'geojson'
import type { MapPinLocation } from '../mapPin'

export type ScoutPinType =
  | 'water'
  | 'bedding'
  | 'glassing'
  | 'cow'
  | 'bull'
  | 'spike'
  | 'sit'
  | 'camp'
  | 'crossing'
  | 'check'

export type ScoutPinStatus = 'e-scout' | 'field'
export type ScoutWaterSeasonality = 'unknown' | 'perennial' | 'seasonal' | 'dry'

export type ScoutLayer = {
  id: string
  name: string
  visible: boolean
  sortOrder: number
  color: string
  createdAt: number
  updatedAt: number
}

export type ScoutPin = {
  id: string
  layerId: string
  location: MapPinLocation
  title: string
  type: ScoutPinType
  status: ScoutPinStatus
  species: string
  observationYear: number
  notes: string
  waterSeasonality: ScoutWaterSeasonality
  colorOverride: string | null
  createdAt: number
  updatedAt: number
}

export type ScoutWorkspace = {
  version: 1
  state: string
  huntNumber: string
  name: string
  layers: ScoutLayer[]
  pins: ScoutPin[]
  updatedAt: number
}

export type ScoutFilters = {
  status: 'all' | ScoutPinStatus
  observationYear: 'all' | number
}

export type ScoutPinDraft = Pick<
  ScoutPin,
  | 'title'
  | 'type'
  | 'status'
  | 'species'
  | 'observationYear'
  | 'notes'
  | 'waterSeasonality'
  | 'colorOverride'
> & {
  layerId: string
  location: MapPinLocation
}

export type ScoutPinProperties = {
  id: string
  layerId: string
  title: string
  glyph: string
  color: string
  type: ScoutPinType
  status: ScoutPinStatus
}

export const GUEST_PIN_LIMIT = 5
export const DEFAULT_SCOUT_FILTERS: ScoutFilters = {
  status: 'all',
  observationYear: 'all',
}

export const SCOUT_PIN_TYPES: Array<{ value: ScoutPinType; label: string; glyph: string }> = [
  { value: 'water', label: 'Water', glyph: 'W' },
  { value: 'bedding', label: 'Bedding', glyph: 'B' },
  { value: 'glassing', label: 'Glassing', glyph: 'G' },
  { value: 'cow', label: 'Cow', glyph: 'C' },
  { value: 'bull', label: 'Bull', glyph: 'E' },
  { value: 'spike', label: 'Spike', glyph: 'S' },
  { value: 'sit', label: 'Sit', glyph: 'H' },
  { value: 'camp', label: 'Camp', glyph: 'T' },
  { value: 'crossing', label: 'Crossing', glyph: 'X' },
  { value: 'check', label: 'Check', glyph: '?' },
]

export const SCOUT_LAYER_COLORS = [
  '#f2c94c',
  '#e95727',
  '#2f80ed',
  '#45b97c',
  '#a56de2',
  '#f2994a',
]

export function createScoutWorkspace(
  state: string,
  huntNumber: string,
  name: string,
  now = Date.now(),
): ScoutWorkspace {
  return {
    version: 1,
    state,
    huntNumber,
    name,
    layers: [
      {
        id: createId('layer'),
        name: 'Scratch',
        visible: true,
        sortOrder: 0,
        color: SCOUT_LAYER_COLORS[0],
        createdAt: now,
        updatedAt: now,
      },
    ],
    pins: [],
    updatedAt: now,
  }
}

export function createScoutLayer(
  name: string,
  sortOrder: number,
  color = SCOUT_LAYER_COLORS[sortOrder % SCOUT_LAYER_COLORS.length],
  now = Date.now(),
): ScoutLayer {
  return {
    id: createId('layer'),
    name: name.trim().slice(0, 48) || `Layer ${sortOrder + 1}`,
    visible: true,
    sortOrder,
    color,
    createdAt: now,
    updatedAt: now,
  }
}

export function createScoutPin(draft: ScoutPinDraft, now = Date.now()): ScoutPin {
  return {
    id: createId('pin'),
    ...draft,
    title: draft.title.trim().slice(0, 80),
    notes: draft.notes.trim().slice(0, 2_000),
    createdAt: now,
    updatedAt: now,
  }
}

export function scoutPinColor(pin: ScoutPin) {
  if (pin.colorOverride) return pin.colorOverride
  if (pin.type === 'water') return '#2f80ed'
  if (pin.status === 'field') return '#e95727'
  return '#f2c94c'
}

export function scoutPinGlyph(type: ScoutPinType) {
  return SCOUT_PIN_TYPES.find((candidate) => candidate.value === type)?.glyph ?? '?'
}

export function filterScoutPins(
  workspace: ScoutWorkspace,
  filters: ScoutFilters,
): ScoutPin[] {
  const visibleLayerIds = new Set(
    workspace.layers.filter((layer) => layer.visible).map((layer) => layer.id),
  )
  return workspace.pins.filter((pin) => (
    visibleLayerIds.has(pin.layerId) &&
    (filters.status === 'all' || pin.status === filters.status) &&
    (filters.observationYear === 'all' || pin.observationYear === filters.observationYear)
  ))
}

export function scoutPinsGeoJson(
  workspace: ScoutWorkspace,
  filters: ScoutFilters,
): FeatureCollection<Point, ScoutPinProperties> {
  return {
    type: 'FeatureCollection',
    features: filterScoutPins(workspace, filters).map((pin) => ({
      type: 'Feature',
      id: pin.id,
      geometry: {
        type: 'Point',
        coordinates: [pin.location.longitude, pin.location.latitude],
      },
      properties: {
        id: pin.id,
        layerId: pin.layerId,
        title: pin.title || SCOUT_PIN_TYPES.find((type) => type.value === pin.type)?.label || 'Pin',
        glyph: scoutPinGlyph(pin.type),
        color: scoutPinColor(pin),
        type: pin.type,
        status: pin.status,
      },
    })),
  }
}

export function mergeScoutWorkspaces(
  remote: ScoutWorkspace | null,
  draft: ScoutWorkspace,
  now = Date.now(),
): ScoutWorkspace {
  if (!remote) return { ...draft, updatedAt: now }

  const layerIds = new Set(remote.layers.map((layer) => layer.id))
  const layers = [...remote.layers]
  for (const layer of draft.layers) {
    if (!layerIds.has(layer.id)) {
      layers.push({ ...layer, sortOrder: layers.length })
      layerIds.add(layer.id)
    }
  }

  const pinIds = new Set(remote.pins.map((pin) => pin.id))
  const pins = [...remote.pins]
  for (const pin of draft.pins) {
    if (!pinIds.has(pin.id)) pins.push(pin)
  }

  return { ...remote, layers, pins, updatedAt: now }
}

export function scoutWorkspaceKey(state: string, huntNumber: string) {
  return `${state.toLowerCase()}:${huntNumber.toUpperCase()}`
}

function createId(prefix: 'layer' | 'pin') {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  return `${prefix}_${random}`
}

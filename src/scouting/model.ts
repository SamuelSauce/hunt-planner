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
export type ScoutLayerKind = 'hunt-default' | 'custom'

export type ScoutHuntContext = {
  state: string
  huntNumber: string
  huntName: string
  species: string
  gender: string
  weapon: string
}

export type ScoutLayer = {
  id: string
  name: string
  visible: boolean
  sortOrder: number
  color: string
  hunt: ScoutHuntContext
  kind: ScoutLayerKind
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

/**
 * Version-one workspaces remain the portable format used by saved per-hunt
 * database rows and public share snapshots.
 */
export type ScoutWorkspace = {
  version: 1
  state: string
  huntNumber: string
  name: string
  layers: ScoutLayer[]
  pins: ScoutPin[]
  updatedAt: number
}

/**
 * The private editing model is global. Every layer carries its originating
 * hunt so the same library can be opened from any hunt map.
 */
export type ScoutLibrary = {
  version: 2
  layers: ScoutLayer[]
  pins: ScoutPin[]
  updatedAt: number
}

type ScoutMapData = Pick<ScoutLibrary, 'layers' | 'pins'>

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
export const SCOUT_LAYER_NAME_LIMIT = 120
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

export function createScoutLibrary(now = Date.now()): ScoutLibrary {
  return {
    version: 2,
    layers: [],
    pins: [],
    updatedAt: now,
  }
}

export function createScoutWorkspace(
  state: string,
  huntNumber: string,
  name: string,
  now = Date.now(),
): ScoutWorkspace {
  const hunt: ScoutHuntContext = {
    state,
    huntNumber,
    huntName: name,
    species: '',
    gender: '',
    weapon: '',
  }
  return {
    version: 1,
    state,
    huntNumber,
    name,
    layers: [createHuntDefaultLayer(hunt, 0, now)],
    pins: [],
    updatedAt: now,
  }
}

export function createHuntDefaultLayer(
  hunt: ScoutHuntContext,
  sortOrder: number,
  now = Date.now(),
): ScoutLayer {
  return createScoutLayer(
    defaultScoutLayerName(hunt),
    sortOrder,
    hunt,
    SCOUT_LAYER_COLORS[sortOrder % SCOUT_LAYER_COLORS.length],
    now,
    'hunt-default',
  )
}

export function createScoutLayer(
  name: string,
  sortOrder: number,
  hunt: ScoutHuntContext,
  color = SCOUT_LAYER_COLORS[sortOrder % SCOUT_LAYER_COLORS.length],
  now = Date.now(),
  kind: ScoutLayerKind = 'custom',
): ScoutLayer {
  return {
    id: createId('layer'),
    name: name.trim().slice(0, SCOUT_LAYER_NAME_LIMIT) || `Layer ${sortOrder + 1}`,
    visible: true,
    sortOrder,
    color,
    hunt: normalizeScoutHunt(hunt),
    kind,
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

export function defaultScoutLayerName(hunt: ScoutHuntContext) {
  const detail = [
    scoutWeaponAbbreviation(hunt.weapon),
    [hunt.gender, hunt.species].filter(Boolean).join(' '),
    hunt.huntName,
  ].filter(Boolean).join(', ')
  return `${hunt.huntNumber.toUpperCase()}${detail ? ` · ${detail}` : ''}`
    .slice(0, SCOUT_LAYER_NAME_LIMIT)
}

export function scoutWeaponAbbreviation(weapon: string) {
  const normalized = weapon.trim().toLowerCase()
  if (!normalized) return ''
  if (normalized.includes('hamss')) return 'HAMSS'
  if (normalized.includes('dedicated hunter')) return 'DH'
  if (normalized.includes('multiseason')) {
    return normalized.includes('restricted') ? 'R-MULTI' : 'MULTI'
  }
  if (normalized.includes('any legal weapon')) {
    if (normalized.includes('late')) return 'ALW Late'
    if (normalized.includes('early')) return 'ALW Early'
    return 'ALW'
  }
  if (normalized.includes('muzzleloader')) {
    return normalized.includes('restricted') ? 'R-MZ' : 'MZ'
  }
  if (normalized.includes('archery')) {
    return normalized.includes('restricted') ? 'R-ARCH' : 'ARCH'
  }
  if (normalized.includes('rifle')) {
    return normalized.includes('restricted') ? 'R-RIFLE' : 'RIFLE'
  }
  return weapon.trim()
}

export function sameScoutHunt(a: ScoutHuntContext, b: ScoutHuntContext) {
  return (
    a.state.toLowerCase() === b.state.toLowerCase() &&
    a.huntNumber.toUpperCase() === b.huntNumber.toUpperCase()
  )
}

/**
 * Resets view-only visibility for a newly opened map and supplies a provisional
 * default layer. The provisional layer is omitted from persistence until it
 * receives its first pin.
 */
export function scoutLibraryForHunt(
  library: ScoutLibrary,
  hunt: ScoutHuntContext,
  now = Date.now(),
): ScoutLibrary {
  const layers = library.layers.map((layer) => ({
    ...layer,
    visible: sameScoutHunt(layer.hunt, hunt),
  }))
  if (!layers.some((layer) => layer.kind === 'hunt-default' && sameScoutHunt(layer.hunt, hunt))) {
    layers.push(createHuntDefaultLayer(hunt, layers.length, now))
  }
  return { ...library, layers }
}

/**
 * Visibility belongs to the current map session, not the saved library.
 * Unused default layers are also removed so opening a hunt never writes data.
 */
export function scoutLibraryForPersistence(library: ScoutLibrary): ScoutLibrary {
  const populatedLayerIds = new Set(library.pins.map((pin) => pin.layerId))
  const layers = library.layers
    .filter((layer) => layer.kind !== 'hunt-default' || populatedLayerIds.has(layer.id))
    .map((layer, sortOrder) => ({ ...layer, visible: false, sortOrder }))
  const layerIds = new Set(layers.map((layer) => layer.id))
  const pins = library.pins.filter((pin) => layerIds.has(pin.layerId))
  const updatedAt = Math.max(
    0,
    ...layers.flatMap((layer) => [layer.createdAt, layer.updatedAt]),
    ...pins.flatMap((pin) => [pin.createdAt, pin.updatedAt]),
  )
  return { version: 2, layers, pins, updatedAt }
}

export function scoutWorkspaceFromLibrary(
  library: ScoutLibrary,
  hunt: ScoutHuntContext,
): ScoutWorkspace {
  return {
    version: 1,
    state: hunt.state,
    huntNumber: hunt.huntNumber,
    name: hunt.huntName,
    layers: library.layers,
    pins: library.pins,
    updatedAt: library.updatedAt,
  }
}

export function scoutLibraryFromWorkspaces(
  workspaces: ScoutWorkspace[],
  now = Date.now(),
): ScoutLibrary {
  const layers: ScoutLayer[] = []
  const pins: ScoutPin[] = []
  const layerIds = new Set<string>()
  const pinIds = new Set<string>()

  for (const workspace of workspaces) {
    const fallbackHunt: ScoutHuntContext = {
      state: workspace.state,
      huntNumber: workspace.huntNumber,
      huntName: workspace.name,
      species: workspace.pins[0]?.species ?? '',
      gender: '',
      weapon: '',
    }
    const remappedLayerIds = new Map<string, string>()

    workspace.layers.forEach((sourceLayer, index) => {
      const hunt = sourceLayer.hunt ?? fallbackHunt
      const kind = sourceLayer.kind ??
        (index === 0 && sourceLayer.name.trim().toLowerCase() === 'scratch'
          ? 'hunt-default'
          : 'custom')
      let id = sourceLayer.id
      if (layerIds.has(id)) id = createId('layer')
      layerIds.add(id)
      remappedLayerIds.set(sourceLayer.id, id)
      layers.push({
        ...sourceLayer,
        id,
        hunt: normalizeScoutHunt(hunt),
        kind,
        name: kind === 'hunt-default' && sourceLayer.name.trim().toLowerCase() === 'scratch'
          ? defaultScoutLayerName(hunt)
          : sourceLayer.name,
        visible: false,
        sortOrder: layers.length,
      })
    })

    for (const sourcePin of workspace.pins) {
      if (pinIds.has(sourcePin.id)) continue
      const layerId = remappedLayerIds.get(sourcePin.layerId)
      if (!layerId) continue
      pinIds.add(sourcePin.id)
      pins.push({ ...sourcePin, layerId })
    }
  }

  return {
    version: 2,
    layers,
    pins,
    updatedAt: Math.max(now, ...workspaces.map((workspace) => workspace.updatedAt)),
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
  workspace: ScoutMapData,
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
  workspace: ScoutMapData,
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

export function mergeScoutLibraries(
  remote: ScoutLibrary | null,
  draft: ScoutLibrary,
  now = Date.now(),
): ScoutLibrary {
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

function normalizeScoutHunt(hunt: ScoutHuntContext): ScoutHuntContext {
  return {
    state: hunt.state.toLowerCase(),
    huntNumber: hunt.huntNumber.toUpperCase(),
    huntName: hunt.huntName.trim(),
    species: hunt.species.trim(),
    gender: hunt.gender.trim(),
    weapon: hunt.weapon.trim(),
  }
}

function createId(prefix: 'layer' | 'pin') {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  return `${prefix}_${random}`
}

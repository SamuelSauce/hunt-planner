import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createScoutPin,
  createScoutWorkspace,
  filterScoutPins,
  mergeScoutWorkspaces,
  scoutPinColor,
  scoutPinsGeoJson,
} from '../src/scouting/model.ts'

function sampleWorkspace() {
  const workspace = createScoutWorkspace('utah', 'DB1001', 'Paunsaugunt', 100)
  workspace.pins = [
    createScoutPin({
      layerId: workspace.layers[0].id,
      location: { latitude: 37.5, longitude: -112.3 },
      title: 'Desktop water',
      type: 'water',
      status: 'e-scout',
      species: 'Deer',
      observationYear: 2026,
      notes: '',
      waterSeasonality: 'unknown',
      colorOverride: null,
    }, 101),
    createScoutPin({
      layerId: workspace.layers[0].id,
      location: { latitude: 37.6, longitude: -112.4 },
      title: 'Field bedding',
      type: 'bedding',
      status: 'field',
      species: 'Deer',
      observationYear: 2025,
      notes: '',
      waterSeasonality: 'unknown',
      colorOverride: null,
    }, 102),
  ]
  return workspace
}

test('semantic colors prioritize water and field confirmation', () => {
  const workspace = sampleWorkspace()
  workspace.layers[0].color = '#a56de2'

  assert.equal(scoutPinColor(workspace.pins[0]), '#2f80ed')
  assert.equal(scoutPinColor(workspace.pins[1]), '#e95727')
  workspace.pins[1].status = 'e-scout'
  assert.equal(scoutPinColor(workspace.pins[1]), '#f2c94c')
})

test('filters combine layer visibility, scouting status, and year', () => {
  const workspace = sampleWorkspace()

  assert.equal(filterScoutPins(workspace, {
    status: 'field',
    observationYear: 2025,
  }).length, 1)
  workspace.layers[0].visible = false
  assert.equal(filterScoutPins(workspace, {
    status: 'all',
    observationYear: 'all',
  }).length, 0)
})

test('GeoJSON output keeps exact coordinates and map-facing properties', () => {
  const workspace = sampleWorkspace()
  const data = scoutPinsGeoJson(workspace, {
    status: 'all',
    observationYear: 'all',
  })

  assert.equal(data.features.length, 2)
  assert.deepEqual(data.features[0].geometry.coordinates, [-112.3, 37.5])
  assert.equal(data.features[0].properties.glyph, 'W')
})

test('guest work merges into a signed-in workspace without replacing remote pins', () => {
  const remote = sampleWorkspace()
  const draft = createScoutWorkspace('utah', 'DB1001', 'Paunsaugunt', 200)
  draft.pins.push(createScoutPin({
    layerId: draft.layers[0].id,
    location: { latitude: 37.7, longitude: -112.5 },
    title: 'Guest glassing',
    type: 'glassing',
    status: 'e-scout',
    species: 'Deer',
    observationYear: 2026,
    notes: '',
    waterSeasonality: 'unknown',
    colorOverride: null,
  }, 201))

  const merged = mergeScoutWorkspaces(remote, draft, 300)

  assert.equal(merged.layers.length, 2)
  assert.equal(merged.pins.length, 3)
  assert.equal(merged.updatedAt, 300)
})

test('builds a dense 1,000-pin feature collection for MapLibre clustering', () => {
  const workspace = sampleWorkspace()
  workspace.pins = Array.from({ length: 1_000 }, (_, index) => createScoutPin({
    layerId: workspace.layers[0].id,
    location: {
      latitude: 37.2 + (index % 25) * 0.01,
      longitude: -112.8 + Math.floor(index / 25) * 0.01,
    },
    title: `Pin ${index + 1}`,
    type: index % 2 === 0 ? 'glassing' : 'bedding',
    status: index % 3 === 0 ? 'field' : 'e-scout',
    species: 'Deer',
    observationYear: 2026,
    notes: '',
    waterSeasonality: 'unknown',
    colorOverride: null,
  }, 1_000 + index))

  const data = scoutPinsGeoJson(workspace, {
    status: 'all',
    observationYear: 'all',
  })

  assert.equal(data.features.length, 1_000)
  assert.equal(data.features[999].properties.title, 'Pin 1000')
})

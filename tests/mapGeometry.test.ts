import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  geometryArea,
  geometryContainsCoordinate,
  type PolygonGeometry,
} from '../src/mapGeometry.ts'

type BoundaryFeature = {
  id: string
  geometry: PolygonGeometry
}

const boundaryData = JSON.parse(
  readFileSync(
    new URL('../public/data/boundaries/utah-antlerless-2026.json', import.meta.url),
    'utf8',
  ),
) as { features: BoundaryFeature[] }

const saltLake = boundaryData.features.find((feature) => feature.id === '234')
const westCentral = boundaryData.features.find((feature) => feature.id === '845')
const overlappingWasatchCoordinate: [number, number] = [-111.687087654321, 40.599267901235]

test('the Wasatch cursor point resolves to both overlapping hunt boundaries', () => {
  assert.ok(saltLake)
  assert.ok(westCentral)
  assert.equal(
    geometryContainsCoordinate(saltLake.geometry, overlappingWasatchCoordinate),
    true,
  )
  assert.equal(
    geometryContainsCoordinate(westCentral.geometry, overlappingWasatchCoordinate),
    true,
  )
})

test('the smaller EA1110 boundary is more specific than the EA1299/EA1300 boundary', () => {
  assert.ok(saltLake)
  assert.ok(westCentral)
  assert.ok(geometryArea(saltLake.geometry) < geometryArea(westCentral.geometry))
})

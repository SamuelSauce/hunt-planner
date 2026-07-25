import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  defaultLandAccessForHunt,
  huntLandAccess,
  matchesLandAccess,
} from '../src/landAccess.ts'

type Hunt = {
  huntNumber: string
  huntType: string
}

const plannerData = JSON.parse(
  readFileSync(new URL('../src/data/udwr-data.json', import.meta.url), 'utf8'),
) as { hunts: Hunt[] }

const ea1110 = plannerData.hunts.find((hunt) => hunt.huntNumber === 'EA1110')
const ea2012 = plannerData.hunts.find((hunt) => hunt.huntNumber === 'EA2012')

test('Wasatch standard and private-only hunts are assigned to separate land access views', () => {
  assert.ok(ea1110)
  assert.ok(ea2012)
  assert.equal(huntLandAccess(ea1110), 'public-mixed')
  assert.equal(huntLandAccess(ea2012), 'private-only')
  assert.equal(matchesLandAccess(ea1110, 'public-mixed'), true)
  assert.equal(matchesLandAccess(ea2012, 'public-mixed'), false)
  assert.equal(matchesLandAccess(ea1110, 'private-only'), false)
  assert.equal(matchesLandAccess(ea2012, 'private-only'), true)
})

test('deep links default to the land access view containing their hunt', () => {
  assert.ok(ea1110)
  assert.ok(ea2012)
  assert.equal(defaultLandAccessForHunt(ea1110), 'public-mixed')
  assert.equal(defaultLandAccessForHunt(ea2012), 'private-only')
})

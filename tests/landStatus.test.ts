import assert from 'node:assert/strict'
import test from 'node:test'
import { landStatusFromIdentifyResults } from '../src/landStatus.ts'

test('identifies Forest Service land as public when the BLM result has no unit name', () => {
  assert.deepEqual(
    landStatusFromIdentifyResults([
      {
        attributes: {
          ADMIN_UNIT_NAME: 'Null',
          ADMIN_DEPT_CODE: 'USDA',
          ADMIN_AGENCY_CODE: 'USFS',
        },
      },
    ]),
    {
      agency: 'U.S. Forest Service',
      label: 'U.S. Forest Service',
      access: 'Public land · agency rules apply',
      category: 'public',
    },
  )
})

test('preserves a specific BLM management unit name', () => {
  assert.deepEqual(
    landStatusFromIdentifyResults([
      {
        attributes: {
          ADMIN_UNIT_NAME: 'Salt Lake Field Office',
          ADMIN_AGENCY_CODE: 'BLM',
        },
      },
    ]),
    {
      agency: 'Bureau of Land Management',
      label: 'Salt Lake Field Office',
      access: 'Public land · agency rules apply',
      category: 'public',
    },
  )
})

test('labels private or unknown land conservatively', () => {
  assert.deepEqual(
    landStatusFromIdentifyResults([
      {
        attributes: {
          ADMIN_UNIT_NAME: 'Null',
          ADMIN_AGENCY_CODE: 'PVT',
        },
      },
    ]),
    {
      agency: 'Private or unknown',
      label: 'Private or unknown',
      access: 'Treat as private · permission required',
      category: 'private',
    },
  )
})

test('returns no status when the service has no identifiable result', () => {
  assert.equal(landStatusFromIdentifyResults([]), null)
  assert.equal(landStatusFromIdentifyResults([{ attributes: {} }]), null)
})

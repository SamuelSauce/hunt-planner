import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  buildWeaponFilterOptions,
  matchesWeaponFilter,
  seasonStartMonth,
  weaponFilterValue,
} from '../src/huntFilters.ts'

type Hunt = {
  id: string
  huntNumber: string
  species: string
  category: string
  weapon: string
  seasonDateText: string | null
}

function readHunts(fileName: string) {
  return (
    JSON.parse(
      readFileSync(new URL(`../src/data/${fileName}`, import.meta.url), 'utf8'),
    ) as { hunts: Hunt[] }
  ).hunts
}

const idahoHunts = readHunts('idfg-data.json')
const utahHunts = readHunts('udwr-data.json')
const wyomingHunts = readHunts('wgfd-data.json')
const coloradoHunts = readHunts('cpw-data.json')

test('season start parsing supports agency date formats without borrowing alternate seasons', () => {
  assert.equal(seasonStartMonth('10/10/26 - 11/3/26'), 'October')
  assert.equal(seasonStartMonth('8/30/26 - 9/30/26'), 'August')
  assert.equal(seasonStartMonth('Sept 16-20, 2026'), 'September')
  assert.equal(seasonStartMonth('November 1, 2026 - November 30, 2026'), 'November')
  assert.equal(seasonStartMonth('Nov. 1 - Nov. 30'), 'November')
  assert.equal(seasonStartMonth('- (archery: Sep. 1 - Sep. 30)'), null)
  assert.equal(seasonStartMonth('2026 primary draw'), null)
  assert.equal(seasonStartMonth(null), null)
})

test('weapon options retain an all-season choice and add chronological month choices', () => {
  const options = buildWeaponFilterOptions([
    { weapon: 'Any Weapon', seasonDateText: '11/1/26 - 11/30/26' },
    { weapon: 'Any Weapon', seasonDateText: null },
    { weapon: 'Any Weapon', seasonDateText: '10/1/26 - 10/31/26' },
    { weapon: 'Muzzleloader', seasonDateText: '12/1/26 - 12/31/26' },
  ])

  assert.deepEqual(options, [
    { value: 'all', label: 'All weapons & seasons' },
    { value: 'Any Weapon', label: 'Any Weapon — all seasons' },
    { value: 'Any Weapon::October', label: 'Any Weapon — October' },
    { value: 'Any Weapon::November', label: 'Any Weapon — November' },
    {
      value: 'Any Weapon::Season date not listed',
      label: 'Any Weapon — Season date not listed',
    },
    { value: 'Muzzleloader', label: 'Muzzleloader' },
  ])
})

test('raw weapon filters remain broad while month-qualified filters are exact', () => {
  const october = { weapon: 'Any Weapon', seasonDateText: '10/15/26 - 11/3/26' }
  const november = { weapon: 'Any Weapon', seasonDateText: '11/1/26 - 11/30/26' }

  assert.equal(matchesWeaponFilter(october, 'Any Weapon'), true)
  assert.equal(matchesWeaponFilter(november, 'Any Weapon'), true)
  assert.equal(matchesWeaponFilter(october, 'Any Weapon::October'), true)
  assert.equal(matchesWeaponFilter(november, 'Any Weapon::October'), false)
  assert.equal(weaponFilterValue(november), 'Any Weapon::November')
})

test('Idaho duplicate hunt numbers can be isolated by their season filter', () => {
  const duplicateSeasons = idahoHunts.filter((hunt) => hunt.huntNumber === '2145')
  assert.equal(duplicateSeasons.length, 2)
  assert.deepEqual(
    duplicateSeasons.map(weaponFilterValue).sort(),
    ['Muzzleloader::December', 'Muzzleloader::November'],
  )

  const november = duplicateSeasons.filter((hunt) => (
    matchesWeaponFilter(hunt, 'Muzzleloader::November')
  ))
  const december = duplicateSeasons.filter((hunt) => (
    matchesWeaponFilter(hunt, 'Muzzleloader::December')
  ))
  assert.equal(november.length, 1)
  assert.equal(december.length, 1)
  assert.notEqual(november[0].id, december[0].id)
})

test('Idaho Elk gains useful month choices and each choice narrows the scoped hunts', () => {
  const controlledElk = idahoHunts.filter((hunt) => (
    hunt.species === 'Elk' && hunt.category === 'limited-entry'
  ))
  const options = buildWeaponFilterOptions(controlledElk)
  const anyWeaponMonths = options
    .map((option) => option.value)
    .filter((value) => value.startsWith('Any Weapon::'))

  assert.ok(anyWeaponMonths.includes('Any Weapon::October'))
  assert.ok(anyWeaponMonths.includes('Any Weapon::November'))
  assert.ok(anyWeaponMonths.length > 2)

  for (const filter of anyWeaponMonths) {
    const matches = controlledElk.filter((hunt) => matchesWeaponFilter(hunt, filter))
    assert.ok(matches.length > 0)
    assert.ok(matches.length < controlledElk.length)
    assert.ok(matches.every((hunt) => weaponFilterValue(hunt) === filter))
  }
})

test('existing Utah Elk season values remain available and Wyoming gains the same behavior', () => {
  const utahLimitedElk = utahHunts.filter((hunt) => (
    hunt.species === 'Elk' && hunt.category === 'limited-entry'
  ))
  const utahValues = new Set(
    buildWeaponFilterOptions(utahLimitedElk).map((option) => option.value),
  )
  assert.ok(utahValues.has('Any Legal Weapon::October'))
  assert.ok(utahValues.has('Any Legal Weapon::November'))
  assert.ok(utahValues.has('Archery::August'))
  assert.ok(utahValues.has('Archery::November'))

  const wyomingElk = wyomingHunts.filter((hunt) => hunt.species === 'Elk')
  const wyomingValues = new Set(
    buildWeaponFilterOptions(wyomingElk).map((option) => option.value),
  )
  assert.ok(wyomingValues.has('Any Legal Weapon::October'))
  assert.ok(wyomingValues.has('Any Legal Weapon::November'))
  assert.ok(wyomingValues.has('Any Legal Weapon::December'))
})

test('Colorado hunt codes provide method and numbered-season filters when dates are absent', () => {
  const regularArchery = coloradoHunts.find((hunt) => hunt.huntNumber === 'EE001O1A')
  const regularMuzzleloader = coloradoHunts.find((hunt) => hunt.huntNumber === 'EF001O1M')
  const secondRifle = coloradoHunts.find((hunt) => hunt.huntNumber === 'EF001O2R')
  const privateArchery = coloradoHunts.find((hunt) => hunt.huntNumber === 'EE003P1A')

  assert.ok(regularArchery)
  assert.ok(regularMuzzleloader)
  assert.ok(secondRifle)
  assert.ok(privateArchery)
  assert.equal(weaponFilterValue(regularArchery), 'Archery::1st season')
  assert.equal(weaponFilterValue(regularMuzzleloader), 'Muzzleloader::1st season')
  assert.equal(weaponFilterValue(secondRifle), 'Rifle::2nd season')
  assert.equal(
    weaponFilterValue(privateArchery),
    'Private-land-only::Archery · 1st season',
  )

  const coloradoElk = coloradoHunts.filter((hunt) => hunt.species === 'Elk')
  const values = new Set(
    buildWeaponFilterOptions(coloradoElk).map((option) => option.value),
  )
  assert.ok(values.has('Archery'))
  assert.ok(values.has('Muzzleloader'))
  assert.ok(values.has('Rifle::1st season'))
  assert.ok(values.has('Rifle::2nd season'))
  assert.ok(values.has('Rifle::3rd season'))
  assert.ok(values.has('Rifle::4th season'))
})

test('every generated option matches at least one hunt in its scoped data', () => {
  for (const hunts of [idahoHunts, utahHunts, wyomingHunts, coloradoHunts]) {
    const scopes = new Map<string, Hunt[]>()
    for (const hunt of hunts) {
      const key = `${hunt.species}::${hunt.category}`
      const matches = scopes.get(key) ?? []
      matches.push(hunt)
      scopes.set(key, matches)
    }

    for (const scopedHunts of scopes.values()) {
      for (const option of buildWeaponFilterOptions(scopedHunts)) {
        assert.ok(scopedHunts.some((hunt) => matchesWeaponFilter(hunt, option.value)))
      }
    }
  }
})

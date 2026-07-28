const FILTER_SEPARATOR = '::'
const UNDATED_SEASON = 'Season date not listed'

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const

type HuntFilterRecord = {
  state?: string
  huntNumber?: string
  weapon: string
  seasonDateText: string | null
}

export type WeaponFilterOption = {
  value: string
  label: string
}

export function buildWeaponFilterOptions(
  hunts: HuntFilterRecord[],
): WeaponFilterOption[] {
  const byWeapon = new Map<string, HuntFilterRecord[]>()

  for (const hunt of hunts) {
    const weapon = weaponFilterName(hunt)
    if (!weapon) continue
    const matches = byWeapon.get(weapon) ?? []
    matches.push(hunt)
    byWeapon.set(weapon, matches)
  }

  const options: WeaponFilterOption[] = [
    { value: 'all', label: 'All weapons & seasons' },
  ]

  for (const [weapon, matchingHunts] of [...byWeapon].sort(([a], [b]) => (
    a.localeCompare(b)
  ))) {
    const seasonBuckets = uniqueSeasonBuckets(matchingHunts)
    const hasSeasonChoices = seasonBuckets.length > 1

    options.push({
      value: weapon,
      label: hasSeasonChoices ? `${weapon} — all seasons` : weapon,
    })

    if (!hasSeasonChoices) continue
    for (const season of seasonBuckets) {
      const value = `${weapon}${FILTER_SEPARATOR}${season}`
      options.push({ value, label: weaponFilterLabel(value) })
    }
  }

  return options
}

export function matchesWeaponFilter(
  hunt: HuntFilterRecord,
  filter: string,
) {
  if (filter === 'all') return true

  const separatorIndex = filter.indexOf(FILTER_SEPARATOR)
  if (separatorIndex === -1) return weaponFilterName(hunt) === filter

  const weapon = filter.slice(0, separatorIndex)
  const season = filter.slice(separatorIndex + FILTER_SEPARATOR.length)
  return (
    weaponFilterName(hunt) === weapon
    && seasonFilterBucket(hunt) === season
  )
}

export function weaponFilterValue(hunt: HuntFilterRecord) {
  return `${weaponFilterName(hunt)}${FILTER_SEPARATOR}${seasonFilterBucket(hunt)}`
}

export function weaponFilterLabel(value: string) {
  const separatorIndex = value.indexOf(FILTER_SEPARATOR)
  if (separatorIndex === -1) return value

  const weapon = value.slice(0, separatorIndex)
  const season = value.slice(separatorIndex + FILTER_SEPARATOR.length)
  return `${weapon} — ${season}`
}

export function seasonStartMonth(value: string | null) {
  const season = value?.trim()
  if (!season || season.startsWith('-')) return null

  const numeric = season.match(/^(\d{1,2})\s*\/\s*\d{1,2}(?:\s*\/\s*\d{2,4})?/)
  if (numeric) {
    const monthNumber = Number(numeric[1])
    return MONTHS[monthNumber - 1] ?? null
  }

  const named = season.match(
    /^(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\b/i,
  )
  if (!named) return null

  const prefix = named[1].slice(0, 3).toLowerCase()
  return MONTHS.find((month) => month.slice(0, 3).toLowerCase() === prefix) ?? null
}

function uniqueSeasonBuckets(hunts: HuntFilterRecord[]) {
  const buckets = new Set(hunts.map(seasonFilterBucket))
  return [...buckets].sort((a, b) => (
    seasonBucketRank(a) - seasonBucketRank(b) || a.localeCompare(b)
  ))
}

function seasonBucketRank(value: string) {
  const monthIndex = MONTHS.indexOf(value as (typeof MONTHS)[number])
  if (monthIndex !== -1) return monthIndex
  if (value === UNDATED_SEASON) return 1_000

  const seasonNumber = Number(value.match(/\b(\d+)(?:st|nd|rd|th)\b/)?.[1] ?? 0)
  return seasonNumber > 0 ? 100 + seasonNumber : 900
}

function weaponFilterName(hunt: HuntFilterRecord) {
  const code = coloradoHuntCodeParts(hunt)
  if (code?.seasonType === 'O') {
    return coloradoMethodLabel(code.method)
  }
  return hunt.weapon.trim()
}

function seasonFilterBucket(hunt: HuntFilterRecord) {
  const month = seasonStartMonth(hunt.seasonDateText)
  if (month) return month

  const code = coloradoHuntCodeParts(hunt)
  if (!code) return UNDATED_SEASON

  const season = `${ordinal(code.seasonNumber)} season`
  const method = coloradoMethodLabel(code.method)
  const weaponAlreadyNamesMethod = (
    code.seasonType === 'O'
    || hunt.weapon.toLowerCase().includes(method.toLowerCase())
  )
  return weaponAlreadyNamesMethod ? season : `${method} · ${season}`
}

function coloradoHuntCodeParts(hunt: HuntFilterRecord) {
  if (hunt.state !== 'colorado' || !hunt.huntNumber) return null
  const code = hunt.huntNumber.toUpperCase()
  if (!/^[A-Z]{2}[A-Z0-9]{3}[A-Z][1-9][AMRX]$/.test(code)) return null
  return {
    seasonType: code[5],
    seasonNumber: Number(code[6]),
    method: code[7],
  }
}

function coloradoMethodLabel(method: string) {
  return {
    A: 'Archery',
    M: 'Muzzleloader',
    R: 'Rifle',
    X: 'Season choice',
  }[method] ?? 'Method by hunt code'
}

function ordinal(value: number) {
  const remainder100 = value % 100
  if (remainder100 >= 11 && remainder100 <= 13) return `${value}th`
  if (value % 10 === 1) return `${value}st`
  if (value % 10 === 2) return `${value}nd`
  if (value % 10 === 3) return `${value}rd`
  return `${value}th`
}

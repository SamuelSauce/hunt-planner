const FILTER_SEPARATOR = '::'
const UNDATED_SEASON = 'Season date not listed'
const OPERATOR_DATES = 'Dates set by operator'
const MULTIPLE_SEASONS = 'Multiple seasons'
const QUALIFYING_PERMIT_DATES = 'Dates follow qualifying permit'
const VARIABLE_SEASON = 'Season details vary'
const CLOSED_HUNT = 'Closed'
const PREFERENCE_POINT_ONLY = 'Preference point only'
const NOT_A_HUNT_SEASON = 'Not a hunt season'
const EXACT_SEASON_PREFIX = 'Exact dates · '

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
  huntName?: string
  gender?: string
  mapUnitIds?: string[]
  weapon: string
  seasonDateText: string | null
}

type HuntFilterMembership = {
  weapon: string
  season: string
  exactSeason: string | null
}

type HuntFilterMembershipRecord = {
  hunt: HuntFilterRecord
  membership: HuntFilterMembership
}

export type WeaponFilterOption = {
  value: string
  label: string
}

export function buildWeaponFilterOptions(
  hunts: HuntFilterRecord[],
): WeaponFilterOption[] {
  const byWeapon = new Map<string, HuntFilterMembershipRecord[]>()

  for (const hunt of hunts) {
    for (const membership of huntFilterMemberships(hunt)) {
      if (!membership.weapon) continue
      const weapon = seasonWeaponName(membership.weapon)
      const matches = byWeapon.get(weapon) ?? []
      matches.push({ hunt, membership })
      byWeapon.set(weapon, matches)
    }
  }

  const options: WeaponFilterOption[] = [
    { value: 'all', label: 'All weapons & seasons' },
  ]

  for (const [weapon, matchingRecords] of [...byWeapon].sort(([a], [b]) => (
    a.localeCompare(b)
  ))) {
    const seasonBuckets = uniqueSeasonBuckets(matchingRecords)
    const exactSeasons = new Map(
      seasonBuckets.map((season) => [
        season,
        overlappingExactSeasons(matchingRecords, season),
      ]),
    )
    const weaponAliases = [
      ...new Set(
        matchingRecords
          .map(({ membership }) => membership.weapon)
          .filter((name) => name !== weapon),
      ),
    ].sort()
    const hasSeasonChoices = (
      seasonBuckets.length > 1
      || [...exactSeasons.values()].some((seasons) => seasons.length > 1)
      || weaponAliases.length > 0
    )

    options.push({
      value: weapon,
      label: hasSeasonChoices ? `${weapon} — all seasons` : weapon,
    })

    if (!hasSeasonChoices) continue
    for (const alias of weaponAliases) {
      options.push({ value: alias, label: weaponAliasLabel(alias) })
    }
    for (const season of seasonBuckets) {
      const value = `${weapon}${FILTER_SEPARATOR}${season}`
      options.push({ value, label: weaponFilterLabel(value) })
      for (const exactSeason of exactSeasons.get(season) ?? []) {
        const exactValue = `${weapon}${FILTER_SEPARATOR}${exactSeason}`
        options.push({ value: exactValue, label: weaponFilterLabel(exactValue) })
      }
    }
  }

  return options
}

export function matchesWeaponFilter(
  hunt: HuntFilterRecord,
  filter: string,
) {
  if (filter === 'all') return true

  const memberships = huntFilterMemberships(hunt)
  const separatorIndex = filter.indexOf(FILTER_SEPARATOR)
  if (separatorIndex === -1) {
    const normalizedFilter = seasonWeaponName(filter)
    return normalizedFilter === filter
      ? memberships.some((membership) => (
        seasonWeaponName(membership.weapon) === normalizedFilter
      ))
      : memberships.some((membership) => membership.weapon === filter)
  }

  const weapon = filter.slice(0, separatorIndex)
  const season = filter.slice(separatorIndex + FILTER_SEPARATOR.length)
  return memberships.some((membership) => (
    seasonWeaponName(membership.weapon) === seasonWeaponName(weapon)
    && (membership.season === season || membership.exactSeason === season)
  ))
}

export function weaponFilterValue(hunt: HuntFilterRecord) {
  const membership = huntFilterMemberships(hunt)[0]
  if (!membership) return ''
  return `${seasonWeaponName(membership.weapon)}${FILTER_SEPARATOR}${membership.season}`
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

function uniqueSeasonBuckets(records: HuntFilterMembershipRecord[]) {
  const buckets = new Set(records.map(({ membership }) => membership.season))
  return [...buckets].sort((a, b) => (
    seasonBucketRank(a) - seasonBucketRank(b) || a.localeCompare(b)
  ))
}

function seasonBucketRank(value: string) {
  const monthIndex = MONTHS.indexOf(value as (typeof MONTHS)[number])
  if (monthIndex !== -1) return monthIndex
  if (value === UNDATED_SEASON) return 1_000
  if (value === NOT_A_HUNT_SEASON || value === CLOSED_HUNT) return 1_100

  const seasonNumber = Number(value.match(/\b(\d+)(?:st|nd|rd|th)\b/)?.[1] ?? 0)
  return seasonNumber > 0 ? 100 + seasonNumber : 900
}

function huntFilterMemberships(hunt: HuntFilterRecord): HuntFilterMembership[] {
  if (isColoradoPreferencePointRecord(hunt)) {
    return [{
      weapon: PREFERENCE_POINT_ONLY,
      season: NOT_A_HUNT_SEASON,
      exactSeason: null,
    }]
  }

  if (hunt.gender?.trim().toLowerCase() === 'closed') {
    return [{
      weapon: CLOSED_HUNT,
      season: CLOSED_HUNT,
      exactSeason: null,
    }]
  }

  const code = coloradoHuntCodeParts(hunt)
  if (code) {
    return [{
      weapon: coloradoMethodLabel(code.method),
      season: coloradoSeasonBucket(code),
      exactSeason: null,
    }]
  }

  const wyomingParts = wyomingSeasonParts(hunt)
  if (wyomingParts) {
    const memberships: HuntFilterMembership[] = []
    if (wyomingParts.primary) {
      memberships.push(
        membershipForSeasonText(hunt.weapon.trim(), wyomingParts.primary),
      )
    }
    if (wyomingParts.archery) {
      memberships.push(
        membershipForSeasonText('Archery', wyomingParts.archery),
      )
    }
    if (memberships.length > 0) {
      return dedupeMemberships(memberships)
    }
  }

  return [membershipForSeasonText(hunt.weapon.trim(), hunt.seasonDateText)]
}

function membershipForSeasonText(
  weapon: string,
  seasonDateText: string | null,
): HuntFilterMembership {
  const season = seasonBucketForText(weapon, seasonDateText)
  const exactSeasonText = exactSeasonTextForDate(seasonDateText)
  return {
    weapon,
    season,
    exactSeason: exactSeasonText
      ? `${EXACT_SEASON_PREFIX}${exactSeasonText}`
      : null,
  }
}

function seasonBucketForText(weapon: string, seasonDateText: string | null) {
  const seasonText = seasonDateText?.trim() ?? ''
  if (!seasonText) return UNDATED_SEASON
  if (/contact\b.*\boperator\b/i.test(seasonText)) return OPERATOR_DATES
  if (/qualifying permit/i.test(seasonText)) return QUALIFYING_PERMIT_DATES
  if (
    seasonText.includes('|')
    || (
      /multi[\s-]*season/i.test(weapon)
      && /\b(?:arch(?:ery)?|muzz(?:leloader)?|alw|any legal weapon)\s*:/i.test(seasonText)
    )
  ) {
    return MULTIPLE_SEASONS
  }

  const month = seasonStartMonth(seasonText)
  if (month) return month
  return VARIABLE_SEASON
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

function coloradoSeasonBucket(
  code: NonNullable<ReturnType<typeof coloradoHuntCodeParts>>,
) {
  const season = `${ordinal(code.seasonNumber)} season`
  const family = coloradoSeasonFamilyLabel(code.seasonType)
  return family ? `${family} · ${season}` : season
}

function coloradoSeasonFamilyLabel(seasonType: string) {
  return {
    O: '',
    P: 'Private-land-only',
    V: 'Private-land-only',
    W: 'Ranching for Wildlife',
    E: 'Early',
    L: 'Late',
    K: 'Youth',
    S: 'Special',
  }[seasonType] ?? `Season type ${seasonType}`
}

function coloradoMethodLabel(method: string) {
  return {
    A: 'Archery',
    M: 'Muzzleloader',
    R: 'Rifle',
    X: 'Season choice',
  }[method] ?? 'Method by hunt code'
}

function isColoradoPreferencePointRecord(hunt: HuntFilterRecord) {
  return (
    hunt.state?.toLowerCase() === 'colorado'
    && /^[A-Z]P99999P$/i.test(hunt.huntNumber ?? '')
  )
}

function wyomingSeasonParts(hunt: HuntFilterRecord) {
  if (hunt.state?.toLowerCase() !== 'wyoming') return null
  const match = hunt.seasonDateText?.trim().match(
    /^(.*?)\s*\(\s*archery\s*:\s*(.*?)\s*\)\s*$/i,
  )
  if (!match) return null

  const primary = usableSeasonPart(match[1])
  const archery = usableSeasonPart(match[2])
  return { primary, archery }
}

function usableSeasonPart(value: string) {
  const normalized = value.trim()
  return normalized && normalized !== '-' ? normalized : null
}

function seasonWeaponName(value: string) {
  return value
    .trim()
    .replace(/\s*\((?:early|late)\)\s*$/i, '')
    .replace(/^(?:early|late)\s+(any legal weapon)$/i, '$1')
}

function weaponAliasLabel(value: string) {
  const suffix = value.match(/\((early|late)\)\s*$/i)?.[1]
    ?? value.match(/^(early|late)\s+any legal weapon$/i)?.[1]
  return suffix
    ? `${seasonWeaponName(value)} — ${suffix.toLowerCase()} seasons`
    : value
}

function dedupeMemberships(memberships: HuntFilterMembership[]) {
  return [
    ...new Map(
      memberships.map((membership) => [
        `${membership.weapon}${FILTER_SEPARATOR}${membership.season}${FILTER_SEPARATOR}${membership.exactSeason ?? ''}`,
        membership,
      ]),
    ).values(),
  ]
}

function exactSeasonTextForDate(value: string | null) {
  const normalized = value
    ?.trim()
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
  return normalized && seasonStartMonth(normalized) ? normalized : null
}

function overlappingExactSeasons(
  records: HuntFilterMembershipRecord[],
  season: string,
) {
  const candidates = records.filter(({ membership }) => (
    membership.season === season && membership.exactSeason !== null
  ))
  const overlapping = new Set<string>()

  for (let leftIndex = 0; leftIndex < candidates.length; leftIndex += 1) {
    const left = candidates[leftIndex]
    for (let rightIndex = leftIndex + 1; rightIndex < candidates.length; rightIndex += 1) {
      const right = candidates[rightIndex]
      if (left.membership.exactSeason === right.membership.exactSeason) continue
      if (!huntBoundariesOverlap(left.hunt, right.hunt)) continue
      overlapping.add(left.membership.exactSeason!)
      overlapping.add(right.membership.exactSeason!)
    }
  }

  return [...overlapping].sort((a, b) => (
    exactSeasonRank(a) - exactSeasonRank(b) || a.localeCompare(b)
  ))
}

function huntBoundariesOverlap(left: HuntFilterRecord, right: HuntFilterRecord) {
  const leftUnits = normalizedUnitIds(left)
  const rightUnits = normalizedUnitIds(right)
  if (leftUnits.size > 0 && rightUnits.size > 0) {
    return [...leftUnits].some((unitId) => rightUnits.has(unitId))
  }

  const leftName = normalizeBoundaryName(left.huntName)
  const rightName = normalizeBoundaryName(right.huntName)
  return Boolean(leftName && rightName && leftName === rightName)
}

function normalizedUnitIds(hunt: HuntFilterRecord) {
  return new Set(
    (hunt.mapUnitIds ?? [])
      .map((unitId) => unitId.trim().toLowerCase())
      .filter(Boolean),
  )
}

function normalizeBoundaryName(value: string | undefined) {
  return value?.trim().toLowerCase().replace(/\s+/g, ' ') ?? ''
}

function exactSeasonRank(value: string) {
  const numeric = value.match(/(\d{1,2})\s*\/\s*(\d{1,2})/)
  if (numeric) return Number(numeric[1]) * 32 + Number(numeric[2])

  const named = value.match(
    /(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+(\d{1,2})/i,
  )
  if (!named) return 10_000
  const prefix = named[1].slice(0, 3).toLowerCase()
  const monthIndex = MONTHS.findIndex(
    (month) => month.slice(0, 3).toLowerCase() === prefix,
  )
  return (monthIndex + 1) * 32 + Number(named[2])
}

function ordinal(value: number) {
  const remainder100 = value % 100
  if (remainder100 >= 11 && remainder100 <= 13) return `${value}th`
  if (value % 10 === 1) return `${value}st`
  if (value % 10 === 2) return `${value}nd`
  if (value % 10 === 3) return `${value}rd`
  return `${value}th`
}

import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dataDir = path.join(rootDir, 'src', 'data')

const HUNT_PLANNER = 'https://idfg.idaho.gov/ifwis/huntplanner'
const LIST_API = `${HUNT_PLANNER}/api/1.1/list/`
const ODDS_API = `${HUNT_PLANNER}/api/1.1/odds/`

const speciesConfigs = [
  { listId: 1, oddsIds: [1], name: 'Deer', stats: 'deer' },
  { listId: 2, oddsIds: [2], name: 'Elk', stats: 'elk' },
  { listId: 3, oddsIds: [3], name: 'Pronghorn', stats: 'pronghorn' },
  { listId: 4, oddsIds: [4], name: 'Black Bear', stats: 'bear' },
  { listId: 5, oddsIds: [], name: 'Mountain Lion', stats: 'lion' },
  { listId: 6, oddsIds: [6], name: 'Moose', stats: 'moose' },
  { listId: 119, oddsIds: [7, 28], name: 'Bighorn Sheep', stats: 'sheep' },
  { listId: 8, oddsIds: [8], name: 'Mountain Goat', stats: 'goat' },
]

async function main() {
  await mkdir(dataDir, { recursive: true })

  const speciesResults = await Promise.all(speciesConfigs.map(loadSpecies))
  const hunts = speciesResults.flatMap((result) => result.hunts)
  const reports = speciesResults.flatMap((result) => result.reports)

  const data = {
    generatedAt: new Date().toISOString(),
    notices: [
      'Idaho controlled hunts use a random draw and do not use preference points.',
      'Draw odds show the latest official first-choice resident and nonresident results.',
      'Season rows use the newest year currently published by Idaho Fish and Game for each species.',
    ],
    sourcePages: {
      huntPlanner: HUNT_PLANNER,
      drawOdds: `${HUNT_PLANNER}/odds/`,
      harvestReports: `${HUNT_PLANNER}/stats/`,
      maps: 'https://data-idfggis.opendata.arcgis.com/',
    },
    reports,
    hunts: hunts.sort((a, b) =>
      a.species.localeCompare(b.species) ||
      a.huntName.localeCompare(b.huntName) ||
      a.huntNumber.localeCompare(b.huntNumber),
    ),
  }

  await writeFile(
    path.join(dataDir, 'idfg-data.json'),
    `${JSON.stringify(data, null, 2)}\n`,
  )

  console.log(`Generated ${hunts.length} Idaho hunt records across ${speciesResults.length} species.`)
}

async function loadSpecies(config) {
  const [listResult, oddsRows, controlledHarvest, generalHarvest] = await Promise.all([
    fetchList(config.listId),
    fetchOdds(config.oddsIds),
    fetchHarvest(config.stats, 'controlled'),
    fetchHarvest(config.stats, 'general'),
  ])

  const newestYear = Math.max(...listResult.rows.map((row) => seasonYear(row.open)), 0)
  const seasonRows = listResult.rows.filter((row) => seasonYear(row.open) === newestYear)
  const oddsByHunt = new Map(oddsRows.map((row) => [String(row.CHunt), row]))
  const controlledByHunt = new Map(
    controlledHarvest
      .filter((row) => row.huntNumber)
      .map((row) => [String(row.huntNumber), row]),
  )

  const hunts = seasonRows.map((row) => {
    const controlled = /controlled/i.test(row.season ?? '')
    const antlerless = /antlerless|doe|fawn|female/i.test(`${row.ornament ?? ''} ${row.tag ?? ''}`)
    const odds = oddsByHunt.get(String(row.number)) ?? null
    const harvest = controlled
      ? controlledByHunt.get(String(row.number)) ?? null
      : bestGeneralHarvest(generalHarvest, row)
    const sourceUrl = `${HUNT_PLANNER}/hunt/${row.id}`

    return {
      id: `id-${row.id}`,
      state: 'idaho',
      huntNumber: row.number ? String(row.number) : `ID-${row.id}`,
      species: config.name,
      gender: row.ornament ?? '',
      huntName: row.area ? `Area ${row.area}` : cleanName(row.tag),
      huntType: row.season ?? (controlled ? 'Controlled hunt' : 'General season'),
      category: antlerless ? 'antlerless' : controlled ? 'limited-entry' : 'general-otc',
      weapon: row.method ?? 'Weapon varies',
      planningYear: newestYear || null,
      seasonDateText: row.open && row.close ? `${row.open} - ${row.close}` : null,
      quota: Number(row.permits) > 0
        ? { resident: 0, nonresident: 0, total: Number(row.permits) }
        : null,
      currentSourceUrl: sourceUrl,
      harvest: harvest ? normalizeHarvest(harvest, config.stats) : null,
      odds: null,
      drawProfile: odds ? normalizeDrawProfile(odds) : null,
      mapUnitIds: extractUnitIds(row.area),
      licenseNotes: controlled
        ? 'Random controlled-hunt draw. Idaho does not use preference points.'
        : 'General-season opportunity; tag availability and zone rules vary.',
      sourceUrls: unique([
        sourceUrl,
        odds ? `${HUNT_PLANNER}/odds/` : '',
        harvest ? `${HUNT_PLANNER}/stats/` : '',
      ]).filter(Boolean),
    }
  })

  return {
    hunts,
    reports: [
      {
        id: `id-${config.stats}-draw-odds-2025`,
        state: 'idaho',
        sourceType: 'draw-odds',
        year: 2025,
        species: config.name,
        category: 'Controlled hunt draw odds',
        title: `${config.name} controlled hunt draw odds`,
        url: `${HUNT_PLANNER}/odds/`,
        size: 'IDFG interactive report',
      },
      {
        id: `id-${config.stats}-harvest-2025`,
        state: 'idaho',
        sourceType: 'harvest',
        year: 2025,
        species: config.name,
        category: 'Harvest statistics',
        title: `${config.name} harvest statistics`,
        url: `${HUNT_PLANNER}/stats/`,
        size: 'IDFG interactive report',
      },
    ],
  }
}

async function fetchList(game) {
  const url = new URL(LIST_API)
  url.searchParams.set('game', String(game))
  url.searchParams.set('start', '2025-01-01')
  url.searchParams.set('end', '2026-12-31')
  url.searchParams.set('limit', '5000')
  return fetchJson(url)
}

async function fetchOdds(ids) {
  const results = await Promise.all(ids.map(async (biggame) => {
    const url = new URL(ODDS_API)
    url.searchParams.set('biggame', String(biggame))
    url.searchParams.set('yr', '2025')
    url.searchParams.set('draw', '1')
    const response = await fetchJson(url)
    return response.rows ?? []
  }))
  return results.flat()
}

async function fetchHarvest(game, season) {
  try {
    const url = new URL(`${HUNT_PLANNER}/stats/`)
    url.searchParams.set('season', season)
    url.searchParams.set('game', game)
    url.searchParams.set('yr', '2025')
    const html = await fetchText(url)
    return parseHarvestTable(html, url.href)
  } catch (error) {
    console.warn(`Skipping ${game} ${season} harvest: ${error.message}`)
    return []
  }
}

function parseHarvestTable(html, sourceUrl) {
  const table = html.match(/<table\b[^>]*id="stattable"[^>]*>([\s\S]*?)<\/table>/i)?.[1]
  if (!table) return []

  const rows = [...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)]
    .map((match) => [...match[1].matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)]
      .map((cell) => cleanHtml(cell[1])))
    .filter((row) => row.length > 0)
  const headers = rows.find((row) => row.some((cell) => /success/i.test(cell))) ?? []
  const dataRows = rows.slice(rows.indexOf(headers) + 1)

  return dataRows.map((cells) => {
    const values = Object.fromEntries(headers.map((header, index) => [normalizeHeader(header), cells[index] ?? '']))
    const hunters = numberValue(values.hunters)
    const totalDays = numberValue(values.days)
    return {
      huntNumber: values.hunt ?? values.huntnumber ?? '',
      method: values.takemethod ?? values.method ?? '',
      area: values.area ?? values.unit ?? '',
      hunters,
      harvest: numberValue(values.harvest),
      success: numberValue(values.success),
      totalDays,
      averageDays: hunters > 0 ? totalDays / hunters : 0,
      year: numberValue(values.year) || 2025,
      sourceUrl,
    }
  }).filter((row) => row.hunters > 0 || row.harvest > 0)
}

function bestGeneralHarvest(rows, hunt) {
  const area = String(hunt.area ?? '').toLowerCase()
  const method = String(hunt.method ?? '').toLowerCase()
  return rows.find((row) =>
    String(row.area).toLowerCase() === area &&
    (!row.method || !method || method.includes(String(row.method).toLowerCase()) || String(row.method).toLowerCase().includes(method)),
  ) ?? rows.find((row) => String(row.area).toLowerCase() === area) ?? null
}

function normalizeHarvest(row, game) {
  return {
    year: row.year,
    permits: 0,
    huntersAfield: row.hunters,
    harvest: row.harvest,
    successRate: row.success,
    averageDays: Number(row.averageDays.toFixed(1)),
    satisfaction: null,
    sourceUrl: row.sourceUrl || `${HUNT_PLANNER}/stats/?game=${game}`,
  }
}

function normalizeDrawProfile(row) {
  const sourceUrl = `${HUNT_PLANNER}/odds/`
  return {
    year: Number(row.Yr) || 2025,
    system: 'random',
    description: 'Idaho random controlled-hunt draw; no preference points are used.',
    sourceUrl,
    resident: {
      odds: nullableNumber(row.PercRes1),
      applicants: nullableNumber(row.ResApp),
      permits: nullableNumber(row.ResPermit),
      pointTiers: [],
      pools: [{
        label: 'First-choice draw',
        odds: nullableNumber(row.PercRes1),
        applicants: nullableNumber(row.ResApp),
        permits: nullableNumber(row.ResPermit),
      }],
    },
    nonresident: {
      odds: nullableNumber(row.PercNonRes1),
      applicants: nullableNumber(row.NonResApp),
      permits: nullableNumber(row.NonResPermit),
      pointTiers: [],
      pools: [{
        label: 'First-choice draw',
        odds: nullableNumber(row.PercNonRes1),
        applicants: nullableNumber(row.NonResApp),
        permits: nullableNumber(row.NonResPermit),
      }],
    },
  }
}

async function fetchText(url) {
  const response = await fetch(url, { headers: { 'user-agent': 'HuntPlannerData/1.0' } })
  if (!response.ok) throw new Error(`Fetch failed ${response.status} ${url}`)
  return response.text()
}

async function fetchJson(url) {
  return JSON.parse(await fetchText(url))
}

function seasonYear(value) {
  const match = String(value ?? '').match(/\/(\d{2})$/)
  return match ? 2000 + Number(match[1]) : 0
}

function baseUnit(value) {
  return String(value ?? '').split(/[-,]/)[0].trim()
}

function extractUnitIds(value) {
  const text = String(value ?? '')
  const units = [...text.matchAll(/\b\d+[A-Z]?(?:-\d+[A-Z]?)?\b/gi)].map((match) => match[0])
  return unique([text.trim(), ...units, baseUnit(units[0])]).filter(Boolean)
}

function cleanName(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim() || 'Idaho hunt'
}

function normalizeHeader(value) {
  return value.toLowerCase().replace(/#|%/g, '').replace(/[^a-z0-9]+/g, '')
}

function numberValue(value) {
  return Number(String(value ?? '').replace(/[%,$]/g, '').replace(/,/g, '').trim()) || 0
}

function nullableNumber(value) {
  const parsed = Number(String(value ?? '').replace(/[%,$]/g, '').replace(/,/g, '').trim())
  return Number.isFinite(parsed) ? parsed : null
}

function cleanHtml(value) {
  return decodeHtml(String(value).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
}

function decodeHtml(value) {
  return value
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#35;/gi, '#')
    .replace(/&#37;/gi, '%')
}

function unique(values) {
  return [...new Set(values)]
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

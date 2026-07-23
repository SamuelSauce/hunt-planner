import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const workspaceDir = path.resolve(rootDir, '..')
const dataDir = path.join(rootDir, 'src', 'data')
const cacheDir = path.join(workspaceDir, 'work', 'wyoming-pages')

const WGFD = 'https://wgfd.wyo.gov'
const DRAW_REPORTS = `${WGFD}/licenses-applications/draw-results-odds`
const HARVEST_REPORTS = `${WGFD}/hunting-trapping/harvest-reports-surveys`

const speciesConfigs = [
  { slug: 'deer', name: 'Deer' },
  { slug: 'elk', name: 'Elk' },
  { slug: 'antelope', name: 'Pronghorn' },
  { slug: 'moose', name: 'Moose' },
  { slug: 'bighorn-sheep', name: 'Bighorn Sheep' },
  { slug: 'mountain-goat', name: 'Mountain Goat' },
]

async function main() {
  await Promise.all([mkdir(dataDir, { recursive: true }), mkdir(cacheDir, { recursive: true })])

  const speciesResults = []
  for (const config of speciesConfigs) {
    speciesResults.push(await loadSpecies(config))
  }

  const hunts = speciesResults.flatMap((result) => result.hunts)
  const reports = speciesResults.flatMap((result) => result.reports)
  const data = {
    generatedAt: new Date().toISOString(),
    notices: [
      'Wyoming draw rules vary by residency, license type, and regular or special nonresident pool.',
      'Preference-point and random-pool results are kept separate instead of being combined into one percentage.',
      'Season and harvest rows come from the official 2026 WGFD Hunt Planner; draw outcomes are from 2025.',
    ],
    sourcePages: {
      huntPlanner: `${WGFD}/Hunting/Hunt-Planner/deer-Hunting`,
      drawOdds: DRAW_REPORTS,
      harvestReports: HARVEST_REPORTS,
      maps: 'https://wyoming-wgfd.opendata.arcgis.com/',
    },
    reports,
    hunts: hunts.sort((a, b) =>
      a.species.localeCompare(b.species) ||
      numericUnit(a.mapUnitIds?.[0]) - numericUnit(b.mapUnitIds?.[0]) ||
      a.huntNumber.localeCompare(b.huntNumber),
    ),
  }

  await writeFile(
    path.join(dataDir, 'wgfd-data.json'),
    `${JSON.stringify(data, null, 2)}\n`,
  )
  console.log(`Generated ${hunts.length} Wyoming hunt records across ${speciesResults.length} species.`)
}

async function loadSpecies(config) {
  const baseUrl = plannerUrl(config, 'R', 1)
  const seedHtml = await cachedFetch(baseUrl, `${config.slug}-R-1.html`)
  const areas = parseAreaOptions(seedHtml)
  console.log(`Loading ${config.name}: ${areas.length} hunt areas...`)

  const results = await mapLimit(areas, 12, async (area) => {
    const residentUrl = plannerUrl(config, 'R', area)
    const nonresidentUrl = plannerUrl(config, 'NR', area)
    const [residentHtml, nonresidentHtml] = await Promise.all([
      area === '1' ? seedHtml : optionalCachedFetch(residentUrl, `${config.slug}-R-${area}.html`),
      optionalCachedFetch(nonresidentUrl, `${config.slug}-NR-${area}.html`),
    ])
    return parseArea(config, area, residentHtml, nonresidentHtml, residentUrl, nonresidentUrl)
  })

  return {
    hunts: results.flat(),
    reports: [
      {
        id: `wy-${config.slug}-draw-odds-2025`,
        state: 'wyoming',
        sourceType: 'draw-odds',
        year: 2025,
        species: config.name,
        category: 'Draw odds',
        title: `${config.name} drawing odds`,
        url: DRAW_REPORTS,
        size: 'WGFD reports',
      },
      {
        id: `wy-${config.slug}-harvest-2025`,
        state: 'wyoming',
        sourceType: 'harvest',
        year: 2025,
        species: config.name,
        category: 'Harvest statistics',
        title: `${config.name} harvest report`,
        url: HARVEST_REPORTS,
        size: 'WGFD report',
      },
    ],
  }
}

function parseArea(config, area, residentHtml, nonresidentHtml, residentUrl, nonresidentUrl) {
  const seasons = parseSeasonRows(residentHtml)
  const harvestRows = parseHarvestRows(residentHtml)
  const publicLandPercent = parsePublicLand(residentHtml)

  return seasons.map((season, index) => {
    const type = huntTypeFromApplyFor(season.applyFor)
    const antlerless = /doe|fawn|antlerless|cow|calf/i.test(season.limitations) || ['4', '6', '7', '8'].includes(type)
    const isGeneral = /general/i.test(season.applyFor)
    const huntNumber = isGeneral
      ? `${String(area).padStart(3, '0')}-GENERAL`
      : cleanApplyFor(season.applyFor) || `${String(area).padStart(3, '0')}-${type || index + 1}`
    const harvest = bestHarvest(harvestRows, type, isGeneral)
    const drawProfile = parseDrawProfile(residentHtml, nonresidentHtml, type, residentUrl, nonresidentUrl)

    return {
      id: `wy-${config.slug}-${area}-${type || 'general'}-${index}`,
      state: 'wyoming',
      huntNumber,
      species: config.name,
      gender: season.limitations,
      huntName: `Hunt Area ${area}`,
      huntType: isGeneral ? 'General license' : `Limited quota type ${type || 'varies'}`,
      category: antlerless ? 'antlerless' : isGeneral ? 'general-otc' : 'limited-entry',
      weapon: type === '9' ? 'Archery' : 'Any Legal Weapon',
      planningYear: 2026,
      seasonDateText: season.archeryDates
        ? `${season.seasonDates} (archery: ${season.archeryDates})`
        : season.seasonDates || null,
      quota: null,
      currentSourceUrl: residentUrl,
      harvest,
      odds: null,
      drawProfile,
      mapUnitIds: [String(area)],
      publicLandPercent,
      licenseNotes: wyomingLicenseNote(config.name, isGeneral, type),
      sourceUrls: unique([
        residentUrl,
        nonresidentUrl,
        drawProfile ? DRAW_REPORTS : '',
        harvest ? HARVEST_REPORTS : '',
      ]).filter(Boolean),
    }
  })
}

function parseSeasonRows(html) {
  const table = html.match(/<table\b[^>]*class="[^"]*licence-huntareainfo-table[^"]*"[^>]*>([\s\S]*?)<\/table>/i)?.[1]
  if (!table) return []
  return tableRows(table)
    .filter((row) => row.length >= 4 && !/apply for/i.test(row[0]) && !/difficult public access/i.test(row.join(' ')))
    .map((row) => ({
      applyFor: row[0],
      seasonDates: row[1],
      archeryDates: row[2],
      limitations: row[3],
    }))
}

function parseHarvestRows(html) {
  const rows = []
  const pattern = /<div\b[^>]*>\s*Area\s+\d+\s+-\s+Type\s+([^<]+)<\/div>[\s\S]*?<div\b[^>]*>(20\d{2})\s+HARVEST REPORT<\/div>[\s\S]*?<table\b[^>]*class="[^"]*custom-harvest-table[^"]*"[^>]*>([\s\S]*?)<\/table>/gi
  for (const match of html.matchAll(pattern)) {
    const values = Object.fromEntries(tableRows(match[3]).map((row) => [normalizeHeader(row[0]), row[1] ?? '']))
    const days = numberValue(values.dayshunted)
    const averageDays = numberValue(values.dayshunter)
    const harvest = numberValue(values.totalareaharvest)
    const successRate = numberValue(values.huntersuccess)
    const hunters = successRate > 0 ? Math.round(harvest / (successRate / 100)) : 0
    rows.push({
      type: cleanHtml(match[1]).toLowerCase(),
      year: Number(match[2]),
      days,
      averageDays,
      harvest,
      hunters,
      successRate,
    })
  }
  return rows
}

function bestHarvest(rows, type, isGeneral) {
  const row = rows.find((candidate) => {
    if (isGeneral) return /general/.test(candidate.type)
    return candidate.type === String(type).toLowerCase()
  })
  if (!row) return null
  return {
    year: row.year,
    permits: 0,
    huntersAfield: row.hunters,
    harvest: row.harvest,
    successRate: row.successRate,
    averageDays: row.averageDays,
    satisfaction: null,
    sourceUrl: HARVEST_REPORTS,
  }
}

function parseDrawProfile(residentHtml, nonresidentHtml, huntType, residentUrl, nonresidentUrl) {
  const resident = parseDrawSide(residentHtml, huntType, 'Resident')
  const nonresident = parseDrawSide(nonresidentHtml, huntType, 'Nonresident')
  if (!resident && !nonresident) return null
  return {
    year: 2025,
    system: 'preference-random',
    description: 'Wyoming separates preference and random draws; nonresidents can also choose regular or special pools.',
    sourceUrl: nonresident ? nonresidentUrl : residentUrl,
    resident,
    nonresident,
  }
}

function parseDrawSide(html, huntType, residency) {
  const tables = parseDrawTables(html).filter((table) =>
    table.title.toLowerCase().startsWith(residency.toLowerCase()) &&
    !/landowner/i.test(table.title),
  )
  const matching = tables.map((table) => ({
    ...table,
    rows: table.rows.filter((row) => String(row.hunttype) === String(huntType)),
  })).filter((table) => table.rows.length > 0)
  if (matching.length === 0) return null

  const pointTiers = matching
    .filter((table) => /preference point/i.test(table.title))
    .flatMap((table) => table.rows.map((row) => ({
      label: row.preferencepoints || 'Point tier',
      odds: nullablePercent(row.drawingodds),
      issued: nullableNumber(row.issued),
      quota: nullableNumber(row.quota),
      pool: poolLabel(table.title),
    })))
    .filter((tier) => tier.odds !== null)

  const pools = matching
    .filter((table) => /random/i.test(table.title))
    .map((table) => {
      const row = table.rows[0]
      return {
        label: poolLabel(table.title),
        odds: nullablePercent(row.firstchoiceodds ?? row.drawingodds),
        applicants: nullableNumber(row.firstchoiceapplicants),
        permits: nullableNumber(row.totalquota ?? row.quota),
      }
    })

  for (const table of matching.filter((candidate) => !/random|preference point/i.test(candidate.title))) {
    const row = table.rows[0]
    pools.push({
      label: 'First-choice draw',
      odds: nullablePercent(row.firstchoiceodds ?? row.drawingodds),
      applicants: nullableNumber(row.firstchoiceapplicants),
      permits: nullableNumber(row.totalquota ?? row.quota),
    })
  }

  if (pointTiers.length === 0 && pools.every((pool) => pool.odds === null)) return null

  const odds = pools.find((pool) => /regular random|random draw/i.test(pool.label))?.odds
    ?? pools[0]?.odds
    ?? pointTiers.find((tier) => /^0$/.test(tier.label))?.odds
    ?? null

  return {
    odds,
    applicants: pools[0]?.applicants ?? null,
    permits: pools[0]?.permits ?? null,
    pointTiers,
    pools,
  }
}

function parseDrawTables(html) {
  const tables = []
  const pattern = /<div\b[^>]*class="[^"]*drawing-odds-preference-points-table[^"]*"[^>]*>([\s\S]*?)<\/div>/gi
  for (const match of html.matchAll(pattern)) {
    const title = cleanHtml(match[1].match(/<h3\b[^>]*>([\s\S]*?)<\/h3>/i)?.[1] ?? '')
    const table = match[1].match(/<table\b[^>]*>([\s\S]*?)<\/table>/i)?.[1]
    if (!title || !table) continue
    const rows = tableRows(table)
    const headers = rows.find((row) => row.some((cell) => /hunt type/i.test(cell))) ?? []
    tables.push({
      title,
      rows: rows.slice(rows.indexOf(headers) + 1).map((cells) =>
        Object.fromEntries(headers.map((header, index) => [normalizeHeader(header), cells[index] ?? ''])),
      ),
    })
  }
  return tables
}

function parseAreaOptions(html) {
  const select = html.match(/<select\b[^>]*name="huntarea"[^>]*>([\s\S]*?)<\/select>/i)?.[1] ?? ''
  return [...select.matchAll(/<option\b[^>]*value="(\d+)"[^>]*>/gi)]
    .map((match) => match[1])
    .filter((value) => value !== '0')
}

function parsePublicLand(html) {
  const match = html.match(/Approx\.\s*%\s*of\s*Public\s*Land:[\s\S]{0,300}?([\d.]+)%/i)
  return match ? Number(match[1]) : null
}

function tableRows(table) {
  return [...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)]
    .map((match) => [...match[1].matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)]
      .map((cell) => cleanHtml(cell[1])))
    .filter((row) => row.length > 0)
}

function plannerUrl(config, residency, area) {
  return `${WGFD}/Hunting/Hunt-Planner/${config.slug}-Hunting?res=${residency}&huntarea=${area}`
}

async function cachedFetch(url, fileName) {
  const destination = path.join(cacheDir, fileName)
  try {
    await access(destination)
    return readFile(destination, 'utf8')
  } catch {
    const response = await fetch(url, { headers: { 'user-agent': 'HuntPlannerData/1.0' } })
    if (!response.ok) throw new Error(`Fetch failed ${response.status} ${url}`)
    const html = await response.text()
    await writeFile(destination, html)
    return html
  }
}

async function optionalCachedFetch(url, fileName) {
  try {
    return await cachedFetch(url, fileName)
  } catch (error) {
    console.warn(`Skipping unavailable page: ${url} (${error.message})`)
    return ''
  }
}

async function mapLimit(items, limit, mapper) {
  const results = new Array(items.length)
  let cursor = 0
  async function worker() {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      results[index] = await mapper(items[index], index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

function wyomingLicenseNote(species, isGeneral, type) {
  if (isGeneral && species === 'Deer') {
    return 'Residents buy a general deer license over the counter; nonresidents draw a regional general license.'
  }
  if (isGeneral && species === 'Elk') {
    return 'General elk license rules and valid hunt areas differ by residency.'
  }
  if (['6', '7', '8'].includes(type)) return 'Reduced-price doe/fawn or cow/calf license type.'
  return 'Limited-quota license; review the applicable regular, special, preference, and random draw pools.'
}

function huntTypeFromApplyFor(value) {
  return cleanApplyFor(value).match(/-(\d+)$/)?.[1] ?? (/general/i.test(value) ? 'general' : '')
}

function cleanApplyFor(value) {
  return String(value ?? '').replace(/\*/g, '').trim()
}

function poolLabel(title) {
  if (/special random/i.test(title)) return 'Special random'
  if (/special preference/i.test(title)) return 'Special preference'
  if (/random/i.test(title)) return /nonresident/i.test(title) ? 'Regular random' : 'Random draw'
  if (/preference/i.test(title)) return /nonresident/i.test(title) ? 'Regular preference' : 'Preference draw'
  return title.replace(/^(Resident|Nonresident)\s+/i, '')
}

function normalizeHeader(value) {
  return cleanHtml(value).toLowerCase().replace(/#|%/g, '').replace(/[^a-z0-9]+/g, '')
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
}

function numberValue(value) {
  return Number(String(value ?? '').replace(/[%,$]/g, '').replace(/,/g, '').trim()) || 0
}

function nullableNumber(value) {
  const parsed = Number(String(value ?? '').replace(/[%,$]/g, '').replace(/,/g, '').trim())
  return Number.isFinite(parsed) && String(value ?? '').trim() !== '' ? parsed : null
}

function nullablePercent(value) {
  return nullableNumber(value)
}

function numericUnit(value) {
  return Number(value) || 9999
}

function unique(values) {
  return [...new Set(values)]
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

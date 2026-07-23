import { execFileSync } from 'node:child_process'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveWorkDir } from './work-dir.mjs'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sourcePdfDir = path.join(resolveWorkDir(rootDir), 'source-pdfs')
const dataDir = path.join(rootDir, 'src', 'data')

const WILDLIFE_BASE = 'https://wildlife.utah.gov'
const HUNT_PLANNER_BASE = 'https://dwrapps.utah.gov/huntboundary'

const oddsPageUrl = `${WILDLIFE_BASE}/biggame/odds`
const harvestPageUrl = `${WILDLIFE_BASE}/biggame/reports`

const pdfSources = {
  limitedOdds2025: {
    year: 2025,
    url: `${WILDLIFE_BASE}/pdf/bg/2025/25_bg-odds.pdf`,
    localName: '2025-limited-entry-oial-odds.pdf',
  },
  generalBuckDeerOdds2025: {
    year: 2025,
    url: `${WILDLIFE_BASE}/pdf/bg/2025/25_deer_odds.pdf`,
    localName: '2025-general-buck-deer-odds.pdf',
  },
  generalBuckDeerHarvest2025: {
    year: 2025,
    url: `${WILDLIFE_BASE}/pdf/bg/2025/2025_gs_buck_deer_hr-preliminary.pdf`,
    localName: '2025-general-buck-deer-harvest.pdf',
  },
  limitedHarvest2024: {
    year: 2024,
    url: `${WILDLIFE_BASE}/pdf/bg/2024/2024_le_oial_all.pdf`,
    localName: '2024-limited-entry-oial-harvest.pdf',
  },
  antlerlessHarvest2024: {
    year: 2024,
    url: `${WILDLIFE_BASE}/pdf/bg/2024/2024_antlerless_hr.pdf`,
    localName: '2024-antlerless-harvest.pdf',
  },
}

const bigGameSpecies = [
  'Bison',
  'Deer',
  'Desert Bighorn Sheep',
  'Elk',
  'Moose',
  'Mountain Goat',
  'Pronghorn',
  'Rocky Mountain Bighorn Sheep',
]

const textDecoder = new TextDecoder()

async function main() {
  await mkdir(sourcePdfDir, { recursive: true })
  await mkdir(dataDir, { recursive: true })

  await Promise.all(
    Object.values(pdfSources).map((source) =>
      downloadIfMissing(source.url, path.join(sourcePdfDir, source.localName)),
    ),
  )

  const [oddsHtml, harvestHtml, setup] = await Promise.all([
    fetchText(oddsPageUrl),
    fetchText(harvestPageUrl),
    fetchJson(`${HUNT_PLANNER_BASE}/HaSetup`),
  ])

  const reports = [
    ...parseReportCatalog(oddsHtml, 'draw-odds', oddsPageUrl),
    ...parseReportCatalog(harvestHtml, 'harvest', harvestPageUrl),
  ]

  const currentHunts = await fetchCurrentHunts(setup.genderList ?? [])
  const harvestRecords = [
    ...parseGeneralBuckDeerHarvest(
      path.join(sourcePdfDir, pdfSources.generalBuckDeerHarvest2025.localName),
      pdfSources.generalBuckDeerHarvest2025,
    ),
    ...parseLimitedHarvest(
      path.join(sourcePdfDir, pdfSources.limitedHarvest2024.localName),
      pdfSources.limitedHarvest2024,
    ),
    ...parseAntlerlessHarvest(
      path.join(sourcePdfDir, pdfSources.antlerlessHarvest2024.localName),
      pdfSources.antlerlessHarvest2024,
    ),
  ]
  const oddsRecords = [
    ...parseLimitedOdds(
      path.join(sourcePdfDir, pdfSources.limitedOdds2025.localName),
      pdfSources.limitedOdds2025,
    ),
    ...parseGeneralBuckDeerOdds(
      path.join(sourcePdfDir, pdfSources.generalBuckDeerOdds2025.localName),
      pdfSources.generalBuckDeerOdds2025,
    ),
  ]

  const hunts = mergeHunts(currentHunts, harvestRecords, oddsRecords)
  const data = {
    generatedAt: new Date().toISOString(),
    notices: [
      'UDWR draw odds reports are historical, informational, and reflect first-choice selections only.',
      'Current season dates and permit quotas come from the UDWR Hunt Planner JSON endpoints.',
      'Harvest statistics are the latest parsed PDF reports included in this importer.',
    ],
    sourcePages: {
      drawOdds: oddsPageUrl,
      harvestReports: harvestPageUrl,
      huntPlanner: 'https://hunt.utah.gov/',
      huntPlannerJsonBase: HUNT_PLANNER_BASE,
      newDrawOdds: 'https://utahdraws.com/drawodds',
    },
    reports,
    hunts,
  }

  await writeFile(
    path.join(dataDir, 'udwr-data.json'),
    `${JSON.stringify(data, null, 2)}\n`,
  )

  console.log(
    `Generated ${data.hunts.length} hunt records, ${data.reports.length} report links, ${harvestRecords.length} harvest rows, and ${oddsRecords.length} odds tables.`,
  )
}

async function fetchText(url) {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Fetch failed ${response.status} ${url}`)
  }
  return response.text()
}

async function fetchJson(url) {
  const text = await fetchText(url)
  if (text === '"Error"') {
    throw new Error(`Endpoint returned Error: ${url}`)
  }
  return JSON.parse(text)
}

async function downloadIfMissing(url, destination) {
  try {
    await access(destination)
    return
  } catch {
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`Download failed ${response.status} ${url}`)
    }
    const buffer = Buffer.from(await response.arrayBuffer())
    await writeFile(destination, buffer)
  }
}

async function fetchCurrentHunts(genders) {
  const huntMap = new Map()
  for (const species of bigGameSpecies) {
    for (const gender of genders) {
      const url = new URL(`${HUNT_PLANNER_BASE}/HuntTableData`)
      url.searchParams.set('species', species)
      url.searchParams.set('gender', gender)
      const text = await fetchText(url.href)
      if (text === '"Error"') {
        continue
      }
      const rows = JSON.parse(text)
      for (const row of rows) {
        huntMap.set(row.HUNT_NBR, normalizeCurrentHunt(row))
      }
    }
  }
  return [...huntMap.values()]
}

function normalizeCurrentHunt(row) {
  const year = extractYear(row.SEASON_DATE_TEXT) ?? extractYear(row.SEASON_OPEN_DATE_1) ?? 2026
  return {
    huntNumber: row.HUNT_NBR,
    species: normalizeSpecies(row.SPECIES),
    gender: normalizeTitle(row.GENDER),
    huntName: normalizeWhitespace(row.HUNT_NAME),
    huntType: normalizeWhitespace(row.HUNT_TYPE),
    category: categorizeHunt(row.HUNT_TYPE, row.GENDER),
    weapon: normalizeWhitespace(row.WEAPON),
    planningYear: year,
    seasonDateText: normalizeSeasonText(row.SEASON_DATE_TEXT),
    quota: {
      resident: numberOrZero(row.QUOTA_RES),
      nonresident: numberOrZero(row.QUOTA_NRES),
      total: numberOrZero(row.QUOTA),
    },
    sourceUrl: `${HUNT_PLANNER_BASE}/?HN=${encodeURIComponent(row.HUNT_NBR)}`,
  }
}

function parseReportCatalog(html, sourceType, pageUrl) {
  const reports = []
  let year = null
  let category = ''
  const tokenPattern =
    /<h2[^>]*>([\s\S]*?)<\/h2>|<h3[^>]*>([\s\S]*?)<\/h3>|<li>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>\s*<span class="pdf">\s*&ndash;\s*PDF\s*\(([^)]+)\)<\/span>/gi

  for (const match of html.matchAll(tokenPattern)) {
    if (match[1]) {
      const maybeYear = cleanHtml(match[1]).match(/\b(20\d{2})\b/)
      if (maybeYear) {
        year = Number(maybeYear[1])
      }
      continue
    }
    if (match[2]) {
      category = cleanHtml(match[2])
      continue
    }
    if (!match[3] || !year) {
      continue
    }
    const href = match[3]
    const fallbackTitle = path.basename(href).replace(/[-_]/g, ' ').replace(/\.pdf$/i, '')
    const title = cleanHtml(match[4]) || normalizeTitle(fallbackTitle)
    const url = absolutizeUrl(href)
    reports.push({
      id: `${sourceType}-${year}-${slugify(title)}-${reports.length}`,
      sourceType,
      year,
      category,
      title,
      url,
      size: cleanHtml(match[5]),
      pageUrl,
    })
  }
  return reports
}

function parseLimitedHarvest(pdfPath, source) {
  const text = pdfToText(pdfPath)
  const rows = []
  let sectionTitle = ''
  for (const rawLine of text.split('\n')) {
    const heading = rawLine.match(/^\s*2024\s+(.+?)\s*$/)
    if (heading) {
      sectionTitle = normalizeWhitespace(heading[1])
      continue
    }

    const row = rawLine.match(
      /^\s*([A-Z]{2}\d{4})\s+(.+?)\s{2,}(.+?)\s{2,}(.+?)\s+(\d+)\s+(\d+)\s+(\d+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*$/,
    )
    if (!row) {
      continue
    }

    const [, huntNumber, huntName, huntType, weapon, permits, huntersAfield, harvest, avgDays, successRate, satisfaction] =
      row
    rows.push({
      huntNumber,
      year: source.year,
      species: speciesFromText(sectionTitle, huntNumber),
      gender: genderFromText(sectionTitle),
      huntName: normalizeWhitespace(huntName),
      huntType: normalizeWhitespace(huntType),
      category: categorizeHunt(huntType, genderFromText(sectionTitle)),
      weapon: normalizeWhitespace(weapon),
      permits: Number(permits),
      huntersAfield: Number(huntersAfield),
      harvest: Number(harvest),
      averageDays: Number(avgDays),
      successRate: Number(successRate),
      satisfaction: Number(satisfaction),
      sourceUrl: source.url,
    })
  }
  return rows
}

function parseAntlerlessHarvest(pdfPath, source) {
  const text = pdfToText(pdfPath)
  const rows = []
  for (const rawLine of text.split('\n')) {
    const codeMatch = rawLine.match(/\b([A-Z]{2}\d{4})\b/)
    if (!codeMatch) {
      continue
    }
    const huntNumber = codeMatch[1]
    const speciesLabel = normalizeWhitespace(rawLine.slice(0, codeMatch.index))
    if (!speciesLabel || /hunt\s+#/i.test(speciesLabel)) {
      continue
    }
    const rest = rawLine.slice((codeMatch.index ?? 0) + huntNumber.length).trim()
    const row = rest.match(/^(.+?)\s{2,}(.+?)\s+(\d+)\s+(\d+)\s+(\d+)\s+([\d.]+)\s+([\d.]+)\s*$/)
    if (!row) {
      continue
    }
    const [, huntName, weapon, permits, huntersAfield, harvest, successRate, avgDays] = row
    rows.push({
      huntNumber,
      year: source.year,
      species: speciesFromText(speciesLabel, huntNumber),
      gender: 'Antlerless',
      huntName: normalizeWhitespace(huntName),
      huntType: speciesLabel,
      category: 'antlerless',
      weapon: normalizeWhitespace(weapon),
      permits: Number(permits),
      huntersAfield: Number(huntersAfield),
      harvest: Number(harvest),
      averageDays: Number(avgDays),
      successRate: Number(successRate),
      satisfaction: null,
      sourceUrl: source.url,
    })
  }
  return rows
}

function parseGeneralBuckDeerHarvest(pdfPath, source) {
  const text = pdfToText(pdfPath)
  const rows = []
  const rowPattern =
    /^\s*(D[XB]\d{4})\s+Deer\s+(.+?)\s{2,}(General Season)\s{2,}(.+?)\s{2,}(Male Only|Hunter's Choice)\s+([\d-]+)\s+(\d+)\s+(\d+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+|--)\s*$/

  for (const rawLine of text.split('\n')) {
    const row = rawLine.match(rowPattern)
    if (!row) {
      continue
    }

    const [
      ,
      huntNumber,
      huntName,
      huntType,
      weapon,
      sexType,
      permits,
      huntersAfield,
      harvest,
      successRate,
      avgDays,
      satisfaction,
    ] = row

    rows.push({
      huntNumber,
      year: source.year,
      species: 'Deer',
      gender: sexType === "Hunter's Choice" ? "Hunter's Choice" : 'Buck',
      huntName: normalizeWhitespace(huntName),
      huntType: normalizeWhitespace(huntType),
      category: categorizeHunt(huntType, 'Buck'),
      weapon: normalizeGeneralDeerWeapon(weapon),
      permits: numberOrZero(permits),
      huntersAfield: Number(huntersAfield),
      harvest: Number(harvest),
      averageDays: Number(avgDays),
      successRate: Number(successRate),
      satisfaction: satisfaction === '--' ? null : Number(satisfaction),
      sourceUrl: source.url,
    })
  }
  return rows
}

function parseLimitedOdds(pdfPath, source) {
  const text = pdfToText(pdfPath)
  const oddsRecords = []
  let activeSpecies = ''
  const rowPattern = new RegExp(
    String.raw`^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(N\/A|1\s+in\s+\d+(?:\.\d+)?)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(N\/A|1\s+in\s+\d+(?:\.\d+)?)\s*$`,
  )
  const totalsPattern = new RegExp(
    String.raw`^\s*Totals\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(N\/A|1\s+in\s+\d+(?:\.\d+)?)\s+Totals\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(N\/A|1\s+in\s+\d+(?:\.\d+)?)\s*$`,
  )

  for (const page of text.split('\f')) {
    const speciesMatch = page.match(/Species:\s+(.+?)\s+-\s+All Applicants/i)
    if (speciesMatch) {
      activeSpecies = speciesFromText(speciesMatch[1])
    }

    const huntMatch = page.match(/Hunt:\s+([A-Z]{2}\d{4})\s+(.+?)\s+Page\s+\d+/i)
    if (!huntMatch) {
      continue
    }

    const huntNumber = huntMatch[1]
    const description = normalizeWhitespace(huntMatch[2].replace(/\s*-\s*/g, ' - '))
    const { huntName, weapon, huntType } = splitOddsDescription(description)
    const byPointResident = []
    const byPointNonresident = []
    let totals = null

    for (const line of page.split('\n')) {
      const row = line.match(rowPattern)
      if (row) {
        byPointResident.push(
          oddsPointRow(row[1], row[2], row[3], row[4], row[5], row[6]),
        )
        byPointNonresident.push(
          oddsPointRow(row[7], row[8], row[9], row[10], row[11], row[12]),
        )
        continue
      }
      const total = line.match(totalsPattern)
      if (total) {
        totals = {
          resident: oddsTotals(total[1], total[2], total[3], total[4], total[5]),
          nonresident: oddsTotals(total[6], total[7], total[8], total[9], total[10]),
        }
      }
    }

    const species = activeSpecies || speciesFromText(description, huntNumber)
    const gender = genderFromText(description)
    const residentRows = compactOddsRows(byPointResident)
    const nonresidentRows = compactOddsRows(byPointNonresident)
    oddsRecords.push({
      huntNumber,
      year: source.year,
      species,
      gender,
      huntName,
      huntType,
      category: categorizeHunt(huntType, gender),
      weapon,
      description,
      resident: {
        totals: totals?.resident ?? null,
        byPoint: residentRows,
        summary: summarizeOdds(residentRows),
      },
      nonresident: {
        totals: totals?.nonresident ?? null,
        byPoint: nonresidentRows,
        summary: summarizeOdds(nonresidentRows),
      },
      sourceUrl: source.url,
    })
  }
  return oddsRecords
}

function parseGeneralBuckDeerOdds(pdfPath, source) {
  const text = pdfToText(pdfPath)
  const oddsRecords = []
  const rowPattern = new RegExp(
    String.raw`^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(N\/A|1\s+in\s+\d+(?:\.\d+)?)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(N\/A|1\s+in\s+\d+(?:\.\d+)?)\s*$`,
  )
  const totalsPattern = new RegExp(
    String.raw`^\s*Totals\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(N\/A|1\s+in\s+\d+(?:\.\d+)?)\s+Totals\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(N\/A|1\s+in\s+\d+(?:\.\d+)?)\s*$`,
  )

  for (const page of text.split('\f')) {
    const huntMatch = page.match(/Hunt:\s+([A-Z]{2}\d{4})\s+(.+?)\s+Page\s+\d+/i)
    if (!huntMatch) {
      continue
    }

    const huntNumber = huntMatch[1]
    const description = normalizeWhitespace(huntMatch[2].replace(/\s*-\s*/g, ' - '))
    const { huntName, weapon } = splitGeneralDeerDescription(description)
    const byPointResident = []
    const byPointNonresident = []
    let totals = null

    for (const line of page.split('\n')) {
      const row = line.match(rowPattern)
      if (row) {
        byPointResident.push(
          oddsPointRow(row[1], row[2], row[3], row[4], row[5], row[6]),
        )
        byPointNonresident.push(
          oddsPointRow(row[7], row[8], row[9], row[10], row[11], row[12]),
        )
        continue
      }
      const total = line.match(totalsPattern)
      if (total) {
        totals = {
          resident: oddsTotals(total[1], total[2], total[3], total[4], total[5]),
          nonresident: oddsTotals(total[6], total[7], total[8], total[9], total[10]),
        }
      }
    }

    const residentRows = compactOddsRows(byPointResident)
    const nonresidentRows = compactOddsRows(byPointNonresident)
    oddsRecords.push({
      huntNumber,
      year: source.year,
      species: 'Deer',
      gender: huntNumber === 'DB0008' ? "Hunter's Choice" : 'Buck',
      huntName,
      huntType: 'General Season',
      category: 'general-otc',
      weapon,
      description: `General Season - ${description}`,
      resident: {
        totals: totals?.resident ?? null,
        byPoint: residentRows,
        summary: summarizeOdds(residentRows),
      },
      nonresident: {
        totals: totals?.nonresident ?? null,
        byPoint: nonresidentRows,
        summary: summarizeOdds(nonresidentRows),
      },
      sourceUrl: source.url,
    })
  }
  return oddsRecords
}

function mergeHunts(currentHunts, harvestRecords, oddsRecords) {
  const huntMap = new Map()
  for (const hunt of currentHunts) {
    huntMap.set(hunt.huntNumber, {
      id: hunt.huntNumber,
      huntNumber: hunt.huntNumber,
      species: hunt.species,
      gender: hunt.gender,
      huntName: hunt.huntName,
      huntType: hunt.huntType,
      category: hunt.category,
      weapon: hunt.weapon,
      planningYear: hunt.planningYear,
      seasonDateText: hunt.seasonDateText,
      quota: hunt.quota,
      currentSourceUrl: hunt.sourceUrl,
      harvest: null,
      odds: null,
      sourceUrls: [hunt.sourceUrl],
    })
  }

  for (const harvest of harvestRecords) {
    const record = ensureHuntRecord(huntMap, harvest)
    record.harvest = {
      year: harvest.year,
      permits: harvest.permits,
      huntersAfield: harvest.huntersAfield,
      harvest: harvest.harvest,
      successRate: harvest.successRate,
      averageDays: harvest.averageDays,
      satisfaction: harvest.satisfaction,
      sourceUrl: harvest.sourceUrl,
    }
    record.sourceUrls = unique([...record.sourceUrls, harvest.sourceUrl])
    record.huntName ||= harvest.huntName
    record.huntType ||= harvest.huntType
    record.weapon ||= harvest.weapon
  }

  for (const odds of oddsRecords) {
    const record = ensureHuntRecord(huntMap, odds)
    record.odds = {
      year: odds.year,
      resident: odds.resident,
      nonresident: odds.nonresident,
      description: odds.description,
      sourceUrl: odds.sourceUrl,
    }
    record.sourceUrls = unique([...record.sourceUrls, odds.sourceUrl])
    record.huntName ||= odds.huntName
    record.huntType ||= odds.huntType
    record.weapon ||= odds.weapon
  }

  return [...huntMap.values()].sort((a, b) => a.huntNumber.localeCompare(b.huntNumber))
}

function ensureHuntRecord(huntMap, source) {
  if (!huntMap.has(source.huntNumber)) {
    huntMap.set(source.huntNumber, {
      id: source.huntNumber,
      huntNumber: source.huntNumber,
      species: source.species,
      gender: source.gender,
      huntName: source.huntName,
      huntType: source.huntType,
      category: source.category,
      weapon: source.weapon,
      planningYear: null,
      seasonDateText: null,
      quota: null,
      currentSourceUrl: `${HUNT_PLANNER_BASE}/?HN=${encodeURIComponent(source.huntNumber)}`,
      harvest: null,
      odds: null,
      sourceUrls: [],
    })
  }
  const record = huntMap.get(source.huntNumber)
  record.species ||= source.species
  record.gender ||= source.gender
  record.category = bestCategory(record.category, source.category)
  return record
}

function pdfToText(pdfPath) {
  const buffer = execFileSync('pdftotext', ['-layout', pdfPath, '-'], {
    maxBuffer: 64 * 1024 * 1024,
  })
  return textDecoder.decode(buffer)
}

function oddsPointRow(points, eligible, bonusPermits, regularPermits, totalPermits, ratio) {
  return {
    points: Number(points),
    eligibleApplicants: Number(eligible),
    bonusPermits: Number(bonusPermits),
    regularPermits: Number(regularPermits),
    totalPermits: Number(totalPermits),
    successRatio: normalizeWhitespace(ratio),
    successRatioValue: ratioValue(ratio),
  }
}

function oddsTotals(eligible, bonusPermits, regularPermits, totalPermits, ratio) {
  return {
    eligibleApplicants: Number(eligible),
    bonusPermits: Number(bonusPermits),
    regularPermits: Number(regularPermits),
    totalPermits: Number(totalPermits),
    successRatio: normalizeWhitespace(ratio),
    successRatioValue: ratioValue(ratio),
  }
}

function summarizeOdds(rows) {
  const available = rows.filter((row) => row.totalPermits > 0 && row.successRatioValue)
  const nearCertain = available.find((row) => row.successRatioValue <= 1.05)
  const best = available.reduce(
    (winner, row) => (!winner || row.successRatioValue < winner.successRatioValue ? row : winner),
    null,
  )
  const lowestPointWithPermit = available.reduce(
    (lowest, row) => (lowest === null || row.points < lowest ? row.points : lowest),
    null,
  )
  return {
    nearCertainPoint: nearCertain?.points ?? null,
    bestHistoricalPoint: best?.points ?? null,
    bestHistoricalRatio: best?.successRatio ?? null,
    lowestPointWithPermit,
  }
}

function compactOddsRows(rows) {
  return rows.filter(
    (row) =>
      row.eligibleApplicants > 0 ||
      row.bonusPermits > 0 ||
      row.regularPermits > 0 ||
      row.totalPermits > 0 ||
      row.successRatioValue !== null,
  )
}

function splitOddsDescription(description) {
  const parts = description.split(/\s+-\s+/)
  const weapon = parts.length > 1 ? parts.at(-1) : ''
  const huntName = parts.length > 2 ? parts.at(-2) : description
  const huntType = parts.length > 2 ? parts.slice(0, -2).join(' - ') : description
  return {
    huntName: normalizeWhitespace(huntName ?? ''),
    weapon: normalizeWhitespace(weapon ?? ''),
    huntType: normalizeWhitespace(huntType),
  }
}

function splitGeneralDeerDescription(description) {
  const parts = description.split(/\s+-\s+/)
  const weapon = parts.length > 1 ? parts.pop() : ''
  return {
    huntName: normalizeWhitespace(parts.join(' - ') || description),
    weapon: normalizeGeneralDeerWeapon(weapon ?? ''),
  }
}

function normalizeGeneralDeerWeapon(value = '') {
  const weapon = normalizeWhitespace(value)
  if (/^Early Any Legal Weapon$/i.test(weapon)) return 'Any Legal Weapon (Early)'
  if (/^Late Any Legal Weapon$/i.test(weapon)) return 'Any Legal Weapon (Late)'
  return weapon
}

function categorizeHunt(huntType = '', gender = '') {
  const text = `${huntType} ${gender}`.toLowerCase()
  if (/antlerless|cow only|\bdoe\b|\bewe\b/.test(text)) return 'antlerless'
  if (/once|oial/.test(text)) return 'once-in-a-lifetime'
  if (/cwmu/.test(text)) return 'cwmu'
  if (/conservation/.test(text)) return 'conservation'
  if (/limited/.test(text) || /premium/.test(text) || /management/.test(text)) {
    return 'limited-entry'
  }
  if (/general|statewide|tribal|any bull|spike/.test(text)) return 'general-otc'
  return 'other'
}

function bestCategory(existing, incoming) {
  const rank = {
    'limited-entry': 6,
    'once-in-a-lifetime': 6,
    antlerless: 5,
    'general-otc': 4,
    cwmu: 3,
    conservation: 2,
    other: 1,
  }
  return (rank[incoming] ?? 0) > (rank[existing] ?? 0) ? incoming : existing
}

function speciesFromText(text = '', huntNumber = '') {
  const haystack = String(text).toLowerCase()
  const prefix = String(huntNumber).slice(0, 2).toUpperCase()
  if (['PA', 'PB', 'LP', 'LA'].includes(prefix) || /pronghorn/.test(haystack)) return 'Pronghorn'
  if (['EA', 'EB'].includes(prefix) || /elk/.test(haystack)) return 'Elk'
  if (prefix === 'MO' || /moose/.test(haystack)) return 'Moose'
  if (prefix === 'BI' || /bison/.test(haystack)) return 'Bison'
  if (prefix === 'MG' || /goat/.test(haystack)) return 'Mountain Goat'
  if (prefix === 'DS' || /desert bighorn/.test(haystack)) return 'Desert Bighorn Sheep'
  if (prefix === 'RS' || /rocky|bighorn|sheep/.test(haystack)) return 'Bighorn Sheep'
  if (['DA', 'DB'].includes(prefix) || /deer/.test(haystack)) return 'Deer'
  return normalizeSpecies(text)
}

function genderFromText(text = '') {
  const haystack = text.toLowerCase()
  if (/antlerless|doe|cow only|ewe/.test(haystack)) return 'Antlerless'
  if (/\bbuck\b/.test(haystack)) return 'Buck'
  if (/\bbull\b/.test(haystack)) return 'Bull'
  if (/ram|male/.test(haystack)) return 'Male Only'
  return ''
}

function normalizeSeasonText(text = '') {
  return normalizeWhitespace(text.replace(/\s*\|\s*/g, ' | '))
}

function normalizeSpecies(value = '') {
  return normalizeWhitespace(value)
}

function normalizeTitle(value = '') {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function cleanHtml(value = '') {
  return normalizeWhitespace(
    value
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&ndash;/g, '-')
      .replace(/&mdash;/g, '-')
      .replace(/&#39;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&nbsp;/g, ' '),
  )
}

function normalizeWhitespace(value = '') {
  return String(value).replace(/\s+/g, ' ').trim()
}

function absolutizeUrl(href) {
  if (/^https?:\/\//i.test(href)) return href
  return new URL(href, WILDLIFE_BASE).href
}

function ratioValue(ratio = '') {
  const match = ratio.match(/1\s+in\s+(\d+(?:\.\d+)?)/i)
  return match ? Number(match[1]) : null
}

function numberOrZero(value) {
  return Number(value ?? 0) || 0
}

function extractYear(text = '') {
  const match = String(text).match(/\b(20\d{2})\b/)
  return match ? Number(match[1]) : null
}

function slugify(value) {
  return cleanHtml(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

function unique(values) {
  return [...new Set(values.filter(Boolean))]
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

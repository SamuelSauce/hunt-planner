import { execFileSync } from 'node:child_process'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const workspaceDir = path.resolve(rootDir, '..')
const sourcePdfDir = path.join(workspaceDir, 'work', 'colorado-pdfs')
const dataDir = path.join(rootDir, 'src', 'data')

const CPW_BASE = 'https://cpw.state.co.us'
const CPW_HUNT_ATLAS = 'https://ndismaps.nrel.colostate.edu/index.html?app=HuntingAtlas'

const speciesPages = [
  { slug: 'elk', name: 'Elk', code: 'E' },
  { slug: 'deer', name: 'Deer', code: 'D' },
  { slug: 'pronghorn', name: 'Pronghorn', code: 'A' },
  { slug: 'bear', name: 'Bear', code: 'B' },
  { slug: 'moose', name: 'Moose', code: 'M' },
  { slug: 'bighorn-sheep', name: 'Bighorn Sheep', code: 'S' },
  { slug: 'mountain-goat', name: 'Mountain Goat', code: 'G' },
].map((species) => ({
  ...species,
  url: `${CPW_BASE}/activities/hunting/big-game/hunting-${species.slug}/${species.slug}-statistics`,
}))

const reportTypeLabels = new Map([
  ['Draw Recap', 'draw-recap'],
  ['Drawn Out At', 'drawn-out'],
  ['Secondary Draw Recap', 'secondary-draw'],
  ['Harvest', 'harvest'],
  ['Population Estimates', 'population'],
  ['Over the Counter Sales', 'otc-sales'],
])

const adultColumns = {
  resident: { start: 94, end: 105 },
  nonresident: { start: 105, end: 117 },
}

async function main() {
  await mkdir(sourcePdfDir, { recursive: true })
  await mkdir(dataDir, { recursive: true })

  const reports = []
  const hunts = []

  for (const species of speciesPages) {
    const html = await fetchText(species.url)
    const speciesReports = parseReportCatalog(html, species)
    reports.push(...speciesReports)

    const drawnOutReports = speciesReports
      .filter((report) => report.sourceType === 'drawn-out')
      .sort((a, b) => b.year - a.year)

    for (const drawnOutReport of drawnOutReports) {
      try {
        const pdfUrl = await resolveWidenPdfUrl(drawnOutReport.url)
        const pdfPath = path.join(
          sourcePdfDir,
          `${drawnOutReport.year}-${species.slug}-drawn-out.pdf`,
        )
        await downloadIfMissing(pdfUrl, pdfPath)
        hunts.push(...parseDrawnOutReport(pdfPath, species, drawnOutReport, pdfUrl))
        break
      } catch (error) {
        console.warn(`Skipping ${drawnOutReport.title}: ${error.message}`)
      }
    }
  }

  const data = {
    generatedAt: new Date().toISOString(),
    notices: [
      'Colorado Parks and Wildlife draw recap and drawn-out reports describe historical draw outcomes, not guaranteed future odds.',
      'Colorado rows use CPW drawn-out-at data for adult resident and adult nonresident columns. Youth and landowner columns are not yet modeled.',
      'Harvest and population reports are included in the report library; per-hunt harvest rows are not yet parsed into cards.',
    ],
    sourcePages: {
      statistics: 'https://cpw.state.co.us/activities/hunting/big-game',
      huntAtlas: CPW_HUNT_ATLAS,
      ...Object.fromEntries(speciesPages.map((species) => [`${species.slug}Statistics`, species.url])),
    },
    reports: dedupeReports(reports),
    hunts: dedupeHunts(hunts),
  }

  await writeFile(
    path.join(dataDir, 'cpw-data.json'),
    `${JSON.stringify(data, null, 2)}\n`,
  )

  console.log(
    `Generated ${data.hunts.length} Colorado hunt records and ${data.reports.length} CPW report links.`,
  )
}

async function fetchText(url) {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Fetch failed ${response.status} ${url}`)
  }
  return response.text()
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

async function resolveWidenPdfUrl(url) {
  const html = await fetchText(url)
  const downloadHref = html.match(/href="([^"]+?\/content\/[^"]+?\/original\/[^"]+?\.pdf[^"]*?download=true[^"]*)"/i)
  if (downloadHref) {
    return new URL(decodeHtml(downloadHref[1]), url).href
  }

  const viewerUrl = html.match(/window\.viewerPdfUrl\s*=\s*'([^']+)'/i)
  if (viewerUrl) {
    return decodeHtml(viewerUrl[1])
  }

  throw new Error(`Could not resolve PDF download URL for ${url}`)
}

function parseReportCatalog(html, species) {
  const reports = []
  let currentType = 'other'
  const anchorPattern = /<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi

  for (const match of html.matchAll(anchorPattern)) {
    const href = decodeHtml(match[1])
    const text = cleanHtml(match[2])
    if (!text) continue

    const sectionType = reportTypeLabels.get(text)
    if (sectionType) {
      currentType = sectionType
      continue
    }

    const year = Number(text.match(/\b(20\d{2})\b/)?.[1] ?? 0)
    if (!year || !/Report|Sales/i.test(text)) continue

    const url = new URL(href, CPW_BASE).href
    reports.push({
      id: `co-${species.slug}-${currentType}-${year}-${slugify(text)}`,
      state: 'colorado',
      sourceType: currentType,
      year,
      species: species.name,
      category: reportTypeLabel(currentType),
      title: `${species.name} ${text.replace(/\s+/g, ' ')}`,
      url,
      size: 'CPW',
      pageUrl: species.url,
    })
  }

  return reports
}

function parseDrawnOutReport(pdfPath, species, report, pdfUrl) {
  const text = pdfToText(pdfPath)
  const lines = text.split('\n')
  const hunts = []
  const seen = new Set()

  for (let index = 0; index < lines.length; index += 1) {
    const code = lines[index].trim()
    if (!isHuntCode(code)) continue
    if (seen.has(code)) continue

    const finalLine = lines.slice(index + 1, index + 5).find((line) => line.includes('# Drawn at Final Level'))
    if (!finalLine) continue

    const drawnRows = [lines[index - 4] ?? '', lines[index - 3] ?? '', lines[index - 2] ?? '']
    const adultResident = parseAdultColumn(drawnRows, finalLine, adultColumns.resident)
    const adultNonresident = parseAdultColumn(drawnRows, finalLine, adultColumns.nonresident)
    if (!adultResident.drawnOutAt && !adultNonresident.drawnOutAt) continue

    seen.add(code)
    const unit = extractUnit(code)
    hunts.push({
      id: `co-${code}`,
      state: 'colorado',
      huntNumber: code,
      species: species.name,
      gender: sexLabel(code),
      huntName: unit ? `GMU ${unit}` : 'Colorado hunt code',
      huntType: reportTypeLabel(report.sourceType),
      category: categorizeColoradoHunt(code, adultResident, adultNonresident),
      weapon: coloradoWeaponLabel(code),
      planningYear: report.year,
      seasonDateText: `${report.year} primary draw`,
      quota: null,
      currentSourceUrl: CPW_HUNT_ATLAS,
      harvest: null,
      odds: null,
      drawOut: {
        year: report.year,
        sourceUrl: pdfUrl,
        originalReportUrl: report.url,
        resident: adultResident,
        nonresident: adultNonresident,
      },
      sourceUrls: [pdfUrl, report.url, species.url, CPW_HUNT_ATLAS],
    })
  }

  return hunts
}

function parseAdultColumn(drawnRows, finalLine, column) {
  const drawnOutAt = normalizeCell(
    drawnRows.map((line) => sliceColumn(line, column)).join(' '),
  )
  const finalLevel = normalizeCell(sliceColumn(finalLine, column))
  const finalMatch = finalLevel?.match(/^(\d+)\s+of\s+(\d+)$/i) ?? null

  return {
    drawnOutAt: isCleanDrawStatus(drawnOutAt) ? drawnOutAt : null,
    finalLevel: finalMatch ? finalLevel : null,
    finalDrawn: finalMatch ? Number(finalMatch[1]) : null,
    finalApplicants: finalMatch ? Number(finalMatch[2]) : null,
  }
}

function sliceColumn(line, column) {
  return line.slice(column.start, column.end)
}

function isHuntCode(value) {
  return /^[A-Z]{2}[A-Z0-9]{3}[A-Z0-9]{2}[A-Z]$/.test(value)
}

function extractUnit(code) {
  return code.slice(2, 5).replace(/^0+/, '') || code.slice(2, 5)
}

function sexLabel(code) {
  const sexCode = code[1]
  return {
    E: 'Either sex',
    M: 'Male',
    F: 'Female',
    A: 'Either sex',
    O: 'Other',
  }[sexCode] ?? ''
}

function coloradoWeaponLabel(code) {
  const methodCode = code[5]
  return {
    A: 'Archery',
    M: 'Muzzleloader',
    R: 'Rifle',
    E: 'Early rifle',
    L: 'Late rifle',
    O: 'Rifle',
    P: 'Private-land-only',
    W: 'Ranching for Wildlife',
    V: 'Private-land-only',
  }[methodCode] ?? 'Method by hunt code'
}

function categorizeColoradoHunt(code, resident, nonresident) {
  if ([resident.drawnOutAt, nonresident.drawnOutAt].some((value) => value?.toLowerCase().includes('leftover'))) {
    return 'general-otc'
  }
  if (code[5] === 'W') {
    return 'cwmu'
  }
  return 'limited-entry'
}

function pdfToText(pdfPath) {
  return execFileSync('pdftotext', ['-layout', pdfPath, '-'], {
    encoding: 'utf8',
    maxBuffer: 200 * 1024 * 1024,
  })
}

function normalizeCell(value) {
  const cleaned = normalizeWhitespace(value)
    .replace(/\bN\/A\b/i, 'N/A')
    .replace(/\bNo Apps\b/i, 'No apps')
    .replace(/\bNone Drawn\b/i, 'None drawn')
    .replace(/\bPref Points\b/i, 'pref points')
    .replace(/\bPref Point\b/i, 'pref point')
  return cleaned === 'N/A' ? null : cleaned || null
}

function isCleanDrawStatus(value) {
  if (!value) return false
  return (
    /^\d+\+?\s+pref points?$/i.test(value) ||
    /^choice\s+[1-4]$/i.test(value) ||
    /^leftover$/i.test(value) ||
    /^none drawn$/i.test(value) ||
    /^no apps$/i.test(value)
  )
}

function reportTypeLabel(value) {
  return {
    'draw-recap': 'Draw recap',
    'drawn-out': 'Drawn out at',
    'secondary-draw': 'Secondary draw',
    harvest: 'Harvest',
    population: 'Population',
    'otc-sales': 'OTC sales',
    other: 'Report',
  }[value] ?? value
}

function dedupeReports(reports) {
  return [...new Map(reports.map((report) => [report.id, report])).values()].sort(
    (a, b) =>
      b.year - a.year ||
      a.species.localeCompare(b.species) ||
      a.category.localeCompare(b.category) ||
      a.title.localeCompare(b.title),
  )
}

function dedupeHunts(hunts) {
  return [...new Map(hunts.map((hunt) => [hunt.id, hunt])).values()].sort((a, b) =>
    a.huntNumber.localeCompare(b.huntNumber),
  )
}

function cleanHtml(html) {
  return decodeHtml(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
}

function decodeHtml(value) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
}

function normalizeWhitespace(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function slugify(value) {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

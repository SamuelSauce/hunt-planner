import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIST = path.join(ROOT, 'dist', 'client')
const CONTENT_DIR = path.join(ROOT, 'content', 'journal')
const SITE_URL = (process.env.SITE_URL || 'https://huntplanner-66d5e.web.app').replace(/\/+$/, '')
const GOOGLE_SITE_VERIFICATION =
  process.env.GOOGLE_SITE_VERIFICATION?.trim() || '8DsEg0bgSFxcrQAgYz-ThiMPYc-b1NsLjsMKcxMUZNs'
const ANALYTICS_ID = 'G-NC83FX30D5'
const VALIDATE_ONLY = process.argv.includes('--validate-only')
const CONTACT_EMAIL = 'samuelfbridge@gmail.com'
const MIN_STABLE_ODDS_APPLICANTS = 10
const PROBABLE_CHANCE = 25

const stateConfigs = [
  { key: 'utah', label: 'Utah', code: 'UT', agency: 'Utah DWR', file: 'udwr-data.json' },
  {
    key: 'colorado',
    label: 'Colorado',
    code: 'CO',
    agency: 'Colorado Parks and Wildlife',
    file: 'cpw-data.json',
  },
  { key: 'idaho', label: 'Idaho', code: 'ID', agency: 'Idaho Fish and Game', file: 'idfg-data.json' },
  {
    key: 'wyoming',
    label: 'Wyoming',
    code: 'WY',
    agency: 'Wyoming Game and Fish Department',
    file: 'wgfd-data.json',
  },
]

const escapeHtml = (value = '') =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')

const escapeXml = escapeHtml
const slugify = (value = '') =>
  String(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100)

const absoluteUrl = (pathname) => `${SITE_URL}${pathname.startsWith('/') ? pathname : `/${pathname}`}`
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'))
const unique = (values) => [...new Set(values.filter(Boolean))]
const formatNumber = (value) => (Number.isFinite(value) ? new Intl.NumberFormat('en-US').format(value) : '—')
const formatPercent = (value) => (Number.isFinite(value) ? `${Number(value).toFixed(1).replace('.0', '')}%` : '—')
const formatDate = (value) =>
  new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric' }).format(new Date(value))

function parseFrontmatter(source, file) {
  const normalized = source.replaceAll('\r\n', '\n')
  if (!normalized.startsWith('---\n')) throw new Error(`${file}: missing opening frontmatter delimiter`)
  const end = normalized.indexOf('\n---\n', 4)
  if (end === -1) throw new Error(`${file}: missing closing frontmatter delimiter`)
  const raw = normalized.slice(4, end)
  const data = {}
  raw.split('\n').forEach((line, index) => {
    if (!line.trim()) return
    const separator = line.indexOf(':')
    if (separator === -1) throw new Error(`${file}:${index + 2}: invalid frontmatter line`)
    const key = line.slice(0, separator).trim()
    let value = line.slice(separator + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    data[key] = value
  })
  return { data, body: normalized.slice(end + 5).trim() }
}

function renderInline(source) {
  let html = escapeHtml(source)
  html = html.replace(/!\[([^\]]*)\]\((https?:\/\/[^)\s]+|\/[^)\s]+)\)/g, '<img src="$2" alt="$1">')
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+|\/[^)\s]+)\)/g, '<a href="$2">$1</a>')
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>')
  return html
}

function renderMarkdown(markdown) {
  const lines = markdown.split('\n')
  const html = []
  let paragraph = []
  let listType = null
  let blockquote = []

  const flushParagraph = () => {
    if (!paragraph.length) return
    html.push(`<p>${renderInline(paragraph.join(' '))}</p>`)
    paragraph = []
  }
  const flushList = () => {
    if (!listType) return
    html.push(`</${listType}>`)
    listType = null
  }
  const flushBlockquote = () => {
    if (!blockquote.length) return
    html.push(`<blockquote><p>${renderInline(blockquote.join(' '))}</p></blockquote>`)
    blockquote = []
  }
  const flushAll = () => {
    flushParagraph()
    flushList()
    flushBlockquote()
  }

  for (const rawLine of lines) {
    const line = rawLine.trimEnd()
    if (!line.trim()) {
      flushAll()
      continue
    }
    const heading = line.match(/^(#{2,3})\s+(.+)$/)
    if (heading) {
      flushAll()
      const level = heading[1].length
      const title = heading[2].trim()
      html.push(`<h${level} id="${slugify(title)}">${renderInline(title)}</h${level}>`)
      continue
    }
    const unordered = line.match(/^\s*-\s+(.+)$/)
    const ordered = line.match(/^\s*\d+\.\s+(.+)$/)
    if (unordered || ordered) {
      flushParagraph()
      flushBlockquote()
      const nextType = unordered ? 'ul' : 'ol'
      if (listType && listType !== nextType) flushList()
      if (!listType) {
        listType = nextType
        html.push(`<${listType}>`)
      }
      html.push(`<li>${renderInline((unordered || ordered)[1])}</li>`)
      continue
    }
    const quote = line.match(/^>\s*(.+)$/)
    if (quote) {
      flushParagraph()
      flushList()
      blockquote.push(quote[1])
      continue
    }
    flushList()
    flushBlockquote()
    paragraph.push(line.trim())
  }
  flushAll()
  return html.join('\n')
}

function wordCount(markdown) {
  return markdown
    .replace(/\[[^\]]+\]\([^)]+\)/g, ' ')
    .replace(/[#*`>-]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length
}

function articlePath(article) {
  return `/journal/${article.data.slug}/`
}

function groupHunts() {
  const groups = new Map()
  for (const state of stateConfigs) {
    const data = readJson(path.join(ROOT, 'src', 'data', state.file))
    for (const rawHunt of data.hunts) {
      const hunt = { ...rawHunt, state: rawHunt.state || state.key }
      const key = [
        state.key,
        hunt.species.toLowerCase(),
        hunt.huntNumber.toLowerCase(),
        hunt.huntName.toLowerCase(),
      ].join('|')
      const existing = groups.get(key)
      if (existing) {
        existing.hunts.push(hunt)
      } else {
        groups.set(key, {
          key,
          state,
          species: hunt.species,
          huntNumber: hunt.huntNumber,
          huntName: hunt.huntName,
          hunts: [hunt],
        })
      }
    }
  }
  return [...groups.values()].sort(
    (a, b) =>
      a.state.label.localeCompare(b.state.label) ||
      a.species.localeCompare(b.species) ||
      a.huntNumber.localeCompare(b.huntNumber) ||
      a.huntName.localeCompare(b.huntName),
  )
}

function huntPath(group) {
  return `/hunts/${group.state.key}/${slugify(group.species)}/${slugify(`${group.huntNumber}-${group.huntName}`)}/`
}

function plannerUrl(group, view3d = false) {
  const params = new URLSearchParams({
    state: group.state.code,
    hunt: group.huntNumber,
    residency: 'resident',
  })
  if (view3d) params.set('view', '3d')
  return `/?${params.toString()}`
}

function loadArticles(groups) {
  const files = fs
    .readdirSync(CONTENT_DIR)
    .filter((name) => name.endsWith('.md'))
    .sort()
  const required = [
    'slug',
    'title',
    'description',
    'datePublished',
    'dateModified',
    'series',
    'state',
    'species',
    'huntNumber',
    'huntName',
    'authorName',
    'authorSlug',
    'heroImage',
    'heroAlt',
  ]
  const slugs = new Set()
  return files
    .map((name) => {
      const file = path.join(CONTENT_DIR, name)
      const parsed = parseFrontmatter(fs.readFileSync(file, 'utf8'), name)
      required.forEach((field) => {
        if (!parsed.data[field]) throw new Error(`${name}: missing required field "${field}"`)
      })
      if (slugs.has(parsed.data.slug)) throw new Error(`${name}: duplicate slug "${parsed.data.slug}"`)
      slugs.add(parsed.data.slug)
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(parsed.data.slug)) {
        throw new Error(`${name}: slug must contain lowercase letters, numbers and single hyphens`)
      }
      for (const dateField of ['datePublished', 'dateModified']) {
        if (Number.isNaN(Date.parse(parsed.data[dateField]))) {
          throw new Error(`${name}: invalid ${dateField}`)
        }
      }
      const heroFile = path.join(ROOT, 'public', parsed.data.heroImage.replace(/^\//, ''))
      if (!fs.existsSync(heroFile)) throw new Error(`${name}: hero image does not exist at ${parsed.data.heroImage}`)
      if (wordCount(parsed.body) < 800) throw new Error(`${name}: article body must contain at least 800 words`)
      const sourceLinks = [...parsed.body.matchAll(/https?:\/\/[^)\s]+/g)]
      if (sourceLinks.length < 4) throw new Error(`${name}: article must link at least four sources`)
      if (!parsed.body.includes('## Sources and verification')) {
        throw new Error(`${name}: article must contain a "Sources and verification" section`)
      }
      const group = groups.find(
        (candidate) =>
          candidate.state.key === parsed.data.state.toLowerCase() &&
          candidate.species.toLowerCase() === parsed.data.species.toLowerCase() &&
          candidate.huntNumber.toLowerCase() === parsed.data.huntNumber.toLowerCase() &&
          candidate.huntName.toLowerCase() === parsed.data.huntName.toLowerCase(),
      )
      if (!group) throw new Error(`${name}: no matching Hunt Planner record`)
      return { ...parsed, file: name, group }
    })
    .sort((a, b) => Date.parse(b.data.datePublished) - Date.parse(a.data.datePublished))
}

function metadata({
  title,
  description,
  pathname,
  image = '/og.png',
  type = 'website',
  published,
  modified,
  author,
}) {
  const url = absoluteUrl(pathname)
  const imageUrl = absoluteUrl(image)
  const [imageWidth, imageHeight] = image === '/og.png' ? [1731, 909] : [1200, 675]
  const verification = GOOGLE_SITE_VERIFICATION
    ? `<meta name="google-site-verification" content="${escapeHtml(GOOGLE_SITE_VERIFICATION)}">`
    : ''
  const articleMeta =
    type === 'article'
      ? `
    <meta property="article:published_time" content="${escapeHtml(published)}">
    <meta property="article:modified_time" content="${escapeHtml(modified)}">
    <meta property="article:author" content="${escapeHtml(author)}">`
      : ''
  return `
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}">
    <meta name="robots" content="index,follow,max-image-preview:large">
    ${verification}
    <link rel="canonical" href="${escapeHtml(url)}">
    <link rel="icon" type="image/svg+xml" href="/favicon.svg">
    <link rel="stylesheet" href="/editorial.css">
    <link rel="alternate" type="application/rss+xml" title="Hunt Planner Journal" href="${absoluteUrl('/feed.xml')}">
    <meta property="og:type" content="${type}">
    <meta property="og:site_name" content="Hunt Planner">
    <meta property="og:title" content="${escapeHtml(title)}">
    <meta property="og:description" content="${escapeHtml(description)}">
    <meta property="og:url" content="${escapeHtml(url)}">
    <meta property="og:image" content="${escapeHtml(imageUrl)}">
    <meta property="og:image:width" content="${imageWidth}">
    <meta property="og:image:height" content="${imageHeight}">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${escapeHtml(title)}">
    <meta name="twitter:description" content="${escapeHtml(description)}">
    <meta name="twitter:image" content="${escapeHtml(imageUrl)}">${articleMeta}`
}

function analytics() {
  return `
    <script async src="https://www.googletagmanager.com/gtag/js?id=${ANALYTICS_ID}"></script>
    <script>
      window.dataLayer = window.dataLayer || [];
      function gtag(){dataLayer.push(arguments);}
      gtag('js', new Date());
      gtag('config', '${ANALYTICS_ID}');
    </script>`
}

function header() {
  return `
    <header class="site-header">
      <nav class="site-nav" aria-label="Primary navigation">
        <a class="site-brand" href="/"><span class="brand-mark" aria-hidden="true"></span>Hunt Planner</a>
        <div class="nav-links">
          <a href="/hunts/">Hunt library</a>
          <a href="/journal/">Journal</a>
          <a href="/community">Community</a>
          <a href="/methodology/">Methodology</a>
          <a class="nav-cta" href="/">Open planner</a>
        </div>
      </nav>
    </header>`
}

function footer() {
  return `
    <footer class="site-footer">
      <div class="footer-inner">
        <div><strong>Hunt Planner</strong><p>Unofficial, data-driven western big-game research. Always verify current regulations, boundaries and access with the responsible wildlife agency.</p></div>
        <div class="footer-links">
          <a href="/about/">About</a>
          <a href="/authors/hunt-planner-research-desk/">Author</a>
          <a href="/methodology/">Methodology</a>
          <a href="/editorial-policy/">Editorial &amp; AI policy</a>
          <a href="/corrections/">Corrections</a>
          <a href="/feed.xml">RSS</a>
        </div>
      </div>
    </footer>`
}

function jsonLd(value) {
  return `<script type="application/ld+json">${JSON.stringify(value).replaceAll('<', '\\u003c')}</script>`
}

function breadcrumbLd(items) {
  return jsonLd({
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: absoluteUrl(item.path),
    })),
  })
}

function breadcrumbs(items) {
  return `<nav class="breadcrumbs" aria-label="Breadcrumb">${items
    .map((item, index) =>
      index === items.length - 1
        ? `<span aria-current="page">${escapeHtml(item.name)}</span>`
        : `<a href="${item.path}">${escapeHtml(item.name)}</a><span aria-hidden="true">/</span>`,
    )
    .join('')}</nav>`
}

function documentHtml({ head, structuredData = '', body }) {
  return `<!doctype html>
<html lang="en">
  <head>${head}${structuredData}${analytics()}</head>
  <body>${header()}${body}${footer()}</body>
</html>`
}

function writePage(pathname, html) {
  const relative = pathname.replace(/^\/|\/$/g, '')
  const directory = path.join(DIST, relative)
  fs.mkdirSync(directory, { recursive: true })
  fs.writeFileSync(path.join(directory, 'index.html'), html)
}

function primaryHunt(group) {
  return (
    group.hunts.find((hunt) => hunt.harvest && (hunt.odds || hunt.drawOut || hunt.drawProfile)) ||
    group.hunts.find((hunt) => hunt.harvest) ||
    group.hunts[0]
  )
}

function drawHunt(group) {
  return (
    group.hunts.find((hunt) => hunt.odds || hunt.drawOut || hunt.drawProfile) ||
    primaryHunt(group)
  )
}

function clampPercent(value) {
  return Math.max(0, Math.min(100, value))
}

function pointRowChance(row) {
  if (row.totalPermits <= 0) return 0
  if (row.successRatioValue && row.successRatioValue > 0) {
    return clampPercent(100 / row.successRatioValue)
  }
  if (row.eligibleApplicants <= 0) return 0
  return clampPercent((row.totalPermits / row.eligibleApplicants) * 100)
}

function estimatePointSequence(chanceByPoint) {
  const points = [...chanceByPoint.keys()].filter(
    (point) => Number.isFinite(point) && point >= 0,
  )
  if (points.length === 0) return null

  const maxPoint = Math.max(...points)
  let remainingChance = 1
  for (let point = 0; point <= maxPoint; point += 1) {
    const annualChance = (chanceByPoint.get(point) ?? 0) / 100
    remainingChance *= 1 - annualChance
    const cumulativeChance = (1 - remainingChance) * 100
    if (cumulativeChance >= 50) {
      return {
        years: point + 1,
        pointLevel: point,
        cumulativeChance,
      }
    }
  }
  return null
}

function estimatePointOdds(side) {
  if (!side || side.byPoint.length === 0) return null
  return estimatePointSequence(
    new Map(side.byPoint.map((row) => [row.points, pointRowChance(row)])),
  )
}

function usefulDrawTiers(side) {
  if (!side) return []
  const regularTiers = side.pointTiers.filter((tier) =>
    /regular|preference draw/i.test(tier.pool ?? ''),
  )
  const candidates = regularTiers.length > 0 ? regularTiers : side.pointTiers
  return candidates
    .filter((tier) => /^\d+(?:\.\d+)?$/.test(tier.label.trim()))
    .sort((a, b) => Number(a.label) - Number(b.label))
}

function estimateProfileTiers(side) {
  const tiers = usefulDrawTiers(side)
  if (tiers.length === 0) return null
  const chanceByPoint = new Map()
  tiers.forEach((tier) => {
    const point = Math.floor(Number(tier.label))
    const chance = clampPercent(tier.odds ?? 0)
    chanceByPoint.set(point, Math.max(chanceByPoint.get(point) ?? 0, chance))
  })
  return estimatePointSequence(chanceByPoint)
}

function estimateRepeatedOdds(odds) {
  if (!Number.isFinite(odds) || odds <= 0) return null
  const annualChance = clampPercent(odds) / 100
  if (annualChance >= 1) {
    return { years: 1, pointLevel: null, cumulativeChance: 100 }
  }
  const years = Math.ceil(Math.log(0.5) / Math.log(1 - annualChance))
  return {
    years,
    pointLevel: null,
    cumulativeChance: (1 - Math.pow(1 - annualChance, years)) * 100,
  }
}

function estimateP50Draw(hunt, residency) {
  const pointEstimate = estimatePointOdds(hunt.odds?.[residency] ?? null)
  if (pointEstimate) return pointEstimate

  const profile = hunt.drawProfile
  const side = profile?.[residency] ?? null
  if (!profile || !side) return null
  if (profile.system === 'preference-random') {
    const tierEstimate = estimateProfileTiers(side)
    if (tierEstimate) return tierEstimate
  }
  return estimateRepeatedOdds(side.odds)
}

function p50DrawText(estimate) {
  const years = `${estimate.years} ${estimate.years === 1 ? 'yr' : 'yrs'}`
  return estimate.pointLevel === null ? years : `${years} / ${estimate.pointLevel} pts`
}

function oddsChance(row) {
  if (!row.successRatioValue || row.totalPermits === 0) return null
  return Math.min(100, 100 / row.successRatioValue)
}

function allOddsTiers(side) {
  return side.byPoint
    .map((row) => {
      const chance = oddsChance(row)
      return chance === null ? null : { ...row, chance }
    })
    .filter(Boolean)
    .sort((a, b) => a.points - b.points)
}

function stableOddsTiers(side) {
  return allOddsTiers(side).filter(
    (tier) => tier.eligibleApplicants >= MIN_STABLE_ODDS_APPLICANTS,
  )
}

function probableOddsTiers(side) {
  return stableOddsTiers(side).filter((tier) => tier.chance >= PROBABLE_CHANCE)
}

function firstCertainTier(side) {
  return allOddsTiers(side).find((tier) => tier.chance >= 99.5) ?? null
}

function bestStableOddsTier(side) {
  return stableOddsTiers(side).sort((a, b) => b.chance - a.chance)[0] ?? null
}

function probableSummaryText(side) {
  const probable = probableOddsTiers(side)
  const certain = firstCertainTier(side)
  if (probable.length > 0) {
    const first = probable[0]
    if (certain && certain.points !== first.points) {
      return `${PROBABLE_CHANCE}%+ at ${first.points} pts; 100% at ${certain.points} pts`
    }
    if (certain) return `${PROBABLE_CHANCE}%+ and 100% at ${first.points} pts`
    return `${PROBABLE_CHANCE}%+ at ${first.points} pts`
  }
  if (certain) return `100% reported at ${certain.points} pts`
  const stableBest = bestStableOddsTier(side)
  if (stableBest) {
    return `Best row: ${formatPercent(stableBest.chance)} at ${stableBest.points} pts`
  }
  return allOddsTiers(side).length > 0
    ? `No reliable ${PROBABLE_CHANCE}%+ tier`
    : 'No issued permits'
}

function firstProbablePointText(side) {
  const first = probableOddsTiers(side)[0]
  if (!first) {
    return allOddsTiers(side).length > 0
      ? `No reliable ${PROBABLE_CHANCE}%+ tier`
      : `No ${PROBABLE_CHANCE}%+ tier`
  }
  return `${first.points} points (${formatPercent(first.chance)})`
}

function pointSummaryText(side) {
  const certain = firstCertainTier(side)
  if (certain) return `${certain.points} pts`
  const best = bestStableOddsTier(side)
  if (best) return `Best: ${formatPercent(best.chance)} at ${best.points} pts`
  return allOddsTiers(side).length > 0 ? 'No reliable 100% tier' : 'N/A'
}

function chartLabelTiers(tiers) {
  if (tiers.length <= 7) return tiers
  const labeledPoints = new Set([tiers[0].points, tiers[tiers.length - 1].points])
  for (const target of [PROBABLE_CHANCE, 50, 75, 100]) {
    const tier = tiers.find((candidate) => candidate.chance >= target)
    if (tier) labeledPoints.add(tier.points)
  }
  return tiers.filter((tier) => labeledPoints.has(tier.points))
}

function oddsChart(side, label) {
  const tiers = allOddsTiers(side)
  if (tiers.length === 0) {
    return '<p class="draw-empty">No permits were issued in the parsed point rows.</p>'
  }

  const width = 720
  const height = 210
  const margin = { top: 24, right: 24, bottom: 30, left: 48 }
  const maxPoints = Math.max(1, ...tiers.map((tier) => tier.points))
  const innerWidth = width - margin.left - margin.right
  const innerHeight = height - margin.top - margin.bottom
  const xFor = (points) => margin.left + (points / maxPoints) * innerWidth
  const yFor = (chance) => margin.top + ((100 - chance) / 100) * innerHeight
  const points = tiers.map((tier) => `${xFor(tier.points)},${yFor(tier.chance)}`).join(' ')
  const labels = chartLabelTiers(tiers)
  const chartId = `draw-chart-${slugify(label)}`

  return `
    <div class="static-chart-scroll" tabindex="0" aria-label="Scrollable point-level draw odds chart">
      <svg class="static-odds-chart" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="${chartId}-title ${chartId}-desc">
        <title id="${chartId}-title">${escapeHtml(label)} point-level draw odds</title>
        <desc id="${chartId}-desc">Historical first-choice odds by preference or bonus point tier.</desc>
        ${[0, 50, 100]
          .map((tick) => {
            const y = yFor(tick)
            return `<line class="static-chart-grid" x1="${margin.left}" x2="${width - margin.right}" y1="${y}" y2="${y}"></line><text class="static-chart-tick" x="${margin.left - 10}" y="${y + 4}" text-anchor="end">${tick}%</text>`
          })
          .join('')}
        ${tiers.length > 1 ? `<polyline class="static-chart-line" points="${points}"></polyline>` : ''}
        ${labels
          .map((tier, index) => {
            const x = xFor(tier.points)
            const y = yFor(tier.chance)
            const placeBelow = tier.chance >= 82
            const offset = 16 + (index % 2) * 10
            const labelY = Math.max(
              margin.top + 10,
              Math.min(height - margin.bottom - 6, y + (placeBelow ? offset : -offset)),
            )
            return `<text class="static-chart-point-label" x="${x}" y="${labelY}" text-anchor="middle">${tier.points}p ${formatPercent(tier.chance)}</text>`
          })
          .join('')}
        ${tiers
          .map((tier) => {
            const x = xFor(tier.points)
            const y = yFor(tier.chance)
            return `<circle class="static-chart-dot" cx="${x}" cy="${y}" r="6"><title>${tier.points} pts: ${formatPercent(tier.chance)} odds; ${formatNumber(tier.eligibleApplicants)} applicants / ${formatNumber(tier.totalPermits)} permits</title></circle>`
          })
          .join('')}
      </svg>
    </div>`
}

function drawMetric(label, value) {
  return `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`
}

function pointDrawSide(hunt, residency, open = false) {
  const side = hunt.odds?.[residency]
  const residencyLabel = residency === 'resident' ? 'Resident' : 'Nonresident'
  if (!side) return ''
  const p50 = estimateP50Draw(hunt, residency)
  const totalRatio = side.totals?.successRatio ?? 'Not reported'
  const totalCounts = side.totals
    ? `${formatNumber(side.totals.eligibleApplicants)} applicants / ${formatNumber(side.totals.totalPermits)} permits`
    : 'Totals not reported'
  const summary = p50 ? p50DrawText(p50) : totalRatio

  return `
    <details class="draw-residency" ${open ? 'open' : ''}>
      <summary><span>${residencyLabel}</span><strong>${escapeHtml(summary)}</strong></summary>
      <div class="draw-residency-body">
        <div class="draw-card-head">
          <span>${hunt.odds.year} points vs odds</span>
          <strong>${escapeHtml(probableSummaryText(side))}</strong>
        </div>
        ${oddsChart(side, `${hunt.huntNumber}-${residency}`)}
        <div class="draw-metric-grid">
          ${drawMetric('Estimated P50 draw', p50 ? p50DrawText(p50) : 'Not estimable')}
          ${drawMetric(`${hunt.odds.year} total`, totalRatio)}
          ${drawMetric(`${PROBABLE_CHANCE}%+ begins`, firstProbablePointText(side))}
          ${drawMetric('Near certain', pointSummaryText(side))}
          ${drawMetric('Lowest point issued', String(side.summary?.lowestPointWithPermit ?? 'N/A'))}
          ${drawMetric('Applicant pool', totalCounts)}
        </div>
      </div>
    </details>`
}

function drawProfileHeadline(profile, side) {
  if (!side) return 'No result for this residency'
  if (profile.system === 'random') {
    return Number.isFinite(side.odds)
      ? `${formatPercent(side.odds)} first-choice odds`
      : 'Random draw; odds not reported'
  }
  const randomPool =
    side.pools.find((pool) => /regular random|random draw|first-choice/i.test(pool.label)) ??
    side.pools[0]
  const certainTier = usefulDrawTiers(side)
    .filter((tier) => Number.isFinite(tier.odds) && tier.odds >= 99.5)
    .sort((a, b) => Number(a.label) - Number(b.label))[0]
  const parts = []
  if (Number.isFinite(randomPool?.odds)) {
    parts.push(`${formatPercent(randomPool.odds)} ${randomPool.label.toLowerCase()}`)
  }
  if (certainTier) parts.push(`100% at ${certainTier.label} pts`)
  return parts.join('; ') || 'Pool-specific draw results'
}

function profileDrawSide(hunt, residency, open = false) {
  const profile = hunt.drawProfile
  const side = profile?.[residency] ?? null
  if (!profile) return ''
  const residencyLabel = residency === 'resident' ? 'Resident' : 'Nonresident'
  const p50 = estimateP50Draw(hunt, residency)
  const tiers = usefulDrawTiers(side)
  const summary = p50
    ? p50DrawText(p50)
    : drawProfileHeadline(profile, side)

  return `
    <details class="draw-residency" ${open ? 'open' : ''}>
      <summary><span>${residencyLabel}</span><strong>${escapeHtml(summary)}</strong></summary>
      <div class="draw-residency-body">
        <div class="draw-card-head">
          <span>${profile.year} ${profile.system === 'random' ? 'random draw' : 'draw pools'}</span>
          <strong>${escapeHtml(drawProfileHeadline(profile, side))}</strong>
        </div>
        ${
          side
            ? `<div class="draw-pool-grid">${side.pools
                .slice(0, 4)
                .map(
                  (pool) =>
                    `<div><span>${escapeHtml(pool.label)}</span><strong>${formatPercent(pool.odds)}</strong><small>${
                      Number.isFinite(pool.applicants) && Number.isFinite(pool.permits)
                        ? `${formatNumber(pool.permits)} permits / ${formatNumber(pool.applicants)} applicants`
                        : 'Official reported result'
                    }</small></div>`,
                )
                .join('')}${
                  side.pools.length === 0
                    ? `<div><span>Reported odds</span><strong>${formatPercent(side.odds)}</strong></div>`
                    : ''
                }</div>`
            : '<p class="draw-empty">No result row for this residency and license type.</p>'
        }
        ${
          tiers.length
            ? `<div class="static-tier-list"><div><span>Preference tier</span><strong>Odds</strong></div>${tiers
                .map(
                  (tier) =>
                    `<div><span><strong>${escapeHtml(tier.label)} pts</strong><small>${escapeHtml(tier.pool ?? 'Preference draw')}</small></span><strong>${formatPercent(tier.odds)}</strong></div>`,
                )
                .join('')}</div>`
            : ''
        }
        <div class="draw-metric-grid">
          ${drawMetric('Estimated P50 draw', p50 ? p50DrawText(p50) : 'Not estimable')}
          ${drawMetric('Applicants', formatNumber(side?.applicants))}
          ${drawMetric('Permits', formatNumber(side?.permits))}
          ${drawMetric('Draw system', profile.system === 'random' ? 'Random; no points' : 'Preference + random')}
        </div>
      </div>
    </details>`
}

function drawOutFinalLevelText(side) {
  if (Number.isFinite(side?.finalDrawn) && Number.isFinite(side?.finalApplicants)) {
    return `${side.finalDrawn} of ${side.finalApplicants} at final level`
  }
  return side?.finalLevel ?? 'N/A'
}

function drawOutSide(hunt, residency, open = false) {
  const side = hunt.drawOut?.[residency]
  if (!side || !hunt.drawOut) return ''
  const residencyLabel = residency === 'resident' ? 'Resident' : 'Nonresident'
  const drawnOutAt = side.drawnOutAt ?? 'Not issued'
  return `
    <details class="draw-residency" ${open ? 'open' : ''}>
      <summary><span>${residencyLabel}</span><strong>${escapeHtml(drawnOutAt)}</strong></summary>
      <div class="draw-residency-body">
        <div class="draw-card-head">
          <span>${hunt.drawOut.year} drawn out at</span>
          <strong>${escapeHtml(drawnOutAt)}</strong>
        </div>
        <div class="draw-metric-grid">
          ${drawMetric('Draw status', drawnOutAt)}
          ${drawMetric('Final level', drawOutFinalLevelText(side))}
        </div>
      </div>
    </details>`
}

function drawOutlook(group) {
  const hunt = drawHunt(group)
  if (hunt.odds) {
    return `
      <section class="draw-outlook" data-draw-format="point-odds">
        <div class="section-heading">
          <p class="eyebrow">Historical draw data</p>
          <h2>Point-level draw outlook</h2>
          <p>These are historical first-choice results for this exact hunt number, not a prediction. P50 estimates use the same point-tier calculation shown on Hunt Planner cards.</p>
        </div>
        ${pointDrawSide(hunt, 'resident', true)}
        ${pointDrawSide(hunt, 'nonresident')}
      </section>`
  }
  if (hunt.drawProfile) {
    return `
      <section class="draw-outlook" data-draw-format="draw-profile">
        <div class="section-heading">
          <p class="eyebrow">Historical draw data</p>
          <h2>${hunt.drawProfile.system === 'random' ? 'Random draw outlook' : 'Preference and random draw outlook'}</h2>
          <p>${escapeHtml(hunt.drawProfile.description)} P50 estimates use the same historical calculation shown on Hunt Planner cards.</p>
        </div>
        ${profileDrawSide(hunt, 'resident', true)}
        ${profileDrawSide(hunt, 'nonresident')}
      </section>`
  }
  if (hunt.drawOut) {
    return `
      <section class="draw-outlook" data-draw-format="draw-out">
        <div class="section-heading">
          <p class="eyebrow">Historical draw data</p>
          <h2>Drawn-out-at results</h2>
          <p>Historical results show the point or choice level where licenses ran out for this exact hunt code.</p>
        </div>
        ${drawOutSide(hunt, 'resident', true)}
        ${drawOutSide(hunt, 'nonresident')}
      </section>`
  }
  return `
    <section class="draw-outlook draw-unavailable" data-draw-format="unavailable">
      <div class="section-heading">
        <p class="eyebrow">Historical draw data</p>
        <h2>No matching draw history yet</h2>
        <p>No parsed historical draw table is linked to hunt ${escapeHtml(group.huntNumber)}. Hunt Planner does not borrow odds from a neighboring hunt number or season because quotas, applicant pools and eligibility can differ.</p>
      </div>
      <a class="text-link" href="${plannerUrl(group)}">Check this hunt in the interactive planner</a>
    </section>`
}

function drawSummaryMetric(group) {
  const hunt = drawHunt(group)
  const p50 = estimateP50Draw(hunt, 'resident')
  if (p50) return { label: 'Est. resident P50', value: p50DrawText(p50) }
  if (hunt.drawOut) {
    return {
      label: 'Resident draw',
      value: hunt.drawOut.resident?.drawnOutAt ?? 'Not issued',
    }
  }
  if (hunt.drawProfile?.resident && Number.isFinite(hunt.drawProfile.resident.odds)) {
    return {
      label: 'Resident draw',
      value: formatPercent(hunt.drawProfile.resident.odds),
    }
  }
  return { label: 'Draw history', value: 'Not available' }
}

function huntStats(group) {
  const hunt = primaryHunt(group)
  const quota = group.hunts.find((item) => item.quota)?.quota
  const harvest = group.hunts.find((item) => item.harvest)?.harvest
  const publicLand = group.hunts.find((item) => Number.isFinite(item.publicLandPercent))?.publicLandPercent
  return {
    hunt,
    quota,
    harvest,
    publicLand,
    drawSummary: drawSummaryMetric(group),
  }
}

function statCards(group) {
  const stats = huntStats(group)
  return `
    <div class="stats-grid" aria-label="Hunt snapshot">
      <div class="stat-card"><span>Season</span><strong>${escapeHtml(stats.hunt.seasonDateText || 'See agency')}</strong></div>
      <div class="stat-card"><span>Total permits</span><strong>${formatNumber(stats.quota?.total)}</strong></div>
      <div class="stat-card"><span>Harvest success</span><strong>${formatPercent(stats.harvest?.successRate)}</strong></div>
      <div class="stat-card"><span>${escapeHtml(stats.drawSummary.label)}</span><strong>${escapeHtml(stats.drawSummary.value)}</strong></div>
    </div>`
}

function articlePage(article) {
  const pathname = articlePath(article)
  const groupPath = huntPath(article.group)
  const items = [
    { name: 'Home', path: '/' },
    { name: 'Journal', path: '/journal/' },
    { name: article.data.series, path: '/journal/' },
    { name: article.data.huntNumber, path: pathname },
  ]
  const structured = [
    {
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: article.data.title,
      description: article.data.description,
      image: [absoluteUrl(article.data.heroImage)],
      datePublished: article.data.datePublished,
      dateModified: article.data.dateModified,
      mainEntityOfPage: absoluteUrl(pathname),
      author: {
        '@type': 'Organization',
        name: article.data.authorName,
        url: absoluteUrl(`/authors/${article.data.authorSlug}/`),
      },
      publisher: {
        '@type': 'Organization',
        name: 'Hunt Planner',
        url: absoluteUrl('/about/'),
      },
      about: [
        { '@type': 'Thing', name: `${article.data.state} hunting` },
        { '@type': 'Thing', name: article.data.species },
        { '@type': 'Thing', name: article.data.huntNumber },
      ],
    },
  ]
  return documentHtml({
    head: metadata({
      title: article.data.title,
      description: article.data.description,
      pathname,
      image: article.data.heroImage,
      type: 'article',
      published: article.data.datePublished,
      modified: article.data.dateModified,
      author: article.data.authorName,
    }),
    structuredData: structured.map(jsonLd).join('') + breadcrumbLd(items),
    body: `
      <main class="article-shell">
        ${breadcrumbs(items)}
        <article>
          <header>
            <p class="eyebrow">${escapeHtml(article.data.series)} · ${escapeHtml(article.group.state.label)} ${escapeHtml(article.data.species)}</p>
            <h1 class="article-title">${escapeHtml(article.data.title)}</h1>
            <p class="dek">${escapeHtml(article.data.description)}</p>
            <div class="byline">
              <span>By <a href="/authors/${escapeHtml(article.data.authorSlug)}/">${escapeHtml(article.data.authorName)}</a></span>
              <time datetime="${escapeHtml(article.data.datePublished)}">Published ${formatDate(article.data.datePublished)}</time>
              <span>${formatNumber(wordCount(article.body))} words</span>
            </div>
          </header>
          <img class="hero-image" src="${escapeHtml(article.data.heroImage)}" width="1200" height="675" alt="${escapeHtml(article.data.heroAlt)}">
          <p class="image-caption">Hunt Planner orientation graphic derived from the published ${escapeHtml(article.group.state.agency)} hunt boundary. Not for field navigation.</p>
          ${statCards(article.group)}
          <aside class="action-band">
            <div><strong>Research ${escapeHtml(article.data.huntNumber)} in Hunt Planner</strong><span>Compare the official data, inspect the boundary or open the terrain in 3D.</span></div>
            <div class="button-row">
              <a class="button" href="${groupPath}">Hunt profile</a>
              <a class="button secondary" href="${plannerUrl(article.group, true)}">Open 3D map</a>
            </div>
          </aside>
          <div class="article-body">${renderMarkdown(article.body)}</div>
          <aside class="notice"><strong>Editorial note:</strong> This article uses official agency records and Hunt Planner calculations. Any public hunter reports are clearly labeled as anecdotal context. It was prepared with AI-assisted research and drafting, then checked against the linked sources. See the <a href="/editorial-policy/">editorial and AI policy</a>.</aside>
        </article>
      </main>`,
  })
}

function huntPage(group, related, matchingArticles) {
  const pathname = huntPath(group)
  const stats = huntStats(group)
  const title = `${group.state.label} ${group.species} Hunt ${group.huntNumber}: ${group.huntName} | Hunt Planner`
  const description = `Official-source planning data for ${group.state.label} ${group.species} hunt ${group.huntNumber}, ${group.huntName}: seasons, permits, draw and harvest details, sources and 3D map links.`
  const speciesPath = `/hunts/${group.state.key}/${slugify(group.species)}/`
  const items = [
    { name: 'Home', path: '/' },
    { name: 'Hunts', path: '/hunts/' },
    { name: group.state.label, path: `/hunts/${group.state.key}/` },
    { name: group.species, path: speciesPath },
    { name: group.huntNumber, path: pathname },
  ]
  const weapons = unique(group.hunts.map((hunt) => hunt.weapon))
  const seasons = unique(group.hunts.map((hunt) => hunt.seasonDateText))
  const sources = unique(
    group.hunts.flatMap((hunt) => [
      hunt.currentSourceUrl,
      hunt.odds?.sourceUrl,
      hunt.drawProfile?.sourceUrl,
      hunt.drawOut?.sourceUrl,
      hunt.harvest?.sourceUrl,
      ...(hunt.sourceUrls || []),
    ]),
  )
  const harvest = group.hunts.find((hunt) => hunt.harvest)?.harvest
  const quota = group.hunts.find((hunt) => hunt.quota)?.quota
  const publicLand = group.hunts.find((hunt) => Number.isFinite(hunt.publicLandPercent))?.publicLandPercent
  const structured = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: title,
    description,
    url: absoluteUrl(pathname),
    isPartOf: { '@type': 'WebSite', name: 'Hunt Planner', url: absoluteUrl('/') },
    about: [
      { '@type': 'Thing', name: `${group.state.label} hunting` },
      { '@type': 'Thing', name: group.species },
      { '@type': 'Thing', name: group.huntNumber },
    ],
  }
  const rows = [
    ['Hunt name', group.huntName],
    ['Species', group.species],
    ['Weapon', weapons.join(', ') || 'See agency'],
    ['Season', seasons.join(' · ') || 'See agency'],
    ['Planning year', String(stats.hunt.planningYear || 'See agency')],
    ['Total permits', quota ? formatNumber(quota.total) : 'Not published in dataset'],
    ['Resident permits', quota ? formatNumber(quota.resident) : 'Not published in dataset'],
    ['Nonresident permits', quota ? formatNumber(quota.nonresident) : 'Not published in dataset'],
    ['Harvest success', harvest ? `${formatPercent(harvest.successRate)} (${harvest.year})` : 'Not published in dataset'],
    ['Average days afield', harvest ? `${harvest.averageDays} (${harvest.year})` : 'Not published in dataset'],
    ['Public land', Number.isFinite(publicLand) ? `${publicLand}%` : 'Not published in dataset'],
  ]
  return documentHtml({
    head: metadata({ title, description, pathname }),
    structuredData: jsonLd(structured) + breadcrumbLd(items),
    body: `
      <main class="page-shell">
        ${breadcrumbs(items)}
        <p class="eyebrow">${escapeHtml(group.state.label)} · ${escapeHtml(group.species)} · Hunt ${escapeHtml(group.huntNumber)}</p>
        <h1 class="page-title">${escapeHtml(group.huntName)}</h1>
        <p class="dek">${escapeHtml(description)}</p>
        ${statCards(group)}
        ${drawOutlook(group)}
        <aside class="action-band">
          <div><strong>Move from numbers to terrain</strong><span>Open this hunt in the interactive planner or inspect its boundary in 3D.</span></div>
          <div class="button-row">
            <a class="button" href="${plannerUrl(group)}">Open planner</a>
            <a class="button secondary" href="${plannerUrl(group, true)}">Open 3D map</a>
          </div>
        </aside>
        <section class="prose-page">
          <h2>Hunt details</h2>
          <div class="library-list">${rows
            .map(
              ([label, value]) =>
                `<div class="library-row"><strong>${escapeHtml(label)}</strong><span>${escapeHtml(value)}</span></div>`,
            )
            .join('')}</div>
          <h2>Source records</h2>
          <p>Hunt Planner preserves the agency year attached to each statistic. Historical results describe past applicant pools and hunts; they do not guarantee future draw or harvest outcomes.</p>
          <ul>${sources.map((source) => `<li><a href="${escapeHtml(source)}">${escapeHtml(new URL(source).hostname)}</a></li>`).join('')}</ul>
          ${
            matchingArticles.length
              ? `<h2>Hunt Planner reporting</h2><div class="card-grid">${matchingArticles
                  .map(
                    (article) =>
                      `<a class="content-card" href="${articlePath(article)}"><small>${escapeHtml(article.data.series)} · ${formatDate(article.data.datePublished)}</small><h3>${escapeHtml(article.data.title)}</h3><p>${escapeHtml(article.data.description)}</p></a>`,
                  )
                  .join('')}</div>`
              : ''
          }
          <h2>Related ${escapeHtml(group.state.label)} ${escapeHtml(group.species)} hunts</h2>
          <div class="card-grid">${related
            .map(
              (candidate) =>
                `<a class="content-card" href="${huntPath(candidate)}"><small>${escapeHtml(candidate.huntNumber)}</small><h3>${escapeHtml(candidate.huntName)}</h3><p>${escapeHtml(unique(candidate.hunts.map((hunt) => hunt.weapon)).join(', '))}</p></a>`,
            )
            .join('')}</div>
          <aside class="notice">Hunt Planner is unofficial. Verify current regulations, season dates, legal weapons, permit rules, access and boundaries with ${escapeHtml(group.state.label)}'s wildlife agency before applying or hunting.</aside>
        </section>
      </main>`,
  })
}

function journalIndex(articles) {
  const pathname = '/journal/'
  const title = 'Hunt Planner Journal | Data-Driven Western Hunt Research'
  const description = 'Daily Hunt Briefs, map-based scouting analysis and draw reporting for western big-game hunters.'
  const items = [
    { name: 'Home', path: '/' },
    { name: 'Journal', path: pathname },
  ]
  return documentHtml({
    head: metadata({ title, description, pathname }),
    structuredData: breadcrumbLd(items),
    body: `
      <main class="page-shell">
        ${breadcrumbs(items)}
        <p class="eyebrow">Hunt Planner Journal</p>
        <h1 class="page-title">Turn hunt data into a plan.</h1>
        <p class="dek">${escapeHtml(description)} Every number carries its source year, every field report stays labeled as anecdotal, and every Hunt Brief leads back to the underlying map and agency material.</p>
        <div class="card-grid">${articles
          .map(
            (article) =>
              `<a class="content-card" href="${articlePath(article)}"><small>${escapeHtml(article.data.series)} · ${formatDate(article.data.datePublished)}</small><h2>${escapeHtml(article.data.title)}</h2><p>${escapeHtml(article.data.description)}</p></a>`,
          )
          .join('')}</div>
      </main>`,
  })
}

function huntLibraryIndex(groups) {
  const pathname = '/hunts/'
  const title = 'Western Big-Game Hunt Library | Hunt Planner'
  const description = `Browse ${formatNumber(groups.length)} statically rendered hunt profiles across Utah, Colorado, Idaho and Wyoming.`
  const items = [
    { name: 'Home', path: '/' },
    { name: 'Hunts', path: pathname },
  ]
  return documentHtml({
    head: metadata({ title, description, pathname }),
    structuredData: breadcrumbLd(items),
    body: `
      <main class="page-shell">
        ${breadcrumbs(items)}
        <p class="eyebrow">Hunt library</p>
        <h1 class="page-title">Every hunt gets a durable research page.</h1>
        <p class="dek">${escapeHtml(description)} Use these crawlable summaries to identify a hunt, then move into the interactive planner and 3D map for deeper comparison.</p>
        <div class="state-grid">${stateConfigs
          .map((state) => {
            const count = groups.filter((group) => group.state.key === state.key).length
            return `<a class="state-card" href="/hunts/${state.key}/"><small>${formatNumber(count)} profiles</small><h2>${state.label}</h2></a>`
          })
          .join('')}</div>
      </main>`,
  })
}

function stateIndex(state, groups) {
  const stateGroups = groups.filter((group) => group.state.key === state.key)
  const pathname = `/hunts/${state.key}/`
  const title = `${state.label} Big-Game Hunt Profiles | Hunt Planner`
  const description = `Browse ${formatNumber(stateGroups.length)} ${state.label} big-game hunt profiles with official-source seasons, draw, harvest and map links.`
  const items = [
    { name: 'Home', path: '/' },
    { name: 'Hunts', path: '/hunts/' },
    { name: state.label, path: pathname },
  ]
  const species = unique(stateGroups.map((group) => group.species)).sort()
  return documentHtml({
    head: metadata({ title, description, pathname }),
    structuredData: breadcrumbLd(items),
    body: `
      <main class="page-shell">
        ${breadcrumbs(items)}
        <p class="eyebrow">${escapeHtml(state.label)} hunt library</p>
        <h1 class="page-title">${escapeHtml(state.label)} big-game hunts</h1>
        <p class="dek">${escapeHtml(description)}</p>
        <div class="card-grid">${species
          .map((name) => {
            const count = stateGroups.filter((group) => group.species === name).length
            return `<a class="content-card" href="/hunts/${state.key}/${slugify(name)}/"><small>${formatNumber(count)} profiles</small><h2>${escapeHtml(name)}</h2><p>Browse hunt numbers, seasons and available official statistics.</p></a>`
          })
          .join('')}</div>
      </main>`,
  })
}

function speciesIndex(state, species, groups) {
  const matching = groups.filter((group) => group.state.key === state.key && group.species === species)
  const pathname = `/hunts/${state.key}/${slugify(species)}/`
  const title = `${state.label} ${species} Hunt Numbers & Profiles | Hunt Planner`
  const description = `Browse ${formatNumber(matching.length)} ${state.label} ${species.toLowerCase()} hunt profiles with agency-sourced planning data and map links.`
  const items = [
    { name: 'Home', path: '/' },
    { name: 'Hunts', path: '/hunts/' },
    { name: state.label, path: `/hunts/${state.key}/` },
    { name: species, path: pathname },
  ]
  return documentHtml({
    head: metadata({ title, description, pathname }),
    structuredData: breadcrumbLd(items),
    body: `
      <main class="page-shell">
        ${breadcrumbs(items)}
        <p class="eyebrow">${escapeHtml(state.label)} hunt library</p>
        <h1 class="page-title">${escapeHtml(species)} hunt profiles</h1>
        <p class="dek">${escapeHtml(description)}</p>
        <div class="library-list">${matching
          .map((group) => {
            const stats = huntStats(group)
            return `<a class="library-row" href="${huntPath(group)}"><strong>${escapeHtml(group.huntNumber)}</strong><span>${escapeHtml(group.huntName)}</span><small>${escapeHtml(unique(group.hunts.map((hunt) => hunt.weapon)).join(', '))}</small><small>${stats.harvest ? formatPercent(stats.harvest.successRate) : '—'}</small></a>`
          })
          .join('')}</div>
      </main>`,
  })
}

function prosePage({ pathname, title, eyebrow, description, html }) {
  const items = [
    { name: 'Home', path: '/' },
    { name: eyebrow, path: pathname },
  ]
  return documentHtml({
    head: metadata({ title: `${title} | Hunt Planner`, description, pathname }),
    structuredData: breadcrumbLd(items),
    body: `
      <main class="page-shell prose-page">
        ${breadcrumbs(items)}
        <p class="eyebrow">${escapeHtml(eyebrow)}</p>
        <h1 class="page-title">${escapeHtml(title)}</h1>
        <p class="dek">${escapeHtml(description)}</p>
        ${html}
      </main>`,
  })
}

function staticProsePages() {
  return [
    {
      pathname: '/about/',
      title: 'About Hunt Planner',
      eyebrow: 'About',
      description: 'An unofficial, data-driven workspace for comparing western big-game hunts and moving from application research into terrain.',
      html: `
        <h2>What Hunt Planner does</h2>
        <p>Hunt Planner brings agency-published seasons, permits, draw results, harvest surveys and hunt boundaries into one comparable workspace for Utah, Colorado, Idaho and Wyoming. Interactive maps and 3D terrain views help hunters carry that research into e-scouting.</p>
        <h2>What Hunt Planner is not</h2>
        <p>Hunt Planner is not a wildlife agency, outfitter or legal authority. Historical draw and harvest results do not guarantee future outcomes. Current agency regulations and maps always control.</p>
        <h2>The publication</h2>
        <p>The Hunt Planner Journal publishes Hunt Briefs, Map Lab analysis and draw reporting that begin with the underlying data. Public hunter reports are used only as attributed field context.</p>`,
    },
    {
      pathname: '/methodology/',
      title: 'Data and Editorial Methodology',
      eyebrow: 'Methodology',
      description: 'How Hunt Planner ingests official records, labels historical statistics, calculates planning signals and separates evidence from anecdote.',
      html: `
        <h2>Source hierarchy</h2>
        <ol><li>Current wildlife-agency regulations, hunt planners, permit tables and boundary files.</li><li>Agency draw and harvest reports with the source year preserved.</li><li>Other public-land and terrain datasets used in the map.</li><li>Public hunter discussions, used as anecdotal context rather than fact.</li></ol>
        <h2>Data handling</h2>
        <p>State systems are not forced into false equivalence. Hunt Planner preserves state-specific terminology and displays only fields supported by the source. Missing data remains missing rather than being inferred.</p>
        <h2>Draw and opportunity estimates</h2>
        <p>Estimated draw time and opportunity scores are planning aids derived from historical applicant and permit records. They are not predictions or guarantees. Random components, rule changes, point creep and applicant behavior can materially change outcomes.</p>
        <h2>Article verification</h2>
        <p>Every Hunt Brief must identify its matching hunt record, contain an original image, link at least four sources, include current official material and explain the limits of anecdotal reports. The content build stops when those requirements are missing.</p>`,
    },
    {
      pathname: '/editorial-policy/',
      title: 'Editorial and AI Policy',
      eyebrow: 'Editorial policy',
      description: 'The sourcing, automation, corrections and disclosure standards applied to Hunt Planner reporting.',
      html: `
        <h2>Original value first</h2>
        <p>Articles must add analysis from Hunt Planner's own structured records, comparisons or maps. They are not published merely to restate search results or forum posts.</p>
        <h2>AI assistance</h2>
        <p>AI may help select candidates, locate sources, structure research, draft language and run consistency checks. Every published article discloses that assistance. Numerical claims must trace to the linked Hunt Planner record or a cited source, and the automated workflow must skip publication when verification fails.</p>
        <h2>Hunter reports</h2>
        <p>Forum and social posts are attributed, linked and described as anecdotal. A single account is never presented as consensus. Hunt Planner does not publish private messages, personal information or precise locations that appear to expose another hunter's nonpublic spot.</p>
        <h2>Updates</h2>
        <p>Evergreen hunt profiles are updated at stable URLs. Published dates are not changed merely to make old material appear fresh; a modified date reflects a substantive correction or data update.</p>`,
    },
    {
      pathname: '/corrections/',
      title: 'Corrections',
      eyebrow: 'Corrections',
      description: 'Report a data, sourcing, boundary or editorial issue to Hunt Planner.',
      html: `
        <h2>Send a correction</h2>
        <p>Email <a href="mailto:${CONTACT_EMAIL}?subject=Hunt%20Planner%20correction">${CONTACT_EMAIL}</a> with the page URL, hunt number, disputed claim and the best available official source.</p>
        <h2>How corrections are handled</h2>
        <p>We verify the report against the relevant agency material, update the page when warranted and change the modified date for substantive corrections. The goal is a clear evidence trail, not silent rewriting.</p>
        <h2>Urgent regulatory issues</h2>
        <p>Hunt Planner is not the authority for legal advice or in-season emergencies. Contact the responsible wildlife agency or land manager directly when a current rule, closure, fire or access condition affects a hunt.</p>`,
    },
    {
      pathname: '/authors/hunt-planner-research-desk/',
      title: 'Hunt Planner Research Desk',
      eyebrow: 'Author',
      description: 'The organizational byline for Hunt Planner’s sourced, data-driven hunt reporting.',
      html: `
        <h2>What the byline means</h2>
        <p>The Hunt Planner Research Desk is an organizational byline. Its reporting combines agency-published records, Hunt Planner calculations, map analysis and attributed public field reports.</p>
        <h2>Review standard</h2>
        <p>Each article must pass the publication validator, preserve the year attached to historical statistics and link readers to the official material needed to verify current rules and boundaries.</p>
        <h2>Contact</h2>
        <p>Questions and corrections can be sent to <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>.</p>`,
    },
  ]
}

function rss(articles) {
  const items = articles
    .slice(0, 50)
    .map(
      (article) => `
    <item>
      <title>${escapeXml(article.data.title)}</title>
      <link>${escapeXml(absoluteUrl(articlePath(article)))}</link>
      <guid isPermaLink="true">${escapeXml(absoluteUrl(articlePath(article)))}</guid>
      <description>${escapeXml(article.data.description)}</description>
      <pubDate>${new Date(article.data.datePublished).toUTCString()}</pubDate>
    </item>`,
    )
    .join('')
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Hunt Planner Journal</title>
    <link>${SITE_URL}/journal/</link>
    <description>Data-driven western big-game Hunt Briefs, map analysis and draw reporting.</description>
    <language>en-us</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>${items}
  </channel>
</rss>`
}

function sitemap(pathnames) {
  const urls = unique(pathnames)
    .sort()
    .map((pathname) => `  <url><loc>${escapeXml(absoluteUrl(pathname))}</loc></url>`)
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`
}

function patchHomeVerification() {
  if (!GOOGLE_SITE_VERIFICATION) return
  const file = path.join(DIST, 'index.html')
  let html = fs.readFileSync(file, 'utf8')
  const tag = `<meta name="google-site-verification" content="${escapeHtml(GOOGLE_SITE_VERIFICATION)}">`
  html = html.replace('</head>', `    ${tag}\n  </head>`)
  fs.writeFileSync(file, html)
}

function main() {
  const groups = groupHunts()
  const articles = loadArticles(groups)
  if (VALIDATE_ONLY) {
    console.log(`Validated ${articles.length} article(s) against ${groups.length} hunt profiles.`)
    return
  }
  if (!fs.existsSync(DIST)) throw new Error('dist/ does not exist; run the Vite build first')

  const spaShell = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8')
  writePage('/community/', spaShell)

  const paths = ['/', '/hunts/', '/journal/', '/community/']
  writePage('/journal/', journalIndex(articles))
  writePage('/hunts/', huntLibraryIndex(groups))

  for (const article of articles) {
    const pathname = articlePath(article)
    writePage(pathname, articlePage(article))
    paths.push(pathname)
  }

  for (const state of stateConfigs) {
    const statePath = `/hunts/${state.key}/`
    writePage(statePath, stateIndex(state, groups))
    paths.push(statePath)
    const species = unique(groups.filter((group) => group.state.key === state.key).map((group) => group.species)).sort()
    for (const name of species) {
      const pathname = `/hunts/${state.key}/${slugify(name)}/`
      writePage(pathname, speciesIndex(state, name, groups))
      paths.push(pathname)
    }
  }

  for (const group of groups) {
    const matchingArticles = articles.filter((article) => article.group.key === group.key)
    const related = groups
      .filter(
        (candidate) =>
          candidate.key !== group.key &&
          candidate.state.key === group.state.key &&
          candidate.species === group.species,
      )
      .slice(0, 3)
    const pathname = huntPath(group)
    writePage(pathname, huntPage(group, related, matchingArticles))
    paths.push(pathname)
  }

  for (const page of staticProsePages()) {
    writePage(page.pathname, prosePage(page))
    paths.push(page.pathname)
  }

  fs.writeFileSync(path.join(DIST, 'feed.xml'), rss(articles))
  fs.writeFileSync(path.join(DIST, 'sitemap.xml'), sitemap(paths))
  fs.writeFileSync(
    path.join(DIST, 'robots.txt'),
    `User-agent: *\nAllow: /\n\nSitemap: ${absoluteUrl('/sitemap.xml')}\n`,
  )
  patchHomeVerification()

  console.log(`Generated ${groups.length} hunt profiles, ${articles.length} article(s), sitemap.xml and feed.xml.`)
}

main()

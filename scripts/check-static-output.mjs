import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIST = path.join(ROOT, 'dist', 'client')
const SITE_CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, 'site.config.json'), 'utf8'))
const SITE_URL = SITE_CONFIG.canonicalOrigin.replace(/\/+$/, '')
const LEGACY_ORIGINS = [
  'https://huntplanner-66d5e.web.app',
  'https://huntplanner-66d5e.firebaseapp.com',
]

function walk(directory, extension) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name)
    if (entry.isDirectory()) return walk(target, extension)
    return target.endsWith(extension) ? [target] : []
  })
}

function fail(message) {
  throw new Error(message)
}

function assertFileForUrl(url, sourceFile) {
  const parsed = new URL(url, SITE_URL)
  if (parsed.origin !== SITE_URL) return
  if (parsed.pathname === '/') {
    if (!fs.existsSync(path.join(DIST, 'index.html'))) fail(`${sourceFile}: missing home page`)
    return
  }
  const clean = parsed.pathname.replace(/^\/+|\/+$/g, '')
  const candidates = [
    path.join(DIST, clean),
    path.join(DIST, clean, 'index.html'),
    path.join(DIST, `${clean}.html`),
  ]
  if (!candidates.some((candidate) => fs.existsSync(candidate))) {
    fail(`${sourceFile}: broken internal URL ${parsed.pathname}`)
  }
}

function pathnameForHtml(file) {
  const relative = path.relative(DIST, file).replaceAll(path.sep, '/')
  if (relative === 'index.html') return '/'
  if (relative === '404.html') return null
  if (!relative.endsWith('/index.html')) fail(`${relative}: unexpected HTML output path`)
  return `/${relative.slice(0, -'index.html'.length)}`
}

function singleMatch(html, pattern, label, relative) {
  const matches = [...html.matchAll(pattern)]
  if (matches.length !== 1) {
    fail(`${relative}: expected exactly one ${label}; found ${matches.length}`)
  }
  return matches[0]
}

if (!fs.existsSync(DIST)) fail('dist/client/ does not exist; build the site before running seo:check')

const htmlFiles = walk(DIST, '.html')
if (htmlFiles.length < 4000) fail(`Expected at least 4,000 HTML pages; found ${htmlFiles.length}`)

let structuredDataBlocks = 0
let internalReferences = 0
let drawOutlookPages = 0
const indexableCanonicals = new Set()
const noindexCanonicals = new Set()
const titles = new Map()
const descriptions = new Map()
for (const file of htmlFiles) {
  const relative = path.relative(DIST, file)
  const html = fs.readFileSync(file, 'utf8')
  const headEnd = html.indexOf('</head>')
  if (headEnd === -1) fail(`${relative}: missing closing head tag`)
  const head = html.slice(0, headEnd)
  const pathname = pathnameForHtml(file)
  const noindex = /<meta\s+[^>]*name="robots"[^>]*content="[^"]*noindex/i.test(head)
  const requiredPatterns = [
    [/<title>[^<]+<\/title>/i, 'title'],
    [/<meta\s+[^>]*name="description"[^>]*content="[^"]+"[^>]*>/i, 'meta description'],
    [/<meta\s+[^>]*name="robots"[^>]*content="[^"]+"[^>]*>/i, 'robots directive'],
    [/<meta\s+[^>]*property="og:title"[^>]*content="[^"]+"[^>]*>/i, 'Open Graph title'],
    [/<meta\s+[^>]*property="og:image"[^>]*content="https:\/\/[^"]+"[^>]*>/i, 'Open Graph image'],
    ...(pathname === null
      ? []
      : [[/<script type="application\/ld\+json">/i, 'JSON-LD']]),
  ]
  for (const [pattern, label] of requiredPatterns) {
    if (!pattern.test(head)) fail(`${relative}: missing ${label}`)
  }

  const title = singleMatch(head, /<title>([^<]+)<\/title>/gi, 'title', relative)[1]
  const description = singleMatch(
    head,
    /<meta\s+name="description"\s+content="([^"]+)"\s*\/?>/gi,
    'meta description',
    relative,
  )[1]
  if (!noindex) {
    if (!/<meta\s+[^>]*name="robots"[^>]*content="[^"]*max-image-preview:large/i.test(head)) {
      fail(`${relative}: indexable page is missing the large image preview directive`)
    }
    if (title.length > 90) fail(`${relative}: title is ${title.length} characters`)
    if (description.length > 165) fail(`${relative}: description is ${description.length} characters`)
    if (titles.has(title)) fail(`${relative}: duplicate title also used by ${titles.get(title)}`)
    if (descriptions.has(description)) {
      fail(`${relative}: duplicate description also used by ${descriptions.get(description)}`)
    }
    titles.set(title, relative)
    descriptions.set(description, relative)
  }

  const canonicalMatches = [
    ...head.matchAll(/<link\s+rel="canonical"\s+href="([^"]+)"\s*\/?>/gi),
  ]
  if (pathname === null) {
    if (!noindex) fail(`${relative}: the 404 page must be noindex`)
    if (canonicalMatches.length !== 0) fail(`${relative}: the 404 page must not declare a canonical`)
  } else {
    if (canonicalMatches.length !== 1) {
      fail(`${relative}: expected exactly one canonical URL; found ${canonicalMatches.length}`)
    }
    const expectedCanonical = `${SITE_URL}${pathname}`
    if (canonicalMatches[0][1] !== expectedCanonical) {
      fail(`${relative}: canonical is ${canonicalMatches[0][1]}, expected ${expectedCanonical}`)
    }
    if (noindex) noindexCanonicals.add(expectedCanonical)
    else indexableCanonicals.add(expectedCanonical)
  }

  for (const legacyOrigin of LEGACY_ORIGINS) {
    if (html.includes(legacyOrigin)) fail(`${relative}: still references legacy origin ${legacyOrigin}`)
  }
  if (html.includes('__CANONICAL_ORIGIN__')) {
    fail(`${relative}: unresolved canonical-origin placeholder`)
  }

  const scripts = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi)]
  for (const script of scripts) {
    try {
      JSON.parse(script[1])
      structuredDataBlocks += 1
    } catch {
      fail(`${relative}: invalid JSON-LD`)
    }
  }

  const references = [
    ...html.matchAll(/(?:href|src)="(\/[^"#]*)"/g),
  ].map((match) => match[1])
  for (const reference of references) {
    assertFileForUrl(reference, relative)
    internalReferences += 1
  }

  if (/data-draw-format="(?:point-odds|draw-profile|draw-out|unavailable)"/.test(html)) {
    drawOutlookPages += 1
  }
}

if (drawOutlookPages < 4100) {
  fail(`Expected draw outlooks on at least 4,100 hunt pages; found ${drawOutlookPages}`)
}

const sitemap = fs.readFileSync(path.join(DIST, 'sitemap.xml'), 'utf8')
const sitemapUrlValues = [...sitemap.matchAll(/<loc>(https:\/\/[^<]+)<\/loc>/g)].map(
  (match) => match[1],
)
const sitemapUrls = sitemapUrlValues.length
const sitemapUrlSet = new Set(sitemapUrlValues)
if (sitemapUrls < 4000) fail(`Sitemap contains only ${sitemapUrls} URLs`)
if (sitemapUrlSet.size !== sitemapUrls) fail('sitemap.xml contains duplicate URLs')
if (sitemapUrlValues.some((url) => !url.startsWith(`${SITE_URL}/`))) {
  fail('sitemap.xml contains a non-canonical origin')
}
const sitemapLastModified = [...sitemap.matchAll(/<lastmod>[^<]+<\/lastmod>/g)].length
if (sitemapLastModified < 4000) {
  fail(`sitemap.xml contains only ${sitemapLastModified} meaningful lastmod values`)
}
for (const canonical of indexableCanonicals) {
  if (!sitemapUrlSet.has(canonical)) fail(`${canonical}: indexable page is missing from sitemap.xml`)
}
for (const canonical of noindexCanonicals) {
  if (sitemapUrlSet.has(canonical)) fail(`${canonical}: noindex page appears in sitemap.xml`)
}

const robots = fs.readFileSync(path.join(DIST, 'robots.txt'), 'utf8')
if (!robots.includes(`Sitemap: ${SITE_URL}/sitemap.xml`)) {
  fail('robots.txt does not declare the canonical sitemap URL')
}

const home = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8')
singleMatch(
  home,
  /<meta\s+name="google-site-verification"\s+content="[^"]+"\s*\/?>/gi,
  'Google site verification tag',
  'index.html',
)
if (!home.includes('<h1>Find the hunt. Read the odds. See the terrain.</h1>')) {
  fail('index.html is missing its crawlable home-page headline')
}

const hostingConfig = JSON.parse(fs.readFileSync(path.join(ROOT, 'firebase.json'), 'utf8'))
const hostingEntries = Array.isArray(hostingConfig.hosting)
  ? hostingConfig.hosting
  : [hostingConfig.hosting]
const productionHosting = hostingEntries.find((entry) => entry.target === 'production')
if (!productionHosting) fail('firebase.json is missing the production Hosting target')
if ((productionHosting.rewrites || []).some((rewrite) => rewrite.source === '**')) {
  fail('firebase.json still contains a soft-404 catch-all rewrite')
}

const feed = fs.readFileSync(path.join(DIST, 'feed.xml'), 'utf8')
if (!feed.includes('<item>')) fail('RSS feed has no articles')

const paunsaugunt = fs.readFileSync(
  path.join(DIST, 'hunts', 'utah', 'deer', 'db1001-paunsaugunt', 'index.html'),
  'utf8',
)
if (!paunsaugunt.includes('data-draw-format="point-odds"')) {
  fail('DB1001 profile is missing point-level draw odds')
}
if (!paunsaugunt.includes('21 yrs / 20 pts')) {
  fail('DB1001 profile does not match the hunt-card resident P50 estimate')
}
if (!paunsaugunt.includes('class="static-odds-chart"')) {
  fail('DB1001 profile is missing its point-level odds chart')
}

const henryMountains = fs.readFileSync(
  path.join(DIST, 'hunts', 'utah', 'bison', 'bi6539-henry-mtns', 'index.html'),
  'utf8',
)
if (!henryMountains.includes('data-draw-format="unavailable"')) {
  fail('BI6539 profile should explicitly mark exact-hunt draw history unavailable')
}
if (!henryMountains.includes('<span>Draw history</span><strong>Not available</strong>')) {
  fail('BI6539 snapshot should not display an ambiguous resident-draw dash')
}

console.log(
  `Checked ${htmlFiles.length} HTML pages, ${drawOutlookPages} hunt draw outlooks, ${structuredDataBlocks} JSON-LD blocks, ${internalReferences} internal references, ${sitemapUrls} sitemap URLs and ${sitemapLastModified} lastmod values.`,
)

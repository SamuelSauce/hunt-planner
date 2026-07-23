import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIST = path.join(ROOT, 'dist', 'client')

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
  const parsed = new URL(url, 'https://huntplanner-66d5e.web.app')
  if (parsed.origin !== 'https://huntplanner-66d5e.web.app') return
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

if (!fs.existsSync(DIST)) fail('dist/client/ does not exist; build the site before running seo:check')

const htmlFiles = walk(DIST, '.html')
if (htmlFiles.length < 4000) fail(`Expected at least 4,000 HTML pages; found ${htmlFiles.length}`)

let structuredDataBlocks = 0
let internalReferences = 0
for (const file of htmlFiles) {
  const relative = path.relative(DIST, file)
  const html = fs.readFileSync(file, 'utf8')
  const requiredPatterns = [
    [/<title>[^<]+<\/title>/i, 'title'],
    [/<meta\s+[^>]*name="description"[^>]*content="[^"]+"[^>]*>/i, 'meta description'],
    [/<meta\s+[^>]*name="robots"[^>]*content="[^"]*max-image-preview:large[^"]*"[^>]*>/i, 'large image preview'],
    [/<link\s+[^>]*rel="canonical"[^>]*href="https:\/\/[^"]+"[^>]*>/i, 'canonical URL'],
    [/<meta\s+[^>]*property="og:title"[^>]*content="[^"]+"[^>]*>/i, 'Open Graph title'],
    [/<meta\s+[^>]*property="og:image"[^>]*content="https:\/\/[^"]+"[^>]*>/i, 'Open Graph image'],
    [/<script type="application\/ld\+json">/i, 'JSON-LD'],
  ]
  for (const [pattern, label] of requiredPatterns) {
    if (!pattern.test(html)) fail(`${relative}: missing ${label}`)
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
}

const sitemap = fs.readFileSync(path.join(DIST, 'sitemap.xml'), 'utf8')
const sitemapUrls = [...sitemap.matchAll(/<loc>https:\/\/[^<]+<\/loc>/g)].length
if (sitemapUrls < 4000) fail(`Sitemap contains only ${sitemapUrls} URLs`)

const robots = fs.readFileSync(path.join(DIST, 'robots.txt'), 'utf8')
if (!robots.includes('Sitemap: https://')) fail('robots.txt does not declare an absolute sitemap URL')

const feed = fs.readFileSync(path.join(DIST, 'feed.xml'), 'utf8')
if (!feed.includes('<item>')) fail('RSS feed has no articles')

console.log(
  `Checked ${htmlFiles.length} HTML pages, ${structuredDataBlocks} JSON-LD blocks, ${internalReferences} internal references and ${sitemapUrls} sitemap URLs.`,
)

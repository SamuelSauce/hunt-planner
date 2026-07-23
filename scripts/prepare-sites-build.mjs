import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIST = path.join(ROOT, 'dist')
const CLIENT = path.join(DIST, 'client')
const SERVER = path.join(DIST, 'server')
const HOSTING = path.join(ROOT, '.openai', 'hosting.json')
const WORKER = path.join(ROOT, 'worker', 'index.js')

if (!fs.existsSync(path.join(CLIENT, 'index.html'))) {
  throw new Error('dist/client/index.html is missing; run the production build first')
}
if (!fs.existsSync(HOSTING)) {
  throw new Error('.openai/hosting.json is missing')
}
if (!fs.existsSync(WORKER)) {
  throw new Error('worker/index.js is missing')
}

fs.mkdirSync(SERVER, { recursive: true })
fs.copyFileSync(WORKER, path.join(SERVER, 'index.js'))

console.log('Prepared the validated Sites build with the Community API worker.')

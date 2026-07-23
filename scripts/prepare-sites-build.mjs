import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIST = path.join(ROOT, 'dist')
const CLIENT = path.join(DIST, 'client')
const SERVER = path.join(DIST, 'server')
const HOSTING = path.join(ROOT, '.openai', 'hosting.json')

if (!fs.existsSync(path.join(CLIENT, 'index.html'))) {
  throw new Error('dist/client/index.html is missing; run the production build first')
}
if (!fs.existsSync(HOSTING)) {
  throw new Error('.openai/hosting.json is missing')
}

fs.mkdirSync(SERVER, { recursive: true })
fs.writeFileSync(
  path.join(SERVER, 'index.js'),
  `const INDEXABLE_EXTENSION = /\\.[a-z0-9]+$/i;

async function fetchAsset(request, env, pathname) {
  const url = new URL(request.url);
  url.pathname = pathname;
  return env.ASSETS.fetch(new Request(url, request));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    let response = await env.ASSETS.fetch(request);
    if (response.status !== 404) return response;

    if (!INDEXABLE_EXTENSION.test(url.pathname)) {
      const directoryIndex = \`\${url.pathname.replace(/\\/+$/, '')}/index.html\`;
      response = await fetchAsset(request, env, directoryIndex);
      if (response.status !== 404) return response;
    }

    return fetchAsset(request, env, '/index.html');
  },
};
`,
)

console.log('Prepared the validated static build for owner-only Sites hosting.')

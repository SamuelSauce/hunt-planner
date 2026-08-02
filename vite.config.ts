import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

type SiteConfig = {
  canonicalOrigin: string
}

const siteConfig = JSON.parse(
  fs.readFileSync(fileURLToPath(new URL('./site.config.json', import.meta.url)), 'utf8'),
) as SiteConfig
const canonicalOrigin = siteConfig.canonicalOrigin.replace(/\/+$/, '')

if (!canonicalOrigin.startsWith('https://')) {
  throw new Error('site.config.json canonicalOrigin must be an https:// URL')
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'hunt-planner-site-config',
      transformIndexHtml(html) {
        return html.replaceAll('__CANONICAL_ORIGIN__', canonicalOrigin)
      },
    },
  ],
  base: process.env.VITE_BASE_PATH ?? '/',
  build: {
    outDir: 'dist/client',
  },
})

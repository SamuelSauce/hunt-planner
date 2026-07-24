import { getAnalytics, isSupported, logEvent, type Analytics } from 'firebase/analytics'
import { getFirebaseApp } from './firebase'

type AnalyticsParams = Record<string, string | number | boolean | null | undefined>

const ANALYTICS_PREFERENCE_PARAM = 'analytics'
const ANALYTICS_DISABLED_STORAGE_KEY = 'hunt-planner:analytics-disabled'

let analyticsPromise: Promise<Analytics | null> | null = null

export function initAnalytics() {
  void getAnalyticsInstance()
}

export function trackEvent(name: string, params: AnalyticsParams = {}) {
  if (typeof window === 'undefined') return
  if (!shouldTrackAnalytics()) return
  void getAnalyticsInstance().then((analytics) => {
    if (!analytics) return
    logEvent(analytics, name, compactParams(params))
  })
}

function compactParams(params: AnalyticsParams) {
  return Object.fromEntries(
    Object.entries(params).filter(([, value]) => value !== undefined && value !== null),
  )
}

function getAnalyticsInstance() {
  if (analyticsPromise) return analyticsPromise
  analyticsPromise = resolveAnalytics()
  return analyticsPromise
}

async function resolveAnalytics() {
  if (typeof window === 'undefined') return null
  if (!shouldTrackAnalytics()) return null
  if (!(await isSupported())) return null

  return getAnalytics(getFirebaseApp())
}

function shouldTrackAnalytics() {
  const preference = analyticsPreference()
  if (preference === 'off') {
    setStoredAnalyticsDisabled(true)
    removeAnalyticsPreferenceFromUrl()
    return false
  }
  if (preference === 'on') {
    setStoredAnalyticsDisabled(false)
    removeAnalyticsPreferenceFromUrl()
  }

  if (storedAnalyticsDisabled()) return false
  if (isAutomatedBrowser()) return false

  const hostname = window.location.hostname.toLowerCase()
  return !(
    hostname === 'localhost' ||
    hostname === '0.0.0.0' ||
    hostname === '::1' ||
    hostname.startsWith('127.') ||
    hostname.startsWith('10.') ||
    hostname.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname) ||
    hostname.endsWith('.local')
  )
}

function analyticsPreference() {
  const value = new URLSearchParams(window.location.search)
    .get(ANALYTICS_PREFERENCE_PARAM)
    ?.trim()
    .toLowerCase()
  return value === 'off' || value === '0' || value === 'false'
    ? 'off'
    : value === 'on' || value === '1' || value === 'true'
      ? 'on'
      : null
}

function storedAnalyticsDisabled() {
  try {
    return window.localStorage.getItem(ANALYTICS_DISABLED_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function setStoredAnalyticsDisabled(disabled: boolean) {
  try {
    if (disabled) {
      window.localStorage.setItem(ANALYTICS_DISABLED_STORAGE_KEY, '1')
    } else {
      window.localStorage.removeItem(ANALYTICS_DISABLED_STORAGE_KEY)
    }
  } catch {
    // Storage can be unavailable in privacy-restricted browsing contexts.
  }
}

function removeAnalyticsPreferenceFromUrl() {
  const url = new URL(window.location.href)
  if (!url.searchParams.has(ANALYTICS_PREFERENCE_PARAM)) return
  url.searchParams.delete(ANALYTICS_PREFERENCE_PARAM)
  window.history.replaceState(window.history.state, '', url)
}

function isAutomatedBrowser() {
  if (navigator.webdriver) return true
  return /Codex|HeadlessChrome|PhantomJS|Playwright|Puppeteer/i.test(navigator.userAgent)
}

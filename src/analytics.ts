import { initializeApp } from 'firebase/app'
import { getAnalytics, isSupported, logEvent, type Analytics } from 'firebase/analytics'

const firebaseConfig = {
  apiKey: 'AIzaSyBpuyQXJ6HIthnLBIyT7tDLqiIaVS070gw',
  authDomain: 'huntplanner-66d5e.firebaseapp.com',
  projectId: 'huntplanner-66d5e',
  storageBucket: 'huntplanner-66d5e.firebasestorage.app',
  messagingSenderId: '760945604648',
  appId: '1:760945604648:web:73554ee0708a653bfe1d1d',
  measurementId: 'G-NC83FX30D5',
}

type AnalyticsParams = Record<string, string | number | boolean | null | undefined>

let analyticsPromise: Promise<Analytics | null> | null = null

export function initAnalytics() {
  void getAnalyticsInstance()
}

export function trackPageView(path = currentPath()) {
  if (typeof window === 'undefined') return
  if (!shouldTrackAnalytics()) return
  void getAnalyticsInstance().then((analytics) => {
    if (!analytics) return
    logEvent(analytics, 'page_view', {
      page_title: document.title,
      page_location: window.location.href,
      page_path: path,
    })
  })
}

export function trackEvent(name: string, params: AnalyticsParams = {}) {
  if (typeof window === 'undefined') return
  if (!shouldTrackAnalytics()) return
  void getAnalyticsInstance().then((analytics) => {
    if (!analytics) return
    logEvent(analytics, name, compactParams(params))
  })
}

function currentPath() {
  return `${window.location.pathname}${window.location.search}`
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

  const app = initializeApp(firebaseConfig)
  return getAnalytics(app)
}

function shouldTrackAnalytics() {
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

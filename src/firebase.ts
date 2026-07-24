import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app'
import {
  getAuth,
  getRedirectResult,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  type Auth,
} from 'firebase/auth'

const firebaseConfig = {
  apiKey: 'AIzaSyBpuyQXJ6HIthnLBIyT7tDLqiIaVS070gw',
  authDomain: 'huntplanner-66d5e.web.app',
  projectId: 'huntplanner-66d5e',
  storageBucket: 'huntplanner-66d5e.firebasestorage.app',
  messagingSenderId: '760945604648',
  appId: '1:760945604648:web:73554ee0708a653bfe1d1d',
  measurementId: 'G-NC83FX30D5',
}

let firebaseApp: FirebaseApp | null = null
let firebaseAuth: Auth | null = null

export function getFirebaseApp() {
  if (firebaseApp) return firebaseApp
  firebaseApp = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig)
  return firebaseApp
}

export function subscribeToFirebaseAuth(
  onChange: (signedIn: boolean) => void,
  onError: (error: unknown) => void,
) {
  const auth = getFirebaseAuth()
  void getRedirectResult(auth).catch(onError)
  return onAuthStateChanged(
    auth,
    (user) => onChange(Boolean(user)),
    onError,
  )
}

export async function signInWithGoogle() {
  const auth = getFirebaseAuth()
  const provider = new GoogleAuthProvider()
  provider.setCustomParameters({ prompt: 'select_account' })

  if (preferRedirectSignIn()) {
    await signInWithRedirect(auth, provider)
    return
  }

  try {
    await signInWithPopup(auth, provider)
  } catch (error) {
    if (shouldFallBackToRedirect(error)) {
      await signInWithRedirect(auth, provider)
      return
    }
    throw error
  }
}

export async function signOutOfFirebase() {
  await signOut(getFirebaseAuth())
}

export async function getFirebaseIdToken(forceRefresh = false) {
  const user = getFirebaseAuth().currentUser
  return user ? user.getIdToken(forceRefresh) : null
}

export function firebaseAuthErrorMessage(error: unknown) {
  const code = firebaseErrorCode(error)
  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
    return 'Google sign-in was closed before it finished.'
  }
  if (code === 'auth/unauthorized-domain') {
    return 'Google sign-in is not enabled for this website yet.'
  }
  if (code === 'auth/network-request-failed') {
    return 'Google sign-in could not connect. Check your connection and try again.'
  }
  if (code === 'auth/account-exists-with-different-credential') {
    return 'An account already exists for this email with a different sign-in method.'
  }
  return 'Google sign-in could not be completed. Please try again.'
}

function getFirebaseAuth() {
  if (firebaseAuth) return firebaseAuth
  firebaseAuth = getAuth(getFirebaseApp())
  return firebaseAuth
}

function preferRedirectSignIn() {
  if (typeof window === 'undefined') return false
  const mobileUserAgent = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
  const compactTouchScreen =
    window.matchMedia('(max-width: 840px)').matches &&
    window.matchMedia('(pointer: coarse)').matches
  return mobileUserAgent || compactTouchScreen
}

function shouldFallBackToRedirect(error: unknown) {
  const code = firebaseErrorCode(error)
  return (
    code === 'auth/popup-blocked' ||
    code === 'auth/operation-not-supported-in-this-environment'
  )
}

function firebaseErrorCode(error: unknown) {
  if (!error || typeof error !== 'object' || !('code' in error)) return ''
  return typeof error.code === 'string' ? error.code : ''
}

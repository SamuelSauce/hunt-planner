import { useEffect, useState } from 'react'
import type { User } from 'firebase/auth'
import {
  Check,
  Cloud,
  Layers3,
  LogIn,
  LogOut,
  MapPinned,
  ShieldCheck,
  UserRound,
} from 'lucide-react'
import {
  firebaseAuthErrorMessage,
  signInWithGoogle,
  signOutOfFirebase,
  subscribeToFirebaseUser,
} from './firebase'

export function ProfilePage({
  plannerHref,
  mapHref,
  onPlannerClick,
  onMapClick,
}: {
  plannerHref: string
  mapHref: string
  onPlannerClick: (event: React.MouseEvent<HTMLAnchorElement>) => void
  onMapClick: (event: React.MouseEvent<HTMLAnchorElement>) => void
}) {
  const [user, setUser] = useState<User | null>(null)
  const [status, setStatus] = useState<'loading' | 'signed-in' | 'signed-out'>('loading')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => subscribeToFirebaseUser(
    (nextUser) => {
      setUser(nextUser)
      setStatus(nextUser ? 'signed-in' : 'signed-out')
      setBusy(false)
      if (nextUser) setMessage('')
    },
    (error) => {
      setStatus('signed-out')
      setBusy(false)
      setMessage(firebaseAuthErrorMessage(error))
    },
  ), [])

  const signIn = () => {
    setBusy(true)
    setMessage('')
    void signInWithGoogle()
      .catch((error) => {
        setBusy(false)
        setMessage(firebaseAuthErrorMessage(error))
      })
  }

  const signOut = () => {
    setBusy(true)
    setMessage('')
    void signOutOfFirebase()
      .then(() => setBusy(false))
      .catch(() => {
        setBusy(false)
        setMessage('Sign out could not be completed. Please try again.')
      })
  }

  const displayName = user?.displayName?.trim() || 'Your Hunt Planner account'
  const initials = displayName
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || 'HP'

  return (
    <main className="profile-page">
      <section className="profile-hero">
        <div className="profile-identity">
          <div className="profile-avatar">
            {user?.photoURL ? (
              <img src={user.photoURL} alt="" referrerPolicy="no-referrer" />
            ) : status === 'loading' ? (
              <span className="profile-avatar-loading" aria-hidden="true" />
            ) : (
              <span>{status === 'signed-in' ? initials : <UserRound size={32} aria-hidden="true" />}</span>
            )}
          </div>
          <div>
            <p className="eyebrow">{status === 'signed-in' ? 'Signed in' : 'Your account'}</p>
            <h2>{status === 'signed-in' ? displayName : 'Keep your scouting work with you'}</h2>
            <p>
              {status === 'signed-in'
                ? user?.email || 'Your private Hunt Planner workspace is connected.'
                : 'Sign in once to sync map layers and saved scouting pins across devices.'}
            </p>
          </div>
        </div>
        {status === 'signed-in' ? (
          <button className="profile-auth-button secondary" type="button" onClick={signOut} disabled={busy}>
            <LogOut size={18} aria-hidden="true" />
            {busy ? 'Signing out…' : 'Sign out'}
          </button>
        ) : (
          <button
            className="profile-auth-button"
            type="button"
            onClick={signIn}
            disabled={busy || status === 'loading'}
          >
            <LogIn size={18} aria-hidden="true" />
            {status === 'loading' ? 'Checking account…' : busy ? 'Opening Google…' : 'Continue with Google'}
          </button>
        )}
      </section>

      {message && <p className="profile-message" role="alert">{message}</p>}

      <section className="profile-grid">
        <article className="profile-feature-card">
          <span className="profile-feature-icon"><Layers3 size={22} aria-hidden="true" /></span>
          <div>
            <h3>Scout layers</h3>
            <p>Open every saved layer together, even when you are not researching a specific hunt.</p>
          </div>
          <a className="profile-card-link" href={mapHref} onClick={onMapClick}>
            <MapPinned size={17} aria-hidden="true" />
            Open 3D map
          </a>
        </article>

        <article className="profile-feature-card">
          <span className="profile-feature-icon"><Cloud size={22} aria-hidden="true" /></span>
          <div>
            <h3>{status === 'signed-in' ? 'Sync is ready' : 'Private cloud sync'}</h3>
            <p>
              {status === 'signed-in'
                ? 'Pins and custom layers you save are available anywhere you sign in.'
                : 'Guest pins stay on this device. Sign in to carry them into your private library.'}
            </p>
          </div>
          <span className={`profile-status ${status === 'signed-in' ? 'ready' : ''}`}>
            {status === 'signed-in' ? <Check size={15} aria-hidden="true" /> : <ShieldCheck size={15} aria-hidden="true" />}
            {status === 'signed-in' ? 'Connected' : 'Private by default'}
          </span>
        </article>

        <article className="profile-feature-card">
          <span className="profile-feature-icon"><MapPinned size={22} aria-hidden="true" /></span>
          <div>
            <h3>Continue planning</h3>
            <p>Compare hunt boundaries, draw history, harvest results, and season details.</p>
          </div>
          <a className="profile-card-link quiet" href={plannerHref} onClick={onPlannerClick}>
            Back to planner
          </a>
        </article>
      </section>
    </main>
  )
}

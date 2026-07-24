import { useMemo, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import {
  Check,
  Copy,
  ExternalLink,
  Link2,
  LogIn,
  MapPinned,
  Share2,
  X,
} from 'lucide-react'
import { createScoutShare } from './api'
import type { ScoutWorkspace } from './model'

type AuthStatus = 'loading' | 'signed-in' | 'signed-out'

export function ScoutShareModal({
  open,
  workspace,
  authStatus,
  onClose,
  onSignIn,
}: {
  open: boolean
  workspace: ScoutWorkspace
  authStatus: AuthStatus
  onClose: () => void
  onSignIn: () => void
}) {
  const layersWithPins = new Set(workspace.pins.map((pin) => pin.layerId))
  const defaultVisibleLayerIds = workspace.layers
    .filter((layer) => layer.visible && layersWithPins.has(layer.id))
    .map((layer) => layer.id)
  const firstPopulatedLayer = workspace.layers.find((layer) => layersWithPins.has(layer.id))
  const [title, setTitle] = useState(`${workspace.name} scout map`)
  const [selectedLayerIds, setSelectedLayerIds] = useState<string[]>(
    defaultVisibleLayerIds.length > 0
      ? defaultVisibleLayerIds
      : firstPopulatedLayer
        ? [firstPopulatedLayer.id]
        : [],
  )
  const [includeNotes, setIncludeNotes] = useState(false)
  const [status, setStatus] = useState<'idle' | 'publishing' | 'ready' | 'error'>('idle')
  const [shareUrl, setShareUrl] = useState('')
  const [message, setMessage] = useState('')

  const selectedPinCount = useMemo(() => {
    const selected = new Set(selectedLayerIds)
    return workspace.pins.filter((pin) => selected.has(pin.layerId)).length
  }, [selectedLayerIds, workspace.pins])

  if (!open || typeof document === 'undefined') return null

  const toggleLayer = (layerId: string) => {
    setSelectedLayerIds((current) => (
      current.includes(layerId)
        ? current.filter((candidate) => candidate !== layerId)
        : [...current, layerId]
    ))
    setStatus('idle')
    setShareUrl('')
    setMessage('')
  }

  const publish = async () => {
    if (
      authStatus !== 'signed-in' ||
      status === 'publishing' ||
      !title.trim() ||
      selectedPinCount === 0
    ) return

    setStatus('publishing')
    setMessage('')
    try {
      const share = await createScoutShare(workspace, {
        title,
        layerIds: selectedLayerIds,
        includeNotes,
      })
      const nextUrl = new URL(`/scout-map/${share.id}`, window.location.origin).href
      setShareUrl(nextUrl)
      setStatus('ready')
      setMessage(`${share.layerCount} layer${share.layerCount === 1 ? '' : 's'} · ${share.pinCount} pin${share.pinCount === 1 ? '' : 's'}`)
    } catch (error) {
      setStatus('error')
      setMessage(error instanceof Error ? error.message : 'The shared map could not be created.')
    }
  }

  const copyLink = async () => {
    if (!shareUrl) return
    try {
      await navigator.clipboard.writeText(shareUrl)
      setMessage('Link copied. Anyone with it can view this map.')
    } catch {
      setMessage('Copy failed. Select the link and copy it manually.')
    }
  }

  return createPortal(
    <div
      className="scout-share-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section
        className="scout-share-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="scout-share-title"
        aria-describedby="scout-share-description"
      >
        <div className="scout-share-heading">
          <span>
            <Share2 size={18} aria-hidden="true" />
            <strong id="scout-share-title">Share scout layers</strong>
          </span>
          <button type="button" onClick={onClose} aria-label="Close layer sharing">
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <p id="scout-share-description">
          Create a read-only snapshot that anyone with the link can open—no account required.
        </p>

        <div className="scout-share-warning">
          <MapPinned size={17} aria-hidden="true" />
          <span>
            <strong>Exact locations become visible</strong>
            <small>The link is unlisted, but anyone it reaches can see every selected pin.</small>
          </span>
        </div>

        <label className="scout-share-title-field">
          Map name
          <input
            autoFocus
            value={title}
            maxLength={100}
            onChange={(event) => {
              setTitle(event.target.value)
              setStatus('idle')
              setShareUrl('')
            }}
          />
        </label>

        <fieldset className="scout-share-layers">
          <legend>Layers to include</legend>
          {workspace.layers
            .slice()
            .sort((a, b) => a.sortOrder - b.sortOrder)
            .map((layer) => {
              const pinCount = workspace.pins.filter((pin) => pin.layerId === layer.id).length
              const checked = selectedLayerIds.includes(layer.id)
              return (
                <label key={layer.id}>
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={pinCount === 0}
                    onChange={() => toggleLayer(layer.id)}
                  />
                  <i
                    className="scout-share-check"
                    style={{ '--scout-color': layer.color } as CSSProperties}
                    aria-hidden="true"
                  >
                    {checked && <Check size={13} />}
                  </i>
                  <span>
                    <strong>{layer.name}</strong>
                    <small>{pinCount} pin{pinCount === 1 ? '' : 's'}</small>
                  </span>
                </label>
              )
            })}
        </fieldset>

        <label className="scout-share-notes">
          <input
            type="checkbox"
            checked={includeNotes}
            onChange={(event) => {
              setIncludeNotes(event.target.checked)
              setStatus('idle')
              setShareUrl('')
            }}
          />
          <span>
            <strong>Include pin notes</strong>
            <small>Off by default so private access and field details stay private.</small>
          </span>
        </label>

        {authStatus !== 'signed-in' ? (
          <div className="scout-share-signin">
            <div>
              <strong>Sign in to publish</strong>
              <small>Only the publisher needs an account. Viewers never do.</small>
            </div>
            <button type="button" onClick={onSignIn} disabled={authStatus === 'loading'}>
              <LogIn size={15} aria-hidden="true" />
              {authStatus === 'loading' ? 'Checking…' : 'Sign in'}
            </button>
          </div>
        ) : shareUrl ? (
          <div className="scout-share-result" aria-live="polite">
            <label>
              Unlisted map link
              <input value={shareUrl} readOnly onFocus={(event) => event.currentTarget.select()} />
            </label>
            <div>
              <button type="button" onClick={copyLink}>
                <Copy size={15} aria-hidden="true" /> Copy link
              </button>
              <a href={shareUrl} target="_blank" rel="noreferrer">
                <ExternalLink size={15} aria-hidden="true" /> Open map
              </a>
            </div>
          </div>
        ) : (
          <button
            className="scout-share-publish"
            type="button"
            disabled={
              status === 'publishing' ||
              !title.trim() ||
              selectedPinCount === 0
            }
            onClick={publish}
          >
            <Link2 size={16} aria-hidden="true" />
            {status === 'publishing'
              ? 'Creating link…'
              : `Create link for ${selectedPinCount} pin${selectedPinCount === 1 ? '' : 's'}`}
          </button>
        )}

        {message && (
          <p className={`scout-share-message ${status === 'error' ? 'error' : ''}`} role="status">
            {message}
          </p>
        )}
      </section>
    </div>,
    document.body,
  )
}

import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import {
  Check,
  Cloud,
  CloudOff,
  Filter,
  Layers3,
  LogIn,
  LogOut,
  MapPin,
  Plus,
  Save,
  Share2,
  Trash2,
  X,
} from 'lucide-react'
import type { MapPinLocation } from '../mapPin'
import {
  GUEST_PIN_LIMIT,
  SCOUT_LAYER_COLORS,
  SCOUT_PIN_TYPES,
  type ScoutFilters,
  type ScoutPin,
  type ScoutPinDraft,
  type ScoutPinStatus,
  type ScoutPinType,
  type ScoutWaterSeasonality,
  type ScoutWorkspace,
} from './model'

type AuthStatus = 'loading' | 'signed-in' | 'signed-out'
export type ScoutPersistenceStatus = 'loading' | 'saved' | 'saving' | 'local' | 'error'

export function ScoutingPanel({
  workspace,
  filters,
  authStatus,
  persistenceStatus,
  draftLocation,
  selectedPin,
  species,
  onFiltersChange,
  onAddLayer,
  onRenameLayer,
  onToggleLayer,
  onDeleteLayer,
  onSavePin,
  onDeletePin,
  onCloseEditor,
  onSharePin,
  onSignIn,
  onSignOut,
}: {
  workspace: ScoutWorkspace
  filters: ScoutFilters
  authStatus: AuthStatus
  persistenceStatus: ScoutPersistenceStatus
  draftLocation: MapPinLocation | null
  selectedPin: ScoutPin | null
  species: string
  onFiltersChange: (filters: ScoutFilters) => void
  onAddLayer: () => void
  onRenameLayer: (layerId: string, name: string) => void
  onToggleLayer: (layerId: string) => void
  onDeleteLayer: (layerId: string) => void
  onSavePin: (draft: ScoutPinDraft, existingId: string | null) => void
  onDeletePin: (pinId: string) => void
  onCloseEditor: () => void
  onSharePin: (location: MapPinLocation) => void
  onSignIn: () => void
  onSignOut: () => void
}) {
  const isSignedIn = authStatus === 'signed-in'
  const editingLocation = selectedPin?.location ?? draftLocation
  const [title, setTitle] = useState('')
  const [type, setType] = useState<ScoutPinType>('check')
  const [status, setStatus] = useState<ScoutPinStatus>('e-scout')
  const [layerId, setLayerId] = useState(workspace.layers[0]?.id ?? '')
  const [year, setYear] = useState(new Date().getFullYear())
  const [notes, setNotes] = useState('')
  const [waterSeasonality, setWaterSeasonality] =
    useState<ScoutWaterSeasonality>('unknown')
  const [colorOverride, setColorOverride] = useState<string | null>(null)
  const defaultLayerId = workspace.layers[0]?.id ?? ''

  useEffect(() => {
    if (!editingLocation) return
    const frame = window.requestAnimationFrame(() => {
      setTitle(selectedPin?.title ?? '')
      setType(selectedPin?.type ?? 'check')
      setStatus(selectedPin?.status ?? 'e-scout')
      setLayerId(selectedPin?.layerId ?? defaultLayerId)
      setYear(selectedPin?.observationYear ?? new Date().getFullYear())
      setNotes(selectedPin?.notes ?? '')
      setWaterSeasonality(selectedPin?.waterSeasonality ?? 'unknown')
      setColorOverride(selectedPin?.colorOverride ?? null)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [defaultLayerId, editingLocation, selectedPin])

  const availableYears = useMemo(() => {
    const years = new Set(workspace.pins.map((pin) => pin.observationYear))
    years.add(new Date().getFullYear())
    return [...years].sort((a, b) => b - a)
  }, [workspace.pins])

  const guestLimitReached = !isSignedIn && workspace.pins.length >= GUEST_PIN_LIMIT

  const submitPin = () => {
    if (!editingLocation || !layerId || (guestLimitReached && !selectedPin)) return
    onSavePin(
      {
        location: editingLocation,
        title,
        type,
        status,
        species,
        observationYear: year,
        notes,
        waterSeasonality: type === 'water' ? waterSeasonality : 'unknown',
        colorOverride,
        layerId,
      },
      selectedPin?.id ?? null,
    )
  }

  return (
    <section className="scout-panel" aria-label="Scout layers">
      <div className="scout-panel-heading">
        <span>
          <Layers3 size={17} aria-hidden="true" />
          <strong>Scout layers</strong>
        </span>
        <ScoutSaveState
          authStatus={authStatus}
          persistenceStatus={persistenceStatus}
        />
      </div>

      <div className="scout-auth-row">
        <div>
          <strong>{isSignedIn ? 'Private workspace' : 'Guest scratch layer'}</strong>
          <small>
            {isSignedIn
              ? 'Saved and synced across your devices'
              : `Saved on this device · ${workspace.pins.length}/${GUEST_PIN_LIMIT} pins`}
          </small>
        </div>
        {isSignedIn ? (
          <button type="button" className="scout-text-button" onClick={onSignOut}>
            <LogOut size={14} aria-hidden="true" />
            Sign out
          </button>
        ) : (
          <button
            type="button"
            className="scout-sign-in"
            onClick={onSignIn}
            disabled={authStatus === 'loading'}
          >
            <LogIn size={14} aria-hidden="true" />
            {authStatus === 'loading' ? 'Checking…' : 'Sign in to sync'}
          </button>
        )}
      </div>

      <div className="scout-filters">
        <span><Filter size={14} aria-hidden="true" /> Show</span>
        <select
          aria-label="Filter scout pins by status"
          value={filters.status}
          onChange={(event) => onFiltersChange({
            ...filters,
            status: event.target.value as ScoutFilters['status'],
          })}
        >
          <option value="all">All notes</option>
          <option value="e-scout">E-scouted</option>
          <option value="field">Field confirmed</option>
        </select>
        <select
          aria-label="Filter scout pins by observation year"
          value={filters.observationYear}
          onChange={(event) => onFiltersChange({
            ...filters,
            observationYear:
              event.target.value === 'all' ? 'all' : Number(event.target.value),
          })}
        >
          <option value="all">All years</option>
          {availableYears.map((candidate) => (
            <option key={candidate} value={candidate}>{candidate}</option>
          ))}
        </select>
      </div>

      <div className="scout-layer-list">
        {workspace.layers
          .slice()
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((layer) => {
            const count = workspace.pins.filter((pin) => pin.layerId === layer.id).length
            return (
              <div className="scout-layer-row" key={layer.id}>
                <button
                  type="button"
                  className="scout-layer-visibility"
                  aria-label={`${layer.visible ? 'Hide' : 'Show'} ${layer.name}`}
                  aria-pressed={layer.visible}
                  onClick={() => onToggleLayer(layer.id)}
                  style={{ '--scout-color': layer.color } as CSSProperties}
                >
                  {layer.visible && <Check size={13} aria-hidden="true" />}
                </button>
                <input
                  aria-label="Layer name"
                  value={layer.name}
                  maxLength={48}
                  readOnly={!isSignedIn}
                  onChange={(event) => onRenameLayer(layer.id, event.target.value)}
                />
                <small>{count}</small>
                {isSignedIn && workspace.layers.length > 1 && (
                  <button
                    className="scout-delete-layer"
                    type="button"
                    disabled={count > 0}
                    title={count > 0 ? 'Move or delete this layer’s pins first' : 'Delete layer'}
                    aria-label={`Delete ${layer.name}`}
                    onClick={() => onDeleteLayer(layer.id)}
                  >
                    <Trash2 size={13} aria-hidden="true" />
                  </button>
                )}
              </div>
            )
          })}
        <button
          className="scout-add-layer"
          type="button"
          onClick={onAddLayer}
          disabled={!isSignedIn}
          title={isSignedIn ? 'Add a custom layer' : 'Sign in to create more layers'}
        >
          <Plus size={14} aria-hidden="true" />
          {isSignedIn ? 'Add layer' : 'Sign in for custom layers'}
        </button>
      </div>

      {editingLocation ? (
        <div className="scout-pin-editor">
          <div className="scout-pin-editor-title">
            <span><MapPin size={15} aria-hidden="true" /> {selectedPin ? 'Edit pin' : 'New pin'}</span>
            <button type="button" onClick={onCloseEditor} aria-label="Close pin editor">
              <X size={14} aria-hidden="true" />
            </button>
          </div>
          <input
            aria-label="Pin title"
            placeholder="Name this spot"
            maxLength={80}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
          <div className="scout-form-grid">
            <label>
              Type
              <select value={type} onChange={(event) => setType(event.target.value as ScoutPinType)}>
                {SCOUT_PIN_TYPES.map((pinType) => (
                  <option key={pinType.value} value={pinType.value}>{pinType.label}</option>
                ))}
              </select>
            </label>
            <label>
              Status
              <select value={status} onChange={(event) => setStatus(event.target.value as ScoutPinStatus)}>
                <option value="e-scout">E-scouted</option>
                <option value="field">Field confirmed</option>
              </select>
            </label>
            <label>
              Layer
              <select value={layerId} onChange={(event) => setLayerId(event.target.value)}>
                {workspace.layers.map((layer) => (
                  <option key={layer.id} value={layer.id}>{layer.name}</option>
                ))}
              </select>
            </label>
            <label>
              Year
              <input
                type="number"
                min="2000"
                max={new Date().getFullYear() + 1}
                value={year}
                onChange={(event) => setYear(Number(event.target.value))}
              />
            </label>
          </div>
          {type === 'water' && (
            <label className="scout-water-field">
              Water
              <select
                value={waterSeasonality}
                onChange={(event) => setWaterSeasonality(event.target.value as ScoutWaterSeasonality)}
              >
                <option value="unknown">Seasonality unknown</option>
                <option value="perennial">Perennial</option>
                <option value="seasonal">Seasonal</option>
                <option value="dry">Dry when checked</option>
              </select>
            </label>
          )}
          <label className="scout-notes-field">
            Notes
            <textarea
              rows={2}
              maxLength={2_000}
              placeholder="Access, wind, sign, or what to verify in the field"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </label>
          <div className="scout-colors" aria-label="Pin color">
            <button
              type="button"
              className={colorOverride === null ? 'active semantic' : 'semantic'}
              aria-pressed={colorOverride === null}
              onClick={() => setColorOverride(null)}
            >
              Auto
            </button>
            {SCOUT_LAYER_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                className={colorOverride === color ? 'active' : ''}
                aria-label={`Use ${color} pin color`}
                aria-pressed={colorOverride === color}
                style={{ '--scout-color': color } as CSSProperties}
                onClick={() => setColorOverride(color)}
              />
            ))}
          </div>
          {guestLimitReached && !selectedPin && (
            <p className="scout-limit-note">
              Your scratch layer is full. Sign in to keep this pin and add more.
            </p>
          )}
          <div className="scout-editor-actions">
            {selectedPin && (
              <>
                <button type="button" onClick={() => onSharePin(selectedPin.location)}>
                  <Share2 size={14} aria-hidden="true" /> Share
                </button>
                <button
                  type="button"
                  className="danger"
                  onClick={() => onDeletePin(selectedPin.id)}
                >
                  <Trash2 size={14} aria-hidden="true" /> Delete
                </button>
              </>
            )}
            <button
              type="button"
              className="primary"
              disabled={!layerId || (guestLimitReached && !selectedPin)}
              onClick={submitPin}
            >
              <Save size={14} aria-hidden="true" />
              {selectedPin ? 'Update' : 'Save pin'}
            </button>
          </div>
        </div>
      ) : (
        <div className="scout-drop-hint">
          <MapPin size={16} aria-hidden="true" />
          <span><strong>Press and hold to add a pin</strong><small>Then classify it here</small></span>
        </div>
      )}
    </section>
  )
}

function ScoutSaveState({
  authStatus,
  persistenceStatus,
}: {
  authStatus: AuthStatus
  persistenceStatus: ScoutPersistenceStatus
}) {
  if (persistenceStatus === 'error') {
    return <small className="scout-save-state error"><CloudOff size={13} /> Sync paused</small>
  }
  if (authStatus !== 'signed-in') {
    return <small className="scout-save-state"><CloudOff size={13} /> This device</small>
  }
  return (
    <small className="scout-save-state">
      <Cloud size={13} />
      {persistenceStatus === 'saving' || persistenceStatus === 'loading' ? 'Syncing…' : 'Synced'}
    </small>
  )
}

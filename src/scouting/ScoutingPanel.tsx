import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import {
  Check,
  ChevronDown,
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
  SCOUT_LAYER_NAME_LIMIT,
  SCOUT_PIN_TYPES,
  sameScoutHunt,
  type ScoutFilters,
  type ScoutHuntContext,
  type ScoutLayer,
  type ScoutLibrary,
  type ScoutPin,
  type ScoutPinDraft,
  type ScoutPinStatus,
  type ScoutPinType,
  type ScoutWaterSeasonality,
} from './model'

type AuthStatus = 'loading' | 'signed-in' | 'signed-out'
export type ScoutPersistenceStatus = 'loading' | 'saved' | 'saving' | 'local' | 'error'

export function ScoutingPanel({
  workspace,
  activeHunt,
  filters,
  authStatus,
  persistenceStatus,
  editorOpen,
  draftLocation,
  selectedPin,
  species,
  globalMode = false,
  onFiltersChange,
  onAddLayer,
  onRenameLayer,
  onToggleLayer,
  onDeleteLayer,
  onSavePin,
  onDeletePin,
  onOpenEditor,
  onCloseEditor,
  onShareLayers,
  onSharePin,
  onSignIn,
  onSignOut,
}: {
  workspace: ScoutLibrary
  activeHunt: ScoutHuntContext
  filters: ScoutFilters
  authStatus: AuthStatus
  persistenceStatus: ScoutPersistenceStatus
  editorOpen: boolean
  draftLocation: MapPinLocation | null
  selectedPin: ScoutPin | null
  species: string
  globalMode?: boolean
  onFiltersChange: (filters: ScoutFilters) => void
  onAddLayer: () => void
  onRenameLayer: (layerId: string, name: string) => void
  onToggleLayer: (layerId: string) => void
  onDeleteLayer: (layerId: string) => void
  onSavePin: (draft: ScoutPinDraft, existingId: string | null) => void
  onDeletePin: (pinId: string) => void
  onOpenEditor: () => void
  onCloseEditor: () => void
  onShareLayers: () => void
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
  const [otherLayerQuery, setOtherLayerQuery] = useState('')
  const currentHuntLayers = useMemo(
    () => workspace.layers
      .filter((layer) => globalMode || sameScoutHunt(layer.hunt, activeHunt))
      .sort((a, b) => a.sortOrder - b.sortOrder),
    [activeHunt, globalMode, workspace.layers],
  )
  const otherHuntLayers = useMemo(
    () => globalMode ? [] : workspace.layers
      .filter((layer) => !sameScoutHunt(layer.hunt, activeHunt))
      .sort((a, b) => (
        a.hunt.huntNumber.localeCompare(b.hunt.huntNumber) ||
        a.sortOrder - b.sortOrder
      )),
    [activeHunt, globalMode, workspace.layers],
  )
  const filteredOtherHuntLayers = useMemo(() => {
    const query = otherLayerQuery.trim().toLowerCase()
    if (!query) return otherHuntLayers
    return otherHuntLayers.filter((layer) => (
      layer.name.toLowerCase().includes(query) ||
      layer.hunt.huntNumber.toLowerCase().includes(query) ||
      layer.hunt.huntName.toLowerCase().includes(query)
    ))
  }, [otherHuntLayers, otherLayerQuery])
  const defaultLayerId = currentHuntLayers
    .find(
      (layer) => layer.kind === 'hunt-default' && sameScoutHunt(layer.hunt, activeHunt),
    )?.id ??
    currentHuntLayers[0]?.id ??
    workspace.layers[0]?.id ??
    ''

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
  const visibleLayerIds = useMemo(
    () => new Set(workspace.layers.filter((layer) => layer.visible).map((layer) => layer.id)),
    [workspace.layers],
  )
  const visiblePinCount = workspace.pins
    .filter((pin) => visibleLayerIds.has(pin.layerId))
    .length

  const layerRow = (layer: ScoutLayer) => {
    const count = workspace.pins.filter((pin) => pin.layerId === layer.id).length
    const canDelete = isSignedIn && layer.kind === 'custom'
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
          title={layer.name}
          value={layer.name}
          maxLength={SCOUT_LAYER_NAME_LIMIT}
          readOnly={!isSignedIn}
          onChange={(event) => onRenameLayer(layer.id, event.target.value)}
        />
        <small aria-label={`${count} pins`}>{count}</small>
        {canDelete ? (
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
        ) : <span className="scout-layer-row-spacer" />}
      </div>
    )
  }

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
    <>
      <section className="scout-panel" aria-label="Scout layers">
        <div className="scout-panel-heading">
          <span>
            <Layers3 size={17} aria-hidden="true" />
            <strong>Global scout layers</strong>
          </span>
          <div className="scout-panel-heading-actions">
            <ScoutSaveState
              authStatus={authStatus}
              persistenceStatus={persistenceStatus}
            />
            <button
              className="scout-share-layers-button"
              type="button"
              onClick={onShareLayers}
              disabled={visiblePinCount === 0}
              title={visiblePinCount === 0 ? 'Turn on a layer with pins to share it' : 'Share visible layers'}
            >
              <Share2 size={13} aria-hidden="true" />
              Share
            </button>
          </div>
        </div>

        <div className="scout-auth-row">
          <div>
            <strong>{isSignedIn ? 'Private layer library' : 'Guest layer library'}</strong>
            <small>
              {isSignedIn
                ? `${workspace.layers.length} layer${workspace.layers.length === 1 ? '' : 's'} · synced across devices`
                : workspace.pins.length >= GUEST_PIN_LIMIT
                  ? `${workspace.pins.length} saved pins · sign in to add more`
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

      <div className="scout-layer-library">
        <section
          className="scout-layer-group"
          aria-label={globalMode ? 'All scout layers' : `Layers for ${activeHunt.huntNumber}`}
        >
          <div className="scout-layer-group-heading">
            <span>{globalMode ? 'All layers' : 'Current layers'}</span>
            <small>{globalMode ? currentHuntLayers.length : activeHunt.huntNumber}</small>
          </div>
          <div className="scout-layer-list">
            {currentHuntLayers.map(layerRow)}
          </div>
          <button
            className="scout-add-layer"
            type="button"
            onClick={onAddLayer}
            disabled={!isSignedIn}
            title={isSignedIn ? 'Create a new layer' : 'Sign in to create more layers'}
          >
            <Plus size={14} aria-hidden="true" />
            {isSignedIn ? 'New layer' : 'Sign in for custom layers'}
          </button>
        </section>

        {otherHuntLayers.length > 0 && (
          <details className="scout-other-layers">
            <summary>
              <span>Other layers</span>
              <small>{otherHuntLayers.length} layer{otherHuntLayers.length === 1 ? '' : 's'}</small>
              <ChevronDown size={14} aria-hidden="true" />
            </summary>
            {otherHuntLayers.length > 5 && (
              <input
                className="scout-layer-search"
                type="search"
                value={otherLayerQuery}
                aria-label="Search other layers"
                placeholder="Search hunt or layer"
                onChange={(event) => setOtherLayerQuery(event.target.value)}
              />
            )}
            <div className="scout-layer-list scout-layer-list-global">
              {filteredOtherHuntLayers.map(layerRow)}
              {filteredOtherHuntLayers.length === 0 && (
                <small className="scout-layer-empty">No matching layers.</small>
              )}
            </div>
          </details>
        )}
      </div>

        {editingLocation ? (
          <button className="scout-edit-hint" type="button" onClick={onOpenEditor}>
            <MapPin size={16} aria-hidden="true" />
            <span>
              <strong>{selectedPin ? selectedPin.title || 'Selected pin' : 'Dropped pin ready'}</strong>
              <small>{selectedPin ? 'Open pin details' : 'Use Save this pin on the map marker'}</small>
            </span>
          </button>
        ) : (
          <div className="scout-drop-hint">
            <MapPin size={16} aria-hidden="true" />
            <span><strong>Press and hold to add a pin</strong><small>Save it from the map marker</small></span>
          </div>
        )}
      </section>

      {editorOpen && editingLocation && typeof document !== 'undefined' && createPortal(
        <div
          className="scout-pin-modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) onCloseEditor()
          }}
        >
          <section
            className="scout-pin-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="scout-pin-dialog-title"
            aria-describedby="scout-pin-dialog-description"
          >
            <div className="scout-pin-editor-title">
              <span id="scout-pin-dialog-title">
                <MapPin size={17} aria-hidden="true" />
                {selectedPin ? 'Edit scout pin' : 'Save scout pin'}
              </span>
              <button type="button" onClick={onCloseEditor} aria-label="Close pin editor">
                <X size={17} aria-hidden="true" />
              </button>
            </div>
            <p id="scout-pin-dialog-description" className="scout-pin-modal-intro">
              {selectedPin
                ? 'Update the field note, classification, or layer for this location.'
                : 'Classify this location now so it is easy to find and filter later.'}
            </p>
            <small className="scout-pin-coordinates">
              {editingLocation.latitude.toFixed(5)}, {editingLocation.longitude.toFixed(5)}
            </small>
            <strong className="scout-pin-section-title">Pin details</strong>
            <input
              autoFocus
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
                  <optgroup label={globalMode ? 'All layers' : `Current layers · ${activeHunt.huntNumber}`}>
                    {currentHuntLayers.map((layer) => (
                      <option key={layer.id} value={layer.id}>{layer.name}</option>
                    ))}
                  </optgroup>
                  {otherHuntLayers.length > 0 && (
                    <optgroup label="Other layers">
                      {otherHuntLayers.map((layer) => (
                        <option key={layer.id} value={layer.id}>{layer.name}</option>
                      ))}
                    </optgroup>
                  )}
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
              <div className="scout-limit-card">
                <p className="scout-limit-note">
                  Your scratch layer is full. Sign in to keep this pin and add more.
                </p>
                <button type="button" className="scout-sign-in" onClick={onSignIn}>
                  <LogIn size={14} aria-hidden="true" />
                  Sign in to save
                </button>
              </div>
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
          </section>
        </div>,
        document.body,
      )}
    </>
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

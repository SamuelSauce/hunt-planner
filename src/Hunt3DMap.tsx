import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  ChevronDown,
  Crosshair,
  Layers3,
  LoaderCircle,
  LocateFixed,
  Map as MapIcon,
  MapPin,
  Mountain,
  RotateCcw,
  Satellite,
  Save,
  Share2,
  Sparkles,
  X,
} from 'lucide-react'
import maplibregl, {
  type GeoJSONSource,
  type Map as MapLibreMap,
  type StyleSpecification,
} from 'maplibre-gl'
import type { FeatureCollection, MultiPolygon, Polygon } from 'geojson'
import 'maplibre-gl/dist/maplibre-gl.css'
import {
  boundaryDataPath,
  featureMatchesHunt,
  type BoundaryData,
  type BoundaryFeature,
  type MapHunt,
  type PlannerState,
} from './MapExplorer'
import {
  buildHuntPotentialAnalysis,
  type HuntPotentialAnalysis,
  type PotentialZone,
} from './huntPotentialAnalysis'
import {
  firebaseAuthErrorMessage,
  signInWithGoogle,
  signOutOfFirebase,
  subscribeToFirebaseAuth,
} from './firebase'
import { normalizeMapPin, type MapPinLocation } from './mapPin'
import {
  ScoutingPanel,
  type ScoutPersistenceStatus,
} from './scouting/ScoutingPanel'
import { ScoutShareModal } from './scouting/ScoutShareModal'
import { loadScoutLibrary, saveScoutLibrary } from './scouting/api'
import {
  clearGuestScoutLibrary,
  loadGuestScoutLibrary,
  saveGuestScoutLibrary,
} from './scouting/draftStore'
import {
  DEFAULT_SCOUT_FILTERS,
  GUEST_PIN_LIMIT,
  createScoutLayer,
  createScoutLibrary,
  createScoutPin,
  mergeScoutLibraries,
  sameScoutHunt,
  scoutLibraryForHunt,
  scoutLibraryForMap,
  scoutLibraryForPersistence,
  scoutPinsGeoJson,
  scoutWorkspaceFromLibrary,
  type ScoutFilters,
  type ScoutHuntContext,
  type ScoutPinDraft,
} from './scouting/model'
import {
  landStatusFromIdentifyResults,
  type LandStatus,
  type LandStatusIdentifyResult,
} from './landStatus'

type Basemap = 'satellite' | 'topographic'
type LocationStatus = 'idle' | 'locating' | 'error'
type PotentialStatus = 'idle' | 'analyzing' | 'ready' | 'error'

const LAND_STATUS_LAYER = 'land-status-layer'
const SATELLITE_LAYER = 'satellite-layer'
const SATELLITE_TRANSPORTATION_LAYER = 'satellite-transportation-layer'
const SATELLITE_PLACES_LAYER = 'satellite-places-layer'
const TOPOGRAPHIC_LAYER = 'topographic-layer'
const TERRAIN_SOURCE = 'terrain-dem'
const HILLSHADE_LAYER = 'terrain-hillshade'
const POTENTIAL_SOURCE = 'ai-potential-source'
const POTENTIAL_HOTSPOT_SOURCE = 'ai-potential-hotspot-source'
const POTENTIAL_HEAT_LAYER = 'ai-potential-heat'
const POTENTIAL_HOTSPOT_LAYER = 'ai-potential-hotspots'
const POTENTIAL_LABEL_LAYER = 'ai-potential-labels'
const SCOUT_SOURCE = 'scout-pins-source'
const SCOUT_CLUSTER_LAYER = 'scout-pin-clusters'
const SCOUT_CLUSTER_COUNT_LAYER = 'scout-pin-cluster-count'
const SCOUT_PIN_LAYER = 'scout-pins'
const SCOUT_PIN_LABEL_LAYER = 'scout-pin-labels'
const MOBILE_MAP_BREAKPOINT = 840
const LAND_STATUS_IDENTIFY_URL =
  'https://gis.blm.gov/arcgis/rest/services/lands/BLM_Natl_SMA_Cached_with_PriUnk/MapServer/identify'

const stateCamera: Record<PlannerState, { center: [number, number]; zoom: number }> = {
  utah: { center: [-111.65, 39.35], zoom: 6.6 },
  colorado: { center: [-105.55, 39], zoom: 6.3 },
  idaho: { center: [-114.45, 44.25], zoom: 6.2 },
  wyoming: { center: [-107.55, 43], zoom: 6.2 },
}

function isMobileMapViewport() {
  return typeof window !== 'undefined' && window.innerWidth <= MOBILE_MAP_BREAKPOINT
}

export function Hunt3DMap({
  hunt,
  plannerState: requestedPlannerState,
  pin,
  shareStatus,
  onPinChange,
  onShare,
  onClose,
}: {
  hunt: (MapHunt & {
    category: string
    gender: string
    weapon: string
    seasonDateText: string | null
  }) | null
  plannerState?: PlannerState
  pin: MapPinLocation | null
  shareStatus: 'idle' | 'shared' | 'copied' | 'error'
  onPinChange: (pin: MapPinLocation | null) => void
  onShare: (pin: MapPinLocation | null) => void
  onClose: () => void
}) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const pinMarkerRef = useRef<maplibregl.Marker | null>(null)
  const pinPopupRef = useRef<maplibregl.Popup | null>(null)
  const pinRef = useRef<MapPinLocation | null>(pin)
  const onPinChangeRef = useRef(onPinChange)
  const closeButtonRef = useRef<HTMLButtonElement | null>(null)
  const savePinButtonRef = useRef<HTMLButtonElement | null>(null)
  const resetViewRef = useRef<() => void>(() => undefined)
  const [boundaryFeatures, setBoundaryFeatures] = useState<BoundaryFeature[] | null>(null)
  const [boundaryError, setBoundaryError] = useState(false)
  const [mapReady, setMapReady] = useState(false)
  const [mapError, setMapError] = useState(false)
  const [basemap, setBasemap] = useState<Basemap>('satellite')
  const [terrainVisible, setTerrainVisible] = useState(true)
  const [reliefVisible, setReliefVisible] = useState(true)
  const [landStatusVisible, setLandStatusVisible] = useState(false)
  const [huntBoundaryVisible, setHuntBoundaryVisible] = useState(true)
  const [locationStatus, setLocationStatus] = useState<LocationStatus>('idle')
  const [layersExpanded, setLayersExpanded] = useState(() => !isMobileMapViewport())
  const [potentialVisible, setPotentialVisible] = useState(false)
  const [potentialStatus, setPotentialStatus] = useState<PotentialStatus>('idle')
  const [potentialAnalysis, setPotentialAnalysis] = useState<HuntPotentialAnalysis | null>(null)
  const [pinPopupContainer] = useState(() => document.createElement('div'))
  const standalone = hunt === null
  const plannerState = hunt?.state ?? requestedPlannerState ?? 'utah'
  const stateName = plannerState[0].toUpperCase() + plannerState.slice(1)
  const huntContext: ScoutHuntContext = useMemo(() => ({
    state: plannerState,
    huntNumber: hunt?.huntNumber ?? 'MAP',
    huntName: hunt?.huntName ?? `${stateName} scouting map`,
    species: hunt?.species ?? 'General',
    gender: hunt?.gender ?? '',
    weapon: hunt?.weapon ?? '',
  }), [
    hunt,
    plannerState,
    stateName,
  ])
  const [authStatus, setAuthStatus] = useState<'loading' | 'signed-in' | 'signed-out'>('loading')
  const [authMessage, setAuthMessage] = useState('')
  const [persistenceStatus, setPersistenceStatus] =
    useState<ScoutPersistenceStatus>('loading')
  const [workspaceStorage, setWorkspaceStorage] = useState<'guest' | 'remote'>('guest')
  const [filters, setFilters] = useState<ScoutFilters>(DEFAULT_SCOUT_FILTERS)
  const [workspace, setWorkspace] = useState(() =>
    standalone
      ? scoutLibraryForMap(createScoutLibrary(), huntContext)
      : scoutLibraryForHunt(createScoutLibrary(), huntContext),
  )
  const [workspaceLoaded, setWorkspaceLoaded] = useState(false)
  const [selectedPinId, setSelectedPinId] = useState<string | null>(null)
  const [pinEditorOpen, setPinEditorOpen] = useState(false)
  const [shareModalOpen, setShareModalOpen] = useState(false)
  const [headerExpanded, setHeaderExpanded] = useState(false)
  const lastPersistedWorkspaceRef = useRef('')
  const dataPath = hunt
    ? boundaryDataPath(plannerState, hunt.species, hunt.category)
    : null
  const selectedPin = workspace.pins.find((candidate) => candidate.id === selectedPinId) ?? null
  const shareWorkspace = useMemo(
    () => scoutWorkspaceFromLibrary(workspace, huntContext),
    [huntContext, workspace],
  )
  const hasVisibleScoutPins = useMemo(() => {
    const visibleLayerIds = new Set(
      workspace.layers.filter((layer) => layer.visible).map((layer) => layer.id),
    )
    return workspace.pins.some((candidate) => visibleLayerIds.has(candidate.layerId))
  }, [workspace.layers, workspace.pins])

  useEffect(() => {
    onPinChangeRef.current = onPinChange
  }, [onPinChange])

  useEffect(() => subscribeToFirebaseAuth(
    (signedIn) => {
      setAuthStatus(signedIn ? 'signed-in' : 'signed-out')
      setAuthMessage('')
    },
    (error) => {
      setAuthStatus('signed-out')
      setAuthMessage(firebaseAuthErrorMessage(error))
    },
  ), [])

  useEffect(() => {
    if (authStatus === 'loading') return
    let cancelled = false

    const hydrateWorkspace = async () => {
      setWorkspaceLoaded(false)
      setPersistenceStatus('loading')
      setSelectedPinId(null)
      const guestDraft = await loadGuestScoutLibrary()
      if (cancelled) return

      if (authStatus === 'signed-out') {
        const next = guestDraft ?? createScoutLibrary()
        lastPersistedWorkspaceRef.current = JSON.stringify(scoutLibraryForPersistence(next))
        setWorkspace(
          standalone
            ? scoutLibraryForMap(next, huntContext)
            : scoutLibraryForHunt(next, huntContext),
        )
        setWorkspaceStorage('guest')
        setPersistenceStatus('local')
        setWorkspaceLoaded(true)
        return
      }

      try {
        const remote = await loadScoutLibrary()
        const fallback = createScoutLibrary()
        const guestForPersistence = guestDraft
          ? scoutLibraryForPersistence(guestDraft)
          : null
        const hasGuestWork = guestForPersistence !== null &&
          (guestForPersistence.pins.length > 0 || guestForPersistence.layers.length > 0)
        const next = hasGuestWork
          ? mergeScoutLibraries(remote, guestForPersistence)
          : remote ?? fallback
        if (hasGuestWork) {
          await saveScoutLibrary(scoutLibraryForPersistence(next))
          await clearGuestScoutLibrary()
        }
        if (cancelled) return
        lastPersistedWorkspaceRef.current = JSON.stringify(scoutLibraryForPersistence(next))
        setWorkspace(
          standalone
            ? scoutLibraryForMap(next, huntContext)
            : scoutLibraryForHunt(next, huntContext),
        )
        setWorkspaceStorage('remote')
        setPersistenceStatus('saved')
      } catch {
        if (cancelled) return
        const next = guestDraft ?? createScoutLibrary()
        setWorkspace(
          standalone
            ? scoutLibraryForMap(next, huntContext)
            : scoutLibraryForHunt(next, huntContext),
        )
        setWorkspaceStorage('guest')
        setPersistenceStatus('error')
      }
      setWorkspaceLoaded(true)
    }

    void hydrateWorkspace()
    return () => {
      cancelled = true
    }
  }, [authStatus, huntContext, standalone])

  useEffect(() => {
    if (!workspaceLoaded) return
    const persistableWorkspace = scoutLibraryForPersistence(workspace)
    const serialized = JSON.stringify(persistableWorkspace)
    if (serialized === lastPersistedWorkspaceRef.current) return

    const syncsRemotely = workspaceStorage === 'remote'
    setPersistenceStatus(syncsRemotely ? 'saving' : authStatus === 'signed-in' ? 'error' : 'local')
    const timer = window.setTimeout(() => {
      const persist = syncsRemotely
        ? saveScoutLibrary(persistableWorkspace)
        : saveGuestScoutLibrary(persistableWorkspace).then(() => persistableWorkspace)
      void persist
        .then(() => {
          lastPersistedWorkspaceRef.current = serialized
          setPersistenceStatus(
            syncsRemotely ? 'saved' : authStatus === 'signed-in' ? 'error' : 'local',
          )
        })
        .catch(async () => {
          if (syncsRemotely) await saveGuestScoutLibrary(persistableWorkspace)
          setPersistenceStatus('error')
        })
    }, syncsRemotely ? 650 : 180)

    return () => window.clearTimeout(timer)
  }, [authStatus, workspace, workspaceLoaded, workspaceStorage])

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeButtonRef.current?.focus()
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (shareModalOpen) {
        setShareModalOpen(false)
        return
      }
      if (pinEditorOpen) {
        setPinEditorOpen(false)
        window.requestAnimationFrame(() => savePinButtonRef.current?.focus())
        return
      }
      onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose, pinEditorOpen, shareModalOpen])

  useEffect(() => {
    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Reset stale boundary state before loading the next hunt.
    setBoundaryFeatures(null)
    setBoundaryError(false)

    if (!hunt) {
      setBoundaryFeatures([])
      return
    }

    if (!dataPath) {
      setBoundaryFeatures([])
      setBoundaryError(true)
      return
    }

    fetch(dataPath)
      .then((response) => {
        if (!response.ok) throw new Error(`Boundary data ${response.status}`)
        return response.json() as Promise<BoundaryData>
      })
      .then((data) => {
        if (!cancelled) {
          setBoundaryFeatures(data.features.filter((feature) => featureMatchesHunt(feature, hunt)))
        }
      })
      .catch(() => {
        if (!cancelled) {
          setBoundaryFeatures([])
          setBoundaryError(true)
        }
      })

    return () => {
      cancelled = true
    }
  }, [dataPath, hunt])

  useEffect(() => {
    if (!mapContainerRef.current || boundaryFeatures === null) return

    setMapReady(false)
    setMapError(false)
    const initialCamera = stateCamera[plannerState]
    let map: MapLibreMap

    try {
      map = new maplibregl.Map({
        container: mapContainerRef.current,
        style: mapStyle(),
        center: initialCamera.center,
        zoom: initialCamera.zoom,
        pitch: 62,
        bearing: -24,
        // Keep the camera's position—including altitude—fixed when an interaction ends.
        bearingSnap: 0,
        centerClampedToGround: false,
        dragPan: { maxSpeed: 0 },
        maxPitch: 85,
        attributionControl: false,
      })
    } catch {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Report synchronous MapLibre construction failures.
      setMapError(true)
      return
    }

    mapRef.current = map
    map.addControl(
      new maplibregl.NavigationControl({
        showCompass: true,
        showZoom: true,
        visualizePitch: true,
      }),
      'bottom-right',
    )
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: 'imperial' }), 'bottom-left')
    map.addControl(
      new maplibregl.AttributionControl({
        compact: true,
        customAttribution: 'Hunt boundaries: state wildlife agencies',
      }),
      'bottom-right',
    )
    if (isMobileMapViewport()) {
      map.getContainer()
        .querySelector('.maplibregl-ctrl-attrib')
        ?.classList.remove('maplibregl-compact-show')
    }
    const removeShiftPivotGesture = installShiftPivotGesture(map)
    let removeScoutInteractions: () => void = () => undefined

    const fitToHunt = (duration = 700) => {
      const bounds = featureBounds(boundaryFeatures)
      if (!bounds) {
        const camera = {
          center: initialCamera.center,
          zoom: initialCamera.zoom,
          pitch: 62,
          bearing: -24,
        }
        if (duration === 0) map.jumpTo(camera)
        else map.easeTo({ ...camera, duration })
        return
      }
      const compact = isMobileMapViewport()
      map.fitBounds(bounds, {
        padding: compact
          ? { top: 115, right: 30, bottom: 280, left: 30 }
          : { top: 120, right: 390, bottom: 90, left: 70 },
        maxZoom: 12.3,
        pitch: 62,
        bearing: -24,
        duration,
      })
    }

    resetViewRef.current = () => fitToHunt()
    fitToHunt(0)
    map.on('load', () => {
      if (boundaryFeatures.length > 0) {
        map.addSource('hunt-boundary', {
          type: 'geojson',
          data: boundaryFeatureCollection(boundaryFeatures),
        })
        map.addLayer(
          {
            id: 'hunt-boundary-fill',
            type: 'fill',
            source: 'hunt-boundary',
            paint: {
              'fill-color': '#f26d3d',
              'fill-opacity': 0.16,
            },
          },
          SATELLITE_TRANSPORTATION_LAYER,
        )
        map.addLayer(
          {
            id: 'hunt-boundary-glow',
            type: 'line',
            source: 'hunt-boundary',
            paint: {
              'line-color': 'rgba(255, 255, 255, 0.96)',
              'line-width': 5,
              'line-blur': 2,
            },
          },
          SATELLITE_TRANSPORTATION_LAYER,
        )
        map.addLayer(
          {
            id: 'hunt-boundary-line',
            type: 'line',
            source: 'hunt-boundary',
            paint: {
              'line-color': '#e95727',
              'line-width': 3,
              'line-dasharray': [2, 1],
            },
          },
          SATELLITE_TRANSPORTATION_LAYER,
        )
      }
      addScoutPinLayers(map)
      removeScoutInteractions = installScoutPinInteractions(map, (pinId) => {
        pinRef.current = null
        onPinChangeRef.current(null)
        setSelectedPinId(pinId)
        setPinEditorOpen(true)
      })
      const sharedPin = pinRef.current
      if (sharedPin) {
        map.easeTo({
          center: [sharedPin.longitude, sharedPin.latitude],
          zoom: 14,
          pitch: 68,
          bearing: -24,
          duration: 700,
        })
      } else {
        fitToHunt(0)
      }
      setMapReady(true)
    })

    return () => {
      removeShiftPivotGesture()
      removeScoutInteractions()
      pinMarkerRef.current = null
      pinPopupRef.current = null
      resetViewRef.current = () => undefined
      mapRef.current = null
      map.remove()
    }
  }, [boundaryFeatures, plannerState])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return

    if (!pin) {
      pinMarkerRef.current?.remove()
      pinMarkerRef.current = null
      pinPopupRef.current?.remove()
      pinPopupRef.current = null
      return
    }

    let marker = pinMarkerRef.current
    if (!marker) {
      marker = new maplibregl.Marker({
        color: '#e95727',
        opacity: 1,
        opacityWhenCovered: 1,
        scale: 1.15,
      })
      marker.getElement().classList.add('hunt-share-pin-marker')
      marker.getElement().setAttribute('role', 'img')
      pinMarkerRef.current = marker
      marker.setLngLat([pin.longitude, pin.latitude]).addTo(map)
    } else {
      marker.setLngLat([pin.longitude, pin.latitude])
    }
    marker
      .getElement()
      .setAttribute(
        'aria-label',
        `Shared pin at ${pin.latitude.toFixed(5)}, ${pin.longitude.toFixed(5)}`,
      )

    let popup = pinPopupRef.current
    if (!popup) {
      popup = new maplibregl.Popup({
        className: 'hunt-share-pin-popup',
        closeButton: false,
        closeOnClick: false,
        offset: 62,
      })
        .setDOMContent(pinPopupContainer)
        .setLngLat([pin.longitude, pin.latitude])
        .addTo(map)
      pinPopupRef.current = popup
    } else {
      popup.setLngLat([pin.longitude, pin.latitude])
    }
  }, [mapReady, pin, pinPopupContainer])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    return installLongPressPinGesture(map, (nextPin) => {
      pinRef.current = nextPin
      setSelectedPinId(null)
      setPinEditorOpen(false)
      onPinChange(nextPin)
    })
  }, [mapReady, onPinChange])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    const source = map.getSource(SCOUT_SOURCE) as GeoJSONSource | undefined
    source?.setData(scoutPinsGeoJson(workspace, filters))
  }, [filters, mapReady, workspace])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    map.setLayoutProperty(SATELLITE_LAYER, 'visibility', basemap === 'satellite' ? 'visible' : 'none')
    map.setLayoutProperty(SATELLITE_TRANSPORTATION_LAYER, 'visibility', basemap === 'satellite' ? 'visible' : 'none')
    map.setLayoutProperty(SATELLITE_PLACES_LAYER, 'visibility', basemap === 'satellite' ? 'visible' : 'none')
    map.setLayoutProperty(TOPOGRAPHIC_LAYER, 'visibility', basemap === 'topographic' ? 'visible' : 'none')
  }, [basemap, mapReady])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    map.setTerrain(terrainVisible ? { source: TERRAIN_SOURCE, exaggeration: 1.25 } : null)
    const targetPitch = terrainVisible ? 62 : 0
    if (Math.abs(map.getPitch() - targetPitch) > 0.1) {
      map.easeTo({ pitch: targetPitch, duration: 500 })
    }
  }, [mapReady, terrainVisible])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    map.setLayoutProperty(HILLSHADE_LAYER, 'visibility', reliefVisible ? 'visible' : 'none')
  }, [mapReady, reliefVisible])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    map.setLayoutProperty(LAND_STATUS_LAYER, 'visibility', landStatusVisible ? 'visible' : 'none')
  }, [landStatusVisible, mapReady])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady || !landStatusVisible) return
    return installLandStatusHover(map)
  }, [landStatusVisible, mapReady])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady || !map.getLayer('hunt-boundary-fill')) return
    const visibility = huntBoundaryVisible ? 'visible' : 'none'
    map.setLayoutProperty('hunt-boundary-fill', 'visibility', visibility)
    map.setLayoutProperty('hunt-boundary-glow', 'visibility', visibility)
    map.setLayoutProperty('hunt-boundary-line', 'visibility', visibility)
  }, [huntBoundaryVisible, mapReady])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    if (!hunt) return

    if (!potentialVisible) {
      setPotentialLayerVisibility(map, false)
      return
    }

    if (!boundaryFeatures?.length) {
      return
    }

    if (potentialAnalysis && map.getSource(POTENTIAL_SOURCE)) {
      setPotentialLayerVisibility(map, true)
      return
    }

    let cancelled = false
    let retryTimer: number | undefined
    let attempt = 0

    const analyzeTerrain = () => {
      if (cancelled) return
      attempt += 1
      const analysis = buildHuntPotentialAnalysis(map, boundaryFeatures, hunt)
      if (!analysis && attempt < 4) {
        retryTimer = window.setTimeout(analyzeTerrain, 650)
        return
      }
      if (!analysis) {
        setPotentialStatus('error')
        return
      }

      addPotentialLayers(map, analysis)
      setPotentialAnalysis(analysis)
      setPotentialStatus('ready')
    }

    retryTimer = window.setTimeout(analyzeTerrain, map.areTilesLoaded() ? 260 : 700)
    return () => {
      cancelled = true
      if (retryTimer !== undefined) window.clearTimeout(retryTimer)
    }
  }, [boundaryFeatures, hunt, mapReady, potentialAnalysis, potentialVisible])

  const locateUser = () => {
    if (!navigator.geolocation) {
      setLocationStatus('error')
      return
    }
    setLocationStatus('locating')
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setLocationStatus('idle')
        mapRef.current?.flyTo({
          center: [coords.longitude, coords.latitude],
          zoom: Math.max(mapRef.current.getZoom(), 14),
          pitch: terrainVisible ? 62 : 0,
          duration: 1100,
        })
      },
      () => setLocationStatus('error'),
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }

  const togglePotential = (checked: boolean) => {
    setPotentialVisible(checked)
    if (checked) setPotentialStatus(potentialAnalysis ? 'ready' : 'analyzing')
  }

  const focusPotentialZone = (zone: PotentialZone) => {
    const map = mapRef.current
    if (!map) return
    map.flyTo({
      center: zone.coordinate,
      zoom: Math.max(map.getZoom(), 12.2),
      pitch: terrainVisible ? 68 : 0,
      bearing: map.getBearing(),
      duration: 900,
    })
  }

  const clearPin = () => {
    setPinEditorOpen(false)
    pinRef.current = null
    onPinChange(null)
  }

  const closePinEditor = () => {
    setPinEditorOpen(false)
    window.requestAnimationFrame(() => savePinButtonRef.current?.focus())
  }

  const updateWorkspace = (
    update: (current: typeof workspace) => typeof workspace,
  ) => {
    setWorkspace((current) => {
      const next = update(current)
      return next === current ? current : { ...next, updatedAt: Date.now() }
    })
  }

  const handleAddLayer = () => {
    if (authStatus !== 'signed-in') return
    updateWorkspace((current) => {
      const currentHuntLayerCount = current.layers
        .filter((layer) => sameScoutHunt(layer.hunt, huntContext))
        .length
      return {
        ...current,
        layers: [
          ...current.layers,
          createScoutLayer(
            standalone
              ? `${stateName} map · Layer ${currentHuntLayerCount + 1}`
              : `${hunt.huntNumber} · Layer ${currentHuntLayerCount + 1}`,
            current.layers.length,
            huntContext,
          ),
        ],
      }
    })
  }

  const handleRenameLayer = (layerId: string, name: string) => {
    if (authStatus !== 'signed-in') return
    updateWorkspace((current) => ({
      ...current,
      layers: current.layers.map((layer) =>
        layer.id === layerId
          ? { ...layer, name: name.slice(0, 120), updatedAt: Date.now() }
          : layer,
      ),
    }))
  }

  const handleToggleLayer = (layerId: string) => {
    updateWorkspace((current) => ({
      ...current,
      layers: current.layers.map((layer) =>
        layer.id === layerId
          ? { ...layer, visible: !layer.visible }
          : layer,
      ),
    }))
  }

  const handleDeleteLayer = (layerId: string) => {
    if (authStatus !== 'signed-in') return
    updateWorkspace((current) => {
      if (
        current.layers.find((layer) => layer.id === layerId)?.kind === 'hunt-default' ||
        current.pins.some((candidate) => candidate.layerId === layerId)
      ) return current
      return {
        ...current,
        layers: current.layers
          .filter((layer) => layer.id !== layerId)
          .map((layer, index) => ({ ...layer, sortOrder: index })),
      }
    })
  }

  const handleSavePin = (draft: ScoutPinDraft, existingId: string | null) => {
    const now = Date.now()
    const newPin = existingId ? null : createScoutPin(draft, now)
    updateWorkspace((current) => {
      if (!existingId && authStatus !== 'signed-in' && current.pins.length >= GUEST_PIN_LIMIT) {
        return current
      }
      return {
        ...current,
        pins: existingId
          ? current.pins.map((candidate) =>
            candidate.id === existingId
              ? {
                ...candidate,
                ...draft,
                title: draft.title.trim().slice(0, 80),
                notes: draft.notes.trim().slice(0, 2_000),
                updatedAt: now,
              }
              : candidate,
          )
          : [...current.pins, newPin as NonNullable<typeof newPin>],
      }
    })
    clearPin()
    setSelectedPinId(existingId ?? newPin?.id ?? null)
  }

  const handleDeletePin = (pinId: string) => {
    updateWorkspace((current) => ({
      ...current,
      pins: current.pins.filter((candidate) => candidate.id !== pinId),
    }))
    setPinEditorOpen(false)
    setSelectedPinId(null)
  }

  const handleSignIn = () => {
    setAuthMessage('')
    void signInWithGoogle().catch((error) => setAuthMessage(firebaseAuthErrorMessage(error)))
  }

  const handleSignOut = () => {
    setAuthMessage('')
    void signOutOfFirebase().catch(() => setAuthMessage('Sign out could not be completed.'))
  }

  return (
    <section
      className={`hunt-3d-modal ${standalone ? 'standalone-map' : ''} ${headerExpanded ? 'header-details-open' : ''}`}
      role={standalone ? 'main' : 'dialog'}
      aria-modal={standalone ? undefined : 'true'}
      aria-labelledby="hunt-3d-title"
    >
      <div ref={mapContainerRef} className="hunt-3d-map-canvas" />

      <header className="hunt-3d-header">
        <div className="hunt-3d-title">
          <span className="hunt-3d-compact-mark" aria-hidden="true">3D</span>
          <div>
            <h2 id="hunt-3d-title">
              <strong>{standalone ? stateName : hunt.huntNumber}</strong>
              <span>{standalone ? '3D scouting map' : hunt.huntName}</span>
            </h2>
            {headerExpanded && (
              <p>
                {standalone
                  ? 'All your saved layers · no hunt selection required'
                  : `${hunt.gender} ${hunt.species} · ${hunt.weapon || 'Weapon varies'}`}
              </p>
            )}
          </div>
          <button
            className="hunt-3d-header-toggle"
            type="button"
            aria-expanded={headerExpanded}
            aria-label={headerExpanded ? 'Hide hunt details' : 'Show hunt details'}
            onClick={() => setHeaderExpanded((current) => !current)}
          >
            <ChevronDown size={16} aria-hidden="true" />
          </button>
        </div>
        <div className="hunt-3d-header-actions">
          <button
            className={`hunt-3d-share ${shareStatus === 'copied' || shareStatus === 'shared' ? 'copied' : ''}`}
            type="button"
            onClick={() => {
              if (hasVisibleScoutPins) {
                setPinEditorOpen(false)
                setShareModalOpen(true)
              } else {
                onShare(pin)
              }
            }}
          >
            <Share2 size={18} aria-hidden="true" />
            <span>
              {shareStatus === 'shared'
                ? 'Shared'
                : shareStatus === 'copied'
                  ? 'Link copied'
                  : shareStatus === 'error'
                    ? 'Copy failed'
                    : pin
                      ? 'Share pin'
                      : hasVisibleScoutPins
                        ? 'Share visible layers'
                        : 'Share 3D map'}
            </span>
          </button>
          <button
            ref={closeButtonRef}
            className="hunt-3d-close"
            type="button"
            onClick={onClose}
            aria-label="Close 3D map"
          >
            <X size={21} aria-hidden="true" />
          </button>
        </div>
      </header>

      <aside
        className={`hunt-3d-layers ${layersExpanded ? 'expanded' : 'collapsed'}`}
        aria-label="Map layers"
      >
        <button
          className="hunt-3d-panel-heading"
          type="button"
          aria-expanded={layersExpanded}
          aria-controls="hunt-3d-layer-content"
          onClick={() => setLayersExpanded((expanded) => !expanded)}
        >
          <span>
            <Layers3 size={17} aria-hidden="true" />
            Layers
          </span>
          <span className="hunt-3d-panel-action">
            <small>{layersExpanded ? 'Drag to pan · Shift + drag to pivot' : 'Tap to open'}</small>
            <ChevronDown size={17} aria-hidden="true" />
          </span>
        </button>

        <div id="hunt-3d-layer-content" className="hunt-3d-layer-content" hidden={!layersExpanded}>
          <fieldset className="hunt-3d-basemap-options">
            <legend>Basemap</legend>
            <div>
              <button
                type="button"
                className={basemap === 'satellite' ? 'active' : ''}
                aria-pressed={basemap === 'satellite'}
                onClick={() => setBasemap('satellite')}
              >
                <Satellite size={17} aria-hidden="true" />
                Satellite
              </button>
              <button
                type="button"
                className={basemap === 'topographic' ? 'active' : ''}
                aria-pressed={basemap === 'topographic'}
                onClick={() => setBasemap('topographic')}
              >
                <MapIcon size={17} aria-hidden="true" />
                Topo
              </button>
            </div>
          </fieldset>

          <div className="hunt-3d-layer-list">
            <LayerToggle
              icon={<Mountain size={17} aria-hidden="true" />}
              label="3D terrain"
              detail="Elevation relief"
              checked={terrainVisible}
              onChange={setTerrainVisible}
            />
            <LayerToggle
              icon={<Mountain size={17} aria-hidden="true" />}
              label="Shaded relief"
              detail="Terrain shape over any basemap"
              checked={reliefVisible}
              onChange={setReliefVisible}
            />
            {!standalone && (
              <LayerToggle
                icon={<Crosshair size={17} aria-hidden="true" />}
                label="Hunt boundary"
                detail={boundaryFeatures?.length ? `${boundaryFeatures.length} mapped area${boundaryFeatures.length === 1 ? '' : 's'}` : 'No matching polygon'}
                checked={huntBoundaryVisible}
                disabled={!boundaryFeatures?.length}
                onChange={setHuntBoundaryVisible}
              />
            )}
            <LayerToggle
              icon={<Layers3 size={17} aria-hidden="true" />}
              label="Land status"
              detail="Public, state & private/unknown"
              checked={landStatusVisible}
              onChange={setLandStatusVisible}
            />
            {!standalone && (
              <LayerToggle
                icon={<Sparkles size={17} aria-hidden="true" />}
                label="AI terrain scout"
                detail={potentialStatus === 'analyzing' ? 'Analyzing terrain…' : 'Potential zones & reasons'}
                checked={potentialVisible}
                disabled={!boundaryFeatures?.length || !mapReady}
                onChange={togglePotential}
              />
            )}
          </div>

          {landStatusVisible && (
            <div className="hunt-3d-legend">
              <strong>Surface management</strong>
              <div>
                <span><i className="legend-blm" />BLM</span>
                <span><i className="legend-forest" />Forest Service</span>
                <span><i className="legend-state" />State / local</span>
                <span><i className="legend-private" />Private / unknown</span>
              </div>
              <small>Pause your mouse over the map for status. Planning reference from BLM—not a legal parcel survey.</small>
            </div>
          )}

          {potentialVisible && (
            <PotentialAnalysisPanel
              analysis={potentialAnalysis}
              status={potentialStatus}
              onFocusZone={focusPotentialZone}
            />
          )}

          <ScoutingPanel
            workspace={workspace}
            activeHunt={huntContext}
            filters={filters}
            authStatus={authStatus}
            persistenceStatus={persistenceStatus}
            editorOpen={pinEditorOpen}
            draftLocation={pin}
            selectedPin={selectedPin}
            species={hunt?.species ?? 'General'}
            globalMode={standalone}
            onFiltersChange={setFilters}
            onAddLayer={handleAddLayer}
            onRenameLayer={handleRenameLayer}
            onToggleLayer={handleToggleLayer}
            onDeleteLayer={handleDeleteLayer}
            onSavePin={handleSavePin}
            onDeletePin={handleDeletePin}
            onOpenEditor={() => setPinEditorOpen(true)}
            onCloseEditor={closePinEditor}
            onShareLayers={() => {
              setPinEditorOpen(false)
              setShareModalOpen(true)
            }}
            onSharePin={onShare}
            onSignIn={handleSignIn}
            onSignOut={handleSignOut}
          />
          {authMessage && <p className="scout-auth-error" role="alert">{authMessage}</p>}

          <div className="hunt-3d-tools">
            <button type="button" onClick={() => resetViewRef.current()} disabled={!mapReady}>
              <RotateCcw size={16} aria-hidden="true" />
              Reset view
            </button>
            <button type="button" onClick={locateUser} disabled={!mapReady || locationStatus === 'locating'}>
              {locationStatus === 'locating'
                ? <LoaderCircle className="spin" size={16} aria-hidden="true" />
                : <LocateFixed size={16} aria-hidden="true" />}
              {locationStatus === 'locating' ? 'Locating…' : 'My location'}
            </button>
          </div>
          {locationStatus === 'error' && (
            <p className="hunt-3d-location-error">Location is unavailable. Check browser permission and try again.</p>
          )}
        </div>
      </aside>

      <ScoutShareModal
        key={shareModalOpen
          ? `open-${workspace.layers.filter((layer) => layer.visible).map((layer) => layer.id).join('-')}`
          : 'closed'}
        open={shareModalOpen}
        workspace={shareWorkspace}
        authStatus={authStatus}
        onClose={() => setShareModalOpen(false)}
        onSignIn={handleSignIn}
      />

      {pin && createPortal(
        <div className="hunt-3d-pin-bubble" aria-live="polite">
          <div className="hunt-3d-pin-header">
            <span><MapPin size={14} aria-hidden="true" /> Dropped pin</span>
            <button type="button" onClick={clearPin} aria-label="Remove dropped pin">
              <X size={14} aria-hidden="true" />
            </button>
          </div>
          <small>{pin.latitude.toFixed(5)}, {pin.longitude.toFixed(5)}</small>
          <div className="hunt-3d-pin-actions">
            <button
              ref={savePinButtonRef}
              className="save"
              type="button"
              onClick={() => setPinEditorOpen(true)}
            >
              <Save size={15} aria-hidden="true" />
              Save this pin
            </button>
            <button
              className={`share ${shareStatus === 'copied' || shareStatus === 'shared' ? 'shared' : ''}`}
              type="button"
              onClick={() => onShare(pin)}
            >
              <Share2 size={15} aria-hidden="true" />
              {shareStatus === 'shared'
                ? 'Shared'
                : shareStatus === 'copied'
                  ? 'Link copied'
                  : shareStatus === 'error'
                    ? 'Try again'
                    : 'Share this pin'}
            </button>
          </div>
        </div>,
        pinPopupContainer,
      )}

      {!standalone && (
        <div className="hunt-3d-boundary-key">
          <i />
          <div>
            <strong>{hunt.huntName}</strong>
            <span>{hunt.seasonDateText || 'Season dates not listed'}</span>
          </div>
        </div>
      )}

      {!mapReady && !mapError && (
        <div className="hunt-3d-loading" role="status">
          <LoaderCircle className="spin" size={25} aria-hidden="true" />
          <span>{standalone ? 'Opening your 3D map and scout layers…' : 'Building 3D terrain and hunt layers…'}</span>
        </div>
      )}

      {mapError && (
        <div className="hunt-3d-loading error" role="alert">
          <Mountain size={25} aria-hidden="true" />
          <span>This browser could not start the 3D map. WebGL may be unavailable.</span>
        </div>
      )}

      {!standalone && (boundaryError || (boundaryFeatures !== null && boundaryFeatures.length === 0)) && mapReady && (
        <div className="hunt-3d-boundary-warning">
          The 3D basemap is ready, but this hunt does not have a matching boundary polygon yet.
        </div>
      )}

      <p className="hunt-3d-safety-note">
        Verify current agency boundaries, land status, and access before entering the field.
      </p>
    </section>
  )
}

function LayerToggle({
  icon,
  label,
  detail,
  checked,
  disabled = false,
  onChange,
}: {
  icon: ReactNode
  label: string
  detail: string
  checked: boolean
  disabled?: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label className={disabled ? 'disabled' : ''}>
      <span className="hunt-3d-layer-icon">{icon}</span>
      <span>
        <strong>{label}</strong>
        <small>{detail}</small>
      </span>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <i className="hunt-3d-switch" aria-hidden="true" />
    </label>
  )
}

function PotentialAnalysisPanel({
  analysis,
  status,
  onFocusZone,
}: {
  analysis: HuntPotentialAnalysis | null
  status: PotentialStatus
  onFocusZone: (zone: PotentialZone) => void
}) {
  return (
    <div className="hunt-3d-ai-panel" aria-live="polite">
      <div className="hunt-3d-ai-heading">
        <span>
          <Sparkles size={15} aria-hidden="true" />
          AI Terrain Scout
        </span>
        <i>Experimental</i>
      </div>

      {status === 'analyzing' && (
        <div className="hunt-3d-ai-progress" role="status">
          <LoaderCircle className="spin" size={18} aria-hidden="true" />
          <span>
            <strong>Reading the hunt terrain…</strong>
            <small>Comparing elevation, relief, species, season, and weapon.</small>
          </span>
        </div>
      )}

      {status === 'error' && (
        <p className="hunt-3d-ai-error">
          Terrain analysis is unavailable here. Let the map finish loading, then toggle the scout off and on.
        </p>
      )}

      {status === 'ready' && analysis && (
        <>
          <div className="hunt-3d-ai-summary">
            <span>{analysis.confidence} terrain read</span>
            <strong>{analysis.zones.length} zones worth a closer look</strong>
            <p>{analysis.summary}</p>
          </div>

          <div className="hunt-3d-ai-zones">
            {analysis.zones.map((zone) => (
              <button key={zone.rank} type="button" onClick={() => onFocusZone(zone)}>
                <i>{zone.rank}</i>
                <span>
                  <strong>{zone.location} · {zone.elevationFeet.toLocaleString()} ft</strong>
                  <small>{zone.terrain} · potential {zone.score}/100</small>
                </span>
              </button>
            ))}
          </div>

          <details className="hunt-3d-ai-details">
            <summary>Why these zones?</summary>
            <ul>
              {analysis.signals.map((signal) => <li key={signal}>{signal}</li>)}
            </ul>
          </details>

          <p className="hunt-3d-ai-disclaimer">
            Terrain-based planning estimate—not a live animal prediction. It cannot see current cover, water, access, weather, fire, or hunting pressure.
          </p>
        </>
      )}
    </div>
  )
}

function mapStyle(): StyleSpecification {
  return {
    version: 8,
    sources: {
      satellite: {
        type: 'raster',
        tiles: [
          'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        ],
        tileSize: 256,
        maxzoom: 19,
        attribution: 'Imagery © Esri and contributors',
      },
      topographic: {
        type: 'raster',
        tiles: [
          'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
        ],
        tileSize: 256,
        maxzoom: 19,
        attribution: 'Topographic map © Esri and contributors',
      },
      'satellite-transportation': {
        type: 'raster',
        tiles: [
          'https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}',
        ],
        tileSize: 256,
        maxzoom: 23,
        attribution: 'Transportation © Esri, HERE, Garmin, and OpenStreetMap contributors',
      },
      'satellite-places': {
        type: 'raster',
        tiles: [
          'https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
        ],
        tileSize: 256,
        maxzoom: 23,
        attribution: 'Places © Esri, HERE, Garmin, OpenStreetMap contributors, and the GIS community',
      },
      [TERRAIN_SOURCE]: {
        type: 'raster-dem',
        url: 'https://tiles.mapterhorn.com/tilejson.json',
        tileSize: 512,
      },
      'land-status': {
        type: 'raster',
        tiles: [
          'https://gis.blm.gov/arcgis/rest/services/lands/BLM_Natl_SMA_Cached_with_PriUnk/MapServer/tile/{z}/{y}/{x}',
        ],
        tileSize: 256,
        minzoom: 4,
        maxzoom: 14,
        attribution: 'Surface Management Agency © Bureau of Land Management',
      },
    },
    layers: [
      {
        id: SATELLITE_LAYER,
        type: 'raster',
        source: 'satellite',
      },
      {
        id: TOPOGRAPHIC_LAYER,
        type: 'raster',
        source: 'topographic',
        layout: { visibility: 'none' },
      },
      {
        id: HILLSHADE_LAYER,
        type: 'hillshade',
        source: TERRAIN_SOURCE,
        paint: {
          'hillshade-exaggeration': 0.38,
          'hillshade-highlight-color': 'rgba(255, 247, 220, 0.72)',
          'hillshade-shadow-color': 'rgba(24, 35, 29, 0.82)',
          'hillshade-accent-color': 'rgba(68, 78, 61, 0.62)',
          'hillshade-illumination-direction': 325,
        },
      },
      {
        id: LAND_STATUS_LAYER,
        type: 'raster',
        source: 'land-status',
        layout: { visibility: 'none' },
        paint: {
          'raster-opacity': 0.34,
          'raster-fade-duration': 180,
        },
      },
      {
        id: SATELLITE_TRANSPORTATION_LAYER,
        type: 'raster',
        source: 'satellite-transportation',
        paint: {
          'raster-opacity': 0.82,
          'raster-fade-duration': 180,
        },
      },
      {
        id: SATELLITE_PLACES_LAYER,
        type: 'raster',
        source: 'satellite-places',
        paint: {
          'raster-fade-duration': 180,
        },
      },
    ],
    terrain: {
      source: TERRAIN_SOURCE,
      exaggeration: 1.25,
    },
  }
}

function addScoutPinLayers(map: MapLibreMap) {
  map.addSource(SCOUT_SOURCE, {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
    cluster: true,
    clusterMaxZoom: 13,
    clusterRadius: 46,
  })

  map.addLayer({
    id: SCOUT_CLUSTER_LAYER,
    type: 'circle',
    source: SCOUT_SOURCE,
    filter: ['has', 'point_count'],
    paint: {
      'circle-radius': [
        'step',
        ['get', 'point_count'],
        18,
        25, 22,
        100, 27,
      ],
      'circle-color': '#17352b',
      'circle-opacity': 0.94,
      'circle-stroke-color': '#f7edcf',
      'circle-stroke-width': 2.5,
    },
  })

  map.addLayer({
    id: SCOUT_CLUSTER_COUNT_LAYER,
    type: 'symbol',
    source: SCOUT_SOURCE,
    filter: ['has', 'point_count'],
    layout: {
      'text-field': ['get', 'point_count_abbreviated'],
      'text-size': 12,
      'text-font': ['Open Sans Bold'],
      'text-allow-overlap': true,
    },
    paint: {
      'text-color': '#ffffff',
    },
  })

  map.addLayer({
    id: SCOUT_PIN_LAYER,
    type: 'circle',
    source: SCOUT_SOURCE,
    filter: ['!', ['has', 'point_count']],
    paint: {
      'circle-radius': [
        'interpolate',
        ['linear'],
        ['zoom'],
        6, 7,
        12, 13,
      ],
      'circle-color': ['get', 'color'],
      'circle-opacity': 0.96,
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 2.5,
      'circle-pitch-alignment': 'viewport',
    },
  })

  map.addLayer({
    id: SCOUT_PIN_LABEL_LAYER,
    type: 'symbol',
    source: SCOUT_SOURCE,
    filter: ['!', ['has', 'point_count']],
    layout: {
      'text-field': ['get', 'glyph'],
      'text-size': 11,
      'text-font': ['Open Sans Bold'],
      'text-allow-overlap': true,
      'text-ignore-placement': true,
    },
    paint: {
      'text-color': '#ffffff',
      'text-halo-color': 'rgba(18, 37, 31, 0.62)',
      'text-halo-width': 0.7,
    },
  })
}

function installScoutPinInteractions(
  map: MapLibreMap,
  onSelectPin: (pinId: string) => void,
) {
  const handlePinClick = (event: maplibregl.MapLayerMouseEvent) => {
    const feature = event.features?.[0]
    const id = feature?.properties?.id
    if (!feature || typeof id !== 'string') return
    onSelectPin(id)
    if (feature.geometry.type === 'Point') {
      const coordinates = feature.geometry.coordinates
      map.easeTo({
        center: [coordinates[0], coordinates[1]],
        zoom: Math.max(map.getZoom(), 13.5),
        duration: 500,
      })
    }
  }

  const handleClusterClick = async (event: maplibregl.MapLayerMouseEvent) => {
    const feature = event.features?.[0]
    const clusterId = feature?.properties?.cluster_id
    if (typeof clusterId !== 'number' || feature?.geometry.type !== 'Point') return
    const source = map.getSource(SCOUT_SOURCE) as GeoJSONSource
    const zoom = await source.getClusterExpansionZoom(clusterId)
    map.easeTo({
      center: [feature.geometry.coordinates[0], feature.geometry.coordinates[1]],
      zoom,
      duration: 500,
    })
  }

  const showPointer = () => {
    map.getCanvas().style.cursor = 'pointer'
  }
  const hidePointer = () => {
    map.getCanvas().style.cursor = ''
  }

  map.on('click', SCOUT_PIN_LAYER, handlePinClick)
  map.on('click', SCOUT_CLUSTER_LAYER, handleClusterClick)
  map.on('mouseenter', SCOUT_PIN_LAYER, showPointer)
  map.on('mouseleave', SCOUT_PIN_LAYER, hidePointer)
  map.on('mouseenter', SCOUT_CLUSTER_LAYER, showPointer)
  map.on('mouseleave', SCOUT_CLUSTER_LAYER, hidePointer)

  return () => {
    map.off('click', SCOUT_PIN_LAYER, handlePinClick)
    map.off('click', SCOUT_CLUSTER_LAYER, handleClusterClick)
    map.off('mouseenter', SCOUT_PIN_LAYER, showPointer)
    map.off('mouseleave', SCOUT_PIN_LAYER, hidePointer)
    map.off('mouseenter', SCOUT_CLUSTER_LAYER, showPointer)
    map.off('mouseleave', SCOUT_CLUSTER_LAYER, hidePointer)
  }
}

function addPotentialLayers(map: MapLibreMap, analysis: HuntPotentialAnalysis) {
  const potentialSource = map.getSource(POTENTIAL_SOURCE) as GeoJSONSource | undefined
  const hotspotSource = map.getSource(POTENTIAL_HOTSPOT_SOURCE) as GeoJSONSource | undefined

  if (potentialSource) {
    potentialSource.setData(analysis.points)
  } else {
    map.addSource(POTENTIAL_SOURCE, { type: 'geojson', data: analysis.points })
  }

  if (hotspotSource) {
    hotspotSource.setData(analysis.hotspots)
  } else {
    map.addSource(POTENTIAL_HOTSPOT_SOURCE, { type: 'geojson', data: analysis.hotspots })
  }

  if (!map.getLayer(POTENTIAL_HEAT_LAYER)) {
    map.addLayer({
      id: POTENTIAL_HEAT_LAYER,
      type: 'heatmap',
      source: POTENTIAL_SOURCE,
      paint: {
        'heatmap-weight': [
          'interpolate',
          ['linear'],
          ['get', 'score'],
          58, 0.08,
          89, 1,
        ],
        'heatmap-intensity': [
          'interpolate',
          ['linear'],
          ['zoom'],
          6, 0.75,
          12, 1.25,
        ],
        'heatmap-radius': [
          'interpolate',
          ['linear'],
          ['zoom'],
          6, 30,
          12, 72,
        ],
        'heatmap-opacity': 0.82,
        'heatmap-color': [
          'interpolate',
          ['linear'],
          ['heatmap-density'],
          0, 'rgba(70, 220, 170, 0)',
          0.2, 'rgba(70, 220, 170, 0.24)',
          0.48, 'rgba(174, 239, 118, 0.48)',
          0.72, 'rgba(255, 221, 92, 0.68)',
          1, 'rgba(255, 127, 66, 0.86)',
        ],
      },
    })
  }

  if (!map.getLayer(POTENTIAL_HOTSPOT_LAYER)) {
    map.addLayer({
      id: POTENTIAL_HOTSPOT_LAYER,
      type: 'circle',
      source: POTENTIAL_HOTSPOT_SOURCE,
      paint: {
        'circle-radius': 14,
        'circle-color': '#112f25',
        'circle-stroke-color': '#e8ff8b',
        'circle-stroke-width': 3,
        'circle-blur': 0.05,
      },
    })
  }

  if (!map.getLayer(POTENTIAL_LABEL_LAYER)) {
    map.addLayer({
      id: POTENTIAL_LABEL_LAYER,
      type: 'symbol',
      source: POTENTIAL_HOTSPOT_SOURCE,
      layout: {
        'text-field': ['to-string', ['get', 'rank']],
        'text-size': 12,
        'text-font': ['Open Sans Bold'],
        'text-allow-overlap': true,
        'text-ignore-placement': true,
      },
      paint: {
        'text-color': '#ffffff',
        'text-halo-color': '#112f25',
        'text-halo-width': 1,
      },
    })
  }

  setPotentialLayerVisibility(map, true)
}

function setPotentialLayerVisibility(map: MapLibreMap, visible: boolean) {
  const visibility = visible ? 'visible' : 'none'
  ;[POTENTIAL_HEAT_LAYER, POTENTIAL_HOTSPOT_LAYER, POTENTIAL_LABEL_LAYER].forEach((layer) => {
    if (map.getLayer(layer)) map.setLayoutProperty(layer, 'visibility', visibility)
  })
}

function installShiftPivotGesture(map: MapLibreMap) {
  let lastPointer: { x: number; y: number } | null = null

  function stopPivoting() {
    lastPointer = null
    document.removeEventListener('mousemove', pivotMap)
    document.removeEventListener('mouseup', stopPivoting)
  }

  function pivotMap(event: MouseEvent) {
    if (!lastPointer || (event.buttons & 1) === 0) {
      stopPivoting()
      return
    }

    const deltaX = event.clientX - lastPointer.x
    const deltaY = event.clientY - lastPointer.y
    lastPointer = { x: event.clientX, y: event.clientY }
    event.preventDefault()

    map.jumpTo({
      bearing: map.getBearing() + deltaX * 0.8,
      pitch: Math.max(0, Math.min(map.getMaxPitch(), map.getPitch() - deltaY * 0.5)),
    })
  }

  const handleMouseDown = (event: maplibregl.MapMouseEvent) => {
    const mouseEvent = event.originalEvent
    if (mouseEvent.button !== 0) return

    if (mouseEvent.ctrlKey) {
      event.preventDefault()
      return
    }

    if (!mouseEvent.shiftKey) return

    event.preventDefault()
    lastPointer = { x: mouseEvent.clientX, y: mouseEvent.clientY }
    document.addEventListener('mousemove', pivotMap)
    document.addEventListener('mouseup', stopPivoting)
  }

  map.on('mousedown', handleMouseDown)

  return () => {
    map.off('mousedown', handleMouseDown)
    document.removeEventListener('mousemove', pivotMap)
    document.removeEventListener('mouseup', stopPivoting)
  }
}

function installLandStatusHover(map: MapLibreMap) {
  const content = document.createElement('div')
  content.className = 'hunt-land-status-content'
  const eyebrow = document.createElement('span')
  eyebrow.textContent = 'Land status'
  const label = document.createElement('strong')
  const access = document.createElement('small')
  content.append(eyebrow, label, access)

  const popup = new maplibregl.Popup({
    anchor: 'top',
    className: 'hunt-land-status-popup',
    closeButton: false,
    closeOnClick: false,
    closeOnMove: false,
    focusAfterOpen: false,
    maxWidth: '260px',
    offset: [0, 14],
  }).setDOMContent(content)

  let hoverTimer: number | undefined
  let request: AbortController | null = null
  let requestId = 0

  const hidePopup = () => {
    if (hoverTimer !== undefined) window.clearTimeout(hoverTimer)
    hoverTimer = undefined
    request?.abort()
    request = null
    requestId += 1
    popup.remove()
  }

  const showStatus = (
    longitude: number,
    latitude: number,
    status: LandStatus | null,
    unavailable = false,
  ) => {
    content.dataset.category = status?.category ?? 'unavailable'
    label.textContent = status?.label ?? (unavailable ? 'Status unavailable' : 'No status reported')
    access.textContent = status
      ? status.label === status.agency
        ? status.access
        : `${status.agency} · ${status.access}`
      : unavailable
        ? 'The BLM reference service did not respond'
        : 'Verify ownership and access before entering'
    popup.setLngLat([longitude, latitude]).addTo(map)
  }

  const identify = async (longitude: number, latitude: number, id: number) => {
    request?.abort()
    request = new AbortController()
    const bounds = map.getBounds()
    const canvas = map.getCanvas()
    const parameters = new URLSearchParams({
      geometry: `${longitude},${latitude}`,
      geometryType: 'esriGeometryPoint',
      sr: '4326',
      layers: 'all:1',
      tolerance: '0',
      mapExtent: [
        bounds.getWest(),
        bounds.getSouth(),
        bounds.getEast(),
        bounds.getNorth(),
      ].join(','),
      imageDisplay: `${Math.max(1, canvas.clientWidth)},${Math.max(1, canvas.clientHeight)},96`,
      returnGeometry: 'false',
      f: 'json',
    })

    try {
      const response = await fetch(`${LAND_STATUS_IDENTIFY_URL}?${parameters}`, {
        signal: request.signal,
      })
      if (!response.ok) throw new Error(`Land status identify ${response.status}`)
      const data = await response.json() as {
        results?: LandStatusIdentifyResult[]
      }
      if (id !== requestId) return
      showStatus(
        longitude,
        latitude,
        landStatusFromIdentifyResults(data.results ?? []),
      )
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      if (id !== requestId) return
      showStatus(longitude, latitude, null, true)
    }
  }

  const handleMouseMove = (event: maplibregl.MapMouseEvent) => {
    if (hoverTimer !== undefined) window.clearTimeout(hoverTimer)
    request?.abort()
    popup.remove()
    const { lng, lat } = event.lngLat
    const id = ++requestId
    hoverTimer = window.setTimeout(() => {
      hoverTimer = undefined
      void identify(lng, lat, id)
    }, 140)
  }

  map.on('mousemove', handleMouseMove)
  map.getCanvas().addEventListener('mouseleave', hidePopup)

  return () => {
    hidePopup()
    map.off('mousemove', handleMouseMove)
    map.getCanvas().removeEventListener('mouseleave', hidePopup)
  }
}

function installLongPressPinGesture(
  map: MapLibreMap,
  onPlacePin: (pin: MapPinLocation) => void,
) {
  const canvas = map.getCanvas()
  const container = map.getContainer()
  let activePointerId: number | null = null
  let startPoint: { x: number; y: number } | null = null
  let holdTimer: number | undefined
  let feedbackTimer: number | undefined
  let feedbackElement: HTMLDivElement | null = null

  const removeFeedback = () => {
    feedbackElement?.remove()
    feedbackElement = null
  }

  const cancelHold = () => {
    if (holdTimer !== undefined) window.clearTimeout(holdTimer)
    if (feedbackTimer !== undefined) window.clearTimeout(feedbackTimer)
    holdTimer = undefined
    feedbackTimer = undefined
    activePointerId = null
    startPoint = null
    removeFeedback()
  }

  const showFeedback = () => {
    if (!startPoint) return
    feedbackElement = document.createElement('div')
    feedbackElement.className = 'hunt-3d-long-press-indicator'
    feedbackElement.style.left = `${startPoint.x}px`
    feedbackElement.style.top = `${startPoint.y}px`
    container.appendChild(feedbackElement)
  }

  const handlePointerDown = (event: PointerEvent) => {
    if (
      !event.isPrimary
      || event.button !== 0
      || event.shiftKey
      || event.ctrlKey
      || event.metaKey
    ) {
      return
    }

    cancelHold()
    const bounds = container.getBoundingClientRect()
    activePointerId = event.pointerId
    startPoint = {
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
    }
    feedbackTimer = window.setTimeout(showFeedback, 110)
    holdTimer = window.setTimeout(() => {
      if (!startPoint) return
      const lngLat = map.unproject([startPoint.x, startPoint.y])
      const nextPin = normalizeMapPin({
        longitude: lngLat.lng,
        latitude: lngLat.lat,
      })

      holdTimer = undefined
      feedbackTimer = undefined
      activePointerId = null
      startPoint = null
      feedbackElement?.classList.add('placed')
      window.setTimeout(removeFeedback, 180)
      navigator.vibrate?.(12)
      onPlacePin(nextPin)
    }, 500)
  }

  const handlePointerMove = (event: PointerEvent) => {
    if (event.pointerId !== activePointerId || !startPoint) return
    const bounds = container.getBoundingClientRect()
    const deltaX = event.clientX - bounds.left - startPoint.x
    const deltaY = event.clientY - bounds.top - startPoint.y
    if (Math.hypot(deltaX, deltaY) > 10) cancelHold()
  }

  const handlePointerEnd = (event: PointerEvent) => {
    if (event.pointerId === activePointerId) cancelHold()
  }

  canvas.addEventListener('pointerdown', handlePointerDown)
  window.addEventListener('pointermove', handlePointerMove)
  window.addEventListener('pointerup', handlePointerEnd)
  window.addEventListener('pointercancel', handlePointerEnd)

  return () => {
    cancelHold()
    canvas.removeEventListener('pointerdown', handlePointerDown)
    window.removeEventListener('pointermove', handlePointerMove)
    window.removeEventListener('pointerup', handlePointerEnd)
    window.removeEventListener('pointercancel', handlePointerEnd)
  }
}

function boundaryFeatureCollection(features: BoundaryFeature[]): FeatureCollection<Polygon | MultiPolygon> {
  return {
    type: 'FeatureCollection',
    features: features.map((feature) => ({
      type: 'Feature',
      properties: {
        id: feature.id,
        name: feature.name,
      },
      geometry: feature.geometry.type === 'Polygon'
        ? {
            type: 'Polygon',
            coordinates: feature.geometry.coordinates as number[][][],
          }
        : {
            type: 'MultiPolygon',
            coordinates: feature.geometry.coordinates as number[][][][],
          },
    })),
  }
}

function featureBounds(features: BoundaryFeature[]): [[number, number], [number, number]] | null {
  if (features.length === 0) return null
  let west = Infinity
  let south = Infinity
  let east = -Infinity
  let north = -Infinity

  const extend = ([longitude, latitude]: number[]) => {
    west = Math.min(west, longitude)
    south = Math.min(south, latitude)
    east = Math.max(east, longitude)
    north = Math.max(north, latitude)
  }

  features.forEach((feature) => {
    if (feature.geometry.type === 'Polygon') {
      const rings = feature.geometry.coordinates as number[][][]
      rings.forEach((ring) => ring.forEach(extend))
    } else {
      const polygons = feature.geometry.coordinates as number[][][][]
      polygons.forEach((polygon) =>
        polygon.forEach((ring) => ring.forEach(extend)),
      )
    }
  })

  return Number.isFinite(west) ? [[west, south], [east, north]] : null
}

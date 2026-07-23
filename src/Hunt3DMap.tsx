import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  ChevronDown,
  Crosshair,
  Layers3,
  LoaderCircle,
  LocateFixed,
  Map as MapIcon,
  Mountain,
  RotateCcw,
  Satellite,
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

type Basemap = 'satellite' | 'topographic'
type LocationStatus = 'idle' | 'locating' | 'error'
type PotentialStatus = 'idle' | 'analyzing' | 'ready' | 'error'

const LAND_STATUS_LAYER = 'land-status-layer'
const SATELLITE_LAYER = 'satellite-layer'
const SATELLITE_TRANSPORTATION_LAYER = 'satellite-transportation-layer'
const SATELLITE_PLACES_LAYER = 'satellite-places-layer'
const TOPOGRAPHIC_LAYER = 'topographic-layer'
const TERRAIN_SOURCE = 'terrain-dem'
const POTENTIAL_SOURCE = 'ai-potential-source'
const POTENTIAL_HOTSPOT_SOURCE = 'ai-potential-hotspot-source'
const POTENTIAL_HEAT_LAYER = 'ai-potential-heat'
const POTENTIAL_HOTSPOT_LAYER = 'ai-potential-hotspots'
const POTENTIAL_LABEL_LAYER = 'ai-potential-labels'

const stateCamera: Record<PlannerState, { center: [number, number]; zoom: number }> = {
  utah: { center: [-111.65, 39.35], zoom: 6.6 },
  colorado: { center: [-105.55, 39], zoom: 6.3 },
  idaho: { center: [-114.45, 44.25], zoom: 6.2 },
  wyoming: { center: [-107.55, 43], zoom: 6.2 },
}

export function Hunt3DMap({
  hunt,
  shareStatus,
  onShare,
  onClose,
}: {
  hunt: MapHunt & {
    category: string
    weapon: string
    seasonDateText: string | null
  }
  shareStatus: 'idle' | 'shared' | 'copied' | 'error'
  onShare: () => void
  onClose: () => void
}) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const closeButtonRef = useRef<HTMLButtonElement | null>(null)
  const resetViewRef = useRef<() => void>(() => undefined)
  const [boundaryFeatures, setBoundaryFeatures] = useState<BoundaryFeature[] | null>(null)
  const [boundaryError, setBoundaryError] = useState(false)
  const [mapReady, setMapReady] = useState(false)
  const [mapError, setMapError] = useState(false)
  const [basemap, setBasemap] = useState<Basemap>('satellite')
  const [terrainVisible, setTerrainVisible] = useState(true)
  const [landStatusVisible, setLandStatusVisible] = useState(false)
  const [huntBoundaryVisible, setHuntBoundaryVisible] = useState(true)
  const [locationStatus, setLocationStatus] = useState<LocationStatus>('idle')
  const [layersExpanded, setLayersExpanded] = useState(true)
  const [potentialVisible, setPotentialVisible] = useState(false)
  const [potentialStatus, setPotentialStatus] = useState<PotentialStatus>('idle')
  const [potentialAnalysis, setPotentialAnalysis] = useState<HuntPotentialAnalysis | null>(null)
  const plannerState = hunt.state ?? 'utah'
  const dataPath = boundaryDataPath(plannerState, hunt.species, hunt.category)

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeButtonRef.current?.focus()

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose])

  useEffect(() => {
    let cancelled = false
    setBoundaryFeatures(null)
    setBoundaryError(false)

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
        maxPitch: 85,
        attributionControl: false,
      })
    } catch {
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
    const removeShiftPivotGesture = installShiftPivotGesture(map)

    const fitToHunt = () => {
      const bounds = featureBounds(boundaryFeatures)
      if (!bounds) {
        map.easeTo({
          center: initialCamera.center,
          zoom: initialCamera.zoom,
          pitch: 62,
          bearing: -24,
          duration: 700,
        })
        return
      }
      const compact = window.innerWidth <= 760
      map.fitBounds(bounds, {
        padding: compact
          ? { top: 115, right: 30, bottom: 280, left: 30 }
          : { top: 120, right: 390, bottom: 90, left: 70 },
        maxZoom: 12.3,
        pitch: 62,
        bearing: -24,
        duration: 700,
      })
    }

    resetViewRef.current = fitToHunt
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
      fitToHunt()
      setMapReady(true)
    })

    return () => {
      removeShiftPivotGesture()
      resetViewRef.current = () => undefined
      mapRef.current = null
      map.remove()
    }
  }, [boundaryFeatures, plannerState])

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
    map.easeTo({ pitch: terrainVisible ? 62 : 0, duration: 500 })
  }, [mapReady, terrainVisible])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    map.setLayoutProperty(LAND_STATUS_LAYER, 'visibility', landStatusVisible ? 'visible' : 'none')
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

  return (
    <section
      className="hunt-3d-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="hunt-3d-title"
    >
      <div ref={mapContainerRef} className="hunt-3d-map-canvas" />

      <header className="hunt-3d-header">
        <div className="hunt-3d-title">
          <span className="hunt-3d-mark" aria-hidden="true">
            <Mountain size={20} />
          </span>
          <div>
            <span className="hunt-3d-kicker">
              3D hunt map <i>Beta</i>
            </span>
            <h2 id="hunt-3d-title">{hunt.huntName}</h2>
            <p>{hunt.huntNumber} · {hunt.species} · {hunt.weapon || 'Weapon varies'}</p>
          </div>
        </div>
        <div className="hunt-3d-header-actions">
          <button
            className={`hunt-3d-share ${shareStatus === 'copied' || shareStatus === 'shared' ? 'copied' : ''}`}
            type="button"
            onClick={onShare}
          >
            <Share2 size={18} aria-hidden="true" />
            <span>
              {shareStatus === 'shared'
                ? 'Shared'
                : shareStatus === 'copied'
                  ? 'Link copied'
                  : shareStatus === 'error'
                    ? 'Copy failed'
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
              icon={<Crosshair size={17} aria-hidden="true" />}
              label="Hunt boundary"
              detail={boundaryFeatures?.length ? `${boundaryFeatures.length} mapped area${boundaryFeatures.length === 1 ? '' : 's'}` : 'No matching polygon'}
              checked={huntBoundaryVisible}
              disabled={!boundaryFeatures?.length}
              onChange={setHuntBoundaryVisible}
            />
            <LayerToggle
              icon={<Layers3 size={17} aria-hidden="true" />}
              label="Land status"
              detail="Public, state & private/unknown"
              checked={landStatusVisible}
              onChange={setLandStatusVisible}
            />
            <LayerToggle
              icon={<Sparkles size={17} aria-hidden="true" />}
              label="AI terrain scout"
              detail={potentialStatus === 'analyzing' ? 'Analyzing terrain…' : 'Potential zones & reasons'}
              checked={potentialVisible}
              disabled={!boundaryFeatures?.length || !mapReady}
              onChange={togglePotential}
            />
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
              <small>Planning reference from BLM—not a legal parcel survey.</small>
            </div>
          )}

          {potentialVisible && (
            <PotentialAnalysisPanel
              analysis={potentialAnalysis}
              status={potentialStatus}
              onFocusZone={focusPotentialZone}
            />
          )}

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

      <div className="hunt-3d-boundary-key">
        <i />
        <div>
          <strong>{hunt.huntName}</strong>
          <span>{hunt.seasonDateText || 'Season dates not listed'}</span>
        </div>
      </div>

      {!mapReady && !mapError && (
        <div className="hunt-3d-loading" role="status">
          <LoaderCircle className="spin" size={25} aria-hidden="true" />
          <span>Building 3D terrain and hunt layers…</span>
        </div>
      )}

      {mapError && (
        <div className="hunt-3d-loading error" role="alert">
          <Mountain size={25} aria-hidden="true" />
          <span>This browser could not start the 3D map. WebGL may be unavailable.</span>
        </div>
      )}

      {(boundaryError || (boundaryFeatures !== null && boundaryFeatures.length === 0)) && mapReady && (
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

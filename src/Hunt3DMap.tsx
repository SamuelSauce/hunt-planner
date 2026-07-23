import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Crosshair,
  Layers3,
  LoaderCircle,
  LocateFixed,
  Map as MapIcon,
  Mountain,
  RotateCcw,
  Satellite,
  X,
} from 'lucide-react'
import maplibregl, { type Map as MapLibreMap, type StyleSpecification } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import {
  boundaryDataPath,
  featureMatchesHunt,
  type BoundaryData,
  type BoundaryFeature,
  type MapHunt,
  type PlannerState,
} from './MapExplorer'

type Basemap = 'satellite' | 'topographic'
type LocationStatus = 'idle' | 'locating' | 'error'

const LAND_STATUS_LAYER = 'land-status-layer'
const SATELLITE_LAYER = 'satellite-layer'
const TOPOGRAPHIC_LAYER = 'topographic-layer'
const TERRAIN_SOURCE = 'terrain-dem'

const stateCamera: Record<PlannerState, { center: [number, number]; zoom: number }> = {
  utah: { center: [-111.65, 39.35], zoom: 6.6 },
  colorado: { center: [-105.55, 39], zoom: 6.3 },
  idaho: { center: [-114.45, 44.25], zoom: 6.2 },
  wyoming: { center: [-107.55, 43], zoom: 6.2 },
}

export function Hunt3DMap({
  hunt,
  onClose,
}: {
  hunt: MapHunt & {
    category: string
    weapon: string
    seasonDateText: string | null
  }
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
  const [landStatusVisible, setLandStatusVisible] = useState(true)
  const [huntBoundaryVisible, setHuntBoundaryVisible] = useState(true)
  const [locationStatus, setLocationStatus] = useState<LocationStatus>('idle')
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
        map.addLayer({
          id: 'hunt-boundary-fill',
          type: 'fill',
          source: 'hunt-boundary',
          paint: {
            'fill-color': '#f26d3d',
            'fill-opacity': 0.16,
          },
        })
        map.addLayer({
          id: 'hunt-boundary-glow',
          type: 'line',
          source: 'hunt-boundary',
          paint: {
            'line-color': 'rgba(255, 255, 255, 0.96)',
            'line-width': 5,
            'line-blur': 2,
          },
        })
        map.addLayer({
          id: 'hunt-boundary-line',
          type: 'line',
          source: 'hunt-boundary',
          paint: {
            'line-color': '#e95727',
            'line-width': 3,
            'line-dasharray': [2, 1],
          },
        })
      }
      fitToHunt()
      setMapReady(true)
    })

    return () => {
      resetViewRef.current = () => undefined
      mapRef.current = null
      map.remove()
    }
  }, [boundaryFeatures, plannerState])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    map.setLayoutProperty(SATELLITE_LAYER, 'visibility', basemap === 'satellite' ? 'visible' : 'none')
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
        <button
          ref={closeButtonRef}
          className="hunt-3d-close"
          type="button"
          onClick={onClose}
          aria-label="Close 3D map"
        >
          <X size={21} aria-hidden="true" />
        </button>
      </header>

      <aside className="hunt-3d-layers" aria-label="Map layers">
        <div className="hunt-3d-panel-heading">
          <span>
            <Layers3 size={17} aria-hidden="true" />
            Layers
          </span>
          <small>Drag to pan · Ctrl + drag to tilt</small>
        </div>

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
        paint: {
          'raster-opacity': 0.58,
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

function boundaryFeatureCollection(features: BoundaryFeature[]) {
  return {
    type: 'FeatureCollection' as const,
    features: features.map((feature) => ({
      type: 'Feature' as const,
      properties: {
        id: feature.id,
        name: feature.name,
      },
      geometry: feature.geometry,
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

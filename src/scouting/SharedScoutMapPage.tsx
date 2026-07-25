import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import {
  Check,
  Copy,
  ExternalLink,
  Layers3,
  Map as MapIcon,
  MapPinned,
  Satellite,
  Share2,
} from 'lucide-react'
import maplibregl, {
  type GeoJSONSource,
  type Map as MapLibreMap,
  type StyleSpecification,
} from 'maplibre-gl'
import type { Point } from 'geojson'
import 'maplibre-gl/dist/maplibre-gl.css'
import { loadScoutShare, type ScoutShare } from './api'
import {
  DEFAULT_SCOUT_FILTERS,
  SCOUT_PIN_TYPES,
  scoutPinsGeoJson,
  type ScoutPin,
  type ScoutWorkspace,
} from './model'

type Basemap = 'satellite' | 'topographic'

const SHARED_SCOUT_SOURCE = 'shared-scout-pins'
const SHARED_SCOUT_CLUSTERS = 'shared-scout-clusters'
const SHARED_SCOUT_CLUSTER_COUNT = 'shared-scout-cluster-count'
const SHARED_SCOUT_PINS = 'shared-scout-points'
const SHARED_SCOUT_LABELS = 'shared-scout-labels'
const SHARED_TERRAIN_SOURCE = 'shared-terrain-dem'
const SHARED_HILLSHADE = 'shared-terrain-hillshade'
const SHARED_SATELLITE = 'shared-satellite'
const SHARED_TOPOGRAPHIC = 'shared-topographic'

export function SharedScoutMapPage({ shareId }: { shareId: string }) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const popupRef = useRef<maplibregl.Popup | null>(null)
  const [share, setShare] = useState<ScoutShare | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [visibleLayerIds, setVisibleLayerIds] = useState<string[]>([])
  const [basemap, setBasemap] = useState<Basemap>('satellite')
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'error'>('idle')

  useEffect(() => {
    let cancelled = false
    void loadScoutShare(shareId)
      .then((nextShare) => {
        if (cancelled) return
        setShare(nextShare)
        setVisibleLayerIds(nextShare.workspace.layers.map((layer) => layer.id))
        setStatus('ready')
      })
      .catch(() => {
        if (!cancelled) setStatus('error')
      })
    return () => {
      cancelled = true
    }
  }, [shareId])

  useEffect(() => {
    if (!share) return
    const previousTitle = document.title
    const robots = document.querySelector<HTMLMetaElement>('meta[name="robots"]')
    const previousRobots = robots?.content
    document.title = `${share.title} | Hunt Planner`
    if (robots) robots.content = 'noindex,nofollow,noarchive'
    return () => {
      document.title = previousTitle
      if (robots && previousRobots) robots.content = previousRobots
    }
  }, [share])

  const visibleWorkspace = useMemo(() => {
    if (!share) return null
    const visible = new Set(visibleLayerIds)
    return {
      ...share.workspace,
      layers: share.workspace.layers.map((layer) => ({
        ...layer,
        visible: visible.has(layer.id),
      })),
    }
  }, [share, visibleLayerIds])

  useEffect(() => {
    if (!share || !mapContainerRef.current || mapRef.current) return
    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: sharedMapStyle(),
      center: [-111.7, 39.3],
      zoom: 6,
      pitch: 48,
      bearing: -15,
      maxPitch: 80,
      attributionControl: false,
    })
    mapRef.current = map
    map.addControl(
      new maplibregl.NavigationControl({
        showCompass: true,
        showZoom: true,
        visualizePitch: true,
      }),
      'bottom-right',
    )
    map.addControl(
      new maplibregl.AttributionControl({ compact: true }),
      'bottom-right',
    )
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 110, unit: 'imperial' }), 'bottom-left')

    map.on('load', () => {
      addSharedScoutLayers(map, share.workspace)
      fitSharedPins(map, share.workspace)
    })

    const handlePinClick = (event: maplibregl.MapLayerMouseEvent) => {
      const pinId = String(event.features?.[0]?.properties?.id ?? '')
      const pin = share.workspace.pins.find((candidate) => candidate.id === pinId)
      if (!pin) return
      popupRef.current?.remove()
      popupRef.current = new maplibregl.Popup({
        className: 'shared-scout-popup',
        closeButton: true,
        offset: 18,
        maxWidth: '290px',
      })
        .setDOMContent(sharedPinPopup(pin))
        .setLngLat([pin.location.longitude, pin.location.latitude])
        .addTo(map)
    }

    const handleClusterClick = async (event: maplibregl.MapLayerMouseEvent) => {
      const feature = event.features?.[0]
      const clusterId = Number(feature?.properties?.cluster_id)
      const source = map.getSource(SHARED_SCOUT_SOURCE) as GeoJSONSource | undefined
      if (!source || !Number.isFinite(clusterId) || !feature) return
      const zoom = await source.getClusterExpansionZoom(clusterId)
      const coordinates = (feature.geometry as Point).coordinates as [number, number]
      map.easeTo({ center: coordinates, zoom, duration: 500 })
    }

    const pointEnter = () => {
      map.getCanvas().style.cursor = 'pointer'
    }
    const pointLeave = () => {
      map.getCanvas().style.cursor = ''
    }
    map.on('click', SHARED_SCOUT_PINS, handlePinClick)
    map.on('click', SHARED_SCOUT_CLUSTERS, handleClusterClick)
    map.on('mouseenter', SHARED_SCOUT_PINS, pointEnter)
    map.on('mouseleave', SHARED_SCOUT_PINS, pointLeave)
    map.on('mouseenter', SHARED_SCOUT_CLUSTERS, pointEnter)
    map.on('mouseleave', SHARED_SCOUT_CLUSTERS, pointLeave)

    return () => {
      popupRef.current?.remove()
      popupRef.current = null
      mapRef.current = null
      map.remove()
    }
  }, [share])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.isStyleLoaded() || !visibleWorkspace) return
    const source = map.getSource(SHARED_SCOUT_SOURCE) as GeoJSONSource | undefined
    source?.setData(scoutPinsGeoJson(visibleWorkspace, DEFAULT_SCOUT_FILTERS))
  }, [visibleWorkspace])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.isStyleLoaded()) return
    map.setLayoutProperty(SHARED_SATELLITE, 'visibility', basemap === 'satellite' ? 'visible' : 'none')
    map.setLayoutProperty(SHARED_TOPOGRAPHIC, 'visibility', basemap === 'topographic' ? 'visible' : 'none')
  }, [basemap])

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setCopyStatus('copied')
    } catch {
      setCopyStatus('error')
    }
    window.setTimeout(() => setCopyStatus('idle'), 1600)
  }

  if (status === 'loading') {
    return (
      <main className="shared-scout-state">
        <MapPinned size={28} aria-hidden="true" />
        <strong>Opening shared scout map…</strong>
      </main>
    )
  }

  if (status === 'error' || !share || !visibleWorkspace) {
    return (
      <main className="shared-scout-state error">
        <MapPinned size={28} aria-hidden="true" />
        <strong>This shared scout map is unavailable.</strong>
        <span>The link may be incorrect or no longer active.</span>
        <a href="/">Open Hunt Planner</a>
      </main>
    )
  }

  const plannerUrl = new URL('/', window.location.origin)
  plannerUrl.searchParams.set('state', share.workspace.state)
  plannerUrl.searchParams.set('hunt', share.workspace.huntNumber)
  plannerUrl.searchParams.set('view', '3d')
  plannerUrl.hash = 'planner'

  return (
    <main className="shared-scout-page">
      <div ref={mapContainerRef} className="shared-scout-map" aria-label="Shared scout map" />

      <header className="shared-scout-header">
        <span className="shared-scout-brand"><MapPinned size={20} aria-hidden="true" /></span>
        <div>
          <small>Shared scout map · Read only</small>
          <h1>{share.title}</h1>
          <p>{share.workspace.name} · {share.workspace.huntNumber}</p>
        </div>
        <div className="shared-scout-header-actions">
          <button type="button" onClick={copyLink}>
            {copyStatus === 'copied' ? <Check size={17} /> : <Copy size={17} />}
            <span>
              {copyStatus === 'copied'
                ? 'Copied'
                : copyStatus === 'error'
                  ? 'Copy failed'
                  : 'Copy link'}
            </span>
          </button>
          <a href={plannerUrl.toString()}>
            <ExternalLink size={17} aria-hidden="true" />
            <span>Open planner</span>
          </a>
        </div>
      </header>

      <aside className="shared-scout-layers" aria-label="Shared map layers">
        <div className="shared-scout-layers-heading">
          <span><Layers3 size={16} aria-hidden="true" /> Layers</span>
          <small>{share.workspace.pins.length} pins</small>
        </div>

        <div className="shared-scout-basemaps" aria-label="Basemap">
          <button
            type="button"
            className={basemap === 'satellite' ? 'active' : ''}
            aria-pressed={basemap === 'satellite'}
            onClick={() => setBasemap('satellite')}
          >
            <Satellite size={15} aria-hidden="true" /> Satellite
          </button>
          <button
            type="button"
            className={basemap === 'topographic' ? 'active' : ''}
            aria-pressed={basemap === 'topographic'}
            onClick={() => setBasemap('topographic')}
          >
            <MapIcon size={15} aria-hidden="true" /> Topo
          </button>
        </div>

        <div className="shared-scout-layer-list">
          {share.workspace.layers.map((layer) => {
            const checked = visibleLayerIds.includes(layer.id)
            const count = share.workspace.pins.filter((pin) => pin.layerId === layer.id).length
            return (
              <label key={layer.id}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => setVisibleLayerIds((current) => (
                    checked
                      ? current.filter((candidate) => candidate !== layer.id)
                      : [...current, layer.id]
                  ))}
                />
                <i style={{ '--scout-color': layer.color } as CSSProperties}>
                  {checked && <Check size={12} aria-hidden="true" />}
                </i>
                <span>
                  <strong>{layer.name}</strong>
                  <small>{count} pin{count === 1 ? '' : 's'}</small>
                </span>
              </label>
            )
          })}
        </div>

        <p>
          <Share2 size={13} aria-hidden="true" />
          Anyone with this unlisted link can view these exact locations.
        </p>
      </aside>
    </main>
  )
}

function addSharedScoutLayers(map: MapLibreMap, workspace: ScoutWorkspace) {
  map.addSource(SHARED_SCOUT_SOURCE, {
    type: 'geojson',
    data: scoutPinsGeoJson(workspace, DEFAULT_SCOUT_FILTERS),
    cluster: true,
    clusterMaxZoom: 13,
    clusterRadius: 46,
  })

  map.addLayer({
    id: SHARED_SCOUT_CLUSTERS,
    type: 'circle',
    source: SHARED_SCOUT_SOURCE,
    filter: ['has', 'point_count'],
    paint: {
      'circle-radius': ['step', ['get', 'point_count'], 18, 25, 22, 100, 27],
      'circle-color': '#17352b',
      'circle-opacity': 0.94,
      'circle-stroke-color': '#f7edcf',
      'circle-stroke-width': 2.5,
    },
  })
  map.addLayer({
    id: SHARED_SCOUT_CLUSTER_COUNT,
    type: 'symbol',
    source: SHARED_SCOUT_SOURCE,
    filter: ['has', 'point_count'],
    layout: {
      'text-field': ['get', 'point_count_abbreviated'],
      'text-size': 12,
    },
    paint: { 'text-color': '#fff' },
  })
  map.addLayer({
    id: SHARED_SCOUT_PINS,
    type: 'circle',
    source: SHARED_SCOUT_SOURCE,
    filter: ['!', ['has', 'point_count']],
    paint: {
      'circle-radius': 11,
      'circle-color': ['get', 'color'],
      'circle-stroke-color': '#fff8e7',
      'circle-stroke-width': 2.5,
    },
  })
  map.addLayer({
    id: SHARED_SCOUT_LABELS,
    type: 'symbol',
    source: SHARED_SCOUT_SOURCE,
    filter: ['!', ['has', 'point_count']],
    layout: {
      'text-field': ['get', 'glyph'],
      'text-size': 11,
      'text-font': ['Open Sans Bold'],
      'text-allow-overlap': true,
    },
    paint: { 'text-color': '#102219' },
  })
}

function fitSharedPins(map: MapLibreMap, workspace: ScoutWorkspace) {
  const bounds = new maplibregl.LngLatBounds()
  workspace.pins.forEach((pin) => {
    bounds.extend([pin.location.longitude, pin.location.latitude])
  })
  if (bounds.isEmpty()) return
  if (workspace.pins.length === 1) {
    map.easeTo({
      center: bounds.getCenter(),
      zoom: 14,
      pitch: 52,
      duration: 700,
    })
    return
  }
  map.fitBounds(bounds, {
    padding: window.innerWidth <= 700
      ? { top: 120, right: 35, bottom: 245, left: 35 }
      : { top: 110, right: 360, bottom: 80, left: 65 },
    maxZoom: 15,
    pitch: 48,
    duration: 700,
  })
}

function sharedPinPopup(pin: ScoutPin) {
  const root = document.createElement('article')
  root.className = 'shared-scout-pin-detail'
  const typeLabel = SCOUT_PIN_TYPES.find((type) => type.value === pin.type)?.label ?? 'Pin'

  const eyebrow = document.createElement('small')
  eyebrow.textContent = `${typeLabel} · ${pin.status === 'field' ? 'Field confirmed' : 'E-scouted'}`
  root.append(eyebrow)

  const title = document.createElement('strong')
  title.textContent = pin.title || typeLabel
  root.append(title)

  const details = document.createElement('span')
  details.textContent = `${pin.observationYear} · ${pin.location.latitude.toFixed(5)}, ${pin.location.longitude.toFixed(5)}`
  root.append(details)

  if (pin.notes) {
    const notes = document.createElement('p')
    notes.textContent = pin.notes
    root.append(notes)
  }
  return root
}

function sharedMapStyle(): StyleSpecification {
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
      [SHARED_TERRAIN_SOURCE]: {
        type: 'raster-dem',
        url: 'https://tiles.mapterhorn.com/tilejson.json',
        tileSize: 512,
      },
    },
    layers: [
      { id: SHARED_SATELLITE, type: 'raster', source: 'satellite' },
      {
        id: SHARED_TOPOGRAPHIC,
        type: 'raster',
        source: 'topographic',
        layout: { visibility: 'none' },
      },
      {
        id: SHARED_HILLSHADE,
        type: 'hillshade',
        source: SHARED_TERRAIN_SOURCE,
        paint: {
          'hillshade-exaggeration': 0.34,
          'hillshade-highlight-color': 'rgba(255, 247, 220, 0.68)',
          'hillshade-shadow-color': 'rgba(24, 35, 29, 0.78)',
        },
      },
    ],
    terrain: {
      source: SHARED_TERRAIN_SOURCE,
      exaggeration: 1.2,
    },
  }
}

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { LoaderCircle, MapPinned } from 'lucide-react'
import { estimateP50Draw, opportunityScore } from './drawMetrics'

type PlannerState = 'utah' | 'colorado' | 'idaho' | 'wyoming'
type Residency = 'resident' | 'nonresident'
type MetricMode = 'harvest' | 'draw' | 'opportunity'
type MetricRange = { min: number; max: number } | null

type MapDrawSide = {
  totals: { successRatioValue: number | null } | null
  byPoint: Array<{
    points: number
    eligibleApplicants: number
    totalPermits: number
    successRatioValue: number | null
  }>
}

type MapDrawProfileSide = {
  odds: number | null
  pointTiers: Array<{
    label: string
    odds: number | null
    pool?: string
  }>
}

type MapHunt = {
  id: string
  state?: PlannerState
  huntNumber: string
  huntName: string
  species: string
  mapUnitIds?: string[]
  harvest: { successRate: number } | null
  odds: {
    resident: MapDrawSide
    nonresident: MapDrawSide
  } | null
  drawProfile?: {
    system: 'random' | 'preference-random'
    resident: MapDrawProfileSide | null
    nonresident: MapDrawProfileSide | null
  } | null
}

type BoundaryFeature = {
  id: string
  name: string
  detail?: string | null
  species?: string
  huntNumbers?: string[]
  geometry: {
    type: 'Polygon' | 'MultiPolygon'
    coordinates: number[][][] | number[][][][]
  }
}

type BoundaryData = {
  state: PlannerState
  year: number
  label: string
  sourceUrl: string
  features: BoundaryFeature[]
}

type FeatureSummary = {
  feature: BoundaryFeature
  hunts: MapHunt[]
  value: number | null
}

export function MapExplorer({
  plannerState,
  species,
  category,
  hunts,
  selectedHunt,
  residency,
  onSelect,
  renderHuntPreview,
}: {
  plannerState: PlannerState
  species: string
  category: string
  hunts: MapHunt[]
  selectedHunt: MapHunt | null
  residency: Residency
  onSelect: (hunt: MapHunt) => void
  renderHuntPreview: (hunt: MapHunt) => ReactNode
}) {
  const [data, setData] = useState<BoundaryData | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [metric, setMetric] = useState<MetricMode>('harvest')
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const dataPath = boundaryDataPath(plannerState, species, category)

  useEffect(() => {
    let cancelled = false
    setHoveredId(null)
    if (!dataPath) {
      setData(null)
      setLoadError(false)
      return
    }
    setLoading(true)
    setLoadError(false)
    fetch(dataPath)
      .then((response) => {
        if (!response.ok) throw new Error(`Boundary data ${response.status}`)
        return response.json() as Promise<BoundaryData>
      })
      .then((nextData) => {
        if (!cancelled) setData(nextData)
      })
      .catch(() => {
        if (!cancelled) {
          setData(null)
          setLoadError(true)
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [dataPath])

  const summaries = useMemo(() => {
    if (!data) return []
    return data.features.map((feature) => {
      const matchingHunts = hunts.filter((hunt) => featureMatchesHunt(feature, hunt))
      return {
        feature,
        hunts: matchingHunts,
        value: average(matchingHunts.map((hunt) => metricValue(hunt, metric, residency))),
      }
    })
  }, [data, hunts, metric, residency])

  const matchingSummaries = summaries.filter((summary) => summary.hunts.length > 0)
  const colorRange = metricRange(matchingSummaries.map((summary) => summary.value))
  const legendRange = formatLegendRange(colorRange, metric)
  const selectedSummary = summaries.find((summary) =>
    selectedHunt ? summary.hunts.some((hunt) => hunt.id === selectedHunt.id) : false,
  )
  const activeSummary = summaries.find((summary) => summary.feature.id === hoveredId)
    ?? selectedSummary
    ?? matchingSummaries[0]
    ?? null
  const huntForSummary = (summary: FeatureSummary) =>
    (selectedHunt && summary.hunts.find((hunt) => hunt.id === selectedHunt.id))
    ?? bestHunt(summary.hunts, metric, residency)
  const previewHunt = activeSummary?.hunts[0] ? huntForSummary(activeSummary) : null
  const bounds = useMemo(() => geometryBounds(data?.features ?? []), [data])
  const pathFor = (feature: BoundaryFeature) => geometryPath(feature.geometry, bounds)

  if (!dataPath) {
    return (
      <section className="map-explorer map-unavailable">
        <MapPinned size={20} aria-hidden="true" />
        <div>
          <strong>No matching unit layer yet</strong>
          <span>The official map library does not expose a comparable boundary layer for this species.</span>
        </div>
      </section>
    )
  }

  return (
    <section className="map-explorer" aria-label={`${species} unit map`}>
      <div className="map-explorer-head">
        <div>
          <p className="eyebrow">Unit explorer</p>
          <h2>{species} boundaries</h2>
          <span>{data?.year ?? ''} official agency boundary reference</span>
        </div>
        <div className="map-metric-switch" aria-label="Map color metric">
          <button type="button" className={metric === 'harvest' ? 'active' : ''} onClick={() => setMetric('harvest')}>
            Harvest
          </button>
          <button type="button" className={metric === 'draw' ? 'active' : ''} onClick={() => setMetric('draw')}>
            Draw time
          </button>
          <button type="button" className={metric === 'opportunity' ? 'active' : ''} onClick={() => setMetric('opportunity')}>
            Opportunity
          </button>
        </div>
      </div>

      {loading ? (
        <div className="map-loading"><LoaderCircle className="spin" size={22} /> Loading boundaries</div>
      ) : loadError || !data ? (
        <div className="map-loading">Boundary data could not be loaded.</div>
      ) : (
        <div className="map-explorer-body">
          <div className="map-canvas">
            <svg viewBox="0 0 800 500" role="img" aria-label={`${data.label} colored by ${metricLabel(metric)}`}>
              <g className="map-context">
                {summaries.map((summary) => (
                  <path key={`context-${summary.feature.id}`} d={pathFor(summary.feature)} />
                ))}
              </g>
              <g className="map-active-boundaries">
                {matchingSummaries.map((summary) => {
                  const selected = selectedSummary?.feature.id === summary.feature.id
                  const hovered = hoveredId === summary.feature.id
                  return (
                    <path
                      key={summary.feature.id}
                      d={pathFor(summary.feature)}
                      className={`${selected ? 'selected' : ''} ${hovered ? 'hovered' : ''}`}
                      style={{ fill: mapColor(summary.value, metric, colorRange) }}
                      role="button"
                      tabIndex={0}
                      aria-label={boundaryAria(summary, metric)}
                      onMouseEnter={() => setHoveredId(summary.feature.id)}
                      onMouseLeave={() => setHoveredId(null)}
                      onFocus={() => setHoveredId(summary.feature.id)}
                      onBlur={() => setHoveredId(null)}
                      onClick={() => summary.hunts[0] && onSelect(huntForSummary(summary))}
                      onKeyDown={(event) => {
                        if ((event.key === 'Enter' || event.key === ' ') && summary.hunts[0]) {
                          event.preventDefault()
                          onSelect(huntForSummary(summary))
                        }
                      }}
                    >
                      <title>{boundaryAria(summary, metric)}</title>
                    </path>
                  )
                })}
              </g>
            </svg>
            <div
              className="map-legend"
              aria-label={`${metricLabel(metric)} legend from ${legendRange.start} to ${legendRange.end}`}
            >
              <span>{legendRange.start}</span>
              <i />
              <span>{legendRange.end}</span>
            </div>
          </div>

          <div className="map-summary" aria-live="polite">
            {activeSummary && previewHunt ? (
              <>
                <div className="map-preview-heading">
                  <div>
                    <p className="eyebrow">{activeSummary.feature.detail || `Unit ${activeSummary.feature.id}`}</p>
                    <h3>{activeSummary.feature.name}</h3>
                  </div>
                  <strong>{formatMetricValue(activeSummary.value, metric)}</strong>
                </div>
                <div className="map-preview-card">
                  {renderHuntPreview(previewHunt)}
                </div>
                <span>{activeSummary.hunts.length} matching {activeSummary.hunts.length === 1 ? 'hunt' : 'hunt seasons'} in this boundary</span>
              </>
            ) : (
              <>
                <h3>No mapped matches</h3>
                <span>Try a broader hunt type or weapon filter.</span>
              </>
            )}
            <small>Hover or tap a highlighted boundary to preview its matching hunts.</small>
          </div>
        </div>
      )}
    </section>
  )
}

function boundaryDataPath(state: PlannerState, species: string, category: string) {
  if (state === 'utah') return '/data/boundaries/utah.json'
  if (state === 'colorado') return '/data/boundaries/colorado.json'
  if (state === 'idaho') {
    return category === 'limited-entry' || category === 'antlerless'
      ? '/data/boundaries/idaho-controlled.json'
      : '/data/boundaries/idaho-general.json'
  }
  if (state === 'wyoming') {
    const key = ({
      Pronghorn: 'pronghorn',
      Deer: 'deer',
      Elk: 'elk',
      Moose: 'moose',
      'Bighorn Sheep': 'bighorn-sheep',
      'Mountain Goat': 'mountain-goat',
    } as Record<string, string>)[species]
    return key
      ? `/data/boundaries/wyoming-${key}.json`
      : null
  }
  return null
}

function featureMatchesHunt(feature: BoundaryFeature, hunt: MapHunt) {
  if (feature.species && feature.species !== hunt.species) return false
  if (feature.huntNumbers?.includes(hunt.huntNumber)) return true
  if (hunt.mapUnitIds?.some((id) => normalizeUnit(id) === normalizeUnit(feature.id))) return true
  if (hunt.state === 'colorado') return normalizeUnit(hunt.huntNumber.slice(2, 5)) === normalizeUnit(feature.id)
  return false
}

function metricValue(hunt: MapHunt, metric: MetricMode, residency: Residency) {
  if (metric === 'harvest') return hunt.harvest?.successRate ?? null
  if (metric === 'draw') return estimateP50Draw(hunt, residency)?.years ?? null
  return opportunityScore(hunt, residency)
}

function bestHunt(hunts: MapHunt[], metric: MetricMode, residency: Residency) {
  return [...hunts].sort((a, b) => {
    const aValue = metricValue(a, metric, residency)
    const bValue = metricValue(b, metric, residency)
    if (metric === 'draw') return (aValue ?? Infinity) - (bValue ?? Infinity)
    return (bValue ?? -1) - (aValue ?? -1)
  })[0]
}

function boundaryAria(summary: FeatureSummary, metric: MetricMode) {
  return `${summary.feature.name}, ${formatMetricValue(summary.value, metric)}, ${summary.hunts.length} matching hunts`
}

function geometryBounds(features: BoundaryFeature[]) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const feature of features) {
    visitCoordinates(feature.geometry.coordinates, ([x, y]) => {
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    })
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : { minX: 0, minY: 0, maxX: 1, maxY: 1 }
}

function geometryPath(geometry: BoundaryFeature['geometry'], bounds: ReturnType<typeof geometryBounds>) {
  const polygons = geometry.type === 'Polygon'
    ? [geometry.coordinates as number[][][]]
    : geometry.coordinates as number[][][][]
  const width = bounds.maxX - bounds.minX || 1
  const height = bounds.maxY - bounds.minY || 1
  const padding = 18
  const scale = Math.min((800 - padding * 2) / width, (500 - padding * 2) / height)
  const xOffset = (800 - width * scale) / 2
  const yOffset = (500 - height * scale) / 2
  return polygons.map((polygon) => polygon.map((ring) => ring.map(([x, y], index) => {
    const px = xOffset + (x - bounds.minX) * scale
    const py = 500 - (yOffset + (y - bounds.minY) * scale)
    return `${index === 0 ? 'M' : 'L'}${px.toFixed(1)},${py.toFixed(1)}`
  }).join(' ') + ' Z').join(' ')).join(' ')
}

function visitCoordinates(value: unknown, visitor: (coordinate: [number, number]) => void) {
  if (!Array.isArray(value)) return
  if (typeof value[0] === 'number' && typeof value[1] === 'number') {
    visitor(value as [number, number])
    return
  }
  value.forEach((item) => visitCoordinates(item, visitor))
}

function average(values: Array<number | null>) {
  const present = values.filter((value): value is number => value !== null && Number.isFinite(value))
  return present.length > 0 ? present.reduce((sum, value) => sum + value, 0) / present.length : null
}

function metricRange(values: Array<number | null>): MetricRange {
  const present = values.filter((value): value is number => value !== null && Number.isFinite(value))
  return present.length > 0 ? { min: Math.min(...present), max: Math.max(...present) } : null
}

function mapColor(value: number | null, metric: MetricMode, range: MetricRange) {
  if (value === null) return '#cfd8d0'
  if (!range || range.max === range.min) return interpolateMapColor(0.5)

  const normalized = (value - range.min) / (range.max - range.min)
  return interpolateMapColor(metric === 'draw' ? 1 - normalized : normalized)
}

function interpolateMapColor(value: number) {
  const stops = [
    [214, 184, 94],
    [141, 174, 120],
    [75, 139, 103],
    [33, 102, 79],
  ]
  const position = Math.max(0, Math.min(1, value)) * (stops.length - 1)
  const lowerIndex = Math.floor(position)
  const upperIndex = Math.min(stops.length - 1, lowerIndex + 1)
  const mix = position - lowerIndex
  const channels = stops[lowerIndex].map((channel, index) =>
    Math.round(channel + (stops[upperIndex][index] - channel) * mix),
  )
  return `rgb(${channels.join(', ')})`
}

function formatLegendRange(range: MetricRange, metric: MetricMode) {
  if (!range) return { start: 'No data', end: 'No data' }
  if (metric === 'draw') {
    return { start: formatDrawYears(range.max), end: formatDrawYears(range.min) }
  }
  if (metric === 'opportunity') {
    return { start: formatRangeNumber(range.min), end: formatRangeNumber(range.max) }
  }
  return { start: formatPercent(range.min), end: formatPercent(range.max) }
}

function formatRangeNumber(value: number) {
  return value.toFixed(Number.isInteger(value) ? 0 : 1)
}

function formatDrawYears(value: number) {
  return `${formatRangeNumber(value)} ${value === 1 ? 'yr' : 'yrs'}`
}

function metricLabel(metric: MetricMode) {
  if (metric === 'draw') return 'estimated P50 draw time'
  if (metric === 'opportunity') return 'opportunity score'
  return 'harvest percentage'
}

function formatMetricValue(value: number | null, metric: MetricMode) {
  if (value === null) return `No ${metricLabel(metric)}`
  if (metric === 'draw') return `${value.toFixed(1)} yrs P50`
  if (metric === 'opportunity') return `${value.toFixed(1)} Opportunity`
  return `${formatPercent(value)} Harvest`
}

function normalizeUnit(value: string) {
  return String(Number(value)) === value || /^0*\d+$/.test(value) ? String(Number(value)) : value.toLowerCase().trim()
}

function formatPercent(value: number) {
  return `${value.toFixed(value >= 10 ? 0 : 1)}%`
}

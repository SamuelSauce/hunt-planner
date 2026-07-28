import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { LoaderCircle, MapPinned } from 'lucide-react'
import { estimateP50Draw, opportunityScore } from './drawMetrics'
import {
  geometryArea,
  geometryContainsCoordinate,
  svgPointToCoordinate,
} from './mapGeometry'

export type PlannerState = 'utah' | 'colorado' | 'idaho' | 'wyoming'
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

export type MapHunt = {
  id: string
  state?: PlannerState
  huntNumber: string
  huntName: string
  species: string
  planningYear?: number | null
  seasonDateText?: string | null
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

export type BoundaryFeature = {
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

export type BoundaryData = {
  state: PlannerState
  year: number
  label: string
  sourceUrl: string
  features: BoundaryFeature[]
}

type FeatureSummary = {
  feature: BoundaryFeature
  hunts: MapHunt[]
  representativeHunt: MapHunt | null
  value: number | null
  area: number
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
  const [hoveredIds, setHoveredIds] = useState<string[]>([])
  const [overlapIds, setOverlapIds] = useState<string[]>([])
  const boundaryPlanningYear = mostCommonPlanningYear(hunts)
  const dataPath = boundaryDataPath(
    plannerState,
    species,
    category,
    boundaryPlanningYear,
  )

  useEffect(() => {
    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Clear prior pointer state when the boundary source changes.
    setHoveredIds([])
    setOverlapIds([])
    if (!dataPath) {
      setData(null)
      setLoadError(false)
      return
    }
    setLoading(true)
    setLoadError(false)
    fetch(dataPath, { cache: 'no-store' })
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
      const mappedSelectedHunt = selectedHunt
        ? matchingHunts.find((hunt) => hunt.id === selectedHunt.id) ?? null
        : null
      const representativeHunt =
        mappedSelectedHunt ?? bestHunt(matchingHunts, metric, residency) ?? null
      return {
        feature,
        hunts: matchingHunts,
        representativeHunt,
        value: representativeHunt ? metricValue(representativeHunt, metric, residency) : null,
        area: geometryArea(feature.geometry),
      }
    })
  }, [data, hunts, metric, residency, selectedHunt])

  const matchingSummaries = summaries.filter((summary) => summary.hunts.length > 0)
  const colorRange = metricRange(matchingSummaries.map((summary) => summary.value))
  const legendRange = formatLegendRange(colorRange, metric)
  const selectedSummary = summaries.find((summary) =>
    selectedHunt ? summary.hunts.some((hunt) => hunt.id === selectedHunt.id) : false,
  )
  const hoveredSummaries = prioritizeSummaries(
    summariesForIds(matchingSummaries, hoveredIds),
    selectedHunt,
  )
  const overlapSummaries = prioritizeSummaries(
    summariesForIds(matchingSummaries, overlapIds),
    selectedHunt,
  )
  const layerSummaries = [...matchingSummaries]
    .sort((a, b) => compareSummaryPriority(b, a, selectedHunt))
  const activeSummary = hoveredSummaries[0]
    ?? selectedSummary
    ?? matchingSummaries[0]
    ?? null
  const previewHunt = activeSummary?.representativeHunt ?? null
  const bounds = useMemo(() => geometryBounds(data?.features ?? []), [data])
  const pathFor = (feature: BoundaryFeature) => geometryPath(feature.geometry, bounds)
  const updateMapPointer = (
    clientX: number,
    clientY: number,
    svg: SVGSVGElement,
  ) => {
    const screenMatrix = svg.getScreenCTM()
    if (!screenMatrix) return
    const svgPoint = new DOMPoint(clientX, clientY).matrixTransform(screenMatrix.inverse())
    const coordinate = svgPointToCoordinate(svgPoint, bounds)
    const hitSummaries = prioritizeSummaries(
      matchingSummaries.filter((summary) => (
        geometryContainsCoordinate(summary.feature.geometry, coordinate)
      )),
      selectedHunt,
    )
    const nextIds = hitSummaries.map((summary) => summary.feature.id)
    setHoveredIds((currentIds) => sameIds(currentIds, nextIds) ? currentIds : nextIds)
    const nextOverlapIds = nextIds.length > 1 ? nextIds : []
    setOverlapIds((currentIds) => (
      sameIds(currentIds, nextOverlapIds) ? currentIds : nextOverlapIds
    ))
  }

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
            <svg
              viewBox="0 0 800 500"
              role="img"
              aria-label={`${data.label} colored by ${metricLabel(metric)}`}
              onMouseMove={(event) => (
                updateMapPointer(event.clientX, event.clientY, event.currentTarget)
              )}
              onPointerDown={(event) => (
                updateMapPointer(event.clientX, event.clientY, event.currentTarget)
              )}
            >
              <g className="map-context">
                {summaries.map((summary) => (
                  <path key={`context-${summary.feature.id}`} d={pathFor(summary.feature)} />
                ))}
              </g>
              <g className="map-active-boundaries">
                {layerSummaries.map((summary) => {
                  const selected = selectedSummary?.feature.id === summary.feature.id
                  const hovered = hoveredIds.includes(summary.feature.id)
                  const primaryHovered = activeSummary?.feature.id === summary.feature.id
                  const overlapCount = hovered ? hoveredIds.length : 1
                  return (
                    <path
                      key={summary.feature.id}
                      d={pathFor(summary.feature)}
                      className={`${selected ? 'selected' : ''} ${hovered ? 'hovered' : ''} ${primaryHovered ? 'primary-hover' : ''}`}
                      style={{ fill: mapColor(summary.value, metric, colorRange) }}
                      role="button"
                      tabIndex={0}
                      aria-label={boundaryAria(summary, metric, overlapCount)}
                      onFocus={() => {
                        setHoveredIds([summary.feature.id])
                        setOverlapIds([])
                      }}
                      onBlur={() => setHoveredIds([])}
                      onClick={() => summary.representativeHunt && onSelect(summary.representativeHunt)}
                      onKeyDown={(event) => {
                        if ((event.key === 'Enter' || event.key === ' ') && summary.representativeHunt) {
                          event.preventDefault()
                          onSelect(summary.representativeHunt)
                        }
                      }}
                    >
                      <title>{boundaryAria(summary, metric, overlapCount)}</title>
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
            {overlapSummaries.length > 1 && (
              <div
                className="map-overlap-picker"
                aria-label={`${overlapSummaries.length} overlapping hunt areas`}
              >
                <div className="map-overlap-heading">
                  <strong>{overlapSummaries.length} overlapping hunt areas</strong>
                  <span>Choose a season to bring its boundary forward.</span>
                </div>
                <div className="map-overlap-list">
                  {overlapSummaries.map((summary) => (
                    <div className="map-overlap-area" key={summary.feature.id}>
                      <div className="map-overlap-area-heading">
                        <span>{summary.feature.name}</span>
                        <small>{summary.feature.detail || `Unit ${summary.feature.id}`}</small>
                      </div>
                      <div className="map-overlap-hunts">
                        {sortHuntsForPicker(summary.hunts).map((hunt) => {
                          const active = previewHunt?.id === hunt.id
                          return (
                            <button
                              type="button"
                              key={hunt.id}
                              className={active ? 'active' : ''}
                              aria-pressed={active}
                              onClick={() => onSelect(hunt)}
                            >
                              <strong>{hunt.huntNumber}</strong>
                              <span>{hunt.seasonDateText || hunt.huntName}</span>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
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
                <span>Try a broader hunt type, weapon, or season filter.</span>
              </>
            )}
            <small>Hover or tap a highlighted boundary to preview it. Choose from the overlap list when hunt areas stack.</small>
          </div>
        </div>
      )}
    </section>
  )
}

// eslint-disable-next-line react-refresh/only-export-components -- Shared pure map helper.
export function boundaryDataPath(
  state: PlannerState,
  species: string,
  category: string,
  planningYear: number | null = null,
) {
  if (state === 'utah') {
    return species === 'Elk' && category === 'antlerless'
      ? `/data/boundaries/utah-antlerless-${planningYear ?? 2026}.json`
      : '/data/boundaries/utah.json'
  }
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

function mostCommonPlanningYear(hunts: MapHunt[]) {
  const counts = new Map<number, number>()
  for (const hunt of hunts) {
    if (!hunt.planningYear) continue
    counts.set(hunt.planningYear, (counts.get(hunt.planningYear) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort(([yearA, countA], [yearB, countB]) => countB - countA || yearB - yearA)[0]?.[0]
    ?? null
}

// eslint-disable-next-line react-refresh/only-export-components -- Shared pure map helper.
export function featureMatchesHunt(feature: BoundaryFeature, hunt: MapHunt) {
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
    if (metric === 'harvest') {
      const drawDataDifference =
        Number(Boolean(b.odds || b.drawProfile)) - Number(Boolean(a.odds || a.drawProfile))
      if (drawDataDifference !== 0) return drawDataDifference
    }
    const aValue = metricValue(a, metric, residency)
    const bValue = metricValue(b, metric, residency)
    if (metric === 'draw') return (aValue ?? Infinity) - (bValue ?? Infinity)
    return (bValue ?? -1) - (aValue ?? -1)
  })[0]
}

function summariesForIds(summaries: FeatureSummary[], ids: string[]) {
  return ids
    .map((id) => summaries.find((summary) => summary.feature.id === id))
    .filter((summary): summary is FeatureSummary => Boolean(summary))
}

function prioritizeSummaries(
  summaries: FeatureSummary[],
  selectedHunt: MapHunt | null,
) {
  return [...summaries].sort((a, b) => compareSummaryPriority(a, b, selectedHunt))
}

function compareSummaryPriority(
  a: FeatureSummary,
  b: FeatureSummary,
  selectedHunt: MapHunt | null,
) {
  const aSelected = selectedHunt
    ? a.hunts.some((hunt) => hunt.id === selectedHunt.id)
    : false
  const bSelected = selectedHunt
    ? b.hunts.some((hunt) => hunt.id === selectedHunt.id)
    : false
  if (aSelected !== bSelected) return aSelected ? -1 : 1
  if (a.area !== b.area) return a.area - b.area

  const seasonDifference = earliestSeasonStart(a.hunts) - earliestSeasonStart(b.hunts)
  if (seasonDifference !== 0) return seasonDifference
  const aHuntNumber = sortHuntsForPicker(a.hunts)[0]?.huntNumber ?? ''
  const bHuntNumber = sortHuntsForPicker(b.hunts)[0]?.huntNumber ?? ''
  return aHuntNumber.localeCompare(bHuntNumber) || a.feature.id.localeCompare(b.feature.id)
}

function sortHuntsForPicker(hunts: MapHunt[]) {
  return [...hunts].sort((a, b) => (
    seasonStart(a) - seasonStart(b)
    || a.huntNumber.localeCompare(b.huntNumber)
  ))
}

function earliestSeasonStart(hunts: MapHunt[]) {
  return Math.min(...hunts.map(seasonStart), Infinity)
}

function seasonStart(hunt: MapHunt) {
  const startText = hunt.seasonDateText?.split(' - ')[0]
  const timestamp = startText ? Date.parse(startText) : Number.NaN
  return Number.isFinite(timestamp) ? timestamp : Infinity
}

function sameIds(a: string[], b: string[]) {
  return a.length === b.length && a.every((id, index) => id === b[index])
}

function boundaryAria(
  summary: FeatureSummary,
  metric: MetricMode,
  overlapCount = 1,
) {
  const overlapText = overlapCount > 1
    ? `, ${overlapCount} overlapping hunt areas`
    : ''
  return `${summary.feature.name}, ${formatMetricValue(summary.value, metric)}${overlapText}, ${summary.hunts.length} matching hunts`
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

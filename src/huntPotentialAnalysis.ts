import type { Map as MapLibreMap } from 'maplibre-gl'
import type { FeatureCollection, Point } from 'geojson'
import type { BoundaryFeature, MapHunt } from './MapExplorer'

type Coordinate = [number, number]

type TerrainSample = {
  coordinate: Coordinate
  elevationMeters: number
  roughnessMeters: number
  relativeElevation: number
  score: number
}

type SpeciesProfile = {
  label: string
  elevationTarget: number
  roughnessTarget: number
  terrainSignal: string
  highPotentialReason: string
  lowPotentialReason: string
}

export type PotentialZone = {
  rank: number
  score: number
  coordinate: Coordinate
  elevationFeet: number
  terrain: string
  location: string
  reason: string
}

export type HuntPotentialAnalysis = {
  points: FeatureCollection<Point>
  hotspots: FeatureCollection<Point>
  zones: PotentialZone[]
  summary: string
  signals: string[]
  confidence: 'Exploratory' | 'Moderate'
}

const profiles: Array<[RegExp, SpeciesProfile]> = [
  [
    /pronghorn|antelope/i,
    {
      label: 'pronghorn',
      elevationTarget: 0.34,
      roughnessTarget: 0.1,
      terrainSignal: 'lower, gentler terrain',
      highPotentialReason: 'The broad, gentler ground is more consistent with open-country movement and glassing.',
      lowPotentialReason: 'The lower relative elevation avoids the roughest relief in this unit.',
    },
  ],
  [
    /mountain goat|goat/i,
    {
      label: 'mountain goat',
      elevationTarget: 0.88,
      roughnessTarget: 0.9,
      terrainSignal: 'the highest, steepest relief',
      highPotentialReason: 'High relative elevation and sharp relief match classic escape and bedding terrain.',
      lowPotentialReason: 'This zone remains high in the unit while offering slightly less severe approaches.',
    },
  ],
  [
    /bighorn|sheep/i,
    {
      label: 'bighorn sheep',
      elevationTarget: 0.76,
      roughnessTarget: 0.82,
      terrainSignal: 'high, broken escape terrain',
      highPotentialReason: 'The combination of elevation and broken relief can provide visibility and nearby escape terrain.',
      lowPotentialReason: 'This shoulder sits near steep relief without occupying the most severe ground.',
    },
  ],
  [
    /moose/i,
    {
      label: 'moose',
      elevationTarget: 0.46,
      roughnessTarget: 0.25,
      terrainSignal: 'gentler mid-elevation benches and drainages',
      highPotentialReason: 'Moderate elevation and gentler relief can indicate drainage bottoms, benches, and feeding areas.',
      lowPotentialReason: 'The model favors accessible, lower-gradient terrain over exposed high points.',
    },
  ],
  [
    /elk/i,
    {
      label: 'elk',
      elevationTarget: 0.66,
      roughnessTarget: 0.56,
      terrainSignal: 'upper-middle elevation with broken relief',
      highPotentialReason: 'Upper-middle elevation and terrain breaks can connect feeding, bedding, and escape cover.',
      lowPotentialReason: 'This zone offers moderate relief near stronger terrain transitions.',
    },
  ],
  [
    /mule deer|deer/i,
    {
      label: 'deer',
      elevationTarget: 0.58,
      roughnessTarget: 0.48,
      terrainSignal: 'mid-to-upper elevation with terrain transitions',
      highPotentialReason: 'Broken mid-to-upper terrain can create bedding pockets, travel edges, and glassing opportunities.',
      lowPotentialReason: 'The terrain transition is more meaningful here than raw elevation alone.',
    },
  ],
  [
    /bison/i,
    {
      label: 'bison',
      elevationTarget: 0.44,
      roughnessTarget: 0.24,
      terrainSignal: 'broad, moderate-elevation terrain',
      highPotentialReason: 'Gentler, connected ground can support travel between feeding and resting areas.',
      lowPotentialReason: 'The model avoids isolated high relief in favor of broader terrain.',
    },
  ],
]

const fallbackProfile: SpeciesProfile = {
  label: 'big game',
  elevationTarget: 0.56,
  roughnessTarget: 0.48,
  terrainSignal: 'terrain transitions near the unit’s middle elevations',
  highPotentialReason: 'The mix of elevation and broken relief makes this a useful terrain transition to investigate.',
  lowPotentialReason: 'This location balances relief and relative elevation within the hunt boundary.',
}

export function buildHuntPotentialAnalysis(
  map: MapLibreMap,
  boundaryFeatures: BoundaryFeature[],
  hunt: MapHunt & { weapon: string; seasonDateText: string | null },
): HuntPotentialAnalysis | null {
  const bounds = featureBounds(boundaryFeatures)
  if (!bounds) return null

  const profile = speciesProfile(hunt.species)
  const seasonAdjustment = elevationSeasonAdjustment(hunt.seasonDateText)
  const targetElevation = clamp(profile.elevationTarget + seasonAdjustment, 0.12, 0.92)
  const coordinates = sampleCoordinates(boundaryFeatures, bounds)
  const rawSamples = coordinates
    .map((coordinate) => terrainSample(map, coordinate, bounds))
    .filter((sample): sample is Omit<TerrainSample, 'relativeElevation' | 'score'> => sample !== null)

  if (rawSamples.length < 8) return null

  const elevations = rawSamples.map((sample) => sample.elevationMeters)
  const minElevation = Math.min(...elevations)
  const maxElevation = Math.max(...elevations)
  const elevationSpan = Math.max(maxElevation - minElevation, 1)
  const maxRoughness = Math.max(...rawSamples.map((sample) => sample.roughnessMeters), 80)

  const samples: TerrainSample[] = rawSamples.map((sample) => {
    const relativeElevation = (sample.elevationMeters - minElevation) / elevationSpan
    const roughness = clamp(sample.roughnessMeters / Math.min(maxRoughness, 320), 0, 1)
    const elevationFit = 1 - Math.min(1, Math.abs(relativeElevation - targetElevation) / 0.58)
    const roughnessFit = 1 - Math.min(1, Math.abs(roughness - profile.roughnessTarget) / 0.72)
    const transitionBonus = clamp(sample.roughnessMeters / 210, 0, 1)
    const score = Math.round(clamp(28 + elevationFit * 31 + roughnessFit * 22 + transitionBonus * 6, 32, 89))

    return { ...sample, relativeElevation, score }
  })

  const hotspots = selectSeparatedHotspots(samples, bounds, 3)
  if (hotspots.length === 0) return null

  const center: Coordinate = [
    (bounds[0][0] + bounds[1][0]) / 2,
    (bounds[0][1] + bounds[1][1]) / 2,
  ]
  const zones = hotspots.map((sample, index): PotentialZone => {
    const terrain = terrainLabel(sample.roughnessMeters)
    return {
      rank: index + 1,
      score: sample.score,
      coordinate: sample.coordinate,
      elevationFeet: Math.round(sample.elevationMeters * 3.28084 / 50) * 50,
      terrain,
      location: relativeLocation(sample.coordinate, center),
      reason: sample.relativeElevation >= targetElevation
        ? profile.highPotentialReason
        : profile.lowPotentialReason,
    }
  })

  const topElevations = zones.map((zone) => zone.elevationFeet)
  const elevationBand = `${Math.min(...topElevations).toLocaleString()}–${Math.max(...topElevations).toLocaleString()} ft`
  const seasonSignal = seasonReason(hunt.seasonDateText, seasonAdjustment)
  const weaponSignal = weaponReason(hunt.weapon)
  const harvestSignal = hunt.harvest
    ? `Historical hunt-wide success is ${hunt.harvest.successRate.toFixed(0)}%; it adds context, but does not place animals on the map.`
    : 'No hunt-wide harvest rate is available, so the overlay is driven entirely by terrain context.'

  return {
    points: {
      type: 'FeatureCollection',
      features: samples
        .filter((sample) => sample.score >= 58)
        .map((sample) => ({
          type: 'Feature',
          properties: { score: sample.score },
          geometry: { type: 'Point', coordinates: sample.coordinate },
        })),
    },
    hotspots: {
      type: 'FeatureCollection',
      features: zones.map((zone) => ({
        type: 'Feature',
        properties: {
          rank: zone.rank,
          score: zone.score,
          elevationFeet: zone.elevationFeet,
          terrain: zone.terrain,
          location: zone.location,
          reason: zone.reason,
        },
        geometry: { type: 'Point', coordinates: zone.coordinate },
      })),
    },
    zones,
    summary: `The terrain model favors ${profile.terrainSignal} for this ${profile.label} hunt. Start with the numbered zones, then verify cover, water, access, pressure, and current conditions.`,
    signals: [
      `${elevationBand} is the strongest elevation band in the three highlighted zones.`,
      seasonSignal,
      weaponSignal,
      harvestSignal,
    ],
    confidence: rawSamples.length >= 30 && elevationSpan >= 120 ? 'Moderate' : 'Exploratory',
  }
}

function terrainSample(
  map: MapLibreMap,
  coordinate: Coordinate,
  bounds: [Coordinate, Coordinate],
): Omit<TerrainSample, 'relativeElevation' | 'score'> | null {
  const elevationMeters = map.queryTerrainElevation(coordinate)
  if (elevationMeters === null || !Number.isFinite(elevationMeters)) return null

  const latitudeRadians = coordinate[1] * Math.PI / 180
  const longitudeSpanMeters = Math.max(
    (bounds[1][0] - bounds[0][0]) * 111_320 * Math.cos(latitudeRadians),
    1,
  )
  const latitudeSpanMeters = Math.max((bounds[1][1] - bounds[0][1]) * 110_540, 1)
  const sampleDistance = clamp(Math.min(longitudeSpanMeters, latitudeSpanMeters) / 28, 180, 650)
  const longitudeOffset = sampleDistance / (111_320 * Math.max(Math.cos(latitudeRadians), 0.2))
  const latitudeOffset = sampleDistance / 110_540
  const neighborElevations = [
    map.queryTerrainElevation([coordinate[0] + longitudeOffset, coordinate[1]]),
    map.queryTerrainElevation([coordinate[0] - longitudeOffset, coordinate[1]]),
    map.queryTerrainElevation([coordinate[0], coordinate[1] + latitudeOffset]),
    map.queryTerrainElevation([coordinate[0], coordinate[1] - latitudeOffset]),
  ].filter((value): value is number => value !== null && Number.isFinite(value))

  const roughnessMeters = neighborElevations.length
    ? Math.max(...neighborElevations, elevationMeters) - Math.min(...neighborElevations, elevationMeters)
    : 0

  return { coordinate, elevationMeters, roughnessMeters }
}

function sampleCoordinates(
  features: BoundaryFeature[],
  bounds: [Coordinate, Coordinate],
): Coordinate[] {
  const [west, south] = bounds[0]
  const [east, north] = bounds[1]
  const coordinates: Coordinate[] = []
  const gridSize = 17

  for (let row = 0; row < gridSize; row += 1) {
    for (let column = 0; column < gridSize; column += 1) {
      const longitude = west + ((column + 0.5) / gridSize) * (east - west)
      const latitude = south + ((row + 0.5) / gridSize) * (north - south)
      const coordinate: Coordinate = [longitude, latitude]
      if (features.some((feature) => pointInGeometry(coordinate, feature.geometry))) {
        coordinates.push(coordinate)
      }
    }
  }

  return coordinates
}

function selectSeparatedHotspots(
  samples: TerrainSample[],
  bounds: [Coordinate, Coordinate],
  count: number,
) {
  const sorted = [...samples].sort((a, b) => b.score - a.score)
  const diagonal = Math.hypot(bounds[1][0] - bounds[0][0], bounds[1][1] - bounds[0][1])
  const minimumSeparation = diagonal / 5.5
  const selected: TerrainSample[] = []

  for (const sample of sorted) {
    if (selected.every((candidate) => coordinateDistance(candidate.coordinate, sample.coordinate) >= minimumSeparation)) {
      selected.push(sample)
    }
    if (selected.length === count) break
  }

  return selected.length >= Math.min(count, sorted.length)
    ? selected
    : sorted.slice(0, count)
}

function pointInGeometry(
  point: Coordinate,
  geometry: BoundaryFeature['geometry'],
) {
  if (geometry.type === 'Polygon') {
    return pointInPolygon(point, geometry.coordinates as number[][][])
  }
  return (geometry.coordinates as number[][][][]).some((polygon) => pointInPolygon(point, polygon))
}

function pointInPolygon(point: Coordinate, rings: number[][][]) {
  if (!rings.length || !pointInRing(point, rings[0])) return false
  return !rings.slice(1).some((hole) => pointInRing(point, hole))
}

function pointInRing([longitude, latitude]: Coordinate, ring: number[][]) {
  let inside = false
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const [currentLongitude, currentLatitude] = ring[index]
    const [previousLongitude, previousLatitude] = ring[previous]
    const crosses = (currentLatitude > latitude) !== (previousLatitude > latitude)
      && longitude < ((previousLongitude - currentLongitude) * (latitude - currentLatitude))
        / (previousLatitude - currentLatitude) + currentLongitude
    if (crosses) inside = !inside
  }
  return inside
}

function featureBounds(features: BoundaryFeature[]): [Coordinate, Coordinate] | null {
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
      ;(feature.geometry.coordinates as number[][][]).forEach((ring) => ring.forEach(extend))
    } else {
      ;(feature.geometry.coordinates as number[][][][]).forEach((polygon) =>
        polygon.forEach((ring) => ring.forEach(extend)),
      )
    }
  })

  return Number.isFinite(west) ? [[west, south], [east, north]] : null
}

function speciesProfile(species: string) {
  return profiles.find(([pattern]) => pattern.test(species))?.[1] ?? fallbackProfile
}

function elevationSeasonAdjustment(seasonDateText: string | null) {
  const month = seasonMonth(seasonDateText)
  if (month === null) return 0
  if (month <= 9) return 0.08
  if (month >= 11 || month <= 2) return -0.14
  return -0.04
}

function seasonReason(seasonDateText: string | null, adjustment: number) {
  if (!seasonDateText) {
    return 'Season timing is not listed, so no seasonal elevation shift was applied.'
  }
  if (adjustment > 0) {
    return `${seasonDateText} is treated as earlier-season timing, nudging potential toward higher relative elevation.`
  }
  if (adjustment < -0.1) {
    return `${seasonDateText} is treated as later-season timing, nudging potential toward lower relative elevation.`
  }
  return `${seasonDateText} applies a small downward elevation adjustment for fall movement.`
}

function weaponReason(weapon: string) {
  if (/archery|bow/i.test(weapon)) {
    return 'For archery, the model emphasizes terrain transitions that may help close distance; wind and approach still need field checks.'
  }
  if (/muzzle/i.test(weapon)) {
    return 'For muzzleloader, the highlighted zones balance broken relief with practical sight lines.'
  }
  if (/rifle|any weapon/i.test(weapon)) {
    return 'For this weapon, the highlighted terrain offers a mix of glassing position and nearby relief.'
  }
  return 'Weapon data does not materially change the terrain score; use the overlay as a starting point for hunt-specific tactics.'
}

function seasonMonth(seasonDateText: string | null) {
  if (!seasonDateText) return null
  const monthNames = [
    'jan', 'feb', 'mar', 'apr', 'may', 'jun',
    'jul', 'aug', 'sep', 'oct', 'nov', 'dec',
  ]
  const lowered = seasonDateText.toLowerCase()
  const index = monthNames.findIndex((month) => lowered.includes(month))
  return index === -1 ? null : index + 1
}

function terrainLabel(roughnessMeters: number) {
  if (roughnessMeters >= 170) return 'steep, broken relief'
  if (roughnessMeters >= 80) return 'moderately broken relief'
  if (roughnessMeters >= 35) return 'rolling terrain'
  return 'gentle terrain'
}

function relativeLocation(coordinate: Coordinate, center: Coordinate) {
  const vertical = coordinate[1] > center[1] ? 'north' : 'south'
  const horizontal = coordinate[0] > center[0] ? 'east' : 'west'
  const latitudeDelta = Math.abs(coordinate[1] - center[1])
  const longitudeDelta = Math.abs(coordinate[0] - center[0])
  if (latitudeDelta > longitudeDelta * 1.7) return vertical
  if (longitudeDelta > latitudeDelta * 1.7) return horizontal
  return `${vertical}${horizontal}`
}

function coordinateDistance(a: Coordinate, b: Coordinate) {
  return Math.hypot(a[0] - b[0], a[1] - b[1])
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value))
}

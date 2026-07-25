export type PolygonGeometry = {
  type: 'Polygon' | 'MultiPolygon'
  coordinates: number[][][] | number[][][][]
}

export type GeometryBounds = {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export type SvgPoint = {
  x: number
  y: number
}

export function geometryArea(geometry: PolygonGeometry) {
  const polygons = geometry.type === 'Polygon'
    ? [geometry.coordinates as number[][][]]
    : geometry.coordinates as number[][][][]
  return polygons.reduce((total, polygon) => {
    const [outerRing, ...holes] = polygon
    const outerArea = ringArea(outerRing ?? [])
    const holesArea = holes.reduce((sum, ring) => sum + ringArea(ring), 0)
    return total + Math.max(0, outerArea - holesArea)
  }, 0)
}

export function geometryContainsCoordinate(
  geometry: PolygonGeometry,
  coordinate: [number, number],
) {
  const polygons = geometry.type === 'Polygon'
    ? [geometry.coordinates as number[][][]]
    : geometry.coordinates as number[][][][]
  return polygons.some(([outerRing, ...holes]) => (
    Boolean(outerRing)
    && ringContainsCoordinate(outerRing, coordinate)
    && !holes.some((ring) => ringContainsCoordinate(ring, coordinate))
  ))
}

export function svgPointToCoordinate(
  point: SvgPoint,
  bounds: GeometryBounds,
): [number, number] {
  const width = bounds.maxX - bounds.minX || 1
  const height = bounds.maxY - bounds.minY || 1
  const padding = 18
  const scale = Math.min((800 - padding * 2) / width, (500 - padding * 2) / height)
  const xOffset = (800 - width * scale) / 2
  const yOffset = (500 - height * scale) / 2
  return [
    bounds.minX + (point.x - xOffset) / scale,
    bounds.minY + ((500 - point.y) - yOffset) / scale,
  ]
}

function ringArea(ring: number[][]) {
  let area = 0
  for (let index = 0; index < ring.length; index += 1) {
    const current = ring[index]
    const next = ring[(index + 1) % ring.length]
    if (!current || !next) continue
    area += current[0] * next[1] - next[0] * current[1]
  }
  return Math.abs(area) / 2
}

function ringContainsCoordinate(
  ring: number[][],
  [x, y]: [number, number],
) {
  let inside = false
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const currentPoint = ring[index]
    const previousPoint = ring[previous]
    if (!currentPoint || !previousPoint) continue
    const [currentX, currentY] = currentPoint
    const [previousX, previousY] = previousPoint
    const crosses = (currentY > y) !== (previousY > y)
      && x < ((previousX - currentX) * (y - currentY)) / (previousY - currentY) + currentX
    if (crosses) inside = !inside
  }
  return inside
}

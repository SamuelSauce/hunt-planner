export type MapPinLocation = {
  longitude: number
  latitude: number
}

export function parseMapPin(value: string | null): MapPinLocation | null {
  if (!value) return null
  const [latitudeText, longitudeText, ...rest] = value.split(',')
  if (rest.length > 0) return null

  const latitude = Number(latitudeText)
  const longitude = Number(longitudeText)
  if (
    !Number.isFinite(latitude)
    || !Number.isFinite(longitude)
    || latitude < -90
    || latitude > 90
    || longitude < -180
    || longitude > 180
  ) {
    return null
  }

  return { latitude, longitude }
}

export function normalizeMapPin(location: MapPinLocation): MapPinLocation {
  return {
    latitude: Number(location.latitude.toFixed(5)),
    longitude: Number(location.longitude.toFixed(5)),
  }
}

export function formatMapPin(location: MapPinLocation) {
  return `${location.latitude.toFixed(5)},${location.longitude.toFixed(5)}`
}

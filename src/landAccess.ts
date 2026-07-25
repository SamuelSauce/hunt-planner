export type LandAccess = 'public-mixed' | 'private-only' | 'all'

type HuntWithType = {
  huntType: string
}

export const landAccessOptions: Array<{ value: LandAccess; label: string }> = [
  { value: 'public-mixed', label: 'Public & mixed land' },
  { value: 'private-only', label: 'Private lands only' },
  { value: 'all', label: 'All land access' },
]

export function huntLandAccess(hunt: HuntWithType): Exclude<LandAccess, 'all'> | 'other' {
  const huntType = hunt.huntType.trim().toLowerCase()
  if (huntType.includes('private land')) return 'private-only'
  if (
    huntType.includes('cwmu')
    || huntType.includes('conservation')
    || huntType.includes('control')
  ) {
    return 'other'
  }
  if (huntType.includes('general') || huntType === 'antlerless elk') {
    return 'public-mixed'
  }
  return 'other'
}

export function matchesLandAccess(hunt: HuntWithType, landAccess: LandAccess) {
  return landAccess === 'all' || huntLandAccess(hunt) === landAccess
}

export function defaultLandAccessForHunt(hunt: HuntWithType): LandAccess {
  const access = huntLandAccess(hunt)
  return access === 'other' ? 'all' : access
}

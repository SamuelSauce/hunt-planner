export type LandStatusCategory = 'public' | 'state' | 'tribal' | 'restricted' | 'private'

export type LandStatus = {
  agency: string
  label: string
  access: string
  category: LandStatusCategory
}

export type LandStatusIdentifyResult = {
  attributes?: Record<string, unknown>
}

const agencyDetails: Record<string, Omit<LandStatus, 'label'>> = {
  BLM: {
    agency: 'Bureau of Land Management',
    access: 'Public land · agency rules apply',
    category: 'public',
  },
  USFS: {
    agency: 'U.S. Forest Service',
    access: 'Public land · agency rules apply',
    category: 'public',
  },
  NPS: {
    agency: 'National Park Service',
    access: 'Federal land · check hunting and access rules',
    category: 'restricted',
  },
  USFW: {
    agency: 'U.S. Fish & Wildlife Service',
    access: 'Federal land · check refuge hunting rules',
    category: 'restricted',
  },
  FWS: {
    agency: 'U.S. Fish & Wildlife Service',
    access: 'Federal land · check refuge hunting rules',
    category: 'restricted',
  },
  BOR: {
    agency: 'Bureau of Reclamation',
    access: 'Federal land · check hunting and access rules',
    category: 'restricted',
  },
  DOD: {
    agency: 'Department of Defense',
    access: 'Restricted federal land · verify access',
    category: 'restricted',
  },
  BIA: {
    agency: 'Bureau of Indian Affairs',
    access: 'Tribal or BIA-managed · permission may be required',
    category: 'tribal',
  },
  ST: {
    agency: 'State land',
    access: 'State land · check hunting and access rules',
    category: 'state',
  },
  LG: {
    agency: 'Local government',
    access: 'Local land · check hunting and access rules',
    category: 'state',
  },
  PVT: {
    agency: 'Private or unknown',
    access: 'Treat as private · permission required',
    category: 'private',
  },
  OT: {
    agency: 'Other federal agency',
    access: 'Federal land · check hunting and access rules',
    category: 'restricted',
  },
}

export function landStatusFromIdentifyResults(
  results: LandStatusIdentifyResult[],
): LandStatus | null {
  for (const result of results) {
    const attributes = result.attributes
    if (!attributes) continue

    const code = cleanText(
      attributes.ADMIN_AGENCY_CODE ?? attributes.ADMIN_DEPT_CODE,
    )?.toUpperCase()
    if (!code) continue

    const details = agencyDetails[code] ?? {
      agency: formatAgencyCode(code),
      access: 'Management status reported · verify access rules',
      category: 'restricted' as const,
    }
    const unitName = cleanText(attributes.ADMIN_UNIT_NAME)

    return {
      ...details,
      label: unitName ?? details.agency,
    }
  }

  return null
}

function cleanText(value: unknown) {
  if (typeof value !== 'string') return null
  const text = value.trim()
  return !text || text.toLowerCase() === 'null' ? null : text
}

function formatAgencyCode(code: string) {
  return code
    .replaceAll('_', ' ')
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

export type DrawMetricResidency = 'resident' | 'nonresident'

type PointOddsRow = {
  points: number
  eligibleApplicants: number
  totalPermits: number
  successRatioValue: number | null
}

type PointOddsSide = {
  byPoint: PointOddsRow[]
}

type DrawProfileSide = {
  odds: number | null
  pointTiers: Array<{
    label: string
    odds: number | null
    pool?: string
  }>
}

export type DrawMetricHunt = {
  harvest: { successRate: number } | null
  odds: {
    resident: PointOddsSide
    nonresident: PointOddsSide
  } | null
  drawProfile?: {
    system: 'random' | 'preference-random'
    resident: DrawProfileSide | null
    nonresident: DrawProfileSide | null
  } | null
}

export type DrawTimeEstimate = {
  years: number
  pointLevel: number | null
  cumulativeChance: number
}

export function estimateP50Draw(
  hunt: DrawMetricHunt,
  residency: DrawMetricResidency,
): DrawTimeEstimate | null {
  const pointEstimate = estimatePointOdds(hunt.odds?.[residency] ?? null)
  if (pointEstimate) return pointEstimate

  const profile = hunt.drawProfile
  const profileSide = profile?.[residency] ?? null
  if (!profile || !profileSide) return null

  if (profile.system === 'preference-random') {
    const tierEstimate = estimateProfileTiers(profileSide)
    if (tierEstimate) return tierEstimate
  }

  return estimateRepeatedOdds(profileSide.odds)
}

export function opportunityScore(
  hunt: DrawMetricHunt,
  residency: DrawMetricResidency,
) {
  const estimate = estimateP50Draw(hunt, residency)
  if (!estimate || !hunt.harvest) return null
  return hunt.harvest.successRate / estimate.years
}

function estimatePointOdds(side: PointOddsSide | null) {
  if (!side || side.byPoint.length === 0) return null
  const chanceByPoint = new Map(
    side.byPoint.map((row) => [row.points, pointRowChance(row)]),
  )
  return estimatePointSequence(chanceByPoint)
}

function estimateProfileTiers(side: DrawProfileSide) {
  const numericTiers = side.pointTiers.filter((tier) => /^\d+(?:\.\d+)?$/.test(tier.label.trim()))
  const regularTiers = numericTiers.filter((tier) => /regular|preference draw/i.test(tier.pool ?? ''))
  const candidates = regularTiers.length > 0 ? regularTiers : numericTiers
  if (candidates.length === 0) return null

  const chanceByPoint = new Map<number, number>()
  candidates.forEach((tier) => {
    const point = Math.floor(Number(tier.label))
    const chance = clampPercent(tier.odds ?? 0)
    chanceByPoint.set(point, Math.max(chanceByPoint.get(point) ?? 0, chance))
  })
  return estimatePointSequence(chanceByPoint)
}

function estimatePointSequence(chanceByPoint: Map<number, number>) {
  const points = [...chanceByPoint.keys()].filter((point) => Number.isFinite(point) && point >= 0)
  if (points.length === 0) return null

  const maxPoint = Math.max(...points)
  let remainingChance = 1
  for (let point = 0; point <= maxPoint; point += 1) {
    const annualChance = (chanceByPoint.get(point) ?? 0) / 100
    remainingChance *= 1 - annualChance
    const cumulativeChance = (1 - remainingChance) * 100
    if (cumulativeChance >= 50) {
      return {
        years: point + 1,
        pointLevel: point,
        cumulativeChance,
      }
    }
  }
  return null
}

function estimateRepeatedOdds(odds: number | null) {
  if (odds === null || odds <= 0) return null
  const annualChance = clampPercent(odds) / 100
  if (annualChance >= 1) return { years: 1, pointLevel: null, cumulativeChance: 100 }

  const years = Math.ceil(Math.log(0.5) / Math.log(1 - annualChance))
  return {
    years,
    pointLevel: null,
    cumulativeChance: (1 - Math.pow(1 - annualChance, years)) * 100,
  }
}

function pointRowChance(row: PointOddsRow) {
  if (row.totalPermits <= 0) return 0
  if (row.successRatioValue && row.successRatioValue > 0) {
    return clampPercent(100 / row.successRatioValue)
  }
  if (row.eligibleApplicants <= 0) return 0
  return clampPercent((row.totalPermits / row.eligibleApplicants) * 100)
}

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, value))
}

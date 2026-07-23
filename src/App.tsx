import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import {
  Bug,
  CalendarDays,
  ExternalLink,
  FileText,
  Mail,
  Mountain,
  MapPinned,
  MessageSquare,
  Search,
  Share2,
  Send,
  SlidersHorizontal,
  Target,
  Trophy,
} from 'lucide-react'
import plannerData from './data/udwr-data.json'
import coloradoPlannerData from './data/cpw-data.json'
import idahoPlannerData from './data/idfg-data.json'
import wyomingPlannerData from './data/wgfd-data.json'
import { initAnalytics, trackEvent, trackPageView } from './analytics'
import { estimateP50Draw, opportunityScore, type DrawTimeEstimate } from './drawMetrics'
import { MapExplorer } from './MapExplorer'
import './App.css'

const Hunt3DMap = lazy(() =>
  import('./Hunt3DMap').then((module) => ({ default: module.Hunt3DMap })),
)

type PlannerState = 'utah' | 'colorado' | 'idaho' | 'wyoming'
type Residency = 'resident' | 'nonresident'
type Category =
  | 'all'
  | 'general-otc'
  | 'limited-entry'
  | 'antlerless'
  | 'once-in-a-lifetime'
  | 'cwmu'
  | 'conservation'
  | 'other'
type SortMode = 'draw' | 'opportunity' | 'success' | 'season' | 'quota'
type ShareResult = 'shared' | 'copied' | 'dismissed'
type ShareStatus = 'idle' | 'shared' | 'copied' | 'error'
type AppView = 'planner' | 'contact'
type ContactReason = 'data-issue' | 'question' | 'feedback'

type PlannerFilters = {
  species: string
  category: Category
  weapon: string
}

type ContactBodyInput = {
  reason: ContactReason
  name: string
  replyEmail: string
  hunt: Hunt | null
  huntNumber: string
  message: string
  residency: Residency
}

type OddsPoint = {
  points: number
  eligibleApplicants: number
  totalPermits: number
  successRatio: string
  successRatioValue: number | null
}

type DrawOutSide = {
  drawnOutAt: string | null
  finalLevel: string | null
  finalDrawn: number | null
  finalApplicants: number | null
}

type OddsSide = {
  totals: {
    eligibleApplicants: number
    totalPermits: number
    successRatio: string
    successRatioValue: number | null
  } | null
  byPoint: OddsPoint[]
  summary: {
    nearCertainPoint: number | null
    bestHistoricalPoint: number | null
    bestHistoricalRatio: string | null
    lowestPointWithPermit: number | null
  }
}

type OddsTier = OddsPoint & {
  chance: number
}

type DrawPool = {
  label: string
  odds: number | null
  applicants: number | null
  permits: number | null
}

type DrawPointTier = {
  label: string
  odds: number | null
  issued?: number | null
  quota?: number | null
  pool?: string
}

type DrawProfileSide = {
  odds: number | null
  applicants: number | null
  permits: number | null
  pointTiers: DrawPointTier[]
  pools: DrawPool[]
}

type Hunt = {
  id: string
  state?: PlannerState
  huntNumber: string
  species: string
  gender: string
  huntName: string
  huntType: string
  category: Exclude<Category, 'all'>
  weapon: string
  planningYear: number | null
  seasonDateText: string | null
  quota: {
    resident: number
    nonresident: number
    total: number
  } | null
  currentSourceUrl: string
  harvest: {
    year: number
    permits: number
    huntersAfield: number
    harvest: number
    successRate: number
    averageDays: number
    satisfaction: number | null
    sourceUrl: string
  } | null
  odds: {
    year: number
    resident: OddsSide
    nonresident: OddsSide
    description: string
    sourceUrl: string
  } | null
  drawOut?: {
    year: number
    sourceUrl: string
    originalReportUrl: string
    resident: DrawOutSide
    nonresident: DrawOutSide
  }
  drawProfile?: {
    year: number
    system: 'random' | 'preference-random'
    description: string
    sourceUrl: string
    resident: DrawProfileSide | null
    nonresident: DrawProfileSide | null
  } | null
  mapUnitIds?: string[]
  licenseNotes?: string
  publicLandPercent?: number | null
  sourceUrls: string[]
}

type Report = {
  id: string
  state?: PlannerState
  sourceType: string
  year: number
  species?: string
  category: string
  title: string
  url: string
  size: string
}

type PlannerData = {
  generatedAt: string
  sourcePages: Record<string, string>
  reports: Report[]
  hunts: Hunt[]
}

const stateOptions: Array<{ value: PlannerState; label: string }> = [
  { value: 'utah', label: 'Utah' },
  { value: 'colorado', label: 'Colorado' },
  { value: 'idaho', label: 'Idaho' },
  { value: 'wyoming', label: 'Wyoming' },
]

const plannerDataByState: Record<PlannerState, PlannerData> = {
  utah: plannerData as PlannerData,
  colorado: coloradoPlannerData as PlannerData,
  idaho: idahoPlannerData as PlannerData,
  wyoming: wyomingPlannerData as PlannerData,
}

const stateMeta: Record<
  PlannerState,
  {
    name: string
    agency: string
    title: string
    eyebrow: string
    reportTitle: string
    reportPlaceholder: string
    primarySourceLabel: string
    primarySourceUrl: string
    secondarySourceLabel: string
    secondarySourceUrl: string
    mapLabel: string
  }
> = {
  utah: {
    name: 'Utah',
    agency: 'UDWR',
    title: 'Utah Hunt Planner',
    eyebrow: 'UDWR data workspace',
    reportTitle: 'UDWR report library',
    reportPlaceholder: '2025 elk odds, antlerless, harvest',
    primarySourceLabel: 'Hunt Planner',
    primarySourceUrl: (plannerData as PlannerData).sourcePages.huntPlanner,
    secondarySourceLabel: 'Draw reports',
    secondarySourceUrl: (plannerData as PlannerData).sourcePages.drawOdds,
    mapLabel: 'Map',
  },
  colorado: {
    name: 'Colorado',
    agency: 'CPW',
    title: 'Colorado Hunt Planner',
    eyebrow: 'CPW data workspace',
    reportTitle: 'CPW report library',
    reportPlaceholder: '2026 elk drawn out, harvest, population',
    primarySourceLabel: 'Hunt Atlas',
    primarySourceUrl: (coloradoPlannerData as PlannerData).sourcePages.huntAtlas,
    secondarySourceLabel: 'CPW statistics',
    secondarySourceUrl: (coloradoPlannerData as PlannerData).sourcePages.statistics,
    mapLabel: 'Hunt atlas',
  },
  idaho: {
    name: 'Idaho',
    agency: 'IDFG',
    title: 'Idaho Hunt Planner',
    eyebrow: 'IDFG data workspace',
    reportTitle: 'IDFG report library',
    reportPlaceholder: 'deer controlled odds, elk harvest',
    primarySourceLabel: 'Hunt Planner',
    primarySourceUrl: (idahoPlannerData as PlannerData).sourcePages.huntPlanner,
    secondarySourceLabel: 'Draw odds',
    secondarySourceUrl: (idahoPlannerData as PlannerData).sourcePages.drawOdds,
    mapLabel: 'Hunt map',
  },
  wyoming: {
    name: 'Wyoming',
    agency: 'WGFD',
    title: 'Wyoming Hunt Planner',
    eyebrow: 'WGFD data workspace',
    reportTitle: 'WGFD report library',
    reportPlaceholder: 'deer draw odds, elk harvest',
    primarySourceLabel: 'Hunt Planner',
    primarySourceUrl: (wyomingPlannerData as PlannerData).sourcePages.huntPlanner,
    secondarySourceLabel: 'Draw reports',
    secondarySourceUrl: (wyomingPlannerData as PlannerData).sourcePages.drawOdds,
    mapLabel: 'Hunt map',
  },
}

const allHunts = Object.values(plannerDataByState).flatMap((stateData) => stateData.hunts)
const MIN_STABLE_ODDS_APPLICANTS = 10
const PROBABLE_CHANCE = 25
const CONTACT_EMAIL = 'samuelfbridge@gmail.com'

const categoryOptions: Array<{ value: Category; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'general-otc', label: 'General/OTC' },
  { value: 'limited-entry', label: 'Limited entry' },
  { value: 'antlerless', label: 'Antlerless' },
  { value: 'once-in-a-lifetime', label: 'OIAL' },
  { value: 'cwmu', label: 'CWMU' },
]

const sortOptions: Array<{ value: SortMode; label: string }> = [
  { value: 'draw', label: 'P50 draw time' },
  { value: 'opportunity', label: 'Opportunity score' },
  { value: 'success', label: 'Harvest success' },
  { value: 'season', label: 'Season date' },
  { value: 'quota', label: 'Permit quota' },
]

function App() {
  const [initialShare] = useState(() => getInitialShareState())
  const [view, setView] = useState<AppView>(() => getInitialView())
  const [plannerState, setPlannerState] = useState<PlannerState>(initialShare.state)
  const [species, setSpecies] = useState(initialShare.species)
  const [category, setCategory] = useState<Category>(initialShare.category)
  const [residency, setResidency] = useState<Residency>(initialShare.residency)
  const [query, setQuery] = useState('')
  const [weapon, setWeapon] = useState(initialShare.weapon)
  const [sortMode, setSortMode] = useState<SortMode>('draw')
  const [selectedId, setSelectedId] = useState<string | null>(initialShare.hunt?.id ?? null)
  const [reportQuery, setReportQuery] = useState('')
  const [shareStatus, setShareStatus] = useState<ShareStatus>('idle')
  const [map3dHunt, setMap3dHunt] = useState<Hunt | null>(null)
  const [cardShareStatus, setCardShareStatus] = useState<{
    huntId: string
    status: Exclude<ShareStatus, 'idle' | 'error'>
  } | null>(null)
  const huntListRef = useRef<HTMLDivElement | null>(null)
  const hasRenderedInitialSort = useRef(false)
  const lastTrackedPage = useRef('')
  const activeData = plannerDataByState[plannerState]
  const activeMeta = stateMeta[plannerState]

  useEffect(() => {
    initAnalytics()
    const handlePopState = () => setView(getInitialView())
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  const speciesOptions = useMemo(
    () => unique(activeData.hunts.map((hunt) => hunt.species)).sort(),
    [activeData],
  )

  const weaponOptions = useMemo(() => {
    const scoped = activeData.hunts.filter((hunt) => {
      return (
        hunt.species === species &&
        (category === 'all' || hunt.category === category)
      )
    })
    const options = new Map<string, string>()
    scoped.forEach((hunt) => {
      const value = weaponFilterValue(hunt, plannerState, species)
      if (value) options.set(value, weaponFilterLabel(value))
    })
    return [
      { value: 'all', label: 'All weapons' },
      ...[...options].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label)),
    ]
  }, [activeData, category, plannerState, species])

  const visibleCategoryOptions = useMemo(() => {
    const categories = new Set(activeData.hunts.map((hunt) => hunt.category))
    return categoryOptionsFor(plannerState).filter(
      (option) => option.value === 'all' || categories.has(option.value),
    )
  }, [activeData, plannerState])

  const filteredHunts = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return activeData.hunts
      .filter((hunt) => hunt.species === species)
      .filter((hunt) => category === 'all' || hunt.category === category)
      .filter((hunt) => weapon === 'all' || weaponFilterValue(hunt, plannerState, species) === weapon)
      .filter((hunt) => {
        if (!needle) return true
        return [
          hunt.huntNumber,
          hunt.huntName,
          hunt.huntType,
          hunt.weapon,
          hunt.seasonDateText ?? '',
        ]
          .join(' ')
          .toLowerCase()
          .includes(needle)
      })
      .sort((a, b) => compareHunts(a, b, sortMode, residency))
  }, [activeData, category, plannerState, query, residency, sortMode, species, weapon])

  const selectedHunt = useMemo(() => {
    return (
      filteredHunts.find((hunt) => hunt.id === selectedId) ??
      filteredHunts[0] ??
      null
    )
  }, [filteredHunts, selectedId])

  useEffect(() => {
    if (view !== 'planner') return
    if (!selectedHunt) return
    replaceShareUrl(selectedHunt, residency, { species, category, weapon })
    const path = `${window.location.pathname}${window.location.search}`
    if (lastTrackedPage.current !== path) {
      lastTrackedPage.current = path
      trackPageView(path)
    }
  }, [category, plannerState, residency, selectedHunt, species, view, weapon])

  useEffect(() => {
    if (view !== 'contact') return
    const path = `${window.location.pathname}${window.location.search}`
    if (lastTrackedPage.current !== path) {
      lastTrackedPage.current = path
      trackPageView(path)
    }
  }, [view])

  useEffect(() => {
    if (!hasRenderedInitialSort.current) {
      hasRenderedInitialSort.current = true
      return
    }
    if (huntListRef.current) {
      huntListRef.current.scrollTop = 0
    }
  }, [sortMode])

  useEffect(() => {
    if (view !== 'planner') return
    const huntId = initialShare.hunt?.id
    if (!huntId) return

    const previousScrollRestoration = window.history.scrollRestoration
    window.history.scrollRestoration = 'manual'

    const scrollToPlanner = () => {
      document
        .getElementById('planner')
        ?.scrollIntoView({ behavior: 'auto', block: 'start' })
    }

    const frame = window.requestAnimationFrame(scrollToPlanner)
    const timers = [180, 700].map((delay) => window.setTimeout(scrollToPlanner, delay))

    return () => {
      window.cancelAnimationFrame(frame)
      timers.forEach((timer) => window.clearTimeout(timer))
      window.history.scrollRestoration = previousScrollRestoration
    }
  }, [initialShare.hunt?.id, view])

  const reportMatches = useMemo(() => {
    const needle = reportQuery.trim().toLowerCase()
    return activeData.reports
      .filter((report) => {
        if (!needle) return true
        return [report.title, report.category, report.species ?? '', report.year, report.sourceType]
          .join(' ')
          .toLowerCase()
          .includes(needle)
      })
      .sort((a, b) => b.year - a.year || a.title.localeCompare(b.title))
      .slice(0, 18)
  }, [activeData, reportQuery])

  const contactState = view === 'contact' ? getInitialShareState() : null
  const plannerHref = selectedId && selectedHunt
    ? selectedHuntUrl(selectedHunt, residency, { species, category, weapon })
    : '/'
  const contactHref = contactPageUrl()
  const navigateWithinApp = (event: React.MouseEvent<HTMLAnchorElement>, nextView: AppView, href: string) => {
    event.preventDefault()
    window.history.pushState(null, '', href)
    setView(nextView)
    window.scrollTo({ top: 0, behavior: 'auto' })
  }
  const changePlannerState = (nextState: PlannerState) => {
    if (nextState === plannerState) return
    const nextSpecies = unique(plannerDataByState[nextState].hunts.map((hunt) => hunt.species)).sort()[0] ?? ''
    setPlannerState(nextState)
    setSpecies(nextSpecies)
    setCategory('all')
    setWeapon('all')
    setSelectedId(null)
    setReportQuery('')
  }
  const selectPlannerHunt = (hunt: Hunt) => {
    trackEvent('select_hunt', {
      hunt_number: hunt.huntNumber,
      species: hunt.species,
      category: hunt.category,
      residency,
    })
    setSelectedId(hunt.id)
  }
  const sharePlannerHunt = (hunt: Hunt) => {
    shareHuntLink(hunt, residency, { species, category, weapon })
      .then((result) => {
        if (result === 'dismissed') return
        trackEvent('share_hunt', {
          result,
          hunt_number: hunt.huntNumber,
          species: hunt.species,
          residency,
        })
        setCardShareStatus({ huntId: hunt.id, status: result })
        window.setTimeout(() => setCardShareStatus(null), 1500)
      })
      .catch(() => {
        setCardShareStatus(null)
      })
  }
  const openHunt3DMap = (hunt: Hunt, source: 'card' | 'detail') => {
    trackEvent('open_hunt_3d_map', {
      hunt_number: hunt.huntNumber,
      species: hunt.species,
      source,
    })
    setMap3dHunt(hunt)
  }

  return (
    <div className={`app-shell state-${plannerState}`}>
      <header className="app-header">
        <div className="brand">
          <div className="brand-mark">
            <MapPinned size={26} aria-hidden="true" />
          </div>
          <div>
            <p className="eyebrow">{activeMeta.eyebrow}</p>
            <h1>{activeMeta.title}</h1>
          </div>
        </div>
        <div className="header-actions">
          <div className="state-switcher" aria-label="Planner state">
            {stateOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                className={option.value === plannerState ? 'active' : ''}
                onClick={() => changePlannerState(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <a href={activeMeta.primarySourceUrl} target="_blank" rel="noreferrer">
            {activeMeta.primarySourceLabel}
            <ExternalLink size={15} aria-hidden="true" />
          </a>
          <a href={activeMeta.secondarySourceUrl} target="_blank" rel="noreferrer">
            {activeMeta.secondarySourceLabel}
            <ExternalLink size={15} aria-hidden="true" />
          </a>
          {view === 'contact' ? (
            <a href={plannerHref} onClick={(event) => navigateWithinApp(event, 'planner', plannerHref)}>
              Planner
              <MapPinned size={15} aria-hidden="true" />
            </a>
          ) : (
            <a href={contactHref} onClick={(event) => navigateWithinApp(event, 'contact', contactHref)}>
              Contact
              <Mail size={15} aria-hidden="true" />
            </a>
          )}
        </div>
      </header>

      {view === 'contact' ? (
        <ContactPage
          key={contactState?.hunt?.id ?? 'general-contact'}
          hunt={contactState?.hunt ?? null}
          residency={contactState?.residency ?? residency}
          plannerHref={plannerHref}
          onPlannerClick={(event) => navigateWithinApp(event, 'planner', plannerHref)}
        />
      ) : (
      <main id="planner" className="planner-grid">
        <MapExplorer
          plannerState={plannerState}
          species={species}
          category={category}
          hunts={filteredHunts}
          selectedHunt={selectedHunt}
          residency={residency}
          onSelect={(hunt) => selectPlannerHunt(hunt as Hunt)}
          renderHuntPreview={(hunt) => (
            <HuntCard
              hunt={hunt as Hunt}
              residency={residency}
              selected={selectedHunt?.id === hunt.id}
              preview
              onSelect={() => selectPlannerHunt(hunt as Hunt)}
              shareState={cardShareStatus?.huntId === hunt.id ? cardShareStatus.status : 'idle'}
              onShare={() => sharePlannerHunt(hunt as Hunt)}
              onOpen3D={() => openHunt3DMap(hunt as Hunt, 'card')}
            />
          )}
        />
        <aside className="panel filters-panel">
          <div className="panel-heading">
            <SlidersHorizontal size={18} aria-hidden="true" />
            <h2>Filters</h2>
          </div>

          <label className="field">
            <span>Search</span>
            <div className="input-shell">
              <Search size={16} aria-hidden="true" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Unit, hunt number, weapon"
              />
            </div>
          </label>

          <div className="field">
            <span>Species</span>
            <div className="segmented tall">
              {speciesOptions.map((option) => (
                <button
                  key={option}
                  type="button"
                  className={option === species ? 'active' : ''}
                  onClick={() => {
                    setSpecies(option)
                    setWeapon('all')
                    setSelectedId(null)
                  }}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <span>Hunt type</span>
            <div className="segmented">
              {visibleCategoryOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={option.value === category ? 'active' : ''}
                  onClick={() => {
                    setCategory(option.value)
                    setWeapon('all')
                    setSelectedId(null)
                  }}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <label className="field">
            <span>Weapon</span>
            <select value={weapon} onChange={(event) => setWeapon(event.target.value)}>
              {weaponOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <div className="field">
            <span>Residency</span>
            <div className="segmented two">
              <button
                type="button"
                className={residency === 'resident' ? 'active' : ''}
                onClick={() => setResidency('resident')}
              >
                Resident
              </button>
              <button
                type="button"
                className={residency === 'nonresident' ? 'active' : ''}
                onClick={() => setResidency('nonresident')}
              >
                Nonresident
              </button>
            </div>
          </div>
        </aside>

        <section className="results-column">
          <section className="results-panel">
            <div className="results-toolbar">
              <div>
                <p className="eyebrow">{species}</p>
                <h2>{categoryLabel(category, plannerState)} hunts</h2>
              </div>
              <label>
                <span>Sort</span>
                <select
                  value={sortMode}
                  onChange={(event) => setSortMode(event.target.value as SortMode)}
                >
                  {sortOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="hunt-list" ref={huntListRef}>
              {filteredHunts.map((hunt) => (
                <HuntCard
                  key={hunt.id}
                  hunt={hunt}
                  residency={residency}
                  selected={selectedHunt?.id === hunt.id}
                  onSelect={() => selectPlannerHunt(hunt)}
                  shareState={cardShareStatus?.huntId === hunt.id ? cardShareStatus.status : 'idle'}
                  onShare={() => sharePlannerHunt(hunt)}
                  onOpen3D={() => openHunt3DMap(hunt, 'card')}
                />
              ))}
            </div>
          </section>

          <section className="panel report-panel">
            <div className="panel-heading">
              <FileText size={18} aria-hidden="true" />
              <h2>{activeMeta.reportTitle}</h2>
            </div>
            <div className="report-search">
              <div className="input-shell">
                <Search size={16} aria-hidden="true" />
                <input
                  value={reportQuery}
                  onChange={(event) => setReportQuery(event.target.value)}
                  placeholder={activeMeta.reportPlaceholder}
                />
              </div>
            </div>
            <div className="report-list">
              {reportMatches.map((report) => (
                <a key={report.id} className="report-row" href={report.url} target="_blank" rel="noreferrer">
                  <span className="report-year">{report.year}</span>
                  <span>
                    <strong>{report.title}</strong>
                    <small>
                      {sourceTypeLabel(report.sourceType)} - {report.category} - {report.size}
                    </small>
                  </span>
                  <ExternalLink size={15} aria-hidden="true" />
                </a>
              ))}
            </div>
          </section>
        </section>

        <aside className="panel detail-panel">
          {selectedHunt ? (
            <HuntDetail
              hunt={selectedHunt}
              residency={residency}
              shareStatus={shareStatus}
              onShareLink={() => {
                shareHuntLink(selectedHunt, residency, { species, category, weapon })
                  .then((result) => {
                    if (result === 'dismissed') {
                      setShareStatus('idle')
                      return
                    }
                    trackEvent('share_hunt', {
                      result,
                      hunt_number: selectedHunt.huntNumber,
                      species: selectedHunt.species,
                      residency,
                    })
                    setShareStatus(result)
                    window.setTimeout(() => setShareStatus('idle'), 1600)
                  })
                  .catch(() => {
                    setShareStatus('error')
                    window.setTimeout(() => setShareStatus('idle'), 2200)
                  })
              }}
              onOpen3D={() => openHunt3DMap(selectedHunt, 'detail')}
            />
          ) : (
            <div className="empty-state">No hunts match the current filters.</div>
          )}
        </aside>
      </main>
      )}
      {map3dHunt && (
        <Suspense
          fallback={(
            <div className="hunt-3d-modal">
              <div className="hunt-3d-loading" role="status">
                <Mountain size={25} aria-hidden="true" />
                <span>Opening 3D map…</span>
              </div>
            </div>
          )}
        >
          <Hunt3DMap hunt={map3dHunt} onClose={() => setMap3dHunt(null)} />
        </Suspense>
      )}
    </div>
  )
}

function ContactPage({
  hunt,
  residency,
  plannerHref,
  onPlannerClick,
}: {
  hunt: Hunt | null
  residency: Residency
  plannerHref: string
  onPlannerClick: (event: React.MouseEvent<HTMLAnchorElement>) => void
}) {
  const [reason, setReason] = useState<ContactReason>(hunt ? 'data-issue' : 'question')
  const [name, setName] = useState('')
  const [replyEmail, setReplyEmail] = useState('')
  const [huntNumber, setHuntNumber] = useState(hunt?.huntNumber ?? '')
  const [message, setMessage] = useState('')
  const [submitted, setSubmitted] = useState(false)

  const submitContact = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const subject = contactSubject(reason, huntNumber)
    const body = contactBody({
      reason,
      name,
      replyEmail,
      hunt,
      huntNumber,
      message,
      residency,
    })
    trackEvent('contact_open_email', {
      reason,
      has_hunt: Boolean(hunt || huntNumber.trim()),
      hunt_number: hunt?.huntNumber ?? (huntNumber.trim() || undefined),
    })
    window.location.href = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
    setSubmitted(true)
  }

  return (
    <main className="contact-page">
      <section className="panel contact-panel">
        <div className="contact-heading">
          <div className="brand-mark">
            <MessageSquare size={24} aria-hidden="true" />
          </div>
          <div>
            <p className="eyebrow">Contact</p>
            <h2>Report a data issue or ask a question</h2>
          </div>
        </div>

        {hunt && (
          <div className="contact-context">
            <Bug size={17} aria-hidden="true" />
            <div>
              <strong>
                {hunt.huntName} - {hunt.huntNumber}
              </strong>
              <span>
                {hunt.weapon || 'Weapon varies'} - {residencyLabel(residency)}
              </span>
            </div>
          </div>
        )}

        <form className="contact-form" onSubmit={submitContact}>
          <label className="field">
            <span>Reason</span>
            <select value={reason} onChange={(event) => setReason(event.target.value as ContactReason)}>
              <option value="data-issue">Report data issue</option>
              <option value="question">Question</option>
              <option value="feedback">Feedback</option>
            </select>
          </label>

          <div className="contact-grid">
            <label className="field">
              <span>Name</span>
              <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Optional" />
            </label>
            <label className="field">
              <span>Reply email</span>
              <input
                type="email"
                value={replyEmail}
                onChange={(event) => setReplyEmail(event.target.value)}
                placeholder="Optional"
              />
            </label>
          </div>

          <label className="field">
            <span>Hunt number</span>
            <input
              value={huntNumber}
              onChange={(event) => setHuntNumber(event.target.value)}
              placeholder="EB3009, EA1137, etc."
            />
          </label>

          <label className="field">
            <span>Message</span>
            <textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="What looks wrong, or what can I help with?"
              rows={7}
              required
            />
          </label>

          <div className="contact-actions">
            <button className="primary-action" type="submit">
              <Send size={16} aria-hidden="true" />
              Open email
            </button>
            <a href={`mailto:${CONTACT_EMAIL}`}>
              <Mail size={16} aria-hidden="true" />
              Email directly
            </a>
            <a href={plannerHref} onClick={onPlannerClick}>
              Back to planner
            </a>
          </div>

          {submitted && (
            <p className="contact-note">
              If your mail app did not open, email {CONTACT_EMAIL} directly.
            </p>
          )}
        </form>
      </section>
    </main>
  )
}

function HuntCard({
  hunt,
  residency,
  selected,
  onSelect,
  shareState,
  onShare,
  onOpen3D,
  preview = false,
}: {
  hunt: Hunt
  residency: Residency
  selected: boolean
  onSelect: () => void
  shareState: Exclude<ShareStatus, 'error'>
  onShare: () => void
  onOpen3D: () => void
  preview?: boolean
}) {
  const oddsSide = hunt.odds?.[residency] ?? null
  const drawProfileSide = hunt.drawProfile?.[residency] ?? null
  const p50Estimate = estimateP50Draw(hunt, residency)
  const huntOpportunityScore = opportunityScore(hunt, residency)
  return (
    <article
      className={`hunt-card ${preview ? 'preview' : ''} ${selected ? 'selected' : ''}`}
      data-hunt-id={preview ? undefined : hunt.id}
      onClick={onSelect}
    >
      <div className="hunt-card-main">
        <span className="tag">{categoryLabel(hunt.category, hunt.state)}</span>
        <h3>{hunt.huntName}</h3>
        <p>
          {hunt.huntNumber} - {hunt.weapon || 'Weapon varies'}
        </p>
        <p className="hunt-card-season">{shortSeason(hunt.seasonDateText)}</p>
        <div className="hunt-card-actions">
          <a
            className="hunt-map-link"
            href={huntBoundaryUrl(hunt)}
            target="_blank"
            rel="noreferrer"
            onClick={(event) => {
              event.stopPropagation()
              trackEvent('open_hunt_map', {
                hunt_number: hunt.huntNumber,
                species: hunt.species,
                source: 'card',
              })
            }}
          >
            <MapPinned size={14} aria-hidden="true" />
            {hunt.state === 'colorado' ? 'Atlas' : 'Map'}
          </a>
          <button
            className={`hunt-share-link ${shareState !== 'idle' ? 'copied' : ''}`}
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              onShare()
            }}
          >
            <Share2 size={14} aria-hidden="true" />
            {shareState === 'shared' ? 'Shared' : shareState === 'copied' ? 'Copied' : 'Share'}
          </button>
          <button
            className="hunt-3d-link"
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              onOpen3D()
            }}
          >
            <Mountain size={14} aria-hidden="true" />
            3D Map
          </button>
        </div>
      </div>
      <div className="hunt-card-side">
        {hunt.drawOut ? (
          <DrawOutSummary hunt={hunt} compact />
        ) : hunt.drawProfile ? (
          <DrawProfileSummary profile={hunt.drawProfile} side={drawProfileSide} compact />
        ) : (
          <OddsChart side={oddsSide} compact />
        )}
        <div className="hunt-metrics two">
          {hunt.drawOut ? (
            <>
              <Metric label="Resident final" value={drawOutFinalLevelText(hunt.drawOut.resident)} />
              <Metric label="Nonresident final" value={drawOutFinalLevelText(hunt.drawOut.nonresident)} />
            </>
          ) : (
            <>
              <Metric
                label="Harvest success"
                value={hunt.harvest ? formatPercent(hunt.harvest.successRate) : 'No survey'}
              />
              <Metric
                label="Hunters harvested"
                value={hunt.harvest ? harvestedHuntersText(hunt.harvest, true) : 'No survey'}
              />
              <Metric
                label="Avg days hunted"
                value={hunt.harvest ? averageDaysText(hunt.harvest) : 'No survey'}
              />
              {p50Estimate && (
                <Metric label="Est. P50 draw" value={p50DrawText(p50Estimate)} />
              )}
              {huntOpportunityScore !== null && (
                <Metric label="Opportunity score" value={formatOpportunityScore(huntOpportunityScore)} />
              )}
            </>
          )}
        </div>
      </div>
    </article>
  )
}

function HuntDetail({
  hunt,
  residency,
  shareStatus,
  onShareLink,
  onOpen3D,
}: {
  hunt: Hunt
  residency: Residency
  shareStatus: ShareStatus
  onShareLink: () => void
  onOpen3D: () => void
}) {
  const oddsSide = hunt.odds?.[residency] ?? null
  const drawProfileSide = hunt.drawProfile?.[residency] ?? null
  const p50Estimate = estimateP50Draw(hunt, residency)
  const huntOpportunityScore = opportunityScore(hunt, residency)
  const links = unique([
    hunt.currentSourceUrl,
    hunt.odds?.sourceUrl,
    hunt.drawProfile?.sourceUrl,
    hunt.harvest?.sourceUrl,
    ...hunt.sourceUrls,
  ])

  return (
    <>
      <div className="detail-title">
        <span className="tag">{categoryLabel(hunt.category, hunt.state)}</span>
        <h2>{hunt.huntName}</h2>
        <p>
          {hunt.huntNumber} - {hunt.species} {hunt.gender}
        </p>
        <div className="detail-actions">
          <a
            className="detail-map-link"
            href={huntBoundaryUrl(hunt)}
            target="_blank"
            rel="noreferrer"
            onClick={() => {
              trackEvent('open_hunt_map', {
                hunt_number: hunt.huntNumber,
                species: hunt.species,
                source: 'detail',
              })
            }}
          >
            <MapPinned size={15} aria-hidden="true" />
            {hunt.state === 'colorado' ? 'Open hunt atlas' : 'Open boundary map'}
          </a>
          <button
            className={`detail-share-link ${shareStatus === 'copied' || shareStatus === 'shared' ? 'copied' : ''}`}
            type="button"
            onClick={onShareLink}
          >
            <Share2 size={15} aria-hidden="true" />
            {shareStatus === 'shared'
              ? 'Shared'
              : shareStatus === 'copied'
              ? 'Copied link'
              : shareStatus === 'error'
                ? 'Copy failed'
                : 'Share hunt'}
          </button>
          <button className="detail-3d-link" type="button" onClick={onOpen3D}>
            <Mountain size={15} aria-hidden="true" />
            Open 3D map
          </button>
        </div>
      </div>

      <div className="detail-section">
        <h3>
          <CalendarDays size={17} aria-hidden="true" />
          Season and permits
        </h3>
        <dl className="detail-list">
          <div>
            <dt>Dates</dt>
            <dd>{hunt.seasonDateText ?? 'Not listed in current Hunt Planner data'}</dd>
          </div>
          <div>
            <dt>Weapon</dt>
            <dd>{hunt.weapon || 'Varies'}</dd>
          </div>
          <div>
            <dt>Quota</dt>
            <dd>{quotaText(hunt)}</dd>
          </div>
          {hunt.publicLandPercent !== null && hunt.publicLandPercent !== undefined && (
            <div>
              <dt>Public land</dt>
              <dd>{formatPercent(hunt.publicLandPercent)}</dd>
            </div>
          )}
          {hunt.licenseNotes && (
            <div>
              <dt>License model</dt>
              <dd>{hunt.licenseNotes}</dd>
            </div>
          )}
        </dl>
      </div>

      <div className="detail-section">
        <h3>
          <Target size={17} aria-hidden="true" />
          Draw outlook
        </h3>
        {hunt.drawOut ? (
          <>
            <div className="draw-callout colorado">
              <strong>{drawOutHeadline(hunt.drawOut, residency)}</strong>
              <span>
                CPW drawn-out-at data shows where adult resident and adult nonresident licenses ran out in the historical draw.
              </span>
            </div>
            <DrawOutSummary hunt={hunt} />
            <dl className="detail-list two-col">
              <div>
                <dt>Adult resident</dt>
                <dd>{drawOutSideText(hunt.drawOut.resident)}</dd>
              </div>
              <div>
                <dt>Adult nonresident</dt>
                <dd>{drawOutSideText(hunt.drawOut.nonresident)}</dd>
              </div>
              <div>
                <dt>Report year</dt>
                <dd>{hunt.drawOut.year}</dd>
              </div>
              <div>
                <dt>Final level</dt>
                <dd>{drawOutFinalLevelText(hunt.drawOut[residency])}</dd>
              </div>
            </dl>
          </>
        ) : hunt.drawProfile ? (
          <>
            <div className={`draw-callout ${hunt.drawProfile.system === 'random' ? 'idaho' : 'wyoming'}`}>
              <strong>{drawProfileHeadline(hunt.drawProfile, drawProfileSide)}</strong>
              <span>{hunt.drawProfile.description}</span>
            </div>
            <DrawProfileSummary profile={hunt.drawProfile} side={drawProfileSide} />
          </>
        ) : hunt.odds && oddsSide ? (
          <>
            <div className="draw-callout">
              <strong>{probableSummaryText(oddsSide)}</strong>
              <span>
                Historical first-choice odds by {residencyLabel(residency).toLowerCase()} point tier.
              </span>
            </div>
            <OddsChart side={oddsSide} />
            <dl className="detail-list two-col">
              <div>
                <dt>{PROBABLE_CHANCE}%+ begins</dt>
                <dd>{firstProbablePointText(oddsSide)}</dd>
              </div>
              <div>
                <dt>2025 total</dt>
                <dd>{oddsSide.totals?.successRatio ?? 'N/A'}</dd>
              </div>
              <div>
                <dt>Near certain</dt>
                <dd>{pointSummaryText(oddsSide)}</dd>
              </div>
              <div>
                <dt>Lowest point issued</dt>
                <dd>{oddsSide.summary.lowestPointWithPermit ?? 'N/A'}</dd>
              </div>
            </dl>
          </>
        ) : (
          <p className="muted">No parsed draw table for this hunt.</p>
        )}
        {p50Estimate && (
          <dl className="detail-list two-col draw-estimate-list">
            <div>
              <dt>Estimated P50 draw</dt>
              <dd>{p50DrawText(p50Estimate)}</dd>
            </div>
            {huntOpportunityScore !== null && (
              <div>
                <dt>Opportunity score</dt>
                <dd>{formatOpportunityScore(huntOpportunityScore)}</dd>
              </div>
            )}
          </dl>
        )}
      </div>

      <div className="detail-section">
        <h3>
          <Trophy size={17} aria-hidden="true" />
          Harvest
        </h3>
        {hunt.harvest ? (
          <dl className="detail-list two-col">
            <div>
              <dt>{hunt.harvest.year} harvest success</dt>
              <dd>{formatPercent(hunt.harvest.successRate)}</dd>
            </div>
            <div>
              <dt>Hunters harvested</dt>
              <dd>{harvestedHuntersText(hunt.harvest)}</dd>
            </div>
            <div>
              <dt>Avg days hunted</dt>
              <dd>{averageDaysText(hunt.harvest)}</dd>
            </div>
            <div>
              <dt>Satisfaction</dt>
              <dd>{hunt.harvest.satisfaction?.toFixed(1) ?? 'N/A'}</dd>
            </div>
          </dl>
        ) : (
          <p className="muted">
            {hunt.state === 'colorado'
              ? 'Colorado harvest reports are linked below; per-hunt harvest rows are not parsed yet.'
              : 'No parsed 2024 harvest survey row for this hunt.'}
          </p>
        )}
      </div>

      <div className="detail-section source-section">
        <h3>
          <ExternalLink size={17} aria-hidden="true" />
          Sources
        </h3>
        {links.map((link) => (
          <a key={link} href={link} target="_blank" rel="noreferrer">
            {sourceName(link)}
            <ExternalLink size={14} aria-hidden="true" />
          </a>
        ))}
      </div>
    </>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <span>
      <small>{label}</small>
      <strong>{value}</strong>
    </span>
  )
}

function DrawOutSummary({
  hunt,
  compact = false,
}: {
  hunt: Hunt
  compact?: boolean
}) {
  if (!hunt.drawOut) return null

  return (
    <div className={`drawout-card ${compact ? 'compact' : ''}`}>
      <div className="drawout-card-head">
        <small>{hunt.drawOut.year} drawn out at</small>
        <strong>{drawOutHeadline(hunt.drawOut, 'resident')}</strong>
      </div>
      <div className="drawout-grid">
        <div>
          <span>Adult resident</span>
          <strong>{hunt.drawOut.resident.drawnOutAt ?? 'Not issued'}</strong>
          <small>{drawOutFinalLevelText(hunt.drawOut.resident)}</small>
        </div>
        <div>
          <span>Adult nonresident</span>
          <strong>{hunt.drawOut.nonresident.drawnOutAt ?? 'Not issued'}</strong>
          <small>{drawOutFinalLevelText(hunt.drawOut.nonresident)}</small>
        </div>
      </div>
    </div>
  )
}

function DrawProfileSummary({
  profile,
  side,
  compact = false,
}: {
  profile: NonNullable<Hunt['drawProfile']>
  side: DrawProfileSide | null
  compact?: boolean
}) {
  const tiers = usefulDrawTiers(side)
  return (
    <div className={`draw-profile-card ${compact ? 'compact' : ''}`}>
      <div className="draw-profile-head">
        <small>{profile.system === 'random' ? 'Random draw' : 'Draw pools'}</small>
        <strong>{drawProfileHeadline(profile, side)}</strong>
      </div>
      {side ? (
        <>
          <div className="draw-pool-grid">
            {side.pools.slice(0, compact ? 2 : 4).map((pool, index) => (
              <div key={`${pool.label}-${index}`}>
                <span>{pool.label}</span>
                <strong>{pool.odds === null ? 'N/A' : formatPercent(pool.odds)}</strong>
                {!compact && (
                  <small>{drawPoolCountText(pool)}</small>
                )}
              </div>
            ))}
            {side.pools.length === 0 && (
              <div>
                <span>Reported odds</span>
                <strong>{side.odds === null ? 'N/A' : formatPercent(side.odds)}</strong>
              </div>
            )}
          </div>
          {!compact && tiers.length > 0 && (
            <div className="draw-tier-list">
              <div className="draw-tier-list-head">
                <span>Preference tier</span>
                <span>Odds</span>
              </div>
              {tiers.map((tier, index) => (
                <div key={`${tier.pool}-${tier.label}-${index}`}>
                  <span>
                    <strong>{tier.label} pts</strong>
                    <small>{tier.pool ?? 'Preference draw'}</small>
                  </span>
                  <strong>{tier.odds === null ? 'N/A' : formatPercent(tier.odds)}</strong>
                </div>
              ))}
            </div>
          )}
          {!compact && profile.system === 'random' && (
            <p className="draw-system-note">No preference-point ladder. Every applicant is in the random draw.</p>
          )}
        </>
      ) : (
        <p className="muted odds-empty">No result row for this residency and license type.</p>
      )}
    </div>
  )
}

type OddsChartHover = {
  tier: OddsTier
  xPercent: number
  yPercent: number
}

function OddsChart({
  side,
  compact = false,
}: {
  side: OddsSide | null
  compact?: boolean
}) {
  const [hovered, setHovered] = useState<OddsChartHover | null>(null)

  if (!side) {
    return (
      <div className={`odds-chart ${compact ? 'compact' : ''}`}>
        <div className="odds-chart-head">
          <small>Draw odds</small>
          <strong>No parsed odds</strong>
        </div>
      </div>
    )
  }

  const tiers = allOddsTiers(side)
  const maxPoints = Math.max(1, ...tiers.map((tier) => tier.points))
  const chartWidth = 360
  const chartHeight = compact ? 88 : 198
  const margins = compact
    ? { top: 10, right: 12, bottom: 10, left: 32 }
    : { top: 18, right: 18, bottom: 42, left: 42 }
  const innerWidth = chartWidth - margins.left - margins.right
  const innerHeight = chartHeight - margins.top - margins.bottom
  const xFor = (points: number) => margins.left + (points / maxPoints) * innerWidth
  const yFor = (chance: number) => margins.top + ((100 - chance) / 100) * innerHeight
  const yTicks = compact ? [0, 50, 100] : [0, 25, 50, 75, 100]
  const xTicks = compact ? [] : pointTicks(maxPoints)
  const labeledTiers = chartLabelTiers(tiers, compact)
  const oddsPath = tiers
    .map((tier) => `${xFor(tier.points)},${yFor(tier.chance)}`)
    .join(' ')

  return (
    <div className={`odds-chart ${compact ? 'compact' : ''}`}>
      <div className="odds-chart-head">
        <small>{compact ? 'Points vs odds' : 'Point tier draw odds'}</small>
        <strong>{probableSummaryText(side)}</strong>
      </div>
      {tiers.length > 0 ? (
        <div className="chart-wrap">
          <svg
            className="odds-svg"
            viewBox={`0 0 ${chartWidth} ${chartHeight}`}
            role="img"
            aria-label="Draw odds chart by preference point tier"
          >
            {yTicks.map((tick) => {
              const y = yFor(tick)
              return (
                <g key={`y-${tick}`}>
                  <line
                    className="chart-grid-line"
                    x1={margins.left}
                    x2={chartWidth - margins.right}
                    y1={y}
                    y2={y}
                  />
                  <text className="chart-tick-label" x={margins.left - 7} y={y + 4} textAnchor="end">
                    {tick}%
                  </text>
                </g>
              )
            })}
            {xTicks.map((tick) => {
              const x = xFor(tick)
              return (
                <g key={`x-${tick}`}>
                  <line
                    className="chart-tick-line"
                    x1={x}
                    x2={x}
                    y1={margins.top}
                    y2={chartHeight - margins.bottom}
                  />
                  <text
                    className="chart-tick-label"
                    x={x}
                    y={chartHeight - margins.bottom + 18}
                    textAnchor="middle"
                  >
                    {tick}
                  </text>
                </g>
              )
            })}
            {!compact && (
              <>
                <line
                  className="chart-axis"
                  x1={margins.left}
                  x2={chartWidth - margins.right}
                  y1={chartHeight - margins.bottom}
                  y2={chartHeight - margins.bottom}
                />
                <line
                  className="chart-axis"
                  x1={margins.left}
                  x2={margins.left}
                  y1={margins.top}
                  y2={chartHeight - margins.bottom}
                />
                <text
                  className="chart-axis-label"
                  x={(margins.left + chartWidth - margins.right) / 2}
                  y={chartHeight - 7}
                  textAnchor="middle"
                >
                  Points
                </text>
                <text
                  className="chart-axis-label"
                  x={8}
                  y={margins.top + innerHeight / 2}
                  textAnchor="middle"
                  transform={`rotate(-90 8 ${margins.top + innerHeight / 2})`}
                >
                  Odds %
                </text>
              </>
            )}
            {tiers.length > 1 && <polyline className="chart-odds-line" points={oddsPath} />}
            {labeledTiers.map((tier, index) => {
              const x = xFor(tier.points)
              const y = yFor(tier.chance)
              const placeBelow = tier.chance >= 82
              const offset = compact ? 10 + (index % 2) * 9 : 12
              const labelY = clampNumber(
                y + (placeBelow ? offset : -offset),
                margins.top + 8,
                chartHeight - margins.bottom - 5,
              )
              return (
                <text
                  key={`label-${tier.points}`}
                  className="chart-point-label"
                  x={x}
                  y={labelY}
                  textAnchor="middle"
                >
                  {pointLabel(tier)}
                </text>
              )
            })}
            {tiers.map((tier) => {
              const x = xFor(tier.points)
              const y = yFor(tier.chance)
              const hoverPayload = {
                tier,
                xPercent: (x / chartWidth) * 100,
                yPercent: (y / chartHeight) * 100,
              }
              return (
                <g
                  key={tier.points}
                  className="chart-dot-group"
                  onClick={() => setHovered(hoverPayload)}
                  onMouseEnter={() => setHovered(hoverPayload)}
                  onMouseLeave={() => setHovered(null)}
                  onMouseMove={() => setHovered(hoverPayload)}
                  onMouseOver={() => setHovered(hoverPayload)}
                  onPointerEnter={() => setHovered(hoverPayload)}
                  onPointerLeave={() => setHovered(null)}
                  onPointerMove={() => setHovered(hoverPayload)}
                  onPointerOver={() => setHovered(hoverPayload)}
                >
                  <circle className="chart-hit-area" cx={x} cy={y} r={compact ? 10 : 14} />
                  <circle className="chart-dot" cx={x} cy={y} r={compact ? 4 : 6} />
                  <title>{oddsTooltipText(tier)}</title>
                </g>
              )
            })}
          </svg>
          {hovered && (
            <div
              className="odds-tooltip"
              style={{
                left: `${clampNumber(hovered.xPercent, 24, 76)}%`,
                top: `${clampNumber(hovered.yPercent, compact ? 26 : 24, 72)}%`,
              }}
            >
              <strong>{hovered.tier.points} pts</strong>
              <span>{formatPercent(hovered.tier.chance)} draw odds</span>
              <small>
                {hovered.tier.eligibleApplicants} applicants / {hovered.tier.totalPermits} permits
              </small>
            </div>
          )}
        </div>
      ) : (
        <p className="muted odds-empty">
          No permits issued in parsed point rows.
        </p>
      )}
    </div>
  )
}

function compareHunts(
  a: Hunt,
  b: Hunt,
  sortMode: SortMode,
  residency: Residency,
) {
  if (sortMode === 'draw') {
    return drawScore(a, residency) - drawScore(b, residency)
  }
  if (sortMode === 'success') {
    return (b.harvest?.successRate ?? -1) - (a.harvest?.successRate ?? -1)
  }
  if (sortMode === 'opportunity') {
    return (opportunityScore(b, residency) ?? -1) - (opportunityScore(a, residency) ?? -1)
  }
  if (sortMode === 'season') {
    return seasonScore(a) - seasonScore(b)
  }
  return quotaScore(b) - quotaScore(a)
}

function probableOddsTiers(side: OddsSide) {
  return stableOddsTiers(side).filter((tier) => tier.chance >= PROBABLE_CHANCE)
}

function pointTicks(maxPoints: number) {
  const targetCount = 6
  if (maxPoints <= targetCount - 1) {
    return Array.from({ length: maxPoints + 1 }, (_, index) => index)
  }

  const step = Math.max(1, Math.ceil(maxPoints / (targetCount - 1)))
  const ticks: number[] = []
  for (let value = 0; value < maxPoints; value += step) {
    ticks.push(value)
  }
  if (ticks[ticks.length - 1] !== maxPoints) ticks.push(maxPoints)
  return ticks
}

function chartLabelTiers(tiers: OddsTier[], compact: boolean) {
  const maxLabels = compact ? 12 : 18
  if (tiers.length <= maxLabels) return tiers

  const labeledPoints = new Set<number>([
    tiers[0].points,
    tiers[tiers.length - 1].points,
  ])
  for (const target of [PROBABLE_CHANCE, 50, 75, 100]) {
    const tier = tiers.find((candidate) => candidate.chance >= target)
    if (tier) labeledPoints.add(tier.points)
  }

  return tiers.filter((tier) => labeledPoints.has(tier.points))
}

function pointLabel(tier: OddsTier) {
  return `${tier.points}p ${formatPercent(tier.chance)}`
}

function oddsTooltipText(tier: OddsTier) {
  return `${tier.points} pts: ${formatPercent(tier.chance)} draw odds; ${tier.eligibleApplicants} applicants / ${tier.totalPermits} permits`
}

function allOddsTiers(side: OddsSide) {
  return side.byPoint
    .map((row) => {
      const chance = oddsChance(row)
      return chance === null ? null : { ...row, chance }
    })
    .filter((row): row is OddsTier => Boolean(row))
    .sort((a, b) => a.points - b.points)
}

function stableOddsTiers(side: OddsSide) {
  return allOddsTiers(side).filter(
    (tier) => tier.eligibleApplicants >= MIN_STABLE_ODDS_APPLICANTS,
  )
}

function oddsChance(row: OddsPoint) {
  if (!row.successRatioValue || row.totalPermits === 0) return null
  return Math.min(100, 100 / row.successRatioValue)
}

function bestStableOddsTier(side: OddsSide) {
  return stableOddsTiers(side).sort((a, b) => b.chance - a.chance)[0] ?? null
}

function firstCertainTier(side: OddsSide) {
  return allOddsTiers(side).find((tier) => tier.chance >= 99.5) ?? null
}

function probableSummaryText(side: OddsSide) {
  const probable = probableOddsTiers(side)
  const certain = firstCertainTier(side)
  if (probable.length > 0) {
    const first = probable[0]
    if (certain && certain.points !== first.points) {
      return `${PROBABLE_CHANCE}%+ at ${first.points} pts; 100% at ${certain.points} pts`
    }
    if (certain) return `${PROBABLE_CHANCE}%+ and 100% at ${first.points} pts`
    return `${PROBABLE_CHANCE}%+ at ${first.points} pts`
  }
  if (certain) return `100% reported at ${certain.points} pts`
  const stableBest = bestStableOddsTier(side)
  if (stableBest) {
    return `Best row: ${formatPercent(stableBest.chance)} at ${stableBest.points} pts`
  }
  return allOddsTiers(side).length > 0
    ? `No reliable ${PROBABLE_CHANCE}%+ tier`
    : 'No issued permits'
}

function firstProbablePointText(side: OddsSide) {
  const first = probableOddsTiers(side)[0]
  if (!first) {
    return allOddsTiers(side).length > 0
      ? `No reliable ${PROBABLE_CHANCE}%+ tier`
      : `No ${PROBABLE_CHANCE}%+ tier`
  }
  return `${first.points} points (${formatPercent(first.chance)})`
}

function drawScore(hunt: Hunt, residency: Residency) {
  const p50Estimate = estimateP50Draw(hunt, residency)
  if (p50Estimate) {
    return p50Estimate.years * 100 + (p50Estimate.pointLevel ?? 0)
  }
  const drawProfileOdds = hunt.drawProfile?.[residency]?.odds
  if (drawProfileOdds !== null && drawProfileOdds !== undefined) {
    return 8000 - drawProfileOdds
  }
  if (hunt.drawOut) {
    return drawOutScore(hunt.drawOut[residency])
  }
  const side = hunt.odds?.[residency]
  if (!side) return 9999
  const probable = probableOddsTiers(side)
  if (probable.length > 0) {
    return probable[0].points * 100 - probable[0].chance
  }
  const best = bestStableOddsTier(side)
  if (best) return 9000 - best.chance
  return 9999
}

function drawProfileHeadline(
  profile: NonNullable<Hunt['drawProfile']>,
  side: DrawProfileSide | null,
) {
  if (!side) return 'No result for this residency'
  if (profile.system === 'random') {
    return side.odds === null ? 'Random draw; odds not reported' : `${formatPercent(side.odds)} first-choice odds`
  }
  const randomPool = side.pools.find((pool) => /regular random|random draw|first-choice/i.test(pool.label))
    ?? side.pools[0]
  const certainTier = usefulDrawTiers(side)
    .filter((tier) => tier.odds !== null && tier.odds >= 99.5)
    .sort((a, b) => Number(a.label) - Number(b.label))[0]
  const parts = []
  if (randomPool?.odds !== null && randomPool?.odds !== undefined) {
    parts.push(`${formatPercent(randomPool.odds)} ${randomPool.label.toLowerCase()}`)
  }
  if (certainTier) parts.push(`100% at ${certainTier.label} pts`)
  return parts.join('; ') || 'Pool-specific draw results'
}

function usefulDrawTiers(side: DrawProfileSide | null) {
  if (!side) return []
  const regularTiers = side.pointTiers.filter((tier) => /regular|preference draw/i.test(tier.pool ?? ''))
  const candidates = regularTiers.length > 0 ? regularTiers : side.pointTiers
  return candidates
    .filter((tier) => /^\d+(?:\.\d+)?$/.test(tier.label.trim()))
    .sort((a, b) => Number(a.label) - Number(b.label))
}

function drawPoolCountText(pool: DrawPool) {
  if (pool.applicants !== null && pool.permits !== null) {
    return `${pool.permits} permits / ${pool.applicants} applicants`
  }
  if (pool.permits !== null) return `${pool.permits} permits`
  return 'Official reported result'
}

function drawOutScore(side: DrawOutSide) {
  const value = side.drawnOutAt?.toLowerCase() ?? ''
  if (!value) return 9999
  if (value.includes('leftover')) return -100
  if (value.includes('choice 4')) return 0
  if (value.includes('choice 3')) return 100
  if (value.includes('choice 2')) return 200
  if (value.includes('choice 1')) return 300
  if (value.includes('0 pref')) return 400
  if (value.includes('none drawn') || value.includes('no apps')) return 9500
  const points = Number(value.match(/(\d+)/)?.[1] ?? 99)
  return 500 + points * 100
}

function drawOutHeadline(drawOut: NonNullable<Hunt['drawOut']>, residency: Residency) {
  const side = drawOut[residency]
  return side.drawnOutAt
    ? `${residencyLabel(residency)}: ${side.drawnOutAt}`
    : `${residencyLabel(residency)} not drawn`
}

function drawOutSideText(side: DrawOutSide) {
  const status = side.drawnOutAt ?? 'Not issued in parsed adult column'
  const finalLevel = drawOutFinalLevelText(side)
  return finalLevel === 'N/A' ? status : `${status}; ${finalLevel}`
}

function drawOutFinalLevelText(side: DrawOutSide) {
  if (side.finalDrawn !== null && side.finalApplicants !== null) {
    return `${side.finalDrawn} of ${side.finalApplicants} at final level`
  }
  return side.finalLevel ?? 'N/A'
}

function seasonScore(hunt: Hunt) {
  const match = hunt.seasonDateText?.match(/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sept?|Oct|Nov|Dec|\d{1,2})/i)
  return match ? hunt.huntNumber.charCodeAt(0) * 100 + match.index! : 99999
}

function quotaScore(hunt: Hunt) {
  if (!hunt.quota) return hunt.harvest?.permits ?? 0
  return hunt.quota.total || hunt.quota.resident + hunt.quota.nonresident
}

function pointSummaryText(side: OddsSide) {
  const certain = firstCertainTier(side)
  if (certain) {
    return `${certain.points} pts`
  }
  const best = bestStableOddsTier(side)
  if (best) {
    return `Best: ${formatPercent(best.chance)} at ${best.points} pts`
  }
  return allOddsTiers(side).length > 0 ? 'No reliable 100% tier' : 'N/A'
}

function categoryOptionsFor(state: PlannerState) {
  if (state === 'idaho') {
    return categoryOptions.map((option) => ({
      ...option,
      label: option.value === 'limited-entry'
        ? 'Controlled draw'
        : option.value === 'general-otc'
          ? 'General tags'
          : option.label,
    }))
  }
  if (state === 'wyoming') {
    return categoryOptions.map((option) => ({
      ...option,
      label: option.value === 'limited-entry'
        ? 'Limited quota'
        : option.value === 'general-otc'
          ? 'General license'
          : option.label,
    }))
  }
  return categoryOptions
}

function categoryLabel(value: Category | Hunt['category'], state?: PlannerState) {
  const labels: Record<string, string> = {
    all: 'All',
    'general-otc': 'General/OTC',
    'limited-entry': 'Limited entry',
    antlerless: 'Antlerless',
    'once-in-a-lifetime': 'Once-in-a-lifetime',
    cwmu: 'CWMU',
    conservation: 'Conservation',
    other: 'Other',
  }
  if (state === 'idaho' && value === 'limited-entry') return 'Controlled draw'
  if (state === 'idaho' && value === 'general-otc') return 'General tags'
  if (state === 'wyoming' && value === 'limited-entry') return 'Limited quota'
  if (state === 'wyoming' && value === 'general-otc') return 'General license'
  return labels[value] ?? value
}

function residencyLabel(value: Residency) {
  return value === 'resident' ? 'Resident' : 'Nonresident'
}

function quotaText(hunt: Hunt) {
  if (hunt.state === 'colorado') return 'See CPW draw report'
  if (hunt.state === 'wyoming') return 'Varies by license type and draw pool'
  if (!hunt.quota) return hunt.harvest ? `${hunt.harvest.permits} in harvest report` : 'N/A'
  const total = hunt.quota.total || hunt.quota.resident + hunt.quota.nonresident
  if (total === 0) return 'Unlimited or not listed'
  return `${total} total (${hunt.quota.resident} R / ${hunt.quota.nonresident} NR)`
}

function getInitialView(): AppView {
  if (typeof window === 'undefined') return 'planner'
  const pathname = window.location.pathname.replace(/\/+$/, '') || '/'
  return pathname === '/contact' ? 'contact' : 'planner'
}

function getInitialShareState() {
  const fallback: {
    hunt: Hunt | null
    residency: Residency
    state: PlannerState
    species: string
    category: Category
    weapon: string
  } = {
    hunt: null,
    residency: 'resident',
    state: 'utah',
    species: 'Elk',
    category: 'all',
    weapon: 'all',
  }
  if (typeof window === 'undefined') return fallback

  const params = new URLSearchParams(window.location.search)
  const stateParam = params.get('state')
  const state: PlannerState =
    stateParam === 'wy' || stateParam === 'wyoming'
      ? 'wyoming'
      : stateParam === 'id' || stateParam === 'idaho'
        ? 'idaho'
        : stateParam === 'co' || stateParam === 'colorado'
      ? 'colorado'
      : stateParam === 'ut' || stateParam === 'utah'
        ? 'utah'
        : fallback.state
  const huntNumber =
    params.get('hunt') ?? params.get('huntNumber') ?? params.get('HN') ?? ''
  const normalizedHuntNumber = huntNumber.trim().toLowerCase()
  const hunt =
    allHunts.find(
      (candidate) =>
        (normalizePlannerState(candidate.state) ?? 'utah') === state &&
        (
        candidate.huntNumber.toLowerCase() === normalizedHuntNumber ||
        candidate.id.toLowerCase() === normalizedHuntNumber
        ),
    ) ?? null
  const residencyParam = params.get('residency')
  const residency: Residency =
    residencyParam === 'nonresident' || residencyParam === 'resident'
      ? residencyParam
      : fallback.residency

  const resolvedState = normalizePlannerState(hunt?.state) ?? state
  const stateHunts = plannerDataByState[resolvedState].hunts
  const speciesParam = params.get('species')?.trim()
  const species = hunt?.species
    ?? (speciesParam && stateHunts.some((candidate) => candidate.species === speciesParam)
      ? speciesParam
      : unique(stateHunts.map((candidate) => candidate.species)).sort()[0] ?? fallback.species)

  const categoryParam = params.get('huntType') ?? params.get('category')
  const categoryMatchesState = categoryParam === 'all'
    || stateHunts.some(
      (candidate) => candidate.species === species && candidate.category === categoryParam,
    )
  const categoryMatchesHunt = !hunt
    || categoryParam === 'all'
    || hunt.category === categoryParam
  const category: Category = categoryParam && categoryMatchesState && categoryMatchesHunt
    ? categoryParam as Category
    : fallback.category

  const weaponParam = params.get('weapon')
  const weaponMatchesState = weaponParam === 'all'
    || stateHunts.some(
      (candidate) =>
        candidate.species === species
        && (category === 'all' || candidate.category === category)
        && weaponFilterValue(candidate, resolvedState, species) === weaponParam,
    )
  const weaponMatchesHunt = !hunt
    || weaponParam === 'all'
    || weaponFilterValue(hunt, resolvedState, species) === weaponParam
  const weapon = weaponParam && weaponMatchesState && weaponMatchesHunt
    ? weaponParam
    : fallback.weapon

  return { hunt, residency, state: resolvedState, species, category, weapon }
}

function normalizePlannerState(value: unknown): PlannerState | null {
  return value === 'wy' || value === 'wyoming'
    ? 'wyoming'
    : value === 'id' || value === 'idaho'
      ? 'idaho'
      : value === 'co' || value === 'colorado'
    ? 'colorado'
    : value === 'ut' || value === 'utah'
      ? 'utah'
      : null
}

function selectedHuntUrl(
  hunt: Hunt,
  residency: Residency,
  filters?: PlannerFilters,
) {
  const url = appUrl('/')
  url.searchParams.set('state', stateCode(normalizePlannerState(hunt.state) ?? 'utah'))
  url.searchParams.set('hunt', hunt.huntNumber)
  url.searchParams.set('residency', residency)
  if (filters) {
    url.searchParams.set('species', filters.species)
    url.searchParams.set('huntType', filters.category)
    url.searchParams.set('weapon', filters.weapon)
    url.hash = 'planner'
  }
  return url.toString()
}

function contactPageUrl(hunt?: Hunt | null, residency?: Residency) {
  const url = appUrl('/contact')
  if (hunt && residency) {
    url.searchParams.set('state', stateCode(normalizePlannerState(hunt.state) ?? 'utah'))
    url.searchParams.set('hunt', hunt.huntNumber)
    url.searchParams.set('residency', residency)
  }
  return url.toString()
}

function appUrl(pathname: string) {
  if (typeof window === 'undefined') {
    return new URL(pathname, 'https://huntplanner-66d5e.web.app')
  }
  return new URL(pathname, window.location.origin)
}

function contactSubject(reason: ContactReason, huntNumber: string) {
  const prefix =
    reason === 'data-issue'
      ? 'Data issue'
      : reason === 'feedback'
        ? 'Feedback'
        : 'Question'
  return huntNumber.trim()
    ? `Hunt Planner ${prefix}: ${huntNumber.trim()}`
    : `Hunt Planner ${prefix}`
}

function contactBody({
  reason,
  name,
  replyEmail,
  hunt,
  huntNumber,
  message,
  residency,
}: ContactBodyInput) {
  return [
    `Reason: ${contactReasonLabel(reason)}`,
    `Name: ${name.trim() || 'Not provided'}`,
    `Reply email: ${replyEmail.trim() || 'Not provided'}`,
    `Hunt number: ${huntNumber.trim() || 'Not provided'}`,
    hunt ? `Hunt: ${hunt.huntName} (${hunt.huntNumber})` : null,
    hunt ? `Residency: ${residencyLabel(residency)}` : null,
    hunt ? `Hunt link: ${selectedHuntUrl(hunt, residency)}` : null,
    '',
    'Message:',
    message.trim(),
  ]
    .filter((line): line is string => line !== null)
    .join('\n')
}

function contactReasonLabel(reason: ContactReason) {
  if (reason === 'data-issue') return 'Report data issue'
  if (reason === 'feedback') return 'Feedback'
  return 'Question'
}

function replaceShareUrl(
  hunt: Hunt,
  residency: Residency,
  filters: PlannerFilters,
) {
  if (typeof window === 'undefined') return
  const nextUrl = selectedHuntUrl(hunt, residency, filters)
  if (nextUrl !== window.location.href) {
    window.history.replaceState(null, '', nextUrl)
  }
}

async function shareHuntLink(
  hunt: Hunt,
  residency: Residency,
  filters: PlannerFilters,
): Promise<ShareResult> {
  const shareUrl = selectedHuntUrl(hunt, residency, filters)
  const stateLabel = stateMeta[normalizePlannerState(hunt.state) ?? 'utah'].name
  const shareData = {
    title: `${stateLabel} Hunt Planner: ${hunt.huntName}`,
    text: `${hunt.huntNumber} - ${hunt.weapon || 'hunt'} for ${residencyLabel(residency).toLowerCase()} draw and harvest details.`,
    url: shareUrl,
  }

  if (
    typeof navigator !== 'undefined' &&
    navigator.share &&
    (!navigator.canShare || navigator.canShare(shareData))
  ) {
    try {
      await navigator.share(shareData)
      return 'shared'
    } catch (error) {
      if (isShareDismissal(error)) return 'dismissed'
    }
  }

  await copyTextToClipboard(shareUrl)
  return 'copied'
}

function isShareDismissal(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError'
}

async function copyTextToClipboard(shareUrl: string) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(shareUrl)
      return
    } catch {
      // Fall through to the manual copy path for browsers that block clipboard access.
    }
  }

  const input = document.createElement('textarea')
  input.value = shareUrl
  input.setAttribute('readonly', 'true')
  input.style.position = 'fixed'
  input.style.left = '-9999px'
  document.body.appendChild(input)
  input.select()
  const copied = document.execCommand('copy')
  document.body.removeChild(input)
  if (!copied && window.prompt) {
    window.prompt('Copy this hunt link:', shareUrl)
    return
  }
  if (!copied) throw new Error('Unable to copy share link')
}

function huntBoundaryUrl(hunt: Hunt) {
  if (hunt.state === 'utah' || !hunt.state) {
    return `https://dwrapps.utah.gov/huntboundary/?HN=${encodeURIComponent(hunt.huntNumber)}`
  }
  return hunt.currentSourceUrl || stateMeta[normalizePlannerState(hunt.state) ?? 'utah'].primarySourceUrl
}

function harvestedHuntersText(harvest: NonNullable<Hunt['harvest']>, compact = false) {
  if (compact) return `${harvest.harvest} / ${harvest.huntersAfield}`
  return `${harvest.harvest} of ${harvest.huntersAfield} hunters afield`
}

function averageDaysText(harvest: NonNullable<Hunt['harvest']>) {
  return `${harvest.averageDays.toFixed(1)} days`
}

function p50DrawText(estimate: DrawTimeEstimate) {
  const years = `${estimate.years} ${estimate.years === 1 ? 'yr' : 'yrs'}`
  return estimate.pointLevel === null ? years : `${years} / ${estimate.pointLevel} pts`
}

function formatOpportunityScore(value: number) {
  return `${value.toFixed(1)} / 100`
}

function weaponFilterValue(
  hunt: Hunt,
  plannerState: PlannerState,
  species: string,
) {
  const splitUtahElkSeason = (
    plannerState === 'utah'
    && species === 'Elk'
    && hunt.category === 'limited-entry'
    && hunt.weapon === 'Any Legal Weapon'
  )
  if (!splitUtahElkSeason) return hunt.weapon

  const month = seasonStartMonth(hunt.seasonDateText)
  return month ? `${hunt.weapon}::${month}` : hunt.weapon
}

function weaponFilterLabel(value: string) {
  const [weaponName, month] = value.split('::')
  return month ? `${weaponName} - ${month}` : value
}

function seasonStartMonth(value: string | null) {
  const match = value?.match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sept?|Oct|Nov|Dec)\b/i)
  if (!match) return null
  return ({
    jan: 'January',
    feb: 'February',
    mar: 'March',
    apr: 'April',
    may: 'May',
    jun: 'June',
    jul: 'July',
    aug: 'August',
    sep: 'September',
    sept: 'September',
    oct: 'October',
    nov: 'November',
    dec: 'December',
  } as Record<string, string>)[match[1].toLowerCase()] ?? null
}

function shortSeason(value: string | null) {
  if (!value) return 'No date'
  return value.length > 28 ? `${value.slice(0, 28)}...` : value
}

function sourceName(link: string) {
  if (link.includes('25_bg-odds')) return '2025 limited-entry odds PDF'
  if (link.includes('25_deer_odds')) return '2025 general-season buck deer odds PDF'
  if (link.includes('2025_gs_buck_deer')) return '2025 general-season buck deer harvest PDF'
  if (link.includes('2024_le_oial')) return '2024 limited-entry harvest PDF'
  if (link.includes('2024_antlerless')) return '2024 antlerless harvest PDF'
  if (link.includes('huntboundary')) return 'UDWR Hunt Planner'
  if (link.includes('ndismaps.nrel.colostate.edu')) return 'CPW Hunt Atlas'
  if (link.includes('cpw.state.co.us')) return 'CPW statistics page'
  if (link.includes('idfg.idaho.gov')) return 'Idaho Fish and Game Hunt Planner'
  if (link.includes('wgfd.wyo.gov')) return 'Wyoming Game and Fish Hunt Planner'
  if (link.includes('widen.net') || link.includes('widencdn.net') || link.includes('widencollective.com')) {
    return 'CPW report PDF'
  }
  return 'Agency source'
}

function stateCode(state: PlannerState) {
  return { utah: 'ut', colorado: 'co', idaho: 'id', wyoming: 'wy' }[state]
}

function sourceTypeLabel(type: Report['sourceType']) {
  const labels: Record<string, string> = {
    'draw-odds': 'Draw odds',
    harvest: 'Harvest',
    'draw-recap': 'Draw recap',
    'drawn-out': 'Drawn out',
    'secondary-draw': 'Secondary draw',
    population: 'Population',
    'otc-sales': 'OTC sales',
  }
  return labels[type] ?? type
}

function formatPercent(value: number) {
  if (!Number.isFinite(value)) return 'N/A'
  return `${value.toFixed(value >= 10 ? 0 : 1)}%`
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function unique<T>(values: Array<T | null | undefined>) {
  return [...new Set(values.filter((value): value is T => Boolean(value)))]
}

export default App

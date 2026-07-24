import { useEffect, useMemo, useState } from 'react'
import {
  ArrowUp,
  ChevronLeft,
  Clock,
  Eye,
  Flag,
  Lock,
  MapPin,
  MessageCircle,
  MessageSquare,
  Pin,
  Plus,
  Search,
  Send,
  Shield,
  User,
  X,
} from 'lucide-react'
import {
  CommunityAuthError,
  createCommunityPost,
  createCommunityReply,
  loadCommunityModerationReports,
  loadCommunityPosts,
  loadCommunityThread,
  loadCommunityUser,
  moderateCommunityReport,
  reportCommunityPost,
  toggleCommunityHelpful,
} from './api'
import {
  firebaseAuthErrorMessage,
  signInWithGoogle,
  signOutOfFirebase,
  subscribeToFirebaseAuth,
} from '../firebase'
import type {
  CommunityCategory,
  CommunityDraft,
  CommunityFilters,
  CommunityPost,
  CommunitySort,
  CommunityThread,
  CommunityUser,
  ModeratorAction,
  ModeratorReport,
} from './types'
import './community.css'

const categories: Array<{
  value: CommunityCategory | 'all'
  label: string
  shortLabel: string
  description: string
}> = [
  {
    value: 'all',
    label: 'All discussions',
    shortLabel: 'All',
    description: 'Every camp conversation',
  },
  {
    value: 'draws',
    label: 'Draws & applications',
    shortLabel: 'Draws',
    description: 'Odds, points, deadlines, strategy',
  },
  {
    value: 'planning',
    label: 'Hunt planning',
    shortLabel: 'Planning',
    description: 'Units, access, terrain, seasons',
  },
  {
    value: 'gear',
    label: 'Gear & fieldcraft',
    shortLabel: 'Gear',
    description: 'Optics, packs, camp, skills',
  },
  {
    value: 'reports',
    label: 'Hunt reports',
    shortLabel: 'Reports',
    description: 'Lessons from time in the field',
  },
  {
    value: 'campfire',
    label: 'General campfire',
    shortLabel: 'Campfire',
    description: 'Introductions and broad discussion',
  },
  {
    value: 'feedback',
    label: 'Site feedback',
    shortLabel: 'Feedback',
    description: 'Data questions and feature ideas',
  },
]

const stateOptions = [
  { value: '', label: 'All states' },
  { value: 'UT', label: 'Utah' },
  { value: 'CO', label: 'Colorado' },
  { value: 'ID', label: 'Idaho' },
  { value: 'WY', label: 'Wyoming' },
]

const sortOptions: Array<{ value: CommunitySort; label: string }> = [
  { value: 'active', label: 'Active' },
  { value: 'new', label: 'Newest' },
  { value: 'top', label: 'Helpful' },
  { value: 'unanswered', label: 'Unanswered' },
]

const initialDraft: CommunityDraft = {
  title: '',
  body: '',
  category: 'planning',
  postType: 'question',
  state: '',
  species: '',
  huntNumber: '',
}

const DRAFT_KEY = 'hunt-planner-community-draft'
const AUTH_INTENT_KEY = 'hunt-planner-community-auth-intent'

export function CommunityBoard() {
  const [filters, setFilters] = useState<CommunityFilters>(() => filtersFromLocation())
  const [posts, setPosts] = useState<CommunityPost[]>([])
  const [postsLoading, setPostsLoading] = useState(true)
  const [isPreview, setIsPreview] = useState(false)
  const [user, setUser] = useState<CommunityUser | null>(null)
  const [sessionLoaded, setSessionLoaded] = useState(false)
  const [firebaseSignedIn, setFirebaseSignedIn] = useState(false)
  const [authBusy, setAuthBusy] = useState(false)
  const [authError, setAuthError] = useState('')
  const [selectedPostId, setSelectedPostId] = useState<string | null>(() => threadIdFromLocation())
  const [thread, setThread] = useState<CommunityThread | null>(null)
  const [threadLoadSettledId, setThreadLoadSettledId] = useState<string | null>(null)
  const [composerOpen, setComposerOpen] = useState(false)
  const [draft, setDraft] = useState<CommunityDraft>(() => draftFromStorageOrLocation())
  const [mutationError, setMutationError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [replyBody, setReplyBody] = useState('')
  const [reportOpen, setReportOpen] = useState(false)
  const [reportReason, setReportReason] = useState('sensitive-location')
  const [reported, setReported] = useState(false)
  const [shareLabel, setShareLabel] = useState('Share')
  const [moderationOpen, setModerationOpen] = useState(false)
  const [moderatorReports, setModeratorReports] = useState<ModeratorReport[]>([])
  const [moderationLoading, setModerationLoading] = useState(false)
  const [moderationError, setModerationError] = useState('')
  const [moderationActionId, setModerationActionId] = useState<string | null>(null)
  const threadLoading = Boolean(selectedPostId && threadLoadSettledId !== selectedPostId)
  const authPending = authBusy || !sessionLoaded
  const authPendingLabel = sessionLoaded ? 'Opening sign in…' : 'Checking account…'

  useEffect(() => {
    let active = true
    let requestId = 0
    const unsubscribe = subscribeToFirebaseAuth(
      (signedIn) => {
        const currentRequest = ++requestId
        setFirebaseSignedIn(signedIn)
        if (signedIn) setAuthError('')
        if (!signedIn) {
          setUser(null)
          setSessionLoaded(true)
          setAuthBusy(false)
          return
        }

        setSessionLoaded(false)
        void loadCommunityUser()
          .then((nextUser) => {
            if (!active || currentRequest !== requestId) return
            if (!nextUser) {
              throw new Error('Your community account could not be loaded. Please try again.')
            }
            setUser(nextUser)
            const params = new URLSearchParams(window.location.search)
            const authIntent = window.sessionStorage.getItem(AUTH_INTENT_KEY)
            if (authIntent === 'compose' || params.get('compose') === '1') {
              window.sessionStorage.removeItem(AUTH_INTENT_KEY)
              setComposerOpen(true)
            }
          })
          .catch((error) => {
            if (!active || currentRequest !== requestId) return
            setUser(null)
            setAuthError(
              error instanceof Error
                ? error.message
                : 'Your community account could not be loaded. Please try again.',
            )
          })
          .finally(() => {
            if (!active || currentRequest !== requestId) return
            setSessionLoaded(true)
            setAuthBusy(false)
          })
      },
      (error) => {
        if (!active) return
        setAuthError(firebaseAuthErrorMessage(error))
        setSessionLoaded(true)
        setAuthBusy(false)
      },
    )
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    const handlePopState = () => {
      setSelectedPostId(threadIdFromLocation())
      setFilters(filtersFromLocation())
      setComposerOpen(false)
      setMutationError('')
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  useEffect(() => {
    if (selectedPostId) return
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setPostsLoading(true)
      void loadCommunityPosts(filters, controller.signal)
        .then((result) => {
          setPosts(result.data)
          setIsPreview(result.isPreview)
          syncFiltersToUrl(filters)
        })
        .catch(() => undefined)
        .finally(() => setPostsLoading(false))
    }, filters.query ? 240 : 0)

    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [filters, selectedPostId, user])

  useEffect(() => {
    if (!selectedPostId) return

    const controller = new AbortController()
    void loadCommunityThread(selectedPostId, controller.signal)
      .then((result) => {
        setThread(result.data)
        setIsPreview(result.isPreview)
        setThreadLoadSettledId(selectedPostId)
      })
      .catch(() => undefined)

    return () => controller.abort()
  }, [selectedPostId, user])

  useEffect(() => {
    if (!composerOpen) return
    window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft))
  }, [composerOpen, draft])

  useEffect(() => {
    if (!composerOpen && !reportOpen && !moderationOpen) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setComposerOpen(false)
      setReportOpen(false)
      setModerationOpen(false)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [composerOpen, moderationOpen, reportOpen])

  const category = useMemo(
    () => categories.find((item) => item.value === filters.category) ?? categories[0],
    [filters.category],
  )

  const requestSignIn = async (intent: 'participate' | 'compose' = 'participate') => {
    setAuthError('')
    if (intent === 'compose') {
      window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft))
      window.sessionStorage.setItem(AUTH_INTENT_KEY, 'compose')
    }
    setAuthBusy(true)
    try {
      await signInWithGoogle()
    } catch (error) {
      setAuthError(firebaseAuthErrorMessage(error))
      setAuthBusy(false)
    }
  }

  const signOut = async () => {
    setAuthError('')
    setAuthBusy(true)
    try {
      await signOutOfFirebase()
      setComposerOpen(false)
      setModerationOpen(false)
    } catch {
      setAuthError('You could not be signed out. Please try again.')
    } finally {
      setAuthBusy(false)
    }
  }

  const openComposer = () => {
    setMutationError('')
    if (!user) {
      void requestSignIn('compose')
      return
    }
    setComposerOpen(true)
  }

  const openThread = (post: CommunityPost) => {
    const nextPath = `/community/thread/${encodeURIComponent(post.id)}/${slugify(post.title)}`
    window.history.pushState(null, '', nextPath)
    setSelectedPostId(post.id)
    setThread(null)
    setMutationError('')
    window.scrollTo({ top: 0, behavior: 'auto' })
  }

  const closeThread = () => {
    window.history.pushState(null, '', '/community')
    setSelectedPostId(null)
    setThread(null)
    setMutationError('')
    window.scrollTo({ top: 0, behavior: 'auto' })
  }

  const submitPost = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setMutationError('')
    setSubmitting(true)
    try {
      const post = await createCommunityPost(draft)
      window.sessionStorage.removeItem(DRAFT_KEY)
      setDraft(initialDraft)
      setComposerOpen(false)
      openThread(post)
    } catch (error) {
      handleMutationError(error)
    } finally {
      setSubmitting(false)
    }
  }

  const submitReply = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!thread) return
    setMutationError('')
    setSubmitting(true)
    try {
      await createCommunityReply(thread.post.id, replyBody)
      const result = await loadCommunityThread(thread.post.id)
      setThread(result.data)
      setReplyBody('')
    } catch (error) {
      handleMutationError(error)
    } finally {
      setSubmitting(false)
    }
  }

  const toggleHelpful = async () => {
    if (!thread) return
    if (!user) {
      void requestSignIn()
      return
    }
    setMutationError('')
    try {
      const result = await toggleCommunityHelpful(thread.post.id)
      setThread({
        ...thread,
        post: {
          ...thread.post,
          score: result.score,
          viewerVote: result.viewerVote,
        },
      })
    } catch (error) {
      handleMutationError(error)
    }
  }

  const submitReport = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!thread) return
    if (!user) {
      void requestSignIn()
      return
    }
    setMutationError('')
    setSubmitting(true)
    try {
      await reportCommunityPost(thread.post.id, reportReason)
      setReported(true)
      setReportOpen(false)
    } catch (error) {
      handleMutationError(error)
    } finally {
      setSubmitting(false)
    }
  }

  const shareThread = async () => {
    if (!thread) return
    const data = {
      title: thread.post.title,
      text: `Join this Hunt Planner Community discussion: ${thread.post.title}`,
      url: window.location.href,
    }
    try {
      if (navigator.share) {
        await navigator.share(data)
        setShareLabel('Shared')
      } else {
        await navigator.clipboard.writeText(data.url)
        setShareLabel('Copied')
      }
      window.setTimeout(() => setShareLabel('Share'), 1600)
    } catch {
      setShareLabel('Share')
    }
  }

  const openModeration = async () => {
    if (!user?.isModerator) return
    setModerationOpen(true)
    setModerationLoading(true)
    setModerationError('')
    try {
      setModeratorReports(await loadCommunityModerationReports())
    } catch (error) {
      setModerationError(
        error instanceof Error ? error.message : 'The moderation queue could not be loaded.',
      )
    } finally {
      setModerationLoading(false)
    }
  }

  const handleModerationAction = async (
    report: ModeratorReport,
    action: ModeratorAction,
  ) => {
    if (action === 'remove') {
      const confirmed = window.confirm(
        `Remove “${report.postTitle}”? This discussion will no longer be visible.`,
      )
      if (!confirmed) return
    }

    setModerationError('')
    setModerationActionId(report.id)
    try {
      await moderateCommunityReport(report.id, action)
      setModeratorReports((current) => current.filter((item) => item.id !== report.id))
      if (thread?.post.id === report.postId) {
        if (action === 'lock') {
          setThread({
            ...thread,
            post: { ...thread.post, isLocked: true },
          })
        } else if (action === 'remove') {
          setThread(null)
        }
      }
    } catch (error) {
      setModerationError(
        error instanceof Error ? error.message : 'That moderation action could not be completed.',
      )
    } finally {
      setModerationActionId(null)
    }
  }

  const handleMutationError = (error: unknown) => {
    if (error instanceof CommunityAuthError) {
      setMutationError(error.message)
      setAuthError(error.message)
      return
    }
    setMutationError(error instanceof Error ? error.message : 'That action could not be completed.')
  }

  return (
    <main className="community-page">
      <section className="community-hero">
        <div className="community-hero-copy">
          <p className="eyebrow">Hunt Planner Community</p>
          <h2>Plan smarter together.</h2>
          <p>
            Ask about applications, compare hunts, and share field lessons—without giving away
            somebody else&apos;s spot.
          </p>
          <div className="community-access-note">
            <Eye size={15} aria-hidden="true" />
            Open for anyone to read. Sign in to take part.
          </div>
        </div>
        <div className="community-hero-actions">
          <button
            className="community-primary-button"
            type="button"
            onClick={openComposer}
            disabled={authPending}
          >
            <Plus size={17} aria-hidden="true" />
            {authPending && !user ? authPendingLabel : 'Start a discussion'}
          </button>
          {sessionLoaded && (
            user ? (
              <div className="community-account">
                <Avatar name={user.displayName} />
                <span>
                  <small>Signed in as</small>
                  <strong>{user.displayName}</strong>
                </span>
                <span className="community-account-actions">
                  {user.isModerator && (
                    <button
                      type="button"
                      onClick={() => void openModeration()}
                      aria-haspopup="dialog"
                    >
                      <Shield size={13} aria-hidden="true" />
                      Moderate
                    </button>
                  )}
                  <button type="button" onClick={() => void signOut()} disabled={authBusy}>
                    Sign out
                  </button>
                </span>
              </div>
            ) : firebaseSignedIn ? (
              <button
                className="community-secondary-button"
                type="button"
                onClick={() => void signOut()}
                disabled={authBusy}
              >
                Sign out and try another account
              </button>
            ) : (
              <button
                className="community-secondary-button"
                type="button"
                onClick={() => void requestSignIn()}
                disabled={authPending}
              >
                <User size={16} aria-hidden="true" />
                {authPending ? authPendingLabel : 'Sign in with Google'}
              </button>
            )
          )}
          {authError && (
            <p className="community-auth-error" role="alert">
              {authError}
            </p>
          )}
        </div>
      </section>

      {selectedPostId ? (
        <ThreadView
          thread={thread}
          loading={threadLoading}
          user={user}
          isPreview={isPreview}
          mutationError={mutationError}
          replyBody={replyBody}
          submitting={submitting}
          reportOpen={reportOpen}
          reported={reported}
          reportReason={reportReason}
          shareLabel={shareLabel}
          onBack={closeThread}
          onReplyBodyChange={setReplyBody}
          onReply={submitReply}
          onHelpful={toggleHelpful}
          onReportOpen={() => setReportOpen(true)}
          onReportClose={() => setReportOpen(false)}
          onReportReasonChange={setReportReason}
          onReport={submitReport}
          onShare={shareThread}
          onSignIn={() => void requestSignIn()}
          onStart={openComposer}
          authBusy={authPending}
          authBusyLabel={authPendingLabel}
        />
      ) : (
        <div className="community-layout">
          <aside className="community-category-rail" aria-label="Discussion categories">
            <p className="community-rail-title">Browse topics</p>
            <div className="community-category-list">
              {categories.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  className={filters.category === item.value ? 'active' : ''}
                  onClick={() => setFilters({ ...filters, category: item.value })}
                >
                  <span>{item.label}</span>
                  <small>{item.description}</small>
                </button>
              ))}
            </div>
          </aside>

          <section className="community-feed" aria-label="Community discussions">
            <div className="community-feed-head">
              <div>
                <p className="eyebrow">{category.shortLabel}</p>
                <h3>{category.label}</h3>
              </div>
              <button className="community-primary-button compact" type="button" onClick={openComposer}>
                <Plus size={16} aria-hidden="true" />
                Start discussion
              </button>
            </div>

            <div className="community-mobile-categories" aria-label="Discussion category">
              {categories.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  className={filters.category === item.value ? 'active' : ''}
                  onClick={() => setFilters({ ...filters, category: item.value })}
                >
                  {item.shortLabel}
                </button>
              ))}
            </div>

            <div className="community-feed-controls">
              <label className="community-search">
                <Search size={16} aria-hidden="true" />
                <span className="sr-only">Search discussions</span>
                <input
                  value={filters.query}
                  onChange={(event) => setFilters({ ...filters, query: event.target.value })}
                  placeholder="Search discussions"
                />
              </label>
              <label className="community-select">
                <span className="sr-only">State</span>
                <select
                  value={filters.state}
                  onChange={(event) => setFilters({ ...filters, state: event.target.value })}
                >
                  {stateOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="community-sort" aria-label="Sort discussions">
                {sortOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={filters.sort === option.value ? 'active' : ''}
                    onClick={() => setFilters({ ...filters, sort: option.value })}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            {isPreview && (
              <div className="community-preview-note">
                <MessageSquare size={16} aria-hidden="true" />
                Preview conversations are shown while the live community is starting up.
              </div>
            )}

            <div className="community-post-list" aria-live="polite">
              {postsLoading ? (
                Array.from({ length: 5 }, (_, index) => (
                  <div className="community-post-card loading" key={index} aria-hidden="true">
                    <i />
                    <i />
                    <i />
                  </div>
                ))
              ) : posts.length > 0 ? (
                posts.map((post) => (
                  <PostCard key={post.id} post={post} onOpen={() => openThread(post)} />
                ))
              ) : (
                <div className="community-empty">
                  <MessageCircle size={30} aria-hidden="true" />
                  <h4>No discussions match these filters.</h4>
                  <p>Try another topic or state, or start the first conversation.</p>
                  <button className="community-primary-button" type="button" onClick={openComposer}>
                    Start a discussion
                  </button>
                </div>
              )}
            </div>
          </section>

          <CommunitySidebar
            user={user}
            onStart={openComposer}
            authBusy={authPending}
            authBusyLabel={authPendingLabel}
          />
        </div>
      )}

      {composerOpen && (
        <ComposerModal
          draft={draft}
          submitting={submitting}
          error={mutationError}
          onChange={setDraft}
          onClose={() => setComposerOpen(false)}
          onSubmit={submitPost}
        />
      )}

      {moderationOpen && user?.isModerator && (
        <ModerationModal
          reports={moderatorReports}
          loading={moderationLoading}
          error={moderationError}
          actionId={moderationActionId}
          onClose={() => setModerationOpen(false)}
          onAction={handleModerationAction}
        />
      )}
    </main>
  )
}

function PostCard({ post, onOpen }: { post: CommunityPost; onOpen: () => void }) {
  return (
    <article className={`community-post-card category-${post.category}`}>
      <div className="community-post-score" aria-label={`${post.score} people found this helpful`}>
        <ArrowUp size={15} aria-hidden="true" />
        <strong>{post.score}</strong>
        <span>Helpful</span>
      </div>
      <div className="community-post-main">
        <div className="community-post-tags">
          {post.isPinned && (
            <span className="community-status-tag pinned">
              <Pin size={12} aria-hidden="true" />
              Pinned
            </span>
          )}
          {post.isStaff && (
            <span className="community-status-tag staff">
              <Shield size={12} aria-hidden="true" />
              Staff prompt
            </span>
          )}
          {post.isLocked && (
            <span className="community-status-tag">
              <Lock size={12} aria-hidden="true" />
              Locked
            </span>
          )}
          <CategoryTag category={post.category} />
          {post.state && <span className="community-context-tag">{post.state}</span>}
          {post.species && <span className="community-context-tag">{post.species}</span>}
          {post.huntNumber && (
            <span className="community-hunt-tag">
              <MapPin size={12} aria-hidden="true" />
              {post.huntNumber}
            </span>
          )}
        </div>
        <a
          className="community-post-title"
          href={`/community/thread/${encodeURIComponent(post.id)}/${slugify(post.title)}`}
          onClick={(event) => {
            event.preventDefault()
            onOpen()
          }}
        >
          {post.title}
        </a>
        <p className="community-post-excerpt">{post.body}</p>
        <div className="community-post-meta">
          <Avatar name={post.authorName} small />
          <span>
            <strong>{post.authorName}</strong>
            <small>started {formatRelative(post.createdAt)}</small>
          </span>
          <span className="community-meta-stat">
            <MessageCircle size={14} aria-hidden="true" />
            {post.replyCount} {post.replyCount === 1 ? 'reply' : 'replies'}
          </span>
          <span className="community-meta-stat active">
            <Clock size={14} aria-hidden="true" />
            active {formatRelative(post.lastActivityAt)}
          </span>
        </div>
      </div>
    </article>
  )
}

function ThreadView({
  thread,
  loading,
  user,
  isPreview,
  mutationError,
  replyBody,
  submitting,
  reportOpen,
  reported,
  reportReason,
  shareLabel,
  onBack,
  onReplyBodyChange,
  onReply,
  onHelpful,
  onReportOpen,
  onReportClose,
  onReportReasonChange,
  onReport,
  onShare,
  onSignIn,
  onStart,
  authBusy,
  authBusyLabel,
}: {
  thread: CommunityThread | null
  loading: boolean
  user: CommunityUser | null
  isPreview: boolean
  mutationError: string
  replyBody: string
  submitting: boolean
  reportOpen: boolean
  reported: boolean
  reportReason: string
  shareLabel: string
  onBack: () => void
  onReplyBodyChange: (value: string) => void
  onReply: (event: React.FormEvent<HTMLFormElement>) => void
  onHelpful: () => void
  onReportOpen: () => void
  onReportClose: () => void
  onReportReasonChange: (value: string) => void
  onReport: (event: React.FormEvent<HTMLFormElement>) => void
  onShare: () => void
  onSignIn: () => void
  onStart: () => void
  authBusy: boolean
  authBusyLabel: string
}) {
  if (loading) {
    return (
      <section className="community-thread-shell">
        <button className="community-back-button" type="button" onClick={onBack}>
          <ChevronLeft size={17} aria-hidden="true" />
          Community
        </button>
        <div className="community-thread-loading" aria-label="Loading discussion">
          <i />
          <i />
          <i />
        </div>
      </section>
    )
  }

  if (!thread) {
    return (
      <section className="community-thread-shell">
        <button className="community-back-button" type="button" onClick={onBack}>
          <ChevronLeft size={17} aria-hidden="true" />
          Community
        </button>
        <div className="community-empty">
          <MessageCircle size={30} aria-hidden="true" />
          <h3>This discussion could not be found.</h3>
          <button className="community-secondary-button" type="button" onClick={onBack}>
            Browse discussions
          </button>
        </div>
      </section>
    )
  }

  const { post, replies } = thread

  return (
    <div className="community-thread-layout">
      <section className="community-thread-shell">
        <button className="community-back-button" type="button" onClick={onBack}>
          <ChevronLeft size={17} aria-hidden="true" />
          All discussions
        </button>

        {isPreview && (
          <div className="community-preview-note">
            <MessageSquare size={16} aria-hidden="true" />
            This sample conversation shows how public threads will work.
          </div>
        )}

        <article className="community-thread-post">
          <header className="community-thread-header">
            <div className="community-post-tags">
              {post.isPinned && (
                <span className="community-status-tag pinned">
                  <Pin size={12} aria-hidden="true" />
                  Pinned
                </span>
              )}
              {post.isStaff && (
                <span className="community-status-tag staff">
                  <Shield size={12} aria-hidden="true" />
                  Staff prompt
                </span>
              )}
              <CategoryTag category={post.category} />
              {post.state && <span className="community-context-tag">{post.state}</span>}
              {post.species && <span className="community-context-tag">{post.species}</span>}
            </div>
            <h3>{post.title}</h3>
            <div className="community-thread-author">
              <Avatar name={post.authorName} />
              <span>
                <strong>{post.authorName}</strong>
                <small>Started {formatLongDate(post.createdAt)}</small>
              </span>
            </div>
          </header>

          {post.huntNumber && (
            <div className="community-linked-hunt">
              <div className="community-linked-hunt-icon">
                <MapPin size={20} aria-hidden="true" />
              </div>
              <span>
                <small>Related Hunt Planner record</small>
                <strong>
                  {post.state} {post.huntNumber}
                  {post.species ? ` · ${post.species}` : ''}
                </strong>
              </span>
              <a href={plannerHuntHref(post)}>View in planner</a>
            </div>
          )}

          <PlainTextBody value={post.body} />

          <footer className="community-thread-actions">
            <button
              type="button"
              className={post.viewerVote ? 'active' : ''}
              onClick={onHelpful}
              aria-pressed={post.viewerVote}
            >
              <ArrowUp size={15} aria-hidden="true" />
              Helpful · {post.score}
            </button>
            <button type="button" onClick={onShare}>Share · {shareLabel}</button>
            <button type="button" onClick={onReportOpen} disabled={reported}>
              <Flag size={14} aria-hidden="true" />
              {reported ? 'Reported' : 'Report'}
            </button>
          </footer>
        </article>

        <div className="community-replies-head">
          <h4>
            <MessageCircle size={18} aria-hidden="true" />
            {replies.length} {replies.length === 1 ? 'reply' : 'replies'}
          </h4>
          <span>Oldest first</span>
        </div>

        <div className="community-replies">
          {replies.map((reply, index) => (
            <article className="community-reply" key={reply.id}>
              <div className="community-reply-number">#{index + 1}</div>
              <header>
                <Avatar name={reply.authorName} small />
                <span>
                  <strong>{reply.authorName}</strong>
                  {reply.isStaff && <i>Staff</i>}
                  <small>{formatLongDate(reply.createdAt)}</small>
                </span>
              </header>
              <PlainTextBody value={reply.body} />
              {reply.helpfulCount > 0 && (
                <div className="community-reply-helpful">
                  <ArrowUp size={13} aria-hidden="true" />
                  Helpful to {reply.helpfulCount}
                </div>
              )}
            </article>
          ))}
        </div>

        {post.isLocked ? (
          <div className="community-locked-note">
            <Lock size={18} aria-hidden="true" />
            This discussion is locked. Existing posts remain public to read.
          </div>
        ) : user ? (
          <form className="community-reply-composer" onSubmit={onReply}>
            <div className="community-reply-composer-head">
              <Avatar name={user.displayName} />
              <span>
                <small>Replying as</small>
                <strong>{user.displayName}</strong>
              </span>
            </div>
            <label>
              <span className="sr-only">Your reply</span>
              <textarea
                value={replyBody}
                onChange={(event) => onReplyBodyChange(event.target.value)}
                placeholder="Add a useful answer, question, or field lesson…"
                minLength={3}
                maxLength={10000}
                rows={6}
                required
              />
            </label>
            <div className="community-location-reminder">
              Share planning context, not coordinates, private access details, or another
              hunter&apos;s exact location.
            </div>
            {mutationError && <p className="community-error">{mutationError}</p>}
            <button className="community-primary-button" type="submit" disabled={submitting}>
              <Send size={16} aria-hidden="true" />
              {submitting ? 'Posting…' : 'Post reply'}
            </button>
          </form>
        ) : (
          <div className="community-guest-reply">
            <MessageSquare size={23} aria-hidden="true" />
            <span>
              <strong>Join this discussion</strong>
              <small>Reading is public. Sign in to reply or mark a post Helpful.</small>
            </span>
            <button
              className="community-primary-button"
              type="button"
              onClick={onSignIn}
              disabled={authBusy}
            >
              {authBusy ? authBusyLabel : 'Sign in with Google'}
            </button>
          </div>
        )}

        {reportOpen && (
          <form className="community-report-panel" onSubmit={onReport}>
            <div>
              <strong>Report this discussion</strong>
              <button type="button" onClick={onReportClose} aria-label="Close report form">
                <X size={16} aria-hidden="true" />
              </button>
            </div>
            <label>
              <span>Reason</span>
              <select
                value={reportReason}
                onChange={(event) => onReportReasonChange(event.target.value)}
              >
                <option value="sensitive-location">Sensitive location or private information</option>
                <option value="unsafe-illegal">Unsafe or potentially illegal advice</option>
                <option value="harassment">Harassment or hate</option>
                <option value="misinformation">Misleading regulation claim</option>
                <option value="spam">Spam or undisclosed promotion</option>
                <option value="other">Other</option>
              </select>
            </label>
            <button className="community-primary-button" type="submit" disabled={submitting}>
              Send report
            </button>
          </form>
        )}
      </section>

      <CommunitySidebar
        user={user}
        onStart={onStart}
        authBusy={authBusy}
        authBusyLabel={authBusyLabel}
      />
    </div>
  )
}

function CommunitySidebar({
  user,
  onStart,
  authBusy,
  authBusyLabel,
}: {
  user: CommunityUser | null
  onStart: () => void
  authBusy: boolean
  authBusyLabel: string
}) {
  return (
    <aside className="community-sidebar">
      <section className="community-side-card guidelines">
        <div className="community-side-card-head">
          <Shield size={18} aria-hidden="true" />
          <h3>Community guidelines</h3>
        </div>
        <ol>
          <li>Be useful and civil.</li>
          <li>Keep exact locations and private access private.</li>
          <li>Source current rules, quotas, and deadlines.</li>
          <li>No unsafe or illegal advice.</li>
          <li>No weapon, tag, wildlife-product, or classified sales.</li>
          <li>Disclose commercial relationships.</li>
        </ol>
        <p>Always verify current regulations with the responsible wildlife agency.</p>
      </section>

      <section className="community-side-card">
        <p className="eyebrow">{user ? 'Add your experience' : 'New here?'}</p>
        <h3>{user ? 'What did the numbers miss?' : 'Read freely. Join when ready.'}</h3>
        <p>
          {user
            ? 'Share the planning tradeoffs and field lessons that do not fit in a data table.'
            : 'Every discussion is public to browse. An account is only required to post, reply, react, or report.'}
        </p>
        <button
          className="community-secondary-button"
          type="button"
          onClick={onStart}
          disabled={authBusy}
        >
          {user
            ? 'Start a discussion'
            : authBusy
              ? authBusyLabel
              : 'Sign in with Google'}
        </button>
      </section>

      <section className="community-side-card state-card">
        <p className="eyebrow">Browse by state</p>
        <div>
          {stateOptions.slice(1).map((state) => (
            <a key={state.value} href={`/community?state=${state.value}`}>
              <span>{state.value}</span>
              {state.label}
            </a>
          ))}
        </div>
      </section>
    </aside>
  )
}

function ComposerModal({
  draft,
  submitting,
  error,
  onChange,
  onClose,
  onSubmit,
}: {
  draft: CommunityDraft
  submitting: boolean
  error: string
  onChange: (draft: CommunityDraft) => void
  onClose: () => void
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void
}) {
  return (
    <div className="community-modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.currentTarget === event.target) onClose()
    }}>
      <section className="community-composer" role="dialog" aria-modal="true" aria-labelledby="composer-title">
        <header>
          <div>
            <p className="eyebrow">New discussion</p>
            <h3 id="composer-title">Bring a useful question to camp.</h3>
          </div>
          <button type="button" onClick={onClose} aria-label="Close composer">
            <X size={20} aria-hidden="true" />
          </button>
        </header>
        <form onSubmit={onSubmit}>
          <div className="community-composer-grid three">
            <label>
              <span>Post type</span>
              <select
                value={draft.postType}
                onChange={(event) => onChange({
                  ...draft,
                  postType: event.target.value as CommunityDraft['postType'],
                })}
              >
                <option value="question">Question</option>
                <option value="discussion">Discussion</option>
                <option value="hunt-report">Hunt report</option>
                <option value="gear-review">Gear review</option>
                <option value="site-feedback">Site feedback</option>
              </select>
            </label>
            <label>
              <span>Topic</span>
              <select
                value={draft.category}
                onChange={(event) => onChange({
                  ...draft,
                  category: event.target.value as CommunityCategory,
                })}
                required
              >
                {categories.slice(1).map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>State</span>
              <select
                value={draft.state}
                onChange={(event) => onChange({ ...draft, state: event.target.value })}
              >
                <option value="">Any / not specific</option>
                {stateOptions.slice(1).map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label>
            <span>Title</span>
            <input
              value={draft.title}
              onChange={(event) => onChange({ ...draft, title: event.target.value })}
              placeholder="What are you trying to decide or share?"
              minLength={10}
              maxLength={140}
              autoFocus
              required
            />
            <small>{draft.title.length}/140</small>
          </label>

          <label>
            <span>Details</span>
            <textarea
              value={draft.body}
              onChange={(event) => onChange({ ...draft, body: event.target.value })}
              placeholder="Add the numbers, tradeoffs, constraints, or field context that will help people give a useful answer."
              minLength={20}
              maxLength={10000}
              rows={9}
              required
            />
            <small>{draft.body.length}/10,000</small>
          </label>

          <div className="community-composer-grid">
            <label>
              <span>Species <i>Optional</i></span>
              <input
                value={draft.species}
                onChange={(event) => onChange({ ...draft, species: event.target.value })}
                placeholder="Elk, deer, pronghorn…"
                maxLength={60}
              />
            </label>
            <label>
              <span>Related hunt number <i>Optional</i></span>
              <input
                value={draft.huntNumber}
                onChange={(event) => onChange({ ...draft, huntNumber: event.target.value.toUpperCase() })}
                placeholder="DB1001"
                maxLength={40}
              />
            </label>
          </div>

          <div className="community-location-reminder prominent">
            <MapPin size={18} aria-hidden="true" />
            <span>
              <strong>Share patterns, not pins.</strong>
              Leave out coordinates, named bedding areas, private access arrangements, and
              details that could concentrate pressure.
            </span>
          </div>

          <p className="community-public-warning">
            This post will be public and may appear in search engines.
          </p>
          {error && <p className="community-error">{error}</p>}

          <footer>
            <button className="community-secondary-button" type="button" onClick={onClose}>
              Keep draft
            </button>
            <button className="community-primary-button" type="submit" disabled={submitting}>
              <Send size={16} aria-hidden="true" />
              {submitting ? 'Posting…' : 'Post discussion'}
            </button>
          </footer>
        </form>
      </section>
    </div>
  )
}

function ModerationModal({
  reports,
  loading,
  error,
  actionId,
  onClose,
  onAction,
}: {
  reports: ModeratorReport[]
  loading: boolean
  error: string
  actionId: string | null
  onClose: () => void
  onAction: (report: ModeratorReport, action: ModeratorAction) => Promise<void>
}) {
  return (
    <div
      className="community-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose()
      }}
    >
      <section
        className="community-moderation"
        role="dialog"
        aria-modal="true"
        aria-labelledby="moderation-title"
        aria-describedby="moderation-description"
      >
        <header>
          <div>
            <p className="eyebrow">Moderator tools</p>
            <h3 id="moderation-title">Reported discussions</h3>
            <p id="moderation-description">Review reports and keep the community useful.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close moderation queue" autoFocus>
            <X size={20} aria-hidden="true" />
          </button>
        </header>

        <div className="community-moderation-body">
          {error && (
            <p className="community-error" role="alert">
              {error}
            </p>
          )}

          {loading ? (
            <div className="community-moderation-loading" role="status">
              Loading reports…
            </div>
          ) : reports.length === 0 ? (
            <div className="community-moderation-empty">
              <Shield size={25} aria-hidden="true" />
              <strong>No reports need review.</strong>
              <span>The moderation queue is clear.</span>
            </div>
          ) : (
            <ol className="community-moderation-list">
              {reports.map((report) => {
                const busy = actionId === report.id
                return (
                  <li key={report.id}>
                    <div className="community-moderation-report-head">
                      <span className="community-moderation-reason">
                        <Flag size={13} aria-hidden="true" />
                        {moderationReasonLabel(report.reason)}
                      </span>
                      <time dateTime={report.createdAt}>{formatLongDate(report.createdAt)}</time>
                    </div>
                    <a
                      className="community-moderation-title"
                      href={`/community/thread/${encodeURIComponent(report.postId)}/${slugify(report.postTitle)}`}
                    >
                      {report.postTitle}
                    </a>
                    <p className="community-moderation-byline">
                      Posted by <strong>{report.postAuthorName}</strong>
                      {report.isLocked && (
                        <span>
                          <Lock size={11} aria-hidden="true" />
                          Locked
                        </span>
                      )}
                    </p>
                    <p className="community-moderation-excerpt">{report.postBody}</p>
                    <div className="community-moderation-actions">
                      <button
                        type="button"
                        onClick={() => void onAction(report, 'lock')}
                        disabled={busy || report.isLocked}
                      >
                        <Lock size={14} aria-hidden="true" />
                        {report.isLocked ? 'Thread locked' : 'Lock thread'}
                      </button>
                      <button
                        className="danger"
                        type="button"
                        onClick={() => void onAction(report, 'remove')}
                        disabled={busy}
                      >
                        Remove discussion
                      </button>
                      <button
                        type="button"
                        onClick={() => void onAction(report, 'dismiss')}
                        disabled={busy}
                      >
                        {busy ? 'Working…' : 'Dismiss report'}
                      </button>
                    </div>
                  </li>
                )
              })}
            </ol>
          )}
        </div>
      </section>
    </div>
  )
}

function moderationReasonLabel(reason: string) {
  const labels: Record<string, string> = {
    'sensitive-location': 'Sensitive location or private information',
    'unsafe-illegal': 'Unsafe or potentially illegal advice',
    harassment: 'Harassment or hate',
    misinformation: 'Misleading regulation claim',
    spam: 'Spam or undisclosed promotion',
    other: 'Other concern',
  }
  return labels[reason] ?? reason.replace(/[-_]+/g, ' ')
}

function CategoryTag({ category }: { category: CommunityCategory }) {
  const item = categories.find((candidate) => candidate.value === category)
  return <span className={`community-category-tag ${category}`}>{item?.label ?? category}</span>
}

function PlainTextBody({ value }: { value: string }) {
  return (
    <div className="community-prose">
      {value.split(/\n{2,}/).map((paragraph, index) => (
        <p key={`${paragraph.slice(0, 24)}-${index}`}>{paragraph}</p>
      ))}
    </div>
  )
}

function Avatar({ name, small = false }: { name: string; small?: boolean }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || 'HP'
  return (
    <span className={`community-avatar ${small ? 'small' : ''}`} aria-hidden="true">
      {initials}
    </span>
  )
}

function filtersFromLocation(): CommunityFilters {
  if (typeof window === 'undefined') {
    return { category: 'all', state: '', query: '', sort: 'active' }
  }
  const params = new URLSearchParams(window.location.search)
  const categoryParam = params.get('category')
  const category = categories.some((item) => item.value === categoryParam)
    ? categoryParam as CommunityCategory
    : 'all'
  const state = stateOptions.some((item) => item.value === params.get('state'))
    ? params.get('state') ?? ''
    : ''
  const sortParam = params.get('sort')
  const sort = sortOptions.some((item) => item.value === sortParam)
    ? sortParam as CommunitySort
    : 'active'
  return {
    category,
    state,
    query: params.get('q') ?? '',
    sort,
  }
}

function syncFiltersToUrl(filters: CommunityFilters) {
  if (typeof window === 'undefined' || threadIdFromLocation()) return
  const url = new URL('/community', window.location.origin)
  if (filters.category !== 'all') url.searchParams.set('category', filters.category)
  if (filters.state) url.searchParams.set('state', filters.state)
  if (filters.query.trim()) url.searchParams.set('q', filters.query.trim())
  if (filters.sort !== 'active') url.searchParams.set('sort', filters.sort)
  const next = `${url.pathname}${url.search}`
  const current = `${window.location.pathname}${window.location.search}`
  if (next !== current) window.history.replaceState(null, '', next)
}

function threadIdFromLocation() {
  if (typeof window === 'undefined') return null
  const match = window.location.pathname.match(/^\/community\/thread\/([^/]+)/)
  return match ? decodeURIComponent(match[1]) : null
}

function draftFromStorageOrLocation(): CommunityDraft {
  if (typeof window === 'undefined') return initialDraft
  const params = new URLSearchParams(window.location.search)
  const stored = (() => {
    try {
      return JSON.parse(
        window.sessionStorage.getItem(DRAFT_KEY) ?? '{}',
      ) as Partial<CommunityDraft>
    } catch {
      return {} as Partial<CommunityDraft>
    }
  })()
  return {
    ...initialDraft,
    ...stored,
    state: params.get('state') ?? stored.state ?? '',
    species: params.get('species') ?? stored.species ?? '',
    huntNumber: params.get('hunt') ?? stored.huntNumber ?? '',
  }
}

function plannerHuntHref(post: CommunityPost) {
  const params = new URLSearchParams()
  if (post.state) params.set('state', post.state.toLowerCase())
  if (post.huntNumber) params.set('hunt', post.huntNumber)
  if (post.species) params.set('species', post.species)
  return `/?${params}#planner`
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 72)
}

function formatRelative(value: string) {
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return 'recently'
  const seconds = Math.round((timestamp - Date.now()) / 1000)
  const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
  const ranges: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['week', 604_800],
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
  ]
  for (const [unit, size] of ranges) {
    if (Math.abs(seconds) >= size || unit === 'minute') {
      return formatter.format(Math.round(seconds / size), unit)
    }
  }
  return 'just now'
}

function formatLongDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Recently'
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

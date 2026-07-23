import { previewPosts, previewReplies } from './fixtures'
import type {
  CommunityDraft,
  CommunityFilters,
  CommunityPost,
  CommunityThread,
  CommunityUser,
  ModeratorAction,
  ModeratorReport,
} from './types'

type ApiResult<T> = {
  data: T
  isPreview: boolean
}

export async function loadCommunityUser(): Promise<CommunityUser | null> {
  try {
    const response = await fetch('/api/community/session', {
      headers: { Accept: 'application/json' },
    })
    if (!response.ok) return null
    const payload = await response.json() as { user: CommunityUser | null }
    return payload.user
  } catch {
    return null
  }
}

export async function loadCommunityPosts(
  filters: CommunityFilters,
  signal?: AbortSignal,
): Promise<ApiResult<CommunityPost[]>> {
  const params = new URLSearchParams()
  if (filters.category !== 'all') params.set('category', filters.category)
  if (filters.state) params.set('state', filters.state)
  if (filters.query.trim()) params.set('q', filters.query.trim())
  params.set('sort', filters.sort)

  try {
    const response = await fetch(`/api/community/posts?${params}`, {
      headers: { Accept: 'application/json' },
      signal,
    })
    if (!response.ok) throw new Error('Community feed is unavailable')
    const payload = await response.json() as { posts: CommunityPost[] }
    return { data: payload.posts, isPreview: false }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    return {
      data: filterPreviewPosts(filters),
      isPreview: true,
    }
  }
}

export async function loadCommunityThread(
  postId: string,
  signal?: AbortSignal,
): Promise<ApiResult<CommunityThread | null>> {
  try {
    const response = await fetch(`/api/community/posts/${encodeURIComponent(postId)}`, {
      headers: { Accept: 'application/json' },
      signal,
    })
    if (response.status === 404) return { data: null, isPreview: false }
    if (!response.ok) throw new Error('Discussion is unavailable')
    const payload = await response.json() as CommunityThread
    return { data: payload, isPreview: false }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    const post = previewPosts.find((candidate) => candidate.id === postId)
    return {
      data: post ? { post, replies: previewReplies[postId] ?? [] } : null,
      isPreview: true,
    }
  }
}

export async function createCommunityPost(draft: CommunityDraft): Promise<CommunityPost> {
  const response = await fetch('/api/community/posts', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(draft),
  })
  return readMutationResponse<{ post: CommunityPost }>(response).then((payload) => payload.post)
}

export async function createCommunityReply(postId: string, body: string) {
  const response = await fetch(`/api/community/posts/${encodeURIComponent(postId)}/replies`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ body }),
  })
  return readMutationResponse(response)
}

export async function toggleCommunityHelpful(postId: string) {
  const response = await fetch(`/api/community/posts/${encodeURIComponent(postId)}/vote`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
  })
  return readMutationResponse<{ score: number; viewerVote: boolean }>(response)
}

export async function reportCommunityPost(postId: string, reason: string) {
  const response = await fetch(`/api/community/posts/${encodeURIComponent(postId)}/report`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ reason }),
  })
  return readMutationResponse(response)
}

export async function loadCommunityModerationReports(): Promise<ModeratorReport[]> {
  const response = await fetch('/api/community/moderation/reports', {
    headers: { Accept: 'application/json' },
  })
  const payload = await readMutationResponse<{ reports: ModeratorReport[] }>(response)
  return payload.reports
}

export async function moderateCommunityReport(reportId: string, action: ModeratorAction) {
  const response = await fetch(
    `/api/community/moderation/reports/${encodeURIComponent(reportId)}`,
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action }),
    },
  )
  return readMutationResponse(response)
}

async function readMutationResponse<T = Record<string, unknown>>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({})) as T & { error?: string }
  if (response.status === 401) {
    throw new CommunityAuthError()
  }
  if (!response.ok) {
    throw new Error(payload.error || 'That action could not be completed.')
  }
  return payload
}

export class CommunityAuthError extends Error {
  constructor() {
    super('Sign in to continue.')
    this.name = 'CommunityAuthError'
  }
}

function filterPreviewPosts(filters: CommunityFilters) {
  const needle = filters.query.trim().toLowerCase()
  const matches = previewPosts.filter((post) => {
    if (filters.category !== 'all' && post.category !== filters.category) return false
    if (filters.state && post.state !== filters.state) return false
    if (!needle) return true
    return [post.title, post.body, post.authorName, post.species, post.huntNumber]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .includes(needle)
  })

  return matches.sort((a, b) => {
    if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1
    if (filters.sort === 'new') return Date.parse(b.createdAt) - Date.parse(a.createdAt)
    if (filters.sort === 'top') return b.score - a.score
    if (filters.sort === 'unanswered') {
      return a.replyCount - b.replyCount || Date.parse(b.createdAt) - Date.parse(a.createdAt)
    }
    return Date.parse(b.lastActivityAt) - Date.parse(a.lastActivityAt)
  })
}

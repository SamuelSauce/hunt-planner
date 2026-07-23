export type CommunityCategory =
  | 'draws'
  | 'planning'
  | 'gear'
  | 'reports'
  | 'campfire'
  | 'feedback'

export type CommunitySort = 'active' | 'new' | 'top' | 'unanswered'

export type CommunityUser = {
  displayName: string
  initials: string
  isModerator: boolean
}

export type ModeratorReport = {
  id: string
  reason: string
  createdAt: string
  postId: string
  postTitle: string
  postBody: string
  postAuthorName: string
  isLocked: boolean
}

export type ModeratorAction = 'lock' | 'remove' | 'dismiss'

export type CommunityPost = {
  id: string
  title: string
  body: string
  category: CommunityCategory
  postType: 'question' | 'discussion' | 'hunt-report' | 'gear-review' | 'site-feedback'
  state: string | null
  species: string | null
  huntNumber: string | null
  authorName: string
  isStaff: boolean
  createdAt: string
  updatedAt: string
  lastActivityAt: string
  score: number
  replyCount: number
  viewCount: number
  isPinned: boolean
  isLocked: boolean
  viewerVote: boolean
}

export type CommunityReply = {
  id: string
  postId: string
  body: string
  authorName: string
  createdAt: string
  updatedAt: string
  helpfulCount: number
  isStaff: boolean
}

export type CommunityThread = {
  post: CommunityPost
  replies: CommunityReply[]
}

export type CommunityDraft = {
  title: string
  body: string
  category: CommunityCategory
  postType: CommunityPost['postType']
  state: string
  species: string
  huntNumber: string
}

export type CommunityFilters = {
  category: CommunityCategory | 'all'
  state: string
  query: string
  sort: CommunitySort
}

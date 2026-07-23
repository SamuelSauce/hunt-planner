/**
 * Canonical Community schema manifest.
 *
 * The deployed Worker talks to D1 with prepared statements, so the runtime has
 * no ORM dependency. This typed manifest is mirrored by
 * drizzle/0000_hunt_planner_community.sql and keeps future schema work
 * discoverable in the conventional db/schema.ts location.
 */

export const communityCategories = [
  'draws',
  'planning',
  'gear',
  'reports',
  'campfire',
  'feedback',
] as const

export const communityPostTypes = [
  'question',
  'discussion',
  'hunt-report',
  'gear-review',
  'site-feedback',
] as const

export const communitySchema = {
  users: {
    table: 'community_users',
    primaryKey: ['id'],
    columns: {
      id: 'text',
      displayName: 'display_name',
      isStaff: 'is_staff',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
  },
  posts: {
    table: 'community_posts',
    primaryKey: ['id'],
    columns: {
      id: 'text',
      authorId: 'author_id',
      title: 'title',
      body: 'body',
      category: 'category',
      postType: 'post_type',
      state: 'state',
      species: 'species',
      huntNumber: 'hunt_number',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      lastActivityAt: 'last_activity_at',
      baseScore: 'base_score',
      baseReplyCount: 'base_reply_count',
      viewCount: 'view_count',
      isPinned: 'is_pinned',
      isLocked: 'is_locked',
      isRemoved: 'is_removed',
    },
  },
  replies: {
    table: 'community_replies',
    primaryKey: ['id'],
    columns: {
      id: 'text',
      postId: 'post_id',
      authorId: 'author_id',
      body: 'body',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      helpfulCount: 'helpful_count',
      isStaff: 'is_staff',
    },
  },
  postVotes: {
    table: 'community_post_votes',
    primaryKey: ['post_id', 'user_id'],
    columns: {
      postId: 'post_id',
      userId: 'user_id',
      isActive: 'is_active',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
  },
  reports: {
    table: 'community_reports',
    primaryKey: ['id'],
    unique: [['post_id', 'reporter_id']],
    columns: {
      id: 'text',
      postId: 'post_id',
      reporterId: 'reporter_id',
      reason: 'reason',
      status: 'status',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
  },
  moderationActions: {
    table: 'community_moderation_actions',
    primaryKey: ['id'],
    columns: {
      id: 'text',
      reportId: 'report_id',
      postId: 'post_id',
      moderatorId: 'moderator_id',
      action: 'action',
      createdAt: 'created_at',
    },
  },
} as const

export type CommunityCategory = (typeof communityCategories)[number]
export type CommunityPostType = (typeof communityPostTypes)[number]

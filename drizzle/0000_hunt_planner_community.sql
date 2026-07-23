CREATE TABLE IF NOT EXISTS `community_users` (
  `id` text PRIMARY KEY NOT NULL,
  `display_name` text NOT NULL,
  `is_staff` integer DEFAULT 0 NOT NULL CHECK (`is_staff` IN (0, 1)),
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `community_posts` (
  `id` text PRIMARY KEY NOT NULL,
  `author_id` text NOT NULL,
  `title` text NOT NULL CHECK (length(`title`) BETWEEN 10 AND 140),
  `body` text NOT NULL CHECK (length(`body`) BETWEEN 20 AND 10000),
  `category` text NOT NULL CHECK (`category` IN ('draws', 'planning', 'gear', 'reports', 'campfire', 'feedback')),
  `post_type` text NOT NULL CHECK (`post_type` IN ('question', 'discussion', 'hunt-report', 'gear-review', 'site-feedback')),
  `state` text,
  `species` text,
  `hunt_number` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  `last_activity_at` integer NOT NULL,
  `base_score` integer DEFAULT 0 NOT NULL CHECK (`base_score` >= 0),
  `base_reply_count` integer DEFAULT 0 NOT NULL CHECK (`base_reply_count` >= 0),
  `view_count` integer DEFAULT 0 NOT NULL CHECK (`view_count` >= 0),
  `is_pinned` integer DEFAULT 0 NOT NULL CHECK (`is_pinned` IN (0, 1)),
  `is_locked` integer DEFAULT 0 NOT NULL CHECK (`is_locked` IN (0, 1)),
  `is_removed` integer DEFAULT 0 NOT NULL CHECK (`is_removed` IN (0, 1)),
  FOREIGN KEY (`author_id`) REFERENCES `community_users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `community_replies` (
  `id` text PRIMARY KEY NOT NULL,
  `post_id` text NOT NULL,
  `author_id` text NOT NULL,
  `body` text NOT NULL CHECK (length(`body`) BETWEEN 3 AND 10000),
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  `helpful_count` integer DEFAULT 0 NOT NULL CHECK (`helpful_count` >= 0),
  `is_staff` integer DEFAULT 0 NOT NULL CHECK (`is_staff` IN (0, 1)),
  FOREIGN KEY (`post_id`) REFERENCES `community_posts`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`author_id`) REFERENCES `community_users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `community_post_votes` (
  `post_id` text NOT NULL,
  `user_id` text NOT NULL,
  `is_active` integer DEFAULT 1 NOT NULL CHECK (`is_active` IN (0, 1)),
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  PRIMARY KEY (`post_id`, `user_id`),
  FOREIGN KEY (`post_id`) REFERENCES `community_posts`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`user_id`) REFERENCES `community_users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `community_reports` (
  `id` text PRIMARY KEY NOT NULL,
  `post_id` text NOT NULL,
  `reporter_id` text NOT NULL,
  `reason` text NOT NULL CHECK (length(`reason`) BETWEEN 3 AND 500),
  `status` text DEFAULT 'open' NOT NULL CHECK (`status` IN ('open', 'resolved', 'dismissed')),
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`post_id`) REFERENCES `community_posts`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`reporter_id`) REFERENCES `community_users`(`id`) ON UPDATE no action ON DELETE cascade,
  CONSTRAINT `community_reports_post_reporter_unique` UNIQUE (`post_id`, `reporter_id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `community_moderation_actions` (
  `id` text PRIMARY KEY NOT NULL,
  `report_id` text NOT NULL,
  `post_id` text NOT NULL,
  `moderator_id` text NOT NULL,
  `action` text NOT NULL CHECK (`action` IN ('lock', 'remove', 'dismiss')),
  `created_at` integer NOT NULL,
  FOREIGN KEY (`report_id`) REFERENCES `community_reports`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`post_id`) REFERENCES `community_posts`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`moderator_id`) REFERENCES `community_users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `community_posts_activity_idx` ON `community_posts` (`is_pinned` DESC, `last_activity_at` DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `community_posts_category_idx` ON `community_posts` (`category`, `last_activity_at` DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `community_posts_state_idx` ON `community_posts` (`state`, `last_activity_at` DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `community_replies_thread_idx` ON `community_replies` (`post_id`, `created_at` ASC, `id` ASC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `community_posts_author_rate_idx` ON `community_posts` (`author_id`, `created_at` DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `community_replies_author_rate_idx` ON `community_replies` (`author_id`, `created_at` DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `community_reports_author_rate_idx` ON `community_reports` (`reporter_id`, `created_at` DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `community_reports_status_idx` ON `community_reports` (`status`, `updated_at` ASC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `community_moderation_actions_report_idx` ON `community_moderation_actions` (`report_id`, `created_at` DESC);
--> statement-breakpoint
-- Preview-only staff identities. These rows are editorial starters, not
-- representations of organic community members, and contain no email data.
INSERT OR IGNORE INTO `community_users`
  (`id`, `display_name`, `is_staff`, `created_at`, `updated_at`)
VALUES
  ('seed_staff_hunt_planner', 'Hunt Planner Team', 1, 1784556900000, 1784821320000),
  ('seed_staff_field_notes', 'Hunt Planner Field Notes', 1, 1784647800000, 1784821320000),
  ('seed_staff_wasatch_glass', 'Wasatch Glass', 1, 1784738400000, 1784821320000),
  ('seed_staff_front_range_notes', 'Front Range Notes', 1, 1784635800000, 1784816280000),
  ('seed_staff_sage_basin', 'Sage Basin', 1, 1784570700000, 1784805720000),
  ('seed_staff_timberline_rookie', 'Timberline Rookie', 1, 1784492700000, 1784754360000),
  ('seed_staff_ridgeline_kit', 'Ridgeline Kit', 1, 1784626200000, 1784746440000),
  ('seed_staff_two_tab_hunter', 'Two Tab Hunter', 1, 1784720700000, 1784736720000),
  ('seed_staff_pine_valley', 'Pine Valley', 1, 1784744100000, 1784744100000),
  ('seed_staff_draw_ledger', 'Draw Ledger', 1, 1784772300000, 1784772300000);
--> statement-breakpoint
INSERT OR IGNORE INTO `community_posts`
  (`id`, `author_id`, `title`, `body`, `category`, `post_type`, `state`, `species`, `hunt_number`, `created_at`, `updated_at`, `last_activity_at`, `base_score`, `base_reply_count`, `view_count`, `is_pinned`, `is_locked`)
VALUES
  (
    'welcome-useful-unit-talk',
    'seed_staff_hunt_planner',
    'Read first: useful unit talk without spot-burning',
    'The best planning conversations explain patterns, tradeoffs, and public information without publishing somebody else’s exact camp, access route, glassing point, or private arrangement. Unit-level context is welcome. Coordinates and sensitive locations are not.',
    'campfire',
    'discussion',
    NULL,
    NULL,
    NULL,
    1784556900000,
    1784556900000,
    1784647800000,
    34,
    3,
    312,
    1,
    0
  ),
  (
    'db1001-tag-wait',
    'seed_staff_wasatch_glass',
    'DB1001: how do you weigh a 29-permit tag against the wait?',
    'I’m trying to separate tag quality from name recognition. Hunt Planner shows 29 permits for the 2026 Paunsaugunt archery hunt and a 55.9% reported 2024 harvest rate, but hunters also averaged 9.6 days afield. For similarly scarce early archery hunts, what made the wait worth it: season length, scouting access, buck quality, or something else? Looking for planning principles, not locations.',
    'draws',
    'question',
    'UT',
    'Deer',
    'DB1001',
    1784738400000,
    1784738400000,
    1784821320000,
    18,
    4,
    184,
    0,
    0
  ),
  (
    'colorado-first-rifle-priorities',
    'seed_staff_front_range_notes',
    'Colorado first-rifle elk: harvest success or public-land percentage first?',
    'I have three units in the same general draw range. One leads on recent harvest, another has much more public ground, and the third fits my scouting schedule. How are you weighting those signals before you dig into access and terrain?',
    'planning',
    'discussion',
    'CO',
    'Elk',
    NULL,
    1784635800000,
    1784635800000,
    1784816280000,
    12,
    8,
    226,
    0,
    0
  ),
  (
    'wyoming-pronghorn-access',
    'seed_staff_sage_basin',
    'Wyoming pronghorn: evaluating access without asking for someone’s spot',
    'What public information do you use to separate a unit that merely has public acres from one where those acres are realistically reachable during the season? I’m comparing road layers, land ownership, and agency notes so far.',
    'planning',
    'question',
    'WY',
    'Pronghorn',
    NULL,
    1784570700000,
    1784570700000,
    1784805720000,
    21,
    14,
    401,
    0,
    0
  ),
  (
    'first-archery-lessons',
    'seed_staff_timberline_rookie',
    'Five things I would change after my first western archery hunt',
    'The short version: fewer “just in case” items, more time learning one small area, a better midday water plan, a deliberate pack-out route, and more shooting after a hard uphill effort. Here is what each lesson changed in my next plan.',
    'reports',
    'hunt-report',
    'ID',
    'Elk',
    NULL,
    1784492700000,
    1784492700000,
    1784754360000,
    29,
    19,
    566,
    0,
    0
  ),
  (
    'tripod-weight-stability',
    'seed_staff_ridgeline_kit',
    'Tripod weight versus stability for an eight-day backpack hunt',
    'For a 65 mm spotter, where did you land after actually carrying the system for a week? I care more about quick setup and wind performance than shaving the last few ounces.',
    'gear',
    'gear-review',
    NULL,
    NULL,
    NULL,
    1784626200000,
    1784626200000,
    1784746440000,
    9,
    9,
    173,
    0,
    0
  ),
  (
    'compare-two-hunts',
    'seed_staff_two_tab_hunter',
    'Feature request: compare two hunts side by side',
    'I keep opening two tabs to compare draw outlook, season dates, harvest success, and public land. A pinned comparison tray would make the decision much easier. Which four or five fields should always stay visible?',
    'feedback',
    'site-feedback',
    NULL,
    NULL,
    NULL,
    1784720700000,
    1784720700000,
    1784736720000,
    16,
    7,
    148,
    0,
    0
  );
--> statement-breakpoint
INSERT OR IGNORE INTO `community_replies`
  (`id`, `post_id`, `author_id`, `body`, `created_at`, `updated_at`, `helpful_count`, `is_staff`)
VALUES
  (
    'welcome-reply-1',
    'welcome-useful-unit-talk',
    'seed_staff_field_notes',
    'A good rule of thumb: share how you evaluated access, not the exact access point you chose.',
    1784647800000,
    1784647800000,
    12,
    1
  ),
  (
    'db1001-reply-1',
    'db1001-tag-wait',
    'seed_staff_pine_valley',
    'For me, available scouting days matter more than the headline success rate. Nine-plus days afield is a useful warning that the tag still asks for real time.',
    1784744100000,
    1784744100000,
    8,
    1
  ),
  (
    'db1001-reply-2',
    'db1001-tag-wait',
    'seed_staff_draw_ledger',
    'Compare it with a hunt you could draw repeatedly. The opportunity cost becomes much clearer when both are in the same planner.',
    1784772300000,
    1784772300000,
    6,
    1
  ),
  (
    'db1001-reply-3',
    'db1001-tag-wait',
    'seed_staff_hunt_planner',
    'Staff note: always check the current UDWR guidebook and hunt page before applying. The figures discussed here are historical planning context, not a guarantee.',
    1784821320000,
    1784821320000,
    10,
    1
  );

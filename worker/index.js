const INDEXABLE_EXTENSION = /\.[a-z0-9]+$/i;
const COMMUNITY_API_PREFIX = "/api/community";
const FIREBASE_IDENTITY_LOOKUP_URL =
  "https://identitytoolkit.googleapis.com/v1/accounts:lookup";
const FIREBASE_WEB_API_KEY = "AIzaSyBpuyQXJ6HIthnLBIyT7tDLqiIaVS070gw";
const COMMUNITY_ALLOWED_ORIGINS = new Set([
  "https://huntplanner-66d5e.web.app",
  "https://huntplanner-66d5e.firebaseapp.com",
  "https://hunt-planner-seo-preview.samuelfbridge.chatgpt.site",
]);
const COMMUNITY_ALLOWED_METHODS = new Set(["GET", "POST", "OPTIONS"]);
const COMMUNITY_ALLOWED_HEADERS = new Set([
  "accept",
  "authorization",
  "content-type",
]);
const COMMUNITY_CATEGORIES = new Set([
  "draws",
  "planning",
  "gear",
  "reports",
  "campfire",
  "feedback",
]);
const COMMUNITY_POST_TYPES = new Set([
  "question",
  "discussion",
  "hunt-report",
  "gear-review",
  "site-feedback",
]);
const COMMUNITY_SORTS = new Set(["active", "new", "top", "unanswered"]);
const MAX_JSON_BYTES = 16_384;
const POST_RATE_LIMIT = { count: 3, windowMs: 10 * 60 * 1000 };
const REPLY_RATE_LIMIT = { count: 8, windowMs: 5 * 60 * 1000 };
const REPORT_RATE_LIMIT = { count: 10, windowMs: 60 * 60 * 1000 };

const COMMUNITY_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS community_users (
    id TEXT PRIMARY KEY NOT NULL,
    display_name TEXT NOT NULL,
    is_staff INTEGER NOT NULL DEFAULT 0 CHECK (is_staff IN (0, 1)),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS community_posts (
    id TEXT PRIMARY KEY NOT NULL,
    author_id TEXT NOT NULL REFERENCES community_users(id),
    title TEXT NOT NULL CHECK (length(title) BETWEEN 10 AND 140),
    body TEXT NOT NULL CHECK (length(body) BETWEEN 20 AND 10000),
    category TEXT NOT NULL CHECK (category IN ('draws', 'planning', 'gear', 'reports', 'campfire', 'feedback')),
    post_type TEXT NOT NULL CHECK (post_type IN ('question', 'discussion', 'hunt-report', 'gear-review', 'site-feedback')),
    state TEXT,
    species TEXT,
    hunt_number TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    last_activity_at INTEGER NOT NULL,
    base_score INTEGER NOT NULL DEFAULT 0 CHECK (base_score >= 0),
    base_reply_count INTEGER NOT NULL DEFAULT 0 CHECK (base_reply_count >= 0),
    view_count INTEGER NOT NULL DEFAULT 0 CHECK (view_count >= 0),
    is_pinned INTEGER NOT NULL DEFAULT 0 CHECK (is_pinned IN (0, 1)),
    is_locked INTEGER NOT NULL DEFAULT 0 CHECK (is_locked IN (0, 1)),
    is_removed INTEGER NOT NULL DEFAULT 0 CHECK (is_removed IN (0, 1))
  )`,
  `CREATE TABLE IF NOT EXISTS community_replies (
    id TEXT PRIMARY KEY NOT NULL,
    post_id TEXT NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
    author_id TEXT NOT NULL REFERENCES community_users(id),
    body TEXT NOT NULL CHECK (length(body) BETWEEN 3 AND 10000),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    helpful_count INTEGER NOT NULL DEFAULT 0 CHECK (helpful_count >= 0),
    is_staff INTEGER NOT NULL DEFAULT 0 CHECK (is_staff IN (0, 1))
  )`,
  `CREATE TABLE IF NOT EXISTS community_post_votes (
    post_id TEXT NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES community_users(id) ON DELETE CASCADE,
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (post_id, user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS community_reports (
    id TEXT PRIMARY KEY NOT NULL,
    post_id TEXT NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
    reporter_id TEXT NOT NULL REFERENCES community_users(id) ON DELETE CASCADE,
    reason TEXT NOT NULL CHECK (length(reason) BETWEEN 3 AND 500),
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE (post_id, reporter_id)
  )`,
  `CREATE TABLE IF NOT EXISTS community_moderation_actions (
    id TEXT PRIMARY KEY NOT NULL,
    report_id TEXT NOT NULL REFERENCES community_reports(id) ON DELETE CASCADE,
    post_id TEXT NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
    moderator_id TEXT NOT NULL REFERENCES community_users(id),
    action TEXT NOT NULL CHECK (action IN ('lock', 'remove', 'dismiss')),
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS community_posts_activity_idx
    ON community_posts (is_pinned DESC, last_activity_at DESC)`,
  `CREATE INDEX IF NOT EXISTS community_posts_category_idx
    ON community_posts (category, last_activity_at DESC)`,
  `CREATE INDEX IF NOT EXISTS community_posts_state_idx
    ON community_posts (state, last_activity_at DESC)`,
  `CREATE INDEX IF NOT EXISTS community_replies_thread_idx
    ON community_replies (post_id, created_at ASC, id ASC)`,
  `CREATE INDEX IF NOT EXISTS community_posts_author_rate_idx
    ON community_posts (author_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS community_replies_author_rate_idx
    ON community_replies (author_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS community_reports_author_rate_idx
    ON community_reports (reporter_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS community_reports_status_idx
    ON community_reports (status, updated_at ASC)`,
  `CREATE INDEX IF NOT EXISTS community_moderation_actions_report_idx
    ON community_moderation_actions (report_id, created_at DESC)`,
  `INSERT OR IGNORE INTO community_users
    (id, display_name, is_staff, created_at, updated_at)
    VALUES ('seed_staff_hunt_planner', 'Hunt Planner Team', 1, 1784556900000, 1784821320000)`,
  `INSERT OR IGNORE INTO community_users
    (id, display_name, is_staff, created_at, updated_at)
    VALUES ('seed_staff_field_notes', 'Hunt Planner Field Notes', 1, 1784647800000, 1784821320000)`,
  `INSERT OR IGNORE INTO community_users
    (id, display_name, is_staff, created_at, updated_at)
    VALUES ('seed_staff_wasatch_glass', 'Wasatch Glass', 1, 1784738400000, 1784821320000)`,
  `INSERT OR IGNORE INTO community_users
    (id, display_name, is_staff, created_at, updated_at)
    VALUES ('seed_staff_front_range_notes', 'Front Range Notes', 1, 1784635800000, 1784816280000)`,
  `INSERT OR IGNORE INTO community_users
    (id, display_name, is_staff, created_at, updated_at)
    VALUES ('seed_staff_sage_basin', 'Sage Basin', 1, 1784570700000, 1784805720000)`,
  `INSERT OR IGNORE INTO community_users
    (id, display_name, is_staff, created_at, updated_at)
    VALUES ('seed_staff_timberline_rookie', 'Timberline Rookie', 1, 1784492700000, 1784754360000)`,
  `INSERT OR IGNORE INTO community_users
    (id, display_name, is_staff, created_at, updated_at)
    VALUES ('seed_staff_ridgeline_kit', 'Ridgeline Kit', 1, 1784626200000, 1784746440000)`,
  `INSERT OR IGNORE INTO community_users
    (id, display_name, is_staff, created_at, updated_at)
    VALUES ('seed_staff_two_tab_hunter', 'Two Tab Hunter', 1, 1784720700000, 1784736720000)`,
  `INSERT OR IGNORE INTO community_users
    (id, display_name, is_staff, created_at, updated_at)
    VALUES ('seed_staff_pine_valley', 'Pine Valley', 1, 1784744100000, 1784744100000)`,
  `INSERT OR IGNORE INTO community_users
    (id, display_name, is_staff, created_at, updated_at)
    VALUES ('seed_staff_draw_ledger', 'Draw Ledger', 1, 1784772300000, 1784772300000)`,
  `INSERT OR IGNORE INTO community_posts
    (id, author_id, title, body, category, post_type, state, species, hunt_number, created_at, updated_at, last_activity_at, base_score, base_reply_count, view_count, is_pinned, is_locked)
    VALUES (
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
    )`,
  `INSERT OR IGNORE INTO community_posts
    (id, author_id, title, body, category, post_type, state, species, hunt_number, created_at, updated_at, last_activity_at, base_score, base_reply_count, view_count, is_pinned, is_locked)
    VALUES (
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
    )`,
  `INSERT OR IGNORE INTO community_posts
    (id, author_id, title, body, category, post_type, state, species, hunt_number, created_at, updated_at, last_activity_at, base_score, base_reply_count, view_count, is_pinned, is_locked)
    VALUES (
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
    )`,
  `INSERT OR IGNORE INTO community_posts
    (id, author_id, title, body, category, post_type, state, species, hunt_number, created_at, updated_at, last_activity_at, base_score, base_reply_count, view_count, is_pinned, is_locked)
    VALUES (
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
    )`,
  `INSERT OR IGNORE INTO community_posts
    (id, author_id, title, body, category, post_type, state, species, hunt_number, created_at, updated_at, last_activity_at, base_score, base_reply_count, view_count, is_pinned, is_locked)
    VALUES (
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
    )`,
  `INSERT OR IGNORE INTO community_posts
    (id, author_id, title, body, category, post_type, state, species, hunt_number, created_at, updated_at, last_activity_at, base_score, base_reply_count, view_count, is_pinned, is_locked)
    VALUES (
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
    )`,
  `INSERT OR IGNORE INTO community_posts
    (id, author_id, title, body, category, post_type, state, species, hunt_number, created_at, updated_at, last_activity_at, base_score, base_reply_count, view_count, is_pinned, is_locked)
    VALUES (
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
    )`,
  `INSERT OR IGNORE INTO community_replies
    (id, post_id, author_id, body, created_at, updated_at, helpful_count, is_staff)
    VALUES (
      'welcome-reply-1',
      'welcome-useful-unit-talk',
      'seed_staff_field_notes',
      'A good rule of thumb: share how you evaluated access, not the exact access point you chose.',
      1784647800000,
      1784647800000,
      12,
      1
    )`,
  `INSERT OR IGNORE INTO community_replies
    (id, post_id, author_id, body, created_at, updated_at, helpful_count, is_staff)
    VALUES (
      'db1001-reply-1',
      'db1001-tag-wait',
      'seed_staff_pine_valley',
      'For me, available scouting days matter more than the headline success rate. Nine-plus days afield is a useful warning that the tag still asks for real time.',
      1784744100000,
      1784744100000,
      8,
      1
    )`,
  `INSERT OR IGNORE INTO community_replies
    (id, post_id, author_id, body, created_at, updated_at, helpful_count, is_staff)
    VALUES (
      'db1001-reply-2',
      'db1001-tag-wait',
      'seed_staff_draw_ledger',
      'Compare it with a hunt you could draw repeatedly. The opportunity cost becomes much clearer when both are in the same planner.',
      1784772300000,
      1784772300000,
      6,
      1
    )`,
  `INSERT OR IGNORE INTO community_replies
    (id, post_id, author_id, body, created_at, updated_at, helpful_count, is_staff)
    VALUES (
      'db1001-reply-3',
      'db1001-tag-wait',
      'seed_staff_hunt_planner',
      'Staff note: always check the current UDWR guidebook and hunt page before applying. The figures discussed here are historical planning context, not a guarantee.',
      1784821320000,
      1784821320000,
      10,
      1
    )`,
];

const schemaReadyByDatabase = new WeakMap();

class HttpError extends Error {
  constructor(status, message, headers = {}) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.headers = headers;
  }
}

async function fetchAsset(request, env, pathname) {
  const url = new URL(request.url);
  url.pathname = pathname;
  return env.ASSETS.fetch(new Request(url, request));
}

function jsonResponse(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...extraHeaders,
    },
  });
}

function methodNotAllowed(allowed) {
  return jsonResponse(
    { error: "Method not allowed." },
    405,
    { Allow: allowed.join(", ") },
  );
}

function isAllowedCommunityOrigin(origin) {
  if (!origin) return true;
  if (COMMUNITY_ALLOWED_ORIGINS.has(origin)) return true;

  try {
    const url = new URL(origin);
    return (
      url.origin === origin &&
      (url.protocol === "http:" || url.protocol === "https:") &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1")
    );
  } catch {
    return false;
  }
}

function communityCorsHeaders(request) {
  const origin = request.headers.get("origin");
  if (!origin || !isAllowedCommunityOrigin(origin)) return {};

  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function withCommunityCors(response, request) {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(communityCorsHeaders(request))) {
    headers.set(name, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function validateCommunityOrigin(request) {
  const origin = request.headers.get("origin");
  if (origin && !isAllowedCommunityOrigin(origin)) {
    throw new HttpError(403, "This origin is not allowed.");
  }
}

function handleCommunityPreflight(request) {
  const origin = request.headers.get("origin");
  if (!origin || !isAllowedCommunityOrigin(origin)) {
    return jsonResponse({ error: "This origin is not allowed." }, 403);
  }

  const requestedMethod = (
    request.headers.get("access-control-request-method") ?? ""
  ).toUpperCase();
  if (
    !requestedMethod ||
    !COMMUNITY_ALLOWED_METHODS.has(requestedMethod) ||
    requestedMethod === "OPTIONS"
  ) {
    return jsonResponse({ error: "This method is not allowed." }, 405);
  }

  const requestedHeaders = (
    request.headers.get("access-control-request-headers") ?? ""
  )
    .split(",")
    .map((header) => header.trim().toLowerCase())
    .filter(Boolean);
  if (
    requestedHeaders.some(
      (header) => !COMMUNITY_ALLOWED_HEADERS.has(header),
    )
  ) {
    return jsonResponse({ error: "These request headers are not allowed." }, 403);
  }

  return new Response(null, {
    status: 204,
    headers: communityCorsHeaders(request),
  });
}

async function initializeCommunitySchema(db) {
  const statements = COMMUNITY_SCHEMA_STATEMENTS.map((sql) => db.prepare(sql));
  await db.batch(statements);
}

function ensureCommunitySchema(db) {
  const existing = schemaReadyByDatabase.get(db);
  if (existing) return existing;

  const pending = initializeCommunitySchema(db).catch((error) => {
    schemaReadyByDatabase.delete(db);
    throw error;
  });
  schemaReadyByDatabase.set(db, pending);
  return pending;
}

function normalizePlainText(value, field, options) {
  const {
    min = 0,
    max,
    multiline = false,
    optional = false,
  } = options;

  if (value === undefined || value === null) {
    if (optional) return null;
    throw new HttpError(400, `${field} is required.`);
  }
  if (typeof value !== "string") {
    throw new HttpError(400, `${field} must be plain text.`);
  }

  let normalized = value.normalize("NFKC").replace(/\r\n?/g, "\n").trim();
  if (!multiline) normalized = normalized.replace(/\s+/g, " ");

  if (optional && normalized.length === 0) return null;
  if (
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u202A-\u202E\u2066-\u2069]/u.test(
      normalized,
    )
  ) {
    throw new HttpError(400, `${field} contains unsupported characters.`);
  }
  if (normalized.length < min || normalized.length > max) {
    const range =
      min > 0
        ? `between ${min} and ${max} characters`
        : `no more than ${max} characters`;
    throw new HttpError(400, `${field} must be ${range}.`);
  }
  return normalized;
}

function validatePostDraft(payload) {
  const title = normalizePlainText(payload.title, "Title", {
    min: 10,
    max: 140,
  });
  const body = normalizePlainText(payload.body, "Body", {
    min: 20,
    max: 10_000,
    multiline: true,
  });

  if (
    typeof payload.category !== "string" ||
    !COMMUNITY_CATEGORIES.has(payload.category)
  ) {
    throw new HttpError(400, "Choose a valid community category.");
  }
  if (
    typeof payload.postType !== "string" ||
    !COMMUNITY_POST_TYPES.has(payload.postType)
  ) {
    throw new HttpError(400, "Choose a valid post type.");
  }

  const state = normalizePlainText(payload.state, "State", {
    max: 2,
    optional: true,
  });
  if (state && !/^[A-Za-z]{2}$/.test(state)) {
    throw new HttpError(400, "State must be a two-letter abbreviation.");
  }
  const species = normalizePlainText(payload.species, "Species", {
    max: 60,
    optional: true,
  });
  const huntNumber = normalizePlainText(payload.huntNumber, "Hunt number", {
    max: 40,
    optional: true,
  });
  if (
    huntNumber &&
    !/^[A-Za-z0-9][A-Za-z0-9 ._/-]*$/.test(huntNumber)
  ) {
    throw new HttpError(
      400,
      "Hunt number may contain letters, numbers, spaces, periods, underscores, slashes, and hyphens.",
    );
  }

  return {
    title,
    body,
    category: payload.category,
    postType: payload.postType,
    state: state?.toUpperCase() ?? null,
    species,
    huntNumber: huntNumber?.toUpperCase() ?? null,
  };
}

async function readJsonObject(request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    throw new HttpError(415, "Send this request as JSON.");
  }

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_JSON_BYTES) {
    throw new HttpError(413, "Request body is too large.");
  }

  const source = await request.text();
  if (new TextEncoder().encode(source).byteLength > MAX_JSON_BYTES) {
    throw new HttpError(413, "Request body is too large.");
  }

  let payload;
  try {
    payload = JSON.parse(source);
  } catch {
    throw new HttpError(400, "Request body must be valid JSON.");
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new HttpError(400, "Request body must be a JSON object.");
  }
  return payload;
}

function userInitials(displayName) {
  const words = displayName
    .split(/\s+/u)
    .map((word) => Array.from(word)[0])
    .filter(Boolean);
  if (words.length === 0) return "HP";
  if (words.length === 1) return words[0].toUpperCase();
  return `${words[0]}${words[words.length - 1]}`.toUpperCase();
}

function isConfiguredModerator(hash, env) {
  const configured = env?.COMMUNITY_MODERATOR_HASHES;
  if (typeof configured !== "string" || configured.trim().length === 0) {
    return false;
  }
  return configured
    .split(",")
    .map((candidate) => candidate.trim().toLowerCase())
    .filter((candidate) => /^[a-f0-9]{64}$/.test(candidate))
    .includes(hash);
}

async function getAuthenticatedUser(request, env) {
  const authorization = request.headers.get("authorization");
  if (authorization) {
    const match = authorization.match(/^Bearer ([^\s]+)$/i);
    if (!match || match[1].length > 8192) {
      throw new HttpError(401, "Your sign-in is invalid. Please sign in again.");
    }
    return getFirebaseAuthenticatedUser(match[1], env);
  }

  const rawEmail = request.headers.get("oai-authenticated-user-email");
  if (!rawEmail) return null;

  return communityUserFromEmail(rawEmail, env);
}

async function getFirebaseAuthenticatedUser(idToken, env) {
  let response;
  try {
    response = await fetch(
      `${FIREBASE_IDENTITY_LOOKUP_URL}?key=${encodeURIComponent(
        env?.FIREBASE_WEB_API_KEY || FIREBASE_WEB_API_KEY,
      )}`,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ idToken }),
      },
    );
  } catch {
    throw new HttpError(
      503,
      "Sign-in verification is temporarily unavailable.",
    );
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    // A non-JSON response is handled using the status below.
  }

  if (!response.ok) {
    if (response.status >= 500 || response.status === 429) {
      throw new HttpError(
        503,
        "Sign-in verification is temporarily unavailable.",
      );
    }
    throw new HttpError(401, "Your sign-in has expired. Please sign in again.");
  }

  const firebaseUser = Array.isArray(payload?.users) ? payload.users[0] : null;
  if (
    !firebaseUser ||
    typeof firebaseUser.localId !== "string" ||
    firebaseUser.localId.length === 0 ||
    firebaseUser.localId.length > 256 ||
    typeof firebaseUser.email !== "string"
  ) {
    throw new HttpError(401, "Your sign-in is invalid. Please sign in again.");
  }
  if (firebaseUser.emailVerified === false) {
    throw new HttpError(403, "Verify your email before joining the community.");
  }

  return communityUserFromEmail(firebaseUser.email, env);
}

async function communityUserFromEmail(rawEmail, env) {
  const normalizedEmail = rawEmail.trim().toLowerCase();
  if (
    normalizedEmail.length < 3 ||
    normalizedEmail.length > 320 ||
    !normalizedEmail.includes("@")
  ) {
    return null;
  }

  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(normalizedEmail),
  );
  const hash = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  const id = `u_${hash}`;
  const displayName = `Hunter ${hash.slice(0, 6).toUpperCase()}`;

  return {
    id,
    displayName,
    initials: userInitials(displayName),
    isModerator: isConfiguredModerator(hash, env),
  };
}

async function requireAuthenticatedUser(request, env) {
  const user = await getAuthenticatedUser(request, env);
  if (!user) {
    throw new HttpError(401, "Sign in to continue.");
  }
  return user;
}

async function requireModerator(request, env) {
  const user = await requireAuthenticatedUser(request, env);
  if (!user.isModerator) {
    throw new HttpError(403, "Moderator access is required.");
  }
  return user;
}

async function upsertCommunityUser(db, user, now) {
  await db
    .prepare(
      `INSERT INTO community_users
        (id, display_name, is_staff, created_at, updated_at)
        VALUES (?, ?, 0, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          display_name = excluded.display_name,
          updated_at = excluded.updated_at`,
    )
    .bind(user.id, user.displayName, now, now)
    .run();
}

function postSelectSql(viewerId) {
  return {
    sql: `SELECT
      p.id,
      p.title,
      p.body,
      p.category,
      p.post_type,
      p.state,
      p.species,
      p.hunt_number,
      u.display_name AS author_name,
      u.is_staff AS is_staff,
      p.created_at,
      p.updated_at,
      p.last_activity_at,
      p.base_score + COALESCE((
        SELECT SUM(v.is_active)
        FROM community_post_votes v
        WHERE v.post_id = p.id
      ), 0) AS score,
      p.base_reply_count + (
        SELECT COUNT(*)
        FROM community_replies r
        WHERE r.post_id = p.id
      ) AS reply_count,
      p.view_count,
      p.is_pinned,
      p.is_locked,
      CASE WHEN EXISTS (
        SELECT 1
        FROM community_post_votes viewer_vote
        WHERE viewer_vote.post_id = p.id
          AND viewer_vote.user_id = ?
          AND viewer_vote.is_active = 1
      ) THEN 1 ELSE 0 END AS viewer_vote
    FROM community_posts p
    INNER JOIN community_users u ON u.id = p.author_id`,
    viewerId: viewerId ?? "",
  };
}

function mapPost(row) {
  return {
    id: String(row.id),
    title: String(row.title),
    body: String(row.body),
    category: String(row.category),
    postType: String(row.post_type),
    state: row.state === null || row.state === undefined ? null : String(row.state),
    species:
      row.species === null || row.species === undefined
        ? null
        : String(row.species),
    huntNumber:
      row.hunt_number === null || row.hunt_number === undefined
        ? null
        : String(row.hunt_number),
    authorName: String(row.author_name),
    isStaff: Number(row.is_staff) === 1,
    createdAt: new Date(Number(row.created_at)).toISOString(),
    updatedAt: new Date(Number(row.updated_at)).toISOString(),
    lastActivityAt: new Date(Number(row.last_activity_at)).toISOString(),
    score: Number(row.score ?? 0),
    replyCount: Number(row.reply_count ?? 0),
    viewCount: Number(row.view_count ?? 0),
    isPinned: Number(row.is_pinned) === 1,
    isLocked: Number(row.is_locked) === 1,
    viewerVote: Number(row.viewer_vote) === 1,
  };
}

function mapReply(row) {
  return {
    id: String(row.id),
    postId: String(row.post_id),
    body: String(row.body),
    authorName: String(row.author_name),
    createdAt: new Date(Number(row.created_at)).toISOString(),
    updatedAt: new Date(Number(row.updated_at)).toISOString(),
    helpfulCount: Number(row.helpful_count ?? 0),
    isStaff: Number(row.is_staff) === 1,
  };
}

function validatePostId(encodedId) {
  let id;
  try {
    id = decodeURIComponent(encodedId);
  } catch {
    throw new HttpError(400, "Invalid discussion id.");
  }
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) {
    throw new HttpError(400, "Invalid discussion id.");
  }
  return id;
}

function validateReportId(encodedId) {
  let id;
  try {
    id = decodeURIComponent(encodedId);
  } catch {
    throw new HttpError(400, "Invalid report id.");
  }
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) {
    throw new HttpError(400, "Invalid report id.");
  }
  return id;
}

async function enforceRateLimit(db, sql, userId, rule, now) {
  const row = await db
    .prepare(sql)
    .bind(userId, now - rule.windowMs)
    .first();
  const count = Number(row?.event_count ?? 0);
  if (count < rule.count) return;

  const oldest = Number(row?.oldest_event ?? now);
  const retryAfter = Math.max(
    1,
    Math.ceil((oldest + rule.windowMs - now) / 1000),
  );
  throw new HttpError(
    429,
    "You are posting too quickly. Please wait a moment and try again.",
    { "Retry-After": String(retryAfter) },
  );
}

async function listPosts(request, db, viewer) {
  const url = new URL(request.url);
  const category = url.searchParams.get("category");
  const stateParam = url.searchParams.get("state");
  const queryParam = url.searchParams.get("q");
  const sort = url.searchParams.get("sort") ?? "active";

  if (category && category !== "all" && !COMMUNITY_CATEGORIES.has(category)) {
    throw new HttpError(400, "Unknown community category.");
  }
  if (!COMMUNITY_SORTS.has(sort)) {
    throw new HttpError(400, "Unknown community sort.");
  }

  const state = stateParam
    ? normalizePlainText(stateParam, "State", { min: 2, max: 2 }).toUpperCase()
    : null;
  if (state && !/^[A-Z]{2}$/.test(state)) {
    throw new HttpError(400, "State must be a two-letter abbreviation.");
  }
  const query = queryParam
    ? normalizePlainText(queryParam, "Search", { min: 1, max: 80 })
    : null;

  const selected = postSelectSql(viewer?.id);
  const where = ["p.is_removed = 0"];
  const bindings = [selected.viewerId];
  if (category && category !== "all") {
    where.push("p.category = ?");
    bindings.push(category);
  }
  if (state) {
    where.push("p.state = ?");
    bindings.push(state);
  }
  if (query) {
    where.push(
      `instr(
        lower(
          p.title || ' ' ||
          p.body || ' ' ||
          u.display_name || ' ' ||
          COALESCE(p.species, '') || ' ' ||
          COALESCE(p.hunt_number, '')
        ),
        lower(?)
      ) > 0`,
    );
    bindings.push(query);
  }

  const orderBy = {
    active: "p.is_pinned DESC, p.last_activity_at DESC, p.id DESC",
    new: "p.is_pinned DESC, p.created_at DESC, p.id DESC",
    top: "p.is_pinned DESC, score DESC, p.last_activity_at DESC, p.id DESC",
    unanswered:
      "p.is_pinned DESC, reply_count ASC, p.created_at DESC, p.id DESC",
  }[sort];
  const sql = `${selected.sql}
    ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY ${orderBy}
    LIMIT 100`;
  const result = await db.prepare(sql).bind(...bindings).all();
  return jsonResponse({ posts: (result.results ?? []).map(mapPost) });
}

async function getThread(db, postId, viewer) {
  const increment = await db
    .prepare(
      `UPDATE community_posts
       SET view_count = view_count + 1
       WHERE id = ? AND is_removed = 0`,
    )
    .bind(postId)
    .run();
  if (Number(increment.meta?.changes ?? 0) === 0) {
    throw new HttpError(404, "Discussion not found.");
  }

  const selected = postSelectSql(viewer?.id);
  const row = await db
    .prepare(`${selected.sql} WHERE p.id = ? AND p.is_removed = 0 LIMIT 1`)
    .bind(selected.viewerId, postId)
    .first();
  if (!row) throw new HttpError(404, "Discussion not found.");

  const replies = await db
    .prepare(
      `SELECT
        r.id,
        r.post_id,
        r.body,
        u.display_name AS author_name,
        r.created_at,
        r.updated_at,
        r.helpful_count,
        CASE WHEN r.is_staff = 1 OR u.is_staff = 1 THEN 1 ELSE 0 END AS is_staff
      FROM community_replies r
      INNER JOIN community_users u ON u.id = r.author_id
      WHERE r.post_id = ?
      ORDER BY r.created_at ASC, r.id ASC`,
    )
    .bind(postId)
    .all();

  return jsonResponse({
    post: mapPost(row),
    replies: (replies.results ?? []).map(mapReply),
  });
}

async function createPost(request, db, user) {
  const payload = await readJsonObject(request);
  const draft = validatePostDraft(payload);
  const now = Date.now();

  await enforceRateLimit(
    db,
    `SELECT COUNT(*) AS event_count, MIN(created_at) AS oldest_event
     FROM community_posts
     WHERE author_id = ? AND created_at >= ?`,
    user.id,
    POST_RATE_LIMIT,
    now,
  );
  await upsertCommunityUser(db, user, now);

  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO community_posts
        (id, author_id, title, body, category, post_type, state, species, hunt_number, created_at, updated_at, last_activity_at, base_score, base_reply_count, view_count, is_pinned, is_locked)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 0)`,
    )
    .bind(
      id,
      user.id,
      draft.title,
      draft.body,
      draft.category,
      draft.postType,
      draft.state,
      draft.species,
      draft.huntNumber,
      now,
      now,
      now,
    )
    .run();

  return jsonResponse(
    {
      post: {
        id,
        ...draft,
        authorName: user.displayName,
        isStaff: false,
        createdAt: new Date(now).toISOString(),
        updatedAt: new Date(now).toISOString(),
        lastActivityAt: new Date(now).toISOString(),
        score: 0,
        replyCount: 0,
        viewCount: 0,
        isPinned: false,
        isLocked: false,
        viewerVote: false,
      },
    },
    201,
    { Location: `/community/thread/${encodeURIComponent(id)}` },
  );
}

async function createReply(request, db, user, postId) {
  const payload = await readJsonObject(request);
  const body = normalizePlainText(payload.body, "Reply", {
    min: 3,
    max: 10_000,
    multiline: true,
  });
  const now = Date.now();

  const post = await db
    .prepare(
      "SELECT is_locked FROM community_posts WHERE id = ? AND is_removed = 0 LIMIT 1",
    )
    .bind(postId)
    .first();
  if (!post) throw new HttpError(404, "Discussion not found.");
  if (Number(post.is_locked) === 1) {
    throw new HttpError(409, "This discussion is locked.");
  }

  await enforceRateLimit(
    db,
    `SELECT COUNT(*) AS event_count, MIN(created_at) AS oldest_event
     FROM community_replies
     WHERE author_id = ? AND created_at >= ?`,
    user.id,
    REPLY_RATE_LIMIT,
    now,
  );
  await upsertCommunityUser(db, user, now);

  const id = crypto.randomUUID();
  await db.batch([
    db
      .prepare(
        `INSERT INTO community_replies
          (id, post_id, author_id, body, created_at, updated_at, helpful_count, is_staff)
          VALUES (?, ?, ?, ?, ?, ?, 0, 0)`,
      )
      .bind(id, postId, user.id, body, now, now),
    db
      .prepare(
        `UPDATE community_posts
         SET last_activity_at = ?, updated_at = updated_at
         WHERE id = ?`,
      )
      .bind(now, postId),
  ]);

  return jsonResponse(
    {
      reply: {
        id,
        postId,
        body,
        authorName: user.displayName,
        createdAt: new Date(now).toISOString(),
        updatedAt: new Date(now).toISOString(),
        helpfulCount: 0,
        isStaff: false,
      },
    },
    201,
  );
}

async function togglePostVote(db, user, postId) {
  const exists = await db
    .prepare(
      "SELECT 1 AS found FROM community_posts WHERE id = ? AND is_removed = 0 LIMIT 1",
    )
    .bind(postId)
    .first();
  if (!exists) throw new HttpError(404, "Discussion not found.");

  const now = Date.now();
  await upsertCommunityUser(db, user, now);
  await db
    .prepare(
      `INSERT INTO community_post_votes
        (post_id, user_id, is_active, created_at, updated_at)
        VALUES (?, ?, 1, ?, ?)
        ON CONFLICT(post_id, user_id) DO UPDATE SET
          is_active = CASE
            WHEN community_post_votes.is_active = 1 THEN 0
            ELSE 1
          END,
          updated_at = excluded.updated_at`,
    )
    .bind(postId, user.id, now, now)
    .run();

  const result = await db
    .prepare(
      `SELECT
        p.base_score + COALESCE((
          SELECT SUM(v.is_active)
          FROM community_post_votes v
          WHERE v.post_id = p.id
        ), 0) AS score,
        COALESCE((
          SELECT v.is_active
          FROM community_post_votes v
          WHERE v.post_id = p.id AND v.user_id = ?
        ), 0) AS viewer_vote
      FROM community_posts p
      WHERE p.id = ? AND p.is_removed = 0
      LIMIT 1`,
    )
    .bind(user.id, postId)
    .first();

  return jsonResponse({
    score: Number(result?.score ?? 0),
    viewerVote: Number(result?.viewer_vote) === 1,
  });
}

async function reportPost(request, db, user, postId) {
  const payload = await readJsonObject(request);
  const reason = normalizePlainText(payload.reason, "Report reason", {
    min: 3,
    max: 500,
    multiline: true,
  });
  const now = Date.now();

  const exists = await db
    .prepare(
      "SELECT 1 AS found FROM community_posts WHERE id = ? AND is_removed = 0 LIMIT 1",
    )
    .bind(postId)
    .first();
  if (!exists) throw new HttpError(404, "Discussion not found.");

  await enforceRateLimit(
    db,
    `SELECT COUNT(*) AS event_count, MIN(created_at) AS oldest_event
     FROM community_reports
     WHERE reporter_id = ? AND created_at >= ?`,
    user.id,
    REPORT_RATE_LIMIT,
    now,
  );
  await upsertCommunityUser(db, user, now);

  await db
    .prepare(
      `INSERT INTO community_reports
        (id, post_id, reporter_id, reason, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'open', ?, ?)
        ON CONFLICT(post_id, reporter_id) DO UPDATE SET
          reason = excluded.reason,
          status = 'open',
          created_at = excluded.created_at,
          updated_at = excluded.updated_at`,
    )
    .bind(crypto.randomUUID(), postId, user.id, reason, now, now)
    .run();

  return jsonResponse({ reported: true }, 201);
}

async function listModerationReports(db) {
  const result = await db
    .prepare(
      `SELECT
        reports.id,
        reports.reason,
        reports.created_at,
        posts.id AS post_id,
        posts.title AS post_title,
        CASE
          WHEN length(posts.body) > 360
            THEN substr(posts.body, 1, 360) || '…'
          ELSE posts.body
        END AS post_body_excerpt,
        authors.display_name AS post_author_name,
        posts.is_locked
      FROM community_reports reports
      INNER JOIN community_posts posts ON posts.id = reports.post_id
      INNER JOIN community_users authors ON authors.id = posts.author_id
      WHERE reports.status = 'open'
        AND posts.is_removed = 0
      ORDER BY reports.updated_at ASC, reports.id ASC
      LIMIT 200`,
    )
    .all();

  return jsonResponse({
    reports: (result.results ?? []).map((row) => ({
      id: String(row.id),
      reason: String(row.reason),
      createdAt: new Date(Number(row.created_at)).toISOString(),
      postId: String(row.post_id),
      postTitle: String(row.post_title),
      postBody: String(row.post_body_excerpt),
      postAuthorName: String(row.post_author_name),
      isLocked: Number(row.is_locked) === 1,
    })),
  });
}

async function moderateReport(request, db, moderator, reportId) {
  const payload = await readJsonObject(request);
  const action = payload.action;
  if (!["lock", "remove", "dismiss"].includes(action)) {
    throw new HttpError(
      400,
      "Moderation action must be lock, remove, or dismiss.",
    );
  }

  const report = await db
    .prepare(
      `SELECT
        reports.post_id,
        reports.status,
        posts.is_locked,
        posts.is_removed
      FROM community_reports reports
      INNER JOIN community_posts posts ON posts.id = reports.post_id
      WHERE reports.id = ?
      LIMIT 1`,
    )
    .bind(reportId)
    .first();
  if (!report) throw new HttpError(404, "Report not found.");
  if (report.status !== "open") {
    throw new HttpError(409, "This report has already been moderated.");
  }

  const postId = String(report.post_id);
  const now = Date.now();
  await upsertCommunityUser(db, moderator, now);

  const statements = [];
  if (action === "lock") {
    statements.push(
      db
        .prepare(
          `UPDATE community_posts
           SET is_locked = 1, updated_at = ?
           WHERE id = ?
             AND is_removed = 0
             AND EXISTS (
               SELECT 1
               FROM community_reports
               WHERE id = ? AND status = 'open'
             )`,
        )
        .bind(now, postId, reportId),
    );
  } else if (action === "remove") {
    statements.push(
      db
        .prepare(
          `UPDATE community_posts
           SET is_removed = 1, updated_at = ?
           WHERE id = ?
             AND is_removed = 0
             AND EXISTS (
               SELECT 1
               FROM community_reports
               WHERE id = ? AND status = 'open'
             )`,
        )
        .bind(now, postId, reportId),
    );
  }

  statements.push(
    db
      .prepare(
        `INSERT INTO community_moderation_actions
          (id, report_id, post_id, moderator_id, action, created_at)
         SELECT ?, reports.id, reports.post_id, ?, ?, ?
         FROM community_reports reports
         WHERE reports.id = ? AND reports.status = 'open'`,
      )
      .bind(
        crypto.randomUUID(),
        moderator.id,
        action,
        now,
        reportId,
      ),
  );

  const nextStatus = action === "dismiss" ? "dismissed" : "resolved";
  statements.push(
    db
      .prepare(
        `UPDATE community_reports
         SET status = ?, updated_at = ?
         WHERE id = ? AND status = 'open'`,
      )
      .bind(nextStatus, now, reportId),
  );

  const results = await db.batch(statements);
  const reportUpdate = results[results.length - 1];
  if (Number(reportUpdate?.meta?.changes ?? 0) === 0) {
    throw new HttpError(409, "This report has already been moderated.");
  }

  return jsonResponse({
    reportId,
    postId,
    action,
    status: nextStatus,
  });
}

async function handleCommunityApi(request, env, url) {
  const pathname = url.pathname.replace(/\/+$/, "") || "/";
  const method = request.method.toUpperCase();

  if (pathname === `${COMMUNITY_API_PREFIX}/session`) {
    if (method !== "GET") return methodNotAllowed(["GET"]);
    const user = await getAuthenticatedUser(request, env);
    return jsonResponse({
      user: user
        ? {
            displayName: user.displayName,
            initials: user.initials,
            isModerator: user.isModerator,
          }
        : null,
    });
  }

  if (!env.DB || typeof env.DB.prepare !== "function") {
    throw new HttpError(503, "Community data is temporarily unavailable.");
  }

  const db = env.DB;
  await ensureCommunitySchema(db);

  if (pathname === `${COMMUNITY_API_PREFIX}/moderation/reports`) {
    if (method !== "GET") return methodNotAllowed(["GET"]);
    await requireModerator(request, env);
    return listModerationReports(db);
  }

  const moderationRoute = pathname.match(
    /^\/api\/community\/moderation\/reports\/([^/]+)$/,
  );
  if (moderationRoute) {
    if (method !== "POST") return methodNotAllowed(["POST"]);
    const moderator = await requireModerator(request, env);
    const reportId = validateReportId(moderationRoute[1]);
    return moderateReport(request, db, moderator, reportId);
  }

  if (pathname === `${COMMUNITY_API_PREFIX}/posts`) {
    if (method === "GET") {
      const viewer = await getAuthenticatedUser(request, env);
      return listPosts(request, db, viewer);
    }
    if (method === "POST") {
      const user = await requireAuthenticatedUser(request, env);
      return createPost(request, db, user);
    }
    return methodNotAllowed(["GET", "POST"]);
  }

  const route = pathname.match(
    /^\/api\/community\/posts\/([^/]+)(?:\/(replies|vote|report))?$/,
  );
  if (!route) throw new HttpError(404, "Community API route not found.");

  const postId = validatePostId(route[1]);
  const action = route[2] ?? null;

  if (!action) {
    if (method !== "GET") return methodNotAllowed(["GET"]);
    const viewer = await getAuthenticatedUser(request, env);
    return getThread(db, postId, viewer);
  }

  if (method !== "POST") return methodNotAllowed(["POST"]);
  const user = await requireAuthenticatedUser(request, env);

  if (action === "replies") return createReply(request, db, user, postId);
  if (action === "vote") return togglePostVote(db, user, postId);
  return reportPost(request, db, user, postId);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (
      url.pathname === COMMUNITY_API_PREFIX ||
      url.pathname.startsWith(`${COMMUNITY_API_PREFIX}/`)
    ) {
      if (request.method.toUpperCase() === "OPTIONS") {
        return withCommunityCors(handleCommunityPreflight(request), request);
      }

      try {
        validateCommunityOrigin(request);
        const response = await handleCommunityApi(request, env, url);
        return withCommunityCors(response, request);
      } catch (error) {
        if (error instanceof HttpError) {
          return withCommunityCors(
            jsonResponse(
              { error: error.message },
              error.status,
              error.headers,
            ),
            request,
          );
        }
        console.error("Community API request failed.", error);
        return withCommunityCors(
          jsonResponse(
            { error: "Community data is temporarily unavailable." },
            500,
          ),
          request,
        );
      }
    }

    let response = await env.ASSETS.fetch(request);
    if (response.status !== 404) return response;

    if (!INDEXABLE_EXTENSION.test(url.pathname)) {
      const directoryIndex = `${url.pathname.replace(/\/+$/, "")}/index.html`;
      response = await fetchAsset(request, env, directoryIndex);
      if (response.status !== 404) return response;
    }

    return fetchAsset(request, env, "/index.html");
  },
};

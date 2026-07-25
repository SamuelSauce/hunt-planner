CREATE TABLE IF NOT EXISTS scout_shares (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  title TEXT NOT NULL,
  state TEXT NOT NULL,
  hunt_number TEXT NOT NULL,
  document_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  revoked_at INTEGER
);

CREATE INDEX IF NOT EXISTS scout_shares_owner_updated_idx
  ON scout_shares (owner_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS scout_workspaces (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  state TEXT NOT NULL,
  hunt_number TEXT NOT NULL,
  name TEXT NOT NULL,
  document_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (owner_id, state, hunt_number)
);

CREATE INDEX IF NOT EXISTS scout_workspaces_owner_updated_idx
  ON scout_workspaces (owner_id, updated_at DESC);

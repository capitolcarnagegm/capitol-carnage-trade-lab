PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS league_datasets (
  id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL DEFAULT 1,
  dataset_version TEXT NOT NULL,
  source TEXT,
  league_json TEXT NOT NULL,
  counts_json TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
  imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_league_datasets_active ON league_datasets(is_active, imported_at);

CREATE TABLE IF NOT EXISTS league_dataset_chunks (
  dataset_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  assets_json TEXT NOT NULL,
  PRIMARY KEY(dataset_id, chunk_index),
  FOREIGN KEY(dataset_id) REFERENCES league_datasets(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS app_sessions (
  token_hash TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL,
  last_used_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_app_sessions_expiry ON app_sessions(expires_at, revoked_at);

CREATE TABLE IF NOT EXISTS auth_attempts (
  key_hash TEXT PRIMARY KEY,
  failed_count INTEGER NOT NULL DEFAULT 0,
  window_started_at TEXT NOT NULL,
  blocked_until TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ai_daily_usage (
  usage_day TEXT NOT NULL,
  provider TEXT NOT NULL CHECK(provider IN ('gemini', 'llama')),
  request_count INTEGER NOT NULL DEFAULT 0,
  reserved_units INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(usage_day, provider)
);

CREATE TABLE IF NOT EXISTS fantrax_snapshots (
  kind TEXT PRIMARY KEY CHECK(kind IN ('league', 'rosters', 'standings', 'matchups', 'players', 'draftPicks', 'draftResults')),
  payload_json TEXT NOT NULL,
  synced_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fantrax_roster_events (
  event_id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK(event_type IN ('ADD', 'DROP', 'MOVE', 'STATUS')),
  from_team TEXT,
  to_team TEXT,
  from_status TEXT,
  to_status TEXT,
  detected_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_fantrax_roster_events_detected ON fantrax_roster_events(detected_at);

CREATE TABLE IF NOT EXISTS fantrax_sync_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trigger_type TEXT NOT NULL CHECK(trigger_type IN ('manual', 'cron')),
  started_at TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('success', 'partial', 'failed')),
  success_json TEXT NOT NULL,
  error_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_fantrax_sync_runs_completed ON fantrax_sync_runs(completed_at);

CREATE TABLE IF NOT EXISTS sports_snapshots (
  kind TEXT PRIMARY KEY CHECK(kind IN ('scores', 'news')),
  payload_json TEXT NOT NULL,
  synced_at TEXT NOT NULL
);

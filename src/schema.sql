CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  username TEXT UNIQUE,
  password_hash TEXT,
  password_salt TEXT,
  display_name TEXT DEFAULT '',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS user_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS user_leagues (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  fantrax_league_id TEXT NOT NULL,
  league_name TEXT,
  team_id TEXT NOT NULL,
  team_name TEXT NOT NULL,
  settings_json TEXT DEFAULT '{}',
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, fantrax_league_id)
);

CREATE TABLE IF NOT EXISTS account_entitlements (
  user_id TEXT PRIMARY KEY,
  access_until TEXT,
  permanent_bypass INTEGER DEFAULT 0,
  note TEXT,
  updated_by TEXT,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS site_settings (
  key TEXT PRIMARY KEY,
  enabled INTEGER DEFAULT 1,
  updated_by TEXT,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS password_login_attempts (
  client_key TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

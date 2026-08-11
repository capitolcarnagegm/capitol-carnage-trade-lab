CREATE TABLE IF NOT EXISTS account_entitlements (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  access_until TEXT,
  permanent_bypass INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS site_settings (
  key TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 1,
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO site_settings (key, enabled) VALUES
  ('payment_required', 1), ('checkout', 1), ('onboarding', 1),
  ('league_data', 1), ('ai_analysis', 1), ('waivers', 1),
  ('news', 1), ('current_games', 1);

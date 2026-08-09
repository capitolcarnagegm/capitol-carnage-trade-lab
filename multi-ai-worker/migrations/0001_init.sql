PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS franchises (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  league_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  franchise_id TEXT NOT NULL,
  title TEXT,
  active_tab TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('user','assistant','system')),
  provider TEXT,
  model TEXT,
  content TEXT NOT NULL,
  metadata_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, id);

CREATE TABLE IF NOT EXISTS memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  franchise_id TEXT NOT NULL,
  category TEXT NOT NULL CHECK(category IN ('VERIFIED','CURRENT','USER_THESIS','MODEL_INFERENCE','OWNER_TENDENCY','STRATEGY','RULE')),
  subject TEXT NOT NULL,
  content TEXT NOT NULL,
  source TEXT,
  confidence REAL NOT NULL DEFAULT 0.75,
  valid_from TEXT,
  valid_until TEXT,
  superseded_by INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(superseded_by) REFERENCES memories(id)
);
CREATE INDEX IF NOT EXISTS idx_memories_franchise_subject ON memories(franchise_id, subject);
CREATE INDEX IF NOT EXISTS idx_memories_category ON memories(franchise_id, category);

CREATE TABLE IF NOT EXISTS council_runs (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  franchise_id TEXT NOT NULL,
  task_type TEXT,
  active_tab TEXT,
  prompt TEXT NOT NULL,
  disagreement_score REAL,
  final_score REAL,
  letter_grade TEXT,
  verdict TEXT,
  confidence REAL,
  status TEXT NOT NULL DEFAULT 'running',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS council_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  council_run_id TEXT NOT NULL,
  round TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT,
  content TEXT NOT NULL,
  score REAL,
  metadata_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(council_run_id) REFERENCES council_runs(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_council_reports_run ON council_reports(council_run_id, id);

CREATE TABLE IF NOT EXISTS decisions (
  id TEXT PRIMARY KEY,
  council_run_id TEXT,
  franchise_id TEXT NOT NULL,
  action_type TEXT NOT NULL,
  subject TEXT NOT NULL,
  score REAL NOT NULL,
  letter_grade TEXT NOT NULL,
  verdict TEXT NOT NULL,
  confidence REAL,
  five_year_json TEXT,
  four_gate_json TEXT,
  component_scores_json TEXT,
  risks_json TEXT,
  alternatives_json TEXT,
  rationale TEXT,
  outcome_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TEXT,
  FOREIGN KEY(council_run_id) REFERENCES council_runs(id)
);
CREATE INDEX IF NOT EXISTS idx_decisions_franchise ON decisions(franchise_id, created_at);

CREATE TABLE IF NOT EXISTS evidence (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  council_run_id TEXT,
  decision_id TEXT,
  truth_label TEXT NOT NULL CHECK(truth_label IN ('VERIFIED','CURRENT','USER_THESIS','MODEL_INFERENCE')),
  claim TEXT NOT NULL,
  source_url TEXT,
  source_name TEXT,
  published_at TEXT,
  retrieved_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  confidence REAL NOT NULL DEFAULT 0.75,
  metadata_json TEXT,
  FOREIGN KEY(council_run_id) REFERENCES council_runs(id) ON DELETE CASCADE,
  FOREIGN KEY(decision_id) REFERENCES decisions(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_evidence_run ON evidence(council_run_id);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  franchise_id TEXT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  before_json TEXT,
  after_json TEXT,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_audit_franchise ON audit_log(franchise_id, id);

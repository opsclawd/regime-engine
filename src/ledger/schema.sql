PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS plan_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id TEXT NOT NULL,
  as_of_unix_ms INTEGER NOT NULL,
  request_hash TEXT NOT NULL,
  request_json TEXT NOT NULL,
  created_at_unix_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id TEXT NOT NULL,
  plan_hash TEXT NOT NULL,
  as_of_unix_ms INTEGER NOT NULL,
  plan_json TEXT NOT NULL,
  created_at_unix_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS execution_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id TEXT NOT NULL,
  plan_hash TEXT NOT NULL,
  as_of_unix_ms INTEGER NOT NULL,
  result_json TEXT NOT NULL,
  created_at_unix_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_plan_requests_plan_id
  ON plan_requests(plan_id);

CREATE INDEX IF NOT EXISTS idx_plans_plan_id
  ON plans(plan_id);

CREATE INDEX IF NOT EXISTS idx_execution_results_plan_id
  ON execution_results(plan_id);

CREATE TABLE IF NOT EXISTS sr_level_briefs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  brief_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  source_recorded_at_iso TEXT,
  summary TEXT,
  brief_json TEXT NOT NULL,
  captured_at_unix_ms INTEGER NOT NULL,
  UNIQUE (source, brief_id)
);

CREATE TABLE IF NOT EXISTS sr_levels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  brief_id INTEGER NOT NULL REFERENCES sr_level_briefs(id),
  level_type TEXT NOT NULL CHECK (level_type IN ('support','resistance')),
  price REAL NOT NULL,
  timeframe TEXT,
  rank TEXT,
  invalidation REAL,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_sr_level_briefs_current
  ON sr_level_briefs(symbol, source, captured_at_unix_ms DESC);

CREATE INDEX IF NOT EXISTS idx_sr_levels_brief_id
  ON sr_levels(brief_id);

CREATE TABLE IF NOT EXISTS clmm_execution_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  correlation_id TEXT NOT NULL UNIQUE,
  event_json TEXT NOT NULL,
  received_at_unix_ms INTEGER NOT NULL
);

-- End of schema. Do NOT re-declare tables or indexes below this line.
-- Every CREATE statement must appear exactly once.
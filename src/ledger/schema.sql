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

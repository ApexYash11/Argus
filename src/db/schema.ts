export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS financial_records (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  vendor_id TEXT NOT NULL,
  amount REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'INR',
  date TEXT NOT NULL,
  period_start TEXT,
  period_end TEXT,
  description TEXT,
  status TEXT,
  source_doc_id TEXT,
  raw TEXT,
  ingested_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_financial_records_vendor ON financial_records(vendor_id);
CREATE INDEX IF NOT EXISTS idx_financial_records_type ON financial_records(type);
CREATE INDEX IF NOT EXISTS idx_financial_records_date ON financial_records(date);

CREATE TABLE IF NOT EXISTS vendors (
  id TEXT PRIMARY KEY,
  canonical_name TEXT NOT NULL,
  aliases TEXT NOT NULL,
  trust_score REAL DEFAULT 1.0,
  first_seen TEXT,
  last_seen TEXT
);

CREATE INDEX IF NOT EXISTS idx_vendors_name ON vendors(canonical_name);

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  filename TEXT NOT NULL,
  type TEXT NOT NULL,
  record_count INTEGER,
  extracted_text TEXT,
  ingested_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS findings (
  id TEXT PRIMARY KEY,
  fingerprint TEXT NOT NULL UNIQUE,
  agent_type TEXT NOT NULL,
  vendor_id TEXT,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  evidence_chain TEXT NOT NULL,
  impact_amount REAL,
  impact_currency TEXT,
  confidence REAL NOT NULL,
  severity TEXT NOT NULL,
  status TEXT DEFAULT 'open',
  status_reason TEXT,
  scratchpad_run_id TEXT,
  investigation_events TEXT,
  dismissed_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  resolved_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_findings_fingerprint ON findings(fingerprint);
CREATE INDEX IF NOT EXISTS idx_findings_status ON findings(status);
CREATE INDEX IF NOT EXISTS idx_findings_agent ON findings(agent_type);
CREATE INDEX IF NOT EXISTS idx_findings_severity ON findings(severity);

CREATE TABLE IF NOT EXISTS feedback (
  id TEXT PRIMARY KEY,
  finding_id TEXT NOT NULL REFERENCES findings(id),
  action TEXT NOT NULL,
  reason TEXT,
  confidence_delta REAL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_feedback_finding ON feedback(finding_id);

CREATE TABLE IF NOT EXISTS calibration (
  workspace_id TEXT NOT NULL DEFAULT 'default',
  agent_type TEXT NOT NULL,
  vendor_id TEXT,
  threshold_override REAL,
  dismiss_count INTEGER DEFAULT 0,
  last_updated TEXT,
  PRIMARY KEY (workspace_id, agent_type, vendor_id)
);

CREATE TABLE IF NOT EXISTS scratchpad_runs (
  id TEXT PRIMARY KEY,
  trigger TEXT NOT NULL,
  agent_type TEXT,
  finding_id TEXT,
  file_path TEXT NOT NULL,
  event_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS contract_terms (
  vendor_id TEXT PRIMARY KEY,
  base_price REAL NOT NULL,
  billing_frequency TEXT NOT NULL,
  escalation_clause REAL,
  volume_discounts TEXT,
  payment_terms TEXT,
  scope_of_services TEXT,
  extracted_from TEXT,
  extracted_at TEXT DEFAULT (datetime('now'))
);
`;

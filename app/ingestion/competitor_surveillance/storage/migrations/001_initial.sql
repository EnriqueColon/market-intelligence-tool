-- Competitor Surveillance schema
-- data/competitor_surveillance.sqlite

CREATE TABLE IF NOT EXISTS competitors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  aliases_json TEXT DEFAULT '[]',
  website TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_type TEXT NOT NULL,
  name TEXT NOT NULL,
  config_json TEXT DEFAULT '{}',
  enabled INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  competitor_id INTEGER NOT NULL,
  source_type TEXT NOT NULL,
  event_type TEXT NOT NULL,
  title TEXT,
  summary TEXT,
  event_date TEXT,
  url TEXT,
  raw_json TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (competitor_id) REFERENCES competitors(id)
);

CREATE TABLE IF NOT EXISTS metrics_daily (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  competitor_id INTEGER NOT NULL,
  metric_date TEXT NOT NULL,
  event_count_30d INTEGER DEFAULT 0,
  fundraise_count_24m INTEGER DEFAULT 0,
  ucc_count_90d INTEGER DEFAULT 0,
  aom_count_90d INTEGER DEFAULT 0,
  foreclosure_count_90d INTEGER DEFAULT 0,
  hiring_count_90d INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(competitor_id, metric_date),
  FOREIGN KEY (competitor_id) REFERENCES competitors(id)
);

CREATE INDEX IF NOT EXISTS idx_events_competitor_id ON events(competitor_id);
CREATE INDEX IF NOT EXISTS idx_events_event_date ON events(event_date);
CREATE INDEX IF NOT EXISTS idx_events_source_type ON events(source_type);
CREATE INDEX IF NOT EXISTS idx_events_event_type ON events(event_type);
CREATE INDEX IF NOT EXISTS idx_metrics_competitor_id ON metrics_daily(competitor_id);
CREATE INDEX IF NOT EXISTS idx_metrics_metric_date ON metrics_daily(metric_date);

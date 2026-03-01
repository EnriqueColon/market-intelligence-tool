-- Add unique constraint on source_type for sources table
CREATE UNIQUE INDEX IF NOT EXISTS idx_sources_source_type ON sources(source_type);

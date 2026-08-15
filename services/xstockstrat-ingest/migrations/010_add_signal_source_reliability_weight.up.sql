ALTER TABLE ingest.signal_sources
  ADD COLUMN reliability_weight DOUBLE PRECISION NOT NULL DEFAULT 1.0
    CHECK (reliability_weight BETWEEN 0 AND 1);

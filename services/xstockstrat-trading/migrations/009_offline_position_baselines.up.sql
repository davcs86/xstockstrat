-- Feature 163 (snapshot-offline-positions): effective-dated position baselines for OFFLINE accounts.
-- Plain table (not a hypertable) — point lookups by (account_id, client_snapshot_id, symbol).

CREATE TABLE IF NOT EXISTS trading.offline_position_baselines (
  account_id          TEXT           NOT NULL,
  client_snapshot_id  TEXT           NOT NULL,
  as_of               TIMESTAMPTZ    NOT NULL,
  symbol              TEXT           NOT NULL,
  qty                 NUMERIC(18,8)  NOT NULL,   -- signed: long +, short −
  avg_cost_per_share  NUMERIC(18,8)  NOT NULL,
  created_at          TIMESTAMPTZ    NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, client_snapshot_id, symbol)
);

CREATE INDEX IF NOT EXISTS idx_offline_position_baselines_account_asof
  ON trading.offline_position_baselines (account_id, as_of DESC, created_at DESC);

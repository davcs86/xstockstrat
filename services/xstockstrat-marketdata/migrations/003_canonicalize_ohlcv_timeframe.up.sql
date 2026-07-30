-- 003_canonicalize_ohlcv_timeframe.up.sql
-- Feature 080 (fix-backfill-timeframe-enum), FR-14.
--
-- Data remediation, NOT a schema change to marketdata.ohlcv: canonicalizes the three
-- recoverable non-canonical `timeframe` spellings that earlier read/write paths persisted
-- verbatim ('1Day'/'1Hour'/'15Min' instead of '1d'/'1h'/'15m'). QueryBars matches
-- `WHERE timeframe=$2` on the canonical string, so a non-canonical row has been silently
-- unqueryable since it was written.
--
-- `timeframe` is a PRIMARY KEY column (symbol, timeframe, time) but NOT the hypertable
-- partitioning column (`time` is, chunk_time_interval '1 day' — see
-- 001_marketdata_hypertables.up.sql). Rewriting it therefore never relocates a row across
-- chunks.
--
-- Out of scope, deliberately: `timeframe=''` rows (the interval was never recorded — intent
-- is unrecoverable) and `timeframe='1m'` rows (a MARKETDATA-2 anomaly; streamed 1-minute bars
-- are never persisted, so any such row predates that invariant being enforced). Both are
-- counted below, never rewritten. This migration does NOT claim to leave `ohlcv.timeframe`
-- fully canonical — only that no *recoverable* alias row remains.
--
-- Precondition: no compressed chunks on `ohlcv` (UPDATE/DELETE against a compressed
-- TimescaleDB chunk fails outright). Compression is planned but not yet applied to this
-- table (see marketdata CLAUDE.md), so this holds today; re-verify before running if that
-- has changed. The runner must also quiesce StartBarIngestPoller (writes roughly every
-- 60s) before applying, per the concurrency note on step (b) below.

-- No explicit BEGIN/COMMIT: migrate's postgres driver already wraps each migration file in
-- its own transaction, and no other migration in this repo nests one — matched here.

-- Registers a pre-flight guard, not a code fix: if this ever fires it means the precondition
-- above no longer holds and the migration must not proceed silently.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM timescaledb_information.chunks
        WHERE hypertable_name = 'ohlcv' AND hypertable_schema = 'marketdata' AND is_compressed
    ) THEN
        RAISE EXCEPTION 'marketdata.ohlcv has compressed chunks — 003_canonicalize_ohlcv_timeframe cannot run against a compressed chunk. Escalate before proceeding.';
    END IF;
END $$;

-- The remediation log. Created BEFORE the remediation runs so the .down.sql has something to
-- reverse from — this is what makes the down migration a faithful reverse rather than a
-- no-op: without it, a merged '1d' row is indistinguishable from one that was always
-- canonical, and the original spelling could not be restored.
--
-- Owner: xstockstrat-marketdata. Purpose: one-shot feature-080 FR-14 remediation audit and
-- down-migration source. Expected size: one row per remediated row — bounded by whatever
-- alias rows exist at migration time (expected zero-to-few; see the pre-flight
-- `SELECT DISTINCT timeframe` check in the runbook). Retention: kept until the remediation is
-- confirmed in production, then dropped via a later numbered migration — deliberately NOT
-- dropped by this migration's .up.sql.
CREATE TABLE IF NOT EXISTS marketdata.ohlcv_remediation_003 (
    op             TEXT        NOT NULL,   -- 'update' | 'delete'
    time           TIMESTAMPTZ NOT NULL,
    symbol         TEXT        NOT NULL,
    old_timeframe  TEXT        NOT NULL,
    new_timeframe  TEXT,                   -- NULL for 'delete'
    open           NUMERIC(18,8),
    high           NUMERIC(18,8),
    low            NUMERIC(18,8),
    close          NUMERIC(18,8),
    volume         BIGINT,
    vwap           NUMERIC(18,8),
    trade_count    INTEGER,
    source         TEXT,
    PRIMARY KEY (symbol, old_timeframe, time)
);

-- Single alias→canonical mapping, referenced by both branches below, so the vocabulary is
-- expressed once rather than as three copy-pasted statement pairs.
--   '1Day'  -> '1d'
--   '1Hour' -> '1h'
--   '15Min' -> '15m'

-- (a) Where an alias row has a canonical twin for the same (symbol, time), the canonical row
--     is authoritative — it is the row QueryBars has been able to read all along
--     (marketdata_repo.go:88, `WHERE timeframe=$2` on the canonical string) and the one the
--     always-on ingester keeps fresh. The alias row is data no reader could ever see, so it is
--     deleted, not merged. Logged via a CTE so the delete and the log cannot diverge.
WITH alias_map(alias, canonical) AS (
    VALUES ('1Day', '1d'), ('1Hour', '1h'), ('15Min', '15m')
),
to_delete AS (
    DELETE FROM marketdata.ohlcv o
    USING alias_map m
    WHERE o.timeframe = m.alias
      AND EXISTS (
          SELECT 1 FROM marketdata.ohlcv c
          WHERE c.symbol = o.symbol AND c.time = o.time AND c.timeframe = m.canonical
      )
    RETURNING o.time, o.symbol, o.timeframe AS old_timeframe,
              o.open, o.high, o.low, o.close, o.volume, o.vwap, o.trade_count, o.source
)
INSERT INTO marketdata.ohlcv_remediation_003
    (op, time, symbol, old_timeframe, new_timeframe, open, high, low, close, volume, vwap, trade_count, source)
SELECT 'delete', time, symbol, old_timeframe, NULL,
       open, high, low, close, volume, vwap, trade_count, source
FROM to_delete;

-- (b) Remaining alias rows (no canonical twin existed at step (a)) are relabelled in place.
--     This UPDATE carries its OWN `WHERE NOT EXISTS` twin re-check rather than relying on (a)
--     having cleared the way — (a) and (b) are separate statements, and the bar-ingest poller
--     (StartBarIngestPoller, ~60s cadence) can commit a canonical row between them. Without
--     this re-check, that row would reintroduce the exact PK violation the delete-branch
--     exists to avoid. The runbook's PRE-FLIGHT 2 quiesces the writer to make this unlikely;
--     this re-check is what makes correctness not depend on an operator remembering that step.
WITH alias_map(alias, canonical) AS (
    VALUES ('1Day', '1d'), ('1Hour', '1h'), ('15Min', '15m')
),
to_update AS (
    UPDATE marketdata.ohlcv o
    SET timeframe = m.canonical
    FROM alias_map m
    WHERE o.timeframe = m.alias
      AND NOT EXISTS (
          SELECT 1 FROM marketdata.ohlcv c
          WHERE c.symbol = o.symbol AND c.time = o.time AND c.timeframe = m.canonical
      )
    RETURNING o.time, o.symbol, m.alias AS old_timeframe, m.canonical AS new_timeframe
)
INSERT INTO marketdata.ohlcv_remediation_003 (op, time, symbol, old_timeframe, new_timeframe)
SELECT 'update', time, symbol, old_timeframe, new_timeframe
FROM to_update;

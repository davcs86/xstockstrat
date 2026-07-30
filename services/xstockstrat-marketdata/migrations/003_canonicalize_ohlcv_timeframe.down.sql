-- 003_canonicalize_ohlcv_timeframe.down.sql
-- Feature 080 (fix-backfill-timeframe-enum), FR-14.
--
-- LIMITATION, stated explicitly: this reverse is faithful ONLY because the up migration
-- logged every row it touched into marketdata.ohlcv_remediation_003 before changing it.
-- Without that log, a merged '1d' row would be indistinguishable from one that was always
-- canonical, and the original non-canonical spelling could not be restored. If this table
-- has already been dropped (see its retention note in the .up.sql header — kept until the
-- remediation is confirmed in production), this down migration cannot run and the up
-- migration's effect is permanent by then, deliberately.
--
-- No explicit BEGIN/COMMIT — matches every other migration in this repo; migrate wraps each
-- file in its own transaction.

-- Reverse (b): every 'update' row's timeframe reverts from new_timeframe back to
-- old_timeframe. The row itself was never deleted, so this is a plain UPDATE.
UPDATE marketdata.ohlcv o
SET timeframe = r.old_timeframe
FROM marketdata.ohlcv_remediation_003 r
WHERE r.op = 'update'
  AND o.symbol = r.symbol
  AND o.time = r.time
  AND o.timeframe = r.new_timeframe;

-- Reverse (a): every 'delete' row is re-inserted with its original (alias) timeframe and
-- full value columns, exactly as logged.
INSERT INTO marketdata.ohlcv (time, symbol, timeframe, open, high, low, close, volume, vwap, trade_count, source)
SELECT r.time, r.symbol, r.old_timeframe, r.open, r.high, r.low, r.close, r.volume, r.vwap, r.trade_count, r.source
FROM marketdata.ohlcv_remediation_003 r
WHERE r.op = 'delete';

DROP TABLE IF EXISTS marketdata.ohlcv_remediation_003;

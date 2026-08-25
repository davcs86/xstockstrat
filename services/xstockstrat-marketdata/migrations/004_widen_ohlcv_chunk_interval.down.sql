-- 004_widen_ohlcv_chunk_interval.down.sql
-- Feature 153 (fix-ohlcv-chunk-lock-oom). Reverse of 004_widen_ohlcv_chunk_interval.up.sql.
--
-- Resets the marketdata.ohlcv hypertable's chunk_time_interval back to the pre-migration value
-- of 1 day.
--
-- NOTE: this reverses only the CONFIGURED dimension interval. Any 30-day chunks physically
-- created while the up-migration was in effect remain 30 days wide after this down runs
-- (set_chunk_time_interval cannot un-create or re-split existing chunks without a data move).
-- This is benign: wider chunks mean FEWER locks per scan, i.e. strictly better for the OOM this
-- feature fixes. The down restores the knob so future chunks are 1-day again; it does not, and
-- need not, restore physical chunk width.
--
-- No explicit BEGIN/COMMIT: migrate wraps each file in its own transaction (matches 004 up / 003).

SELECT set_chunk_time_interval('marketdata.ohlcv', INTERVAL '1 day');

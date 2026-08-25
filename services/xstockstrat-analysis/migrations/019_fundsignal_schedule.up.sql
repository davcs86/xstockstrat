-- 019_fundsignal_schedule.up.sql
-- Service: xstockstrat-analysis
-- Feature 156 (fix-fundamentals-signal-producer): durable, crash-safe schedule for the fundamentals
-- producer loop. blocked_until_ms = next-due epoch-ms, advanced ONLY after a cycle completes (a crash
-- before the advance leaves the row due → the restarted process re-runs promptly). process_name is a
-- diagnostic last-runner (not load-bearing at instance_count:1; the in-process asyncio.Lock guards
-- overlap). Self-seeded at boot by app/engine/fundsignal_loop.py (INSERT ... ON CONFLICT DO NOTHING).

CREATE TABLE IF NOT EXISTS analysis.fundsignal_schedule (
  job_name         text PRIMARY KEY,
  blocked_until_ms bigint NOT NULL,
  process_name     text,
  updated_at       timestamptz NOT NULL DEFAULT now()
);

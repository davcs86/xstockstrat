-- 020_job_schedule.up.sql
-- Service: xstockstrat-analysis
-- Feature 158 (durable-loop-scheduler): generalize feature 156's analysis.fundsignal_schedule into a
-- (job_name, user_id)-keyed table backing the shared DurableSchedule helper. user_id = '' (never NULL)
-- for a global job (one row per job); set for a per-user job. Additive ALTER preserves the single
-- persisted 'fundsignal' row with no data copy and leaves no orphaned table (F-01: 019 is untouched;
-- 020 renames the table 019 created).
ALTER TABLE analysis.fundsignal_schedule RENAME TO job_schedule;
ALTER TABLE analysis.job_schedule ADD COLUMN user_id text NOT NULL DEFAULT '';
ALTER TABLE analysis.job_schedule DROP CONSTRAINT fundsignal_schedule_pkey;
ALTER TABLE analysis.job_schedule ADD CONSTRAINT job_schedule_pkey PRIMARY KEY (job_name, user_id);

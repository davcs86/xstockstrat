-- 020_job_schedule.down.sql
-- Reversible ONLY under the v1 single-global-row invariant: at v1 the sole row is ('fundsignal', ''),
-- so collapsing the PK back to (job_name) cannot collide. A future per-user feature that writes
-- ('job','<user>') rows makes this down-migration lossy/unsafe — do not blindly trust it then.
ALTER TABLE analysis.job_schedule DROP CONSTRAINT job_schedule_pkey;
ALTER TABLE analysis.job_schedule DROP COLUMN user_id;
ALTER TABLE analysis.job_schedule ADD CONSTRAINT fundsignal_schedule_pkey PRIMARY KEY (job_name);
ALTER TABLE analysis.job_schedule RENAME TO fundsignal_schedule;

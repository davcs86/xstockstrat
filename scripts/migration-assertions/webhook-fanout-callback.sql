-- feature 334 webhook-fanout-callback (AC-2, AC-6, AC-7, AC-21, AC-29): run by migration-rerun.py after all migrations.
-- Each PREPARE body is a copy of the statement its source ships; change both together.
BEGIN;

CREATE TEMP TABLE wf_rc (step text PRIMARY KEY, n int NOT NULL) ON COMMIT DROP;

-- services/xstockstrat-notify/src/grpc/notifyServiceImpl.ts#fanoutWebhook
PREPARE wf_accept AS
        INSERT INTO notify.webhook_deliveries
           (idempotency_key, callback_url, event_name, payload, source_service)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (idempotency_key) DO NOTHING;

-- services/xstockstrat-notify/src/fanout/webhookWorker.ts (due-select, delivered, retry, dead)
PREPARE wf_due AS
        SELECT delivery_id, idempotency_key, callback_url, event_name, payload, source_service,
                attempts, created_at
           FROM notify.webhook_deliveries
          WHERE state = 'pending' AND next_attempt_at <= NOW()
            AND NOT (delivery_id = ANY($1::uuid[]))
          ORDER BY next_attempt_at
          LIMIT $2;

PREPARE wf_delivered AS
        UPDATE notify.webhook_deliveries
            SET state = 'delivered', attempts = attempts + 1, last_error = NULL, updated_at = NOW()
          WHERE delivery_id = $1 AND state = 'pending';

PREPARE wf_retry AS
      UPDATE notify.webhook_deliveries
          SET attempts = attempts + 1, next_attempt_at = NOW() + make_interval(secs => $2),
              last_error = $3, updated_at = NOW()
        WHERE delivery_id = $1 AND state = 'pending';

PREPARE wf_dead AS
      UPDATE notify.webhook_deliveries
          SET state = 'dead', attempts = attempts + $2, last_error = $3, updated_at = NOW()
        WHERE delivery_id = $1 AND state = 'pending';

-- services/xstockstrat-ingest/app/repositories/backfill_jobs.py
-- (insert_job, list_webhook_handoff_candidates, mark_webhook_enqueued, mark_webhook_rejected)
PREPARE wf_insert_job AS
        INSERT INTO ingest.backfill_jobs
         (job_id, symbols, timeframe, range_start, range_end, status, data_kind, callback_url)
         VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8);

PREPARE wf_candidates AS
        SELECT * FROM ingest.backfill_jobs
         WHERE callback_url IS NOT NULL AND status = ANY($1::smallint[])
         AND webhook_enqueued_at IS NULL AND webhook_rejected_at IS NULL
         ORDER BY completed_at, created_at LIMIT $2;

PREPARE wf_mark_enqueued AS
        UPDATE ingest.backfill_jobs SET webhook_enqueued_at = NOW()
         WHERE job_id = $1::uuid
         AND webhook_enqueued_at IS NULL AND webhook_rejected_at IS NULL;

PREPARE wf_mark_rejected AS
        UPDATE ingest.backfill_jobs SET webhook_rejected_at = NOW()
         WHERE job_id = $1::uuid
         AND webhook_enqueued_at IS NULL AND webhook_rejected_at IS NULL;

-- ── notify: accept ──────────────────────────────────────────────────────────
EXECUTE wf_accept('wf-assert:a', 'https://webhooks.example.net:8443/hooks/a', 'ingest.backfill.completed',
                  '{"job_id":"a"}', 'xstockstrat-ingest');
INSERT INTO wf_rc VALUES ('accept-a-first', :ROW_COUNT);
EXECUTE wf_accept('wf-assert:a', 'https://webhooks.example.net:8443/hooks/a', 'ingest.backfill.completed',
                  '{"job_id":"a"}', 'xstockstrat-ingest');
INSERT INTO wf_rc VALUES ('accept-a-repeat', :ROW_COUNT);
EXECUTE wf_accept('wf-assert:b', 'https://webhooks.example.net:8443/hooks/b', 'ingest.backfill.failed',
                  '{"job_id":"b"}', 'xstockstrat-ingest');
INSERT INTO wf_rc VALUES ('accept-b', :ROW_COUNT);

DO $$
DECLARE
  r notify.webhook_deliveries%ROWTYPE;
BEGIN
  IF (SELECT count(*) FROM notify.webhook_deliveries WHERE idempotency_key = 'wf-assert:a') <> 1 THEN
    RAISE EXCEPTION 'AC-7: a repeated accept did not leave exactly one row';
  END IF;
  SELECT * INTO r FROM notify.webhook_deliveries WHERE idempotency_key = 'wf-assert:a';
  IF r.state <> 'pending' OR r.attempts <> 0 OR r.last_error IS NOT NULL THEN
    RAISE EXCEPTION 'AC-6: accepted row is not pending with 0 attempts (state %, attempts %)', r.state, r.attempts;
  END IF;
  IF r.payload <> '{"job_id":"a"}'::jsonb OR r.source_service <> 'xstockstrat-ingest' THEN
    RAISE EXCEPTION 'AC-6: accepted row does not carry the payload and the source service';
  END IF;

  BEGIN
    INSERT INTO notify.webhook_deliveries
      (idempotency_key, callback_url, event_name, payload, source_service, state)
    VALUES ('wf-assert:bogus', 'https://webhooks.example.net:8443/hooks/x', 'e', '{}', 's', 'bogus');
    RAISE EXCEPTION 'state CHECK accepted the value bogus';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'notify' AND tablename = 'webhook_deliveries'
       AND indexname = 'idx_webhook_deliveries_pending'
       AND indexdef LIKE '%(next_attempt_at)%'
       AND indexdef LIKE '%WHERE (state = ''pending''::text)%'
  ) THEN
    RAISE EXCEPTION 'partial index idx_webhook_deliveries_pending on (next_attempt_at) WHERE state = pending is missing';
  END IF;
END $$;

-- ── notify: worker statements ───────────────────────────────────────────────
SELECT delivery_id AS wf_a FROM notify.webhook_deliveries WHERE idempotency_key = 'wf-assert:a' \gset
SELECT delivery_id AS wf_b FROM notify.webhook_deliveries WHERE idempotency_key = 'wf-assert:b' \gset

CREATE TEMP TABLE wf_due_all ON COMMIT DROP AS EXECUTE wf_due('{}', 1000);
CREATE TEMP TABLE wf_due_a_in_flight ON COMMIT DROP AS EXECUTE wf_due(ARRAY[:'wf_a']::uuid[], 1000);

EXECUTE wf_retry(:'wf_a', 120, 'http 503');
INSERT INTO wf_rc VALUES ('retry-a', :ROW_COUNT);

DO $$
DECLARE
  r notify.webhook_deliveries%ROWTYPE;
BEGIN
  IF (SELECT count(*) FROM wf_due_all WHERE idempotency_key IN ('wf-assert:a', 'wf-assert:b')) <> 2 THEN
    RAISE EXCEPTION 'due-select did not return both pending rows';
  END IF;
  IF EXISTS (SELECT 1 FROM wf_due_a_in_flight WHERE idempotency_key = 'wf-assert:a') THEN
    RAISE EXCEPTION 'due-select returned a row whose id is in the in-flight parameter';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM wf_due_a_in_flight WHERE idempotency_key = 'wf-assert:b') THEN
    RAISE EXCEPTION 'due-select dropped a row that is not in flight';
  END IF;

  SELECT * INTO r FROM notify.webhook_deliveries WHERE idempotency_key = 'wf-assert:a';
  IF r.state <> 'pending' OR r.attempts <> 1 OR r.last_error <> 'http 503' THEN
    RAISE EXCEPTION 'retry did not keep the row pending with attempts 1 (state %, attempts %)', r.state, r.attempts;
  END IF;
  IF r.next_attempt_at <> NOW() + interval '120 seconds' THEN
    RAISE EXCEPTION 'retry did not move next_attempt_at forward by the bound seconds (got %)', r.next_attempt_at - NOW();
  END IF;
END $$;

CREATE TEMP TABLE wf_due_after_retry ON COMMIT DROP AS EXECUTE wf_due('{}', 1000);

EXECUTE wf_delivered(:'wf_a');
INSERT INTO wf_rc VALUES ('delivered-a', :ROW_COUNT);
EXECUTE wf_delivered(:'wf_a');
INSERT INTO wf_rc VALUES ('delivered-a-again', :ROW_COUNT);
EXECUTE wf_retry(:'wf_a', 30, 'http 500');
INSERT INTO wf_rc VALUES ('retry-a-after-delivered', :ROW_COUNT);
EXECUTE wf_dead(:'wf_a', 1, 'http 404');
INSERT INTO wf_rc VALUES ('dead-a-after-delivered', :ROW_COUNT);

EXECUTE wf_dead(:'wf_b', 1, 'http 404');
INSERT INTO wf_rc VALUES ('dead-b', :ROW_COUNT);
EXECUTE wf_dead(:'wf_b', 0, 'origin_not_allowed');
INSERT INTO wf_rc VALUES ('dead-b-again', :ROW_COUNT);
EXECUTE wf_delivered(:'wf_b');
INSERT INTO wf_rc VALUES ('delivered-b-after-dead', :ROW_COUNT);

DO $$
DECLARE
  r notify.webhook_deliveries%ROWTYPE;
BEGIN
  IF EXISTS (SELECT 1 FROM wf_due_after_retry WHERE idempotency_key = 'wf-assert:a') THEN
    RAISE EXCEPTION 'due-select returned a row whose next_attempt_at is in the future';
  END IF;
  SELECT * INTO r FROM notify.webhook_deliveries WHERE idempotency_key = 'wf-assert:a';
  IF r.state <> 'delivered' OR r.attempts <> 2 OR r.last_error IS NOT NULL THEN
    RAISE EXCEPTION 'delivered row is wrong (state %, attempts %, last_error %)', r.state, r.attempts, r.last_error;
  END IF;
  SELECT * INTO r FROM notify.webhook_deliveries WHERE idempotency_key = 'wf-assert:b';
  IF r.state <> 'dead' OR r.attempts <> 1 OR r.last_error <> 'http 404' THEN
    RAISE EXCEPTION 'dead row is wrong (state %, attempts %, last_error %)', r.state, r.attempts, r.last_error;
  END IF;
END $$;

-- ── ingest: job insert, candidate select, markers ───────────────────────────
EXECUTE wf_insert_job('00000334-0000-4000-8000-000000000001', ARRAY['AAPL'], '1d', NULL, NULL, 3, 'BARS',
                      'https://webhooks.example.net:8443/hooks/j1');
EXECUTE wf_insert_job('00000334-0000-4000-8000-000000000002', ARRAY['AAPL'], '1d', NULL, NULL, 2, 'BARS',
                      'https://webhooks.example.net:8443/hooks/j2');
EXECUTE wf_insert_job('00000334-0000-4000-8000-000000000003', ARRAY['AAPL'], '1d', NULL, NULL, 3, 'BARS', NULL);
EXECUTE wf_insert_job('00000334-0000-4000-8000-000000000004', ARRAY['AAPL'], '', NULL, NULL, 4, 'FUNDAMENTALS',
                      'https://webhooks.example.net:8443/hooks/j4');
EXECUTE wf_insert_job('00000334-0000-4000-8000-000000000005', ARRAY['AAPL'], '1d', NULL, NULL, 6, 'BARS',
                      'https://webhooks.example.net:8443/hooks/j5');

CREATE TEMP TABLE wf_cand_before ON COMMIT DROP AS EXECUTE wf_candidates('{3,4,5,6}', 1000);

EXECUTE wf_mark_enqueued('00000334-0000-4000-8000-000000000004');
INSERT INTO wf_rc VALUES ('enqueue-4', :ROW_COUNT);
EXECUTE wf_mark_enqueued('00000334-0000-4000-8000-000000000004');
INSERT INTO wf_rc VALUES ('enqueue-4-again', :ROW_COUNT);
EXECUTE wf_mark_rejected('00000334-0000-4000-8000-000000000004');
INSERT INTO wf_rc VALUES ('reject-4-after-enqueue', :ROW_COUNT);

EXECUTE wf_mark_rejected('00000334-0000-4000-8000-000000000005');
INSERT INTO wf_rc VALUES ('reject-5', :ROW_COUNT);
EXECUTE wf_mark_rejected('00000334-0000-4000-8000-000000000005');
INSERT INTO wf_rc VALUES ('reject-5-again', :ROW_COUNT);
EXECUTE wf_mark_enqueued('00000334-0000-4000-8000-000000000005');
INSERT INTO wf_rc VALUES ('enqueue-5-after-reject', :ROW_COUNT);

CREATE TEMP TABLE wf_cand_after ON COMMIT DROP AS EXECUTE wf_candidates('{3,4,5,6}', 1000);

DO $$
DECLARE
  j ingest.backfill_jobs%ROWTYPE;
  got text;
  bad text;
BEGIN
  SELECT * INTO j FROM ingest.backfill_jobs WHERE job_id = '00000334-0000-4000-8000-000000000001';
  IF j.callback_url <> 'https://webhooks.example.net:8443/hooks/j1'
     OR j.webhook_enqueued_at IS NOT NULL OR j.webhook_rejected_at IS NOT NULL THEN
    RAISE EXCEPTION 'AC-2: insert did not store callback_url with both markers NULL';
  END IF;
  SELECT * INTO j FROM ingest.backfill_jobs WHERE job_id = '00000334-0000-4000-8000-000000000003';
  IF j.callback_url IS NOT NULL THEN
    RAISE EXCEPTION 'AC-1: a job inserted without a callback has a callback_url';
  END IF;

  -- Before any marker: the three terminal jobs with a callback; not RUNNING (2), not callback-less (3).
  SELECT string_agg(right(job_id::text, 1), ',' ORDER BY job_id) INTO got
    FROM wf_cand_before WHERE job_id::text LIKE '00000334-0000-4000-8000-%';
  IF got IS DISTINCT FROM '1,4,5' THEN
    RAISE EXCEPTION 'AC-21: candidate select returned jobs [%], expected [1,4,5]', got;
  END IF;
  -- After the markers: only the unmarked terminal job is left.
  SELECT string_agg(right(job_id::text, 1), ',' ORDER BY job_id) INTO got
    FROM wf_cand_after WHERE job_id::text LIKE '00000334-0000-4000-8000-%';
  IF got IS DISTINCT FROM '1' THEN
    RAISE EXCEPTION 'AC-29: candidate select returned jobs [%] after the markers, expected [1]', got;
  END IF;

  SELECT * INTO j FROM ingest.backfill_jobs WHERE job_id = '00000334-0000-4000-8000-000000000004';
  IF j.webhook_enqueued_at IS NULL OR j.webhook_rejected_at IS NOT NULL THEN
    RAISE EXCEPTION 'job 4 should carry only the enqueued marker';
  END IF;
  SELECT * INTO j FROM ingest.backfill_jobs WHERE job_id = '00000334-0000-4000-8000-000000000005';
  IF j.webhook_rejected_at IS NULL OR j.webhook_enqueued_at IS NOT NULL THEN
    RAISE EXCEPTION 'job 5 should carry only the rejected marker';
  END IF;

  -- Row counts reported by every statement above: one row, then zero once the guard no longer holds.
  SELECT string_agg(format('%s=%s (want %s)', want.step, rc.n, want.n), ', ') INTO bad
    FROM (VALUES
      ('accept-a-first', 1), ('accept-a-repeat', 0), ('accept-b', 1),
      ('retry-a', 1), ('delivered-a', 1), ('delivered-a-again', 0),
      ('retry-a-after-delivered', 0), ('dead-a-after-delivered', 0),
      ('dead-b', 1), ('dead-b-again', 0), ('delivered-b-after-dead', 0),
      ('enqueue-4', 1), ('enqueue-4-again', 0), ('reject-4-after-enqueue', 0),
      ('reject-5', 1), ('reject-5-again', 0), ('enqueue-5-after-reject', 0)
    ) AS want(step, n)
    LEFT JOIN wf_rc rc USING (step)
   WHERE rc.n IS DISTINCT FROM want.n;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'unexpected row counts: %', bad;
  END IF;
END $$;

ROLLBACK;

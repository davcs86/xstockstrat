-- feature 338 notify-commsgun-channel (AC-4, AC-6, AC-9, AC-12, AC-27, AC-30, AC-31): run by migration-rerun.py after all migrations.
-- Each PREPARE body is a copy of the statement its source ships; change both together.
BEGIN;

CREATE TEMP TABLE co_rc (step text PRIMARY KEY, n int NOT NULL) ON COMMIT DROP;

-- services/xstockstrat-notify/src/fanout/commsgunWorker.ts (enqueue, due-select, delivered, retry)
PREPARE co_enqueue AS
      INSERT INTO notify.email_outbox (alert_id, recipient, subject, text_body)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (alert_id) DO NOTHING;

PREPARE co_due AS
      SELECT outbox_id, alert_id, recipient, subject, text_body, attempts
         FROM notify.email_outbox
        WHERE state = 'pending' AND next_attempt_at <= NOW()
          AND NOT (outbox_id = ANY($1::uuid[]))
        ORDER BY next_attempt_at
        LIMIT $2;

PREPARE co_delivered AS
        UPDATE notify.email_outbox
            SET state = 'delivered', attempts = attempts + 1, last_error = NULL,
                recipient = NULL, subject = NULL, text_body = NULL, updated_at = NOW()
          WHERE outbox_id = $1 AND state = 'pending';

PREPARE co_retry AS
      UPDATE notify.email_outbox
          SET attempts = attempts + 1, next_attempt_at = NOW() + make_interval(secs => $2),
              last_error = $3, updated_at = NOW()
        WHERE outbox_id = $1 AND state = 'pending';

-- commsgunWorker.ts (terminal step, reroute, stamps)
PREPARE co_undelivered AS
      UPDATE notify.email_outbox
          SET state = 'undelivered', fallback = $2, attempts = attempts + $3, last_error = $4,
              recipient = NULL, subject = NULL, text_body = NULL, updated_at = NOW()
        WHERE outbox_id = $1 AND state = 'pending';

PREPARE co_rerouted AS
      UPDATE notify.email_outbox
          SET state = 'rerouted', reroute_reason = $2, fallback = $3, last_error = NULL,
              recipient = NULL, subject = NULL, text_body = NULL, updated_at = NOW()
        WHERE outbox_id = $1 AND state = 'pending';

PREPARE co_stamp_escalated AS
      UPDATE notify.email_outbox SET escalated_at = NOW(), updated_at = NOW()
        WHERE outbox_id = $1 AND escalated_at IS NULL;

PREPARE co_stamp_fallback_sent AS
        UPDATE notify.email_outbox SET fallback_sent_at = NOW(), updated_at = NOW()
          WHERE outbox_id = $1 AND fallback = 'sendgrid' AND fallback_sent_at IS NULL;

-- commsgunWorker.ts (alert sweep, bulk stamp, pending count)
PREPARE co_sweep AS
      SELECT outbox_id, alert_id, state, fallback, reroute_reason, attempts, last_error, fallback_sent_at
         FROM notify.email_outbox
        WHERE escalated_at IS NULL AND (state = 'undelivered' OR (state = 'rerouted' AND (reroute_reason = 'lost_config' OR fallback_sent_at IS NULL)))
          AND NOT (outbox_id = ANY($1::uuid[]))
        ORDER BY outbox_id
        LIMIT $2;

PREPARE co_bulk_stamp AS
          UPDATE notify.email_outbox SET escalated_at = NOW(), updated_at = NOW()
            WHERE outbox_id = ANY($1::uuid[]) AND escalated_at IS NULL;

PREPARE co_pending_count AS
      SELECT COUNT(*)::int AS n FROM notify.email_outbox WHERE state = 'pending';

-- ── enqueue: one row per alert ──────────────────────────────────────────────
EXECUTE co_enqueue('00000000-0000-4000-8000-000000000a01', 'ops@example.com', 'subject a', 'text a');
INSERT INTO co_rc VALUES ('enqueue-first', :ROW_COUNT);
EXECUTE co_enqueue('00000000-0000-4000-8000-000000000a01', 'other@example.com', 'subject a2', 'text a2');
INSERT INTO co_rc VALUES ('enqueue-repeat', :ROW_COUNT);

DO $$
DECLARE r notify.email_outbox%ROWTYPE; row_total int;
BEGIN
  IF (SELECT n FROM co_rc WHERE step = 'enqueue-first') <> 1 THEN RAISE EXCEPTION 'enqueue did not insert'; END IF;
  IF (SELECT n FROM co_rc WHERE step = 'enqueue-repeat') <> 0 THEN RAISE EXCEPTION 'a repeated enqueue inserted'; END IF;
  SELECT count(*) INTO row_total FROM notify.email_outbox WHERE alert_id = '00000000-0000-4000-8000-000000000a01';
  IF row_total <> 1 THEN RAISE EXCEPTION 'expected one row per alert, got %', row_total; END IF;
  SELECT * INTO r FROM notify.email_outbox WHERE alert_id = '00000000-0000-4000-8000-000000000a01';
  IF r.state <> 'pending' OR r.attempts <> 0 OR r.recipient <> 'ops@example.com' OR r.subject <> 'subject a'
     OR r.text_body <> 'text a' OR r.fallback IS NOT NULL OR r.reroute_reason IS NOT NULL THEN
    RAISE EXCEPTION 'unexpected enqueued row: %', r;
  END IF;
END $$;

-- Five more rows with fixed ids, one per path below.
INSERT INTO notify.email_outbox (outbox_id, alert_id, recipient, subject, text_body) VALUES
  ('00000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-000000000a02', 'ops@example.com', 's', 't'),
  ('00000000-0000-4000-8000-0000000000b3', '00000000-0000-4000-8000-000000000a03', 'ops@example.com', 's', 't'),
  ('00000000-0000-4000-8000-0000000000b4', '00000000-0000-4000-8000-000000000a04', 'ops@example.com', 's', 't'),
  ('00000000-0000-4000-8000-0000000000b5', '00000000-0000-4000-8000-000000000a05', 'ops@example.com', 's', 't'),
  ('00000000-0000-4000-8000-0000000000b6', '00000000-0000-4000-8000-000000000a06', 'ops@example.com', 's', 't');

-- ── due-select and retry ────────────────────────────────────────────────────
CREATE TEMP TABLE co_due_all ON COMMIT DROP AS EXECUTE co_due('{}', 100);
CREATE TEMP TABLE co_due_claimed ON COMMIT DROP AS
  EXECUTE co_due('{00000000-0000-4000-8000-0000000000b2}', 100);
EXECUTE co_retry('00000000-0000-4000-8000-0000000000b2', 120, '429');
INSERT INTO co_rc VALUES ('retry', :ROW_COUNT);
CREATE TEMP TABLE co_due_after_retry ON COMMIT DROP AS EXECUTE co_due('{}', 100);

DO $$
DECLARE r notify.email_outbox%ROWTYPE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM co_due_all WHERE outbox_id = '00000000-0000-4000-8000-0000000000b2') THEN
    RAISE EXCEPTION 'the due-select missed a pending row';
  END IF;
  IF EXISTS (SELECT 1 FROM co_due_claimed WHERE outbox_id = '00000000-0000-4000-8000-0000000000b2') THEN
    RAISE EXCEPTION 'the due-select returned an in-flight row';
  END IF;
  IF (SELECT n FROM co_rc WHERE step = 'retry') <> 1 THEN RAISE EXCEPTION 'retry changed % rows', (SELECT n FROM co_rc WHERE step = 'retry'); END IF;
  SELECT * INTO r FROM notify.email_outbox WHERE outbox_id = '00000000-0000-4000-8000-0000000000b2';
  IF r.state <> 'pending' OR r.attempts <> 1 OR r.last_error <> '429' OR r.recipient IS NULL THEN
    RAISE EXCEPTION 'unexpected row after retry: %', r;
  END IF;
  IF r.next_attempt_at < NOW() + interval '119 seconds' OR r.next_attempt_at > NOW() + interval '121 seconds' THEN
    RAISE EXCEPTION 'retry did not move next_attempt_at by the bound seconds: %', r.next_attempt_at;
  END IF;
  IF EXISTS (SELECT 1 FROM co_due_after_retry WHERE outbox_id = '00000000-0000-4000-8000-0000000000b2') THEN
    RAISE EXCEPTION 'a row waiting for its retry is still due';
  END IF;
END $$;

-- ── terminal statements: one pending row each, content blanked, a repeat changes nothing ──
EXECUTE co_delivered('00000000-0000-4000-8000-0000000000b3');
INSERT INTO co_rc VALUES ('delivered', :ROW_COUNT);
EXECUTE co_delivered('00000000-0000-4000-8000-0000000000b3');
INSERT INTO co_rc VALUES ('delivered-again', :ROW_COUNT);

EXECUTE co_undelivered('00000000-0000-4000-8000-0000000000b4', 'sendgrid', 1, '5xx');
INSERT INTO co_rc VALUES ('undelivered', :ROW_COUNT);
EXECUTE co_undelivered('00000000-0000-4000-8000-0000000000b4', 'none', 1, '401');
INSERT INTO co_rc VALUES ('undelivered-again', :ROW_COUNT);

EXECUTE co_rerouted('00000000-0000-4000-8000-0000000000b5', 'deliberate', 'sendgrid');
INSERT INTO co_rc VALUES ('rerouted', :ROW_COUNT);
EXECUTE co_rerouted('00000000-0000-4000-8000-0000000000b5', 'lost_config', 'none');
INSERT INTO co_rc VALUES ('rerouted-again', :ROW_COUNT);

EXECUTE co_rerouted('00000000-0000-4000-8000-0000000000b6', 'lost_config', 'sendgrid');
INSERT INTO co_rc VALUES ('rerouted-lost', :ROW_COUNT);
-- A delivered row can be neither rerouted nor ended undelivered.
EXECUTE co_rerouted('00000000-0000-4000-8000-0000000000b3', 'deliberate', 'none');
INSERT INTO co_rc VALUES ('reroute-delivered', :ROW_COUNT);

DO $$
DECLARE r notify.email_outbox%ROWTYPE; bad text;
BEGIN
  SELECT string_agg(step || '=' || n, ', ') INTO bad FROM co_rc
   WHERE (step IN ('delivered', 'undelivered', 'rerouted', 'rerouted-lost') AND n <> 1)
      OR (step IN ('delivered-again', 'undelivered-again', 'rerouted-again', 'reroute-delivered') AND n <> 0);
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'unexpected row counts: %', bad; END IF;

  IF EXISTS (SELECT 1 FROM notify.email_outbox
              WHERE outbox_id IN ('00000000-0000-4000-8000-0000000000b3', '00000000-0000-4000-8000-0000000000b4',
                                  '00000000-0000-4000-8000-0000000000b5', '00000000-0000-4000-8000-0000000000b6')
                AND (recipient IS NOT NULL OR subject IS NOT NULL OR text_body IS NOT NULL)) THEN
    RAISE EXCEPTION 'a terminal row kept its content';
  END IF;
  SELECT * INTO r FROM notify.email_outbox WHERE outbox_id = '00000000-0000-4000-8000-0000000000b3';
  IF r.state <> 'delivered' OR r.attempts <> 1 OR r.fallback IS NOT NULL THEN RAISE EXCEPTION 'delivered row: %', r; END IF;
  SELECT * INTO r FROM notify.email_outbox WHERE outbox_id = '00000000-0000-4000-8000-0000000000b4';
  IF r.state <> 'undelivered' OR r.fallback <> 'sendgrid' OR r.attempts <> 1 OR r.last_error <> '5xx' THEN
    RAISE EXCEPTION 'undelivered row: %', r;
  END IF;
  SELECT * INTO r FROM notify.email_outbox WHERE outbox_id = '00000000-0000-4000-8000-0000000000b5';
  IF r.state <> 'rerouted' OR r.reroute_reason <> 'deliberate' OR r.fallback <> 'sendgrid' OR r.last_error IS NOT NULL THEN
    RAISE EXCEPTION 'rerouted row: %', r;
  END IF;
END $$;

-- ── alert sweep ─────────────────────────────────────────────────────────────
-- b4 undelivered, b5 deliberate without a confirmed send, b6 lost_config: all three need an alert.
CREATE TEMP TABLE co_sweep_first ON COMMIT DROP AS EXECUTE co_sweep('{}', 100);
CREATE TEMP TABLE co_sweep_claimed ON COMMIT DROP AS
  EXECUTE co_sweep('{00000000-0000-4000-8000-0000000000b4}', 100);

-- b5's send is confirmed: a deliberate reroute that fully succeeded needs no alert.
EXECUTE co_stamp_fallback_sent('00000000-0000-4000-8000-0000000000b5');
INSERT INTO co_rc VALUES ('stamp-sent', :ROW_COUNT);
-- b6's send is confirmed too, but a lost-configuration reroute is alerted regardless.
EXECUTE co_stamp_fallback_sent('00000000-0000-4000-8000-0000000000b6');
CREATE TEMP TABLE co_sweep_confirmed ON COMMIT DROP AS EXECUTE co_sweep('{}', 100);

EXECUTE co_stamp_escalated('00000000-0000-4000-8000-0000000000b4');
INSERT INTO co_rc VALUES ('stamp-escalated', :ROW_COUNT);
EXECUTE co_stamp_escalated('00000000-0000-4000-8000-0000000000b4');
INSERT INTO co_rc VALUES ('stamp-escalated-again', :ROW_COUNT);
EXECUTE co_bulk_stamp('{00000000-0000-4000-8000-0000000000b6}');
INSERT INTO co_rc VALUES ('bulk-stamp', :ROW_COUNT);
CREATE TEMP TABLE co_sweep_done ON COMMIT DROP AS EXECUTE co_sweep('{}', 100);
CREATE TEMP TABLE co_pending ON COMMIT DROP AS EXECUTE co_pending_count;

DO $$
DECLARE ids text; bad text;
BEGIN
  SELECT string_agg(right(outbox_id::text, 2), ',' ORDER BY outbox_id) INTO ids FROM co_sweep_first
   WHERE outbox_id::text LIKE '00000000-0000-4000-8000-0000000000b%';
  IF ids IS DISTINCT FROM 'b4,b5,b6' THEN RAISE EXCEPTION 'first sweep returned %', ids; END IF;
  IF EXISTS (SELECT 1 FROM co_sweep_claimed WHERE outbox_id = '00000000-0000-4000-8000-0000000000b4') THEN
    RAISE EXCEPTION 'the sweep returned an in-flight row';
  END IF;
  SELECT string_agg(right(outbox_id::text, 2), ',' ORDER BY outbox_id) INTO ids FROM co_sweep_confirmed
   WHERE outbox_id::text LIKE '00000000-0000-4000-8000-0000000000b%';
  IF ids IS DISTINCT FROM 'b4,b6' THEN RAISE EXCEPTION 'sweep after the confirmed deliberate send returned %', ids; END IF;
  SELECT string_agg(step || '=' || n, ', ') INTO bad FROM co_rc
   WHERE (step IN ('stamp-sent', 'stamp-escalated', 'bulk-stamp') AND n <> 1) OR (step = 'stamp-escalated-again' AND n <> 0);
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'unexpected stamp row counts: %', bad; END IF;
  IF EXISTS (SELECT 1 FROM co_sweep_done WHERE outbox_id::text LIKE '00000000-0000-4000-8000-0000000000b%') THEN
    RAISE EXCEPTION 'a stamped row is still swept';
  END IF;
  IF (SELECT escalated_at FROM notify.email_outbox WHERE outbox_id = '00000000-0000-4000-8000-0000000000b5') IS NOT NULL THEN
    RAISE EXCEPTION 'the bulk stamp marked an id it was not given';
  END IF;
  -- a01 and b2 are still pending.
  IF (SELECT n FROM co_pending) < 2 THEN RAISE EXCEPTION 'pending count %', (SELECT n FROM co_pending); END IF;
END $$;

-- ── every CHECK refuses its violation ───────────────────────────────────────
DO $$
DECLARE
  pending_id uuid := '00000000-0000-4000-8000-0000000000b2';
  delivered_id uuid := '00000000-0000-4000-8000-0000000000b3';
  undelivered_id uuid := '00000000-0000-4000-8000-0000000000b4';
  rerouted_id uuid := '00000000-0000-4000-8000-0000000000b5';
  violation record;
BEGIN
  FOR violation IN
    SELECT * FROM (VALUES
      ('terminal state with content left in place',
       format('UPDATE notify.email_outbox SET state = ''delivered'' WHERE outbox_id = %L', pending_id)),
      ('pending row without a subject',
       format('UPDATE notify.email_outbox SET subject = NULL WHERE outbox_id = %L', pending_id)),
      ('fallback on a delivered row',
       format('UPDATE notify.email_outbox SET fallback = ''none'' WHERE outbox_id = %L', delivered_id)),
      ('undelivered without fallback',
       format('UPDATE notify.email_outbox SET fallback = NULL WHERE outbox_id = %L', undelivered_id)),
      ('reroute_reason on a non-rerouted row',
       format('UPDATE notify.email_outbox SET reroute_reason = ''deliberate'' WHERE outbox_id = %L', undelivered_id)),
      ('rerouted without a reason',
       format('UPDATE notify.email_outbox SET reroute_reason = NULL WHERE outbox_id = %L', rerouted_id)),
      ('escalated_at on a pending row',
       format('UPDATE notify.email_outbox SET escalated_at = NOW() WHERE outbox_id = %L', pending_id)),
      ('fallback_sent_at with fallback none',
       format('UPDATE notify.email_outbox SET fallback = ''none'' WHERE outbox_id = %L', rerouted_id)),
      ('negative attempts',
       format('UPDATE notify.email_outbox SET attempts = -1 WHERE outbox_id = %L', pending_id)),
      ('unknown state',
       format('UPDATE notify.email_outbox SET state = ''bogus'' WHERE outbox_id = %L', pending_id)),
      ('unknown fallback',
       format('UPDATE notify.email_outbox SET fallback = ''smtp'' WHERE outbox_id = %L', undelivered_id)),
      ('unknown reroute reason',
       format('UPDATE notify.email_outbox SET reroute_reason = ''other'' WHERE outbox_id = %L', rerouted_id))
    ) AS v(name, stmt)
  LOOP
    BEGIN
      EXECUTE violation.stmt;
      RAISE EXCEPTION 'CHECK not enforced: %', violation.name;
    EXCEPTION WHEN check_violation THEN
      NULL;
    END;
  END LOOP;
END $$;

-- ── both partial indexes exist ──────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'notify' AND tablename = 'email_outbox'
                   AND indexname = 'idx_email_outbox_pending' AND indexdef LIKE '%WHERE (state = ''pending''::text)%') THEN
    RAISE EXCEPTION 'idx_email_outbox_pending is missing or not partial on pending rows';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'notify' AND tablename = 'email_outbox'
                   AND indexname = 'idx_email_outbox_needs_alert' AND indexdef LIKE '%escalated_at IS NULL%') THEN
    RAISE EXCEPTION 'idx_email_outbox_needs_alert is missing or not partial on rows without an alert';
  END IF;
END $$;

ROLLBACK;

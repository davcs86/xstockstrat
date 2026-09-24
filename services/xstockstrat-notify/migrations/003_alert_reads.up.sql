CREATE TABLE IF NOT EXISTS notify.alert_reads (
  alert_id   UUID        NOT NULL,
  user_id    TEXT        NOT NULL,
  read_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (alert_id, user_id)
);
-- No secondary index on (user_id): no query path needs a user_id-leading lookup; the PK
-- (alert_id, user_id) covers all access patterns (design.md). No FK to notify.alerts: the
-- MarkAlertRead handler's JOIN notify.alerts suppresses phantom alert_ids at write time.

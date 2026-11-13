# xstockstrat-notify — Operations

On-demand operator procedures for the notify service (moved verbatim from `CLAUDE.md` § Outbound webhooks).

## Outbound webhook deliveries

- **Requeue** after fixing an allowlist mistake (a `dead` row is never retried by itself):
  `UPDATE notify.webhook_deliveries SET state = 'pending', attempts = 0, next_attempt_at = NOW(), last_error = NULL, updated_at = NOW() WHERE delivery_id = '<id>' AND state = 'dead';`

## Commsgun email (feature 338)

- Category `commsgun` is reserved for notify: any alert carrying it is never emailed.
- Rotate the app key in config first, then retire the old key on the edge — a 401 ends a row at once.
- Change `commsgun.app_id` or `commsgun.to_email` only while the outbox has no pending row: commsgun
  scopes idempotency per app, and a queued row keeps its recipient. The worker logs one WARN when the
  app id changes with rows pending.
- Clearing `commsgun.enqueue_url` under `auto`, even briefly, sends every pending email through SendGrid.
- One instance: the worker's claim on a row is an in-memory map. The drain and standing-incident
  latches are in memory too, so a restart can repeat one drain alert or one first standing alert.
- Held rows have no age limit, and terminal rows are never purged.
- First homelab deploy: from inside the notify container, check that the enqueue host resolves and that
  one enqueue is accepted (the name is a tailnet split-horizon record; the certificate is the edge's
  wildcard).

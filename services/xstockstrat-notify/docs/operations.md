# xstockstrat-notify — Operations

On-demand operator procedures for the notify service (moved verbatim from `CLAUDE.md` § Outbound webhooks).

## Outbound webhook deliveries

- **Requeue** after fixing an allowlist mistake (a `dead` row is never retried by itself):
  `UPDATE notify.webhook_deliveries SET state = 'pending', attempts = 0, next_attempt_at = NOW(), last_error = NULL, updated_at = NOW() WHERE delivery_id = '<id>' AND state = 'dead';`

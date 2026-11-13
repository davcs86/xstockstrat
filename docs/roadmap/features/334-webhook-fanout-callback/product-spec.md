# Product Spec: webhook-fanout-callback

**Created**: 2026-11-11

**Upstream design (owner-approved 2026-11-11)**: section 8 of
`docs/superpowers/specs/2026-11-11-webhooks-mcp-design.md` in the public repo `davcs86/webhooks-mcp`
(branch `main`). That section is the input to this pipeline, not a substitute for it.

---

## Problem Statement

A backfill finishes minutes after an agent asked for it, and a web-based agent can only pull: today it
has to poll `get_backfill_status`. xstockstrat has no generic outbound webhook, and notify's existing
Slack/SendGrid fanout is best-effort (no retry, no delivery log), so a terminal event cannot be pushed
reliably to an external mailbox such as `webhooks-mcp`.

## User Story

As an AI agent (or operator) that triggers a long-running backfill, I want to pass an optional
`callback_url` to `trigger_backfill` and have xstockstrat deliver the job's terminal event to that URL
at-least-once, so that I no longer have to poll `get_backfill_status`.

## Functional Requirements

FR-1. **`callback_url` on backfills.** `TriggerBackfillRequest` gains an optional `callback_url`. The
agent tool `trigger_backfill` exposes it as an optional argument. A request without it behaves exactly
as today.

FR-2. **Up-front rejection.** `trigger_backfill` with a `callback_url` that breaks the URL rule (FR-5)
fails at trigger time with `INVALID_ARGUMENT`; no job is created. Notify stays the single enforcement
point of the rule: ingest asks it through a validate-only `FanoutWebhook` call that stores nothing. If
notify cannot answer, the trigger fails closed with `UNAVAILABLE` and a message stating that no job
was created. A request without `callback_url` never depends on notify.

FR-3. **Terminal hand-off (ingest).** Ingest stores `callback_url` and a "webhook enqueued at" marker on
the job. When a job that has a `callback_url` reaches a terminal state (`COMPLETED`, `PARTIAL`, `FAILED`,
`CANCELED`), ingest calls `NotifyService.FanoutWebhook` with idempotency key `backfill:<job_id>:<status>`
and sets the marker when notify acknowledges. **Every** path that moves a job to a terminal status
leads to the hand-off (the completed / partial / failed paths, the cancel path and restart
reconciliation — C-10), not only the main one. A job is handed off **once**: after the marker is set it
is never published again, even if a later restart drives it to another terminal status. The published
data is built from the stored job (`job_id`, `status`, `data_kind`, `symbols`, `bars_processed`,
`failed_symbols`, `started_at`, `completed_at`) and carries no error text. The event name is the one ingest already uses for that transition: `ingest.backfill.completed`
for `COMPLETED` and `PARTIAL` (there is no partial event name), `ingest.backfill.failed` for `FAILED`,
`ingest.backfill.canceled` for `CANCELED`. The publisher payload always carries `job_id` and `status`.

FR-4. **Hand-off durability (ingest sweep).** A periodic sweep retries terminal jobs that have a
`callback_url` and an unset marker, so notify being down when a backfill finishes delays the webhook
rather than losing it. The hand-off never fails or slows the backfill itself: a failed or slow call
leaves the job's terminal status and its existing ledger event / alert untouched and is left to the
sweep. A hand-off that notify rejects with `INVALID_ARGUMENT` is terminal: ingest makes no further
`FanoutWebhook` call for that job and emits one `WARNING` alert naming the job.

FR-5. **URL rule (notify, single enforcement point).** `https` only, and the URL's origin (host and
port) must be on an allowlist held in a notify config key. The allowlist is empty by default, so every
`callback_url` is rejected until an operator sets it. The rule is enforced when `FanoutWebhook` accepts
a request (`INVALID_ARGUMENT`) **and** again before every delivery attempt.

FR-6. **`FanoutWebhook` accept (notify).** New unary RPC `FanoutWebhook(callback_url, event_name,
payload Struct, idempotency_key)` on `NotifyService`. Notify inserts a delivery row unique on
`idempotency_key` **before** it acknowledges. A repeat with a known key acknowledges without creating a
second row. If the row cannot be persisted the call fails and nothing is acknowledged. It is callable
only by allow-listed internal services, identified by their mTLS certificate (today:
`xstockstrat-ingest`); any other caller gets `PERMISSION_DENIED`. `EmitAlert` stays ungated.

FR-7. **Delivery worker (notify).** A worker POSTs pending rows with exponential backoff. `2xx` is
success. `408`, `429`, `5xx` and network errors are retried. Any other `4xx` marks the row dead at once.
After the last attempt the row is marked dead. Retries are per row — one slow or failing target does
not delay deliveries to other targets.

FR-8. **Dead-letter visibility.** When a row becomes dead, notify emits a `WARNING` alert naming the
event and target origin, so a lost delivery is visible to operators.

FR-9. **Restart survival.** The queue is the table, not memory: pending rows are picked up again when
notify starts.

FR-10. **Wire format (fixed, upstream design 8.3).**

```
POST <callback_url>
Content-Type: application/json
Idempotency-Key: <idempotency_key>

{
  "event_name": "ingest.backfill.completed",
  "payload": {
    "source_service": "xstockstrat-ingest",
    "environment": "production | staging",
    "occurred_at": "...",
    "data": { "job_id": "...", "status": "COMPLETED | PARTIAL | FAILED | CANCELED", ... }
  }
}
```

Notify builds the envelope (`source_service`, `environment`, `occurred_at`) around the publisher's
`payload`, which becomes `data`. `user_id` and other identity fields are never sent.

FR-11. **Docs and skill parity.** `docs/runbooks/mcp-tools.md` and the `strat-lab` plugin's `backtest`
skill (`plugins/strat-lab/`) document `callback_url` in the same PR as the tool change
(`docs/patterns/strat-lab-plugin.md`).

## Fixed by the owner (not open to redesign here)

A design-phase argument to change any of these is a stop-and-report, not a local decision:

- The RPC name `FanoutWebhook`.
- The wire format in FR-10.
- Delivery lives in notify.
- No ledger tail and no notify → ledger dependency; ledger events are unchanged (audit only, no
  `callback_url` stamped on them).

## Out of Scope

- The listener itself (`davcs86/webhooks-mcp`) and its deployment (`davcs86/homelab-edge`).
- The staging end-to-end acceptance against the live listener (upstream plan step S7) — it runs after
  this feature's integration PR, once the listener is live and the staging allowlist is set.
- Setting the allowlist on any environment (an operator config rollout).
- `callback_url` on any other long-running RPC (`RunBacktest`, …), and any UI for it.
- Authentication or signing of the outbound POST. Reachability of the target is the listener's control.
- Multi-instance notify. The worker assumes a single notify instance, as today.
- Any change to notify's Slack / SendGrid / web-push fanout.

## Affected Services

- `xstockstrat-notify` — `FanoutWebhook` handler, delivery table, delivery worker, URL rule, dead-letter alert
- `xstockstrat-ingest` — `callback_url` + marker on the job, terminal hand-off, retry sweep
- `xstockstrat-agent` — `trigger_backfill` gains `callback_url`
- `xstockstrat-config` — seed migration for the new config keys (no code change)
- `packages/proto` — `ingest.proto`, `notify.proto` (additive)

## Consumer Surface(s)

- [ ] **UI** — none. Backfills are triggered from the UI without a callback; no UI change.
- [x] **Agent** — `xstockstrat-agent` MCP tool `trigger_backfill`: new optional argument `callback_url`;
  a disallowed URL is returned as a tool error at trigger time.
- [ ] **None**

## Proto Contract Changes

Additive only (non-breaking):

- `packages/proto/ingest/v1/ingest.proto` — `TriggerBackfillRequest`: new optional `string callback_url`
  (field 8).
- `packages/proto/notify/v1/notify.proto` — new unary RPC `FanoutWebhook(FanoutWebhookRequest) returns
  (FanoutWebhookResponse)` on `NotifyService`; request fields `callback_url`, `event_name`,
  `google.protobuf.Struct payload`, `idempotency_key`, plus `bool validate_only` for the up-front
  verdict (FR-2); empty response.

## Config Key Changes

Decided in `design.md` (D-15). All are
seeded by one `xstockstrat-config` migration for `staging` and `production`, global scope, and are read
live through each service's `WatchConfig` watcher. Stored keys are namespace-relative.

- `notify.webhook.allowed_origins` — namespace `notify`, key `webhook.allowed_origins`, `value_type`
  `string` (comma-separated `host[:port]` origins; a missing port means 443), code default `""` (reject
  everything); read by the notify URL rule on accept and before each delivery.
- `notify.webhook.max_attempts` — namespace `notify`, key `webhook.max_attempts`, `int`,
  default `8`; attempts before a row is dead; read by the delivery worker.
- `notify.webhook.backoff_base_seconds` — namespace `notify`, key `webhook.backoff_base_seconds`,
  `int`, default `30`; first retry delay; read by the delivery worker.
- `notify.webhook.backoff_max_seconds` — namespace `notify`, key `webhook.backoff_max_seconds`, `int`,
  default `3600`; cap of the exponential delay; read by the delivery worker.
- `notify.webhook.request_timeout_seconds` — namespace `notify`, key `webhook.request_timeout_seconds`,
  `int`, default `10` (clamped to 1–60 in code); per-attempt HTTP timeout; read by the delivery worker.
- `ingest.backfill.webhook_sweep_interval_seconds` — namespace `ingest`, key
  `backfill.webhook_sweep_interval_seconds`, `int`, default `60`; period of the hand-off retry
  sweep (a stored 0 reads as 60); read by ingest.

With these defaults a delivery is retried for roughly two hours (30 s, 60 s, … capped at 1 h) before it
is dead. Seeds equal the code defaults. Reader `path:symbol` and the seed migration number are fixed at
`/sdd-spec` (the readers are new code; the migration number is volatile until then — ledger fail
2026-08-26).

## Database Changes

- `xstockstrat-notify` — new table for webhook deliveries (target URL, event name, payload, unique
  `idempotency_key`, state pending/delivered/dead, attempt count, next-attempt time, last error,
  timestamps), with an index serving "pending rows due now". New numbered up + down migration.
- `xstockstrat-ingest` — `backfill_jobs` gains nullable `callback_url`, a nullable
  "webhook enqueued at" timestamp and a nullable "webhook rejected at" timestamp. New numbered up +
  down migration.
- `xstockstrat-config` — seed migration for the keys above (up + down).

Run order: the config seed and both schema migrations are applied by the `db-migrator` job before the
new service code starts; every reader also carries the code default, so a missing seed row degrades to
the default rather than failing.

Pool budget unchanged: notify stays on its single direct DB connection; ingest stays on the PgBouncer
pool.

## Feature Workflow Notes

Branch to create: `feature/webhook-fanout-callback` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (non-breaking proto or config change)
- [ ] 2 service owners + platform lead (breaking proto change)
- [x] DBA review + service owner (schema migration)

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`) — the single source of acceptance truth (Constitution
**C-15**). Each `FR-N` above is covered by ≥1 tagged scenario there.

## Known traps (Ledger)

- **020-notify-external-fanout (2026-08-19)** — never build on a `Struct` key a producer does not write:
  the outbound `data` must be built from the fields ingest actually has at the terminal transition.
- **202 (2026-10-07)** — a validation added to a handler with an idempotency claim goes **before** the
  claim, with a handler-level test: the URL rule runs before the delivery row is inserted.
- **207-extract-tool-ssrf-hardening (2026-10-07)** — a security guard needs a test that fails on a
  simulated regression, and every failure class of the guarded call needs a negative test (redirects,
  scheme, port, userinfo, case); design-mandated security tests must be traced into spec steps.
- **043 (idempotency keys)** — keys derive only from stable inputs: `backfill:<job_id>:<status>`, no
  timestamps.
- **020 (2026-08-26)** — do not pin migration numbers in story/design artifacts.

## Open Questions

- [x] Up-front rejection: a validate-only `FanoutWebhook` call, fail closed (design D-1, D-2).
- [x] Caller gate: mTLS peer-SAN allow-list, no `x-internal-caller` header (design D-3).
- [x] Redirects are never followed; a `3xx` marks the row dead (AC-16) — the reading of FR-5 "enforced
  on every delivery".
- [x] A hand-off notify rejects with `INVALID_ARGUMENT` at job end is terminal and raises one WARNING
  (FR-4, AC-20). Only the marker representation that stops the sweep is left to design.
- [x] Retry / sweep defaults confirmed (design D-15).
- [x] The sweep-initiated call carries a minted `x-trace-id` only; the validate call forwards the
  caller's headers (design D-2, D-14).
- [x] The worker issues single statements and never holds notify's connection across HTTP (design D-8).

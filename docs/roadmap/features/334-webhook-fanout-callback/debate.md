# Debate Register: webhook-fanout-callback

**State**: approved
**Mode**: quick
**Rounds run**: 1

## Rounds

| Round | Date | Run by | +D | +R | O closed | +O | Petitions | Progress |
|---|---|---|---|---|---|---|---|---|
| 1 | 2026-11-11 | /sdd-design | 16 | 9 | 15 | 17 | 0 | yes |

## Settled Decisions

<!-- Status: settled → superseded by D-m (only after a user-approved REOPEN) -->
| ID | Round | Decision | Evidence | Status |
|---|---|---|---|---|
| D-1 | 1 | Up-front rejection is a validate-only mode of the same RPC: `FanoutWebhookRequest.validate_only = 5`. In that mode notify checks only the caller gate and `callback_url`, ignores the other fields, and writes nothing. | upstream design 8.2 delegates "a validate-only call, or a shared key"; `packages/proto/notify/v1/notify.proto:12-36` | settled |
| D-2 | 1 | `TriggerBackfill` validates after the admin gate and the timeframe check and before `insert_job`, forwarding `propagation_meta`, 5 s timeout. Notify `INVALID_ARGUMENT` → `INVALID_ARGUMENT`; notify `PERMISSION_DENIED` → `FAILED_PRECONDITION` + ERROR log; anything else or no notify channel → `UNAVAILABLE` with a fixed "no job created" detail. No job row in any of these. Requests without `callback_url` never call notify. | `services/xstockstrat-ingest/app/handlers/servicer.py:412-437`, `:416` | settled |
| D-3 | 1 | `FanoutWebhook` is gated on the mTLS peer DNS SAN only: allow-list `['xstockstrat-ingest']`, exact match, `PERMISSION_DENIED` (7) otherwise. No `x-internal-caller`. `EmitAlert` stays ungated. | `services/xstockstrat-identity/src/grpc/adminDirectory.ts:2`, `services/xstockstrat-config/src/grpc/authz.ts:158`, `services/xstockstrat-notify/src/mtls.ts:24`, `docs/patterns/inter-service-mtls.md:52-66` | settled |
| D-4 | 1 | Envelope: `source_service` = the matched peer SAN stored on the row at accept; `occurred_at` = the row's `created_at` (stable across retries); `environment` from `APPLICATION_ENV` with the watcher's mapping. | `services/xstockstrat-notify/src/services/configWatcher.ts:79-82` | settled |
| D-5 | 1 | Allowlist key `webhook.allowed_origins` is `value_type` `string`, comma-separated `host[:port]` entries (optional `https://` prefix tolerated), default `""`. No JSON getter is added. | `services/xstockstrat-notify/src/services/configWatcher.ts:1-4,203-228`; `scripts/check-config-wiring.mjs:647` | settled |
| D-6 | 1 | One pure URL-rule function used by the handler and the worker: length ≤ 2048, no ASCII whitespace/control, WHATWG parse, `https:` only, no userinfo, no trailing-dot host, origin = `hostname:(port or 443)`, exact match against canonical entries. Delivery POSTs the re-serialized `href` of the same parse. One helper reads the key and calls the rule. | `services/xstockstrat-notify/src/fanout/fanout.ts:62` | settled |
| D-7 | 1 | Queue is table `notify.webhook_deliveries` (unique `idempotency_key`, `state` pending / delivered / dead, `attempts`, `next_attempt_at`, `last_error`, `source_service`, timestamps; partial index on pending `next_attempt_at`). Accept = gate → field validation → URL rule → `INSERT … ON CONFLICT (idempotency_key) DO NOTHING` → ack. A repeat key acks and keeps the first row. | `services/xstockstrat-notify/migrations/002_push_subscriptions.up.sql:1-19` | settled |
| D-8 | 1 | Worker: single `pool.query` statements only, never a held client or a transaction; in-memory in-flight set is the claim (single instance); bounded concurrent attempts; every attempt and every tick has its own catch; `next_attempt_at` is computed in SQL. Tick period, slot count and batch size are code constants. | `services/xstockstrat-notify/src/fanout/webPush.ts:108`, `services/xstockstrat-notify/src/fanout/fanout.ts:14`, `services/xstockstrat-notify/src/index.ts:35,59-69` | settled |
| D-9 | 1 | Classification: 2xx delivered; 408 / 429 / 5xx / network / timeout retry; 3xx and opaque redirect dead (`redirect: 'manual'`); other 4xx dead; URL-rule failure at delivery dead with no request. Backoff `min(base·2^(n−1), max)`, no jitter; dead when attempts ≥ `max_attempts`. Response bodies are never read. | `services/xstockstrat-notify/src/fanout/fanout.ts:130-158` | settled |
| D-10 | 1 | Dead-letter alert: `emitAlert` is split by pure extraction into persist+broadcast and side-channel dispatch (callback-before-side-channels order kept); the worker calls them directly. WARNING, category `webhook`, untargeted, title names event and origin, body carries the idempotency key, attempts and error class. The full callback URL never appears in an alert, log line, `last_error` or metric. The `dead` metric and an ERROR log are recorded before the alert insert. | `services/xstockstrat-notify/src/grpc/notifyServiceImpl.ts:34-122` | settled |
| D-11 | 1 | Ingest hand-off has one path: a sweep loop that reads the persisted row and builds the payload from it. Every terminal-write site wakes the loop at once (an `asyncio.Event`), so the call happens when the job reaches the terminal state, off the backfill path; the interval tick is the retry. Default interval 60 s. | `services/xstockstrat-ingest/app/engine/mcp_client_loop.py:184,226-238`; recon T1–T7 | settled |
| D-12 | 1 | Hand-off is once per job. Columns `callback_url`, `webhook_enqueued_at` (set on notify ack), `webhook_rejected_at` (set on notify `INVALID_ARGUMENT`); the sweep selects terminal jobs with a `callback_url` and both markers NULL. A job re-driven to another terminal status later is not re-published. Key stays `backfill:<job_id>:<status>`. | `services/xstockstrat-ingest/docs/context-constitution-findings.md:31`; `services/xstockstrat-ingest/app/handlers/servicer.py:754-776` | settled |
| D-13 | 1 | Outbound `data` = `job_id`, `status`, `data_kind`, `symbols`, `bars_processed`, `failed_symbols`, `started_at`, `completed_at` — row columns only. No `error` field. | `services/xstockstrat-ingest/app/handlers/servicer.py:543`; `services/xstockstrat-ingest/app/repositories/backfill_jobs.py:137` | settled |
| D-14 | 1 | Sweep error policy: OK → set `webhook_enqueued_at`; `INVALID_ARGUMENT` → set `webhook_rejected_at`, then one best-effort WARNING alert naming the job; any other code → end the tick (ERROR log for `PERMISSION_DENIED`, WARN otherwise). Sweep call metadata is a minted `x-trace-id` only; 5 s timeout. | `services/xstockstrat-ingest/app/handlers/servicer.py:478-503,762` | settled |
| D-15 | 1 | Config keys: notify `webhook.allowed_origins` (string, `""`), `webhook.max_attempts` (int, 8), `webhook.backoff_base_seconds` (int, 30), `webhook.backoff_max_seconds` (int, 3600), `webhook.request_timeout_seconds` (int, 10, clamped to 1–60 in code); ingest `backfill.webhook_sweep_interval_seconds` (int, 60). Stored ≤ 0 clamps to the default. No bounds-registry rows. | `services/xstockstrat-ingest/app/config/watcher.py:143-146` | settled |
| D-16 | 1 | `callback_url` is not exposed on `BackfillJob` / `get_backfill_status`. Agent change is a pass-through argument plus an allow-listed "no job created" message for the validation-unavailable case. `strat-lab` plugin version bumps in both manifests. | INGEST-11; `services/xstockstrat-agent/app/tools.py:226-282,1585` | settled |

## Rejected Alternatives (locked)

<!-- Status: locked → reopened @ round N (user, context.md <ISO>) -->
| ID | Round | Alternative | Why rejected | Status |
|---|---|---|---|---|
| R-1 | 1 | Ingest watches notify's namespace and evaluates the allowlist itself | Two parsers in two languages break "notify is the single enforcement point" (FR-5) | locked |
| R-2 | 1 | A separate `ValidateWebhookUrl` RPC | More proto surface for the same check as D-1 | locked |
| R-3 | 1 | Accept the job when notify is down at trigger time and let the job-end hand-off decide | Silently breaks FR-2's trigger-time guarantee; the caller only learns from an operator alert | locked |
| R-4 | 1 | `x-internal-caller` header allow-list on `FanoutWebhook` | Self-asserted; adds nothing over the verified certificate SAN (D-3) | locked |
| R-5 | 1 | Leave `FanoutWebhook` ungated like `EmitAlert` | The agent holds user input and reaches notify; a gate keeps it from becoming a POST relay and makes `source_service` unforgeable | locked |
| R-6 | 1 | JSON-array allowlist with a new `getJson` on the config watcher | The watcher file is byte-identical across three services (`configWatcher.ts:1-4`); a Struct cannot be a bare array | locked |
| R-7 | 1 | Inline `FanoutWebhook` call at each of the terminal-write sites, with the sweep as a safety net | Seven sites in five paths with no shared helper; two payload builders (live vs row); a notify call on the backfill path contradicts "never fail or slow the backfill" | locked |
| R-8 | 1 | Re-hand-off whenever the job's status differs from the last handed-off status | Externalizes the known restart re-drive defect as contradictory webhooks for one job (`context-constitution-findings.md:31`) | locked |
| R-9 | 1 | Persisted claim column (`claimed_at`) and `FOR UPDATE SKIP LOCKED` on the delivery table | YAGNI at a single instance; a held row lock needs a held connection, which notify does not have to spare | locked |

## Objections

<!-- Status: open → closed @ round N (<how>) | waived @ round N (user) | reopened @ round N (user) -->
| ID | Round | Objection | Blocking | Status |
|---|---|---|---|---|
| O-1 | 1 | Per-status re-hand-off turns the restart re-drive defect into contradictory webhooks; a stale reconcile `error` can ship in a COMPLETED payload (C-16, ledger 020) | yes | closed @ round 1 (D-12, D-13) |
| O-2 | 1 | Sweep-only contradicts FR-3 / upstream 8.1 wording and silently changes the sweep default 60 → 30 (P-03) | yes | closed @ round 1 (D-11: terminal writes wake the loop; default stays 60) |
| O-3 | 1 | `validate_only` contract contradicts field validation of `event_name` / `idempotency_key` | no | closed @ round 1 (D-1) |
| O-4 | 1 | The validate call must forward the header trio (C-03); the sweep's no-inbound-request case must be recorded | no | closed @ round 1 (D-2, D-14) |
| O-5 | 1 | The agent would report fail-closed `UNAVAILABLE` as "outcome unknown" although no job exists | no | closed @ round 1 (D-2, D-16) |
| O-6 | 1 | `PERMISSION_DENIED` from the gate is hidden as transient on the validate path and retried forever by the sweep | no | closed @ round 1 (D-2, D-14) |
| O-7 | 1 | `error=str(e)` can carry internal hostnames to an off-platform endpoint | no | closed @ round 1 (D-13) |
| O-8 | 1 | Un-awaited attempts can raise unhandled rejections and crash notify; a throw before the UPDATE retries with no backoff | no | closed @ round 1 (D-8) |
| O-9 | 1 | New SQL in notify and ingest is only ever run against fakes (ledger fails.md:2786, :3351) | no | open — spec must run each new statement against a migrated scratch Postgres in the step's verification; a CI-enforced DB test is an open risk |
| O-10 | 1 | Sweep head-of-line blocking when old rows fail with unclassified codes | no | closed @ round 1 (D-14) |
| O-11 | 1 | Worker tests become the second consumer of `stubFetch` / `fakeConfig`; move them to the fixture home in the same step (C-13) | no | closed @ round 1 (carried into design.md test strategy) |
| O-12 | 1 | AC-3 / AC-4 are proven in two halves across services; AC-14 as worded outruns a fake-pool test (C-15) | no | closed @ round 1 (AC-14 reworded; both halves traced in the spec) |
| O-13 | 1 | Ingest partial index is YAGNI; marker representation trap; no requeue path for dead rows; request timeout needs an upper clamp; one allowlist reader; third `peerDnsSans` copy | no | closed @ round 1 (D-12, D-15, design.md; requeue as a documented SQL line) |
| O-14 | 1 | Allowlist parsing edges: scheme-prefixed entries, WARN rate limit, byte-length payload cap, opaque redirect, URL never logged | no | closed @ round 1 (D-5, D-9, D-10) |
| O-15 | 1 | A 5 s INFO tick log is noise; the startup "delivery channels" line must stay unchanged (`@AC-49`); stale docs and new invariants | no | closed @ round 1 (no per-tick log in notify; doc list in design.md) |
| O-16 | 1 | A dead-letter alert insert that fails after the row is dead loses the alert | no | closed @ round 1 (D-10: metric + ERROR log first; residual risk recorded) |
| O-17 | 1 | A reconciled-FAILED job that is about to resume could be handed off as FAILED if the sweep runs before the resume flips it to RUNNING | no | open — accepted risk; the loop starts after `resume_incomplete_jobs` and waits before its first cycle |

## Reopen Petitions

<!-- Verdict: dropped (evidence not new — already on record at <ID>) | pending user | user reopened | user declined -->
| ID | Round | Target | New evidence | Verdict |
|---|---|---|---|---|

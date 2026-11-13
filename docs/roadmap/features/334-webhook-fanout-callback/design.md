# Design: webhook-fanout-callback

**Created**: 2026-11-11
**Rounds**: 1 (quick; termination: approved)
**Approved by**: owner's standing authorization for this feature ("start the full implementation", relayed 2026-11-11 — see context.md); no Floor breach and no contested trade-off survived synthesis
**Grounded in**: recon.md
**Debate register**: debate.md

Paths: `notify/`, `ingest/`, `agent/`, `config/` abbreviate `services/xstockstrat-<name>/`. Migration
numbers are deliberately not pinned here (ledger 2026-08-26); `/sdd-spec` derives them from the tree.

---

## Chosen Approach

Two durable queues give at-least-once end to end: ingest's job row (markers) → `FanoutWebhook` →
notify's delivery row → HTTPS POST. Rests on D-1 … D-16.

### Proto (additive) — D-1

- `TriggerBackfillRequest.callback_url = 8` (recon: `packages/proto/ingest/v1/ingest.proto:78-87`,
  fields 1–7 in use). `BackfillJob` is unchanged (D-16; INGEST-11).
- `rpc FanoutWebhook(FanoutWebhookRequest) returns (FanoutWebhookResponse)` appended to
  `service NotifyService` (recon: `packages/proto/notify/v1/notify.proto:12-36`).
  `FanoutWebhookRequest { callback_url = 1; event_name = 2; google.protobuf.Struct payload = 3;
  idempotency_key = 4; bool validate_only = 5; }`, `FanoutWebhookResponse {}` (precedent
  `MarkAlertReadResponse {}`, `notify.proto:117`). `struct.proto` is already imported (`:7-8`).

### Notify — accept (D-3, D-4, D-5, D-6, D-7)

Handler `fanoutWebhook` on `NotifyServiceImpl` (recon: `notify/src/grpc/notifyServiceImpl.ts`, class
methods bound by name; `index.ts:47` casts to an untyped implementation, so a test asserts the method
exists). Order — every check precedes the insert (ledger 202):

1. **Caller gate.** Peer DNS SAN must equal an entry of a code constant allow-list
   (`['xstockstrat-ingest']`), read from the call's auth context exactly as config and identity do
   (recon: `config/src/grpc/authz.ts:158`, `identity/src/grpc/adminDirectory.ts:2`); notify's server
   credentials already require a client certificate (`notify/src/mtls.ts:24`). Otherwise code 7.
2. **URL rule** (below). Failure → code 3 with the reason class, never echoing the URL.
3. `validate_only` → OK, nothing written; `event_name`, `payload`, `idempotency_key` are ignored in
   this mode.
4. **Field validation**: `event_name` and `idempotency_key` non-empty and ≤ 256 characters; serialized
   payload ≤ 64 KiB by byte length. Failure → code 3.
5. `INSERT INTO notify.webhook_deliveries … ON CONFLICT (idempotency_key) DO NOTHING`, storing the
   matched SAN as `source_service`. A DB failure → code 13, nothing acknowledged (house style: bare
   numeric codes, `notifyServiceImpl.ts:39,120`).
6. Callback OK.

**URL rule** — one pure function plus one helper that reads `webhook.allowed_origins` live
(`getString`, literal default `''`, per `notify/src/fanout/fanout.ts:62`) and calls it; the handler and
the worker both go through the helper. Allowlist entries are comma-separated `host[:port]` (an
optional leading `https://` is stripped); each is parsed with WHATWG `URL`, must carry no userinfo,
path, query or fragment, and canonicalizes to `hostname:port` with a missing port meaning 443. A
malformed or empty entry never matches and is logged at WARN, rate-limited. A callback URL passes only
if: length ≤ 2048 and no ASCII whitespace or control characters; it parses; `protocol` is `https:`;
username and password are empty; the hostname has no trailing dot; and `hostname:(port || 443)`
equals a canonical entry exactly. Delivery POSTs the re-serialized `href` of that same parse.

**Table** `notify.webhook_deliveries` (DDL style of `notify/migrations/002_push_subscriptions.up.sql`):
`delivery_id UUID PK`, `idempotency_key TEXT NOT NULL UNIQUE`, `callback_url TEXT NOT NULL`,
`event_name TEXT NOT NULL`, `payload JSONB NOT NULL`, `source_service TEXT NOT NULL`,
`state TEXT NOT NULL DEFAULT 'pending'` with a CHECK on `pending|delivered|dead`,
`attempts INT NOT NULL DEFAULT 0`, `next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`,
`last_error TEXT`, `created_at`, `updated_at`; partial index on `(next_attempt_at) WHERE state =
'pending'`. Down drops the table.

### Notify — delivery worker (D-8, D-9, D-10)

A `WebhookWorker` started in `notify/src/index.ts` after the server binds and stopped in `shutdown`
before `pool.end()` (recon: `index.ts:49-69`). It reuses the injected pool and issues single
`pool.query` statements only — no held client, no transaction (recon: `webPush.ts:108`; pool max 1,
`index.ts:35`).

- **Tick** (code-constant period, one at a time): select due pending rows not already in flight, up
  to the free slots (code-constant cap), ordered by `next_attempt_at`. Each row starts an un-awaited
  attempt that carries its own catch; the tick has its own catch. The in-memory in-flight set is the
  claim (single instance, `.do/app*.yaml` `instance_count: 1`). Nothing is logged per tick.
- **Attempt**: re-check the URL rule (failure → dead, no request) → `fetch` POST with
  `redirect: 'manual'`, `AbortController` timeout (`fanout.ts:130-158` shape), `Content-Type:
  application/json`, `Idempotency-Key`, body `{event_name, payload: {source_service, environment,
  occurred_at, data}}` where `data` is the stored payload, `occurred_at` the row's `created_at` in
  RFC 3339 and `environment` derived from `APPLICATION_ENV` as `configWatcher.ts:79-82` does. The
  response body is cancelled, never read.
- **Outcome**, recorded by one guarded statement (`… WHERE delivery_id = $1 AND state = 'pending'`,
  `next_attempt_at` computed in SQL): 2xx → delivered; 408 / 429 / 5xx / network error / timeout →
  `attempts + 1` and retry after `min(base · 2^(attempts−1), max)` seconds, or dead once attempts ≥
  `webhook.max_attempts`; 3xx, opaque redirect, any other 4xx → dead. An unexpected throw inside an
  attempt records a retry best-effort. `last_error` is a short class string (`http 503`, `timeout`,
  `network: <code>`, `redirect not followed`, `url rejected: <reason>`), never a body or the URL.
- **Dead-letter alert**, only when the dead update changed a row: `recordDelivery('webhook', 'dead')`
  and an ERROR log first, then an alert through the two functions extracted from `emitAlert`
  (persist + broadcast, then side-channel dispatch — a pure extraction that keeps the
  callback-before-side-channels order of `notifyServiceImpl.ts:98-117`). WARNING, category `webhook`,
  `source_service` `xstockstrat-notify`, untargeted; title `Webhook delivery dead: <event_name> →
  <origin>`; body carries the idempotency key, attempt count and `last_error`, so two dead rows never
  produce byte-identical alerts.
- **Telemetry**: `DeliveryChannel` gains `'webhook'`; `DeliveryOutcome` gains what the worker needs
  beyond the existing values (`notify/src/telemetry.ts:308-336`), with the allowlist tests updated.
  The startup "delivery channels" line is not changed.
- **Shutdown**: `stop()` clears the timer and aborts in-flight requests; their rows stay pending and
  are re-sent on the next start (at-least-once; the receiver dedups on `Idempotency-Key`).

### Ingest — trigger-time validation (D-2)

In `TriggerBackfill`, when `callback_url` is non-empty: after the admin gate and the timeframe check
and before `insert_job` (recon: `ingest/app/handlers/servicer.py:412-437`), call
`FanoutWebhook(callback_url=…, validate_only=True)` with `metadata=propagation_meta` (`:416`) and a
5 s timeout. Mapping: OK → continue; `INVALID_ARGUMENT` → abort `INVALID_ARGUMENT` with notify's
reason; `PERMISSION_DENIED` → abort `FAILED_PRECONDITION` and log ERROR (a certificate / allow-list
misconfiguration, not a transient fault); anything else, or no notify stub (`:336`) → abort
`UNAVAILABLE` with a fixed detail stating that no job was created. `insert_job` gains
`callback_url` (stored NULL when empty; recon: `ingest/app/repositories/backfill_jobs.py:29`).

### Ingest — hand-off (D-11, D-12, D-13, D-14)

- **Columns** on `ingest.backfill_jobs` (style of `ingest/migrations/012_backfill_data_kind`):
  `callback_url TEXT`, `webhook_enqueued_at TIMESTAMPTZ` (set when notify acknowledges),
  `webhook_rejected_at TIMESTAMPTZ` (set when notify answers `INVALID_ARGUMENT`); all nullable, no
  new index (`backfill_jobs_status_idx` exists, `003_backfill_jobs.up.sql:22`).
- **One hand-off path**: a loop in `ingest/app/engine/` shaped like `mcp_client_loop`
  (`run_one_cycle` extracted; interval re-read each tick through `int_positive`; recon:
  `mcp_client_loop.py:184,226-238`, `watcher.py:143-146`), started in `main.py` after
  `resume_incomplete_jobs()` (`main.py:119-130`). It waits on an `asyncio.Event` with the interval as
  timeout. Every terminal-write site in the servicer (recon T1–T5; T7 goes through T4) sets the event
  after its write, so the cycle runs as soon as a job turns terminal — without any notify call on the
  backfill path. T6 (restart reconcile, `backfill_jobs.py:123-144`) and any missed wake-up are covered
  by the interval tick. The loop gets a `Loop` enum member (`ingest/app/telemetry.py:330-333`).
- **Cycle**: select jobs with `callback_url IS NOT NULL`, a terminal status, and both markers NULL
  (oldest first, bounded batch). For each, build the payload from row columns only — `job_id`,
  `status` (enum name without the prefix), `data_kind`, `symbols`, `bars_processed`, `failed_symbols`,
  `started_at`, `completed_at` — and call `FanoutWebhook` with `event_name`
  (`ingest.backfill.completed` for COMPLETED and PARTIAL, `.failed`, `.canceled`), key
  `backfill:<job_id>:<STATUS>`, metadata `(("x-trace-id", <new uuid>),)` (precedent `servicer.py:762`)
  and a 5 s timeout. OK → set `webhook_enqueued_at`. `INVALID_ARGUMENT` → set `webhook_rejected_at`
  first, then one best-effort WARNING alert naming the job and notify's reason (no URL), in the shape
  of `_emit_backfill_alert` (`servicer.py:478-503`). Any other code → end the cycle; log ERROR for
  `PERMISSION_DENIED`, WARN otherwise. Marker updates are `… WHERE job_id = $1 AND
  webhook_enqueued_at IS NULL AND webhook_rejected_at IS NULL`, as dedicated repo functions with
  static SQL (INGEST-1, INGEST-2 untouched).
- **Once per job**: after either marker is set the job is never handed off again, even if a later
  restart re-drives it to another terminal status (known defect,
  `ingest/docs/context-constitution-findings.md:31`).

### Config (D-15)

One seed migration in `config/migrations/`, relative keys, one row per environment, global scope,
number-free actor sentinel `system:config-migration-feature-webhook-fanout-callback`
(`docs/patterns/config-governance.md:141-142`), column list and conflict target of
`043_analysis_live_loop_keys.up.sql:8-23`:

| Namespace | Key | Type | Default | Read by |
|---|---|---|---|---|
| notify | `webhook.allowed_origins` | string | `""` | the allowlist helper (handler + worker) |
| notify | `webhook.max_attempts` | int | 8 | worker |
| notify | `webhook.backoff_base_seconds` | int | 30 | worker |
| notify | `webhook.backoff_max_seconds` | int | 3600 | worker |
| notify | `webhook.request_timeout_seconds` | int | 10 (clamped to 1–60 in code) | worker |
| ingest | `backfill.webhook_sweep_interval_seconds` | int | 60 | hand-off loop |

A stored value ≤ 0 falls back to the default. New reader files are registered in
`scripts/config-wiring.json` and `scripts/config-wiring-stored.json` is regenerated in the same step.
The interval key joins `FR3_KEYS` in `ingest/tests/test_config_read_classification.py`.

### Consumer surface — Agent (C-14; D-16)

`trigger_backfill` gains `callback_url: str = ""`, passed to field 8 only when non-empty (recon:
`agent/app/tools.py:1542-1586`, `agent/app/client.py:2114-2121`). `INVALID_ARGUMENT` already passes
through (`tools.py:230`); the fixed "no job created" `UNAVAILABLE` detail is added to the tool's
allow-listed pass-through messages so the agent does not report "outcome unknown". Docstrings that
claim "no synchronous input validation" are corrected (`tools.py:1553-1570`, `client.py:2073-2082`).
Tool count stays 45.

### Docs

`docs/runbooks/mcp-tools.md:959-991`; `agent/CLAUDE.md:65`; `docs/runbooks/historical-backfill.md:103-122`;
`plugins/strat-lab/skills/backtest/reference/backfill.md` and `SKILL.md:205-212`, both `plugin.json`
versions bumped identically, `plugins/strat-lab/scripts/validate.py` run; notify `CLAUDE.md` (RPC list,
Authorization, keys, Observability, Database, Dependencies, a requeue SQL line for dead rows) and
`notify/docs/context-constitution.md` (in-memory claim assumes one instance; SAN gate; connection never
held across HTTP); ingest `CLAUDE.md` and `ingest/docs/context-constitution.md` (hand-off loop starts
after resume; once per job; payload from the row); `docs/patterns/config-governance.md` Per-Feature
Registered Keys; `docs/patterns/database.md`; root `CLAUDE.md` pool-table note and dependency block
(notify → external HTTPS).

### Test strategy

- **Notify, URL rule (pure)**: AC-4, AC-5 (all rows), AC-23, plus default and explicit 443, IDN,
  trailing dot, IPv6, backslash, whitespace, over-length, scheme-prefixed / malformed / empty
  allowlist entries. **Tests MUST** include cases that fail under a prefix / suffix / substring host
  match, and the step records one run against a deliberately weakened rule failing (ledger 207).
- **Notify, handler**: gate negatives (no auth context, wrong SAN → 7, no query; AC-27); rule before
  insert (no query on reject); AC-6, AC-7, AC-24; `validate_only` with empty `event_name` / key → OK
  and no query (AC-28); method exists on the impl; the existing ungated `EmitAlert` test stays green.
- **Notify, worker**: AC-8 (wire format; recursive no-`user_id`), AC-9, AC-10, AC-11, AC-12, AC-13,
  AC-14, AC-15 (no fetch), AC-16 (**Tests MUST** assert `redirect: 'manual'` on the request and that
  fetch ran once); distinct alert bodies for two dead rows; no `pool.connect` / `BEGIN`; a rejecting
  `pool.query` inside an attempt raises no unhandled rejection; the URL never appears in `last_error`
  or the alert. `stubFetch` / `fakeConfig` move to `notify/src/__tests__/fixtures/` in the same step
  (C-13).
- **Ingest**: `TestTriggerBackfill` — AC-1, AC-2, AC-3 / AC-4 (ingest half: `INVALID_ARGUMENT`
  mapping, `insert_job` not awaited), AC-26, `PERMISSION_DENIED` → `FAILED_PRECONDITION`, order after
  the admin gate, `propagation_meta` forwarded; existing `MagicMock` requests set `callback_url = ""`.
  Hand-off loop — AC-17 (×4), AC-18, AC-19, AC-20, AC-21, AC-25, AC-29, AC-30; a non-OK /
  non-`INVALID_ARGUMENT` code ends the cycle; stored-0 interval clamp; each terminal-write site sets
  the wake-up event (C-10). Repo functions' SQL and arguments in `test_backfill_jobs.py`; `job_row`
  gains the three keys.
- **Agent**: field 8 pass-through and default; the "no job created" message; AC-22 parity.
- **SQL against Postgres**: each step that adds SQL runs every new statement against a scratch
  Postgres with the migrations applied, as part of its verification, and records the result.

## Rejected Alternatives

- `R-1` Ingest watches notify's namespace and evaluates the allowlist — rejected: two parsers in two languages break the single enforcement point.
- `R-2` A separate `ValidateWebhookUrl` RPC — rejected: more proto surface for the same check as `validate_only`.
- `R-3` Accept the job when notify is down at trigger time — rejected: silently breaks the trigger-time guarantee of FR-2.
- `R-4` `x-internal-caller` allow-list on `FanoutWebhook` — rejected: self-asserted, adds nothing over the verified SAN.
- `R-5` Leave `FanoutWebhook` ungated like `EmitAlert` — rejected: the agent reaches notify and holds user input; the gate also makes `source_service` unforgeable.
- `R-6` JSON-array allowlist with a new `getJson` — rejected: the watcher is byte-identical across three services and a Struct cannot be a bare array.
- `R-7` Inline `FanoutWebhook` at each terminal-write site with the sweep as a net — rejected: seven sites, two payload builders, a notify call on the backfill path.
- `R-8` Re-hand-off whenever the status differs from the last handed-off one — rejected: externalizes the restart re-drive defect as contradictory webhooks.
- `R-9` Persisted claim column / `FOR UPDATE SKIP LOCKED` — rejected: YAGNI at one instance and incompatible with a single shared connection.

## Open Risks

- [ ] `O-9` New SQL is covered in CI only through fakes; each SQL-adding step runs its statements against a migrated scratch Postgres during verification. A CI-enforced DB test for notify / ingest is a follow-up — to be confirmed or upgraded at `/sdd-spec`.
- [ ] `O-17` A reconciled-FAILED job that is about to resume could be handed off as FAILED if a cycle runs before its resume flips it to RUNNING. Mitigated by start order (after `resume_incomplete_jobs`, wait-first) — verify at the ingest hand-off step.
- [ ] A dead-letter alert whose insert fails is lost; the `dead` metric and ERROR log precede it — notify worker step.
- [ ] No automatic requeue of dead rows (an allowlist mistake kills pending rows at the next attempt); a documented SQL line is the remedy — notify docs step.
- [ ] DNS rebinding of an allowlisted name is outside the model (the operator owns the name); accepted.
- [ ] The known restart re-drive defect (`ingest/docs/context-constitution-findings.md:31`) is not fixed here; once-per-job hand-off keeps it from reaching the listener.
- [ ] `source_service` depends on every environment's ingest certificate carrying the SAN `xstockstrat-ingest`; a mismatch surfaces as `FAILED_PRECONDITION` at trigger time and ERROR logs in the sweep — confirm in the staging end-to-end (upstream S7).
- [ ] Codegen toolchain (`buf`, Go plugins, `grpcio-tools`) is not installed in the build sandbox — provision per `docs/runbooks/codegen-toolchain-host-setup.md` at the proto step.
- [ ] Shared files with in-flight features: `notifyServiceImpl.ts` (312, 316), agent `tools.py` / `client.py` (314, 319, 322, 328, 331, 299), config seed number (330, 280, 299) — re-derive at merge.

## Constitution Rules Touched

- `C-03` — honored by: the validate call forwards `propagation_meta`; the sweep call has no inbound request and mints `x-trace-id` only (recorded precedent `servicer.py:762`).
- `C-04` — honored by: no new closed string set in proto; delivery `state` is a DB CHECK, not a proto field.
- `C-05` / `F-07` — honored by: six seeded, relative keys read live with literal defaults; tick period, slot cap, batch size, size limits and the 5 s gRPC timeout are code constants per the repo's precedent (`fanout.ts:14`).
- `C-07` / `F-01` — honored by: three new numbered up + down migrations; no applied migration is edited.
- `C-08` / `P-06` — honored by: every service step is paired with tests; red-before-green at execute.
- `C-09` — honored by: `buf lint`, `buf breaking`, `./scripts/buf-gen.sh`, stubs committed with the proto.
- `C-10` — honored by: one hand-off path selected by status covers T1–T7; a test proves every terminal-write site sets the wake-up; all doc surfaces listed.
- `C-13` — honored by: shared notify test fakes move to the fixture home when they gain a second consumer.
- `C-14` — honored by: the Agent tool argument has its own step, tests and docs.
- `C-15` — honored by: AC-1 … AC-30 each map to a named test layer; AC-3 / AC-4 are traced in both services.
- `C-16` — honored by: no existing rule changed (below).
- `C-18` — honored by: no JSON getter, no claim column, no extra index, no bounds-registry rows, no second validation RPC; the `emitAlert` change is a pure extraction.
- `F-06` — honored by: notify keeps pool max 1 and never holds the connection across HTTP; ingest stays on the PgBouncer pool with single statements.
- `F-11` — honored by: the adversary found no Floor breach.

## Business Rules Touched (C-16)

- PRESERVE `@AC-2`, `@AC-3`, `@AC-6` `@feature-261` (`services/xstockstrat-ingest/acceptance/fix-ingest-poller-backfill.feature`) — not regressed by: the hand-off only reads terminal rows and writes two marker columns; it never writes status or touches chunks.
- PRESERVE `@AC-6 @feature-198` (`services/xstockstrat-ingest/acceptance/historical-fundamentals-backtest.feature`) — not regressed by: `callback_url` is an optional additive field.
- PRESERVE `@AC-30 @feature-294` (`services/xstockstrat-ingest/acceptance/signal-map-instrumentation.feature`) — not regressed by: `_resume_job`'s failure path is untouched.
- PRESERVE `@AC-5`, `@AC-9` `@feature-196` (`docs/sdd/business-rules/platform.feature`) — not regressed by: additive proto only; no `user_id` in request or envelope.
- PRESERVE `@AC-1`, `@AC-3`, `@AC-4`, `@AC-5`, `@AC-6` `@feature-020` (`services/xstockstrat-notify/acceptance/notify-external-fanout.feature`) — not regressed by: Slack / SendGrid fanout untouched; the worker is isolated and never holds the DB connection; dead-letter alert bodies are distinct; knobs are read live.
- PRESERVE `@AC-5 @feature-165`, `@AC-5`, `@AC-11` `@feature-242` (notify push suites) — not regressed by: the dead-letter alert is an ordinary untargeted alert dispatched after persist.
- EXTEND `@AC-31 @feature-294` (`services/xstockstrat-notify/acceptance/signal-map-instrumentation.feature`) — new case added: channel `webhook` in the closed label set.
- PRESERVE `@AC-49 @feature-294` (same) — not regressed by: the startup "delivery channels" line is unchanged.
- PRESERVE `@AC-2 @feature-274`, `@AC-1/2/4/5 @feature-210`, `@AC-6 @feature-224` (`docs/sdd/business-rules/platform.feature`) — not regressed by: real gRPC codes; the existing mTLS channel; no `system` identity is used or widened.
- PRESERVE `@AC-2`/`@AC-3 @feature-278`, `@AC-13`/`@AC-27 @feature-295`, `@AC-10 @feature-296`, `@AC-2 @feature-304` (same) and `@AC-1 @feature-296` (`services/xstockstrat-config/acceptance/fix-config-keys-contract.feature`) — not regressed by: each key has a relative seed, a reader and a stored-value reader test.
- EXTEND `@AC-6 @feature-244` / PRESERVE `@AC-1 @feature-244` (`docs/sdd/business-rules/platform.feature`) — new case added: a stored 0 sweep interval reads as 60.
- PRESERVE `@AC-36 @feature-279`, `@AC-1/2 @feature-266` (same) — not regressed by: no new pool; verified connection reused.
- PRESERVE `@AC-5`, `@AC-10` `@feature-273` (`services/xstockstrat-agent/acceptance/fix-agent-client-deadlines.feature`) — not regressed by: the validate round-trip is bounded at 5 s inside the 45.5 s budget; no new agent stub call.
- PRESERVE `@AC-6 @feature-283`, `@AC-1 @feature-214` — not regressed by: tool count stays 45.
- EXTEND `@AC-5 @feature-149`, `@AC-10 @feature-283`, `@AC-32 @feature-224` (`docs/sdd/business-rules/platform.feature`) — new case added: runbook / skill parity for `callback_url` (AC-22).

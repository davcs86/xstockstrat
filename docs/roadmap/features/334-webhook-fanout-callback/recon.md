# Recon: webhook-fanout-callback

**Created**: 2026-11-11
**From**: product-spec.md
**Tree**: main-dev@0481498 ≡ origin/main-dev
**Affected services**: xstockstrat-notify, xstockstrat-ingest, xstockstrat-agent, xstockstrat-config, packages/proto

Paths are repo-relative. `notify/`, `ingest/`, `agent/`, `config/` abbreviate `services/xstockstrat-<name>/`.

---

## Objective

`trigger_backfill` gains an optional `callback_url`. When the job reaches a terminal status, ingest hands
the event to a new durable `NotifyService.FanoutWebhook` RPC; notify persists it, then delivers it
at-least-once over HTTPS to an allowlisted origin with backoff and a dead-letter alert. This replaces
polling `get_backfill_status` for agents and makes xstockstrat the first publisher for `webhooks-mcp`.

## Codebase Map

- **`xstockstrat-notify`** (Node.js / TypeScript, `node:test`, `tsc` compiles tests)
  - Entry point: `notify/src/index.ts` — boot order is load-bearing (NOTIFY-9): `resolveDbConnection`
    `:20` → `new ConfigWatcher(…,'notify')` + `waitForSnapshot(90_000)` `:27-28` → `new Pool` + `SELECT 1`
    `:31-38` → dispatchers `:41-43` → `grpc.Server` `:46` → `bindAsync` `:49-57`. Pool
    `max: parseInt(process.env.DB_POOL_MAX ?? '1', 10)` `:35`. Shutdown `:59-69` (`tryShutdown` →
    `pool.end()`); SIGINT/SIGTERM `:68-69`.
  - Service registration: `notify/src/index.ts:47` casts the impl to `grpc.UntypedServiceImplementation`
    — a missing handler compiles and fails only at runtime with `UNIMPLEMENTED`.
  - Handler: `notify/src/grpc/notifyServiceImpl.ts` — class `NotifyServiceImpl`, constructor
    `(pool, config, fanout, webPush)` `:24-29`; `emitAlert` `:34` (validate `:38-40` → `INSERT INTO
    notify.alerts` `:45-65` → broadcast `:84-95` → `callback` `:98-101` → `queueMicrotask` dispatches
    `:105-117`; DB failure → `code: 13` `:120`). Errors are bare numeric codes (`3`, `13`); `grpc.status`
    is not imported.
  - Caller identity: only `x-user-id` is read (`:173`, `:200`, `:240`). No `x-internal-caller`,
    `x-access-scope` or peer-SAN check exists anywhere in `notify/src/`. `EmitAlert` is deliberately
    ungated (`notify/CLAUDE.md:43-55`, pinned by a metadata-less test in `notifyServiceImpl.test.ts`).
  - Outbound HTTP: `notify/src/fanout/fanout.ts:130-158` — global `fetch` + `AbortController` +
    `setTimeout`; `FANOUT_HTTP_TIMEOUT_MS = 3000` `:14`. **No `redirect:` option is set anywhere** (fetch
    default is `follow`).
  - Config-read pattern: `this.config.getInt('fanout.min_severity', 2)` `fanout.ts:62` — relative key,
    literal default, read live per use. `notify/src/services/configWatcher.ts`: `getString` `:203`,
    `getInt` `:209`, `getFloat` `:216`, `getBool` `:222`, `getSnapshot` `:228`. **No JSON / array getter.**
    The file is byte-identical across ledger / identity / notify (`:1-4`; CI `scripts/check-watcher-copies.py`).
  - Environment: `configWatcher.ts:79-82` reads `process.env.APPLICATION_ENV`; `'production'` →
    production, anything else → staging.
  - Telemetry: `notify/src/telemetry.ts:308-336` — `DeliveryChannel = 'fanout'|'slack'|'sendgrid'|'push'`
    and `DeliveryOutcome` are closed unions, enforced by `telemetryAllowlist.test.ts` /
    `telemetryInstruments.test.ts`.
  - Last migration: `003_alert_reads` (`notify/migrations/`); schema `notify`; DDL templates
    `002_push_subscriptions.up.sql:1-19`, `003_alert_reads.up.sql:1-9`.
  - Background loops: **none** in service code (`notify/CLAUDE.md` § Observability: "No tick loops").
  - Test fakes: `notify/src/__tests__/fanout.test.ts` `fakeConfig` `:27-33`, `stubFetch` `:40-48`;
    `notifyServiceImpl.test.ts` `makePool` / `makeImpl` `:42-54`. Fixture home
    `notify/src/__tests__/fixtures/` holds only `collectingReader.ts`.
  - Deploy: `instance_count: 1` (`.do/app.dev.yaml:500`, `.do/app.yaml:503`); `DB_POOL_MAX "1"`
    (`docker-compose.yml:235`, `.do/app.dev.yaml:532-533`, `.do/app.yaml:535-536`). No egress restriction
    is documented; notify already POSTs to Slack and SendGrid.

- **`xstockstrat-ingest`** (Python, pytest `asyncio_mode = "auto"`)
  - Entry point: `ingest/app/main.py` — pool `:55-63` (`max_size` from `DB_POOL_MAX` default 2,
    `statement_cache_size=0` under `DB_PGBOUNCER`); `reconcile_interrupted` `:71-77`; notify channel
    `:90-94`; servicer built `:96`; `resume_incomplete_jobs()` `:119`; loop start `:122-130`; shutdown
    `:132-140` (no task cancel).
  - Servicer: `ingest/app/handlers/servicer.py` — `__init__` `:325-332`, `self._notify` stub `:336`
    (`None` without a channel); `_has_admin_scope` `:346-359`; `_propagation_meta` `:362-367`;
    `TriggerBackfill` `:406-459` (db check `:407` → admin gate `:412` → `job_id` `:415` → timeframe
    `INVALID_ARGUMENT` `:420-436` → `insert_job` `:437-446` → ledger `queued` `:447` → `create_task`
    `:455` → response `:456`); `_emit_backfill_event` `:461-476`; `_emit_backfill_alert` `:478-503`;
    `job_row_to_proto` `:291-321`.
  - **Terminal-status write sites — seven, in five code paths, with no shared helper:**

    | # | Site | Status | Ledger event | Alert |
    |---|---|---|---|---|
    | T1 | `_run_backfill` except, `servicer.py:538-551` | FAILED | `ingest.backfill.failed` `:546` | ERROR `:549` |
    | T2 | `_execute_fundamentals_backfill` `:572-592` | COMPLETED / PARTIAL | `ingest.backfill.completed` `:583` | none |
    | T3 | `_execute_backfill` empty plan `:648-665` | COMPLETED | `ingest.backfill.completed` `:658` | none |
    | T4 | `_finalize_backfill` `:680-743` | FAILED / PARTIAL / COMPLETED | `.failed` `:711` / `.completed` `:722` | `:717`, `:729` |
    | T5 | `CancelBackfill` `:911-951` | CANCELED | `ingest.backfill.canceled` `:945` | none |
    | T6 | `main.py:71-77` → `backfill_jobs.reconcile_interrupted` (`backfill_jobs.py:123-144`) | FAILED (bulk UPDATE) | **none** | **none** |
    | T7 | `_resume_job` → `_finalize_backfill` `:754-780` | as T4 | as T4 | as T4 |

    A job reconciled to FAILED by T6 can be re-driven by T7 to a second terminal status (known defect,
    `ingest/CLAUDE.md:4`, `docs/context-constitution-findings.md`).
  - Repository: `ingest/app/repositories/backfill_jobs.py` — `_UPDATABLE_COLUMNS` `:13-26` (INGEST-2),
    `insert_job` `:29`, `update_job` `:59`, `get_job` `:80`, `list_jobs` `:88`. Proto-free (INGEST-1);
    status is a `SMALLINT` mirror of `BackfillStatus`. No "terminal with unset marker" query exists.
  - Background loop: `ingest/app/engine/mcp_client_loop.py:226-238` (`run_mcp_client_loop`; `run_one_cycle`
    `:184` extracted for tests; sleeps before the first cycle, INGEST-8); `Loop` closed `StrEnum`
    `ingest/app/telemetry.py:330-333`.
  - Config-read pattern: `int_positive(cfg, "backfill.max_concurrent_jobs", 3)`
    (`ingest/app/config/watcher.py:113`, helper `:143-146`); getters `ingest/app/config/watch_core.py:214-223`
    (`get_str`, `get_int`, `get_bool`, `get_float` — no JSON getter).
  - Last migration: `014_contract_signal_ownership`; additive-column template `012_backfill_data_kind`.
  - Tests: `ingest/tests/test_ingest_servicer.py` (`make_servicer` `:34-66`, `TestTriggerBackfill`
    `:297-416`, `TestRunBackfill` `:467+`), `test_cancel_backfill.py`, `test_backfill_jobs.py`,
    `test_mcp_client_loop.py:153-170`, `test_config_read_classification.py:24-45`; `tests/_helpers.py:62-89`
    `job_row` (16 keys = DDL columns); `tests/conftest.py:17-45` `_ctx`, `:71-99` `snapshot_watcher`.
  - Deploy: `NOTIFY_ENDPOINT` present (`docker-compose.yml:351`, `.do/app.dev.yaml:262`, `.do/app.yaml:262`);
    `instance_count: 1` (`.do/app.dev.yaml:240`, `.do/app.yaml:240`).

- **`xstockstrat-agent`** (Python MCP server)
  - Tool: `agent/app/tools.py:1542-1586` (`trigger_backfill`; docstring `:1553-1570` says "Ingest performs
    NO synchronous input validation" — becomes partly false); error helper `_grpc_error_message`
    `:247-282`; `INVALID_ARGUMENT` already in `_PASS_THROUGH_CODES` `:230`.
  - Client: `agent/app/client.py:2063-2137` (request build `:2114-2121`, metadata `:2133`, call `:2136`
    with `_LONG_RPC_TIMEOUT_S = 45.0` `:45`); docstring `:2073-2082` carries the same "queues
    unconditionally" claim.
  - Tests: `agent/tests/test_client.py:493-644` (`TestTriggerBackfillClient`), `agent/tests/test_tools.py:1638`
    (`TestTriggerBackfillTool`), `agent/tests/test_tools_endpoint.py` (`:91-97` doc/skill parity,
    `:100-103` runbook heading, `:125-136` pins only `symbols`), `test_client_deadlines.py:44,53`.
  - No tool-argument schema snapshot; the tool count stays 45.

- **`xstockstrat-config`** (seed migration only)
  - Last migration: `047_config_alias_removal_rows`. Relative-key CHECK added by
    `045_config_keys_relative_check.up.sql:128-129`. `value_type` CHECK allows
    `string|int|float|bool|json` (`001_config_tables.up.sql:10`).
  - `SCALAR_BOUNDS_REGISTRY`: `config/src/grpc/configServiceImpl.ts:114`.

- **`packages/proto`**
  - `packages/proto/ingest/v1/ingest.proto:78-87` `TriggerBackfillRequest`, fields 1–7 → next is **8**.
    `BackfillJob` `:33-50`, fields 1–15.
  - `packages/proto/notify/v1/notify.proto:12-36` `service NotifyService` (last RPC `:35`); imports
    `:7-8` already include `google/protobuf/struct.proto`; `AlertSeverity` `:57-63`; `EmitAlertRequest`
    `:65-75`; empty-response precedent `MarkAlertReadResponse {}` `:117`.
  - `packages/proto/buf.yaml:6-12` — lint `STANDARD` minus three rules; `RPC_REQUEST_STANDARD_NAME`
    is enforced, so the request must be named `FanoutWebhookRequest`.

## Patterns to REUSE

- Outbound POST with a hard timeout → the `fetch` + `AbortController` shape at
  `notify/src/fanout/fanout.ts:130-158`, adding an explicit `redirect: 'manual'`.
- Post-success side effect that must not fail the RPC → `queueMicrotask` dispatch at
  `notify/src/grpc/notifyServiceImpl.ts:105-117` (ledger insight 2026-08-26).
- Reusing notify's single pool → "Reuse the injected pool — no new pool (F-06)" at
  `notify/src/fanout/webPush.ts:108`; raw `this.pool.query` per statement, never a held client.
- Config knobs → relative key + literal default read live per use (`fanout.ts:62`; NOTIFY-3, PLAT-6).
- Delivery outcome metric → `recordDelivery(channel, outcome)` `notify/src/telemetry.ts:335` with a new
  closed-set channel value.
- Notify table DDL → `notify/migrations/002_push_subscriptions.up.sql:1-19` (UUID PK, `UNIQUE`, index).
- Ingest periodic loop → `ingest/app/engine/mcp_client_loop.py:184,226-238` (`run_one_cycle` + interval
  re-read each tick + `int_positive` clamp + `log_tick_ok`) and its test pattern
  `ingest/tests/test_mcp_client_loop.py:153-170`.
- Best-effort notify call from ingest → `_emit_backfill_alert` `ingest/app/handlers/servicer.py:478-503`
  (PLAT-N1).
- Synchronous request validation before any job row exists → the timeframe `INVALID_ARGUMENT` at
  `servicer.py:420-436`.
- Additive `backfill_jobs` column → `ingest/migrations/012_backfill_data_kind.{up,down}.sql`, plus the
  `_UPDATABLE_COLUMNS` allow-list (INGEST-2) and `tests/_helpers.py:62` `job_row`.
- Background-call metadata with no inbound request → `_resume_job` mints `(("x-trace-id", uuid4),)` at
  `servicer.py:762`; outbound `x-internal-caller: ingest` precedent at `ingest/app/config/watcher.py:17,100`.
- Peer-SAN authorization in Node → `peerDnsSans()` `config/src/grpc/authz.ts:158` and identity's
  SAN-only gate `services/xstockstrat-identity/src/grpc/adminDirectory.ts:2`
  (`docs/patterns/inter-service-mtls.md:52-66`).
- Reading another service's namespace → second watcher instance,
  `services/xstockstrat-analysis/app/main.py:49` (registered in `scripts/config-wiring.json:92,94`).
- Dry-run flag precedent → `bool dry_run = 2;` `packages/proto/analysis/v1/analysis.proto:555`.
- Config seed → column list and `ON CONFLICT` target of
  `config/migrations/043_analysis_live_loop_keys.up.sql:8-23` with **relative** keys; down style
  `043…down.sql:7-13`; number-free actor sentinel `system:config-migration-feature-<slug>`
  (`docs/patterns/config-governance.md:141-142`).
- Agent error surfacing → no code change: `INVALID_ARGUMENT` passes through (`agent/app/tools.py:230,274`).

## Existing Business Rules (preserve / extend)

No **CHANGE** verdict. Full digest from `scenario-recon`; the rules that constrain the design:

- **PRESERVE** `@AC-2 @FR-2 @regression @feature-261` "A backfill canceled while queued stays CANCELED and never runs" (`services/xstockstrat-ingest/acceptance/fix-ingest-poller-backfill.feature`) — the hand-off must not revive or run a job.
- **PRESERVE** `@AC-3 @FR-4 @regression @feature-261` "A canceled backfill is not resumed after a restart" (same) — the sweep only re-sends the hand-off; it never touches chunks or status.
- **PRESERVE** `@AC-6 @FR-3 @regression @feature-261` "A fundamentals backfill canceled mid-run is not finalized as COMPLETED or PARTIAL" (same) — the hand-off carries the persisted final status.
- **PRESERVE** `@AC-6 @FR-4 @feature-198` "Fundamentals backfill is a distinct data kind, not a timeframe" (`services/xstockstrat-ingest/acceptance/historical-fundamentals-backtest.feature`) — `callback_url` is additive.
- **PRESERVE** `@AC-30 @FR-9 @feature-294` "A failing job resume is logged and counted, then still raises" (`services/xstockstrat-ingest/acceptance/signal-map-instrumentation.feature`).
- **PRESERVE** `@AC-5 @FR-4 @regression @feature-196` (`docs/sdd/business-rules/platform.feature`) — proto changes are additive only; `BackfillJob` is unchanged.
- **PRESERVE** `@AC-9 @FR-5 @regression @feature-196` (same) — no `user_id` in the request body.
- **PRESERVE** `@AC-1`, `@AC-4`, `@AC-5`, `@AC-3`, `@AC-6` `@feature-020` (`services/xstockstrat-notify/acceptance/notify-external-fanout.feature`) — Slack fanout unchanged; a slow target never delays `EmitAlert` / `StreamAlerts`; byte-identical alerts inside the dedup window fan out once; knobs are read live; channel errors never reach the caller.
- **PRESERVE** `@AC-5 @FR-3 @feature-165` (`services/xstockstrat-notify/acceptance/pwa-notifications.feature`) and `@AC-5`, `@AC-11` `@feature-242` (`services/xstockstrat-notify/acceptance/fix-push-untargeted-broadcast.feature`) — the untargeted dead-letter alert is pushed to admins only and never blocks.
- **EXTEND** `@AC-31 @FR-10 @feature-294` (`services/xstockstrat-notify/acceptance/signal-map-instrumentation.feature`) — a new closed-set channel value for `notify.delivery`.
- **PRESERVE** `@AC-49 @FR-10 @feature-294` (same) — the single startup "delivery channels" line is unchanged.
- **PRESERVE** `@AC-2 @FR-2 @regression @feature-274`, `@AC-1/2/4/5 @feature-210`, `@AC-6 @feature-224` (`docs/sdd/business-rules/platform.feature`) — real gRPC status codes; mTLS fail-closed; a `system`-style identity needs its own grant bound to the peer SAN, never a widened one.
- **PRESERVE** `@AC-2`/`@AC-3 @feature-278`, `@AC-13`/`@AC-27 @feature-295`, `@AC-10 @feature-296`, `@AC-2 @feature-304` (same) and `@AC-1 @feature-296` (`services/xstockstrat-config/acceptance/fix-config-keys-contract.feature`) — every new key has a seed and a reader, a full contract, a relative stored key, and a reader test whose stored value differs from the default.
- **EXTEND** `@AC-6 @FR-3 @regression @feature-244` / **PRESERVE** `@AC-1 @feature-244` (`docs/sdd/business-rules/platform.feature`) — a stored `0` for the sweep interval must clamp to the default.
- **PRESERVE** `@AC-36 @FR-3 @feature-279`, `@AC-1/2 @feature-266` (same) — notify keeps one direct connection and never holds it across HTTP I/O.
- **PRESERVE** `@AC-5`, `@AC-10` `@feature-273` (`services/xstockstrat-agent/acceptance/fix-agent-client-deadlines.feature`) — `TriggerBackfill` stays inside 45.5 s including any added notify round-trip.
- **PRESERVE** `@AC-6 @feature-283`, `@AC-1 @feature-214` — tool count stays 45. **EXTEND** `@AC-5 @feature-149`, `@AC-10 @feature-283`, `@AC-32 @feature-224` — runbook / skill parity gains the `callback_url` case.

Not pinned by any suite (documented only in `ingest/CLAUDE.md`): the `TriggerBackfill` admin gate, the
`1d`-only rule and restart reconciliation; and that `EmitAlert` is ungated.

## Dependencies

- Proto/RPC: `TriggerBackfillRequest.callback_url = 8` (`ingest.proto:78-87`); new
  `rpc FanoutWebhook(FanoutWebhookRequest) returns (FanoutWebhookResponse)` after `notify.proto:35`.
  Generated stubs for Go / Python / TS are committed and checked by CI `proto-freshness`
  (`.github/workflows/ci.yml:250-308`). Go fakes of `NotifyServiceClient` in trading / portfolio /
  marketdata tests all **embed the interface**, so a new RPC does not break their compile.
- Migration: next `004` for `notify/migrations/`, next `015` for `ingest/migrations/`, next `048` for
  `config/migrations/` (volatile — 330 / 280 / 299 race for it; re-derive at merge). Run order
  config → … → notify → ingest (`scripts/db-migrate.sh:151-177`).
- Config keys (new): `notify` / `webhook.*`, `ingest` / `backfill.webhook_sweep_interval_seconds`. Each
  needs: seed row per environment, reader, `scripts/config-wiring.json` receiver registration for any
  new reader file, regenerated `scripts/config-wiring-stored.json` (CI `config-wiring-stored`,
  `ci.yml:1245`, needs a scratch Postgres), `Config Keys Consumed` rows in the service `CLAUDE.md`, a
  Per-Feature Registered Keys entry (`docs/patterns/config-governance.md:144-150`), and
  `ingest/tests/test_config_read_classification.py` `FR3_KEYS` for the interval key.
- Inter-service edges: ingest → notify exists (`All services → xstockstrat-notify`, root `CLAUDE.md`).
  New: notify → external HTTPS (allowlisted origins).
- New env vars / ports: none.
- Doc surfaces for the tool argument: `docs/runbooks/mcp-tools.md:959-991` (params table `:968-975`,
  errors `:983-989`), `agent/CLAUDE.md:65`, `docs/runbooks/historical-backfill.md:103-122`,
  `agent/app/tools.py:1553-1570`, `agent/app/client.py:2073-2082`,
  `plugins/strat-lab/skills/backtest/reference/backfill.md:12-20`,
  `plugins/strat-lab/skills/backtest/SKILL.md:205-212`, both `plugin.json` versions (`0.4.0`, must stay
  byte-identical — `docs/patterns/strat-lab-plugin.md:52-55`), validator
  `plugins/strat-lab/scripts/validate.py` (manual, not in CI).

## Risks / Not-found

- **No JSON getter** in notify's `ConfigWatcher` or ingest's `watch_core`, and no seeded `json` row
  exists anywhere; a proto `Struct` cannot be a bare array. Adding a getter means editing a file that
  is byte-identical across three services. The allowlist value type must be chosen deliberately (the
  wiring guard flags a `value_type` that disagrees with the getter, `scripts/check-config-wiring.mjs:647`).
- **No post-296 seed migration** exists to copy verbatim; 042/043 use the old prefixed form.
- **No internal-caller or peer-SAN gate** exists in notify; `EmitAlert` is ungated by design, so a gate
  on `FanoutWebhook` is a new mechanism, not an analogy.
- **No internal (non-gRPC) alert emitter** in notify — persist + broadcast is inline in `emitAlert`.
- **No background loop** in notify, and no stop hook in its shutdown path.
- **Notify's single DB connection** is shared by every handler (`notifyServiceImpl.ts:204` "serializes
  at pool-max-1"). A claim held across an HTTP call would stall `EmitAlert`.
- **Terminal transitions are not funneled** (T1–T7), T6 emits nothing, and T6 → T7 can produce two
  terminal statuses for one job, i.e. two idempotency keys.
- **Row-vs-live data gap in ingest**: `error` is stored only by T1 and T6; T4's "all chunks failed"
  text and T1's failed symbols are never written to the row. A payload rebuilt from the row differs
  from one built at the write site.
- **`MagicMock` requests** in `ingest/tests/test_ingest_servicer.py:301,325,361,385,403` return a truthy
  mock for an unset `req.callback_url`.
- **INGEST-11**: `GetBackfillStatus` / `ListBackfillJobs` return every job to any caller — echoing
  `callback_url` in `BackfillJob` would expose minted (capability) URLs.
- **Dedup interaction** (020 `@AC-5`): two dead-letter alerts with identical title/body inside 300 s
  collapse to one on Slack / email.
- **Sweep identity**: no header-propagation guidance exists for a call with no inbound request
  (`docs/patterns/header-propagation.md`).
- **Codegen toolchain**: `scripts/buf-gen.sh` needs buf 1.72.0, three pinned Go plugins, grpcio-tools
  1.80.0 and pnpm on the host (`docs/runbooks/codegen-toolchain-host-setup.md`); availability in this
  sandbox is unverified until the proto step.
- Not found: `callback_url`, `FanoutWebhook`, any `notify.webhook.*` key, any descriptor-parity guard
  for the two protos, any CI job running the `strat-lab` validator, any `validate_only` field.
- Ledger traps that apply: 020 (2026-08-19, payload keys must be ones the producer writes; 2026-08-26,
  do not pin migration numbers), 202 (validate before the idempotency claim), 207 (SSRF guard needs
  regression-failing tests and a negative test per failure class; design test mandates must be traced
  into spec steps), 043 (idempotency keys from stable inputs only).

## Recommended Scope

1. Proto (both files) + regenerated stubs.
2. Config seed migration + wiring registration + stored-set regeneration.
3. Notify: delivery-table migration; URL rule module; `FanoutWebhook` handler; delivery worker +
   dead-letter alert; worker start/stop in `index.ts`; tests; docs.
4. Ingest: `backfill_jobs` migration; repo functions; `TriggerBackfill` up-front validation; hand-off
   from the persisted row + sweep loop; tests; docs.
5. Agent: `callback_url` pass-through; tests; `mcp-tools.md`, `historical-backfill.md`, agent `CLAUDE.md`,
   `strat-lab` skill + version bump.
6. Staging end-to-end (upstream S7) — outside this feature's PR; waits on the listener.

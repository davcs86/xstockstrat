# Context: signal-map-instrumentation  (archived 2026-11-10)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-11-10 — /sdd-archiver

**What**: Signals only, no behaviour change, across all 12 services. It added:
- bounded-label counters, gauges and histograms;
- a `loop tick ok` INFO record per successful tick;
- level and aggregation fixes for the signal-map survey's 26 blind spots, 7 noisy logs and 5 gauges.

Each runtime's existing telemetry module gained a provider-rebinding accessor layer: Go `meterGen` plus provider identity, a Python proxy-provider guard, and Node `Bound*`. Every service has a telemetry allowlist test that fails on any identifier or secret label.

It shipped in 30 sequential steps on harness branch `ccr-b4aace27-zvuaby`, and launched 2026-11-07. One part was dropped at merge: the indicators watcher throttle and clean-end log were dropped in favour of feature 295's shared `watch_core.py`.

**Why (irrecoverable rationale)**:
- **Demote with the text unchanged; never reword (OQ4).** A demoted line, or a line replaced by a counter, keeps its exact text at DEBUG. Out-of-repo Grafana rules cannot be grepped, so they must see silence, not a new literal.
- **Signals only (operator requirement).** No halts, pages, status remaps, timeouts or backoff. Every finding that needed a behaviour fix was split, and its behaviour half went to the Deferred table below.
- **Liveness is a log record, not a gauge (operator choice).** The operator knew the 5 s pollers write about 17k Loki records per day per loop.
- **When a tick counts as failed.** Only when items reached the fallible call and every one of them failed. Gated-off loops still write a record, with a `state`. Event-driven consumers use a 60 s leading-edge throttle.
- **Where agent backend errors are counted.** In the `mtls.secure_channel` `__aexit__` wrapper. The error carries no backend name, and the channel target name is the only seam.
- **Portfolio "stream resumed" INFO.** `onHealthy` writes it only after 2+ closes of one kind, and counters reset after a 10-minute quiet window.
- **Accepted trade-off.** `observeQuotePass` carries two duties: the mark-source rate and the unusable-quote aggregate.
- **Round 6.** The design ran past the 5-round cap with explicit operator sign-off. The cap is a skill constraint, not a Floor item.
- **Accepted as-is.**
  - Notify's `describeDeliveryChannels`/`enabledChannels`/`isPushEnabled` testability surface (C-18).
  - The KEPT loop names `signal_prune` (281) and `asset_refresh` (282).
- **Why 295's watcher won (option a).** Keeping 294's watcher behaviour would have meant editing 295's byte-identical shared core, which changes 3 other services, or filtering another module's logger. 295's jittered 1–30 s backoff already reduces the log storm FR-14 targeted.

**Rejected alternatives**:
- **Gauge-based loop liveness:** a stale gauge cannot tell "stopped" from "idle", and it adds a series per loop.
- **Strict "no WARN in the tick":** per-item WARNs inside healthy ticks would hide liveness.
- **Tick rule driven by a value the body returns:** changes tick-body signatures and their tests.
- **ContextVar, stamp or static-map backend attribution in the agent:** action at a distance, fragile across tasks.
- **Per-service `instruments.*` files:** duplicates the existing telemetry modules (C-18).
- **Changing the `applyQuotes(ctx, path)` signature:** churns 3 test callers and the parity test.
- **A `path` kwarg on `_ingest_external_signal`:** breaks the spy at `test_mcp_client_loop.py:192`.
- **Fundsignal counts:**
  - as instance state `_last_emit`: the RPC path runs `run_once` without the lock, so it races;
  - in a ContextVar: hidden ambient state.
  
  A keyword-only `_emit_counts` sink, always aliased, won.
- **Hand-typed tick logs at each site:** literal drift.
- **`rpc.client.*` drop views:** YAGNI. AC-56 asserts their absence instead.
- **Letting `secretDenialReason` drive the GetSecret gate:** edits a security decision. The boolean stays authoritative, the reason is log-only, and a parity test pins the two together.
- **Dropping the portfolio recovery INFO:** a park sequence would have no closing signal.
- **`streamEventsFrom` returning the health signal:** it arrives only at session end.
- **Resetting counters when StreamEvents opens:** that also happens on every handler-error redelivery, which defeats the throttle.
- **Keeping the indicators throttle and clean-end INFO against 295:** rejected at merge.

**Scars & gotchas**:
- **Node sdk-metrics 1.25 cumulative storage.** An observable gauge keeps re-exporting its last value after its callback stops observing. "No observation" means no NEW sample, not no point. Assert only that a superseded reader never sees a newer value.
- **Python accessors bind only to a real provider.** They are no-ops while the API proxy provider is installed, which avoids a duplicate-instrument warning on materialisation. Consequences:
  - a `Gauge` must be `register()`ed after `init_telemetry()`;
  - tests must register again after a provider swap.
  
  The same holds for Node `BoundGauge`.
- **`metric_reader` lives in `tests/test_telemetry.py`, not conftest** (analysis, indicators, ingest). Rebind it by module assignment: `metric_reader = test_telemetry.metric_reader`. Importing it trips ruff F811 on every shadowing parameter.
- **`golangci-lint --modules-download-mode=mod` edits `go.mod`.** It silently promoted a test-only `go.opentelemetry.io/otel/trace` import to a direct requirement. Use `propagation.TraceContext` from the root `otel` module instead.
- **node-pg 8.20.0 error/end semantics.**
  - On an idle connected client, LISTENing ones included, it emits `error` then `end`.
  - During `connect()` it rejects instead of emitting.
  
  So the ledger notifier's `this.client === client` guard counts one failure once, and a connect-phase `error` no longer WARNs.
- **Identity `jwtSecretMissingLogged` has no reset seam.** The "exactly one ERROR" test must run in its own `node --test` file or process.
- **Real `grpc.aio` `context.abort` raises.** So `template.instantiate` is recorded before each abort. Indicators instead wraps the handler and reads `context.code()` in a `finally`.
- **Placement in the fundsignal tick.** The record sits in the `try`'s `else:`, so a fault in the record cannot reach the `except` path and advance the schedule twice.
- **Ingest poll outcome.** It is recorded in a `finally` that skips `CancelledError`, so a shutdown is not counted as `error`.
- **Portfolio `observed` wrapper.** It takes `okOutcome` as an argument, because an `ackAlways` handler returns nil exactly like a successful one.
- **Marketdata `BackfillBars` seam.** It wrote through the concrete `*repository.MarketDataRepo`, so `written` was unreachable from a unit test. The operator approved a `barInserter` seam (`marketdata_service.go`).
- **AC-17 run status is `completed`.** Only a failed `GetFundamentalsMulti` chunk makes a run `partial`.
- **Agent tests must reset the module-level `tool_metrics._first_call_seen` between cases.**
- **Portfolio `boundedRetry` makes an extra `s.clock()` read per delivery,** so with a stepping `fakeClock` a park cycle consumes more fake time.
- **The trading `position_sync` heartbeat (`StartPositionSyncPoller`) is untested.** It has a 300 s ticker and no clock seam, so AC-7 is asserted on `syncPositions` instead.
- **`pruneOnce` writes its tick INFO even after a failed prune.** So 281's KEPT record is not strictly "per successful tick".
- **Worktree sandbox refusals.** It refused compound `&&`/`for` chains, runtime-computed `$(...)` fed to `go`, and `bash scripts/...`, so every verification ran as split invocations. Hard-coded `cd /home/user/xstockstrat` lines in the spec would have staged the wrong tree.
- **Stale discovery digest.** The per-step digest was stale at almost every step, reporting the previous step as unlanded.
- **husky `prepare` on `pnpm install` rewrote the shared `core.hooksPath`.** It had to be restored by hand each time.

**Permanent deviations**:
- **Tick helper.**
  - Spec (FR-2): "no shared helper".
  - Shipped: a per-service `LogTickOK`/`log_tick_ok` plus loop-name constants.
  - Because: the ruling applied to the gauge, and one helper per language prevents literal drift.
- **Alert label.**
  - Spec (FR-1): `trading.alert_emit{category}`.
  - Shipped: `alert_kind`.
  - Because: `category` is request-supplied and banned as a label (orchestrator ruling).
- **Agent backend-error counting.**
  - Spec (FR-6): inside `_grpc_error_message`.
  - Shipped: `_CountingChannel` in `services/xstockstrat-agent/app/mtls.py`.
  - Consequences: errors caught inside the `async with` are not counted, and oauth identity failures are double-counted (also in `oauth.requests`).
- **281 prune loop.**
  - Design: portfolio adds it with a `loop tick ok` record.
  - Shipped: `signal_prune` is KEPT on its existing `"signal watchlist prune tick"` INFO, with no `LogTickOK`.
  - Because: OQ2, a loop that already writes a per-tick record keeps it. The same applies to 282's `asset_refresh` ("asset set loaded").
- **UI accessors.**
  - Design: `src/telemetry.ts`.
  - Shipped: `src/lib/bffMetrics.ts`. `telemetry.ts` exports only `initTelemetry`.
- **Loop cadences.**
  - Design: code constants.
  - Shipped: several are config-key defaults (`trading.*.interval_ms`, `trading.order_intent.sweep_interval_ms`, `marketdata.stream.warm_interval_ms`, `analysis.fundsignal.run_interval_hours`). The docs were corrected.
- **Indicators watcher.**
  - Design: the 1st/every-10th throttle, a clean-end INFO, an immediate re-issue and a 2 s retry.
  - Shipped: only the `snapshot_age` gauge, via a `ConfigWatcher._apply` override.
  - Because: 295's `watch_core.py` wins. AC-38 was trimmed to its gauge clause and AC-50 to its portfolio clauses, each with a `# Superseded by feature 295` comment.
- **`oauth.requests`.**
  - Design: failure outcomes only.
  - Shipped: `ok` as well, so failures have a denominator.
- **UI `serverLog` keeps camelCase `traceId`,** its existing key, diverging from the observability doc's `trace_id` on purpose.
- **UI login error log.** It carries only the Connect code, not the stack, and a dead `ConnectError` guard was removed.
- **`CollectingReader`.**
  - Design (C-13): move it on the 2nd new consumer.
  - Shipped: moved to `src/__tests__/fixtures/collectingReader.ts` in identity, config, ledger and notify, under a standing operator approval. The UI keeps inline copies, because the approval did not cover the UI.
- **Integration PR.**
  - Design: #1427.
  - Actual: #1427 had already merged on 2026-11-04, so a new integration PR was opened, and the teardown record went in its body.
- **Teardown.** `/context-forge:context-constitution` was unavailable, so a manual grep reconciliation was done.

**Cross-feature signal**:
- **The 295 overlap surfaced late.** 295 changed the config-watcher loop concurrently and superseded 294's indicators half at merge. 294's merge-order rows covered only 289/290/291/293, so the overlap surfaced only at the pre-merge `origin/main-dev` merge.
- **Caveats for the future alerting/registry feature** (these lived only in design.md):
  - event-driven loops write no idle heartbeat, so their staleness is ambiguous;
  - a `|= "loop tick ok"` filter misses the KEPT cycle records;
  - `position_sync` exists in both trading and portfolio, so filters must key on `service_name`;
  - full-history replay at boot (lastSeq=0) inflates `portfolio.consumer.events{ok}` on every deploy;
  - the marketdata stream gauge can report at most one stale age, in the window between `add` and `run()`;
  - `loop tick ok` and poller records carry no `trace_id`, because poller contexts are `context.Background()` with no span;
  - a down ledger never logs ERROR from portfolio consumers: `isGracefulStreamClose` treats `codes.Unavailable` as graceful, giving INFO about every 20 s. Alert on the counter, not the log level;
  - Alpaca `vendor.requests{ok}` counts any 2xx, and read/decode failures in its 8 callers are uncounted;
  - the notify "delivery channels" startup line can overstate email: `enabledChannels().sendgrid` reflects only `SENDGRID_API_KEY` presence, while live `notify.fanout.sendgrid_*_email` keys may be empty;
  - a config-ui audit 401 caused by a bad cookie also counts `ui.auth.events{jwt_rejected}`; a missing cookie does not;
  - agent `agent.degraded` counts `policy_default` / `alert_threshold_default` only on read failure, not on an absent or unparseable value, so degraded=0 does not mean the defaults were never used;
  - the notify subscribers gauge and indicators `register_snapshot_age` report only the last registered instance.

**Deferred follow-ons**:
- **The 14-row "Deferred behavior follow-ups" table** (retained verbatim below) holds the behaviour halves split off under "signals only". `@AC-44 @feature-294` in `docs/sdd/business-rules/platform.feature` checks this table in context.md, so it must survive here. S-25 (sleep on a clean WatchConfig end) is now effectively covered by 295's backoff.
- **NC-1:** Node pool `'error'` handlers / `uncaughtException`. Out of scope, for debt-radar.
- **NC-4:** the agent's `_txn_key` raise is uncaught, so Starlette returns 500 with a traceback. Left uncaught on purpose.
- **Signal registration:** a later feature registers the new series in `produced-signals.tsv` and adds alerts and dashboards (operator decision 3).
- **Pre-existing `e2e/insights/backfills.spec.ts:135-136` `tsc` error:** for `/sdd-qa defect`.
- **Pre-existing config-wiring REPORTED item:** `trading.fill_poller.interval_ms` was read but unseeded as of 2026-11-06. Migration 041 now catalogs it; re-check before acting.
- **Out of scope, for a future feature:**
  - NC-5 client-side gRPC spans and W3C trace propagation;
  - DB-pool saturation gauges.
- **Coarse reason labels, on purpose.** Finer identity and exchange reasons (unknown vs inactive user, `rotateRefreshToken` causes, redirect vs client mismatch) need a query or branch split, which is behaviour-adjacent.
- **Accepted Open Risks:**
  - The ingest "bearer not configured" WARN repeats every 300 s per credential-less source. It is the only log for that state.
  - UI logout has no failure outcome.

## Deferred behavior follow-ups (for debt-radar / later features)

The "signals only" decision splits these findings; only the signal half is in this feature. Each needs its own feature or triage item:

| Report ID | Behavior half deferred |
|---|---|
| S-01 | `flattenAndHalt` halts and pages when `GetPosition` returns an error (distinct from legitimately flat `Qty == 0`) |
| S-02 | `maybeSubmitBracket` raises `emitBracketFailureAlert` when the bracket lookup fails |
| S-03 | `syncAccountPositions` counts a failed ledger emit as not-synced, so the stall watchdog fires |
| S-08 | per-cycle timeout and `GetBars` deadline in the live loop; remove the dead "previous cycle still running" branch |
| S-09 | return 503 instead of 401 when the agent's own mTLS or runtime fault breaks identity validation |
| S-13 | emit `backfill.failed` when `registry.Get` fails, and survive caller cancellation for the terminal event |
| S-14 | fundsignal run ends `partial` when emits fail; mark the run row `failed` on a mid-run exception |
| S-15 | refresh `last_seen_at` on a healthy empty poll; treat "N>0 items, 0 valid" as a source error |
| S-16 | `_resume_job` marks the job `FAILED` and alerts; route bare tasks through `supervision.spawn` |
| S-22 | 503 (not `200 {entries: []}`) when `DATABASE_URL` is unset |
| S-25 | sleep on a clean `WatchConfig` stream end |
| S-26 | add a deadline to the identity audit `AppendEvent` |
| N-02 | exponential backoff on the fixed 2 s retry loops |
| N-04 | skip systemic escalation when the state is already `REDUCE_ONLY` / `HALTED` |

**Ledger entries written**: insights.md (3), fails.md (2) — see the 2026-11-10 entries. The stale-digest and hooksPath duplicates were skipped.

**Runtime-invariant recommendations (→ /context-constitution)**:
- **PLAT (Python):** telemetry `Gauge`s bind on `register()` and are no-ops on the API proxy provider, so register after `init_telemetry()`.
- **PLAT (Node):**
  - `BoundGauge` binds on `register()`;
  - sdk-metrics re-exports the last observed gauge value;
  - AsyncLocalStorage context survives `queueMicrotask` under NodeSDK on Node 24.
- **LEDGER:** node-pg 8.20 error/end semantics; the notifier counts a failure only when `this.client === client`.
- **IDENTITY:** `jwtSecretMissingLogged` fires once per process, with no reset seam.
- **AGENT:** `_CountingChannel` counts only errors that escape the `async with`, and oauth identity failures are double-counted.
- **PORTFOLIO:**
  - EOF counts as a healthy session;
  - the quiet window resets counters, never timing;
  - boot replay inflates `consumer.events{ok}`.
- **MARKETDATA:** the `last_message_age` gauge reports no sample after give-up, with an accepted one-sample stale window.

**Pruned artifacts**: product-spec.md, recon.md, design.md, implementation-spec.md — last present at 2d91b5671335fcce267679b50caa494440205f51.

## Retained verbatim records

Operator decisions and C-16 sign-offs copied verbatim from the pre-archive session log, because durable suites and later features cite "<NNN> context.md" as their provenance. Headings are demoted one level.

### Session 2026-11-07 — pre-merge operator decisions

Operator: davcs86, 2026-11-07. These are recorded before the origin/main-dev merge commit.

- **(i) C-18 reviewer confirmation.** Notify's `describeDeliveryChannels()`, `enabledChannels()` and `isPushEnabled()` are accepted as built.
- **(ii) KEPT loop names.** `signal_prune` (feature 281) and `asset_refresh` (feature 282) are accepted as built. Caveat: `pruneOnce` logs its tick INFO even after a failed prune.
- **(iii) AC-38 / AC-50 supersession (option a: 295 wins, keep the gauge).** Feature 295's shared `watch_core.py` logs every config stream end or failure at WARN and reconnects after a jittered 1-30 s backoff (295 AC-11). It must stay byte-identical across 4 services.
  - Dropped from the indicators watcher: the reconnect-log throttle, the clean-end INFO, the immediate re-issue and the 2 s retry, plus their tests.
  - Kept: `indicators.config.snapshot_age`, now stamped through a `ConfigWatcher._apply` override.
  - AC-38 keeps its gauge clause and AC-50 keeps its portfolio clauses, in the source and promoted feature files. See the implementation-spec.md Deviation Log entry dated 2026-11-07.

_From: Step 14 — test: Analysis telemetry tests [done]_

    - AC-16: `drain_failures{held}` for owner `o-1`, plus `signals` and `watchlist`, and no attribute contains `o-1`.

_From: Session 2026-11-06 — sdd-execute sequential: ALL-DONE PATH_

- C-16 promotion: applied the operator-confirmed `sdd-batch-promotion-plan` above exactly as written. 59 scenarios were promoted verbatim with `@feature-294`: 12 service suites were created at `services/xstockstrat-<svc>/acceptance/signal-map-instrumentation.feature`, and 8 scenarios were appended to `docs/sdd/business-rules/platform.feature`. A line-by-line check found no promoted line that differs from the source `acceptance.feature`.

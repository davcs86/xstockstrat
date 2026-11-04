# Recon: signal-map-instrumentation

**Created**: 2026-11-04
**From**: product-spec.md
**Affected services**: all 12 — trading, portfolio, marketdata, indicators, ingest, analysis, agent, identity, config, ledger, notify, ui (BFF server side only)

> Line numbers are re-grounded against the current tree (HEAD `82e07b6`/`379e083` for docs; code unchanged since `9892b61` except where marked "drift"). Paths are repo-relative. Every item comes from a `codebase-discovery` digest; anything not found is under *Risks / Not-found* (F-04, P-03).

---

## Objective

Add the smallest set of bounded OTel counters, histograms, gauges and log records (and demote or aggregate seven noisy log lines) across all 12 services, so failures on money, auth and data-integrity paths are visible instead of hiding behind an OK RPC status. Signals only: no behavior change, no alert rules, no registry rows, no proto/config/DB change. Source of the 26 gaps, 7 noisy lines and 5 gauges: `docs/repo-surveyor/signal-map-findings.md`.

## Codebase Map

Common finding: **no service has any custom OTel instrument** except analysis's one module-level counter. Every service has exactly one metric, `rpc.server.duration` (agent: `mcp.tool.duration`; ui: `http.server.duration`), plus a log bridge to Loki. Telemetry is a no-op unless `OTEL_ENABLED=true`.

- **`xstockstrat-trading`** (Go)
  - Meter provider `internal/telemetry/otel.go:61-66`; drop views `:86-101` (4 `rpc.server.*` names only); slog bridge `logbridge.go:19-30`.
  - FR-1 sites in `internal/service/trading.go`:
    - `flattenAndHalt` early returns `:2858-2860`, `:2864-2866`, `:2872-2874`, combined `err != nil || position == nil || position.Qty == 0` `:2885-2888`, plus `:2913-2914` (request-hash failure, not in the report); retry exhaustion → `haltAccount` `:2947`; runs on `context.Background()` (`:2995`).
    - `maybeSubmitBracket` lookup failure `:3456-3460`; `createBracket` failure `:3487-3490`.
    - Ledger retry `:3775-3787`; `emitLedgerEvent` `"ledger emit failed"` `:3802-3805` (no `stream_key`).
    - Page-failure `WARN`s `:2846-2848`, `:1992-1994`, `:3442-3444`, `:2233-2246`; also `:3159` and `:2836` (not in the report).
    - `escalateSystemic` `:2218`, sole call `:2208-2209`, no already-`REDUCE_ONLY` check.
    - Broker `SubmitOrder` branches `:712-742` (uncertain `:714-723`, rejected `:724-741`); no invalid-credentials branch at submit (`broker.ErrInvalidCredentials` only at `:2039`, `:2128`, `:3043`).
  - FR-2: six pollers `cmd/server/main.go:117-127`; fill `:1729`, reconciliation `:1924`, position sync `:2341` (keeps `"position sync cycle complete"` `:2360-2361`), credential health `:2735` (tick inside `if intervalMs > 0` `:2748-2750`), watchdog `:2954`, sweeper `order_intent.go:111`. `BrokerType`: `packages/proto/common/v1/common.proto:69-74` (UNSPECIFIED 0, ALPACA 1, IBKR 2, OFFLINE 3).
  - Doc literals to keep: `services/xstockstrat-trading/CLAUDE.md` § Position & Balance Sync Observability (`position sync cycle complete`, `position sync stalled`).
- **`xstockstrat-portfolio`** (Go)
  - Meter `internal/telemetry/otel.go:61-66`, views `:86-101`, bridge `logbridge.go:19-31`; `portfolio_service.go` has no `otel` import.
  - Consumers `cmd/server/main.go:72-77`: order-fill `portfolio_service.go:173-174` (unwrapped), position-sync `:1236-1237` and deregistration `:1248-1249` (`boundedRetry` `:1297-1330`, park `ERROR` `:1325`), bracket `:1462-1463` and balance `:1510-1511` (`ackAlways` `:182`).
  - `consumeEventStream` `:191-208` (fixed 2 s sleep `:205`, graceful `INFO` `:200-201` vs `ERROR` `:202-203`); `streamEventsFrom` `:212-239`, per-event success `:232-237`.
  - `latestQuotesFor` failure `:412-414`; `applyQuotes` `:471-491` (no `ctx`; bare `slog.Warn` `:484`; MarkSource BROKER `:474`, NONE `:477`, QUOTE `:488`); `broadcastSnapshot` skip `:1032-1035`, dropped `InsertSnapshot` `:1047`; offline `pickMark` `offline_valuation.go:280-297` (report's `markFor` is `pickMark`).
- **`xstockstrat-marketdata`** (Go)
  - Meter `internal/telemetry/otel.go:61-66`, views `:86-101`, bridge `logbridge.go:19`.
  - Stream `internal/alpaca/stream.go`: `run` `:166` (drop `WARN` `:196`, give-up `ERROR` `:197-204`), `connectAndRead` `:219` (`conn.Read` `:264`, last-message set point after `:268`); `StreamBars` always nil `:84-86`; dead alert `marketdata_service.go:1529-1534`.
  - Vendor chokepoints: Alpaca `client.go:83` `do()` (8 callers: bars, cash dividends, latest quote/trade, multi variants, assets); FMP `fmp_client.go:235` `getJSON` (`apikey` in URL `:239-240`, typed `stageError`/`statusError` `:289-293`, `ErrorClass` `:347`); Finnhub `finnhub_client.go:110` `getJSON` (`token` in URL); EDGAR `edgar_client.go:75` `get`.
  - `BackfillBars` `marketdata_service.go:1368` (`registry.Get` failure `:1411-1414`, loop `:1416-1433`, terminal event `:1435-1443`); `BackfillFundamentals` `:2152`; warm poller `:1112` (per-symbol `WARN`s `:1152`, `:1173`, existing aggregate `:1179-1180`).
  - FR-2: five pollers `cmd/server/main.go:160-168`; `bar ingest: cycle complete` `:1338`; `classification refresh cycle complete` `classification_service.go:244`; ETF filler `etf_flags.go:112` (queue-driven, no ticker); retention hourly `:1036`.
- **`xstockstrat-indicators`** (Python)
  - `app/telemetry.py:156-159` (no-op), meter provider `:190-194`, lazy histogram `:70`, bridge `:196-204`.
  - FR-12: `app/handlers/servicer.py` pre-run `INFO` `:292-296`, semaphore `:301` (created `:107`), `exit_reason_map` `:313-319`, missing-output branch `:323-337`; `sandbox.py` exit_reason sites `:395, :418-422, :430-434, :444`; watcher `app/config/watcher.py:70-91` (clean end re-loops, no sleep/log; no snapshot timestamp field).
  - `InstantiateTemplate` `servicer.py:663-689`: outcomes ok / NOT_FOUND / PERMISSION_DENIED / INVALID_ARGUMENT / INTERNAL (saga `:691-720`); **no ALREADY_EXISTS**.
- **`xstockstrat-ingest`** (Python)
  - `app/telemetry.py` same shape as indicators.
  - `app/engine/mcp_client_loop.py`: `poll_one_source` `:113` (config error `:125-126`, no-bearer `:129-131`, `:136-138`, fetch `:140`, ok `:155`, all-failed `:156-157`), `run_one_cycle` `:160-181` (error `:174-181`), `run_mcp_client_loop` `:184-198`.
  - `app/extractors/mcp_client.py:27-39` drop branches (no slug; `extract()` takes only `McpClientInput` `:22`).
  - `servicer.py` `_ingest_external_signal` `:984` (rejected `:996-1017`, `:1102-1112`; dedup `:1090-1103`, `:1154-1167`; ingested `:1114-1143`), `_resume_job` `:737-756` (no `try`), `create_task` `:438`, `:734`; `main.py:127`.
  - `InstantiateTemplate` `servicer.py:1586-1609` (UNAVAILABLE, NOT_FOUND, INVALID_ARGUMENT, `_register_conflict` ALREADY_EXISTS/FAILED_PRECONDITION, ok).
- **`xstockstrat-analysis`** (Python)
  - Only existing custom counter: module level `app/engine/live_loop.py:78-81` (`analysis.live_loop.truncated_pairs`, incremented `:462`).
  - Live loop: `run_forever` `:334-347` (dead busy branch `:339-341`, literal `:345`), per-pair handler `:471-479`, summary `:481-489`, drains `:531-533`, `:565-567`, `:593-595`, `_eval_pair` `:701` (`GetBars` no timeout `:702-709`), throttle `:843-845`, `_emit_alert` `:852` (no `try`; failure lands in the pair handler `:477`), `_emit_ledger` swallows `:909-910`.
  - Fundsignal `app/engine/fundsignal_loop.py`: `_tick` `:155-163` (no `exc_info`), `_emit_signal` `:598-628`, status `:311`, `_finish` `:632`.
  - `servicer.py` bare `get_event_loop().create_task(_run())` `:4331`, `:4908`, `:4932`; ticks `:5990`, `:6148/6167`, `:6225`; per-symbol `INFO` `:1894`; `evaluator.py:613`; `InstantiateTemplate` `:3729` (UNAVAILABLE, NOT_FOUND, ALREADY_EXISTS, INTERNAL, ABORTED, success).
  - `app/supervision.py`: only `_on_done` passes `exc_info` (`:31-33`); `retry_until_ok` `:45` and `run_supervised` `:54` do not.
- **`xstockstrat-agent`** (Python)
  - Only metric: lazy histogram `app/tool_metrics.py:35-45`; log bridge `app/telemetry.py:70-78`.
  - `app/main.py` `_authorized` `:147-169`, `handle_mcp` `:201-227` (503 `:220-222`, 401 `:223-225`); `app/auth.py` `validate_bearer_claims` `:57-99` (`mtls.secure_channel` inside the `try` `:76`, bare `except` `:97`); `app/mtls.py:18-26`; `oauth_server.py` token `:242-272`, authorize `:168-171`, callback `:202-204`, `_txn_key` `:38-44`; `tools.py` `_grpc_error_message` `:224-253` (47 call sites), `ingest_signal` post-commit `:669-712`, `_agent_policy` `:2604-2617`.
  - `backend` source: each `client.py` function calls `mtls.secure_channel(<X>_ENDPOINT, "xstockstrat-<svc>")` (`client.py:185, 295, 309, 663, 1101, 1448, 1836`).
- **`xstockstrat-identity`** (Node)
  - `src/telemetry.ts:164-178` NodeSDK, lazy histogram `:85`, `grpcStatusCode` `:56-64`; `src/services/logger.ts:14-30`.
  - `src/grpc/identityServiceImpl.ts`: login `:133-183`, `validateToken` `:189-205`, exchange `:480-520`, refresh `:210-219`, `:527-534`, `rotateRefreshToken` `:317-351`, `auditSafe` `:728-739` (awaited before the reply at `:708`, `:769`, `:830`, `:872`, `:921`); `ledgerAudit.ts:55-65` (no deadline).
- **`xstockstrat-config`** (Node)
  - `src/telemetry.ts:163-177`, lazy histogram `:84`; `src/grpc/configServiceImpl.ts`: `getSecret` `:458-492` (denial `:461`, success `:488`, silent DB catch `:489-491`), `setConfig` denials `:511-528`, silent final catch `:652-654`, `WatchConfig` `call.on('error')` `:400-402`, listener `connectListener` `:188-208`, `dropListener` `:210-221`, `scheduleReconnect` `:223-233` (backoff 1→30 s), `reloadAll` `:264-289`, boot/reconnect shared log `:202`; `src/grpc/authz.ts:168-183` (`hasSecretCallerAuthority`, boolean only).
- **`xstockstrat-ledger`** (Node)
  - `src/services/eventNotifier.ts`: `connect` `:89-128`, handlers `:92-98`, fixed 2000 ms `:51`, `scheduleReconnect` `:130-137` (sets `this.client = null`).
- **`xstockstrat-notify`** (Node)
  - `src/telemetry.ts:86`; `src/fanout/fanout.ts` gates `:57, :65, :76`, channel checks `:94, :97`, send logs `:131-134`, `:174-177`; `webPush.ts` silent returns `:87, :93, :111-113, :122`, startup log `:80`; `src/grpc/notifyServiceImpl.ts` write loop `:81-91` (silent evict `:86-88`), `cancelled`/`error` `:139-143`; startup wiring `src/index.ts:40-42`.
- **`xstockstrat-ui`** (Next.js, server side)
  - `src/lib/bffMetrics.ts:13-23` lazy histogram, `:26-40` attrs, `:43` `withBffMetrics`; `src/lib/serverLog.ts:24-37`; `src/lib/bffShared.ts:113-148` (`createDispatch`; `handler.method.name` is in scope); `src/app/api/auth/{login,refresh,logout,me}/route.ts` (one route set, no per-segment variants; login/refresh bypass middleware); `src/lib/identity.ts:24-26, 32-34`; `src/lib/auth.ts:22-31`; `src/middleware.ts:54-111`; `src/app/config-ui/api/audit/route.ts:24-75`.

## Patterns to REUSE

- **Go instrument** → `otel.Meter("xstockstrat-<svc>")` at the call site against the global provider (no-op when disabled); test with `sdkmetric.NewManualReader()` as in `services/xstockstrat-trading/internal/telemetry/otel_test.go:242` and `.../portfolio/.../otel_test.go:242-243`.
- **Python counter** → the module-level precedent `analysis/app/engine/live_loop.py:78-81`; lazy per-instance creation `agent/app/tool_metrics.py:35-45` when the provider may be installed later. Test with `metric_reader` + `otel_reset` (`ingest|indicators|analysis tests/test_telemetry.py:132-141`, `tests/conftest.py`).
- **Node instrument** → create lazily at call time via `metrics.getMeter(...)`; the API has no proxy provider, so an early meter exports nothing (`identity|config|ledger|notify src/telemetry.ts` comments). Test with `CollectingReader` (`identity|config|notify src/__tests__/telemetry.test.ts:32-48`).
- **UI instrument** → lazy rebinding `bffMetrics.ts:13-23`; `withBffMetrics` for routes; test pattern `src/lib/__tests__/bffMetrics.test.ts` (custom `CollectingReader`, fixtures from `e2e/fixtures/`, C-12).
- **Bounded reason labels** → `fmp.ErrorClass` (`fmp_client.go:347`) and `statusError`/`stageError`; `UNREGISTERED` clamp `tool_metrics.py:8, :51`.
- **Existing cycle records (keep, do not duplicate)** → `position sync cycle complete` (trading), `live_loop: cycle complete` (analysis, registered), `bar ingest: cycle complete` and `classification refresh cycle complete` (marketdata).
- **Reconnect/backoff precedent** → config `scheduleReconnect` (1→30 s) as the model for log-reduction only (retry interval unchanged here).
- **Log capture in tests** → Go `warnRecorder` (`portfolio_quote_deadline_test.go:32-69`, WARN+ only) and the inline `bytes.Buffer` JSON handler (`trading_sync_test.go:18-21`); Python `caplog`; Node `captureStdout` (`config/.../configServiceImpl.test.ts:388-396`).
- **UI fixtures** → `services/xstockstrat-ui/e2e/fixtures/` + `INVENTORY.md` (C-12). Go fixtures `internal/testdata/` (C-13).

## Existing Business Rules (preserve / extend)

Folded from `scenario-recon`; **no CHANGE found**. All 12 services have acceptance suites. `P` = `docs/sdd/business-rules/platform.feature`; `S/<svc>` = `services/xstockstrat-<svc>/acceptance/`.

- **PRESERVE** platform `@AC-2`, `@AC-15`, `@AC-10`, `@AC-11 @feature-274` (P) — `rpc.server.duration` and its attributes, status vectors, resource attributes and log-trace correlation stay; new log records keep `trace_id`.
- **PRESERVE** `@AC-1`/`@AC-2 @feature-171` (P) — no new instrument or log carries `trading_mode`; telemetry init stays non-blocking.
- **PRESERVE** `@AC-8`, `@AC-14`, `@AC-17 @feature-274` (P) — `check-otel-produced-signals.sh` must still exit 0 with the new unregistered series.
- **PRESERVE** `@AC-35`, `@AC-6`, `@AC-36 @feature-224`, `@AC-5 @feature-210`, `@AC-8 @feature-147`, `@AC-6 @feature-283` (P) — no bearer plaintext in logs; system identity and header trio unchanged; the agent gets no new tool.
- **PRESERVE** `@AC-1..@AC-3 @feature-206`, `@AC-1..@AC-9 @feature-267`, `@AC-1..@AC-7 @feature-169` (S/trading) — no new halt, page, or change to order-state `ERROR` logs.
- **PRESERVE** `"batch latest quotes unavailable"` (S/portfolio/fix-book-portfolio-page.feature:26) and `"evt-1 is parked with an error log"` (fix-offline-book-consistency.feature:46) — FR-14's "first failure then every Nth" must never suppress the park `ERROR`.
- **EXTEND** `@AC-8 @feature-255` (S/marketdata) — `marketdata.stream.reconnects{gave_up}` sits beside the closed channel and the `ERROR`; **PRESERVE** `@AC-7 @feature-255` (budget resets after a healthy session) and the listed `WARN` literals (`GetLatestQuotes: cold fetch failed`, `... mark lookup failed`, vendor error with symbol count).
- **PRESERVE** `@AC-1..@AC-4`, `@AC-7`, `@AC-9`, `@AC-10 @feature-259` (S/analysis loop supervision and P&L park/replay), `@AC-2`, `@AC-4`, `@AC-6 @feature-260` (fundsignal accounting and status `partial`), `@AC-1..@AC-4 @feature-156`, `@AC-1/2/7/8/9 @feature-158` — loop timing, run status and counts unchanged; the FR-5 `INFO`→`DEBUG` demotion must not hit the named-warning rules in S/analysis (owner-scope `@feature-262`, watchlist universe, opportunities-read, screener isolation `"exactly one WARN ... names BAD"`, fundamentals-unavailable log).
- **PRESERVE** `@AC-11`, `@AC-5`, `@AC-10 @feature-273`, `@AC-21 @feature-274` (S/agent) — 503 vs 401 and the 10.5 s bound stay; no deadline or message change in `_grpc_error_message`; no label added to `mcp.tool.duration`.
- **PRESERVE** `@AC-13`, `@AC-20 @feature-274` (S/identity) and `@AC-7 @feature-274` (S/config) — no credential, email or secret plaintext in any log; `GetSecret` never logs the value.
- **EXTEND** `@AC-1`, `@AC-9`, `@AC-2`, `@AC-8 @feature-258` (S/config, LISTEN drop recovery) — listener gauges and `config.watch.terminated` sit beside them; **PRESERVE** `@AC-5`, `@AC-10 @feature-258` (S/ledger) and `@AC-4 @feature-274` (stdout logging unchanged).
- **PRESERVE** `@AC-4`, `@AC-6 @feature-020` (S/notify) — a Slack timeout never delays the stream; fan-out errors log `WARN` with alert id and channel; no `category`/`sourceService` label.
- **EXTEND** `@AC-16 @feature-274` (S/ui) — login, refresh and audit join `http.server.duration`; streams stay excluded. **PRESERVE** the 401-redirect rule, agent-health 401 and the audit route's generic 500.
- **Not pinned by any suite** (design must not assume a guarantee): the literal `live_loop: cycle complete` (only FR-15b protects it), `position sync cycle complete`, `bar ingest: cycle complete`, source-health derivation, and metric label cardinality (FR-15a has no durable `@AC`).
- **Unread, treat as PRESERVE-by-default** and re-grep before approval: indicators sandbox suites, most of S/ui, S/ingest/mcp-client-signal-source, S/notify/pwa-notifications, ledger pagination.

## Dependencies

- Proto/RPC: none.
- Migration: none.
- Config keys: none new (`OTEL_ENABLED` env gate only). `scripts/check-otel-produced-signals.sh`: new series with no alert or dashboard referencing them pass (registry rows only require existing producer literals; OQ3 confirmed by reading the script).
- Inter-service edges: none new.
- New env vars / ports: none.

## Risks / Not-found

- **R1 — FR-2 has no uniform "tick".** Portfolio stream consumers sit in `Recv()` with no batch boundary (per-event `streamEventsFrom:232-237` or per-session `:227`); warm poller has many `continue` exits and no single success point; ETF filler is queue-driven (no idle heartbeat); retention is a hourly no-op; pnl consumer is per-event (`pnl_pattern_consumer.py:189`); credential-health must write nothing while paused (`interval ≤ 0`); watchdog "tick ok" means scan ok, not flatten ok. The spec's "per successful tick" needs a per-loop definition or a throttle.
- **R2 — Volume.** Per-tick `INFO` for the 5 s pollers (trading fill, watchdog, sweeper) ≈ 17k records/day each; operator accepted, but it sits against FR-14.
- **R3 — No `trace_id` on poller records.** Poller contexts have no span (`trading main.go:41` `Background`; `flattenAndHalt` on `context.Background()` `:2995`), so tick and background-loop records carry none.
- **R4 — `alert_failed` is indistinguishable from an evaluation error** in the live loop: `_emit_alert` has no `try`, a failure lands in the pair handler and the transition retries next cycle. Recording the outcome needs a minimal wrap at the call site without changing the retry.
- **R5 — Extractor has no slug and returns no drop count** (`McpClientInput` carries only items). Logging the slug or counting per source needs a signature or input change.
- **R6 — Agent `backend` label** has no source on the error; the natural seam is the `secure_channel(<ENDPOINT>, "xstockstrat-<svc>")` target name in `client.py`, not the 47 call sites.
- **R7 — Go `applyQuotes`/`pickMark` take no `ctx`**, so the aggregated "no usable price" log cannot carry `trace_id` without a signature change (platform `@AC-11 @feature-274`).
- **R8 — `invalid_credentials` at `SubmitOrder` is not derivable today** (no branch at `trading.go:712-742`); it would need `errors.Is(err, broker.ErrInvalidCredentials)` in the reject path.
- **R9 — `GetSecret` denial reason** needs a classifier in `authz.ts` (`hasSecretCallerAuthority` returns a boolean from one `.some()`); this edits a security gate, even though behavior is unchanged.
- **R10 — Cause granularity is limited by the data.** Identity "unknown" vs "inactive" user and `rotateRefreshToken` causes share one query; exchange "redirect" vs "client" mismatch share one branch; splitting needs a new query or branch (a behavior-adjacent change).
- **R11 — Pinned log lines.** Suites pin level or text of: `"batch latest quotes unavailable"`, the park `ERROR` with the event id, `"GetLatestQuotes: cold fetch failed"`, `"... mark lookup failed"`, analysis named warnings, `"fundamentals unavailable"`. N-03/N-06/N-07 and FR-14 must grep the live literal before changing a level or aggregating.
- **R12 — Test-seam gaps.** Trading flatten harness (`trading_flatten_rejection_test.go:88`) cannot force `GetPosition` error, `Qty == 0`, missing broker or offline; Go `warnRecorder` drops below `WARN` (an `INFO` tick assertion needs a new recorder); Node has no shared log-capture helper; analysis module-level counter rebinding after `otel_reset` is unverified (`live_loop.py:78-81` is not read by any test); UI `BffSegment` has no `auth` member (`bffMetrics.ts:7`).
- **R13 — Convention gaps.** UI log key is camelCase `traceId` (`audit/route.ts:70`), the observability doc says `trace_id`; there is no snake_case `trace_id` in `ui/src`. Config boot and reconnect share one log line (`configServiceImpl.ts:202`).
- **R14 — Drift vs the report.** `markFor` → `pickMark` (`offline_valuation.go:280`); the report's FR-12 outcome vocabulary (ALREADY_EXISTS) does not exist in indicators; agent policy-read line moved `:1716` → `:1713`.
- **R15 — Overlap.**
  - `215-block-fundamentals-strategy-on-etf` is in-progress with steps 1-25 done, so its guard module and deny-entry are already in this tree. Regions it owns: `live_loop.py:733-760`, `:876-891`, `servicer.py` RunBacktest refusal/derivation paths, `evaluator.py` shared helpers. 294's sites are disjoint.
  - `281-signal-watchlist-expiry-pruning` (implementation-ready) edits portfolio `emitEvent`/`main.go:77`, agent `tools.py:692` region, config `SCALAR_BOUNDS_REGISTRY` (`:103-148`): textual rebase risk only. It adds a prune-loop tick log in portfolio (`"signal watchlist prune tick"`): coordinate the record shape.
  - `243-fix-sandbox-seed-keys` hotfix #1263 touches indicators `servicer.py:282-285`, just above 294's FR-12 sites.
- **R16 — DRY guard.** ~30 sites repeat a tick log call; jscpd (`docs/patterns/dry-guard-rail.md`) may flag it per language (spec OQ2).
- **Resolved here:** NC-2 yes (status recorded for `callback({code})`, `identity telemetry.export.test.ts:267-305`); NC-4 uncaught — `_txn_key` raises, Starlette returns 500 with a traceback, nothing agent-side, no boot check; NC-11 yes — 5 admin handlers await `auditSafe` before replying; NC-12 context relies on NodeSDK's default AsyncLocalStorage across `queueMicrotask` (SDK source not opened); OQ3 yes.
- **Not found:** any custom instrument outside analysis's counter; `otelhttp` usage; an "enabled channels" startup log in notify; a snapshot-age field in the indicators watcher; a tick-success marker in any loop other than the three cycle records; `pool.on('error')`/`uncaughtException` in the four Node services' runtime code (NC-1, out of scope).

## Recommended Scope

Advisory step boundaries (SEV-2 first, one language convention per step so each commit is reviewable):

1. **Convention step** — settle the instrument/log naming and the `loop tick ok` record shape (R1, R2) in the telemetry modules; no behavior.
2. **Trading** (S-01, S-02, S-03, M-04, N-04 signal half, trading loops) — needs the flatten fake (R12).
3. **Portfolio** (S-05, S-06, M-02, N-03) and **Marketdata** (S-07, S-12, S-13, N-07).
4. **Analysis** (S-08, S-14, S-16 signal half, S-24, N-06) — after confirming 215's regions are untouched (R15).
5. **Agent** (S-09, S-17, M-05), **Identity** (S-10, S-26), **Config + Ledger** (S-11, S-20, S-23), **Notify** (S-19), **UI** (S-18, S-22, M-03).
6. **SEV-3 tail**: ingest (S-15, S-16, N-01), indicators (S-21, S-25, N-05), gauges M-01, FR-14 log reduction, loop records for the remaining pollers.
7. **Test/verify step per service** (C-08) with the coverage thresholds; final step runs the OTel guard script and the per-language lint/test commands.

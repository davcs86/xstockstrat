# Product Spec: signal-map-instrumentation

**Created**: 2026-11-04

---

## Problem Statement

Most failures on money, auth and data-integrity paths end as a `WARN` line, or as nothing, while the RPC still returns OK. The per-RPC latency histogram cannot see them, so an operator cannot tell a dead market-data feed, a stalled ledger consumer or a skipped risk check from a healthy idle service. The signal-map survey (`docs/repo-surveyor/signal-map-findings.md`, PR #1427; the survey ran against code at commit `9892b61` and `da6ca69` is the PR commit that added the report — cited line numbers are from `9892b61`) located 26 such blind spots, 7 over-noisy log lines and 5 missing feature gauges across all 12 services. This feature closes them with the smallest set of bounded counters, gauges, histograms and log fixes, on the OpenTelemetry stack each runtime already has.

## User Story

As the platform operator, I want the instrumentation gaps, noisy signals and feature gauges from `docs/repo-surveyor/signal-map-findings.md` implemented as one feature, so that failures on money, auth and data-integrity paths become diagnosable from metrics and logs instead of being invisible behind an OK RPC status.

## Operator decisions (2026-11-04)

1. **Scope: everything in the report.** Gaps S-01…S-26 (11 SEV-2, 15 SEV-3), noisy signals N-01…N-07, gauges M-01…M-05. The implementation spec orders steps SEV-2 first.
2. **Signals only.** Counters, gauges, histograms, spans and log-level / log-content fixes. **No behavior change**: no new halts or pages, no status-code remaps (503 vs 401), no timeouts, no status or health-semantics changes, no job-state changes, no dedupe or backoff logic. A finding whose fix needs a behavior change is split: its signal half is in scope, its behavior half is a deferred follow-up (FR-16).
3. **Instrument only.** No alert rules, no dashboards, no `packages/otel/produced-signals.tsv` rows. A later feature registers and alerts on the new series.
4. **Delivery: `/sdd-execute sequential`, on the current branch.** One commit per step directly on `ccr-b4aace27-zvuaby` (no `feature/signal-map-instrumentation` branch is created), and PR #1427 into `main-dev` is the single integration PR. A `ccr-*` branch is squash-merged into `main-dev`.
5. **Naming: dotted OTel names** (`mcp.tool.duration` style); the exporter adds the unit and `_total` suffixes.
6. **Loop liveness: one log record per successful tick** (FR-2), not a gauge. The operator accepted the Loki volume this implies for the 5 s pollers.
7. **CI behavior of unregistered series: agreed.** The assumption that new series with no alert or dashboard referencing them pass `scripts/check-otel-produced-signals.sh` is accepted; `/sdd-design` still runs the script once to confirm it.

## Functional Requirements

Report anchors are in brackets. Instrument names below are OTel dotted names (operator decision 5; the exporter adds `_total` / `_milliseconds`); the design phase fixes only the exact units and the `_total` handling for counters (Open Question 1).

FR-1. **Trading outcome counters** [S-01, S-02, S-03, M-04, N-04]. Add:
  - `trading.flatten.outcome{outcome}` for every exit of `flattenAndHalt`, with the lookup-error branch distinct from the legitimately-flat branch;
  - `trading.bracket.outcome{outcome}` including a lookup-failed value;
  - `trading.ledger_emit{event_type, outcome}` and `trading.alert_emit{category, outcome}` at the fail-soft emit and page sites, plus `stream_key` on the existing "ledger emit failed" log;
  - `trading.order_submit{broker_type, outcome}` at the broker `SubmitOrder` result branches;
  - `trading.escalation.systemic` (unlabelled counter) incremented each time `escalateSystemic` runs, so a repeat while the threshold holds is countable (the dedupe itself is deferred).
  Log-level fixes only: the lookup-error flatten branch logs at `ERROR`.

FR-2. **Loop liveness log record** [S-04]. Each background loop writes exactly one structured `INFO` record per successful tick, with the fixed message `loop tick ok` and attributes `loop` (a fixed name from a bounded set, ≤ 8 per service; trading has 6 poller names, the position-sync loop being one of them) and `duration_ms`. There is **no gauge and no shared helper**: staleness is read from Loki, and the record is written inline at each loop's tick-success point. A loop that already writes one cycle record per tick keeps it as its record and does not write a second: trading position sync (`position sync cycle complete`), the analysis live loop (`live_loop: cycle complete`, text unchanged), and marketdata bar ingest (`bar ingest: cycle complete`). Sites: the six trading pollers, the five marketdata pollers, the ingest mcp_client loop, the analysis supervised loops and live loop, and the portfolio consumers (one record per successfully processed event batch, not per event). It does not change loop timing, ordering or error handling, and a failed tick writes no `loop tick ok` record.

FR-3. **Portfolio** [S-05, S-06, M-02, N-03]. Add `portfolio.consumer.events{consumer, outcome}`, `portfolio.marketdata_fetch{op, outcome}`, `portfolio.snapshot{outcome}` and `portfolio.mark_source{mark_source, path}`. Log the `InsertSnapshot` error that is dropped today. Collapse the per-position "latest quote has no usable price" `WARN` into one aggregated log per call that keeps `trace_id`.

FR-4. **Marketdata** [S-07, S-12, S-13, N-07]. Add:
  - `marketdata.stream.last_message_age` gauge and `marketdata.stream.reconnects{result}` (including a `gave_up` value);
  - `marketdata.vendor.requests{vendor, op, outcome}` and `marketdata.vendor.request.duration{vendor, op}` at the four vendor chokepoints (Alpaca `do()`, FMP, Finnhub, EDGAR), with manual recording and **no `otelhttp` wrapper** on the FMP client;
  - `marketdata.backfill.symbols{kind, outcome}`;
  - aggregated per-cycle logs for the warm-poller cache-insert failures.
  No read deadline, no change to reconnect or backfill return semantics.

FR-5. **Analysis** [S-08, S-14, S-16 (signal half), S-24, N-06]. Add live-loop counters `analysis.live_loop.pairs{outcome}`, `analysis.live_loop.drain_failures{source}`, `analysis.live_loop.triggers{trigger, outcome}` and an unlabelled cycle-duration histogram; `analysis.fundsignal.signals{outcome}` plus one summary `INFO` per run; `analysis.opportunity.recompute{outcome}`. Pass `exc_info` at the live-loop, fundsignal and supervised-tick error logs. Demote the per-component and per-symbol `INFO` in `evaluator.py` and `servicer.py` to `DEBUG`. The registered `live_loop: cycle complete` literal and its text are **unchanged**, and not gated on errors.

FR-6. **Agent** [S-09, S-17, M-05]. Add `mcp.auth.rejected{reason}`, `oauth.requests{grant_type, outcome}`, `oauth.txn.rejected{reason}`, `agent.backend.rpc_errors{backend, grpc_code}` (recorded inside `_grpc_error_message`) and `agent.degraded{kind}`. Add `warning` logs at the swallowed OAuth and auth-path exceptions carrying the gRPC code or exception class, never the code, token or state. Add the two onboarding log lines (token-exchange success, first successful tool call) with `user_id` as a log field. Do not add a label to `mcp.tool.duration`.

FR-7. **Identity** [S-10, S-26]. Add `identity.login.failures{reason}`, `identity.token.validate_failures{reason}`, `identity.oauth.exchange_failures{reason}`, `identity.refresh.rejections{kind}`, `identity.audit.failures{event_type}` and `identity.audit.append.duration`. `validateToken` gets counters only, no per-call log; only the `secret_missing` reason logs, at `ERROR`. The audit `AppendEvent` gets **no** new deadline.

FR-8. **Config and ledger** [S-11, S-20, S-23]. Enrich the `GetSecret` and `SetConfig` denial logs with a truncated caller id and a `reason` enum, add an `INFO` audit line on a successful `GetSecret` (caller, namespace, key name, `found`, **never the value**), and add listener health instruments with fixed names: `ledger.notify.listener_up` (gauge, 0/1), `ledger.notify.listener_reconnects` (counter), `config.listener_up` (gauge, 0/1), `config.listener_reconnects` (counter) and `config.last_reload_timestamp` (gauge, seconds). Log the previously silent `WatchConfig` `error` handler and `GetSecret` DB error with a `config.watch.terminated{reason}` counter.

FR-9. **Ingest** [S-15, S-16 (signal half), N-01]. Add `ingest.source.poll{outcome}` and a poll-duration histogram, `ingest.signal.outcome{path, outcome}` and a dropped-item counter `{stage, reason}`; log the soft-degrade credential branches; keep the source slug in logs, never in a label. Add an `ERROR` log and `ingest.backfill.jobs{outcome}` around `_resume_job` that logs and **re-raises**. Replace the per-item dedup `INFO` with the outcome counter (keep a `DEBUG` log), and log truncated items plus the slug in the extractor. Source-health derivation and task supervision are unchanged.

FR-10. **Notify** [S-19]. Add `notify.delivery{channel, outcome}`, `notify.stream.subscribers` and `notify.stream.evictions{reason}`, and log the enabled channels once at startup. `category` and `sourceService` are never labels.

FR-11. **UI BFF** [S-18, S-22, M-03]. Add `ui.auth.events{event}` (and `jwt_rejected` reasons), wrap the login and refresh routes and the config-ui audit route in the existing BFF metric, add `ui.bff.requests{rpc_service, rpc_method, outcome}` as a separate bucket-free counter, and add `serverLog` entries (Connect code, never the token) for login, refresh and the audit 401/403 and missing-`DATABASE_URL` cases. Response bodies and status codes are unchanged.

FR-12. **Indicators** [S-21, S-25, N-05]. Add `indicators.sandbox.executions{exit_reason}`, `indicators.sandbox.duration{exit_reason}`, `indicators.sandbox.queue_wait` and a `warning` log on a non-success run; drop the pre-run `INFO` (`servicer.py:292-296`); log when the config `WatchConfig` stream ends cleanly and add `indicators.config.snapshot_age`. The watcher's sleep behavior is unchanged.

FR-13. **Template catalog** [M-01]. Add `template.instantiate{service, outcome}` at the analysis, indicators and ingest `InstantiateTemplate` handlers.

FR-14. **Log-volume reduction** [N-02]. In the ledger notifier, the indicators config watcher and the portfolio consumers, log the first failure and then every Nth, and demote graceful GOAWAY reconnect logs. The retry interval is **not** changed.

FR-15. **Cross-cutting constraints** (binding on every FR).
  - (a) Labels are fixed bounded enums only. Never `user_id`, `email`, `client_id`, `account_id`, `order_id`, `intent_id`, `symbol`, `strategy_id`, `stream_key`, signal-source `slug`, request-supplied `category`, `GetSecret` `key` or the `x-internal-caller` value.
  - (b) `rpc.server.duration`, `mcp.tool.duration`, `http.server.duration`, their attribute keys and the `live_loop: cycle complete` literal are not renamed or removed.
  - (c) No secret value, token, password or hash in any log or label.
  - (d) New signals use only the OTel SDK and logging already present per language; no new dependency.
  - (e) Telemetry stays non-fatal and a no-op when `OTEL_ENABLED` is not `true`.
  - (f) Go server metric drop views still cover any new `rpc.client.*` instrument.
  - (g) Instrument names are dotted OTel names.
  - (h) Trading domain: the `broker_type` label uses the bounded `BrokerType` enum names for both `ALPACA` and `IBKR` (and `OFFLINE` where the code path exists), so IBKR is in scope on equal terms; the new counters behave identically in paper and live and are testable in compose; order placement, fill detection and `PARTIALLY_FILLED` / `FILLED` handling are unaffected.

FR-16. **Deferred follow-ups recorded.** The behavior halves are listed in `context.md` § Deferred behavior follow-ups for debt-radar. They are not implemented here.

## Out of Scope

- Any behavior change: halt or page on a flatten lookup error (S-01), alert on a bracket lookup failure (S-02), live-loop or other timeouts (S-08), 503-instead-of-401 on an agent mTLS fault (S-09), a terminal backfill event that survives caller cancellation (S-13), run `partial` or row `failed` status (S-14), source-health refresh and "all items malformed is an error" (S-15), `_resume_job` marking the job `FAILED` and `supervision.spawn` for bare tasks (S-16), the audit-call deadline (S-26), 503 on a missing `DATABASE_URL` (S-22), config-watcher sleep on clean end (S-25), exponential backoff (N-02), systemic-escalation dedupe (N-04), and the heartbeat counting a failed ledger emit as not-synced (S-03).
- Alert rules, dashboards and `produced-signals.tsv` rows.
- A shared cross-language telemetry library.
- Client-side gRPC spans and W3C trace propagation (Needs-confirmation NC-5 in the report), and DB pool saturation gauges.
- Any proto, config-key or database change.

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-trading` — FR-1, FR-2, FR-14 (flatten / bracket / emit / submit counters, six poller gauges)
- `xstockstrat-portfolio` — FR-2, FR-3, FR-14
- `xstockstrat-marketdata` — FR-2, FR-4
- `xstockstrat-indicators` — FR-12, FR-13, FR-14
- `xstockstrat-ingest` — FR-2, FR-9, FR-13
- `xstockstrat-analysis` — FR-2, FR-5, FR-13
- `xstockstrat-agent` — FR-6
- `xstockstrat-identity` — FR-7
- `xstockstrat-config` — FR-8
- `xstockstrat-ledger` — FR-8, FR-14
- `xstockstrat-notify` — FR-10
- `xstockstrat-ui` — FR-11 (BFF server side only)

## Consumer Surface(s)

_Constitution **C-14**._ The end-user-reachable surface(s) this capability is consumed through.

- [ ] **UI** — none. `xstockstrat-ui` changes are BFF server-side metrics and logs only (`/api/auth/*`, `/config-ui/api/audit`, the Connect dispatcher); no page, route, control or response shape changes, so nothing is added to `PLATFORM_SUBNAV`.
- [ ] **Agent** — none. `xstockstrat-agent` gains metrics and log lines only; no MCP tool is added, removed or re-shaped, so `docs/runbooks/mcp-tools.md` and the tool-count inventory are unaffected.
- [x] **None** — internal/platform-only. The new series and logs are consumed by operators through Grafana Cloud (Mimir / Loki); there is no end-user surface, and the later feature that registers the series and alerts on them is the consumer.

## Proto Contract Changes

- [x] No proto changes required

## Config Key Changes

- [x] No new config keys (telemetry is gated by the existing `OTEL_ENABLED` env var; nothing is read from `WatchConfig`)

## Database Changes

- [x] No schema changes

## Feature Workflow Notes

Branch: the current harness branch `ccr-b4aace27-zvuaby` (based on `main-dev`; no `feature/<slug>` branch is created — operator decision 4). PR #1427 is the integration PR.
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (non-breaking proto or config change) — one per affected service (12), no proto or config change
- [ ] 2 service owners + platform lead (breaking proto change) — not applicable
- [ ] DBA review + service owner (schema migration) — not applicable

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`) — the single source of acceptance truth (Constitution
**C-15**). Each `FR-N` above is covered by ≥1 tagged scenario there.

## Known traps (Ledger, `fails.md`)

- **Ungrounded premises ship.** `033-phase7-observability` (2026-08-19) shipped a spec whose FR asserted a wiring fact that was false. Every "no signal at X" in this spec is an *absence* claim: the implementation spec must re-grep each cited site against the current `main-dev` (the report's line numbers are from commit `da6ca69` and will drift) and record the live `path:line`.
- **Absence and scope-reduction claims need a consumer grep.** `143-daily-bars-only` (2026-08-16) shows a "just shrink it" claim that a grep of the consumers disproved. Before demoting or removing any log line (N-01…N-07), grep Loki-facing consumers in the repo (`packages/otel/alerts`, `packages/otel/dashboards`, `produced-signals.tsv`); Grafana-side rules outside the repo are Open Question 4.

## Open Questions

- [x] 1. **Instrument naming convention — RESOLVED 2026-11-04: dotted OTel names.** Remaining for design: exact units per instrument and whether counters carry the `_total` suffix themselves (exporter-added today), so the later registry feature can match them.
- [x] 2. **Loop liveness form — RESOLVED 2026-11-04: one log record per successful tick, no gauge, no helper** (FR-2). Remaining for design: the record shape must stay identical across Go `slog`, Python `logging` and Node `winston` so one LogQL filter works, and the DRY guard rail (`docs/patterns/dry-guard-rail.md`) must accept the repeated log call. Volume: the 5 s pollers each write ~17k records a day.
- [x] 3. **CI behavior with unregistered series — assumption AGREED 2026-11-04.** `scripts/check-otel-produced-signals.sh` fails on an alert or dashboard querying an unregistered series. `/sdd-design` runs the script once on a scratch instrument to confirm that new series with no alert or dashboard referencing them pass.
- [x] 4. **Grafana-side rules outside the repo — RESOLVED 2026-11-04 (spec-review closure):** a demoted log line keeps its existing text and moves to `DEBUG`; no log text is reworded. A line that is replaced by a counter (N-01 dedup, N-05 pre-run, N-06 per-component) keeps its old text at `DEBUG`, so a Grafana rule matching the text sees no change at the default INFO level other than silence, and no literal is invented.
- [x] 5. **Report Needs-confirmation items that change a FR's shape — RESOLVED 2026-11-04 (spec-review closure):** NC-1 (Node pool `'error'` handlers) is **out of scope** (behavior-adjacent, excluded by the signals-only decision; it stays a debt-radar follow-up). NC-2 (does the Node status-code metric record `callback({code})`?) and NC-4 (is the agent `_txn_key` exception logged?) are **settled in `/sdd-design` Phase 0 by reading the code**; their answers can only change an AC's expected log or status wording, not FR scope.
- [x] 6. **Feature branch vs the harness branch — RESOLVED 2026-11-04: sequential on the current branch `ccr-b4aace27-zvuaby`.** Remaining for `/sdd-execute`: its sequential mode assumes `feature/<slug>`; record the branch override as a deviation in `context.md` and confirm the skill accepts the current branch. PR #1427 now carries the survey report, the SDD artifacts and the implementation commits, so its description must be rewritten before it is merged.

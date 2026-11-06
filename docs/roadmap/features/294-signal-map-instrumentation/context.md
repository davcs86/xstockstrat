# Context: signal-map-instrumentation

**Feature**: `docs/roadmap/features/294-signal-map-instrumentation/feature.md`
**Product Spec**: `docs/roadmap/features/294-signal-map-instrumentation/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/294-signal-map-instrumentation/implementation-spec.md`

---

## Session 2026-11-04 — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from user story.
- Number `294` reserved on `origin` by `scripts/sdd-allocate-feature-number.sh` (cursor ref `sdd/feature-cursor`).
- Source of truth for evidence: `docs/repo-surveyor/signal-map-findings.md` (PR #1427; `da6ca69` is the PR commit that added it). Line numbers in it are as of commit `9892b61`, the code it surveyed; the implementation spec must re-ground them.
- **Operator decisions (2026-11-04)**, taken via an up-front question gate before this story: scope = everything, SEV-2 first; signals only (no behavior change); instrument only (no alerts, dashboards or registry rows); delivery = `/sdd-execute sequential`, one integration PR. The operator also stated that these are not bugs and must be worked as a single effort, so this feature is on the SDD path and not on `docs/runbooks/bug-triage.md`.
- Ledger read (`fails.md`): `033-phase7-observability` and `143-daily-bars-only` entries recorded as Known traps in the product spec.

## Session 2026-11-04 — operator answers to the open questions

- **OQ1 naming:** dotted OTel names. Resolved.
- **OQ2 loop liveness:** "one log record per loop" — confirmed through a follow-up question as **one structured `INFO` record per successful tick, no gauge, no helper**. This replaces the `<service>.loop.last_success_timestamp` gauge in FR-2, AC-6 and AC-7. Loops that already write one cycle record per tick (trading position sync, analysis live loop with its registered literal, marketdata bar ingest) keep that record and do not write a second.
- **OQ3 CI guard:** assumption agreed; `/sdd-design` confirms it by running the script once.
- **OQ6 branch:** **sequential on the current branch `ccr-b4aace27-zvuaby`** (deviation from `/sdd-execute sequential`, which assumes `feature/<slug>`). PR #1427 becomes the single integration PR; its description needs rewriting before merge because it will carry the report, the SDD artifacts and the implementation.
- Trade-off the operator accepted: per-tick records for the 5 s trading pollers are about 17k Loki records per day per loop. This sits against FR-14 and the N-* demotions, which reduce log volume elsewhere.

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

## Open items carried into /sdd-review and /sdd-design

- See product-spec `## Open Questions` 1–6. Question 6 (feature branch name versus the harness branch `ccr-b4aace27-zvuaby`, with PR #1427 open) must be settled before `/sdd-execute`.

## Session 2026-11-04 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- First criteria pass **FAILED** on criterion 9 only (Open Questions 3, 4, 5 unticked). Fixed in the spec: OQ3 ticked (agreed), OQ4 closed ("keep old text at DEBUG, no rewording"), OQ5 closed (NC-1 out of scope; NC-2 and NC-4 settled in design Phase 0). Re-review: **PASS WITH WARNINGS**, no blockers, no Floor breach.
- Warnings addressed: named `trading.escalation.systemic` and the five config/ledger listener instruments; loop-name cap aligned to 8 in FR-2 and AC-7; trading-domain statement FR-15(h) (IBKR on equal terms, paper/live parity, fill handling unaffected); commit reference reconciled (`9892b61` = code surveyed, `da6ca69` = PR commit); stale Affected Services line fixed; FR-12 changed from "drop" to "demote to DEBUG, text unchanged"; AC-45…AC-56 appended for requirement sub-bullets that had no scenario (56 scenarios total, FR-1…FR-16 all covered).
- Demoted-duplicate check: 22 demoted features exist; none is a re-attempt (106 market-data freshness and 108 trading-safety dashboard SLOs are adjacent in spirit only). Treated as a new feature.
- Overlap findings (WARN level only, no proto/config/migration/instrument clash):
  - `215-block-fundamentals-strategy-on-etf` (in-progress): analysis `servicer.py`, `live_loop.py`, `evaluator.py`; 215 also moves fundamentals predicates into `app/services/fundamentals_guard.py`. Highest risk; 215 lands first per `merge-order.md:322`.
  - `281-signal-watchlist-expiry-pruning` (implementation-ready): agent `tools.py`, portfolio `portfolio_service.go` + `cmd/server/main.go`, config `configServiceImpl.ts`.
  - `243-fix-sandbox-seed-keys` (in-progress): indicators `servicer.py` (`_clamp_override`).
  - No `merge-order.md` row was written (no FAIL-level overlap). The impl-spec step ordering must put the 215-touched analysis steps after 215 lands, or rebase; re-run `/sdd-review impl-spec` for the Mode B overlap scan.
- Recommended design depth: **full** (12 affected services; overlap warnings).
- Operator branch override (recorded per review note): execute runs `sequential` on `ccr-b4aace27-zvuaby`, not `feature/<slug>`; PR #1427 is the integration PR. `/sdd-execute` must log this as a deviation.

## Session 2026-11-04 — sdd-design (in progress; checkpoint)

- Phase 0 Recon: wrote recon.md (12 services; reuse patterns: per-provider rebinding accessors in each service's existing telemetry module, `bffMetrics.ts` lazy rebind, `CollectingReader`/`metric_reader`/`ManualReader` test readers; no CHANGE to any existing business rule).
- Phase 1 Grilling: rounds 1-5 run (full mode). Floor status: clean in every round. Round 5 adversary verdict: APPROVE with fixes (no wrong citations among those checked; five acceptance scenarios still drifted from code: AC-4, AC-9, AC-12, AC-17, AC-19).
- Operator decisions taken at the gates (binding for design.md):
  - Tick rule = body ran to completion and was not a whole-tick failure, defined per loop (denominator = items that reached the fallible call); gated-off loops still write `loop tick ok` with `state`; event-driven consumers use a 60 s leading-edge throttle.
  - Acceptance scenarios amended in place (same IDs) with a note per change; new scenarios appended (AC-57, AC-58).
  - Agent backend label counted in the `mtls.secure_channel` wrapper `__aexit__`.
  - Portfolio recovery: `onHealthy` callback acknowledged ("stream resumed", only when >= 2 closes of one kind preceded it); counters also reset after a 10-minute quiet window.
  - Per-service `logTickOK` + loop-name constants (the earlier "no helper" applies to the gauge).
  - Orchestrator rulings: trading label key `category` -> `alert_kind`; AC-36 uses the fully-qualified `xstockstrat.analysis.v1.AnalysisService`; `observeQuotePass(ctx, ...)` replaces the per-position `slog.Warn` at portfolio_service.go:484 (applyQuotes signature unchanged).
- **Operator override (2026-11-04, explicit):** at the round-5 gate (the skill's hard cap of 5 rounds) the operator chose "override cap, run another round". The cap is a skill HARD CONSTRAINT, not a Floor (F-*) item, so it is overridable with sign-off recorded here. Round 6 is scoped narrowly: apply the nine round-5 fixes, produce the complete amended `acceptance.feature` and verify every scenario's labels/counts against the code. No further rounds beyond 6 without a new explicit sign-off.
- Status remains `spec-ready` until the design is approved.

## Session 2026-11-04 — sdd-design (approved)

- **Design approved** by the operator at the final gate (round 6, the last authorised round; no round 7): "Approve, apply listed fixes". Status `spec-ready` → `design-approved`. Artifacts: `recon.md`, `design.md`, amended `acceptance.feature` (59 scenarios).
- Round 6: the proposer re-verified every AC against code and fixed 13 mismatches; the round-6 adversary (APPROVE WITH LISTED FIXES, no Floor breach) found 7 more AC mismatches and 3 design-text gaps. All were applied in `design.md` and `acceptance.feature`:
  - AC-4: syncPositions heartbeat clause moved to new **AC-59**; AC-6 diff check reworded; AC-11 runs inside a span with no offline accounts; AC-12 gets an injected clock (`now` on the stream manager) and no-sample-after-give-up; AC-18 and AC-51 Givens now trigger the asserted logs; AC-28 gets a new WARN literal in ingest; AC-58 Given adds "no event between closes".
  - Design text: `_emit_counts` aliased to a local `counts` so the RPC path's summary is correct; ledger FR-14 uses one counter with the error handler counting only when `this.client === client`; step 5 Files now include `app/supervision.py` and `app/services/evaluator.py`; Node test files named in steps 7-10.
- **Amended acceptance scenarios (C-15, IDs stable, same-ID in-place; each amendment recorded here):** AC-1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13, 17, 18, 19, 20, 21, 23, 25, 26, 28, 31, 34, 36, 40, 45, 46, 47, 50, 51, 52, 53, 54, 56 (labels, counts and Given preconditions aligned to the 1.4 vocabulary and the code). **New:** AC-57 (NotFound lookup counts as flat), AC-58 (portfolio quiet-window reset), AC-59 (position-sync heartbeat still counts a failed ledger emit).
- Operator-acknowledged design choices: portfolio `onHealthy` callback ("stream resumed", written only when 2 or more closes of one kind preceded); counters also reset after a 10-minute quiet window; `observeQuotePass` carries two duties (mark-source rate + unusable-quote aggregate) as an accepted trade-off.
- Branch deviation to log at `/sdd-execute`: sequential on `ccr-b4aace27-zvuaby`, integration PR #1427; its description must be rewritten before merge.
- Next: `/sdd-spec signal-map-instrumentation`.

## Session 2026-11-04 — sdd-spec

- Generated implementation-spec.md with 30 steps (14 service, 15 test, 1 docs). Status: design-approved → implementation-ready. All 59 `@AC-*` scenarios are covered by a `**Covers**` line (checked by script).
- Key codebase findings (re-grepped at HEAD `e1cf809`; the tree matches the design's grounding, no drift found at the sites opened):
  - `observed(label, h)` in portfolio does **not** exist (`grep` empty); `ConsumeOrderFills` wires `s.processOrderFill` unwrapped (`portfolio_service.go:173-174`), so Step 9 creates the wrapper. Existing `consumeEventStream`/`streamEventsFrom` callers in `portfolio_sync_retry_test.go` and `portfolio_fill_errors_test.go` must pass the new `onHealthy` argument.
  - Trading `TradingService` has no `now` field (`trading.go:127`); no invalid-credentials branch exists at `SubmitOrder` (`ErrInvalidCredentials` only at `:2039, :2128, :3043`), so `submitOutcome` derives it with `errors.Is` in the existing `:724` branch.
  - UI `src/telemetry.ts` exports only `initTelemetry`; the UI's metrics module with the rebinding pattern is `src/lib/bffMetrics.ts`, so the UI counters live there (design.md 1.1 listed `src/telemetry.ts`). The UI is therefore not in the Node library step.
  - Notify enabled-channel state is private (`FanoutDispatcher.slackWebhookUrl/sendgridApiKey`, `WebPushDispatcher.vapidConfigured`); Step 21 adds read-only accessors and a pure `describeDeliveryChannels` in a new `src/fanout/deliveryChannels.ts` so AC-49 is testable without booting the server.
  - Go coverage: trading and portfolio new logic lives entirely in the CI-excluded `service` and `telemetry` packages (`COVERPKGS` filter), so no coverage threshold applies there; the `-race` run is the gate. Marketdata's alpaca/fmp/finnhub/edgar packages ARE measured.
  - DRY guard: jscpd is ENFORCED (threshold 0) only for `services/xstockstrat-ui/src` (`.husky/pre-commit`); Go/Python/Node are report-only, so the per-service duplicated accessor modules do not block.
  - Overlap states at spec time: 215 in-progress, 243 in-progress, 281 implementation-ready (statuses read from `status.md`); no `merge-order.md` row names 294 yet. Re-run `/sdd-review impl-spec` for the Mode B overlap scan before `/sdd-execute`.
- Branch deviation to log at `/sdd-execute`: sequential on `ccr-b4aace27-zvuaby`, integration PR #1427 (spec header, Step Dependencies and Deviation Log record it).

## Session 2026-11-04 — sdd-review impl-spec (advisory; looped to convergence)

- Result: **CONVERGED, 0 failures, 0 warnings** after 5 rounds (R1: 4 ✗ / 15 ⚠; R2: 0 / 15; R3: 0 / 7; R4: 0 / 1; R5: 0 / 0). Advisory only; status stays `implementation-ready`. Fixes were spec-text edits (Files lists, asserting verification commands, fail-closed `hunk_guard`/`fn_range` helpers, one RED protocol, coverage assertions, characterization-first ordering for Steps 7 and 11, Step 13/15/19 guards, Step 29 allowlist-test placement).
- Accepted trade-offs (recorded in the spec, not defects): Step 11 not split (shared `cmd/server/main.go` wiring); Step 21 testability-only `deliveryChannels.ts` surface (C-18, reviewer to confirm); per-service duplicated accessor modules (jscpd report-only outside the UI); >5 Files on Steps 13/15/23/29/30; duplicated scope-claims read in Step 15 (`tools.py` import-cycle risk); AC-43 check is deliberately stricter than the scenario (whole `packages/otel/`).
- Informational: design.md 1.4 says `secretDenialReason` goes "beside" `hasSecretCallerAuthority`; the spec appends it at end of `authz.ts` (hunk-sliding guard safety). Refinement, not a divergence.
- Overlap findings (WARN only, zero FAIL-level; no proto/config/migration collision):
  - [ ] 215 (code-completed on origin/main-dev; local checkout lags): analysis `live_loop.py`, `servicer.py`, `evaluator.py`; marketdata `etf_flags.go`, `fmp_client.go`, `marketdata_service.go`, `cmd/server/main.go`. Step 13/11 ranges must be re-derived after rebasing onto current `main-dev`.
  - [ ] 243 (in-progress): indicators `tests/test_config_watcher.py`, `services/xstockstrat-indicators/CLAUDE.md` (Steps 28, 30).
  - [ ] 281 (implementation-ready): portfolio `portfolio_service.go`, agent `tools.py`, config `configServiceImpl.ts`; the prune loop name in portfolio `Loops`.
  - [ ] 282 (implementation-ready): marketdata `marketdata_service.go`, `cmd/server/main.go`, config `configServiceImpl.ts`, portfolio `portfolio_service.go`, agent `tools.py`.
  - [ ] `merge-order.md` has no 294 row (operator to add advisory rows: 294 vs 215; 294 vs 281/282). Not written by this review (shared file, needs operator confirmation).
- Execution reminders: log the branch deviation (sequential on `ccr-b4aace27-zvuaby`, PR #1427) at `/sdd-execute`; merge `origin/main-dev` into the branch before Step 1 so cited lines and the 215 ranges match current code; rewrite PR #1427's description before merge.

## Session 2026-11-06 — sdd-execute sequential: re-spec gate (§5.3)

- Branch setup: `git merge --no-edit origin/main-dev` (at `0ea9b5c5`, which brings 282 `filter-otc-symbols`, #1456) into the detached `origin/ccr-b4aace27-zvuaby`; merge commit `f9221eef`, no conflicts. `scripts/ledger-guard.py --own-slug signal-map-instrumentation --base origin/main-dev --fix` reported clean, so no repair was needed.
- Overlap states now: 215, 243 and 281 are `launched`; 282 is `code-completed` (merged into `main-dev`). The 215 ranges Step 13 guards are derived from `HEAD` by anchor, so no Step 13 edit was needed.
- Directive `conditional`. Re-spec'd only Steps 7, 8, 9, 10, 11, 15, 19, 25 (Instructions / Codebase Evidence; no Files or Verification change was needed). Every new line was re-grepped in the merged tree:
  - Step 7: line drift only. Broker-type switch `:3493`; the fill-handling clause now names the `FILLED`/`PARTIALLY_FILLED` cases of `applyBrokerOrderStatus` (`:1811`, cases `:1843`/`:1864`) instead of `:1812`.
  - Step 8: `internal/service` has 23 test files, not 26. `trading_telemetry_test.go` is "modify" because Step 7 creates it, so that is not a mismatch.
  - Step 9 / Step 10: portfolio lines moved about +58 after 282 (consumers `:1301/:1313/:1527/:1575`, `boundedRetry :1361`, park `:1389`, `applyQuotes :529`/`:542`, production calls `:811/:1088/:1152`, `broadcastSnapshot :1082`, `InsertSnapshot :1105`, main.go consumers `:75-79`, `HydrateStops :80`, `ListOfflineAccountIdsByUser` `:678-682`).
  - Step 11: marketdata lines moved +7 (warm poller `:1119`, body `:1149-1188`, WARNs `:1159/:1180/:1186`, bar-ingest record `:1345`, backfills `:1375/:2159`, retention `:1057`); `ErrorClass :348`, `statusError :290`, `stageError :298`.
  - Step 15: agent `tools.py` sites `:678-724` and `_agent_policy :2628`; the `app/telemetry.py` provider is at `:63-64`.
  - Step 19: `configServiceImpl.ts` shifted +9. Instruction 4's anchors are now named by symbol (the `connectedOnce ? resyncAll() : reloadAll()` line `:208`, the `'Config service initialised…'` log `:211`, the ends of `reloadAll`/`reloadNamespace` `:297`/`:319`). `SECRET_SCOPE_ERROR` is at `:186-189`.
  - Step 25: only the two dict drop branches (`:34`, `:38`) log the item today. Resolution: the non-object branch (`:28`) gains `slug` but still logs no item content. Truncating the logging that exists is the minimum change, and AC-53 exercises only `bad_symbol_direction`.
- **Decisions on new loops (from the validator's open forks):**
  - **281 prune loop (Step 9):** `signal_prune` is added to portfolio `Loops` as KEPT, like trading's `position_sync`. It writes no `LogTickOK`, `signal_prune.go` is not edited (not in Files), and its existing per-tick `"signal watchlist prune tick"` INFO (`signal_prune.go:77`) is its record. This follows the operator's OQ2 rule (2026-11-04: a loop that already writes one cycle record per tick keeps it and writes no second). The earlier spec text "keep its record shape `loop tick ok`" contradicted what 281 shipped. Caveat for the operator: `pruneOnce` writes the tick INFO even after a failed prune (WARN `"signal watchlist prune failed"` at `:55`, then the INFO at `:77`), so this record is not strictly "per successful tick".
  - **282 asset refresher (Step 11):** `asset_refresh` is added to the closed marketdata `Loop` set as KEPT. Its `"asset set loaded"` INFO, written once per successful refresh (`asset_servability.go:148`), is its record under the same OQ2 rule, and `asset_servability.go` is not edited (not in Files). Both loop sets stay at most 8 (portfolio 6, marketdata 6).
  - The operator can overturn either decision at the Step 9 / Step 11 checkpoint. Overturning means adding `signal_prune.go` / `asset_servability.go` to Files, which is a blocker under §5.7.
- Not re-spec'd (outside the directive; text only, no step-body impact): Step Dependencies still says "keep its record shape `loop tick ok`" for 281; the Step 9 re-spec supersedes it. The Execution Summary "Line numbers" note still names HEAD `e1cf809`. Step 3's evidence window `sed -n 70,85p services/xstockstrat-agent/app/telemetry.py` shows only the `LoggingHandler`; `set_meter_provider` is at `:63-64`. That is recorded in Step 15's evidence, and Step 3's body is unchanged.

## Session 2026-11-06 — sdd-execute sequential (sdd-batch-execute)

- **Up-front confirmation (§5.1b / §5.4):** the operator approved the up-front plan (mode entry, plus this feature's re-spec summary and pending steps 1-30), as relayed by the sdd-batch-execute workflow. This single confirmation stands in for the per-step Phase-2 confirmation for this feature. The run still pauses at the §5.5b checkpoints and at §5.7 blockers.
- Status `implementation-ready` → `in-progress` (status.md, plus a feature.md Status History row).
- **Deviation (logged as instructed in earlier sessions):** execution is sequential on `ccr-b4aace27-zvuaby`, not `feature/signal-map-instrumentation`; PR #1427 is the single integration PR, and its description must be rewritten before merge.
- Open for the operator at the checkpoints: the KEPT loop-name decisions for 281 (`signal_prune`, Step 9) and 282 (`asset_refresh`, Step 11) recorded above; `merge-order.md` still has no 294 row.

### Step 1 — service: Go telemetry library (trading, portfolio, marketdata) [done]
- Added to each `internal/telemetry/otel.go` (pure insertions; the three files still differ only in `serviceName()`'s default): `meterGen` bumped in `Init` right after `otel.SetMeterProvider(mp)`; rebinding accessors `NewCounter`/`(*Counter).Add` (Int64), `NewHistogram`/`(*Histogram).Record` (Float64) and `NewGauge(name, observe func(ctx) (float64, bool))`/`(*Gauge).Register` (Float64 observable; idempotent per provider, moves its callback on a provider change, observes only when the bool is true). Instruments are cached per (`otel.GetMeterProvider()` identity, `meterGen`) and created on `otel.Meter(serviceName())`; the identity compare cannot panic and a nil receiver or nil provider is a no-op. Also `type Loop string` (no constants: Steps 7/9/11 declare them and `Loops`), `LoopTickOKMsg`, `LogTickOK`, `TickThrottle.Allow` and `tickThrottleInterval = 60s`. `serverMetricViews` untouched; no `rpc.client.*` instrument.
- Tooling setup (Steps 1-2): go1.27.0 ✓ · golangci-lint ✓ v2.14.0 (built with go1.27.0).
- TDD (RED protocol from the Execution Summary; Step 2 commits the real tests): an uncommitted probe test (`zz_step1_probe_test.go`: provider A/B rebind for all three accessors, no-op provider + nil receiver, `LogTickOK` JSON record, `TickThrottle` t0/59s/60s, `len(serverMetricViews())==4`). Red 1, pre-implementation: `undefined: NewCounter` ... build failed. Red 2, real code with `binding.get`/`Gauge.Register` temporarily no-op'd: `provider A: probe.counter not collected with exactly its own sample (seen=map[])` in all three modules. Green: probe plus the existing telemetry tests pass with `-race` in all three modules. The probe and the no-op were removed and never committed.
- Verification: `for s in trading portfolio marketdata; do (cd services/xstockstrat-$s && GOWORK=off go build ./... && GOWORK=off golangci-lint run --modules-download-mode=mod) || exit 1; done` → `0 issues.` ×3, exit 0.
- Files modified: `services/xstockstrat-trading/internal/telemetry/otel.go`, `services/xstockstrat-portfolio/internal/telemetry/otel.go`, `services/xstockstrat-marketdata/internal/telemetry/otel.go`
- Deviations: none for the step itself. The pre-known branch deviation (sequential on `ccr-b4aace27-zvuaby`, PR #1427) is now in the spec's Deviation Log.

### Step 2 — test: Go telemetry library tests [done]
- Added `internal/telemetry/instruments_test.go`, identical in trading, portfolio and marketdata (internal `package telemetry`, no `t.Parallel()`, each test restores the global MeterProvider / slog default in `t.Cleanup`):
  - provider A/B rebind for `Counter`, `Histogram` and `Gauge`: each reader sees exactly its own sample, and the gauge leaves A on the move to B;
  - the gauge skips observation when `observe` returns false;
  - AC-42 no-op with `OTEL_ENABLED` empty, the no-op provider, nil receivers and a nil `observe`;
  - `LogTickOK` writes one INFO JSON record (`msg` `loop tick ok`, `loop`, integer `duration_ms`, no `state` when empty; `state` present when non-empty), captured with an inline JSON `bytes.Buffer` handler;
  - `TickThrottle` true at t0, false at t0+59s, true at t0+60s;
  - AC-56: `serverMetricViews()` is exactly the four drop views (each matches its name with `AggregationDrop`, none matches `rpc.server.duration`), and no `rpc.client.*` instrument is collected after exercising the accessors.
- TDD (Execution Summary RED protocol): with `binding.get` and `Gauge.Register` temporarily no-op'd in the working tree, all three modules failed with `instruments_test.go:112: test.rebind.counter not collected as an int64 sum (seen=map[])` and `instruments_test.go:282: reader collected nothing after exercising the accessors`. AC-42 has no meaningful red (it asserts no panic, which the stub also satisfies); the AC-56 views half characterizes unchanged code. The stub was reverted from a scratchpad backup (`git status` showed `otel.go` clean) and never committed. Green: the same tests pass with `-race` in all three modules.
- Verification: the step's commands, run per service as separate shell commands because the worktree sandbox refuses the compound `for` loop (same commands and flags; `COVERPKGS` from the same `go list | grep -Ev` filter): `go test ./internal/telemetry/... -race` ok ×3; `golangci-lint run` `0 issues.` ×3; full suite `-race` with `-coverpkg` ok ×3; measured-package totals trading 79.1%, portfolio 68.6%, marketdata 81.9% (awk gate exit 0). `gofmt -l` clean.
- Files modified: `services/xstockstrat-trading/internal/telemetry/instruments_test.go`, `services/xstockstrat-portfolio/internal/telemetry/instruments_test.go`, `services/xstockstrat-marketdata/internal/telemetry/instruments_test.go` (all created)
- Deviations: none.

### Step 3 — service: Python telemetry library (agent, analysis, indicators, ingest) [done]
- Appended to each `app/telemetry.py` (pure insertions; the four accessor blocks differ only in `_METER_NAME = "xstockstrat.<svc>"`): `_current_provider()`, base `_Bound` (caches one instrument per `metrics.get_meter_provider()` identity and re-creates it on a change, so a reader installed after import sees the instrument and no duplicate-instrument warning fires), and `Counter(name, unit, description).add(amount=1, attributes=None)`, `Histogram(name, unit, description, buckets=None).record(value, attributes=None)`, `Gauge(name, observe, unit, description).register()` (`observe()` returns the sample or `None`; a superseded provider's callback reports nothing). Every record/register body is `try/except Exception: pass`. analysis and ingest also gained `from enum import StrEnum`, `LOOP_TICK_OK = "loop tick ok"`, an empty `class Loop(StrEnum)` (members come with Steps 13 / 25, as Go's Step 1 left its constants to Steps 7/9/11) and `log_tick_ok(logger, loop, duration_ms, state=None)` (INFO, `extra` = `loop`, int `duration_ms`, `state` only when set). `tool_metrics.py`, `_TRUNCATION_COUNTER` and `mcp.tool.duration` untouched.
- Decision (implementation choice inside the step): while only the API's default proxy provider is installed (`provider is opentelemetry.metrics._internal._PROXY_METER_PROVIDER`, read with `getattr` so a rename degrades to "always bind"), every helper is a no-op and creates nothing. That keeps `OTEL_ENABLED` unset a no-op (AC-42), and it avoids the one duplicate-instrument warning an instrument created on the proxy would cause once it is materialised onto the first real provider. Consequence for later steps: a `Gauge` must be `register()`ed after `init_telemetry()` (and again in tests after a provider swap).
- Tooling setup (Steps 3-4): uv 0.11.32 ✓ · ruff 0.16.9 ✓ (on PATH; not a project dev dep) · `uv sync --extra dev` in all four services (no lockfile change).
- TDD (RED protocol from the Execution Summary; Step 4 commits the real tests): an uncommitted probe `tests/test_zz_step3_probe.py` in each service (provider A/B rebind for all three accessors with a `caplog` no-duplicate-warning check, a raising `_instrument` swallowed, `log_tick_ok` record shape for analysis/ingest). Red 1, pre-implementation: `AttributeError: module 'app.telemetry' has no attribute 'Counter'` ×4 (and `no attribute 'log_tick_ok'` in analysis/ingest). Red 2, real code with `_Bound._instrument` temporarily no-op'd: `assert [] == [2]` ×4 (counter not collected). Green: probe 3 passed (analysis, ingest) / 2 passed + 1 skipped (agent, indicators, no tick helper), with `tests/test_telemetry.py` alongside. The probe and the stub were removed (stub restored from a scratchpad backup) and never committed. Full suites still pass: agent 661, indicators 456, ingest 384, analysis 1529.
- Verification: `uv run ruff check .` `All checks passed!` and `uv run ruff format --check .` `already formatted` in agent, analysis, indicators and ingest, run as one `&&` chain per service because the worktree sandbox refuses the compound `for` loop (same commands); exit 0.
- Files modified: `services/xstockstrat-agent/app/telemetry.py`, `services/xstockstrat-analysis/app/telemetry.py`, `services/xstockstrat-indicators/app/telemetry.py`, `services/xstockstrat-ingest/app/telemetry.py`
- Deviations: none.

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

### Step 4 — test: Python telemetry library tests [done]
- Added `tests/test_telemetry_instruments.py` in agent, analysis, indicators and ingest (one shared body; agent/indicators omit the tick tests, only analysis has the pin):
  - provider A/B rebind for `Counter`, `Histogram` and `Gauge` (re-arming the set-once exactly as `otel_reset` does): each reader holds only its own samples, the gauge leaves A on the move to B, and no `opentelemetry*` WARNING (the SDK's "created already" registration-conflict warning) is logged;
  - a `Gauge` whose `observe()` returns `None` reports nothing;
  - a raising underlying `add`/`record` (patched on the SDK instrument class), a raising `observe()` and a raising `_create` never propagate;
  - AC-42: with `OTEL_ENABLED` unset, `init_telemetry()` constructs none of the three OTLP exporters (each patched to record construction) and leaves the API proxy provider installed, and every helper stays unbound (`_inst is None`);
  - analysis/ingest: `log_tick_ok` writes one INFO `loop tick ok` with `loop` and int `duration_ms` on the `LogRecord.__dict__`, `state` only when passed, and a `LoggingHandler` over an `InMemoryLogRecordExporter` shows `loop`/`duration_ms` as OTel log attributes;
  - analysis: `_TRUNCATION_COUNTER` pin. Precondition `type(...).__name__ == "_ProxyCounter"` holds, reader A holds `[2]` after `add(2)`, and after the set-once re-arm reader B holds `[3]` after `add(3)`.
- Fixture caveat (discovery): `metric_reader` lives in `tests/test_telemetry.py`, not `conftest.py`, in analysis, indicators and ingest. Those three new files bind it at module level (`metric_reader = test_telemetry.metric_reader`). This reuses the one fixture without a second copy (C-13) and without editing `test_telemetry.py`/`conftest.py`, which are outside Files. Agent reuses its conftest fixture as-is. An `import ... metric_reader` form was rejected because ruff F811 flags every test parameter that shadows it.
- Tooling: uv 0.11.32 ✓ · ruff 0.16.9 ✓ · `uv sync --extra dev` in the four services (fresh worktree venvs, Python 3.12 per each `.python-version`; no lockfile change). No husky hook ran: `core.hooksPath` points at the main worktree's `.husky/_`, which does not exist because the main worktree has no `node_modules`. `--no-verify` was not used.
- TDD (Execution Summary RED protocol): with `_Bound._instrument` temporarily no-op'd (`return None`) in all four `app/telemetry.py`, each service failed the counter/histogram/gauge rebind tests (`assert [] == [3]`, `assert [] == [1]`, `assert [] == [7.0]`) and the raising test (`AttributeError: <class 'NoneType'> has no attribute 'add'`): agent 4 failed/2 passed, analysis 4/5, indicators 4/2, ingest 4/4. Extra uncommitted mutation probes:
  - analysis with the helpers re-raising and the proxy guard removed: `RuntimeError: instrument fault` (raising test) and `assert (<opentelemet...>) == (None, None, None)` (AC-42 test).
  - ingest with `log_tick_ok` no-op'd: both tick tests failed (`ValueError: not enough values to unpack`).
  - Each stub was restored from a scratchpad backup (`git diff` on `app/telemetry.py` empty) and never committed.
- Green: Step 4 Verification, run per service as separate `&&` chains because the worktree sandbox refuses the compound `for` loop (same commands and flags). analysis 1538 passed, 90.43%; ingest 392 passed, 85.04%; agent 667 passed, 84.98%; indicators 462 passed, 85.48% (≥50). `ruff check .` and `ruff format --check .` were clean in all four; exit 0.
- Files modified: `services/xstockstrat-agent/tests/test_telemetry_instruments.py`, `services/xstockstrat-analysis/tests/test_telemetry_instruments.py`, `services/xstockstrat-indicators/tests/test_telemetry_instruments.py`, `services/xstockstrat-ingest/tests/test_telemetry_instruments.py` (all created)
- Deviations: none.

### Step 5 — service: Node telemetry library (identity, config, ledger, notify) [done]
- Appended to each `src/telemetry.ts` (the four blocks differ only in `METER_NAME = 'xstockstrat.<svc>'`). The block adds a `guarded()` try/catch wrapper and an abstract `Bound<T>`, which caches one instrument per `metrics.getMeterProvider()` identity and re-creates it when the provider changes (the `bffMetrics.ts:13-23` shape, with `require('@opentelemetry/api')` inside the call as the file already does). On top of `Bound<T>` it adds `BoundCounter(name, {unit, description}).add(value = 1, attributes?)`, `BoundHistogram(name, {unit, description, buckets?}).record(value, attributes?)` (buckets become `advice.explicitBucketBoundaries`) and `BoundGauge(name, observe, opts).register()`. For `BoundGauge`, `observe()` returns a number or `undefined`, and only the current binding's callback observes. Every record, register and callback body runs inside `guarded()`. The only other edit is to the `import type` line from `@opentelemetry/api`, which gains `Attributes, Counter, Meter, ObservableGauge, ObservableResult`. `RpcDurationProcessor`, `rpc.server.duration` and `rpcDurationViews` are untouched (FR-15(b)). There is no tick helper (design.md 1.2).
- Naming decision: the classes are `Bound*`, not `Counter`/`Histogram`/`Gauge` as in Python. `Histogram` and `Counter` are already API type names in this file (`RpcDurationProcessor`'s field is typed `Histogram`), and renaming that import would touch the RPC processor.
- SDK finding (sdk-metrics 1.25; affects Steps 6, 19, 20, 22): the SDK's cumulative storage keeps exporting an observable gauge's last value when a later collection makes no observation. So in Node, `observe()` returning `undefined`, or a superseded binding, means "no new sample", not "no point". I checked this with a plain SDK gauge outside the repo: `[5]` and then `[5]` again after the callback stopped observing. The doc comment says this. Tests should therefore assert that a superseded reader never sees a newer value, not that it reports nothing. Python's Step 4 asserted the stricter form. Because `BoundGauge` binds on `register()`, Steps 19 and 21 must call `register()` after `initTelemetry()`.
- Tooling: node v24.22.1 and pnpm 9.15.9 were already present. I ran `pnpm install --frozen-lockfile` filtered to the four services (no lockfile change). Its root `prepare` (`husky`) rewrote the shared `core.hooksPath` from `/home/user/xstockstrat/.husky/_` to `.husky/_`. That rewrite is why the pre-commit hook runs in this worktree, and it is reported as an out-of-scope side effect.
- TDD (Execution Summary RED protocol; Step 6 commits the real tests): I used an uncommitted probe `src/__tests__/zz_step5_probe.test.ts` in each service. It covered no-provider no-op, provider A/B rebind for all three accessors (via `metrics.disable()`), and a throwing fake provider. Red 1, before implementation: `TS2305: Module '"../telemetry"' has no exported member 'BoundCounter'` (and `BoundGauge` and `BoundHistogram`) in all four services. Red 2, real code with the rebind condition reduced to create-once (`if (this.inst === undefined)`): `accessors bind to provider A, then rebind to provider B` failed in all four services with `actual: []` against expected `[2]`. Green: the probe plus `telemetry.test.ts` and `telemetry.export.test.ts` passed (identity 25/25, config 27/27, ledger 25/25, notify 25/25). I restored the probe and the stub from a scratchpad backup and never committed them. Full suites still pass: identity 139, config 294, ledger 142, notify 125.
- Verification: the step's `pnpm run lint && pnpm exec tsc --noEmit` exited 0 in identity, config, ledger and notify, with 0 errors. The warnings are pre-existing `no-explicit-any` hits, and `eslint` on the four `telemetry.ts` files reports none. I ran it per service as separate `&&` chains because the worktree sandbox refuses the compound `for` loop. The commands and flags are the same.
- Files modified: `services/xstockstrat-identity/src/telemetry.ts`, `services/xstockstrat-config/src/telemetry.ts`, `services/xstockstrat-ledger/src/telemetry.ts`, `services/xstockstrat-notify/src/telemetry.ts`
- Deviations: none.

## Session 2026-11-06 — sdd-execute sequential (sdd-batch-execute), re-spec before Step 6

- **Branch sync (§5.3 step 1):** merged `origin/main-dev` (head `f9fda6dc`, 293 PR-1 #1457 "latch the live-loop overflow WARN") into `ccr-b4aace27-zvuaby` as merge commit `368fc73a`. It was a normal merge with no conflicts, so no ledger or feature-dir resolution was needed. `scripts/ledger-guard.py --own-slug signal-map-instrumentation --base origin/main-dev --fix` → `clean` (no repair).
- Status was already `in-progress`. The up-front confirmation is recorded in the earlier 2026-11-06 session above. No status change.
- **Re-spec (conditional directive, Steps 6, 8, 15, 17, 29 only; body text in `implementation-spec.md`):**
  - Step 6: `CollectingReader` is at `:32` in identity, notify and ledger and at `:35` in config (named by symbol). All eight `telemetry.test.ts` / `telemetry.export.test.ts` files exist. `fixtures/` exists in identity and ledger and is absent in config and notify. None of the four create targets exists yet.
  - Step 8: validated with the body unchanged. `trading_telemetry_test.go` is "modify" because Step 7 creates it. `newFlattenHarness` is at `:88` and the JSON `bytes.Buffer` handler at `trading_sync_test.go:18-21`. There are 23 `*_test.go` files, and the four `internal/testdata` files are present.
  - Step 15: the `secure_channel` example list now ends `:349` instead of `:328`, which became a docstring line. "12+ sites" changed to "70 references". The staging command now uses `cd "$(git rev-parse --show-toplevel)"`.
  - Step 17: `grpcStatusCode` is at `:64`, not `:56`. Step 5 moved it, and the step now names it by symbol. The `jwtSecret` getter is at `:113-120` (env read `:115`, throw `:117`). The ledgerAudit `new Promise` is at `:55-59` and its catch at `:60-65`. The staging command uses the worktree root.
  - Step 29: the registered `live_loop: cycle complete` literal is now at `:348`, not `:345`. The 293 PR-1 merge moved it, and `grep -c` is still 1. The three `cd /home/user/xstockstrat` verification lines now resolve the active worktree root, and a sentence says so. The 14 deferred IDs each still appear exactly once.
- **Not re-spec'd (outside the directive), flagged for the operator:** the same main-dev merge rewrote part of `services/xstockstrat-analysis/app/engine/live_loop.py` (+38/−18 lines). Step 13's cited `live_loop.py` anchors (`:345`, `:471-479`, `:531-595`, `:843-845` and the 215 block ranges) have probably drifted. Step 13's `hunk_guard` derives the 215 ranges by anchor, so the guard still holds. Fix the cited lines by symbol at Step 13, or re-spec Step 13 explicitly. The hard-coded `cd /home/user/xstockstrat` staging lines in Steps 7, 11, 13, 19 and 30 were also left as they are: run them from the active worktree root.
- Tooling note: the main worktree has no `node_modules`, so there was nothing to symlink. `core.hooksPath` (`/home/user/xstockstrat/.husky/_`) does not exist, so no pre-commit hook ran on these doc-only commits. `--no-verify` was not used.

### Step 6 — test: Node telemetry library tests [done]
- Added `src/__tests__/telemetryInstruments.test.ts` in identity, config, ledger and notify. The four files are identical: the accessors are imported by symbol, and the meter name is not asserted. Its tests are:
  - (c) AC-42, run first: with `OTEL_ENABLED` unset, `initTelemetry()` leaves `telemetryStarted()` false and the API `NoopMeterProvider` installed. `BoundCounter.add`, `BoundHistogram.record` and `BoundGauge.register` do not throw.
  - (a) rebind: the accessors are created before any provider exists. Provider A is then installed with `metrics.disable()` and `setGlobalMeterProvider`. A collects counter `[2]`, histogram sum `[5]` and gauge `[7]`. After provider B is installed, B collects `[3]`, `[4]` and `[9]`. A still holds `[2]` and `[5]`, and it never sees the gauge's `9`. The gauge assertion is the weak form from Step 5's sdk-metrics finding, because the SDK re-exports the last gauge value.
  - (b) faults: two fake providers are tried. One returns instruments whose `add`, `record` and `addCallback` throw. The other has a `getMeter` that throws. No accessor call escapes with either. A gauge whose `observe()` throws reports no point on a real reader.
  - (d) span survives `queueMicrotask`: `NodeTracerProvider` (from `@opentelemetry/sdk-node` `node`, the AsyncLocalStorage context manager NodeSDK registers) wraps a `startActiveSpan`. Inside the `queueMicrotask` callback and after awaiting it, `trace.getActiveSpan()` is the span. **Result: it holds in all four services (Node v24.22.1).** Step 22 (notify) can rely on it.
- C-13: `CollectingReader` is copied inline, as the spec directs. The new file is that helper's second consumer in each service. It is not extracted until a second *new* test file needs it (Steps 18, 20, 22). No `fixtures/` dir was created.
- Tooling (Step 6): node v24.22.1 ✓, pnpm 9.15.9 ✓. `pnpm install --frozen-lockfile` was filtered to the root, `@xstockstrat/proto` and the four services; the lockfile did not change. The main worktree has no `node_modules`, so there was nothing to symlink. The root `prepare` (`husky`) changed the shared `core.hooksPath` from `/home/user/xstockstrat/.husky/_` to `.husky/_`, so the pre-commit hook runs on this commit. I restore the original value after pushing. This is reported as an out-of-scope side effect, as at Step 5.
- TDD (Execution Summary RED protocol), with the stubs confined to the working tree:
  - Probe 1, accessor no-op'd: the three `guarded(() => this.instrument()…)` bodies were commented out in each `telemetry.ts`. In all four services, `accessors bind to a provider installed after import, then rebind to a second provider` failed with `actual: []` against `expected: [ 2 ]`, and 1 test failed out of 4.
  - (b) and (c) have no RED under a no-op stub, because a no-op also satisfies "does not throw". Probe 2 therefore made `guarded()` re-throw. With it, `a throwing meter, instrument or observe callback never escapes the accessors` failed in all four services, again 1 of 4.
  - (d) is a characterization test (red N/A): it records the runtime behavior without changing code.
  - Both stubs were restored from scratchpad backups. `git status` showed only the four new files, and the stubs were never committed.
- GREEN is the step's Verification, run per service as separate `&&` chains because the worktree sandbox refuses the compound `for` loop (same commands and flags). Each service passed `pnpm run test:coverage` and `pnpm exec c8 check-coverage --lines 40` (exit 0), and `pnpm run lint` exited 0 with no errors. The warnings are pre-existing `no-explicit-any` hits; `eslint` and `prettier --check` on the new files are clean.

  | Service | Tests passed | Delta vs Step 5 | Line coverage |
  |---|---|---|---|
  | identity | 143/143 | +4 | 78.42% |
  | config | 298/298 | +4 | 91.17% |
  | ledger | 146/146 | +4 | 80.59% |
  | notify | 129/129 | +4 | 81.42% |
- Files modified (all created): `services/xstockstrat-identity/src/__tests__/telemetryInstruments.test.ts`, `services/xstockstrat-config/src/__tests__/telemetryInstruments.test.ts`, `services/xstockstrat-ledger/src/__tests__/telemetryInstruments.test.ts`, `services/xstockstrat-notify/src/__tests__/telemetryInstruments.test.ts`
- Deviations: none.

### Step 7 — service: Trading outcome counters, tick records, clock seam (SEV-2) [done]
- `internal/telemetry/otel.go` gained the trading label keys (`KeyOutcome`, `KeyBrokerType`, `KeyEventType`, `KeyAlertKind`), the six `Loop` constants plus `Loops` (`position_sync` is KEPT and never written through `LogTickOK`), the six counters from design.md 1.4 (unexported, rebinding `NewCounter`), the `event_type` allowlist (unknown types record `other`), and one `Record*` helper per instrument. The helpers keep label keys inside the telemetry package.
- `trading.go`:
  - `TradingService.now` and a nil-safe `clock()` (portfolio's shape).
  - `logTick(ctx, loop, start, total, reached, failed)` applies the design.md 1.2 failure rule (no record when `reached > 0 && failed == reached`; `idle` when `total == 0`; `skipped` when `reached == 0`). It is shared by fill_poller, reconciliation, credential_health, bracket_watchdog and order_intent_sweeper. credential_health writes `disabled` in the new `else` of `if intervalMs > 0`.
  - `submitOutcome`, `brokerTypeLabel`, `ledgerEmitOutcome`, the typed `alertKind` set and `recordAlertEmit`. `recordAlertEmit` is called after all seven `EmitAlert` sites.
  - The flatten outcomes. `:2885` is split: `lookup_error` gets a new ERROR `"flattenAndHalt: position lookup failed"`, and `flat` (including NOT_FOUND) keeps the old text at INFO. Both return where the combined branch did.
  - The bracket outcomes, `order_submit` at both error branches and the success path, `ledger_emit` inside `appendLedgerEvent` (`failed` for the payload-build error, the retry-wait `ctx.Done()` and any returned error), `stream_key` on `"ledger emit failed"`, and `escalation.systemic` at the top of `escalateSystemic`.
- `order_intent.go`: a sweeper tick record at the end of `sweepOrderIntents`. There is no record when the select fails or every reclaim errors.
- `StartFillPoller` and the `FILLED`/`PARTIALLY_FILLED` cases of `applyBrokerOrderStatus` are untouched. The guard derived `StartFillPoller` as `1729-1750` from `HEAD` and passed. `ListExpiredProtection(..., time.Now())` and `sweepOrderIntents`' `staleBefore` still read `time.Now()`: Instruction 2 puts only tick durations on the seam.
- Characterization (Instruction 0): `trading_telemetry_test.go` holds `TestCheckCredentialHealthCharacterization`, `TestSweepOrderIntentsCharacterization`, `TestCheckBracketProtectionCharacterization` (flatten once and release, in-flight dedup, scan failure) and `TestReconcileTickPolledCharacterization` (ListOrders is reached only past the invalid-credential and halted-cooldown skips, and offline accounts are excluded). Run against the unmodified code (`-run 'Characterization' -race -v`), all 4 tests (6 subtests) passed before any production edit. The new fakes are in this file only (C-13: one consumer).
- TDD: the characterization tests are red N/A by construction (they pin existing behavior). The new behavior was proven with an uncommitted probe, `internal/service/zz_step7_probe_test.go`. Its cases: `flatten{no_broker}` +1, `ledger_emit{order.filled, ok}` and `{other, ok}`, `escalation.systemic` +1 with `alert_emit{reconciliation, ok}`, and an idle `fill_poller` tick. RED, before implementation: `flatten no_broker = 0, want 1`; `ledger_emit{order.filled, ok} = 0, want 1`; `escalation.systemic = 0, want 1`; `no idle fill_poller tick record in []` (assertion failures, not compile errors). GREEN after: all four pass, plus a clock-seam case (two `pollFills` calls, a fake `GetOrder` that advances the injected clock 120 ms and errors on call 2 → exactly one `loop tick ok` with `duration_ms` 120 and no `state`). The probe was deleted and never committed. Step 8 writes the committed new-behavior tests.
- Verification (run from the worktree root; see the Deviation Log): `git add -A services/xstockstrat-trading`, then the `StartFillPoller` hunk guard → `guard OK`. `go build ./...` ok. `-run 'Characterization' -race -v` → 4 PASS. The full `./internal/service/...` suite with `-race` → ok. `golangci-lint run` → `0 issues.` `gofmt -l` clean. The whole module `go test ./... -race` → ok.
- Files modified: `services/xstockstrat-trading/internal/telemetry/otel.go`, `services/xstockstrat-trading/internal/service/trading.go`, `services/xstockstrat-trading/internal/service/order_intent.go`, `services/xstockstrat-trading/internal/service/trading_telemetry_test.go` (created)
- Deviations: verification ran from the worktree root (Deviation Log, CI-equivalent fallback). Nothing else.

### Step 8 — test: Trading telemetry tests [done]
- Discovery digest was stale (it reported Step 7 `pending`). After `git checkout --detach origin/ccr-b4aace27-zvuaby` (HEAD `84367af8`), Step 7 was `done`. Every symbol this step needs resolved: `LogTickOK`, `LoopTickOKMsg`, `Loops`, the six `Loop*` constants, the `Key*` constants, `TradingService.now`, `clock()` and `logTick`.
- Extended `trading_telemetry_test.go`. The Step 7 characterization tests are not re-claimed. New tests:
  - `TestFlattenAndHalt_PositionLookupOutcomes` (AC-1, AC-2, AC-57): through `newFlattenHarness` with a `GetPosition` stub. Asserts `lookup_error`/`flat` deltas, the ERROR or INFO line, no submit, no halt, and no id in any metric attribute. The harness itself is unchanged.
  - `TestMaybeSubmitBracket_LookupFailed_CountedWithoutRowOrAlert` (AC-3).
  - `TestEmitLedgerEvent_OutcomeAfterUnavailableRetry` (AC-4): `failed` + `stream_key` `ord-4`, and `retried_ok`.
  - `TestPlaceOrder_SubmitOutcomeIsBounded` (AC-5 `{ALPACA, rejected}`, no rejection text in attributes; AC-45 `{IBKR, uncertain}`).
  - `TestReconcileTick_RepeatedSystemicEscalationCounted` (AC-45): 3 ticks, 2 of 4 accounts erroring, threshold 0.5. `escalation.systemic` +3, with 3 `SetConfig` calls.
  - `TestPollFills_PartialThenFilledUnchangedByTelemetry` (AC-45): persisted `status/filled_qty` rows under the noop provider equal the rows under a real reader.
  - `TestSyncPositions_FailedLedgerEmitStillCountsSynced` (AC-59): `synced` 1, `{account.positions.synced, failed}` +1.
  - `TestPollFills_TickRecordUsesInjectedClock` (AC-6): one INFO `loop tick ok`, `fill_poller`, `duration_ms` 120, no `state`, one WARN on call 2.
  - `TestLoopTickRecords` (AC-7 trading half; new-behavior tick cases for the four Step 7 characterized pollers plus `fill_poller`): 15 cases, covering ok, idle, skipped and whole-tick failure (no record) per loop. Every written `loop` is in `telemetry.Loops`, `len <= 8`, no record value carries an id, and `position_sync` is never written.
- C-13: the new fakes (`stubPositionPortfolio`, `lookupFailBracketRepo`, `scriptedLedger`, `persistedStatusDB`, `syncPositionsBroker`) and the reader helpers have one consumer (this file), so they stay inline. Existing fixtures were reused: `newFlattenHarness`, `auditSvc`/`placeReq`/`rejectBroker`/`timeoutBroker`, `newTestReconciliationService`, `fakeConfigSetter`, `captureLogs`, and the Step 7 characterization fakes. `internal/testdata/` is unchanged.
- TDD (Execution Summary RED protocol), with stubs confined to the working tree and backed up to the scratchpad:
  - Probe 1 emptied the six `Record*` helper bodies in `otel.go` and short-circuited `logTick`. All new tests except the parity test failed on assertions. Examples: `flatten.outcome{lookup_error} = 0, want 1`, `bracket.outcome{lookup_failed} = 0, want 1`, `ledger_emit{order.filled, failed} = 0, want 1`, `order_submit{ALPACA, rejected} = 0, want 1`, `order_submit{IBKR, uncertain} = 0, want 1`, `escalation.systemic = 0, want 3`, `ledger_emit{account.positions.synced, failed} = 0, want 1`, `tick records after call 1 = 0`, and `tick records = [], want exactly one` for all 10 record-expected tick cases.
  - Probe 2 restored the pre-Step-7 log lines: the combined WARN `no open position to flatten`, and no `stream_key`. `AC-1` failed with `records = [], want exactly one at ERROR`, `AC-2`/`AC-57` with `level:WARN`, and `AC-4` with a record lacking `stream_key`.
  - The parity test (`PartialThenFilledUnchanged`) is red N/A: it characterizes unchanged fill handling.
  - Both probes were restored from the backups, and `git status` showed only the test file.
- GREEN is the step's Verification:
  - `go test ./... -race -count=1 -coverprofile ... -coverpkg=<broker,config,middleware,mtls>` passed in all packages.
  - The `awk` gate passed: `total: 79.1%` (at or above 40).
  - `golangci-lint run` reported `0 issues.` after two SA1019 findings on this step's own lines were fixed (`attribute.Value.Emit` changed to `.String`).
  - `gofmt -l` was clean.
  - Flake check: the new and characterization tests passed `-count=5 -race` (65/65 top-level passes).
- Tooling: go 1.27.0 and golangci-lint 2.14.0 were present, and nothing was installed. Neither worktree has `node_modules`, so there was nothing to symlink. `core.hooksPath` points at `/home/user/xstockstrat/.husky/_`, which does not exist, so the husky pre-commit hook (jscpd DRY check) did not run on this commit. `--no-verify` was not used.
- Files modified: `services/xstockstrat-trading/internal/service/trading_telemetry_test.go`
- Deviations: two, both in the Deviation Log. Verification ran as split invocations (CI-equivalent fallback). The AC-7 position-sync clause is asserted on the tick body `syncPositions`, not the 300 s-ticker heartbeat.

### Step 9 — service: Portfolio consumer, quote and snapshot signals (SEV-2) [done]
- **Discovery.** The digest was partly stale. It reported `TickThrottle`, `LogTickOK` and `Loop` as missing, but Step 1 put them in `internal/telemetry/otel.go:266-292`. It also said the spec's portfolio lines were off by about 6. At HEAD `cf88228c` the spec's own post-282 citations are correct: `boundedRetry :1361`, park ERROR `:1389`, consumers at `:1301/:1313/:1527/:1575`, `applyQuotes :529`, the per-position Warn `:542`, the `applyQuotes` calls `:811/:1088/:1152`, `broadcastSnapshot :1082`, `InsertSnapshot :1105`. The three test callers pass `handle`; they now also pass `nil` for the new `onHealthy` argument (Instruction 4).
- **`internal/telemetry/otel.go`.** New label keys (`KeyConsumer`, `KeyOutcome`, `KeyOp`, `KeyMarkSource`, `KeyPath`). Six `Loop` constants and `Loops`; `signal_prune` is KEPT and is never written through `LogTickOK`, and `signal_prune.go` is not edited. Four rebinding counters, each with a `Record*` helper: `portfolio.consumer.events`, `portfolio.marketdata_fetch`, `portfolio.snapshot`, `portfolio.mark_source`.
- **`portfolio_service.go` consumers.**
  - `consumerLabel` and `consumerLoops` cover the five consumer names.
  - A `consumerSignal` type holds the outcome counter and the throttled `loop tick ok`.
  - `observed(name, okOutcome, h)` wraps order fill (`ok`/`error`) and the bracket and balance `ackAlways` consumers (`acked`).
  - `boundedRetry` records `ok`, `error` and `parked`. The park ERROR stays unthrottled.
- **`portfolio_service.go` stream.**
  - FR-14 follows design.md 1.8: `streamRetryDelay`/`streamLogEvery`/`streamQuietWindow`, the new `sleep` field plus `sleepFor`, and the per-kind counters.
  - The first and every 10th close log at INFO or ERROR; the rest log at DEBUG.
  - Counters reset after a 10-minute quiet gap.
  - `streamEventsFrom` takes an `onHealthy` callback; "<name> stream resumed" is written only after 2 or more closes of one kind.
- **`portfolio_service.go` quotes and snapshot.**
  - `latestQuotesFor` records `timeout`, `error` or `ok`. The WARN at `:413` is unchanged, and the empty-symbol return is not counted.
  - `observeQuotePass` runs after all five production `applyQuotes` calls (`read` twice, plus `pnl`, `snapshot` and `risk`) and writes one aggregate `"latest quote has no usable price"` WARN with `count` and up to 5 `sample_symbols`.
  - The per-position `slog.Warn` is deleted; `applyQuotes`' signature is unchanged.
  - `broadcastSnapshot` records `skipped_unpriced`, `written` or `db_error`. A failed insert writes the new ERROR `"portfolio snapshot insert failed"` and does not return.
- **`offline_valuation.go`.** The two `observeQuotePass(..., "read")` calls, and `pickMark`'s `path=read` record inside `if p != nil`, which uses `context.Background()`.
- **TDD (Step 7's protocol).**
  - The uncommitted probe `internal/service/zz_step9_probe_test.go` used only pre-existing symbols: a manual-reader provider and an all-level slog recorder.
  - RED before implementation (assertion failures, not compile errors): `consumer.events{position_sync,error} = 0, want 4`; `{parked} = 0, want 1`; `{ok} = 0, want 1`; `tick records = [], want one with loop=position_sync`; `marketdata_fetch{quotes,error} = 0, want 1`; `snapshot{db_error} = 0, want 1`; `insert-failed records = [], want one ERROR`; `unusable-quote records = [2 per-position WARNs], want exactly one with count=2`; `mark_source{none,read} = 0, want 3`; and `disconnect records = [INFO, INFO], want close 1 INFO and close 2 DEBUG`.
  - GREEN after implementation: all 5 probe tests passed. The probe was then deleted and never committed. Step 10 writes the committed tests.
- **Verification** (the step's own chain, run in the service directory): `go build ./...` ok; `go test ./internal/service/... -race -count=1` ok; `golangci-lint run` `0 issues.`; the `! grep` for the per-position Warn found nothing, exit 0. Also passing: the whole module under `go test ./... -race` (ok), and `gofmt -l` (clean). The existing parity tests (`getpnl_source_parity_test.go`, `offline_valuation_test.go`) passed unmodified.
- **Tooling.** go 1.27.0 and golangci-lint 2.14.0 (built with go1.27.0) were already present; nothing was installed. I symlinked `node_modules` from the main worktree, which is untracked and not staged. `core.hooksPath` (`/home/user/xstockstrat/.husky/_`) does not exist, so the husky pre-commit hook did not run. `--no-verify` was not used.
- **Files modified:** `services/xstockstrat-portfolio/internal/telemetry/otel.go`, `services/xstockstrat-portfolio/internal/service/portfolio_service.go`, `services/xstockstrat-portfolio/internal/service/offline_valuation.go`, `services/xstockstrat-portfolio/internal/service/portfolio_sync_retry_test.go`, `services/xstockstrat-portfolio/internal/service/portfolio_fill_errors_test.go`
- **Deviations:** two, both in the Deviation Log. `observed` takes the success outcome as an argument. The consumer tick duration reads `s.clock()` around each handler call.

### Step 10 — test: Portfolio telemetry tests [done]
- **Discovery.** The digest was stale: it reported Step 9 as unimplemented. After `git checkout --detach origin/ccr-b4aace27-zvuaby` (HEAD `cb09985a`), Step 9 was `done`, and every symbol this step needs resolved:
  - `observed`, `consumerLabel`, `consumerSignal`, `boundedRetry` outcomes;
  - the `sleep` seam with `sleepFor`, the `stream*` constants, and `streamEventsFrom(..., onHealthy)`;
  - `observeQuotePass`, `TickThrottle`, `LogTickOK`, `LoopTickOKMsg`;
  - `Loops`, the six `Loop*` constants, the `Key*` constants, and the four `Record*` helpers.
- **New file** `internal/service/portfolio_telemetry_test.go`, nine tests:
  - `TestBoundedRetry_AC8_ErrorThenParkedCounted` (AC-8).
  - `TestQuoteTimeout_AC9_FetchSnapshotAndMarkSourceCounted` (AC-9): a blocking stub runs into the 50 ms quote deadline; `GetPortfolio` still returns OK, then `broadcastSnapshot` is called directly.
  - `TestBroadcastSnapshot_AC10_InsertFailureLoggedNotDropped` (AC-10).
  - `TestGetPortfolio_AC11_OneAggregateUnusableQuoteLine` (AC-11), run inside an `sdktrace` span.
  - `TestConsumeEventStream_AC50_GracefulClosesThrottledThenResumed` and `..._AC50_NoResumedLineBelowTwoOfAKind` (AC-50).
  - `TestConsumeEventStream_AC58_CounterRestartsAfterQuietGap` (AC-58).
  - `TestOrderFillConsumer_AC56_OneTickRecordPerBatch` (AC-56 and the AC-7 portfolio half): 4 events, including a partial-then-fill pair for `ord-56`; no `rpc.client.*` instrument; parity against a no-telemetry baseline.
  - `TestConsumerTickRecords_AC7_FixedLoopNames` (AC-7): all five consumers write their fixed loop name, `signal_prune` is never written, and no identifier appears in any record or attribute.
- **C-13.** Existing fixtures were reused: `newQuoteSvc`, `posRow`, `quote`, `positionCols`, `anyArgs`, `stubMarketData`, `fakeLedger`, `ctxWithUser`, `guard`, `fakeClock`, `sliceStream`, `syncRecorderDB`, and `testdata.FilledEvent`/`PartialEvent`. The new fakes (`logRecorder`, `scriptedStreamLedger`, `streamHarness`) and the metric-reader helpers have one consumer each, so they stay inline. `internal/testdata/` is unchanged.
- **TDD (Execution Summary RED protocol).** Every probe ran in the working tree only, from scratchpad backups, and was restored afterwards; `git status` then showed only the new test file. All RED results are assertion failures.
  - **Probe 1** emptied the four portfolio `Record*` bodies and the `LogTickOK` emit. RED included `consumer.events{position_sync,error} = 0, want 4` and `{parked} = 0, want 1`. It also included `marketdata_fetch{quotes,timeout} = 0, want 2`, `snapshot{skipped_unpriced} = 0, want 1` and `snapshot{db_error} = 0, want 1`. The mark-source cases read `mark_source{none,read} = 0, want 2` (AC-9) and `= 0, want 12` (AC-11). The consumer cases read `consumer.events{order_fill,ok} = 0, want 4`, `tick records = [], want exactly one with loop=order_fill` and `tick loops = [], want [order_fill ...]`.
  - **Probe 2** restored the pre-Step-9 log lines: every close at INFO/ERROR, no quiet reset, no "resumed" line, per-position WARNs, and no insert-failed ERROR. RED:
    - `insert-failed records = [], want one ERROR`;
    - `unusable-quote records = [per-position WARNs], want exactly one`;
    - `close 2..9 level INFO, want DEBUG`;
    - `resumed records = [], want one INFO`;
    - `4th close consecutive_graceful 4, want 1`.
  - **Probe 3** logged "resumed" unconditionally and the aggregate WARN without ctx. RED: `resumed records = [...consecutive_graceful:1], want none` in both subcases, and `trace_id = "", want <span id>`. The trace_id check still failed against the ctx-less WARN after the import change described below.
  - **Red N/A:** the AC-56 parity clause and the 2 s sleep clause. They characterize unchanged behavior.
- **GREEN**, the step's Verification run as split invocations:
  - `go test ./... -race -count=1 -coverprofile ... -coverpkg=<config,marketsession,middleware,mtls>`: ok in all packages.
  - The `awk` gate: `total: 68.6%` (at or above 40).
  - `golangci-lint run`: `0 issues.`; `gofmt -l`: clean.
  - Flake check: the new tests passed `-count=5 -race` (50/50 top-level passes).
  - `getpnl_source_parity_test.go` and `offline_valuation_test.go` passed unmodified.
- **`go.mod` side effect avoided.** An earlier draft imported `go.opentelemetry.io/otel/trace` for the AC-11 check, and `golangci-lint --modules-download-mode=mod` then promoted it to a direct requirement in `go.mod`. `go.mod` is not in Files. The import was replaced with `propagation.TraceContext` (from the root `otel` module, already a direct requirement) and `go.mod` was restored, so it is unchanged.
- **Tooling.** go 1.27.0 and golangci-lint 2.14.0 were present; nothing was installed. `node_modules` is symlinked from the main worktree (untracked, not staged). `core.hooksPath` (`/home/user/xstockstrat/.husky/_`) does not exist, so the husky pre-commit hook did not run. `--no-verify` was not used.
- **Files modified:** `services/xstockstrat-portfolio/internal/service/portfolio_telemetry_test.go`
- **Deviations:** two, both in the Deviation Log. Verification ran as split invocations (CI-equivalent fallback). AC-11 and AC-56 needed test realizations: the trace id is read from the record's context, and AC-56 compares the `observed` wrapper against the raw handler.

### Step 11 — service: Marketdata stream, vendor, backfill and poller signals (SEV-2) [done]
- **Discovery.** After `git checkout --detach origin/ccr-b4aace27-zvuaby` (HEAD `3ba5d7eb`) every anchor matched: warm poller `:1119` (body `:1149-1188`), `runQuoteRetentionStep :1057`, `BackfillBars :1375`, `BackfillFundamentals :2159`, stream `run :166`/give-up `:197-201`/`conn.Read :264`, `do() :83`, FMP `getJSON :235`, Finnhub `:110`, EDGAR `get :75`, `fillEtfFlag :130`, `alpacaClient` `main.go:93`. The digest's "no `LogTickOK`/`Loop`" caveat was stale: Step 1 put them in `internal/telemetry/otel.go:266-292`.
- **Instruction 0 (characterize first).** Baseline `go test ./internal/service/... ./internal/alpaca/... -race` ok on the untouched tree. Then the verbatim move: the per-cycle body (from `since := s.quoteSince()`) became `warmQuotesOnce(ctx, symbols)`, with its two cycle-ending `continue`s turned into `return`; the outer loop's `NewTicker`, pause `continue` and `ticker.Reset` were untouched. Three characterization tests in `marketdata_service_test.go` (`TestWarmQuotesOnce_MultiPathCacheInsertFailureContinues`, `..._PerSymbolFallbackCacheInsertFailureContinues`, `..._RegistryErrorEndsCycle`) passed on the verbatim move, then the same command was green again before any signal code. The tests record every level, so they still hold after the DEBUG demotion. New fakes (`warmLogRecorder`, `failingInsertStore`, `perSymbolQuoteSource`, `warmQuotes`) have one consumer (C-13: inline); they reuse `fakeQuoteStore`, `fakeMultiSource`, `newQuoteSvc`, `quoteAt` and `recordedLog`.
- **`internal/telemetry/otel.go`.** Keys `vendor`, `op`, `outcome`, `result`, `kind`. Six `Loop` constants plus `Loops` (`bar_ingest`, `classification_refresh` and `asset_refresh` KEPT, never written through `LogTickOK`). The vendor/outcome/stream/backfill label constants, `HTTPErrorOutcome`, and the rebinding instruments `marketdata.vendor.requests`, `marketdata.vendor.request.duration` (s), `marketdata.stream.reconnects`, `marketdata.backfill.symbols`, each behind a `Record*` helper (`RecordVendorRequest` applies the `ctx`-wins rule and records a duration only when a request was sent). `RegisterStreamLastMessageAge(read, now)` holds the observable gauge `marketdata.stream.last_message_age` (s).
- **Vendor chokepoints.** FMP `getJSON`, Finnhub `getJSON`, EDGAR `get` and Alpaca `do()` each record once per call, with closed `op` sets (`fmpOp`, `finnhubOp`, `edgarOp`, `alpacaOp`; anything else is `other`). Labels carry only the vendor, op and outcome constants, never a URL, key, token or symbol. No span or log was added.
- **Stream.** `streamManager.lastFrame` (atomic unix nanos) and `now` (nil = `time.Now`), stored after the read error check and before `json.Unmarshal`, reset at `run()` entry. `Client.StreamLastFrame()` reads through `streamMgr()` and returns `ok = running && lastFrame != 0` (running read under `m.mu`). `reconnects{reconnected}` after each backoff wait, `{gave_up}` beside the give-up ERROR. `cmd/server/main.go` makes the one `telemetry.RegisterStreamLastMessageAge(alpacaClient.StreamLastFrame, time.Now)` call.
- **Service.** `backfill.symbols{bars|fundamentals, written|empty|failed}` per symbol (responses and the nil error unchanged). Warm poller: per-symbol `"warm poller: cache insert failed"` now DEBUG (text unchanged), one `"warm poller: cache insert failures"` WARN per cycle with `count` and up to `warmInsertFailureSample` (5) `sample_symbols`; `warm_quote` record after a multi-path cycle or a fallback with `fetched > 0`, `idle`/`paused` in the outer loop. `quote_retention`: `skipped` (the WARN stays), `disabled` (`s.retention == nil`), ok after a successful drop, none on a drop error. `etf_flag_filler`: a `TickThrottle` in `etfFlagState` (60 s leading edge on the `etf.now` clock), `disabled`/`budget` on the skip path, ok after a fetch, none on a `FetchIsEtf` error. `asset_servability.go` and the KEPT cycle records are untouched.
- **TDD (Step 7's protocol).** An uncommitted probe (`zz_step11_probe_test.go` in `internal/service`, `internal/alpaca`, `internal/fmp`; pre-existing symbols only) was RED before the signal code, with assertion failures, not compile errors: `backfill.symbols{bars,failed} = 0, want 1`, `{bars,empty} = 0, want 1`; `aggregate cache-insert WARN records = 0, want 1 with count=3`; `warm_quote tick records = 0, want 1`; `quote_retention disabled tick records = 0, want 1`; `reconnects{gave_up} = 0, want 1`, `{reconnected} = 0, want 2`; `vendor.requests{alpaca,quotes_latest,ok} = 0, want 1`; `vendor.requests{fmp,profile,http_429} = 0, want 1` and `vendor.request.duration samples = 0, want 1`. GREEN after implementation (`-race -count=3`), plus two extra probe cases: the filler's throttle (one record inside 60 s, none on a fetch error, `disabled` at cap 0) and `lastFrameTime` (no frame while idle, the injected time after a frame, no sample after give-up). The probes were deleted and never committed; Step 12 writes the committed new-behavior tests.
- **Verification** (worktree root, split invocations; Deviation Log): `git add -A services/xstockstrat-marketdata`; the staged-diff grep for removed `time.NewTicker`/`ticker.Reset`/`paused via config` lines matched 0 (pass); `go build ./...` ok; `go test ./internal/service/... ./internal/alpaca/... -race -count=1` ok; `golangci-lint run --modules-download-mode=mod` `0 issues.`; `grep -rn otelhttp` found nothing. Also: the whole module `go test ./... -race` ok, `gofmt -l` clean, `go.mod` unchanged. No config key touched, so the config-wiring gate does not apply.
- **Tooling.** go 1.27.0 and golangci-lint 2.14.0 (built with go1.27.0) present; nothing installed. `node_modules` symlinked from the main worktree (untracked, not staged).
- **Files modified:** `services/xstockstrat-marketdata/internal/telemetry/otel.go`, `internal/alpaca/stream.go`, `internal/alpaca/client.go`, `internal/fmp/fmp_client.go`, `internal/finnhub/finnhub_client.go`, `internal/edgar/edgar_client.go`, `internal/service/marketdata_service.go`, `internal/service/etf_flags.go`, `cmd/server/main.go`, `internal/service/marketdata_service_test.go` (all under `services/xstockstrat-marketdata/`)
- **Deviations:** two, both in the Deviation Log: verification from the worktree root (CI-equivalent fallback), and the implementation details the spec left open (reconnect counting point, `not_wired` → `disabled`, stage-variable outcome classification, tick clocks, gauge re-pointing).
- **Open for Step 12:** AC-14 needs `written` +2, but `BackfillBars` writes through the concrete `*repository.MarketDataRepo` (`s.repo.InsertBars`), which has no test seam; the existing `TestBackfillBars_EnumOnlyRequestResolves` avoids it by returning zero bars. Step 12 will need a realization (or a blocker) for the `written` count.

### Step 12 — test: Marketdata telemetry tests [done]
- **Blocker and operator decision.** The first Step 12 run stopped on the open item above. The operator chose Option A on 2026-11-06: add a minimal bar-insert seam. `marketdata_service.go` now has an unexported `barInserter` interface and a `MarketDataService.barInserter` field, set from `repo` beside `svc.prevClose = repo`, and `BackfillBars` calls it. There is no behavior change. The file was added to this step's staged files, and the Deviation Log records it as an announced, operator-approved out-of-scope change.
- **Discovery.** After `git checkout --detach origin/ccr-b4aace27-zvuaby` (HEAD `6f055427`, Step 11), every symbol the digest had listed as "not found" existed: `telemetry.RegisterStreamLastMessageAge`, `(*Client).StreamLastFrame`, `streamManager.lastFrame`/`now`, the five instruments, the `Record*` helpers, `Loop` constants plus `Loops`, `warmQuotesOnce`, the aggregate WARN and the `LogTickOK` records. That digest was taken before Step 11 landed.
- **Tests added.**
  - `alpaca/stream_metrics_test.go`: AC-12 age 30 s while reconnecting, `reconnected` 4, `gave_up` 1, no sample after give-up; a lazy manager reports nothing.
  - `alpaca/client_test.go`: `do()` `ok` and `ctx`.
  - `fmp/fmp_client_test.go`: AC-13 429 on `/stable/profile?symbol=AAPL&apikey=SECRET123`, with no key in a metric attribute, span or log, and no symbol in an attribute; `cap` and `throttle` record no duration.
  - `finnhub/finnhub_client_test.go`: token 429, plus `ok`/`http_5xx`/`decode`/`transport`/`ctx`.
  - `edgar/edgar_client_test.go`: `ok`/`http_5xx`/`http_429`/`decode`, with no symbol or CIK in an attribute.
  - `service/marketdata_service_test.go`: AC-14 counts; AC-46 aggregate; `warm_quote` none on a registry error or a fallback with nothing fetched; `quote_retention` `skipped`/`disabled`/ok/none on drop error; bar ingest keeps only its cycle record.
  - `service/etf_flags_test.go`: `etf_flag_filler` one record per 60 s, none on a fetch error, `disabled`/`budget`.
  - Every tick assertion also checks AC-7: the loop is in `telemetry.Loops` (at most 8), and the record has no symbol attribute and no symbol value.
- **Test helpers (C-13).** A per-package manual-reader `vendorMetricReader`/`collectVendorMetrics` is duplicated in the four vendor packages, because test helpers cannot cross packages and `jscpd` ignores `*_test.go`. Service-side: `serviceMetricReader`, `backfillSymbolCounts`, `tickRecords`, `backfillOutcomeSource` (reuses `fakeBackfillSource`), `failingBarInserter`. `recordedLog` gained `level`, filled only by `warmLogRecorder`. Each has one consumer, so it stays inline.
- **TDD.** Same uncommitted-probe protocol as Steps 10 and 11. The probe made `LogTickOK`, `RecordVendorRequest`, `RecordStreamReconnect`, `RecordBackfillSymbol` and `RegisterStreamLastMessageAge` early returns. It also returned early from `logWarmInsertFailures` and put the per-symbol `cache insert failed` back at WARN.
  - RED (assertion failures, not compile errors):
    - AC-12 `last_message_age while reconnecting = [], want [30]`
    - AC-13 `vendor.requests{alpaca,quotes_latest,ok} = 0, want 1`, `{alpaca,quotes_latest,ctx} = 0`, `{fmp,profile,http_429} = 0`, `{fmp,profile,cap} = 0`, `{fmp,profile,throttle} = 0`, `{finnhub,metric,http_429} = 0`, the Finnhub and EDGAR outcome tables `map[]`
    - AC-14 `backfill.symbols = map[], want map[bars/empty:1 bars/failed:2 bars/written:2]`
    - AC-46 `aggregate records = [], want one WARN with count=8`
    - quote_retention and etf_flag_filler `tick records = []`
  - The absence tests (no tick without progress, bar ingest, lazy manager) pass in both runs by design.
  - Before the seam existed, AC-14 could not compile (`barInserter` undefined).
  - The probe was restored from scratchpad copies and never committed. GREEN is the Verification below; the new tests passed `-race -count=10`.
- **Verification** (split invocations, Deviation Log):
  - `GOWORK=off go test ./... -race -count=1 -coverpkg=<COVERPKGS>` ok on all 15 packages.
  - `go tool cover -func` total **83.6%** (≥ 40%, `awk` exit 0).
  - `golangci-lint run --modules-download-mode=mod` `0 issues.` (after switching the deprecated `attribute.Value.Emit` to `String` in the new helpers).
  - `gofmt -l` clean; `go.mod`/`go.sum` unchanged.
  - No config key touched.
- **Tooling.** go 1.27.0 and golangci-lint 2.14.0 present; nothing installed. `node_modules` symlinked from the main worktree (untracked, not staged).
- **Files modified** (all under `services/xstockstrat-marketdata/internal/`): `alpaca/stream_metrics_test.go` (new), `alpaca/client_test.go`, `fmp/fmp_client_test.go`, `finnhub/finnhub_client_test.go`, `edgar/edgar_client_test.go`, `service/marketdata_service_test.go`, `service/etf_flags_test.go`, and `service/marketdata_service.go` (approved seam).
- **Deviations:** three, all in the Deviation Log: the operator-approved bar-insert seam, the split verification (CI-equivalent fallback), and the test realizations.

### Step 13 — service: Analysis live-loop, fundsignal and tick signals (SEV-2) [done]
- **Discovery.** The step ran after `git checkout --detach origin/ccr-b4aace27-zvuaby` (HEAD `1d4b030e`, Step 12). The digest said `app/telemetry.py` had no `Loop`, `log_tick_ok` or instruments. That was stale: Step 3 had already added `Counter`/`Histogram`/`Gauge`, `LOOP_TICK_OK`, an empty `class Loop(StrEnum)` and `log_tick_ok`. Every other anchor matched. `live_loop.py` sites sit about +8 lines from the spec (215 code) and were placed by anchor.
- **`app/telemetry.py`.**
  - Five `Loop` members: `fundsignal`, `opportunity_refresh`, `readiness_materializer`, `template_intent_sweep`, `pnl_consumer`.
  - Label keys `KEY_OUTCOME`/`KEY_SOURCE`/`KEY_TRIGGER`/`KEY_KIND`/`KEY_SERVICE`.
  - Seven rebinding instruments, each behind a `record_*` helper: `analysis.live_loop.pairs`, `.drain_failures`, `.triggers`, `.cycle.duration` (s), `analysis.fundsignal.signals`, `analysis.opportunity.recompute`, `template.instantiate`. `record_template_instantiate(code)` maps the closed code set to names and anything else to `other`.
- **`live_loop.py`.**
  - Pair outcomes `ok`/`no_bars`/`error` in the per-pair handler, and drain failures `signals`/`held`/`watchlist`.
  - Triggers: `throttled` at the throttle, plus the `try/except: record alert_failed; raise` wrap at `_emit_alert`, with `alerted` after it returns.
  - The cycle-duration histogram sits in a `finally`, and `exc_info=True` was added on the cycle error.
  - The `live_loop: cycle complete` literal is unchanged (count 1). Untouched: `_TRUNCATION_COUNTER`, the 215 FR-4 block and `_emit_fundamentals_unavailable_alert`.
- **`fundsignal_loop.py`.**
  - The keyword-only `_emit_counts` sink, with `attempted` counted after `confirmed = False`, and a new `else:` that records `emit_failed` and `signals{failed}`. `signals{emitted}` is recorded beside `emitted += 1`.
  - `_finish` gains the summary kwargs and writes one `"fundsignal run summary"` INFO. `_abort_cycle` forwards the counts.
  - `_tick` passes the sink and writes `loop tick ok` through `_log_tick` in the `try/else` (failure rules per design.md 1.3; `idle`; `disabled` at the early return). `exc_info=True` on `"fundsignal: cycle error"`.
  - Unchanged: run status, release-on-failed-emit and the `signals_emitted` accounting.
- **`servicer.py`.**
  - `template.instantiate` is recorded before every `context.abort`, plus `ok` on success.
  - `opportunity.recompute{full|retry, ok|failed}`, with `exc_info=True` on the full-recompute WARN.
  - `_log_items_tick` drives the three tick records: opportunity refresh, readiness materializer (also `disabled`), and template sweep (with an `enum_failed` flag).
  - `"PIT fundamentals loaded"` moved INFO→DEBUG with its text unchanged.
- **Other files.** `pnl_pattern_consumer.py`: a 60 s throttled `pnl_consumer` tick after `_process_with_retry`. `supervision.py`: `exc_info=True` on the seed and tick errors. `evaluator.py`: the `fundamentals formula=` INFO→DEBUG, the only change in the file.
- **TDD (Steps 7-12 protocol).** The uncommitted probe `tests/test_zz_step13_probe.py` (pre-existing symbols only, 10 tests) failed RED before implementation, with assertion failures and no import errors:
  - `live_loop.pairs{error} = 0 == 2`
  - `triggers{entry,alerted} = 0 == 1`
  - `cycle error exc_info None`
  - `fundsignal.signals{failed} = 0 == 3`
  - `fundsignal ticks len([]) == 1`
  - `tick error exc_info None`
  - `template.instantiate{analysis,already_exists} = 0 == 1`
  - `opportunity.recompute{full,failed} = 0 == 1`
  - `pnl_consumer ticks len([]) == 1`
  - `fundamentals formula log not log.debug(`

  GREEN after implementation: `10 passed`. The probe was copied to the scratchpad, deleted, and never committed. Step 14 writes the committed tests.
- **Verification** (worktree root, scratchpad script; Deviation Log): `git add -A services/xstockstrat-analysis`. The hunk guards derived the ranges from `HEAD`: FR-4 `741-768`, `_emit_fundamentals_unavailable_alert` `884-899`, `RunBacktest` `799-824`, `_run_backtest` `826-1428`, and `_fundamentals_formula_series` `552-623`, with the exact INFO→DEBUG evaluator diff. The script printed `guards OK`. `ruff check .` gave `All checks passed!`, `ruff format --check .` gave `123 files already formatted`, and `grep -c "live_loop: cycle complete"` gave `1`. Also `uv run pytest --cov=app --cov-fail-under=40`: `1543 passed`, 90.36%. No config key touched.
- **Tooling.** uv 0.11.32. `uv sync --extra dev` installed the locked dev deps into the service venv; `uv.lock` is unchanged. `node_modules` is symlinked from the main worktree (untracked, not staged).
- **Files modified** (all under `services/xstockstrat-analysis/app/`): `telemetry.py`, `engine/live_loop.py`, `engine/fundsignal_loop.py`, `engine/pnl_pattern_consumer.py`, `handlers/servicer.py`, `supervision.py`, `services/evaluator.py`
- **Deviations:** two, both in the Deviation Log: verification from the worktree root (CI-equivalent fallback), and the implementation details the spec left open (abort-site recording, cycle-duration `finally`, summary fields and placement, the `try/else` tick record, the local pnl throttle, `_log_items_tick`).

### Step 14 — test: Analysis telemetry tests [done]
- **Discovery.** The digest was stale: it said Step 13 had not landed. After `git checkout --detach origin/ccr-b4aace27-zvuaby` (HEAD `7da62f90`, Step 13), every symbol the tests need resolved:
  - the seven `record_*` helpers and five `Loop` members in `app/telemetry.py`;
  - the live-loop pair, drain and trigger calls, plus the `cycle.duration` `finally`;
  - the fundsignal `_emit_counts` sink, `_log_tick` and `"fundsignal run summary"`;
  - `_log_items_tick`, the `template.instantiate` and `opportunity.recompute` calls, and the pnl `_log_tick`;
  - `exc_info=True` on the cycle, tick and seed errors, and the DEBUG `fundamentals formula=`.
  - The `metric_reader` fixture lives in `tests/test_telemetry.py` and is rebound by module assignment, as `test_telemetry_instruments.py` does.
- **Tests added.**
  - `tests/test_live_loop_telemetry.py` (9 tests):
    - AC-15: 10 erroring pairs give `pairs{error}` 10 and one `live_loop: cycle complete`; `ok`/`no_bars` are counted.
    - AC-16: `drain_failures{held}` for owner `o-1`, plus `signals` and `watchlist`, and no attribute contains `o-1`.
    - AC-18: a `KeyError('x')` cycle error carries `exc_info`; `fundamentals formula=` is logged at DEBUG.
    - AC-51: `triggers{entry,alerted}` 1 and `{exit,throttled}` 1 at a 60 s interval, and one unlabelled `cycle.duration` sample of 1.4 s. An `alert_failed` characterization checks the exception still propagates and the transition retries.
    - AC-7: the live loop writes only its cycle literal.
  - `tests/test_fundsignal_loop.py`, new class `TestRunSummaryTelemetry` (5 tests):
    - AC-17 on the `_tick` path: `signals{failed}` 150, exactly one INFO summary (universe 200, scored 150, attempted 150, emitted 0, emit_failed 150), no `fundsignal` tick record, and run status `completed` as today.
    - AC-17 on the RPC path: the same summary is logged without a sink.
    - AC-7: a successful tick writes one record, `idle` and `disabled` carry `state`, and no symbol appears in a record.
    - AC-51: the cycle error carries `exc_info` and writes no record.
    - The existing `AsyncMock(run_once)` tests are unchanged and green.
  - `tests/test_analysis_tick_telemetry.py` (11 tests):
    - Tick records for `opportunity_refresh` (ok, idle, none when every user failed), `readiness_materializer` (disabled, idle) and `template_intent_sweep` (ok, idle, none on an enumeration failure while the schedule still advances).
    - `pnl_consumer`: one record per 60 s window over a real 3-event stream.
    - AC-7: all five names, `len(Loop) <= 8`, and no owner, intent or symbol in any record.
    - AC-51: `opportunity.recompute{full,failed}` with `exc_info`, plus full/retry `ok`/`failed`; supervised tick and seed errors carry `exc_info`.
    - AC-39 analysis half: `already_exists`, `ok` and `not_found`; an unmapped code maps to `other`.
- **C-13.** Existing fixtures are reused:
  - `_make_loop`, `_live_row`, `_decision`, `_bar_at`, `_StopLoop` (live loop);
  - `_make_loop`, `_fund`, `_rpc_error`, `_scan_via_rpc` (fundsignal);
  - `make_servicer`;
  - `_svc`, `_instantiate`, `_intent`, `_schedule`, `FakeIntents`, `FakeStrategies` (templates);
  - `streaming_consumer`, `run_until_stopped`, `sleeps` (pnl consumer);
  - the fscore fixtures from `test_fundamentals_guard.py`, and `_data_points` from `test_telemetry_instruments.py`.

  There are no new fakes. The helpers `metric_sum`, `all_attribute_values` and `_emit_failure_loop` each live in one file and are imported by the others. `tests/conftest.py` is unchanged.
- **TDD.** For RED, the six Step 13 call-site files were checked out from `1d4b030e` in the working tree, and Step 13's `telemetry.py` was kept so names resolve. `git checkout HEAD -- services/xstockstrat-analysis/app` then restored them; `git status` showed only the three test files.
  - RED result: `23 failed, 76 passed`, all assertion failures. Examples: `pairs{error} 0 == 10`, `drain_failures 0 == 1`, `cycle error exc_info None`, `fundamentals formula levelno 20 == 10`, `triggers{entry,alerted} 0 == 1`, `alert_failed 0 == 1`, tick records `expected 1, got 0` (refresh, materializer, sweep), pnl ticks `0 == 2` and `0 == 1`, AC-7 loop names `set() == {five names}`, `recompute{full,failed} 0 == 1`, `seed exc_info None`, `template.instantiate{already_exists} 0 == 1`, `fundsignal.signals{failed} 0 == 150`, summary `expected 1, got 0`, `fundsignal cycle error exc_info None`.
  - Two new tests pass in RED by design: the live-loop literal characterization and the `other` mapping unit test of the kept helper. The 74 existing fundsignal tests stayed green.
- **Verification** (separate invocations, Deviation Log):
  - `uv run pytest --cov=app --cov-fail-under=40 -q`: `1568 passed`, 90.73%.
  - `uv run ruff check .`: `All checks passed!`
  - `uv run ruff format --check .`: `125 files already formatted`.
  - Flake check: the three files passed 5 consecutive runs (99/99 each).
  - No config key touched.
- **Tooling.** uv 0.11.32. `uv sync --extra dev` installed the locked dev deps into the service venv; `uv.lock` is unchanged. `node_modules` is symlinked from the main worktree (untracked, not staged).
- **Files modified:** `services/xstockstrat-analysis/tests/test_live_loop_telemetry.py` (new), `services/xstockstrat-analysis/tests/test_fundsignal_loop.py`, `services/xstockstrat-analysis/tests/test_analysis_tick_telemetry.py` (new)
- **Deviations:** two, both in the Deviation Log: the separate-invocation verification (CI-equivalent fallback), and the test realizations (AC-17 status `completed`, AC-18 direct evaluator call, AC-51 fake clock and seeded exit, the RED protocol, C-13 helper placement).

### Step 15 — service: Agent auth, OAuth, backend and degraded signals (SEV-2) [done]
- **Discovery.** Ran after `git checkout --detach origin/ccr-b4aace27-zvuaby` (HEAD `790f9b1f`, Step 14). The digest was stale on one point: it said Step 3 was pending, but `app/telemetry.py` already had Step 3's `Counter`/`Histogram`/`Gauge` accessors. Every other anchor matched. `tools.py` sites sat a few lines off the spec's citations and were placed by anchor.
- **`app/telemetry.py`.** Label keys `KEY_REASON`/`KEY_GRANT_TYPE`/`KEY_OUTCOME`/`KEY_BACKEND`/`KEY_GRPC_CODE`/`KEY_KIND`, and five rebinding counters: `mcp.auth.rejected`, `oauth.requests`, `oauth.txn.rejected`, `agent.backend.rpc_errors`, `agent.degraded`.
- **`app/tool_metrics.py`.** Record helpers `record_auth_rejected`, `record_oauth_request` (grant clamp), `record_oauth_txn_rejected`, `record_backend_rpc_error` (backend clamp, `StatusCode` name), `record_degraded`. `_log_first_call` writes one INFO `"first successful tool call"` with `user_id` as a field, from `ToolMetricsMiddleware.__call__`'s `finally` when `outcome == "ok"` and the tool is registered; the seen-set is capped at `_FIRST_CALL_SEEN_CAP = 10000` (nothing added, evicted or logged at the cap). `mcp.tool.duration` and its attributes are unchanged.
- **`app/mtls.py`.** `_CountingChannel(inner, backend)`: `__aenter__` returns the inner channel, `__aexit__` counts an `AioRpcError` (inside `try/except`), awaits the inner exit and returns `False`, `__getattr__` delegates. `secure_channel` still calls `channel_credentials()` eagerly.
- **`app/auth.py` / `app/main.py`.** `wrong_audience`, `identity_unavailable`, `invalid_token`, `internal_error` in `validate_bearer_claims`; the ERROR now names the exception class (`%s: %s`, `type(e).__name__`). `missing_bearer` in `_authorized`. Return values and 401/503 unchanged.
- **`app/oauth_server.py`.** `oauth.txn.rejected{malformed|bad_sig|decode}` in `_verify_txn`, `{state_mismatch}` in `callback`; `oauth.requests` `ok`, `upstream_error`, `invalid_grant`, `error`, `unsupported_grant_type`, with a WARN carrying only the gRPC code name or exception class. `_txn_key` raise left uncaught (NC-4).
- **`app/tools.py`.** `agent.degraded{alert_threshold_default|auto_alert|watchlist_add|policy_default}` at the four swallowed sites; return values unchanged; `_grpc_error_message` untouched (hunk guard).
- **TDD (Steps 7-14 protocol; Step 16 commits the real tests).** The uncommitted probe `tests/test_zz_step15_probe.py` (9 tests, pre-existing symbols only) failed RED before implementation with assertion failures, no import errors: `agent.backend.rpc_errors{analysis,DEADLINE_EXCEEDED} 0 == 1`, `mcp.auth.rejected{internal_error} 0 == 1`, `{wrong_audience} 0 == 1`, `{missing_bearer} 0 == 1`, `oauth.requests{refresh_token,upstream_error} 0 == 1`, `oauth.txn.rejected{bad_sig} 0 == 1`, `agent.degraded{auto_alert} 0 == 1`, `{policy_default} 0 == 1`, first-call INFO `len 0 == 1`. GREEN after implementation: `9 passed`. The probe was copied to the scratchpad, deleted, and never committed. Full suite: `676 passed` (667 + the 9 probe tests).
- **Verification** (worktree root, scratchpad script; Deviation Log): `git add -A services/xstockstrat-agent`; `fn_range_py` gave `_grpc_error_message` `224-253`; `guard OK`; `ruff check .` `All checks passed!`; `ruff format --check .` `66 files already formatted`. No config key touched.
- **Tooling.** uv 0.11.32; `uv sync --extra dev` installed the locked deps into the service venv (`uv.lock` unchanged). `node_modules` symlinked from the main worktree (untracked, not staged).
- **Files modified** (all under `services/xstockstrat-agent/app/`): `telemetry.py`, `tool_metrics.py`, `mtls.py`, `auth.py`, `main.py`, `oauth_server.py`, `tools.py`
- **Deviations:** two, both in the Deviation Log: verification from the worktree root (CI-equivalent fallback), and the implementation details the spec left open (`oauth.requests{ok}`, the grant-failure helper and WARN text, the `state_mismatch` split, the `grpc_code`/backend clamps, the `policy_default`/`alert_threshold_default` scope, the first-call placement and seen-set).

### Step 16 — test: Agent telemetry tests [done]
- **Discovery.** Ran after `git checkout --detach origin/ccr-b4aace27-zvuaby` (HEAD `322e2970`, Step 15). The digest was stale: it reported every Step 15 instrument as not found, but Step 15 had landed. All of these were present at HEAD:
  - `mcp.auth.rejected`, `oauth.requests`, `oauth.txn.rejected`, `agent.backend.rpc_errors` and `agent.degraded` in `app/telemetry.py`;
  - the `record_*` helpers and `_log_first_call` in `app/tool_metrics.py`;
  - `_CountingChannel` in `app/mtls.py`.

  The other anchors matched: the `conftest.py` fixtures that bypass the wrapper, the `metric_reader` fixture, and the `test_mtls.py` fail-closed test at `:119/:121`.
- **Tests added** (8 new tests; 667 to 676):
  - `tests/test_mtls_backend_errors.py` (new, design.md 1.9 a-d):
    - (a) the same `AioRpcError` object propagates, and `{analysis, DEADLINE_EXCEEDED}` is 1.
    - (b) AC-21 end to end: `list_opportunities` runs through `ToolMetricsMiddleware` against the hung loopback analysis server, with `grpc.aio.secure_channel` patched to insecure. `{analysis, DEADLINE_EXCEEDED}` is 1, and `mcp.tool.duration` keeps `{gen_ai.tool.name, outcome}`.
    - (c) a `ValueError` is not counted; the positive control `{ingest, UNAVAILABLE}` is 1.
    - (d) a raising recorder still lets the original error propagate.
  - `tests/test_auth.py`, AC-19: with `MTLS_CERT` unset, a bearer request to `/` returns 401. `mcp.auth.rejected{internal_error}` is 1. The single ERROR names `RuntimeError`, and no log line contains the token.
  - `tests/test_oauth.py`:
    - AC-20: with `refresh_oauth_token` patched to raise UNAVAILABLE for `rt-secret-1`, the response is 400 `{"error": "invalid_grant"}`. `oauth.requests{refresh_token, upstream_error}` is 1, a WARN contains `UNAVAILABLE`, and no log line or label contains the token.
    - AC-47: a forged HMAC on a well-formed txn returns 400, and `oauth.txn.rejected{bad_sig}` is 1.
  - `tests/test_ingest_signal_watchlist.py`, AC-47: `ingest_signal` with conviction 0.9 and `EmitAlert` failing with UNAVAILABLE returns the result unchanged, and `agent.degraded{auto_alert}` is 1.
  - `tests/test_tool_metrics.py`:
    - shared helpers `counter_values` and `all_attribute_values`;
    - AC-47 onboarding: the `authorization_code` exchange gives `oauth.requests{ok}` 1. Two successful `metrics_ok` calls for `u-9` write exactly one INFO `"first successful tool call"` with `user_id` as a record field, and no metric attribute contains `u-9`.
- **TDD.**
  - RED pass 1: the Step 15 call sites were checked out from `790f9b1f`, with Step 15's `telemetry.py` and `tool_metrics.py` kept and `_log_first_call` made to return early. Result: `8 failed, 47 passed`, all assertion failures:
    - `agent.backend.rpc_errors {} == {analysis,DEADLINE_EXCEEDED:1}` (a and b), and `{} == {ingest,UNAVAILABLE:1}` (c);
    - `mcp.auth.rejected {} == {internal_error:1}`;
    - `oauth.requests {} == {refresh_token,upstream_error:1}`;
    - `oauth.txn.rejected {} == {bad_sig:1}`;
    - `agent.degraded {} == {auto_alert:1}`;
    - first-call INFO `0 == 1`.
  - RED pass 2: the `_CountingChannel.__aexit__` guard was removed. Test (d) failed with `RuntimeError: telemetry down` in place of the `AioRpcError`.
  - `git checkout HEAD -- app` restored the tree after each pass. GREEN: `55 passed` across the five files.
- **Verification** (the spec's command, unchanged):
  - `uv run pytest --cov=app --cov-fail-under=40 -q`: `676 passed`, 85.70%.
  - `uv run ruff check .`: `All checks passed!`
  - `uv run ruff format --check .`: `67 files already formatted`.
  - Flake check: the five files passed 5 consecutive runs (55/55 each).
  - No config key touched.
- **Tooling.** uv 0.11.32; `uv sync --extra dev` installed the locked deps into the service venv (`uv.lock` unchanged). The main worktree has no `node_modules`, so there was nothing to symlink; the dangling link was removed. `core.hooksPath` (`/home/user/xstockstrat/.husky/_`) does not exist, so the husky pre-commit hook did not run. `--no-verify` was not used.
- **Files modified:** `services/xstockstrat-agent/tests/test_mtls_backend_errors.py` (new), `services/xstockstrat-agent/tests/test_auth.py`, `services/xstockstrat-agent/tests/test_oauth.py`, `services/xstockstrat-agent/tests/test_ingest_signal_watchlist.py`, `services/xstockstrat-agent/tests/test_tool_metrics.py`
- **Deviations:** one, in the Deviation Log: the test realizations (reusing the existing hung analysis server instead of a new inline fake, where the helpers live, the AC-47 exchange half, the guard tested by (d), and the two-pass RED protocol).

### Step 17 — service: Identity login, token, exchange, refresh and audit signals (SEV-2) [done]
- **Discovery.** Ran after `git checkout --detach origin/ccr-b4aace27-zvuaby` (HEAD `fe2a272a`, Step 16). The digest was stale on one point: it said `src/telemetry.ts` had no metric instruments, but Step 5's `BoundCounter`/`BoundHistogram`/`BoundGauge` accessors were present (and `grpcStatusCode` sits at `:64`, as the re-spec said). Every other anchor matched. "Login" is `authenticateUser` (`:133-184`); `jwtSecret` getter `:113-120`; `validateToken :189`; `refreshToken :210` (rejection `:217-218`); `exchangeAuthCode :480` (rejections `:482-514`, catch `:517-520`); `refreshOAuthToken` rejection `:534`; `auditSafe :728-739`; `ledgerAudit.ts` promise `:55-59`, catch `:60-65`, no deadline.
- **`src/telemetry.ts`.** Keys `KEY_REASON`/`KEY_KIND`/`KEY_EVENT_TYPE`; closed-set unions `LoginFailureReason`, `ValidateFailureReason`, `ExchangeFailureReason`, `RefreshRejectionKind`; `AUDIT_EVENT_TYPES` (the six `identity.user.*` types). Six instruments: `identity.login.failures`, `identity.token.validate_failures`, `identity.oauth.exchange_failures`, `identity.refresh.rejections`, `identity.audit.failures`, `identity.audit.append.duration` (s), each behind a `record*` helper. `RpcDurationProcessor` is untouched.
- **`identityServiceImpl.ts`.** The login reasons `missing_fields`, `unknown_or_inactive`, `blocked_default_admin`, `bad_password` and `internal`. The validate reasons: `missing_token`, then `validateFailureReason(err)` in the catch (env read, `TokenExpiredError`, `JsonWebTokenError`/`NotBeforeError`, `other`), with one `log.error('ValidateToken: JWT secret missing')` per process behind `jwtSecretMissingLogged`. All eight exchange reasons. `refresh.rejections{first_party|oauth}`. Response codes and messages are unchanged, and there is no per-call log for expired or invalid tokens.
- **`ledgerAudit.ts`.** `recordAuditAppendDuration` in a `finally` around the `appendEvent` promise, and `recordAuditFailure(eventType)` in the existing catch, which still swallows. No deadline (guard and grep both clean).
- **TDD (Steps 7-16 protocol; Step 18 commits the real tests).** The uncommitted probe `src/__tests__/zz_step17_probe.test.ts` (4 tests, pre-existing symbols only, inline `CollectingReader`; ledger client stubbed by patching `LedgerServiceClient.prototype.appendEvent` and `mtls.clientCredentials`) failed RED before implementation, with `4 failed` and all of them assertion failures (`actual: 0, expected: 1`), no import errors: `login.failures{bad_password}`, `validate_failures{expired}`, `exchange_failures{replay}`, `audit.failures{identity.user.created}`. GREEN after implementation: `4 passed` (it also asserts `{unknown_or_inactive}`, `{invalid}`, `{secret_missing}`, `refresh.rejections{first_party}` and one `audit.append.duration` sample). The probe was copied to the scratchpad, deleted, and never committed. Full suite: `143 passed`, 0 failed.
- **Verification** (separate invocations; Deviation Log): `git add -A services/xstockstrat-identity` stages only the three Files. The staged-diff `deadline` guard exits 0. `pnpm run lint` gives `0 errors` (236 warnings, all `no-explicit-any`; the new `validateFailureReason(err: any)` adds one, following the file's untyped-handler house style). `pnpm exec tsc --noEmit` exits 0, and `! grep -in deadline src/grpc/ledgerAudit.ts` exits 0. `prettier --check` is clean on `telemetry.ts`; the remaining `prettier` diffs in `identityServiceImpl.ts`/`ledgerAudit.ts` are pre-existing lines this step did not touch. No config key touched.
- **Tooling.** node v24.22.1 and pnpm 9.15.9 present. `pnpm install --frozen-lockfile` was filtered to the root, `@xstockstrat/proto` and identity; the lockfile did not change. The main worktree has no `node_modules`, so the symlink was dangling and removed. The root `prepare` (`husky`) rewrote the shared `core.hooksPath` from `/home/user/xstockstrat/.husky/_` to `.husky/_`, so the pre-commit hook runs on this commit. It is restored after pushing (out-of-scope side effect, as at Steps 5 and 6).
- **Files modified:** `services/xstockstrat-identity/src/telemetry.ts`, `services/xstockstrat-identity/src/grpc/identityServiceImpl.ts`, `services/xstockstrat-identity/src/grpc/ledgerAudit.ts`
- **Deviations:** two, both in the Deviation Log: the separate-invocation verification (CI-equivalent fallback), and the implementation details the spec left open (`record*` helpers with typed unions, the full-string `event_type` with `other`, the unlabelled `s` duration in a `finally`, the un-resettable once-per-process flag Step 18 must respect, and the block-form rejections).

### Step 18 — test: Identity telemetry tests [done]
- **Discovery.** Ran after the detached checkout of `origin/ccr-b4aace27-zvuaby` (HEAD `ced97247`, Step 17). The digest was stale: it reported Step 17's instruments, the `record*` helpers and the `JWT secret missing` log as not found, but Step 17 had landed and all of them were present at HEAD. It was right that `CollectingReader` was private to `telemetry.test.ts` and that `fixtures/` held only `otlpReceiver.ts`. That was the Step 18 blocker, resolved by operator Option A (2026-11-06).
- **Fixture (operator-approved out-of-scope move).** New `src/__tests__/fixtures/collectingReader.ts` exports `CollectingReader`, `install`, `values`, `points` and `counterValue`. `telemetry.test.ts` and `telemetryInstruments.test.ts` import it, and their inline copies are deleted.
- **Tests added** (5 new tests; 139 to 144):
  - `identityServiceImpl.test.ts`:
    - AC-22: a wrong password for `a@example.com` and an unknown `nobody@example.com` add +1 each to `login.failures{bad_password}` and `{unknown_or_inactive}`. Both responses are `{code 16, "invalid credentials"}`. stdout never contains `a@example.com`, and no metric label contains `@`.
    - AC-52 replay: the second exchange adds +1 to `exchange_failures{replay}` and gets `{16, invalid_grant}`.
    - AC-52 first-party: an expired refresh token adds +1 to `refresh.rejections{first_party}` and gets `{16, "invalid or expired refresh token"}`.
  - `identityTelemetry.test.ts` (new):
    - AC-23: `expired` and `invalid` read 1 each, with no stdout during those calls. `secret_missing` reads 2 after two unset-secret calls, with exactly one `error` line `ValidateToken: JWT secret missing` and no token in the output. All four responses are `{16, "invalid or expired token"}`.
    - AC-24: `audit.failures{identity.user.created}` reads 1, and `audit.append.duration` has a count of 1. AppendEvent was called once as `(request, Metadata, callback)`, with no deadline.
- **TDD.**
  - RED: the Step 17 call sites were checked out from `fe2a272a`, keeping Step 17's `telemetry.ts`. The four target files gave `5 failed, 95 passed`. Every failure was an assertion (`actual: 0, expected: 1`) and none was an import error: AC-22, both AC-52 cases, AC-23 and AC-24.
  - The tree was restored from `HEAD`. GREEN: `144 passed`, 0 failed.
  - Mutation check: deleting `jwtSecretMissingLogged = true` in the built JS failed AC-23 with "expected one ERROR". The rebuild restored it.
  - Flake check: the two files passed 5 consecutive runs (83/83 each).
- **Verification** (the spec's command, unchanged):
  - `pnpm run test:coverage`: `144 passed`, All files 81.29% lines.
  - `pnpm exec c8 check-coverage --lines 40`: exit 0.
  - `pnpm run lint`: `0 errors`. Warnings went from 236 to 248. The 12 new ones (7 in the new files, 5 in `identityServiceImpl.test.ts`) are all `no-explicit-any` in the new test code, following the file's untyped-handler house style.
  - `prettier --check` is clean on every file this step touched.
  - No config key touched.
- **Tooling.** node v24.22.1 and pnpm 9.15.9. The main worktree has no `node_modules`, so the symlink would have dangled and was removed. `pnpm install --frozen-lockfile` was filtered to the root, `@xstockstrat/proto` and identity; the lockfile did not change. The root `prepare` (`husky`) set the shared `core.hooksPath` to `.husky/_`, so the pre-commit hook runs on this commit. It is restored to `/home/user/xstockstrat/.husky/_` after pushing (out-of-scope side effect, as at Steps 5, 6 and 17).
- **Files modified** (all under `services/xstockstrat-identity/src/__tests__/`):
  - `identityServiceImpl.test.ts`
  - `identityTelemetry.test.ts` (new)
  - `fixtures/collectingReader.ts` (new, operator-approved)
  - `telemetry.test.ts` (operator-approved)
  - `telemetryInstruments.test.ts` (operator-approved)
- **Deviations:** two, both in the Deviation Log: the shared `CollectingReader` fixture (an announced out-of-scope change, operator-approved), and the test realizations (where each scenario lives, the delta assertions, the two-call `secret_missing` case, the AC-24 module mock and the RED protocol).

### Step 19 — service: Config GetSecret/SetConfig attribution, listener health and ledger notifier (SEV-2) [done]
- **Discovery.** Ran after `git checkout --detach origin/ccr-b4aace27-zvuaby` (HEAD `218c9257`, Step 18). The digest was stale on two points. First, it said neither `telemetry.ts` had accessors, but Step 5's `BoundCounter`/`BoundHistogram`/`BoundGauge` were present in both. Second, it said the spec's `configServiceImpl.ts` line numbers were off by 1-3, but the tree matches the re-spec'd anchors exactly: `connectedOnce :176`, `connectListener :197`, reload `:208`, `dropListener :219`/`:220`, `reloadAll` loop closing `:297`, `reloadNamespace` set closing `:319`, `endSubscriber :377`, WatchConfig error `:409`, `getSecret :467`/`:470`/`:485`/`:497`/`:498-500`, `setConfig :503` (denials `:519-538`). The `authz.ts` and `eventNotifier.ts` anchors matched.
- **Config.**
  - `src/telemetry.ts` adds `config.listener_up`, `config.last_reload_timestamp` (unix s), `config.listener_reconnects` and `config.watch.terminated{reason}`, behind `setListenerUp`, `setLastReloadTimestamp`, `recordListenerReconnect` and `recordWatchTerminated`.
  - `authz.ts` appends `secretDenialReason` and `hasPeerDnsSan` after `SECRET_SCOPE_ERROR`.
  - In `configServiceImpl.ts`:
    - GetSecret: the denial log gains `callerId` (64), `reason` and `hadPeerSan`. `GetSecret served` is written once per not-found or success reply and never carries the value. The outer catch now logs `GetSecret DB error`.
    - SetConfig: the denials carry `reason`. An internal-caller global denial is ERROR with `internalCaller` (and `targetState` only for `platform.trading_state`).
    - WatchConfig: the error handler logs a WARN and counts `{client_error}`, and `endSubscriber` counts `{server_error}`.
    - Listener: `reconnected` is captured before the reload. The gauge is set to 1 and the reconnect counter incremented only while `this.listener === client`. `dropListener` sets the gauge to 0. The last-reload timestamp is set after both reloads.
- **Ledger.**
  - `src/telemetry.ts` adds `ledger.notify.listener_up` and `ledger.notify.listener_reconnects`.
  - In `eventNotifier.ts`, the gauge is set to 1 and `consecutiveFailures` reset right after `this.client = client`. `scheduleReconnect` sets the gauge to 0 first. The counter increments when `reconnected`.
  - Both WARNs log only at failure 1 and every 10th, with `consecutive_failures`. The `error` handler counts only when `this.client === client`. The reconnect timing is unchanged.
- **TDD** (the Steps 7-18 protocol; Step 20 commits the real tests). Two uncommitted probes, `src/__tests__/zz_step19_probe.test.ts` in config (4 tests) and in ledger (2 tests), used only pre-existing symbols: an inline `CollectingReader`, stdout capture and the public impl/notifier.
  - RED before implementation: config `4 failed` and ledger `2 failed`, all of them assertion failures with no import errors. The failures: the denial line had no `callerId` or `reason`; there was no `GetSecret served` line; the SetConfig denial was WARN with no `internalCaller`; `config.listener_up` had no sample; `ledger.notify.listener_up` had no sample; and the storm logged 30 WARNs rather than 4.
  - GREEN after implementation: config `4 passed`, ledger `2 passed`. These also assert `key_not_granted`, `GetSecret DB error`, `listener_up` 1→0→1, `listener_reconnects` 1, one `last_reload_timestamp` sample, `watch.terminated{client_error}` 1 with the WARN line, and storm WARNs at `[1, 10, 20, 30]`.
  - A scratch parity script over 360 grant combinations found 0 `secretDenialReason`/`hasSecretCallerAuthority` mismatches.
  - The probes were copied to the scratchpad, deleted and never committed.
  - Full suites: config `298 passed`, ledger `146 passed`, 0 failed (unchanged from baseline).
- **Verification** (separate invocations; Deviation Log):
  - `pnpm run lint`: `0 errors` in both services, and no warning on an added line.
  - `pnpm exec tsc --noEmit`: exit 0 in both.
  - `git add -A services/xstockstrat-config` staged only the three config Files.
  - Hunk guards: `hasSecretCallerAuthority` 168-183 and `SECRET_CALLER_ALLOWLIST` 132-145 both exit 0. The only `authz.ts` hunk is `@@ -189,0 +190,37 @@`.
  - `prettier --check` is clean on the touched files. The exception is the pre-existing diffs in `configServiceImpl.ts` on lines this step did not touch (22 hunks, 23 at `HEAD`).
  - No config key touched.
- **Tooling.** node v24.22.1 and pnpm 9.15.9 were present. `pnpm install --frozen-lockfile` was filtered to the root, `@xstockstrat/proto`, config and ledger; the lockfile did not change. The main worktree has no `node_modules`, so the symlink dangled and was removed. The root `prepare` (`husky`) set the shared `core.hooksPath` to `.husky/_`, so the pre-commit hook runs on this commit. It is restored to `/home/user/xstockstrat/.husky/_` after pushing (out-of-scope side effect, as at Steps 5, 6, 17 and 18).
- **Files modified:** `services/xstockstrat-config/src/telemetry.ts`, `services/xstockstrat-config/src/grpc/authz.ts`, `services/xstockstrat-config/src/grpc/configServiceImpl.ts`, `services/xstockstrat-ledger/src/telemetry.ts`, `services/xstockstrat-ledger/src/services/eventNotifier.ts`
- **Deviations:** two, both in the Deviation Log: the separate-invocation verification (CI-equivalent fallback), and the implementation details the spec left open (the setter/record helpers, the `hasPeerDnsSan` helper, the `targetState` realization, the truncation helper, and the connect-phase `error` WARN that is now counted by the catch).

### Step 20 — test: Config and ledger telemetry tests [done]
- **Discovery.** Ran after `git checkout --detach origin/ccr-b4aace27-zvuaby` (HEAD `fbd14f40`, Step 19). The digest was stale. It reported `secretDenialReason`, `GetSecret served`, the listener instruments and `consecutive_failures` as not found, but Step 19 had landed and all of them were present at HEAD. Its anchors for the existing tests (`captureStdout`, the `reconnectDelayMs: 1` cases, `callWith`) matched.
- **Tests added** (config 298 → 309, ledger 146 → 149):
  - `secretCallerAuthz.test.ts`: the parity sweep (160 combinations, all four reasons plus `null` reached) and the no-`getAuthContext` case.
  - `configServiceImpl.test.ts`: `captureStdout` hoisted to module scope. AC-48 WARN line. AC-25 `peer_san_mismatch` (with `hadPeerSan=false`, no read) and `key_not_granted`. AC-26 one `GetSecret served` with `found=true`. A `found=false` case. No log carries the plaintext.
  - `setConfigAuthz.test.ts`: AC-54 (ERROR, `internalCaller`, `targetState: 'ACTIVE'`, no other field) and the WARN companion.
  - `configListenerTelemetry.test.ts` (new): the AC-48 metrics.
  - `eventNotifier.test.ts`: AC-27, the AC-40 storm (`[1, 10, 20, 30]`, each retry 2000 ms apart, the next failure after a connect logs as 1) and the AC-40 double-count case.
- **Fixture (standing-approved out-of-scope move).** `CollectingReader` was moved into `src/__tests__/fixtures/collectingReader.ts` in config and ledger. Each service's `telemetry.test.ts` and `telemetryInstruments.test.ts` now import it. A row was added to the ledger `INVENTORY.md`.
- **Open Risk (design.md) recorded.** node-pg 8.20.0 emits `error` and then `end` on an idle connected client, a LISTENing one included. During `connect()` it rejects instead of emitting. So one failure is counted once (details in the Deviation Log).
- **TDD.**
  - RED: `configServiceImpl.ts` and `eventNotifier.ts` were checked out from `218c9257`, keeping Step 19's `telemetry.ts` and `authz.ts`. Config gave `8 failed, 56 passed` and ledger `3 failed, 20 passed`, all `ERR_ASSERTION` with no import errors: AC-25 ×2, AC-26, `found=false`, AC-48 ×3, AC-54, AC-27 and AC-40 ×2. The parity test's RED was a mutation (`peer_san_mismatch` → `null` in the built `authz.js`): `caller=marketdata ns=marketdata key=alpaca.api_key san=undefined reason=null`.
  - The tree was restored from `HEAD`. GREEN: all pass. RED was re-run after the fixture switch, with the same assertion failures.
  - Flake check: the five touched suites passed 5 consecutive runs (87/87 each).
- **Verification** (the spec's command, run per service as separate invocations):
  - `pnpm run test:coverage`: config `309 passed` (91.72% lines), ledger `149 passed` (81.83% lines).
  - `pnpm exec c8 check-coverage --lines 40`: exit 0 in both.
  - `pnpm run lint`: `0 errors`. Warnings went from 235 to 246 (config) and from 274 to 275 (ledger), all `no-explicit-any` in new test code. The two at `configServiceImpl.test.ts:37` are the moved `captureStdout`.
  - `prettier --check`: clean on the new files. The modified files keep exactly their `HEAD` count of pre-existing diff hunks.
  - `node scripts/check-config-wiring.mjs`: exit 0. No config key touched.
- **Tooling.** node v24.22.1 and pnpm 9.15.9. `pnpm install --frozen-lockfile` was filtered to the root, `@xstockstrat/proto`, config and ledger; the lockfile did not change. The root `prepare` (`husky`) set the shared `core.hooksPath`; it is restored to `/home/user/xstockstrat/.husky/_` after pushing (out-of-scope side effect, as at Steps 5, 6 and 17-19).
- **Files modified:**
  - config `src/__tests__/`: `secretCallerAuthz.test.ts`, `configServiceImpl.test.ts`, `setConfigAuthz.test.ts`, `configListenerTelemetry.test.ts` (new), `fixtures/collectingReader.ts` (new, approved), `telemetry.test.ts` (approved), `telemetryInstruments.test.ts` (approved)
  - ledger `src/__tests__/`: `eventNotifier.test.ts`, `fixtures/collectingReader.ts` (new, approved), `fixtures/INVENTORY.md` (approved), `telemetry.test.ts` (approved), `telemetryInstruments.test.ts` (approved)
- **Deviations:** two, both in the Deviation Log: the config and ledger `CollectingReader` fixture move (standing-approved), and the test realizations (scenario placement, the split AC-48, the structured log capture, the node-pg Open Risk and the RED protocol including the parity mutation).

### Step 21 — service: Notify delivery, stream and startup signals [done]
- **Discovery.** Ran after `git checkout --detach origin/ccr-b4aace27-zvuaby` (HEAD `605ad606`, Step 20). The digest's anchors matched the tree: `FanoutDispatcher :41`, the private fields `:42-43`/`:47-48`, the gates `:57`/`:65`/`:76`, the dispatch catch `:100-102`, the Slack and SendGrid results `:130-134`/`:173-178`, `vapidConfigured :54`/`:77`, the silent push returns `:87`/`:93`/`:109-113`/`:122`, `sendOne :166`, the write-loop eviction `:86-87`, the stream `error` handler `:143` and the three constructions in `index.ts :40-42`. `deliveryChannels.ts`, `enabledChannels`, `isPushEnabled` and the instruments were absent, as expected.
- **Implementation.**
  - `src/telemetry.ts` adds `notify.delivery{channel, outcome}`, `notify.stream.evictions{reason}` and `notify.stream.subscribers`.
  - `fanout.ts` records the `fanout` gate and dispatch-error outcomes and the Slack/SendGrid `sent`/`http_error`/`timeout`/`error` outcomes, and adds `enabledChannels()`.
  - `webPush.ts` records the eight `push` outcomes and adds `isPushEnabled()`.
  - `notifyServiceImpl.ts` registers the gauge in the constructor. The write-loop catch records `{write_error}` and logs WARN `StreamAlerts subscriber evicted` with only `reason`, and the stream `error` handler records `{stream_error}`. Both still delete the subscriber.
  - The new `src/fanout/deliveryChannels.ts` holds `describeDeliveryChannels`, and `index.ts` writes one `log.info('delivery channels', ...)` after the constructions.
  - `category` and `sourceService` are never labels. Delivery behavior is unchanged.
- **TDD** (the Steps 7-19 protocol; Step 22 commits the real tests). One uncommitted probe, `src/__tests__/zz_step21_probe.test.ts` (4 tests), used only pre-existing symbols plus a guarded `require` of the new module.
  - RED before implementation: `4 failed`, all `ERR_ASSERTION`. The failures: no `notify.delivery` sample for `fanout/gated_severity` or `slack/sent`, no `push/disabled` sample, no `notify.stream.evictions{write_error}` sample, and no `deliveryChannels` module.
  - GREEN after implementation: `4 passed`. They also assert `slack/timeout` on an `AbortError`, that the only attribute keys are `channel` and `outcome`, that the gauge reads 2 after one of 3 subscribers is evicted, and the `{ enabled: 'slack,push', disabled: 'sendgrid' }` line.
  - The probe was copied to the scratchpad, deleted and never committed. Full suite: `129 passed`, 0 failed (unchanged from baseline).
- **Verification** (separate invocations; Deviation Log):
  - `pnpm run lint`: `0 errors`, and no warning on an added line.
  - `pnpm exec tsc --noEmit`: exit 0.
  - `prettier --check`: `deliveryChannels.ts` and `telemetry.ts` are clean. In the other four files the only prettier diffs are on pre-existing lines. `webPush.ts` goes from 5 to 6 hunks because an inserted line splits one existing hunk.
  - `node scripts/check-config-wiring.mjs`: exit 0. No config key touched.
- **Tooling.** node v24.22.1 and pnpm 9.15.9. The main worktree has no `node_modules`, so the symlink dangled and was removed. `pnpm install --frozen-lockfile` was filtered to the root, `@xstockstrat/proto` and notify; the lockfile did not change. The root `prepare` (`husky`) set the shared `core.hooksPath` to `.husky/_`, so the pre-commit hook runs on this commit. It is restored to `/home/user/xstockstrat/.husky/_` after pushing (out-of-scope side effect, as at Steps 5, 6 and 17-20).
- **Files modified:** `services/xstockstrat-notify/src/telemetry.ts`, `services/xstockstrat-notify/src/fanout/fanout.ts`, `services/xstockstrat-notify/src/fanout/webPush.ts`, `services/xstockstrat-notify/src/fanout/deliveryChannels.ts` (new), `services/xstockstrat-notify/src/grpc/notifyServiceImpl.ts`, `services/xstockstrat-notify/src/index.ts`
- **Deviations:** two, both in the Deviation Log: the separate-invocation verification (CI-equivalent fallback), and the implementation details the spec left open (the gauge source and re-registration, the `pruned`-only-after-delete rule, `admin_lookup_error` before the rate limit, and SendGrid enablement by key presence).
- **For reviewer confirmation (C-18):** `deliveryChannels.ts`, `enabledChannels()` and `isPushEnabled()` are the testability-driven new surface that the spec flags.

### Step 22 — test: Notify telemetry tests [done]
- **Discovery.** Ran after `git checkout --detach origin/ccr-b4aace27-zvuaby` (HEAD `5f0ffe22`, Step 21). The digest reported Step 21 as `pending` because it read a stale tree. At this HEAD, `deliveryChannels.ts`, `enabledChannels()`, `isPushEnabled()`, `recordDelivery`, `recordStreamEviction`, `observeStreamSubscribers` and the `index.ts :44` startup line are all present. The three test files exist, and `deliveryChannelsLog.test.ts` and `src/__tests__/fixtures/` did not.
- **Tests.**
  - AC-31 is in `fanout.test.ts`.
  - AC-32 and the span-propagation characterization are in `notifyServiceImpl.test.ts`.
  - The four push outcomes (`sent`, `pruned`, `disabled`, `no_audience`) are in `webPush.test.ts`.
  - AC-49 has two cases in the new `deliveryChannelsLog.test.ts`: the captured winston line, and the `index.ts` call-site check.
  - `CollectingReader` moved to `src/__tests__/fixtures/collectingReader.ts` (standing approval).
- **TDD.**
  - RED: the record helpers, the `index.ts` line and `describeDeliveryChannels` were stubbed in the working tree. Result: `8 failed`, all `ERR_ASSERTION`. The span test passed by design.
  - GREEN: `138 passed`, up from 129.
- **Span Open Risk.** A fanout dispatch queued inside an active span keeps that span (Node v24.22.1).
- **Verification** (separate invocations): `pnpm run test:coverage` gave 138/138 and 82.32% lines. `c8 check-coverage --lines 40` exited 0. `pnpm run lint` gave `0 errors`. `tsc --noEmit` exited 0, and prettier is clean on the two new files. The remaining lint warnings on added lines are `no-explicit-any` on casts that follow the existing files' fake idiom (`pool.obj as any`, `(impl as any).subscribers`).
- **Tooling.** `pnpm install --frozen-lockfile` was filtered to the root, `@xstockstrat/proto` and notify, and the lockfile did not change. Root `prepare` set the shared `core.hooksPath` to `.husky/_`, and it is restored to `/home/user/xstockstrat/.husky/_` after pushing (same as Steps 17-21).
- **Files modified:** `services/xstockstrat-notify/src/__tests__/fanout.test.ts`, `notifyServiceImpl.test.ts`, `webPush.test.ts`, `deliveryChannelsLog.test.ts` (new), `fixtures/collectingReader.ts` (new, approved), `telemetry.test.ts` (approved), `telemetryInstruments.test.ts` (approved)
- **Deviations:** three, all in the Deviation Log: the fixture move (standing-approved), the separate-invocation verification, and the test realizations.

### Step 23 — service: UI BFF auth, audit and per-method signals [done]
- **Discovery.** Ran after `git checkout --detach origin/ccr-b4aace27-zvuaby` (HEAD `de42e772`, Step 22). The digest's anchors matched the tree:
  - `BffSegment :7` and the histogram rebinding `:9-23`
  - `createDispatch :113`, the unmatched path `:126`, `timed :131` and the `finally` `:144-148`
  - the login, refresh, logout and audit branches
  - `refreshSession`'s bare catch `:24-26` and `verifyAccessToken`'s `:25`/`:28-30`
  - `jose` exports `errors.JWTExpired` (jose 5).
- **Implementation.**
  - `bffMetrics.ts` adds the `'auth'` segment and the counters `ui.auth.events{event[, reason]}` and `ui.bff.requests{rpc_service, rpc_method, outcome}`, behind one shared `rebinding` helper.
  - `createDispatch` records `ui.bff.requests` for unary calls and for `unmatched`/`unmatched`/`client_error`.
  - The auth events are at the sites the spec names. `verifyAccessToken` classifies `expired`/`invalid` by `errors.JWTExpired`.
  - The login, refresh and logout routes and audit `GET` are wrapped with `withBffMetrics`. The audit route WARNs on 401, 403 and no `DATABASE_URL`, with `traceId` only.
  - Logs carry the Connect code name only. Response bodies and status codes are unchanged.
- **TDD** (the Steps 7-21 protocol; Step 24 commits the real tests). One uncommitted probe, `src/lib/__tests__/zz_step23_probe.test.ts` (4 tests), covered AC-33 login, AC-34 refresh/jwt, the AC-35 audit 403 and AC-36 dispatcher.
  - RED before implementation: `4 failed`, all `AssertionError`. Three were `expected [] to have a length of 1` (no `ui.auth.events` / `ui.bff.requests` sample) and one was `expected "warn" to be called`. None was an import error.
  - GREEN after implementation: `4 passed`. They also assert the `auth` `http.server.duration` sample for `/api/auth/login` with status 401, `jwt_rejected{no_secret}`, the audit route's duration sample, and no `rpc_method` key on `http.server.duration`.
  - The probe was copied to the scratchpad, deleted and never committed. Full suite with the probe: `375 passed`. Without it: 371, the baseline.
- **Verification** (separate invocations; Deviation Log):
  - `pnpm run lint`: 0 errors, and no warning on a changed file.
  - `pnpm exec tsc --noEmit`: only the two pre-existing `e2e/insights/backfills.spec.ts:135-136` errors, which are also on the pre-step tree.
  - jscpd `--threshold 0` on `services/xstockstrat-ui/src`: `Found 0 clones`.
  - `prettier --check` on the 8 files: clean.
- **Tooling.** node v24.22.1 and pnpm 9.15.9. The main worktree has no `node_modules`, so the symlink dangled and was removed. `pnpm install --frozen-lockfile` was filtered to the root and `xstockstrat-ui...`, and the lockfile did not change. The root `prepare` (`husky`) set the shared `core.hooksPath` to `.husky/_`, so the pre-commit hook runs on this commit. It is restored to `/home/user/xstockstrat/.husky/_` after pushing (out-of-scope side effect, as at Steps 5, 6 and 17-22).
- **Files modified:** `services/xstockstrat-ui/src/lib/bffMetrics.ts`, `src/lib/bffShared.ts`, `src/lib/identity.ts`, `src/lib/auth.ts`, `src/app/api/auth/login/route.ts`, `src/app/api/auth/refresh/route.ts`, `src/app/api/auth/logout/route.ts`, `src/app/config-ui/api/audit/route.ts`
- **Deviations:** two, both in the Deviation Log: the separate-invocation verification (CI-equivalent fallback, with the pre-existing `tsc` error), and the implementation details (the shared `rebinding` helper, the login log carrying the code instead of the stack, and the audit-401 `jwt_rejected` overlap).
- **Open item:** `e2e/insights/backfills.spec.ts:135-136` fails `tsc --noEmit` on the base tree (`triggered` narrowed to `never`). It is outside this feature and goes to `/sdd-qa defect`.

### Step 24 — test: UI BFF telemetry tests [done]
- **Discovery.** Ran after `git checkout --detach origin/ccr-b4aace27-zvuaby` (HEAD `d08590b1`, Step 23).
  - The digest reported Step 23 as `pending` and `ui.auth.events`/`ui.bff.requests` as absent, because it read a stale tree.
  - At this HEAD, `recordAuthEvent`, `recordBffRequest`, the `'auth'` segment, the wrapped login/refresh/logout/audit handlers and the audit WARNs are all present.
  - The task's doubled path `docs/roadmap/features/docs/roadmap/features/294-...` does not exist; the feature dir is `docs/roadmap/features/294-signal-map-instrumentation/`.
- **Tests.**
  - AC-33 (login), AC-35 (non-admin 403 and missing-`DATABASE_URL` WARNs) and AC-55 (an 80 ms audit read on `http.server.duration`) are in the new `bffAuthMetrics.test.ts`.
  - AC-36 is in `bffMetrics.test.ts`, through the real insights dispatcher.
  - AC-34 is split: `refresh_error` is in `identity.test.ts`, and `jwt_rejected{no_secret}` is in `auth.test.ts`.
- **TDD.** RED was taken with Step 23's 8 production files reverted to `HEAD~1`: `7 failed` (all `AssertionError`), 14 passed. GREEN: `378 passed` (66 files), up from 371.
- **Verification** (separate invocations; Deviation Log): `test:unit` and `test:coverage` gave 378/378 with 78.75% lines. `lint` exited 0, jscpd gave `Found 0 clones`, and prettier is clean. `tsc` shows only the pre-existing `backfills.spec.ts:135-136` errors.
- **Tooling.** node v24.22.1 and pnpm 9.15.9. The main worktree has no `node_modules`, so `pnpm install --frozen-lockfile` was filtered to the root and `xstockstrat-ui...`, and the lockfile did not change. Root `prepare` set the shared `core.hooksPath` to `.husky/_`. It is restored to `/home/user/xstockstrat/.husky/_` after pushing (same as Steps 17-23).
- **Files modified:** `services/xstockstrat-ui/src/lib/__tests__/bffMetrics.test.ts`, `src/lib/__tests__/bffAuthMetrics.test.ts` (new), `src/lib/identity.test.ts`, `src/lib/auth.test.ts`
- **Deviations:** two, both in the Deviation Log: the separate-invocation verification, and the test realizations (the inline `CollectingReader`, the one-off password literal, the AC-55 cumulative-histogram assertion, and the RED protocol).


### Step 25 — service: Ingest poll, signal-outcome, backfill and dedup signals (SEV-3) [done]
- **Discovery.** Ran after `git checkout --detach origin/ccr-b4aace27-zvuaby` (HEAD `c541b154`, Step 24).
  - The digest's line anchors matched the tree.
  - The digest reported that ingest has no `Loop` or `log_tick_ok`. That was a stale read: Step 3 had already added `LOOP_TICK_OK`, the empty `Loop(StrEnum)`, `log_tick_ok` and the rebinding accessors, so this step only adds `Loop.MCP_CLIENT`.
- **Implementation.**
  - `telemetry.py` adds the six instruments, the keys `outcome`, `stage`, `reason`, `path` and `service`, and the `record_*` helpers.
  - `poll_one_source` records `ingest.source.poll{ok|no_bearer|config_error|all_items_failed|error}` through an `outcome` variable and a `finally`. Both no-bearer returns WARN `"mcp_client loop: source %s bearer not configured"`.
  - `run_one_cycle` times each poll and counts attempted and failed sources. It writes one `loop tick ok` (`mcp_client`), with state `idle` when there are 0 sources and none when every attempted source failed.
  - The loop path unpacks the 2-tuple and records `ingest.signal.outcome{mcp_poll}`. The extractor drops carry the slug and `repr(item)[:200]`, and count `ingest.signal.dropped{extract, reason}`.
  - In `servicer.py`:
    - `_signal_error_outcome` and `_record_signal_outcome` sit beside the exception classes.
    - `IngestSignal` records `path=rpc`, including a new `except Exception: ...; raise`.
    - The dedup line is now `log.debug`, text unchanged.
    - `_resume_job` logs ERROR `"_resume_job failed job=%s"`, counts `ingest.backfill.jobs{failed}`, then re-raises.
    - `InstantiateTemplate` records `template.instantiate{service=ingest}`.
- **TDD** (the Steps 7-23 protocol; Step 26 commits the real tests). An uncommitted probe, `tests/test_zz_step25_probe.py` (5 tests), covered:
  - no_bearer, the slug WARN and the tick record;
  - the drops, outcomes, duration and truncation;
  - the non-object drop;
  - the `_resume_job` failure;
  - the `template.instantiate` unavailable outcome.
  - RED, with only the `telemetry.py` instruments in place: `5 failed`. Four were `AssertionError`. The fifth was a `TypeError`, because `McpClientInput` had no `slug` field yet.
  - GREEN: `5 passed`. The full suite with the probe gave `397 passed`. The probe was then deleted and never committed.
- **Verification:** `uv run ruff check .` reported all checks passed. `uv run ruff format --check .` reported 48 files already formatted. `uv run pytest -q tests/test_mcp_client_loop.py` gave 20 passed, including the `:192` spy. Outside the step's chain, the full `uv run pytest --cov=app --cov-fail-under=40 -q` gave 392 passed at 84.74%.
- **Files modified:** `services/xstockstrat-ingest/app/telemetry.py`, `app/engine/mcp_client_loop.py`, `app/extractors/base.py`, `app/extractors/mcp_client.py`, `app/handlers/servicer.py`
- **Deviations:** one, in the Deviation Log: implementation details (the poll-outcome `finally` with cancellation excluded, poll duration in seconds that excludes bookkeeping, the kept `"mcp_client: skipping"` prefix, ingest's own `record_template_instantiate`, and the hoisted `asyncio` import).


### Step 26 — test: Ingest telemetry tests [done]
- **Discovery.** Ran after `git checkout --detach origin/ccr-b4aace27-zvuaby` (HEAD `012fedd1`, Step 25).
  - The digest reported Step 25 as `pending` and its symbols as absent, because it read a stale tree. At this HEAD, `_record_signal_outcome`, `Loop.MCP_CLIENT`, the six instruments and the bearer WARN are all present.
  - The `:192` spy is unchanged.
- **Tests.**
  - `test_mcp_client_loop.py` adds two AC-7 tests. In one, a healthy cycle writes one `loop tick ok` with `loop=mcp_client`. In the other, an all-failed cycle writes none.
  - The new `test_ingest_telemetry.py` covers the rest:
    - AC-28: no_bearer +1, the `my-feed` WARN, no `my-feed` attribute value, and `mark_source_error` unchanged.
    - AC-29: a real `_ingest_external_signal` dedup against id 41, counted as `mcp_poll/deduplicated`, with one DEBUG line and no INFO.
    - AC-30: `job-7` gives the ERROR, `backfill.jobs{failed}` +1, and the same exception object re-raised.
    - AC-53: 1 duration sample, `dropped{extract, bad_symbol_direction}` = 2, slug-tagged drops of at most 200 chars, and AAPL/TSLA/AMZN ingested.
    - AC-39: `template.instantiate{ingest, ok}` +1.
- **TDD.** RED was taken with Step 25's app files reverted to `HEAD~1`: `6 failed` (all `AssertionError`), and 2 passed (the `:192` spy and the AC-7 negative). GREEN: `8 passed`, and the full suite gave `399 passed`.
- **Verification:** `uv run pytest --cov=app --cov-fail-under=40 -q` gave 399 passed at 85.25%. `uv run ruff check .` reported all checks passed. `uv run ruff format --check .` reported 49 files already formatted. jscpd on `services/xstockstrat-ingest/tests` found no duplication.
- **Files modified:** `services/xstockstrat-ingest/tests/test_mcp_client_loop.py`, `tests/test_ingest_telemetry.py` (new)
- **Deviations:** one, in the Deviation Log: the test realizations (the file split, no `conftest.py` move because only one file needs the reader, the AC-30 DB error, and the RED protocol).


### Step 27 — service: Indicators sandbox, template and config-watcher signals (SEV-3) [done]
- **Discovery.** Ran after `git checkout --detach origin/ccr-b4aace27-zvuaby` (HEAD `0d188269`, Step 26). Every digest anchor matched the tree. Step 3's `Counter`/`Histogram`/`Gauge` accessors were already in `app/telemetry.py`.
- **Implementation.**
  - `telemetry.py` adds the five instruments, the keys `exit_reason`, `outcome` and `service`, and four helpers: `record_sandbox_execution`, `record_sandbox_queue_wait`, `record_template_instantiate` and `register_snapshot_age`.
  - In `servicer.py`, `ExecuteFormula` gains `queue_wait` around `async with self._sandbox_sem`. It times the `to_thread` call and records one execution per sandbox run: `runtime_error` for missing declared outputs, the map key when the reason is mapped, and `other` when it is not. A non-success run writes one WARN carrying `exit_reason`. `"executing formula ..."` is now `log.debug`, text unchanged.
  - `InstantiateTemplate` wraps a private `_instantiate_template` and records the outcome in a `finally`, from the response or `context.code()`.
  - `watcher.py` adds `_snapshot_at` and `_consecutive` (class defaults), and `snapshot_age()`, registered as the gauge source in `__init__`. The clean-end INFO `"config stream ended cleanly"` and the failure WARN are throttled to the 1st and every 10th. `asyncio.sleep(2)` and the immediate re-issue are unchanged.
- **TDD** (the Steps 7-25 protocol; Step 28 commits the real tests). An uncommitted probe, `tests/test_zz_step27_probe.py` (4 tests), covered:
  - AC-37: the timeout counts, the WARN and DEBUG-only `"executing formula"`;
  - AC-39: `template.instantiate{indicators, ok}`;
  - AC-38: the clean end and the gauge at 7.5 s with a monkeypatched `time.monotonic`;
  - AC-50: 20 failures give 3 WARNs and 20 sleeps of 2.
  - RED, with only the `telemetry.py` instruments in place: `4 failed`. These were two `KeyError`s (no series), one `AttributeError` (watcher had no `time`) and one `AssertionError` (20 WARNs).
  - The first GREEN run caught a bug: success was recorded as `other`. After the fix: `4 passed`. The full suite with the probe gave `466 passed`. The probe was then deleted and never committed.
- **Verification:** `uv run ruff check .` reported all checks passed. `uv run ruff format --check .` reported 50 files already formatted. `uv run pytest -q tests/test_config_watcher.py tests/test_execute_formula_concurrency.py` gave 30 passed. Outside the step's chain, the full `uv run pytest --cov=app --cov-fail-under=50 -q` gave 462 passed at 85.48%.
- **Files modified:** `services/xstockstrat-indicators/app/telemetry.py`, `app/handlers/servicer.py`, `app/config/watcher.py`
- **Deviations:** one, in the Deviation Log: implementation details (units in seconds, the reordered missing-output check, the WARN text, the `_instantiate_template` wrapper reading `context.code()`, the `register_snapshot_age` wiring, and the class-level watcher defaults). `app/services/sandbox.py` was not needed.


### Step 28 — test: Indicators telemetry tests [done]
- **Discovery.** Ran after `git checkout --detach origin/ccr-b4aace27-zvuaby` (HEAD `266a9d05`, Step 27).
  - The digest reported Step 27 as `pending` and its symbols as absent, because it read a stale tree. At this HEAD, the five instruments, `_snapshot_at`, `_consecutive`, `snapshot_age()` and `"config stream ended cleanly"` are all present.
- **Tests.**
  - In `test_execute_formula_concurrency.py`, the AC-37 log half: `"executing formula timeout_ms=5000 ..."` at DEBUG only, no INFO, the timeout `exit_reason`, and no abort.
  - In `test_config_watcher.py`:
    - AC-38: a clean end writes one INFO `"config stream ended cleanly"`, re-issues with no sleep, and the gauge reads 7.5 s from a faked `watcher_mod.time`.
    - AC-50: 20 failures write 3 WARNs (consecutive 1, 10 and 20), followed by 20 sleeps of 2. The `sleep_recorder` monkeypatch fixture restores `asyncio.sleep`.
  - In the new `test_sandbox_telemetry.py`:
    - AC-37: counters `executions{timeout}` 1, `duration{timeout}` 1, `queue_wait` 1, and one WARN with `exit_reason=timeout`.
    - AC-39: `template.instantiate{indicators, ok}` +1.
- **TDD.** RED was taken with Step 27's `servicer.py` and `watcher.py` reverted to `HEAD~1`: `5 failed, 30 passed`.
  - The AC-37 counters, AC-37 log and AC-39 tests failed with `AssertionError`.
  - AC-38 failed with an `AttributeError`, because the watcher had no `time`.
  - AC-50 failed with an `AssertionError`, because there were 20 WARNs.
  - GREEN, after restoring: `35 passed`.
- **Verification:** `uv run pytest --cov=app --cov-fail-under=50 -q` gave 467 passed at 85.48%. `uv run ruff check .` reported all checks passed. `uv run ruff format --check .` reported 51 files already formatted. The pre-existing `test_config_watcher.py` `:184` and `:205` tests still pass.
- **Files modified:** `services/xstockstrat-indicators/tests/test_execute_formula_concurrency.py`, `tests/test_config_watcher.py`, `tests/test_sandbox_telemetry.py` (new)
- **Deviations:** one, in the Deviation Log: the test realizations (the AC-37 split across two files, the scripted stub and dial-free helper, faking module-local time, the sleep fixture, no `conftest.py` move, and the RED protocol).


### Step 29 — test: Final allowlist, guard and acceptance pass [done]
- **Discovery.** Ran after `git checkout --detach origin/ccr-b4aace27-zvuaby` (HEAD `e4d31e5b`, Step 28). The digest reported Steps 1-28 as missing because it read a stale tree; at this HEAD Steps 1-28 are `done` and every symbol the step reuses is present (`telemetry.Loops`, the `Key*` constants, `RegisterStreamLastMessageAge`, `trading_telemetry_test.go`, `portfolio_telemetry_test.go`, the Python `KEY_*`/`Loop`, the Node `KEY_*` and `RpcDurationProcessor`). `live_loop: cycle complete` occurs once in `live_loop.py`.
- **Tests.** Twelve new allowlist files, one per service. Each drives every instrument of its module, asserts every collected label key is a module key constant (UI: a pinned per-instrument set; ledger: the empty set) and none is an identifier or secret key, asserts the MIN instrument set and the `rpc.server.duration` / `mcp.tool.duration` / `http.server.duration` names and keys, covers AC-42 (disabled install and failing init) and, where the service writes `loop tick ok`, AC-7. Go adds the AC-56 aggregate (no `rpc.client.*`).
- **TDD.** RED: one record call per service temporarily gained a `symbol` attribute; the new test failed in all 12 services with an assertion naming `symbol` (e.g. trading `trading.flatten.outcome carries forbidden label key "symbol"`, analysis `('template.instantiate', {'outcome', 'service', 'symbol'})`, UI `ui.auth.events carries key symbol`). Files restored; nothing from the probe committed. GREEN: Go 4/4 per service, Python 6 (analysis), 5 (ingest), 4 (indicators), 4 (agent), Node 4/4 per service, UI 3/3.
- **Verification.**
  - `scripts/check-otel-produced-signals.sh` exits 0. AC-43: `git diff --name-only origin/main-dev...HEAD` (122 paths) has no `packages/otel/`, `.proto` or `migrations/` path. AC-44: all 14 deferred IDs appear exactly once.
  - Go trading, portfolio, marketdata: `go test ./... -race -count=1` ok, `golangci-lint` 0 issues; marketdata measured coverage 83.6%.
  - Python: ingest 404 passed (85.37%), analysis 1574 passed (90.76%), agent 680 passed (85.70%), indicators 471 passed (85.48%, threshold 50); `ruff check` and `ruff format --check` clean in all four.
  - Node: identity 148, config 313, ledger 153, notify 142 tests pass; `c8 check-coverage --lines 40` passes; `pnpm run lint` 0 errors (pre-existing warnings only).
  - UI: `test:unit` and `test:coverage` 381 passed; `pnpm run lint` exit 0; `check-duplication.sh services/xstockstrat-ui/src` OK.
- **Tooling.** go 1.27.0, golangci-lint 2.14.0, uv 0.11.32 (`uv sync --extra dev` in the four Python services, `uv.lock` unchanged), node v24.22.1, pnpm 9.15.9 (`pnpm install --frozen-lockfile` filtered to the root, `@xstockstrat/proto`, the four Node services and `xstockstrat-ui...`; lockfile unchanged). The main worktree has no `node_modules`, so nothing was symlinked. The root `prepare` (`husky`) rewrites the shared `core.hooksPath`; it is restored to `/home/user/xstockstrat/.husky/_` after pushing (out-of-scope side effect, as at Steps 5, 6 and 17-24).
- **Files modified:** `services/xstockstrat-{trading,portfolio,marketdata}/internal/service/telemetry_allowlist_test.go`, `services/xstockstrat-{analysis,ingest,indicators,agent}/tests/test_telemetry_allowlist.py`, `services/xstockstrat-{identity,config,ledger,notify}/src/__tests__/telemetryAllowlist.test.ts`, `services/xstockstrat-ui/src/lib/__tests__/bffAllowlist.test.ts` (all new)
- **Deviations:** one, in the Deviation Log: the test realizations (helper-driven collection, server-duration harnesses, AC-42/AC-7 per runtime, pinned UI and empty ledger allowlists, the RED probe, and the split verification invocations).

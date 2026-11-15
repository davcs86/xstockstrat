# Recon: backtest-inline-backfill

**Created**: 2026-11-15
**From**: product-spec.md
**Tree**: feature/backtest-inline-backfill@086e4743c (contains origin/main-dev@67dcfc11a; differs from it only under this feature directory). The three discovery digests were UNSTAMPED, so every `path:line` below was re-grepped on this tree.
**Affected services**: xstockstrat-ui, xstockstrat-ingest (plus xstockstrat-agent and the `strat-lab` plugin, conditionally, if FR-6 is chosen)

---

## Objective

When a symbol-page backtest returns insufficient data, let the trader backfill exactly the missing range from the Backtests card, watch progress inline, and then re-run by hand (FR-1…FR-5). FR-6 opens that action to every authenticated user, which means relaxing the admin gate on ingest `TriggerBackfill`. The operator set FR-7 (scores only, "Not enough data", no actions) as the fallback but not the threshold for "a lot of changes", so this dossier costs the FR-6 path for the design gate and chooses nothing.

## Codebase Map

- **`xstockstrat-ui`** (Next.js) — page `services/xstockstrat-ui/src/app/trader/positions/[symbol]/page.tsx`
  - Change target: `BacktestsSection` — `page.tsx:1133`, mounted at `:453`
    - Insufficient-data callout: `:1226-1240` (`data-testid="backtest-insufficient"` at `:1229`; the sentence "Ingest it from the Backfill coverage panel, then re-run." at `:1237`). It reads only `coverageGaps[0].barsHave` / `barsNeed` (`:1234-1235`), never `gap`.
    - Run state: `useRunBacktest()` at `:1144` (`data: runResult` is local mutation state). `handleRun` at `:1178` sends `strategyId` + `strategyIdRef` (`:1186-1187`), `initialCapital: 100000` (`:1189`), range 2024-01-01..2024-12-31 (`:1190`), and invalidates `['analysis-backtests', strategyId]` on success.
    - No-strategy branch returns early with a picker and no Run button (`:1151-1173`).
  - Existing admin-only trigger: `BackfillSection` — `page.tsx:1376`, mounted at `:463`. `handleTrigger` (`:1405-1415`) sends `range: undefined` (full history). The button is gated by `isAdmin &&` (`:1422`, `useIsAdmin` at `:1379`) and disabled by `inFlight` (`:1391`, `:1426`).
  - Hooks: `useRunBacktest` — `src/hooks/useBacktest.ts:8`; `useTriggerBackfill` — `src/hooks/useBacktest.ts:19` (re-exported at `src/hooks/useBackfills.ts:6`); `useBackfillJobs` — `useBackfills.ts:22` (4 s poll); `useBackfillStatus(jobId)` — `useBackfills.ts:30` (4 s poll that stops on a terminal status, `isTerminal` at `:13`); `useBacktestHistory` — `src/hooks/useStrategies.ts:38`; `useIsAdmin` — `src/hooks/useLiveStrategies.ts:61`; `TIMEFRAME_ENUM` — `src/lib/chart.ts:15`.
  - BFF: `src/lib/insightsBff.ts:86` `triggerBackfill: forward(...)` — session-only, no admin check (`forward` at `src/lib/bffShared.ts:77`, `forwardAdmin` at `:93`). `getBackfillStatus` (`:89`) and `listBackfillJobs` (`:94`) are session-only reads. `cancelBackfill` is `forwardAdmin` (`:100`) and stays out of scope.
  - Config-read pattern: none needed (no UI config key in scope).
- **`xstockstrat-ingest`** (Python)
  - Handler: `TriggerBackfill` — `services/xstockstrat-ingest/app/handlers/servicer.py:417`
    - The admin gate, the only authorization on the RPC: `:423-425` (`PERMISSION_DENIED`, "admin scope required"), after the `_db is None` UNAVAILABLE check at `:418`.
    - `_has_admin_scope` — `:357` (ADMIN bit `0x04`). Also used by `CancelBackfill` (`:965`), the foreign-owner read (`:405`) and `:1613`. Only the `:423` call site is in scope, never the helper.
    - Other checks, unchanged: `1d`-only reject (`:442`), `callback_url` validation (`:448`), `insert_job` as QUEUED (`:453`), ledger event `ingest.backfill.queued` (`:464`), `_run_backfill` spawn (`:472`). Response is `job_id` + `BACKFILL_STATUS_QUEUED` (`:473-476`).
    - Unset range defaults to a 365-day lookback ending now (`:650-651`).
  - Reads: `GetBackfillStatus` — `:918`; `ListBackfillJobs` — `:928`; both ungated.
  - Global concurrency limiter: `:348` (`backfill.max_concurrent_jobs`); a job above the cap stays QUEUED (`:549`).
  - Last migration: `016_seed_source_templates.up.sql` (`services/xstockstrat-ingest/migrations/`)
  - Config keys: `backfill.*` table at `services/xstockstrat-ingest/CLAUDE.md:120-126`, all global.
  - Jobs carry no owner: no `user_id`/`owner` in `app/repositories/backfill_jobs.py`; the four backfill RPCs are in `EXEMPT` at `tests/test_owner_scoped_completeness.py:15-19`.
- **`xstockstrat-agent`** (Python, only if FR-6): `trigger_backfill` tool — `services/xstockstrat-agent/app/tools.py:1546`; forwards the caller's real scope via `_caller_access_scope(ctx, "trigger_backfill")` (`:1582`); says "admin-scoped" at `:21` and `:1557`; the tool enforces a 50-symbol cap client-side (docstring `:1558`, `:1570-1571`).

## Patterns to REUSE

- Gap → backfill-range request → reuse the `/insights` strategy page action verbatim: `services/xstockstrat-ui/src/app/insights/strategies/[id]/page.tsx:541-547` sends `{symbols:[gap.symbol], timeframeEnum: gap.timeframe, range: gap.gap, overwrite:false}`. This is the closest prior art for FR-2.
- Trigger mutation → `useTriggerBackfill` (`src/hooks/useBacktest.ts:19`); no new hook.
- Inline progress and terminal detection (FR-3…FR-5) → `useBackfillStatus(jobId)` (`src/hooks/useBackfills.ts:30`) with the `jobId` returned by the trigger. Jobs have no owner, so the card must track its own `jobId` and must not infer "its" job from `useBackfillJobs({symbol})`.
- Progress and error fields → existing `BackfillJob` fields `bars_processed` (6), `bars_total` (7), `error` (10), `failed_symbols` (11) at `packages/proto/ingest/v1/ingest.proto:33-50`; statuses PARTIAL (5) and CANCELED (6) at `:58-59`.
- Re-run (FR-4, @AC-5) → call the existing `handleRun` (`page.tsx:1178`) so the request keeps `strategyId` + `strategyIdRef` (270 @AC-4).
- Cross-segment client use → the symbol page already calls `/insights`-segment browser clients under the sanctioned UI-2 exception (`services/xstockstrat-ui/CLAUDE.md:72`, `services/xstockstrat-ui/docs/context-constitution.md:19`); no new BFF route.
- Testable logic (job status → message, gap → request) → a pure helper under `src/lib/` so vitest covers it (`pnpm run test:unit`).
- e2e fixtures (C-12) → `insufficientDataResult` / `prefixGapRange` (`e2e/fixtures/backtests.ts:69`, `:39`) and `backfillJob(over)` (`e2e/fixtures/backfillJobs.ts:18`); catalog rows at `e2e/fixtures/INVENTORY.md:34` and `:56`.
- Ingest test context → `_ctx(access_scope, user_id, …)` at `services/xstockstrat-ingest/tests/conftest.py:17` ("4" admin, "0" none); `make_servicer` from `tests/test_ingest_servicer.py`.
- FR-7 score source, if the fallback is chosen → existing data only: `BacktestRunSummary.overall_score` / `rating` (`packages/proto/analysis/v1/analysis.proto:297-298`, "0 / empty when the run earned no score") already loaded by `useBacktestHistory` (`ListBacktests`, `:18`). `ScoreStrategy` → `StrategyScore` (`:14`, `:250`) is per strategy across symbols, not per symbol. Design names which one "strategy scores" means.

## Existing Business Rules (preserve / extend)

- **PRESERVE** `@AC-4 @FR-4 @regression @feature-270` "A symbol-page backtest earns evidence and appears in the strategy's history" (`services/xstockstrat-ui/acceptance/fix-ui-trader-feedback.feature`) — the inline "Re-run backtest" must send RunBacktest with strategyId and strategyIdRef from `?strategy=`, and the run must appear in the strategy's history.
- **PRESERVE** `@AC-7 @FR-7 @feature-198` "Operator triggers a fundamentals backfill from the insights UI" (`services/xstockstrat-ui/acceptance/historical-fundamentals-backtest.feature`) — the /insights Backfill coverage trigger stays unchanged (spec out-of-scope).
- **PRESERVE** `@AC-6 @FR-4 @feature-198` "Fundamentals backfill is a distinct data kind, not a timeframe" (`services/xstockstrat-ingest/acceptance/historical-fundamentals-backtest.feature`) — an OHLCV TriggerBackfill without `data_kind` still defaults to BARS; FUNDAMENTALS routing is unchanged. Any authz opening must not alter this.
- **PRESERVE** `@AC-2 @FR-2 @regression @feature-261` "A backfill canceled while queued stays CANCELED and never runs" (`services/xstockstrat-ingest/acceptance/fix-ingest-poller-backfill.feature`) — CANCELED is final. The card's FR-5 / @AC-9 "Backfill canceled" state relies on it.
- **PRESERVE** `@AC-3 @FR-4 @regression @feature-261` "A canceled backfill is not resumed after a restart" (`services/xstockstrat-ingest/acceptance/fix-ingest-poller-backfill.feature`) — same.
- **PRESERVE** `@AC-6 @FR-3 @regression @feature-261` "A fundamentals backfill canceled mid-run is not finalized as COMPLETED or PARTIAL" (`services/xstockstrat-ingest/acceptance/fix-ingest-poller-backfill.feature`) — same.
- **PRESERVE** `@AC-1 @FR-1 @feature-334` "trigger_backfill without callback_url behaves as before" (`services/xstockstrat-ingest/acceptance/webhook-fanout-callback.feature`) — the inline call sends no callback_url, and the job is QUEUED with no fanout.
- **PRESERVE** `@AC-26 @FR-2 @feature-334` "trigger_backfill with a callback_url fails closed when notify cannot validate it" (`services/xstockstrat-ingest/acceptance/webhook-fanout-callback.feature`) — unchanged by the authz opening.
- **PRESERVE** `@AC-6 @FR-3 @regression @feature-244` "A trap-dependent site keeps the coded default for a stored zero" (`docs/sdd/business-rules/platform.feature`, `ingest.backfill.*` rows) and `@AC-5 @FR-3 @regression @feature-244` "Ingest's backfill job concurrency keeps its zero clamp" (`services/xstockstrat-ingest/acceptance/fix-python-config-stored-zero.feature`) — a new per-user backfill limit key (FR-6) must not alter the existing key defaults or clamp.
- **PRESERVE** `@AC-10 @FR-6 @regression @feature-296` "config-ui and the agent show the FQN and write relative keys" (`docs/sdd/business-rules/platform.feature`) — any new key is namespace-relative and seeded by migration.
- **PRESERVE (conditional on FR-6)** `@AC-32 @FR-12 @feature-224`, `@AC-5 @FR-4 @feature-149`, `@AC-10 @FR-4 @feature-283`, `@AC-15 @FR-5 @feature-304` (`docs/sdd/business-rules/platform.feature`) — agent docs and the strat-lab backtest skill stay in parity. If the TriggerBackfill gate changes, update `plugins/strat-lab/skills/backtest/SKILL.md` and `docs/runbooks/mcp-tools.md` in the same PR.
- **EXTEND** — no existing `@AC-*` guarantees the Backtests card's insufficient-data message or the symbol-page inline backfill. Spec @AC-1…@AC-7 and @AC-9 are net-new guarantees to promote at launch, and @AC-8 only if FR-7 is chosen.
- **CHANGE** — none. No `@AC-*` pins the `TriggerBackfill` admin gate (grep of the ingest, agent and platform suites for an admin-gated backfill scenario found none). The gate is a documented rule only (`services/xstockstrat-ingest/CLAUDE.md:17-20`). Opening it breaks no `@AC-*`, but it is a deliberate documented-behavior change that design must record as a decision, not treat as free.
- Both affected services have existing suites. The scenario scan was keyword-filtered, not a full read (platform.feature lines ~797-2695 were grepped only).

## Dependencies

- Proto/RPC: none expected. `TriggerBackfillRequest` already carries `symbols=1`, `range=3`, `overwrite=4`, `timeframe_enum=5`, `fill_mode=6` (`packages/proto/ingest/v1/ingest.proto:78-89`); `GetBackfillStatus` returns `BackfillJob` (`:14`); `CoverageGap.gap = 6` and `timeframe = 2` exist (`packages/proto/analysis/v1/analysis.proto:109-117`). Analysis sets `gap` to the pre-window span, prefix start → window start (`services/xstockstrat-analysis/app/handlers/servicer.py:1574-1578`), falling back to the request range (`:1028`, `:1137`).
- Migration: none for a plain gate removal. Next ingest number is `017` if design adds a per-user limit or job owner (jobs have no owner column today).
- Config keys: none for a plain gate removal. A per-user limit would be a new `ingest` `backfill.*` key with the full C-05 contract; nothing per-user exists today.
- Inter-service edges: none new (UI BFF → ingest `TriggerBackfill` / `GetBackfillStatus` already exist).
- New env vars / ports: none.

## Risks / Not-found

**Cost of FR-6 (opening the trigger to non-admins) — facts for the design gate, not a recommendation**

- Minimum change set if the gate is simply removed:
  - ingest: delete `servicer.py:421-425`; update `services/xstockstrat-ingest/CLAUDE.md:17-20` and the open finding at `services/xstockstrat-ingest/docs/context-constitution-findings.md:39`.
  - ingest tests that assert the gate and must be inverted or reworked: `test_permission_denied_without_admin_scope` (`tests/test_ingest_servicer.py:362`), `test_admin_scope_queues` (`:384`), and `test_validation_runs_after_the_admin_gate` (`:594`, the callback-URL ordering test, which the digests did not list).
  - agent (C-14 Agent box ticks): wording at `app/tools.py:21` and `:1557`, `services/xstockstrat-agent/CLAUDE.md:36-42`, `docs/runbooks/mcp-tools.md:964-968` (and `:1069`, which contrasts `cancel_backfill` with it), `tests/test_tools.py:1638` `TestTriggerBackfillTool`, the runbook parity test at `tests/test_tools_endpoint.py:104`, and the `strat-lab` skill (`plugins/strat-lab/skills/backtest/SKILL.md`, `reference/backfill.md`; binding per `docs/patterns/strat-lab-plugin.md:21-24`). A grep of the skill and `reference/backfill.md` for "admin"/"scope" found no statement that `trigger_backfill` is admin-only, so the plugin edit may be small; design confirms by reading them.
  - UI: the card work itself (FR-1…FR-5) is the same under either gate design.
- What the gate protects and what nothing else protects today:
  - The gate was added deliberately (feature 092) for a "quota-spending op" (`servicer.py:421`).
  - Ingest applies no symbol-count bound, no range bound and no per-user limit. The 50-symbol cap lives only in the agent tool (`app/tools.py:1558`). An unset range means a 365-day lookback (`servicer.py:650-651`); a caller-supplied range is not capped. I did not inspect marketdata `BackfillBars` bounds.
  - Concurrency is capped globally only (`backfill.max_concurrent_jobs`, default 3). With the gate open, any user's jobs share that queue with operator jobs, and there is no de-duplication of identical requests.
  - No user attribution: the `ingest.backfill.queued` payload carries `symbols`, `timeframe`, `data_kind` only (`servicer.py:464-469`); `x-user-id` rides only in propagation metadata. Ledger trap `fix-config-audit-author-spoof` (fails.md, 2026-11-04) applies if design adds an actor field: attribution must come from propagated headers, never a request field.
  - Removing the gate opens the RPC itself, so the agent tool and the existing ungated-in-UI `/insights` action open with it. A narrower server-side opening (for example a bounded single-symbol, bounded-range request for non-admins) is a design option with its own cost; per-user limits need migration `017` and/or a new config key.
- Existing inconsistency the choice touches: the `/insights` strategy page's "Backfill this range" button (`insights/strategies/[id]/page.tsx:538-551`) has no `isAdmin` wrapper, so a non-admin already sees an action that ingest rejects. The comment at `page.tsx:1404` says "the BFF + ingest server re-check", but the BFF uses plain `forward` (`insightsBff.ts:86`); only ingest checks.

**Other risks**

- e2e that breaks on either branch: `services/xstockstrat-ui/e2e/trader/position-detail.spec.ts:337` asserts `/Backfill coverage panel/`; it must change in the same step as the copy.
- Mock gap equals the requested window: the `strat-insufficient-001` sentinel returns `gap` 2024-01-01..2024-12-31 (`e2e/mock-backend.ts:1073-1093`), identical to what `handleRun` requests, with `barsHave: 0`. An @AC-2 assertion against it cannot tell `gap` from `requestedRange` (insights.md, 071-backtest-time-window). Make the gap a distinct pre-window span via `prefixGapRange`.
- No e2e mock for `getBackfillStatus`: `mock-backend.ts` has `triggerBackfill` (`:1581`, always `job-e2e-1` QUEUED) and `listBackfillJobs` (`:1587`) only; grep of `e2e/` for `getBackfillStatus` found nothing. @AC-3, @AC-4, @AC-6 and @AC-9 need a status handler returning RUNNING / COMPLETED / FAILED / PARTIAL / CANCELED, with the status the real server returns (fails.md, 215 sentinel rule).
- `runResult` is local mutation state, so the insufficient-data callout, the tracked `jobId` and the "Data ready" state are lost on reload or strategy switch. Design states whether that is acceptable.
- @AC-3 shows "120 / 200 bars" from `bars_processed` / `bars_total`. I did not verify when ingest populates `bars_total` during a run; design checks before fixing the copy. Similarly, @AC-9 expects an error string on PARTIAL; whether `BackfillJob.error` is set for PARTIAL (versus only `failed_symbols`) was not verified.
- A COMPLETED backfill does not guarantee the re-run succeeds (the vendor may have no bars for the gap); @AC-5 covers only the OK return.
- Peer overlap: `339-fix-symbol-page-alerts-ui` edits the same `page.tsx` (different card); `344-alert-detail-page` touches ingest. A sibling merging after design requires a re-run of the C-16 scan at `/sdd-spec` (fails.md, 240).
- Ledger traps: when the spec offers alternative branches, run the existing suite before committing to one (fails.md, backfill-management-ui); every surface that describes an agent tool changes in the same PR (fails.md, mcp-tools-alignment-triage); a full local Playwright run against `pnpm dev` is unreliable, verify statically plus one diagnosed run (fails.md, backfill-management-ui).
- Not found / not verified: marketdata `BackfillBars` range bounds; the `strat-lab` skill's full text on backfill permissions; whether @AC-8's "strategy scores" means the per-run `overall_score` or `ScoreStrategy`.

## Recommended Scope

Advisory only. The FR-6 / FR-7 choice is the operator's at the design gate.

If FR-6:
1. ingest — relax the `TriggerBackfill` gate (plus whatever bound design selects) and its tests; ingest `CLAUDE.md` and the findings line. Adds a migration or config-key step only if design chooses a per-user limit.
2. agent + docs — `trigger_backfill` wording, agent `CLAUDE.md`, `mcp-tools.md`, `strat-lab` skill, parity tests (same PR as step 1's behavior change).
3. ui logic — pure helper(s) in `src/lib/` for gap → request and job status → message, with vitest.
4. ui card — inline action, progress, "Data ready" + re-run, failure states in `BacktestsSection`; fixtures, `getBackfillStatus` mock, distinct-gap sentinel, and the `position-detail.spec.ts:337` update.

If FR-7: one ui step replacing the Backtests card content with scores and "Not enough data", removing the Run button and the callout, plus the e2e update; no ingest, agent or plugin change. @AC-1…@AC-7 and @AC-9 are struck.

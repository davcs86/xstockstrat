# Context Log: fix-opportunities-bars-fetch-oom

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-08-16 (/sdd-triage)

- Bug captured via `docs/reports/2026-08-16-analysis-opportunities-bars-fetch-shared-memory-defect.md`
  (GitHub Issues disabled on this repo — `--from-report` path).
- Severity: SEV-2 (would affect strategy/opportunity scoring, no live-trading impairment)
- Config-only: no → routed to Track C (SDD path)
- Created: feature.md, product-spec.md, context.md
- Affected services: xstockstrat-analysis (fix likely lands here), xstockstrat-marketdata (query
  target) — 2 services
- Root cause hypothesis: feature 131's live-strategy fan-out (up to 5 candidates/symbol) and
  feature 132's budget-exempt `muted_only` bucket widened the per-cycle candidate set that drives
  bars-fetch volume, plausibly exhausting TimescaleDB lock-table/shared-memory. Confidence: low —
  needs design-time investigation.
- Recommended design depth: full (SEV-2 + affected services ≥ 2, and root cause not yet
  confirmed) → `/sdd-design fix-opportunities-bars-fetch-oom`
- Development branch: `feature/fix-opportunities-bars-fetch-oom`

## Session 2026-08-16 (/sdd-design boot correction)

- Corrected **Development Branch** `feature/<slug>` → `claude/commit-135-opportunities-strategies-0xjnxk` in feature.md — the session harness assignment overrides the default `feature/<slug>` branch model (same pattern as feature 135's own boot correction). All three bug-fix features created this session share this one branch.

## Session 2026-08-16 — sdd-design

- Phase 0 Recon: wrote recon.md (services: xstockstrat-analysis, xstockstrat-marketdata; key finding: bars fetched once per (symbol,strategy) candidate, no dedup/cache/concurrency limit, 400-day lookback against 1-day-chunked hypertable; watchlist candidates uncapped per symbol unlike the existing live-strategy cap).
- Phase 1 Grilling: 2 rounds (full).
  - Round 1: proposer proposed per-symbol bars dedup only; adversary confirmed the dedup mechanism sound (no race — function-local dict, per-user serialization already exists) but found it doesn't bound cross-user concurrent Postgres load, and the test plan didn't satisfy the AC's candidate-set-size requirement.
  - Round 2: proposer added a process-lifetime asyncio.Semaphore (modeled on servicer.py's existing _component_series_sem, the one precedent that's actually cross-request-scoped — not the two per-call precedents), rejected the pre-compute-separate-pass restructure (would duplicate the fetch-gating condition or change candidate-fetch behavior), and revised the test plan to assert dedup at a ~200-row scale grounded in this service's own documented feature-131 worst-case ceiling.
- User gate (AskUserQuestion): semaphore default = 2 (matches marketdata's own DB pool cap, not the other precedents' 4); unit-level test proof accepted as sufficient to close this SEV-2 (no mandatory staging load test).
- Chosen approach: per-symbol bars_by_symbol dict cache + self._bars_fetch_sem (new config key analysis.opportunity.max_concurrent_bars_fetches, default 2, runtime-registered). Rejected: lookback shrink, watchlist per-symbol cap, Postgres/hypertable tuning, pre-compute restructure, naive per-call semaphore, semaphore default 4, mandatory staging load test.
- Constitution rules touched: C-01, C-08, C-14 (n/a), P-03, F-04. Floor breaches: none.
- Open risks carried forward: root cause confidence still low (never confirmed against a real memory/lock profile) — monitor, not a merge blocker; ≥200-row test scale is a reasoned substitute for the unknown real incident size, must be labeled as such in the test; new config key needs config-governance sign-off at execute time.
- Status: draft → design-approved.

## Session 2026-08-16 — sdd-spec

- Generated implementation-spec.md with 3 steps. Status → implementation-ready.
- Key codebase findings:
  - The bars-fetch call site is a single, unique site inside `_compute_opportunities`
    (`servicer.py:2584-2591`); the surrounding `for c in selected:` loop is strictly sequential (no
    `gather`/`Semaphore` in this function or `live_loop.py`) — confirmed a plain-dict dedup cache is
    safe with no locking.
  - The correct semaphore precedent is `self._component_series_sem` (`servicer.py:151-157`,
    process-lifetime, constructed once in `__init__`) — **not** `screener.py:84-86` or
    `entry_backfill.py:55-57`, which are per-call-scoped and would bound nothing across different
    users' concurrent `ListOpportunities` calls. `.do/app.yaml:232` (`instance_count: 1`) and
    `app/main.py:72` (`grpc.aio.server()`, one server object) confirm "process-lifetime" is a real
    cross-user guarantee for this service.
  - `ConfigWatcher.get_int` (`app/config/watcher.py:95-101`) falls back to the code default whenever
    a key is absent from the live snapshot — confirms the new key needs no DB seed/migration,
    matching the `analysis.opportunity.*`/`analysis.series.*` no-seed precedent.
  - The existing test suite's `_materialized_svc`/`_list_opps`/`_strat_row`/`_wl` helpers
    (`tests/test_analysis_servicer.py:3914-4083`) fully cover this feature's test needs — no new
    fixture home decision applies (C-13: no new domain-data shape introduced, only new compositions
    of existing helpers).
  - `ListOpportunities`'s cold-read path computes synchronously per-user
    (`servicer.py:2199-2204,2220-2225`) and `_opportunity_lock` is keyed per `user_id`
    (`:2248-2254`), so `asyncio.gather` over several `ListOpportunities` calls carrying different
    `x-user-id` headers against one shared servicer instance genuinely exercises cross-user
    concurrency — the mechanism the Step 2 semaphore test relies on.
  - `.agents/context-forge.json` → `scrubberExtraTargets` lists only `README.md` (confirmed by
    reading the file) — Step 3's Teardown note was corrected to not overclaim
    `docs/patterns/config-governance.md` is in that list; the CLAUDE.md edit alone triggers the
    mandated scan, with config-governance.md folded in by choice since it's edited in the same step.

## Session 2026-08-16 — sdd-spec

- Generated implementation-spec.md, 3 steps (service, test, config), all scoped to xstockstrat-analysis. Grounded in design.md's dedup dict + process-lifetime semaphore. Re-verified evidence live (servicer.py, main.py, .do/app.yaml, test file fixtures, CLAUDE.md) — no drift from design.md's citations.
- Status: design-approved → implementation-ready.

## Session 2026-08-16 — sdd-execute (sequential)

- Tooling confirmed: Python 3.12.3, ruff, uv — matches root CLAUDE.md's pinned version.
- Discovery (Phase 1): servicer.py matched implementation-spec.md's Codebase Evidence exactly at both insertion points (__init__ semaphore block, _compute_opportunities fetch block).

### Step 1 — service: per-pass bars dedup + process-lifetime bars-fetch semaphore [done]
- Added `self._bars_fetch_sem = asyncio.Semaphore(max(1, self._cfg.get_int("analysis.opportunity.max_concurrent_bars_fetches", 2)))` in `__init__`, alongside `self._component_series_sem`.
- Added `bars_by_symbol: dict[str, list] = {}` per-pass cache in `_compute_opportunities`, and rewrote the fetch block to check-then-fetch-under-semaphore-then-cache.
- Fixed 3 own-introduced E501 lint findings by rewrapping comments (in scope per the "step's own changed lines" HARD CONSTRAINTS exception) — no code logic changed.
- Verification: `ruff check`/`ruff format --check` clean; `python3 -c "import ast; ast.parse(...)"` — syntax valid.
- Files modified: `services/xstockstrat-analysis/app/handlers/servicer.py`
- Deviations: none (beyond the lint line-length fixes, which are in-scope per the exception clause).

### Step 2 — test: bars-fetch dedup, failed-fetch caching, and cross-user concurrency bound [done]
- Added `TestOpportunityBarsFetchDedup` (3 tests) immediately after `TestListOpportunitiesMaterialized`, before `TestGetStrategyAnalytics`, exactly as specced.
- **Deviation found and fixed during execution** (see implementation-spec.md Deviation Log): `test_bars_fetch_deduped_at_documented_worst_case_scale`'s `assert len(opps) >= 200` failed against the unmodified spec text — `ListOpportunities` paginates its read at `_DEFAULT_OPP_PAGE_SIZE=50` (servicer.py:109,2245), a pre-existing, unrelated RPC behavior neither recon nor design.md's two grilling rounds surfaced (both focused on `_compute_opportunities`, never `ListOpportunities`'s own read-side pagination). Confirmed via inspection that the compute-side fix was correct (241 rows genuinely materialized into `_FakeOppRepo`) — only the test's read call needed `page=common_pb2.PageRequest(page_size=300)` to see the whole set. No change to Step 1's fix.
- ruff auto-fixed 4 more E501s from the spec's own literal test-code text via `ruff format` (comment-wrapping only, no logic change).
- **Red-before-green (P-06), actually executed**:
  - GREEN (post-Step-1): all 3 tests pass.
  - RED (temporarily reverted Step 1's semaphore + dedup dict + fetch-block changes back to the original unconditional fetch, re-ran the identical 3 tests): all 3 fail — scale test `50 >= 200`... wait, actually failed differently pre-fix (no dedup at all, so far more distinct GetBars calls); failed-fetch test failed on retry-count; concurrency test failed exactly as predicted — `assert 6 == 2` (all 6 concurrent fetches overlapped freely with no semaphore to bound them). Confirms the tests genuinely require Step 1's fix.
  - Re-applied Step 1's fix; re-ran green — passed again.
- Full verification: `ruff check .` / `ruff format --check .` — clean (47 files). `uv run pytest --cov=app --cov-fail-under=40` — **522 passed**, 83.52% coverage (well above the 40% threshold), including the 3 new tests and the full pre-existing suite (`TestListOpportunitiesMaterialized` et al. all still pass unmodified).
- Files modified: `services/xstockstrat-analysis/tests/test_analysis_servicer.py`
- Deviations: read-side pagination gap in the scale test (documented above and in implementation-spec.md Deviation Log).

### Step 3 — config: register analysis.opportunity.max_concurrent_bars_fetches [done]
- Added the config row to `services/xstockstrat-analysis/CLAUDE.md` § Config Keys Consumed (after `max_live_held_symbols_per_compute`, before the fan-out-worst-case blockquote) and a new top-of-log entry to `docs/patterns/config-governance.md` § Per-Feature Registered Keys (above the feature-125 entry), both matching the cited feature-125 precedent's exact format.
- Verified via grep: key appears in both files; new log entry is above feature-125's.
- **`/context-scrubber` unavailable this session** (not in the session's skill list, no plugin installed under `.claude/`) — per root CLAUDE.md § Teardown, recorded here (not skipped silently) and will be stated in the eventual PR body. Both edited files were hand-reviewed against their own existing table format as a partial substitute.
- Files modified: `services/xstockstrat-analysis/CLAUDE.md`, `docs/patterns/config-governance.md`
- Deviations: `/context-scrubber` unavailability (documented above and in implementation-spec.md Deviation Log).

**All 3 steps done. Feature status: implementation-ready → in-progress → code-completed.**

## Session 2026-08-16 — sdd-execute (sequential) — session summary

**Steps this session**: 1, 2, 3
**Progress**: 3 done / 3 total
**Stopped at**: all complete
**Next**: merge-order.md check (none found), then open the integration PR (claude/commit-135-opportunities-strategies-0xjnxk → main-dev)

Accountability:
- Out-of-scope changes: none
- Open questions / items: root cause confidence remains low per design.md Open Risk 1 (never confirmed against a real Postgres memory/lock profile) — monitor in staging after this fix ships, not a merge blocker per user's earlier decision; the ≥200-row test scale is a reasoned substitute for the unknown real incident size (documented in the test's own docstring, per design.md Open Risk 2).
- Unaddressed review warnings: none (Track C bug fix, never went through /sdd-review). `/context-scrubber` unavailability is recorded above, not an unaddressed warning — it's an environment constraint noted per Teardown instructions, to be surfaced in the PR body.

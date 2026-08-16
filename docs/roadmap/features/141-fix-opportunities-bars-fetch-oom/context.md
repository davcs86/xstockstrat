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

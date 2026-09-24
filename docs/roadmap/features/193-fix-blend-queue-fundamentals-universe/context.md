# Context Log: fix-blend-queue-fundamentals-universe

## 2026-09-19 — triage + fix (single session)

**Triage.** One of three defects reported today (`docs/reports/2026-09-18-*`). SEV-3, code change,
shipped/dev → Track C. Confirmed every code claim in the report against `main-dev` before coding
(blend branch at `live_loop.py` only; `servicer.py:3911` and `entry_backfill.py` both call
`resolve_universe` with no branch).

**Design fork — Approach A vs B (operator-approved: A).** The report posed hoist (A) vs patch
`_compute_opportunities` only (B). The defect *is* a duplicated-contract failure across three
callers, so B re-commits to the duplication that caused it and leaves `entry_backfill` divergent. A
was chosen with explicit operator sign-off.

**Implementation (A).**
- `resolve_universe(definition, watchlist, held, signals, *, blend_id="", fundamentals_universe=None)`:
  when `blend_id` is set and this strategy is it, pre-deny coverage = the fundamentals universe (∪
  `held ∩ denied` for exit retention), never watchlist/held/signals. `signal_eligible` is inert for
  the blend by construction. Non-blend path byte-identical.
- Extracted `resolve_fundamentals_universe(ingest, marketdata, cfg)` to a module-level function
  (the single seam); `LiveEvaluationLoop._resolve_fundamentals_universe` now delegates.
- `_run_cycle` routes the blend through `resolve_universe` (kept its `continue` skip when inactive/
  empty — loop behavior preserved).
- `_compute_opportunities` + `entry_backfill.run_once` resolve `fundamentals_universe` when the blend
  is active and pass the kwargs; each skips the blend when inactive/empty (loop-skip parity).

**Equivalence proof for the loop.** blend `universe = (union − denied) | deny_entry` where
`union = norm(fundamentals_universe) | deny_entry` ⇒ `(fund − denied) | (held ∩ denied)` — identical
to the prior inline computation.

**Surfaced (NOT fixed here) — doc/code discrepancy on the disabled path.** The analysis CLAUDE.md
says when the blend kill-switch is off the strategy "resolves its own universe like any other," but
`live_loop._run_cycle` `continue`s (evaluates it nowhere) when `not blend_active`. This fix preserves
the loop's actual behavior and makes the queue/backfill match it (skip when inactive). Reconciling
the disabled-path intent is a separate question, left for the doc/loop owner — not silently changed.

**Verified not a leak.** feature-180 readiness materializer warms only watchlist-bound pairs (user
intent), not auto-attribution.

**Tests (red-before-green reasoning).** `resolve_universe` blend-branch unit tests (3),
`_compute_opportunities` defect reproduction (blend attributed to AAPL only, not COIN/NVDA — RED
pre-fix because signal_eligible union included both), entry-backfill blend restriction test. All
green; full analysis suite 773 passed; ruff clean.

**Files:** `services/xstockstrat-analysis/app/engine/live_loop.py`,
`app/handlers/servicer.py`, `app/engine/entry_backfill.py`,
`tests/test_analysis_servicer.py`, `tests/test_entry_backfill.py`.

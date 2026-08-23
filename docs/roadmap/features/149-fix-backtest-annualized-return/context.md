# Context Log: fix-backtest-annualized-return

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-08-23 (/sdd-triage)

- Bug recorded via defect report `docs/reports/2026-08-23-backtest-annualized-return-underscaled-defect.md`
  (GitHub Issues disabled on this repo → --from-report path).
- Severity: SEV-2. Environment: dev/staging. Config-only: no. Impact: misleading-backtest-metric.
- Routed to SDD path (Track C) per T-4 (SEV-2, non-production).
- Created: feature.md, product-spec.md, acceptance.feature (regression scenarios), context.md, status.md.
- Affected services: xstockstrat-analysis (only).
- Root cause: `_compute_metrics` derives the annualization period from `len(daily_equity)`, but the
  aggregate curve is the concatenation of N per-symbol curves, so n_days ≈ 33×248 ≈ 8170 instead of
  ~252 → the 252/n_days exponent is ~33× too small. Confirmed by back-solving three observed pairs to
  a constant n_days ≈ 8170. Full analysis in `_tasks/x-backtest-metrics-audit.md` (Q3).
- Recommended design depth: **quick** → `/sdd-design fix-backtest-annualized-return quick` (rationale:
  SEV-2, single service, no proto/migration/config, clear root cause — too small to debate fully, too
  risky to skip).
- Development branch: this work rides the harness-assigned `claude/xstockstrat-metrics-sweep-m070rf`
  (the session's designated branch) rather than a fresh `feature/` branch, per the session's binding
  branch constraint. All artifacts + the fix land in PR #1004 → main-dev.
- Grade-neutral + forward-only fix, scoped to the aggregate metrics call only (per-symbol cells
  untouched). This is finding #1 of the metrics-sweep audit; findings #2 (serial-parlay sizing) and #3
  (same-bar-close fill) are separate features, story+design only per operator decision.

## Session 2026-08-23 (implementation)

- Design phase: skipped as optional-for-bug (Track C, C-0) — the audit `_tasks/x-backtest-metrics-audit.md`
  already grounded the root cause and the fix is a minimal, grade-neutral metric change.
- Red-before-green (P-06): added `TestComputeMetrics` cases in
  `services/xstockstrat-analysis/tests/test_analysis_helpers.py` exercising `period_years`; confirmed
  RED (`TypeError: unexpected keyword argument 'period_years'`) before the fix, GREEN after.
- Fix (`services/xstockstrat-analysis/app/handlers/servicer.py`):
  - `_compute_metrics` gained an optional `period_years` param; when set, annualizes as
    `(1+total_return) ** (1/period_years) - 1`, else legacy `252/n_days` behaviour.
  - `RunBacktest` aggregate call now passes `period_years` derived from `request.range` span
    (`(end-start)/86400/365.25`); per-symbol evidence-cell calls unchanged → grade-neutral.
- Verification: `uv run pytest` → 544 passed, 82.52% coverage (gate 40%); `ruff check`/`ruff format
  --check` clean on both changed files.
- Scope held: no change to Sharpe periodization, the serial-parlay total_return (#2), or the fill
  model (#3). Forward-only — historical `backtest_runs.annualized_return` rows unchanged.
- AC-3 (grade-neutral) is covered by the unchanged 544-test suite (per-symbol cell metrics + derived
  grade tests all still pass) plus `test_default_path_unchanged_without_period_years`.

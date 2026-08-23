# Context: backtest-portfolio-sizing

**Feature**: `docs/roadmap/features/150-backtest-portfolio-sizing/feature.md`
**Product Spec**: `docs/roadmap/features/150-backtest-portfolio-sizing/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/150-backtest-portfolio-sizing/implementation-spec.md`

---

## Session 2026-08-23 — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from the
  metrics-sweep audit finding #2 (`_tasks/x-backtest-metrics-audit.md` Q2; `_tasks/x-strategy-followup-sweep.md`).
- Root evidence: `services/xstockstrat-analysis/app/handlers/servicer.py:522,525-529,571,3630` — serial
  equity threading + per-symbol curve concatenation → aggregate total_return is Π(1+rᵢ)−1.
- Operator decision this session: **story + design only** — stop before /sdd-spec and /sdd-execute so
  the design (allocation policy, opt-in/versioned mechanism, comparability guardrails) is approved
  before any behavior code is written. This is a behavior redesign that would retroactively affect
  banked-backtest comparability, hence gated on opt-in + explicit approval.
- Known traps surfaced (ledger): 067 (proto enum ↔ UI exhaustive `Record` map coupling — a new
  sizing-mode enum needs its TS map key in the same PR); analysis review focus = backtest
  reproducibility / no look-ahead bias.
- Consumer surfaces (C-14): Agent `run_backtest` (+ strat-lab `backtest` skill update in same PR) and
  UI `/insights` backtest views (mode labeling). Scope to be pinned in design.
- Development branch note: rides `claude/xstockstrat-metrics-sweep-m070rf` this session per the binding
  branch constraint rather than a fresh `feature/` branch.

## Session 2026-08-23 — sdd-design

- Phase 0 Recon: wrote recon.md (services: analysis + agent + ui; reuse: _compute_metrics, per-symbol
  cells, cooldown helpers, additive enum shape). Four recon subagents (analysis, agent, ui, scenario-recon).
- Phase 1 Grilling: 5 rounds (full; user overrode the default and ran to the cap). Chosen approach:
  dedicated _simulate_portfolio fed per-bar intent RETURNED additively by the existing simulators
  (single fetch), shared cash pool + concurrent positions on a union calendar, cooldown applied
  portfolio-locally, force-close-realized terminal policy, portfolio equity curve fed to existing
  _compute_metrics; legacy path byte-for-byte, grade per-symbol-cell (FR-4). Config-only sizing params.
- Rejected: diagnostics-replay (lossy), double-pass (2× fetch, feature-141 hazard), live-equity sizing
  (order-dependent), request-override params (speculative), graded-conviction (binary conviction).
- Constitution rules touched: C-04, C-05/F-07, C-08/P-06, C-09, C-10/C-14, C-16, F-01, F-06. Floor
  breaches: none at any round.
- Cross-feature field/migration coordination with 151 recorded in merge-order.md (150 owns
  RunBacktestRequest.8, BacktestResult 17/18/19, BacktestRunSummary 17, migration 017; 151 takes the
  next slots). Numbers re-derived from the merged tree at /sdd-spec time.
- Open risks (carried): shared-calendar forward-fill look-ahead (AC (e) needs a mid-series-gap
  fixture); stale-close drawdown understatement; merge-order.md SPOF; symbol-ASC systematic bias;
  per-symbol BarDiagnostic.equity stays per-symbol.
- Status: draft → design-approved. Operator decision: stop before /sdd-spec this session.

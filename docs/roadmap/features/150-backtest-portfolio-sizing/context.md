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

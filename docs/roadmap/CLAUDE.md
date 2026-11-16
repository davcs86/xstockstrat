# docs/roadmap/ — Implementation Roadmap & Deviation Notes

| File | Purpose |
|---|---|
| `implementation-roadmap.md` | Full platform implementation plan across 8 phases (Phase 0 foundation → Phase 7 observability). Includes per-phase service specs, verification checkpoints, and the dependency graph. |
| `phase3-deviations.md` | Phase 3 deviations — indicators, ingest, analysis. |
| `phase4-deviations.md` | Phase 4 deviations — trading. |
| `phase5-deviations.md` | Phase 5 deviations — config-ui, trader, insights frontends. |
| `phase6-deviations.md` | Phase 6 deviations — webhook paths, integration-test approach, auth scope. |
| `phase7-deviations.md` | Phase 7 deviations — observability (feature 033). |

---

## Feature Implementations

Active and in-progress feature SDD artifacts live in [`features/`](features/CLAUDE.md).
Each feature tracks lifecycle status from `idea` through `launched` or `demoted/canceled`.
Run `/sdd-status` for a summary table, or read `features/<slug>/feature.md` for a specific feature.

## Institutional Ledger

Cross-feature SDD memory → [`ledger/`](ledger/CLAUDE.md).

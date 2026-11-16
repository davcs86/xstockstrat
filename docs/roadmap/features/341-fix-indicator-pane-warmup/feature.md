# Feature: fix-indicator-pane-warmup

**Type**: bug
**Development Branch**: `feature/fix-indicator-pane-warmup`
**GitHub Issue**: n/a (Issues disabled) — report `docs/reports/2026-11-15-indicator-panel-sma200-single-point-defect.md`
**Severity**: SEV-3
**Created**: 2026-11-15
**Last Updated**: 2026-11-15

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-15 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from the defect report |
| 2026-11-15 | `draft` → `spec-ready` | /sdd-review | Product spec approved (4 warnings) |
| 2026-11-15 | `spec-ready` (unchanged) | orchestrator | Product spec amended at the design gate under operator sanction: one config key + its seed migration now in scope; marketdata and config added to Affected Services |
| 2026-11-15 | `spec-ready` → `design-approved` | /sdd-design | Design debated (5 rounds, full) and approved; recon.md + debate.md + design.md written |
| 2026-11-15 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 17 steps; acceptance.feature AC-1 / AC-3 preconditions name the configured history depth (design.md § 9) |
| 2026-11-15 | `implementation-ready` → `in-progress` | /sdd-execute | → in-progress (sdd-batch-execute setup); main-dev `9f8856229` merged, steps 1-17 re-specced (conditional) |
| 2026-11-15 | `in-progress` → `code-completed` | /sdd-execute | All 17 steps done (Step 17 docs last); `check-config-wiring.mjs --final` exit 0 |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Recon](recon.md) — grounded codebase dossier
- [Debate Register](debate.md) — settled decisions, rejected alternatives, objections
- [Design](design.md) — approved approach, rejected alternatives, open risks
- [Implementation Spec](implementation-spec.md) — 17 numbered steps with codebase evidence
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

On the symbol page indicator chart, a 200-period average over a ~190-bar window renders one dot because the series is computed without a warm-up prefix.

## Reviewers

_(Snapshot finalized by /sdd-spec on 2026-11-15 from docs/runbooks/reviewer-registry.md and the
per-step `**Reviewers**` lines. Re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| Proto Reviewer | Field number uniqueness per message, no breaking change, `buf lint` and `buf breaking` pass |
| `packages/proto` owner | Field number uniqueness, backward compatibility, naming conventions |
| `xstockstrat-analysis` owner | Backtest reproducibility, strategy scoring determinism, no look-ahead bias |
| `xstockstrat-marketdata` owner | OHLCV ingestion integrity, TimescaleDB hypertable partitioning |
| `xstockstrat-config` owner | Config key naming, environment scoping, WatchConfig stream stability |
| `xstockstrat-ui` owner | Trading UI correctness, analytics display accuracy, Connect-RPC call safety, environment scope correctness |
| DBA | Migration NNN numbering, up+down pair present, run-order compliance with `scripts/db-migrate.sh` |

## Next Action

`/sdd-review fix-indicator-pane-warmup impl-spec` — validate implementation spec, then `/sdd-execute fix-indicator-pane-warmup`

# Feature: fix-fundsignal-neutral-score

**Type**: bug
**Development Branch**: `feature/fix-fundsignal-neutral-score`
**GitHub Issue**: none (Issues disabled). Defect report: `docs/reports/2026-10-19-analysis-fundsignal-neutral-score-fabricated-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-20
**Last Updated**: 2026-10-28
**Committed to main**: df521ff51091a86e813950b34afff09ac4e8821b
**Launched date**: 2026-10-30

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-10-20 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from `docs/reports/2026-10-19-analysis-fundsignal-neutral-score-fabricated-defect.md` |
| 2026-10-20 | `draft` → `spec-ready` | /sdd-review | Product spec approved (8 warnings, 3 notes; overlap PASS) |
| 2026-10-20 | `spec-ready` (unchanged) | /sdd-review | Re-review: PASS WITH WARNINGS (7 warnings, 4 notes; 0 fails, 0 Floor breaches). Overlap WARN (244 read-side, `analysis.fundsignal.min_conviction_to_emit`); no merge-order row. AC-2 re-anchored to emitted surface; residual-signal owner added to Open for Design. |
| 2026-10-21 | `spec-ready` → `design-approved` | /sdd-design | Design debated (8 rounds, full; cap lifted to 8 by operator override) and approved by the operator 2026-10-21; recon.md + design.md written; B.1 spec amendments applied; B.2/B.3 defect reports filed |
| 2026-10-21 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 3 steps |
| 2026-10-28 | `implementation-ready` → `in-progress` | /sdd-execute sequential (sdd-batch-execute) | Up-front plan confirmed by operator standing authorization (operator chat 2026-10-28, session_01NpS3HShZK6pSnogA7CFo2f); origin/main-dev merged into the branch |
| 2026-10-28 | `in-progress` (unchanged) | /sdd-execute sequential (sdd-batch-execute) | Step 1 (test) done: `fundamentals_row` factory, fixture migration, AC-1/AC-2/AC-3 + WARN wiring tests (13 RED as specified) |
| 2026-10-28 | `in-progress` (unchanged) | /sdd-execute sequential (sdd-batch-execute) | Step 2 (service) done: presence-based `_builtin_score`, all-missing skip in both scorers, run-attributed `_warn_unscored` WARN (13 RED → GREEN) |
| 2026-10-28 | `in-progress` (unchanged) | /sdd-execute sequential (sdd-batch-execute) | Step 3 (docs) done: analysis producer docs (idempotency, unscored symbols), `dry_run` doc drift (agent docstring, `mcp-tools.md`), `analysis.proto:554` findings row, manual teardown (context-constitution refresh unavailable) |
| 2026-10-28 | `in-progress` → `code-completed` | /sdd-execute sequential (sdd-batch-execute) | All 3 steps done; C-16 promotion applied per the operator-confirmed plan (AC-1..AC-3 → `services/xstockstrat-analysis/acceptance/fix-fundsignal-neutral-score.feature`, `@feature-246`); integration PR opened to `main-dev` |

| 2026-10-30 | `code-completed` → `launched` | CI workflow | Promoted via PR #1368; committed df521ff51091a86e813950b34afff09ac4e8821b |
---

## Reviewers

Snapshot from `docs/runbooks/reviewer-registry.md` at /sdd-spec time (2026-10-21). Stable unless `/sdd-spec` re-runs.

| Reviewer | Focus | Steps |
|---|---|---|
| `xstockstrat-analysis` owner | Backtest reproducibility, strategy scoring determinism, no look-ahead bias | 1 (test), 2 (service) |
| none (docs) | Advisory: `xstockstrat-agent` owner — MCP tool contract stability and `docs/runbooks/mcp-tools.md` parity (`tools.py:1409` docstring) | 3 (docs) |

`xstockstrat-ingest` is a downstream recipient only; no step touches it, so it has no step reviewer.

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Recon](recon.md) — Phase 0 codebase dossier
- [Design](design.md) — approved design (8 rounds, full)
- [Implementation Spec](implementation-spec.md) — 3 steps (test → service → docs)
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

The fundamentals signal producer's `_builtin_score` returns a fabricated 0.5 for a symbol with no usable
metric, which then enters the cross-sectional quantile and is emitted to ingest as a real signal. The
truthiness checks also drop metrics whose real value is 0.

## Next Action

`/sdd-execute fix-fundsignal-neutral-score sequential` — execute Steps 1-3

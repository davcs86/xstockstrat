# Feature: fix-signal-screen-crash

**Type**: bug
**Development Branch**: `feature/fix-signal-screen-crash`
**Defect Report**: `docs/reports/2026-08-26-signal-screen-bar-timestamp-crash-defect.md` (GitHub Issues disabled on this repo)
**Severity**: SEV-2
**Created**: 2026-08-26
**Last Updated**: 2026-08-26
**Committed to main**: 65aeaa4c5bb7c000dfb4e30d5b788d6c39352234
**Launched date**: 2026-08-26
**Archived**: 2026-08-26

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-26 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from defect report (2026-08-26-signal-screen-bar-timestamp-crash) |
| 2026-08-26 | `draft` → `design-approved` | /sdd-design | Design debated (2 rounds, full) and approved; recon.md + design.md written. One-line fix + window-discriminating RED tests + ledger-mandated _make_bar reshape |
| 2026-08-26 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 3 steps |
| 2026-08-26 | `implementation-ready` → `in-progress` | /sdd-execute | Step 1 done (test: _make_bar reshaped to real Bar + @AC-2 anchor; RED captured, greens at Step 3) |
| 2026-08-26 | `in-progress` → `code-completed` | /sdd-execute | Steps 2 (@AC-1 screener seam RED) & 3 (scoring.py `bar.timestamp`→`bar.time` fix) done; full suite GREEN (624 passed, 84.78% cov). Manual dev smoke deferred to post-deploy |
| 2026-08-26 | `code-completed` (renumber 159→160) | manual | NNN collision: `fix-offline-account-ui-gaps` (merged, PR #1022) also took 159; renumbered this not-yet-merged feature to 160 (dir + live refs + @feature tags). Docs/tests-only, no behavior change |

| 2026-08-26 | `code-completed` → `launched` | CI workflow | Promoted via PR #1027; committed 65aeaa4c5bb7c000dfb4e30d5b788d6c39352234 |
| 2026-08-26 | `launched` | /sdd-archiver | Archived: synthesis → context.md + Ledger insights(1)/fails(0); scenarios already promoted (all DUP); pruned 4 specs |
---

## Reviewers

| Step category(s) | Reviewer | Focus |
|---|---|---|
| `test`, `service` (Steps 1–3) | xstockstrat-analysis owner | Strategy scoring determinism, no look-ahead bias |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Recon](recon.md) — grounded codebase dossier (Phase 0)
- [Design](design.md) — debated, approved architecture (Phase 1)
- [Implementation Spec](implementation-spec.md)
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Signal-weighted `ScreenSymbols` crashes with `AttributeError: timestamp` because
`app/services/scoring.py` reads `bar.timestamp` while the marketdata `Bar` proto field is `time`.
Breaks all signal-weighted screening (any `signal_sources` with `signal_weight > 0`), not just the
fundamentals producer.

## Next Action

`/sdd-review fix-signal-screen-crash impl-spec` — validate implementation spec, then `/sdd-execute fix-signal-screen-crash`

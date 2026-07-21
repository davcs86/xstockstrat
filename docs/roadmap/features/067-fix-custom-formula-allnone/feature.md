# Feature: fix-custom-formula-allnone

**Type**: bug
**Lifecycle Status**: `code-completed`
**Development Branch**: `feature/fix-custom-formula-allnone`
**GitHub Issue**: n/a — GitHub Issues are disabled on `davcs86/xstockstrat`; bug captured directly via `/sdd-triage` (Track C)
**Severity**: SEV-2
**Created**: 2026-07-21
**Last Updated**: 2026-07-21

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-07-21 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from staging backtest evidence (Issues disabled — no GitHub issue) |
| 2026-07-21 | `draft` → `design-approved` | /sdd-design | Design debated (1 round, quick) and approved; recon.md + design.md written. Dir renumbered 065→067 (collision). |
| 2026-07-21 | `design-approved` (re-debated) | /sdd-design | Re-opened at user request; rounds 2–3 landed on **Option A** — proto enum `NO_TRADE_REASON_FORMULA_ERROR` + shared UI surface + all-failed-status guard. Scope grew to analysis + proto + ui. design.md rewritten. |
| 2026-07-21 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 9 steps |
| 2026-07-21 | `implementation-ready` → `code-completed` | /sdd-execute (sequential) | All 9 steps executed & verified; 3 deviations logged (D-1 MessageToDict-NaN, D-2 test corrected, D-3 UI e2e CI-equivalent fallback). Pushed as a single PR. |

---

## Reviewers

| Step Category | Reviewer Roles |
|---|---|
| `proto` / `proto-gen` (Steps 1–2) | Proto Reviewer — field/value number uniqueness, `buf lint`/`buf breaking`, no breaking change; xstockstrat-analysis owner — backtest reason semantics; xstockstrat-ui owner — enum consumed by the shared diagnostics renderer |
| `service` / `test` — analysis (Steps 3–6, 9) | xstockstrat-analysis owner — backtest reproducibility, strategy scoring determinism, no look-ahead bias |
| `service` / `test` — ui (Steps 7–8) | xstockstrat-ui owner — analytics display accuracy, Connect-RPC call safety, no secret values rendered in UI |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Recon Dossier](recon.md) — grounded codebase map, confirmed root cause, patterns to reuse
- [Design](design.md) — debated & approved architecture, rejected alternatives, open risks
- [Implementation Spec](implementation-spec.md)
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Strategy components backed by **custom formulas** return an all-`None` series during backtests, so
per-bar diagnostics carry an empty `indicators: {}`, the entry condition is never true, and the
strategy produces 0 trades (`NO_TRADE_REASON_ENTRY_NEVER_TRUE`). Builtin-indicator strategies on the
same data are unaffected. Blocks validation/grading of any custom-formula strategy.

## Next Action

Merge the integration PR (`claude/feature-067-sequence-mode-20vup4` → `main-dev`) once CI passes and reviewers approve. Verify the `formula-error` e2e banner test in the CI `frontend-e2e` job (run locally via the CI-equivalent fallback — see context.md / Deviation Log D-3).

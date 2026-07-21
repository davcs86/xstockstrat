# Feature: fix-custom-formula-allnone

**Type**: bug
**Lifecycle Status**: `draft`
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

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-custom-formula-allnone`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Strategy components backed by **custom formulas** return an all-`None` series during backtests, so
per-bar diagnostics carry an empty `indicators: {}`, the entry condition is never true, and the
strategy produces 0 trades (`NO_TRADE_REASON_ENTRY_NEVER_TRUE`). Builtin-indicator strategies on the
same data are unaffected. Blocks validation/grading of any custom-formula strategy.

## Next Action

`/sdd-design fix-custom-formula-allnone quick` — recommended design depth (quick) from triage; see context.md

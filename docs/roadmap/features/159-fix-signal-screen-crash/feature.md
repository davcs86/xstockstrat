# Feature: fix-signal-screen-crash

**Type**: bug
**Development Branch**: `feature/fix-signal-screen-crash`
**Defect Report**: `docs/reports/2026-08-26-signal-screen-bar-timestamp-crash-defect.md` (GitHub Issues disabled on this repo)
**Severity**: SEV-2
**Created**: 2026-08-26
**Last Updated**: 2026-08-26

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-26 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from defect report (2026-08-26-signal-screen-bar-timestamp-crash) |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-signal-screen-crash`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Signal-weighted `ScreenSymbols` crashes with `AttributeError: timestamp` because
`app/services/scoring.py` reads `bar.timestamp` while the marketdata `Bar` proto field is `time`.
Breaks all signal-weighted screening (any `signal_sources` with `signal_weight > 0`), not just the
fundamentals producer.

## Next Action

`/sdd-design fix-signal-screen-crash quick` — recommended design depth (quick) from triage; see context.md

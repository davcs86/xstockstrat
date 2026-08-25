# Feature: fix-fundamentals-signal-producer

**Type**: bug
**Development Branch**: `feature/fix-fundamentals-signal-producer`
**Defect Report**: `docs/reports/2026-08-25-fundsignal-first-cycle-resets-on-redeploy-defect.md` (GitHub Issues disabled on this repo — report filed via `/sdd-qa defect`)
**Severity**: SEV-2
**Created**: 2026-08-25
**Last Updated**: 2026-08-25

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-25 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from defect report `docs/reports/2026-08-25-fundsignal-first-cycle-resets-on-redeploy-defect.md` |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-fundamentals-signal-producer`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

The fundamentals signal producer schedules its cycles with an in-process `asyncio.sleep` placed
*before* the first run and keeps no persisted schedule, so every redeploy (CI/CD fires on every
`main-dev` push) restarts a fresh full-interval sleep and the first cycle can be deferred
indefinitely — the producer effectively never emits. Fix the boot timing so the first cycle fires
promptly and survives restarts.

## Next Action

`/sdd-design fix-fundamentals-signal-producer quick` — recommended design depth (quick) from triage; see context.md

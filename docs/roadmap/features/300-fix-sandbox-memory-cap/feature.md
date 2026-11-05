# Feature: fix-sandbox-memory-cap

**Type**: bug
**Development Branch**: `feature/fix-sandbox-memory-cap`
**GitHub Issue**: none (Issues disabled) — defect report `docs/reports/2026-10-15-indicators-sandbox-memory-cap-not-enforced-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-15
**Last Updated**: 2026-10-15

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-10-15 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from `docs/reports/2026-10-15-indicators-sandbox-memory-cap-not-enforced-defect.md` |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-sandbox-memory-cap`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

On the DigitalOcean runtime, the indicators formula sandbox's memory cap (`RLIMIT_DATA` = baseline + headroom) is not
enforced. A 400 MiB formula succeeded on staging under a 128 MiB headroom, but it fails correctly on a native kernel.
Formulas can therefore exhaust the indicators container's memory.

## Next Action

`/sdd-design fix-sandbox-memory-cap quick` — recommended design depth (quick) from triage; see context.md

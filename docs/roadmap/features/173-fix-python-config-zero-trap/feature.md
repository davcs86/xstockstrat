# Feature: fix-python-config-zero-trap

**Type**: bug
**Development Branch**: `feature/fix-python-config-zero-trap`
**Defect Report**: `docs/reports/2026-09-04-comment-audit-triage.md` (item 3) — GitHub Issues disabled on this repo
**Severity**: SEV-2
**Created**: 2026-09-04
**Last Updated**: 2026-09-04

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-09-04 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from comment-audit report item 3 (re-confirms CF-N10) |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-python-config-zero-trap`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

The indicators and ingest config watchers use `v.int_val or default` / `v.float_val or default` /
`v.string_val or default`, so a legitimately-stored `0` / `0.0` / `""` silently reverts to the coded
default. `xstockstrat-analysis` already solved the numeric case with `get_int_present` /
`get_float_present` (`HasField`); indicators and ingest have **no** equivalent, so every 0-meaningful
numeric/string key there is trapped. The `ConfigValue` proto is a `oneof` that distinguishes 0 from
unset, so this is a consumer defect, not a contract limit.

## Next Action

`/sdd-design fix-python-config-zero-trap` — recommended design depth (full — SEV-2, ≥2 services); see context.md

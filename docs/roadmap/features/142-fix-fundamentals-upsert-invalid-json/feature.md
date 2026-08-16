# Feature: fix-fundamentals-upsert-invalid-json

**Type**: bug
**Lifecycle Status**: `draft`
**Development Branch**: `claude/commit-135-opportunities-strategies-0xjnxk`
**GitHub Issue**: n/a — GitHub Issues are disabled on `davcs86/xstockstrat`; bug captured directly via `/sdd-triage` (Track C) from `docs/reports/2026-08-16-marketdata-fundamentals-upsert-invalid-json-defect.md`
**Severity**: SEV-3
**Created**: 2026-08-16
**Last Updated**: 2026-08-16

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-16 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from defect report |
| 2026-08-16 | `draft` (unchanged) | /sdd-triage (boot correction) | Corrected **Development Branch** `feature/fix-fundamentals-upsert-invalid-json` → `claude/commit-135-opportunities-strategies-0xjnxk` — session's harness assignment requires all work stay on the `claude/*` branch (same pattern as feature 135's own boot correction) |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-fundamentals-upsert-invalid-json`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

`MarketDataRepo.UpsertFundamentals` fails for at least one symbol (UPRO, a leveraged ETF) with
Postgres `invalid input syntax for type json (SQLSTATE 22P02)`, so its fundamentals never persist
to cache and are re-fetched from the provider on every request. Root cause is not yet isolated to
a specific field; unrelated to features 131/132/133/134/022/138 (none touch `xstockstrat-marketdata`).

## Next Action

`/sdd-design fix-fundamentals-upsert-invalid-json quick` — recommended design depth (SEV-3 but
root cause not yet clear → quick per triage C-0); see context.md

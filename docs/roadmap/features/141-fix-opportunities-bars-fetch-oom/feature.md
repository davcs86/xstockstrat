# Feature: fix-opportunities-bars-fetch-oom

**Type**: bug
**Lifecycle Status**: `draft`
**Development Branch**: `claude/commit-135-opportunities-strategies-0xjnxk`
**GitHub Issue**: n/a — GitHub Issues are disabled on `davcs86/xstockstrat`; bug captured directly via `/sdd-triage` (Track C) from `docs/reports/2026-08-16-analysis-opportunities-bars-fetch-shared-memory-defect.md`
**Severity**: SEV-2
**Created**: 2026-08-16
**Last Updated**: 2026-08-16

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-16 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from defect report |
| 2026-08-16 | `draft` (unchanged) | /sdd-triage (boot correction) | Corrected **Development Branch** `feature/fix-opportunities-bars-fetch-oom` → `claude/commit-135-opportunities-strategies-0xjnxk` — session's harness assignment requires all work stay on the `claude/*` branch (same pattern as feature 135's own boot correction) |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-opportunities-bars-fetch-oom`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

`_compute_opportunities`'s per-candidate bars-fetch call to `xstockstrat-marketdata` intermittently
fails with Postgres `out of shared memory (SQLSTATE 53200)`, skipping affected symbols for that
cycle's opportunity scoring/readiness trace. The per-cycle candidate set was structurally widened by
feature 131 (live-strategy fan-out, up to 5 extra candidates/symbol) and feature 132 (a
budget-exempt `muted_only` bucket), plausibly pushing an already-borderline bars query over a
lock-table/shared-memory threshold.

## Next Action

`/sdd-design fix-opportunities-bars-fetch-oom` (full) — recommended design depth (SEV-2 + 2
affected services → full per triage C-0); see context.md

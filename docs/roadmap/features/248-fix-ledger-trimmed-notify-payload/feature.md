# Feature: fix-ledger-trimmed-notify-payload

**Type**: bug
**Development Branch**: `feature/fix-ledger-trimmed-notify-payload`
**GitHub Issue**: none (Issues disabled). Defect report: `docs/reports/2026-10-19-ledger-stream-trimmed-notify-payload-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-20
**Last Updated**: 2026-10-20

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-10-20 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from `docs/reports/2026-10-19-ledger-stream-trimmed-notify-payload-defect.md` |
| 2026-10-20 | `draft` → `spec-ready` | /sdd-review | Product spec approved (6 warnings; overlap WARN: sequencing on 252) |

---

## Reviewers

Snapshot from `docs/runbooks/reviewer-registry.md` at /sdd-triage time (2026-10-20). `/sdd-spec` overwrites it with per-step assignments.

| Reviewer | Focus | Steps |
|---|---|---|
| `xstockstrat-ledger` owner | Append-only invariant (no deletes or updates), event ordering, hypertable partition safety | TBD (/sdd-spec) |
| `xstockstrat-analysis` owner | Backtest reproducibility, strategy scoring determinism, no look-ahead bias | TBD (/sdd-spec) — consumer verification only |
| `xstockstrat-portfolio` owner | P&L calculation accuracy, position snapshot consistency, concurrent write safety | TBD (/sdd-spec) — consumer verification only |
| DBA | Migration NNN numbering, up+down pair, run order | Only if design changes the `notify_event_inserted` trigger |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-ledger-trimmed-notify-payload`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Live `StreamEvents` forwards the trigger's trimmed NOTIFY stub (no `payload`, no `occurred_at`) for events whose
`row_to_json` exceeds 7000 chars, so live consumers (analysis, portfolio) process an empty payload and an Invalid
`occurredAt`, then advance their cursor past the event.

## Next Action

`/sdd-design fix-ledger-trimmed-notify-payload` (full — operator: no quick designs); see context.md session 2026-10-20 sdd-review for design carry items

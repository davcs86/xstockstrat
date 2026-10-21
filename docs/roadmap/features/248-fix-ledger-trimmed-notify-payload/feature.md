# Feature: fix-ledger-trimmed-notify-payload

**Type**: bug
**Development Branch**: `feature/fix-ledger-trimmed-notify-payload`
**GitHub Issue**: none (Issues disabled). Defect report: `docs/reports/2026-10-19-ledger-stream-trimmed-notify-payload-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-20
**Last Updated**: 2026-10-21

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-10-20 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from `docs/reports/2026-10-19-ledger-stream-trimmed-notify-payload-defect.md` |
| 2026-10-20 | `draft` → `spec-ready` | /sdd-review | Product spec approved (6 warnings; overlap WARN: sequencing on 252) |
| 2026-10-21 | `spec-ready` → `design-approved` | /sdd-design | Design debated (3 rounds, full) and approved under operator standing authorization; recon.md + design.md written |
| 2026-10-21 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 11 steps. Product spec amended per design.md § Chosen Approach 7 (FR-2 → LISTEN-connection PK read; Fix Scope → one config key `ledger.stream.resolve_timeout_ms`); AC-9 appended to acceptance.feature (C-15) |

---

## Reviewers

Canonical snapshot from `docs/runbooks/reviewer-registry.md`, written by /sdd-spec on 2026-10-21 (per-step assignments in `implementation-spec.md`).

| Reviewer | Focus | Steps |
|---|---|---|
| `xstockstrat-ledger` owner | Append-only invariant (no deletes or updates), event ordering, hypertable partition safety | 3, 4, 5, 6, 7, 8, 9 |
| `xstockstrat-config` owner | Config key naming (`<service>.<category>.<key>`), environment / global-per-user scoping, WatchConfig stream stability | 2 |
| DBA | Migration NNN numbering (no gaps, no conflicts), up+down pair present, run-order compliance with `scripts/db-migrate.sh` | 2 |
| `xstockstrat-analysis` owner | Backtest reproducibility, strategy scoring determinism, no look-ahead bias | 10 (consumer verification only) |
| `xstockstrat-portfolio` owner | P&L calculation accuracy, position snapshot consistency, concurrent write safety | 10 (consumer verification only) |
| Config team | New config key approval (root `CLAUDE.md` § Approval Flow) | Pre-merge gate for `ledger.stream.resolve_timeout_ms` (integration PR) |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Recon](recon.md) — Phase 0 codebase dossier
- [Design](design.md) — debated, approved approach (3 rounds, full), rejected alternatives, open risks
- [Implementation Spec](implementation-spec.md) — 11 numbered steps with evidence, per-step reviewers, scenario coverage
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Live `StreamEvents` forwards the trigger's trimmed NOTIFY stub (no `payload`, no `occurred_at`) for events whose
`row_to_json` exceeds 7000 chars, so live consumers (analysis, portfolio) process an empty payload and an Invalid
`occurredAt`, then advance their cursor past the event.

## Next Action

`/sdd-review fix-ledger-trimmed-notify-payload impl-spec` — validate implementation spec, then `/sdd-execute fix-ledger-trimmed-notify-payload` (after 252 `fix-identity-ledger-test-suites` merges to `main-dev`; see implementation-spec.md § Step Dependencies)

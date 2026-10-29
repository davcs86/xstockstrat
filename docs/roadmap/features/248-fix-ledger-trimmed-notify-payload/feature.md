# Feature: fix-ledger-trimmed-notify-payload

**Type**: bug
**Development Branch**: `feature/fix-ledger-trimmed-notify-payload`
**GitHub Issue**: none (Issues disabled). Defect report: `docs/reports/2026-10-19-ledger-stream-trimmed-notify-payload-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-20
**Last Updated**: 2026-10-29

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-10-20 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from `docs/reports/2026-10-19-ledger-stream-trimmed-notify-payload-defect.md` |
| 2026-10-20 | `draft` → `spec-ready` | /sdd-review | Product spec approved (6 warnings; overlap WARN: sequencing on 252) |
| 2026-10-21 | `spec-ready` → `design-approved` | /sdd-design | Design debated (3 rounds, full) and approved under operator standing authorization; recon.md + design.md written |
| 2026-10-21 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 11 steps. Product spec amended per design.md § Chosen Approach 7 (FR-2 → LISTEN-connection PK read; Fix Scope → one config key `ledger.stream.resolve_timeout_ms`); AC-9 appended to acceptance.feature (C-15) |
| 2026-10-28 | `implementation-ready` (re-spec) | /sdd-execute sequential | Re-spec §5.3 on merged-up tree `fe047901`: config migration renumbered `032` → `033` (244 holds `032`, 243 `031`, 264 reserves `034`); Step 1 adds a 248-after-244 row; Step 9 CI anchors re-grepped; 252 precondition re-checked and still NOT met (Steps 3-11 blocked) |
| 2026-10-28 | `implementation-ready` → `in-progress` | /sdd-execute sequential (sdd-batch-execute) | Execution started under operator standing authorization (operator chat 2026-10-28, session_01NpS3HShZK6pSnogA7CFo2f); Step 3 onward held on the unmet 252 precondition |
| 2026-10-28 | `in-progress` (Step 1 done) | /sdd-execute sequential (sdd-batch-execute) | Step 1: three Blocking Dependencies rows appended to `merge-order.md` (248 after 252, 243, 244); Steps 3-11 still held on the unmet 252 precondition |
| 2026-10-28 | `in-progress` (Step 2 done) | /sdd-execute sequential (sdd-batch-execute) | Step 2: config `033_ledger_stream_resolve_timeout.{up,down}.sql` seeds `ledger.stream.resolve_timeout_ms` (int, 2000, staging + production); Steps 3-11 still held on the unmet 252 precondition |
| 2026-10-29 | `in-progress` (re-spec) | /sdd-execute sequential (sdd-batch-execute) | Re-spec §5.3 on merged-up tree `b6e518a7` (merge with `origin/main-dev` `8082157a`: already up to date; ledger-guard clean): Steps 3-11 aligned with the current codebase; the 252 precondition is now met (252 `code-completed`, `tsc && node --test dist/` runner, test exclude gone, 0 skip guards), so Steps 3-9 are unblocked; drifted test-file, `index.ts`, `ci.yml` and docs anchors re-grepped |

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

`/sdd-execute fix-ledger-trimmed-notify-payload sequential` — Step 3 next (the 252 precondition is met as of 2026-10-29)

# Feature: snapshot-offline-positions

**Development Branch**: `feature/snapshot-offline-positions`
**Created**: 2026-08-29
**Last Updated**: 2026-08-30
**Committed to main**: 57e40a310ed09b205ce76ca440ee7a40a87fb7ec
**Launched date**: 2026-08-30

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-29 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-08-29 | `draft` → `spec-ready` | /sdd-review | Product spec approved (3 warnings addressed) |
| 2026-08-30 | `spec-ready` → `design-approved` | /sdd-design | Design debated (3 rounds, full) and approved; recon.md + design.md written |
| 2026-08-30 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 14 steps |
| 2026-08-30 | `implementation-ready` → `in-progress` | /sdd-execute | Sequential mode; Steps 1-5 done (proto, proto-gen, pnl FoldFrom, pnl test, trading migration 009) |
| 2026-08-30 | `in-progress` → `code-completed` | /sdd-execute | All 14 steps done (Steps 6-14 across sessions); integration PR next |

| 2026-08-30 | `code-completed` → `launched` | CI workflow | Promoted via PR #1047; committed 57e40a310ed09b205ce76ca440ee7a40a87fb7ec |
---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Recon Dossier](recon.md) — grounded codebase map + Existing Business Rules (C-16)
- [Design](design.md) — debated, approved architecture (3 rounds) + rejected alternatives
- [Implementation Spec](implementation-spec.md) — numbered steps with codebase evidence (14 steps)
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Record an effective-dated position snapshot (statement period-end holdings — signed qty + avg cost
per share per symbol) as an opening baseline for an OFFLINE account, so the position projection folds
from that baseline plus only the confirmed fills dated after the snapshot's `as_of`, dissolving the
double-count between seeded holdings and later-ingested confirmations while keeping the ledger
append-only.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| Proto Reviewer | Field number uniqueness, no breaking changes without deprecation, `buf lint`/`buf breaking` green (new `SnapshotOfflinePositions` RPC + messages, additive `Position` fields) |
| DBA | Migration NNN numbering (no gap/conflict), up+down pair, hypertable vs. plain-table choice for `trading.offline_position_baselines`, index correctness |
| `xstockstrat-trading` (owner) | Order execution correctness, fill detection, position-limit enforcement; correctness of the baseline-seeded fold and the `filled_at > T0` filter across the seam |
| `xstockstrat-portfolio` (owner) | P&L calculation accuracy, position snapshot consistency, concurrent write safety; `as_of`/`source` provenance surfaced on **every** read path (C-10(b)) |
| `xstockstrat-agent` (owner) | MCP tool contract stability (name/params/return shape) and `docs/runbooks/mcp-tools.md` parity for the new `snapshot_positions` operation |
| `xstockstrat-ledger` (owner) | Append-only invariant preserved by the new audit `event_type` string; stream-key convention (`account:{account_id}`) |

## Next Action

`/sdd-review snapshot-offline-positions impl-spec` — validate implementation spec, then `/sdd-execute snapshot-offline-positions`

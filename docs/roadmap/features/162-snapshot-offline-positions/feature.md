# Feature: snapshot-offline-positions

**Development Branch**: `feature/snapshot-offline-positions`
**Created**: 2026-08-29
**Last Updated**: 2026-08-29

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-29 | `idea` → `draft` | /sdd-story | Product spec generated |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec snapshot-offline-positions`_
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

`/sdd-review snapshot-offline-positions product-spec` — AI review of product spec before running /sdd-spec

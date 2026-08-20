# Feature: consolidate-watchlist-signal

**Development Branch**: `feature/consolidate-watchlist-signal`
**Created**: 2026-08-11
**Last Updated**: 2026-08-11

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-11 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-08-19 | `draft` → `spec-ready` | /sdd-review | Product spec approved (PASS WITH WARNINGS: 4 design-owned open questions + agent `PORTFOLIO_ENDPOINT` deploy-parity, both to close at /sdd-design and /sdd-spec) |
| 2026-08-19 | `spec-ready` (unchanged) | /sdd-review | Re-reviewed after a design-driven scope expansion (agent-only → agent + portfolio proto/migration/delete-guard + UI). PASS WITH WARNINGS, no blockers/Floor breach; 1 warning (enum value prefix → `WATCHLIST_ENTRY_SOURCE_*`, fixed). Overlap: portfolio migration `010` collides with 042 → 127 renumbers to `011` (merge-order.md row added). |
| 2026-08-19 | `spec-ready` → `design-approved` | /sdd-design | Design debated (2 rounds, full) and approved; recon.md + design.md written. Identity fork resolved to a per-user **system-managed watchlist** (new `Watchlist.system_managed` flag + `EnsureSignalWatchlist` RPC + `FAILED_PRECONDITION` delete-guard); user expanded scope to include the UI distinction (per-entry `source` enum + undeletable affordance). Product spec updated + re-reviewed for the expanded proto/DB/UI gates. |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Recon](recon.md) — grounded codebase dossier (agent + portfolio)
- [Design](design.md) — debated, approved architecture (system-managed watchlist flag + delete-guard + UI distinction)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec consolidate-watchlist-signal`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Signals ingested via the MCP `ingest_signal` tool with `direction="watchlist"` are currently stored
in `xstockstrat-ingest`'s `newsletter_signals` table as an inert label — `xstockstrat-analysis`
treats them as non-actionable and nothing connects them to the platform's real, user-owned
`xstockstrat-portfolio` `Watchlist` mechanism. This feature auto-adds the signal's symbol to a
portfolio watchlist when `ingest_signal` is called with `direction="watchlist"`, so the two
same-named concepts are actually linked instead of colliding only in vocabulary.

## Reviewers

| Role | Review Focus |
|---|---|
| `xstockstrat-agent` | MCP tool contract stability (name, parameters, return shape) and `docs/runbooks/mcp-tools.md` parity; no secret values in tool output |
| `xstockstrat-portfolio` | P&L calculation accuracy, position snapshot consistency, concurrent write safety |

## Next Action

`/sdd-spec consolidate-watchlist-signal` — generate the implementation spec from the approved design (re-derive the portfolio migration NNN vs feature 042 across all remote branches → likely `011`; carry the 5 Open Risks from design.md)

# Feature: consolidate-watchlist-signal

**Development Branch**: `feature/consolidate-watchlist-signal`
**Created**: 2026-08-11
**Last Updated**: 2026-08-11
**Committed to main**: d908f33dc3283b79b61b233d57542cd47014c4ab
**Launched date**: 2026-08-21
**Archived**: 2026-08-26

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-11 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-08-19 | `draft` → `spec-ready` | /sdd-review | Product spec approved (PASS WITH WARNINGS: 4 design-owned open questions + agent `PORTFOLIO_ENDPOINT` deploy-parity, both to close at /sdd-design and /sdd-spec) |
| 2026-08-19 | `spec-ready` (unchanged) | /sdd-review | Re-reviewed after a design-driven scope expansion (agent-only → agent + portfolio proto/migration/delete-guard + UI). PASS WITH WARNINGS, no blockers/Floor breach; 1 warning (enum value prefix → `WATCHLIST_ENTRY_SOURCE_*`, fixed). Overlap: portfolio migration `010` collides with 042 → 127 renumbers to `011` (merge-order.md row added). |
| 2026-08-19 | `spec-ready` → `design-approved` | /sdd-design | Design debated (2 rounds, full) and approved; recon.md + design.md written. Identity fork resolved to a per-user **system-managed watchlist** (new `Watchlist.system_managed` flag + `EnsureSignalWatchlist` RPC + `FAILED_PRECONDITION` delete-guard); user expanded scope to include the UI distinction (per-entry `source` enum + undeletable affordance). Product spec updated + re-reviewed for the expanded proto/DB/UI gates. |
| 2026-08-20 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 10 steps (proto → proto-gen → migration 011 → portfolio service+test → agent service+docs+test → UI service+e2e). Migration confirmed `011` (042 keeps `010`, merge-order.md row 182); proto field numbers confirmed uncontested (`WatchlistBinding.source=3`, `Watchlist.system_managed=9`); `PORTFOLIO_ENDPOINT` confirmed absent from the agent block in all three deploy files. |
| 2026-08-20 | `implementation-ready` → `in-progress` | /sdd-execute | Steps 1–5, 7 done (proto + codegen + migration 011 + portfolio repo/service/handler + tests + mcp-tools.md). Executed on harness branch `claude/execute-020-042-127-pfa5cw` (single integration PR model). Deviation: `normalizeBindings` now preserves `source`. |
| 2026-08-20 | `in-progress` → `code-completed` | /sdd-execute | All 10 steps done — agent auto-add (steps 6,8; 227 agent tests pass) + UI undeletable affordance & signal badge (steps 9,10; watchlists e2e 11 pass). Portfolio build/lint/test green; proto stubs regenerate byte-clean. |

| 2026-08-21 | `code-completed` → `launched` | CI workflow | Promoted via PR #997; committed d908f33dc3283b79b61b233d57542cd47014c4ab |
| 2026-08-26 | `launched` | /sdd-archiver | Archived: synthesis → context.md + Ledger insights(1)/fails(2); promoted 8 scenarios → platform+agent+portfolio+ui suites; pruned 4 specs |
---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Recon](recon.md) — grounded codebase dossier (agent + portfolio)
- [Design](design.md) — debated, approved architecture (system-managed watchlist flag + delete-guard + UI distinction)
- [Implementation Spec](implementation-spec.md)
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

| Role | Review Focus | Steps |
|---|---|---|
| Proto Reviewer | Field-number uniqueness per message, no breaking change without deprecation, `buf lint`/`buf breaking` pass | 1, 2 |
| `xstockstrat-portfolio` | P&L/snapshot consistency, concurrent write safety, watchlist ownership | 1, 3, 4, 5 |
| DBA | Migration NNN numbering (no gap/conflict), up+down pair present, index correctness | 3 |
| `xstockstrat-agent` | MCP tool contract stability (name, parameters, return shape) and `docs/runbooks/mcp-tools.md` parity; no secret values in tool output | 6, 8 |
| Platform Lead | New agent→portfolio inter-service edge, dependency-graph correctness | 6 |
| `xstockstrat-ui` | Analytics display accuracy, Connect-RPC call safety, no unsafe mutation affordance, e2e fixture discipline (C-12) | 9, 10 |

_(Step 7 [docs] carries no reviewer per the governance matrix.)_

## Next Action

`/sdd-review consolidate-watchlist-signal impl-spec` — validate the implementation spec, then `/sdd-execute consolidate-watchlist-signal`

# Feature: signal-watchlist-expiry-pruning

**Development Branch**: `feature/signal-watchlist-expiry-pruning`
**Created**: 2026-10-31
**Last Updated**: 2026-10-31

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-10-31 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-10-31 | `draft` → `design-approved` | /sdd-design | Design debated (4 rounds, quick mode user-extended) and approved; recon.md + design.md written. Skipped /sdd-review (operator-confirmed proceed-from-draft); product-spec.md + acceptance.feature rewritten post-design (FR-2/FR-3 narrowed by user sign-off; AC-1..AC-18). Renumbered 280 → 281 (collision with `280-smoke-check-runtime`). |
| 2026-10-31 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 21 steps |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Recon](recon.md) — grounded codebase dossier; **Premise Verdict** (FR-1)
- [Design](design.md) — debated, user-approved architecture, rejected alternatives, open risks
- [Implementation Spec](implementation-spec.md) — 21 numbered steps with codebase evidence and AC coverage map
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Signals carry a `valid_until` expiry, but the entries that feature 127 auto-added to the per-user system-managed signal watchlist (`source = SIGNAL`) are never removed once the backing signal expires (**confirmed by recon**; an entry also has no link to its signals). The agent now stamps signal provenance on the add into a portfolio side table, and an in-process portfolio prune loop removes entries whose agent-recorded watchlist signals have all expired; a one-shot DBA-reviewed operator backfill seeds/marks the existing backlog. Analysis opportunities and ingest rows are out of scope (premise refuted / by design).

## Reviewers

_(Snapshot finalized at /sdd-spec time — re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| Proto Reviewer | Field number uniqueness, additive-only `AddWatchlistSymbolsRequest.signal_provenance = 4`, `buf lint`/`buf breaking` (Steps 1-2) |
| DBA | Migration `018` numbering, up+down pair, index correctness; reviews backfill REPORT before any APPLY (Steps 3, 15, 16) |
| Service owner `xstockstrat-portfolio` | P&L calculation accuracy, position snapshot consistency, concurrent write safety (Steps 4-12, 15-16) |
| Service owner `xstockstrat-agent` | MCP tool contract stability, `docs/runbooks/mcp-tools.md` parity, tool count unchanged at 45, statelessness (Steps 1-2, 17-18) |
| Service owner `xstockstrat-config` | Config key naming, scoping, WatchConfig stream stability (Steps 13-14) |
| Service owner `xstockstrat-ui` | System-managed watchlist display correctness, no direct DB access (Step 19) |

## Next Action

`/sdd-review signal-watchlist-expiry-pruning impl-spec` — validate implementation spec, then `/sdd-execute signal-watchlist-expiry-pruning`

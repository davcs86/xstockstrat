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

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Recon](recon.md) — grounded codebase dossier; **Premise Verdict** (FR-1)
- [Design](design.md) — debated, user-approved architecture, rejected alternatives, open risks
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec signal-watchlist-expiry-pruning`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Signals carry a `valid_until` expiry, but the entries that feature 127 auto-added to the per-user system-managed signal watchlist (`source = SIGNAL`) are never removed once the backing signal expires (**confirmed by recon**; an entry also has no link to its signals). The agent now stamps signal provenance on the add into a portfolio side table, and an in-process portfolio prune loop removes entries whose agent-recorded watchlist signals have all expired; a one-shot DBA-reviewed operator backfill seeds/marks the existing backlog. Analysis opportunities and ingest rows are out of scope (premise refuted / by design).

## Reviewers

_(Snapshot finalized at /sdd-spec time — re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| Service owner `xstockstrat-ingest` | Signal normalization correctness, idempotent ingestion, `valid_until` semantics |
| Service owner `xstockstrat-portfolio` | Concurrent write safety on watchlist entries, position/snapshot consistency |
| Service owner `xstockstrat-agent` | MCP tool contract stability, `docs/runbooks/mcp-tools.md` parity (only if the writer path stays in the agent) |
| Service owner `xstockstrat-ui` | Signal-badge / system-managed watchlist display correctness (only if a UI change is in scope) |
| Proto Reviewer / DBA | Only if recon/design adds a proto field/RPC or a migration |

## Next Action

`/sdd-spec signal-watchlist-expiry-pruning` — generate implementation spec from the approved design

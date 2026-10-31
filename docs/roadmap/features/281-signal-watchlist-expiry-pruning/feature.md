# Feature: signal-watchlist-expiry-pruning

**Development Branch**: `feature/signal-watchlist-expiry-pruning`
**Created**: 2026-10-31
**Last Updated**: 2026-10-31

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-10-31 | `idea` → `draft` | /sdd-story | Product spec generated |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec signal-watchlist-expiry-pruning`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Signals carry a `valid_until` expiry, but the entries that feature 127 auto-added to the per-user system-managed signal watchlist (`source = SIGNAL`) are reportedly never removed once the backing signal expires. This feature prunes expired signal-sourced entries from the signal watchlist automatically. The "never removed" premise is a **claim to be confirmed at /sdd-design Phase 0 (Recon)** before any design is proposed.

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

`/sdd-review signal-watchlist-expiry-pruning product-spec` — AI review of product spec before `/sdd-design`

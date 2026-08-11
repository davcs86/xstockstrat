# Feature: consolidate-watchlist-signal

**Lifecycle Status**: `draft`
**Development Branch**: `feature/consolidate-watchlist-signal`
**Created**: 2026-08-11
**Last Updated**: 2026-08-11

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-11 | `idea` → `draft` | /sdd-story | Product spec generated |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
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

`/sdd-review consolidate-watchlist-signal product-spec` — AI review of product spec before running /sdd-spec

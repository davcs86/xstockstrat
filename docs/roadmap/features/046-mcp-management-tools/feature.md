# Feature: mcp-management-tools

**Lifecycle Status**: `draft`
**Development Branch**: `feature/mcp-management-tools`
**Created**: 2026-06-01
**Last Updated**: 2026-06-01

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-06-01 | `idea` → `draft` | /sdd-story | Product spec generated |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec mcp-management-tools`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Add admin-scoped write/management tools to the `xstockstrat-agent` MCP server so an operator (via Claude) can register/manage signal sources, strategies, and indicator formulas — not just read and ingest. Source and formula management wrap existing backend RPCs; strategy management requires a new persistence decision in `xstockstrat-analysis`.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-agent` (service owner) | MCP tool correctness, admin-scope enforcement on mutating tools, `x-mcp-secret` propagation _(note: agent is not yet listed in the reviewer-registry Service Owners table — registry gap to close)_ |
| `xstockstrat-ingest` (service owner) | Signal normalization correctness, newsletter source schema stability (ManageSignalSource validation) |
| `xstockstrat-analysis` (service owner) | Backtest reproducibility, strategy scoring determinism, no look-ahead bias (strategy persistence design) |
| `xstockstrat-indicators` (service owner) | Formula sandboxing, numeric precision, timeout enforcement, no side-effects from formula execution |
| Proto Reviewer | Field number uniqueness, backward compatibility — only if new strategy-management / formula-listing RPCs are added |
| Security | Admin API key scoping, `secret.*` handling for `credentials_ref`, no plaintext secrets exposed to Claude |

## Next Action

`/sdd-review mcp-management-tools product-spec` — AI review of product spec before running /sdd-spec

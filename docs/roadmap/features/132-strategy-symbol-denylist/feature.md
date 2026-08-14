# Feature: strategy-symbol-denylist

**Lifecycle Status**: `design-approved`
**Development Branch**: `feature/strategy-symbol-denylist`
**Created**: 2026-08-14
**Last Updated**: 2026-08-14

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-14 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-08-14 | `draft` → `spec-ready` | /sdd-review | Criteria: PASS WITH WARNINGS (1 warning fixed — a wrong `live_loop.py` line citation, corrected to `:188-196`; FR-3/FR-5/AC-5's deferred-mechanism warnings accepted as legitimate, matching 131's own precedent). Overlap: file-level overlap with 131 (`_compute_opportunities`, `strategy_symbols()`) confirmed expected/already-committed-to (FR-6); no resource-number collisions (proto field 12 vs 133's field 13 confirmed disjoint against trunk). |
| 2026-08-14 | `spec-ready` → `design-approved` | /sdd-design | Design debated (5 rounds, full) and approved APPROVE-READY; recon.md + design.md written. Two user-locked forks: **layer 132 on 131** (merge order 133→134→131→132) and a **dedicated `Opportunity.muted` flag** for FR-5. User steers: **entry-only deny** (held positions keep exit tracing) amending FR-1/AC-2; a **new `signal_eligible` flag** (FR-8) gating the platform-wide active-signal term; and **fair-share live-loop scheduling** (FR-9) built now. Shared `resolve_universe` helper (C-10b parity), muted-via-provenance persistence (no migration), portfolio-readiness-gated entry_backfill. One accepted residual (cold-boot backfill no-retry, no worse than shipped 116). Amended 131's design.md (FR-6) + merge-order.md. |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Recon](recon.md) — grounded codebase dossier (Phase 0)
- [Design](design.md) — debated, user-approved architecture (Phase 1, 5 rounds)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec strategy-symbol-denylist`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Replaces the opt-in `signal_params.symbols` allowlist per strategy with a deny list: a live-enabled
strategy's evaluation universe becomes `union(watchlist-bound symbols, held-position symbols,
active-signal symbols)` minus its own deny list, edited from both the Symbol detail page and the
Strategy edit page, with denied `(symbol, strategy)` pairs surfaced as explicit skipped/muted rows
in the Opportunities queue rather than silently disappearing. Directly amends
`131-live-strategy-opportunity-attribution` (design-approved, not yet implemented), which currently
assumes the opt-in list.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| Proto Reviewer | Field number uniqueness, no breaking changes without deprecation, `buf lint`/`buf breaking` |
| `xstockstrat-analysis` owner | Backtest reproducibility, strategy scoring determinism, no look-ahead bias — plus live-loop evaluation-universe correctness (this feature's core change) |
| `xstockstrat-portfolio` owner | P&L calculation accuracy, position snapshot consistency, concurrent write safety — relevant if a cross-user positions/watchlist aggregation RPC is added (see Open Questions) |
| `xstockstrat-ui` owner | Trading UI correctness, Connect-RPC call safety — Symbol page + Strategy edit page deny-list controls, Opportunities muted-row display |
| `xstockstrat-agent` owner | MCP tool contract stability — `manage_strategy` tool surface, `strat-lab` plugin skill parity (root CLAUDE.md requires same-PR skill updates for `manage_strategy` changes) |
| Platform Lead | Cross-service architecture — the live-loop's evaluation-universe scoping is a genuine platform-wide compute-cost and multi-tenancy question (see Open Questions) |

## Next Action

`/sdd-spec strategy-symbol-denylist` — generate the implementation spec from the approved design.
The central open question (cross-user aggregation) is resolved: strategies are owner-scoped via
`133-strategy-user-ownership` and the live loop uses 133's `ListPositions(user_id=owner)` +
synthetic-header `ListWatchlists` mechanism. Merge/build order is `133 → 134 → 131 → 132`
(`merge-order.md`); 132 layers on 131 and its spec should cite 131's landed
`_compute_opportunities`/`live_by_symbol`/`resolve_universe` shape.

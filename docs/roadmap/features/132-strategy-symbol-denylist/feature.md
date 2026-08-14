# Feature: strategy-symbol-denylist

**Lifecycle Status**: `spec-ready`
**Development Branch**: `feature/strategy-symbol-denylist`
**Created**: 2026-08-14
**Last Updated**: 2026-08-14

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-14 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-08-14 | `draft` → `spec-ready` | /sdd-review | Criteria: PASS WITH WARNINGS (1 warning fixed — a wrong `live_loop.py` line citation, corrected to `:188-196`; FR-3/FR-5/AC-5's deferred-mechanism warnings accepted as legitimate, matching 131's own precedent). Overlap: file-level overlap with 131 (`_compute_opportunities`, `strategy_symbols()`) confirmed expected/already-committed-to (FR-6); no resource-number collisions (proto field 12 vs 133's field 13 confirmed disjoint against trunk). |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
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

`/sdd-design strategy-symbol-denylist` — recon + design debate. **Phase 0 Recon must resolve this
story's central open question (cross-user aggregation for the live loop's evaluation universe)
before Phase 1 debate can proceed** — see product-spec.md § Open Questions. This is expected to
depend on `133-strategy-user-ownership` reaching at least `design-approved` first (its own identity
contract determines how 132's FR-3 gets built) — confirm exact sequencing at `/sdd-design` time and
update `docs/roadmap/features/merge-order.md` accordingly.

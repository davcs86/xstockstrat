# Feature: unified-symbol-page

**Lifecycle Status**: `spec-ready`
**Development Branch**: `feature/unified-symbol-page`
**Created**: 2026-08-10
**Last Updated**: 2026-08-10

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-10 | `idea` → `draft` | /sdd-story | Product spec generated. Reshapes what was originally scoped as 096 (single Position page + single Order ticket page, now already shipped — see 096's corrected status) into one unified per-symbol page that also pulls in trade entry, opportunity/conviction, indicators, fundamentals, screening, backtesting, and backfill info. |
| 2026-08-10 | `draft` → `spec-ready` | /sdd-review | Product spec approved — PASS WITH WARNINGS (no blocker, no Floor breach). Warnings addressed inline: FR-3 now states fill-status handling is unmodified (C-5); Open Questions gained a lead-in directing `/sdd-design` to close all six items explicitly and to re-check `main-dev`'s current `PlatformHeader.tsx`/`OrderForm.tsx` before citing lines (overlap scan found both mid-edit on in-flight, unmerged shadcn-migration PRs #912/#913 — no blocking collision, just staleness risk). No proto/config-key/migration overlap with any other feature. |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec unified-symbol-page`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Consolidate everything the platform already knows about a single stock symbol — position, orders,
a trade-entry widget, opportunity/conviction and indicator/strategy signals and fundamentals (for
watchlisted symbols), screening tools (for non-watchlisted symbols), backtest history, and backfill
coverage — into one page, superseding the narrower `/trader/positions/[symbol]` and
`/trader/orders/[id]` pages shipped by feature 096.

## Reviewers

_Snapshot finalized by /sdd-spec (not yet run) from `docs/runbooks/reviewer-registry.md`. Draft
expectation based on the product spec's Affected Services — confirm/replace at /sdd-spec time:_

| Role | Review Focus |
|---|---|
| `xstockstrat-ui` (service owner) | Nocturne-style fidelity, Connect-RPC call safety, environment scope correctness, no secret values rendered, order-mutation (trade widget) safety, C-10(a) nav reachability, C-10(b) valuation parity across Positions/Exposure/Portfolio/this page |
| `xstockstrat-analysis` (FYI — backtest read/trigger) | Backtest reproducibility, strategy scoring determinism, no look-ahead bias — only if this feature adds a UI-triggered `RunBacktest` path |
| `xstockstrat-indicators` (FYI — indicator/conviction read) | Formula sandboxing / numeric precision not implicated for a read-only display, but confirm no new compute path is introduced |
| `xstockstrat-ingest` (FYI — backfill status read) | Idempotent ingestion not implicated for a read-only display |
| Proto Reviewer (FYI) | Only if design determines a new RPC/field is required — TBD, see product-spec Open Questions |

## Next Action

`/sdd-design unified-symbol-page` — recon + adversarial design debate. Six Open Questions in
product-spec.md (fate of the three source pages, backtest-to-symbol mapping, fundamentals/screening
BFF wiring, watchlist-membership lookup shape, "other missing data" inventory, plus re-checking
`main-dev`'s current `PlatformHeader.tsx`/`OrderForm.tsx` against in-flight PRs #912/#913) must all
be resolved before design.md is written.

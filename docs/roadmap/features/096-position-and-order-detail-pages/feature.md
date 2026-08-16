# Feature: position-and-order-detail-pages

**Committed to main**: c1d1882
**Launched date**: 2026-08-06
**Development Branch**: `feature/position-and-order-detail-pages`
**Created**: 2026-08-02
**Last Updated**: 2026-08-10
**Archived**: 2026-08-16

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-02 | `idea` → `draft` | /sdd-story | Product spec generated from the Nocturne design handoff (single Position detail page + single Order ticket page) — the two dedicated *pages* feature 083 left as a row-click Sheet (#853) and a read-only order card. |
| 2026-08-02 | `draft` → `spec-ready` | /sdd-review | Product spec self-reviewed: PASS. Frontend-only, additive, no proto/migration/config change. Overlap with 095 (`opportunity-live-market-enrichment`) reviewed **CLEAN** — 095 owns the Decide-surface live-data extras; 096 owns the Book-surface pages and reuses only fields that already exist. |
| 2026-08-02 | `spec-ready` → `design-approved` | /sdd-design | Design debated (quick) and approved; recon.md + design.md written. Chosen: a dedicated `/trader/positions/[symbol]` page reusing the enriched `Position` fields + `ListOrders(symbol)` + `getBars`; the existing `/trader/orders/[id]` read-only card upgraded in place to the ticket grammar with functional Replace/Cancel. No faked data (thesis/target/realized-P&L omitted — deferred to 095 where a data source exists). |
| 2026-08-02 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 6 steps (frontend-only; no proto/migration). Grep-resolved: `GetPosition` RPC exists on `PortfolioService` but is **not** wired through the trader BFF — 096 adds the BFF method + browser hook (additive) rather than reusing `listPositions` client-side, so the page reads exactly one authoritative position. |
| 2026-08-10 | `implementation-ready` → `code-completed` | /sdd-story (retroactive correction) | **Doc-drift fix, not new work.** All 6 steps were actually implemented and merged directly to `main-dev` via PR #855 (`feat(096): dedicated single-Position page + single-Order ticket page`, commit `7f6f65e`) on 2026-08-02 — the same session that wrote this implementation spec (see context.md "Delivery: implemented directly in this session"). `feature.md`/`implementation-spec.md` were never updated to reflect that, so the feature sat at `implementation-ready` for over a week after shipping. Caught while starting a follow-up feature that builds on these pages. |
| 2026-08-06 | `code-completed` → `launched` | CI workflow (retroactive) | Promoted via PR #875 (`release: promote main-dev to main (2026-08-06)`); committed `c1d1882`. CI's `ci-validate-feature-status.yml` only auto-flips features that are already `code-completed` at promotion time — since this feature was still (incorrectly) `implementation-ready`, the automation silently skipped it. Backfilled here using the same fields/format CI would have written. |
| 2026-08-16 | launched (unchanged) | /sdd-archiver | Archived: synthesis written to context.md + Ledger, specs pruned. |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Recon](recon.md) — grounded codebase dossier
- [Design](design.md) — debated, approved architecture
- [Implementation Spec](implementation-spec.md) — 6 numbered steps
- [Context Log](context.md) — session history, decisions, deviations
- [Design Handoff](../083-ui-revamp-opportunities-first/design-handoff/) — Nocturne reference (`xstockstrat UI.dc.html` POSITION DETAIL + ORDER EDITOR screens)

---

## Summary

Add the two dedicated high-fidelity detail *pages* the Nocturne handoff specifies that feature 083
left unbuilt: a full-page **single Position** view at `/trader/positions/[symbol]` (risk-framed
header, stat grid, entry-to-stop candlestick with avg-cost/stop overlays, a per-symbol Orders &
fills table, and a risk/manage/broker sidebar) and a full-fidelity **single Order** ticket page at
`/trader/orders/[id]` (ticket-grammar field grid, order-preview sidebar, and functional
Replace/Cancel for working orders). Every value is sourced from data the platform already returns —
no fabricated thesis, target, R:R, or realized-P&L (those Decide-surface live-data extras are
feature 095's scope).

## Reviewers

_Snapshot finalized by /sdd-spec (2026-08-02) from `docs/runbooks/reviewer-registry.md`._

| Role | Review Focus |
|---|---|
| `xstockstrat-ui` (service owner) | Nocturne fidelity, Connect-RPC call safety, environment scope correctness, no secret values rendered, order-mutation (Replace/Cancel) safety, C-10(a) nav reachability, C-10(b) valuation parity |
| Proto Reviewer (FYI) | No `.proto` change — `GetPosition` already exists; BFF exposes an existing RPC additively |

## Next Action

None — feature is `launched`. `/trader/positions/[symbol]` and `/trader/orders/[id]` are live in
production. A follow-up feature consolidates these two pages (plus additional per-symbol context)
into a single unified page — see `docs/roadmap/features/` for its number.

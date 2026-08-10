# Feature: unified-symbol-page

**Lifecycle Status**: `design-approved`
**Development Branch**: `feature/unified-symbol-page`
**Created**: 2026-08-10
**Last Updated**: 2026-08-10

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-10 | `idea` → `draft` | /sdd-story | Product spec generated. Reshapes what was originally scoped as 096 (single Position page + single Order ticket page, now already shipped — see 096's corrected status) into one unified per-symbol page that also pulls in trade entry, opportunity/conviction, indicators, fundamentals, screening, backtesting, and backfill info. |
| 2026-08-10 | `draft` → `spec-ready` | /sdd-review | Product spec approved — PASS WITH WARNINGS (no blocker, no Floor breach). Warnings addressed inline: FR-3 now states fill-status handling is unmodified (C-5); Open Questions gained a lead-in directing `/sdd-design` to close all six items explicitly and to re-check `main-dev`'s current `PlatformHeader.tsx`/`OrderForm.tsx` before citing lines (overlap scan found both mid-edit on in-flight, unmerged shadcn-migration PRs #912/#913 — no blocking collision, just staleness risk). No proto/config-key/migration overlap with any other feature. |
| 2026-08-10 | `spec-ready` → `design-approved` | /sdd-design | Design debated (5 rounds, full — hard cap reached) and approved; recon.md + design.md written. Chosen: `/trader/positions/[symbol]` reused in place as the sole unified route; `/insights/market/[symbol]` becomes a redirect; `/trader/orders/[id]` stays standalone. Sections gate independently of position existence (fixed an inherited all-or-nothing gate that would have made the feature's own headline content unreachable for unheld symbols). Additive `ScreenResult` proto fields for single-symbol screening (avoids a confirmed universe-normalization collapse). Cross-segment BFF client reuse formally adopted as a sanctioned exception (user decision) with `services/xstockstrat-ui/CLAUDE.md` to be amended in the same PR. Pre-existing `GetPosition` account_id bug fixed in-scope. Two false citations caught and corrected mid-debate (round 1's screener field claim, round 3's BFF dual-registration claim). No Floor breach in any round; product-spec.md corrected in lockstep (FR-7/FR-9/FR-10/Proto Contract Changes, all Open Questions closed). |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Recon](recon.md) — grounded codebase dossier
- [Design](design.md) — debated (5 rounds), approved architecture
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

_Snapshot finalized by /sdd-spec (not yet run) from `docs/runbooks/reviewer-registry.md`. Updated
post-design.md — the proto change and `GetPosition` fix are now confirmed, not TBD; re-confirm at
/sdd-spec time:_

| Role | Review Focus |
|---|---|
| `xstockstrat-ui` (service owner) | Nocturne-style fidelity, Connect-RPC call safety, environment scope correctness, no secret values rendered, order-mutation (trade widget) safety, C-10(a) nav reachability (both `PlatformHeader.tsx`/`BottomTabBar.tsx`), C-10(b) three-way valuation parity, the new cross-segment-client sanctioned exception in `CLAUDE.md` |
| `xstockstrat-analysis` | Additive `ScreenResult` proto fields + `screener.py` wiring correctness — confirmed real work, not FYI |
| `xstockstrat-portfolio` | `GetPosition` `account_id` fix (pre-existing bug, in-scope side-fix) + its paired Go regression test |
| `xstockstrat-marketdata` (FYI) | `GetFundamentals` BFF registration only — no service-side change |
| Proto Reviewer | `ScreenResult.criterion_raw_values`/`criterion_passed` — additive, non-breaking; confirmed real, not TBD |

## Next Action

`/sdd-spec unified-symbol-page` — generate the implementation spec from the approved design.
Note for that pass: the analysis-service `ScreenResult` proto step (design.md) is a hard predecessor
to the UI screening step; the `GetPosition` account_id fix is the first backend step; and
`services/xstockstrat-ui/CLAUDE.md` needs its cross-segment-client-reuse exception documented in the
same PR as the first step that relies on it.

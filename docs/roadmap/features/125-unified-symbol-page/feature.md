# Feature: unified-symbol-page

**Lifecycle Status**: `implementation-ready`
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
| 2026-08-10 | `design-approved` (unchanged — design.md amended, not re-gated) | /sdd-design | User explicitly overrode the design skill's 5-round hard cap for 2 more rounds (a skill-authored process limit, not a Constitution Floor item — the override asked for more scrutiny, not less). Round 6 immediately justified it: found `EvaluateReadiness`/`SignalReadiness` has a real, live `NOT_FOUND` path (stale `?strategy=` param) the round-5-approved design's own "page-wide sweep" had falsely claimed didn't exist — a third false claim caught mid-debate. Round 7 (final, user's stated ceiling) fixed it plus a `usePosition` `refetchInterval` gap, added the verbatim `CLAUDE.md` sanctioned-exception text, and cross-referenced it from `nextjs-frontends.md`. Two remaining test-coverage gaps (relocate `signal-detail.spec.ts` rather than re-run it; a paired NotFound test for `SignalReadiness`) recorded as named Open Risks in design.md rather than requiring a round 8. No Floor breach in any of the 7 rounds. |
| 2026-08-10 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 26 steps. All `PlatformHeader.tsx`/`OrderForm.tsx`/`traderBff.ts`/`insightsBff.ts` line citations re-verified fresh against the live tree (no drift found from recon/design). One new correction found during spec-writing: `GetFundamentals`'s "no data for this symbol" case surfaces as `CodeUnavailable`/`CodeFailedPrecondition`/`CodeResourceExhausted` depending on cause, never `CodeNotFound` — the Fundamentals section step is written to handle any error generically, not via the `isNotFoundError` pattern every other section uses. |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Recon](recon.md) — grounded codebase dossier
- [Design](design.md) — debated (7 rounds — 5 to the design skill's normal cap, 2 more under an
  explicit user override), approved architecture
- [Implementation Spec](implementation-spec.md) — 26 steps
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Consolidate everything the platform already knows about a single stock symbol — position, orders,
a trade-entry widget, opportunity/conviction and indicator/strategy signals and fundamentals (for
watchlisted symbols), screening tools (for non-watchlisted symbols), backtest history, and backfill
coverage — into one page, superseding the narrower `/trader/positions/[symbol]` and
`/trader/orders/[id]` pages shipped by feature 096.

## Reviewers

_Snapshot finalized by /sdd-spec (2026-08-10) from `docs/runbooks/reviewer-registry.md`, deduplicated
across all 26 implementation-spec.md steps:_

| Role | Review Focus |
|---|---|
| `xstockstrat-ui` (service owner) | Trading UI correctness, analytics display accuracy, Connect-RPC call safety, environment scope correctness, no secret values rendered, no direct DB access, order-mutation (trade widget) safety, C-10(a) nav reachability (both `PlatformHeader.tsx`/`BottomTabBar.tsx`), C-10(b) three-way valuation parity, the new cross-segment-client sanctioned exception in `CLAUDE.md` |
| `xstockstrat-analysis` | Additive `ScreenResult` proto fields + `screener.py` wiring correctness (Steps 1, 3-4); FYI on the single-symbol Screening section's field usage (Step 16) |
| `xstockstrat-portfolio` | `GetPosition` `account_id` fix (pre-existing bug, in-scope side-fix) + its paired Go regression test (Steps 5-6) |
| `xstockstrat-marketdata` (FYI) | `GetFundamentals` BFF registration only — no service-side change (Steps 14-15) |
| Proto Reviewer | `ScreenResult.criterion_raw_values`/`criterion_passed` — additive, non-breaking (Steps 1-2) |

## Next Action

`/sdd-review unified-symbol-page impl-spec` — validate implementation spec, then
`/sdd-execute unified-symbol-page`.

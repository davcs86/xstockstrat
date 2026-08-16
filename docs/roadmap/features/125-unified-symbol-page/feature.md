# Feature: unified-symbol-page

**Development Branch**: `feature/unified-symbol-page`
**Created**: 2026-08-10
**Last Updated**: 2026-08-15 (sequential execution started)

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-10 | `idea` → `draft` | /sdd-story | Product spec generated. Reshapes what was originally scoped as 096 (single Position page + single Order ticket page, now already shipped — see 096's corrected status) into one unified per-symbol page that also pulls in trade entry, opportunity/conviction, indicators, fundamentals, screening, backtesting, and backfill info. |
| 2026-08-10 | `draft` → `spec-ready` | /sdd-review | Product spec approved — PASS WITH WARNINGS (no blocker, no Floor breach). Warnings addressed inline: FR-3 now states fill-status handling is unmodified (C-5); Open Questions gained a lead-in directing `/sdd-design` to close all six items explicitly and to re-check `main-dev`'s current `PlatformHeader.tsx`/`OrderForm.tsx` before citing lines (overlap scan found both mid-edit on in-flight, unmerged shadcn-migration PRs #912/#913 — no blocking collision, just staleness risk). No proto/config-key/migration overlap with any other feature. |
| 2026-08-10 | `spec-ready` → `design-approved` | /sdd-design | Design debated (5 rounds, full — hard cap reached) and approved; recon.md + design.md written. Chosen: `/trader/positions/[symbol]` reused in place as the sole unified route; `/insights/market/[symbol]` becomes a redirect; `/trader/orders/[id]` stays standalone. Sections gate independently of position existence (fixed an inherited all-or-nothing gate that would have made the feature's own headline content unreachable for unheld symbols). Additive `ScreenResult` proto fields for single-symbol screening (avoids a confirmed universe-normalization collapse). Cross-segment BFF client reuse formally adopted as a sanctioned exception (user decision) with `services/xstockstrat-ui/CLAUDE.md` to be amended in the same PR. Pre-existing `GetPosition` account_id bug fixed in-scope. Two false citations caught and corrected mid-debate (round 1's screener field claim, round 3's BFF dual-registration claim). No Floor breach in any round; product-spec.md corrected in lockstep (FR-7/FR-9/FR-10/Proto Contract Changes, all Open Questions closed). |
| 2026-08-10 | `design-approved` (unchanged — design.md amended, not re-gated) | /sdd-design | User explicitly overrode the design skill's 5-round hard cap for 2 more rounds (a skill-authored process limit, not a Constitution Floor item — the override asked for more scrutiny, not less). Round 6 immediately justified it: found `EvaluateReadiness`/`SignalReadiness` has a real, live `NOT_FOUND` path (stale `?strategy=` param) the round-5-approved design's own "page-wide sweep" had falsely claimed didn't exist — a third false claim caught mid-debate. Round 7 (final, user's stated ceiling) fixed it plus a `usePosition` `refetchInterval` gap, added the verbatim `CLAUDE.md` sanctioned-exception text, and cross-referenced it from `nextjs-frontends.md`. Two remaining test-coverage gaps (relocate `signal-detail.spec.ts` rather than re-run it; a paired NotFound test for `SignalReadiness`) recorded as named Open Risks in design.md rather than requiring a round 8. No Floor breach in any of the 7 rounds. |
| 2026-08-10 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 26 steps. All `PlatformHeader.tsx`/`OrderForm.tsx`/`traderBff.ts`/`insightsBff.ts` line citations re-verified fresh against the live tree (no drift found from recon/design). One new correction found during spec-writing: `GetFundamentals`'s "no data for this symbol" case surfaces as `CodeUnavailable`/`CodeFailedPrecondition`/`CodeResourceExhausted` depending on cause, never `CodeNotFound` — the Fundamentals section step is written to handle any error generically, not via the `isNotFoundError` pattern every other section uses. |
| 2026-08-15 | `implementation-ready` (unchanged — product-spec amended, not re-gated) | /sdd-story (session) | **Scope amendment, explicit user decision**: an incoming request ("add charts for the selected strategy in the Symbol page") was absorbed into this in-flight feature rather than filed as a new one, since this feature already owns "the Symbol page." FR-6 amended to add indicator overlay chart panels for the resolved strategy's declared `StrategyComponent`s (new AC-4a); Out of Scope and Affected Services (`xstockstrat-indicators`) corrected to match. This re-opens design scope for FR-6 only — the other 25 approved steps and their design rationale are untouched. Next: `/sdd-design unified-symbol-page quick` scoped to FR-6's new architecture questions (see product-spec.md Open Questions), then `/sdd-spec` to add implementation steps. |
| 2026-08-15 | `implementation-ready` (unchanged — design.md amended with an FR-6 addendum, not re-gated; the feature was already past `design-approved`) | /sdd-design | **FR-6 design debated (3 rounds, full — user escalated from `quick` after round 1) and approved by user @ 2026-08-15.** recon.md gained an FR-6 addendum; design.md gained a "Design Addendum — FR-6 Indicator Overlay Panels" section. Chosen: a new additive `AnalysisService.GetIndicatorSeries` RPC whose handler reuses `StrategyEvaluator._compute_component`/`align_indicator_points` in its OWN loop (not the shared `evaluate_conditions_traced` — structural isolation from launched feature 097's `ListOpportunities` exit trace, the decisive round-2→3 reversal); client supplies the candlestick's own closes+times (no server re-fetch; verified `_compute_component` needs only closes); null-safe `google.protobuf.DoubleValue` wire encoding; per-component fault isolation; process-lifetime singleton semaphore `analysis.series.max_concurrent_components` (default 4, `max(1,…)` clamp); stacked `recharts` panels; evaluator-level parity test (not cross-RPC — flaky under differing bar windows). No Floor breach in any of the 3 rounds. product-spec.md FR-6/Affected Services/Proto Contract Changes/Config Key Changes/AC-4a corrected in lockstep (they had been written pre-debate assuming UI-direct indicator calls). **Two additive proto changes now pending for `/sdd-spec`**: the existing `ScreenResult` fields (FR-8) + the new `GetIndicatorSeries` RPC (FR-6). Next: re-run `/sdd-spec unified-symbol-page` to add the FR-6 implementation steps (proto step + analysis service/test steps + UI step), then `/sdd-execute`. |
| 2026-08-15 | `implementation-ready` (unchanged — spec extended, not re-gated) | /sdd-spec | **FR-6 implementation steps added (re-spec).** Grew implementation-spec.md from 26 to 33 steps: Step 27 (proto — additive `GetIndicatorSeries` RPC + `GetIndicatorSeriesRequest`/`Response`/`ComponentSeries`/`NamedSeries` messages + `google/protobuf/wrappers.proto` import), Step 28 (proto-gen), Step 29 (config — `analysis.series.max_concurrent_components`, C-05 CLAUDE.md row + config-governance registered-keys entry), Step 30 (analysis handler — own `_compute_component` loop, singleton semaphore, null→unset `DoubleValue` encoding, per-component fault isolation), Step 31 (paired Python tests — evaluator-level parity + fault-isolation + null-mapping), Step 32 (UI — retain candlestick bars, `useGetStrategy` components, `useIndicatorSeries`, stacked `recharts` `IndicatorPanels`), Step 33 (UI e2e + new `indicatorSeries.ts` fixture). The FR-6 block is additive on top of the existing 25 core steps and their dependencies — no existing step renumbered. **Design Open Risk resolved during spec-writing**: the `Bar` timestamp field is confirmed `time` (`marketdata.proto:46` — `google.protobuf.Timestamp time = 2`), not `.timestamp`. All FR-6 analysis-side anchors (`servicer.py` EvaluateReadiness skeleton @1959, `__init__` @117, `_compute_component`/`align_indicator_points`/`_finite_or_none` in `evaluator.py`, `screener.py:84-85` semaphore) re-verified fresh against the live tree. |
| 2026-08-15 | `implementation-ready` → `in-progress` | /sdd-execute | **Sequential execution started** (full feature, one commit per step, single integration PR #958). Executing on `claude/strategy-charts-symbol-page-itodkw` (harness-pinned; `feature/unified-symbol-page` absent on origin). Toolchain provisioned + codegen validated (empty stub diff). Step 1 done: additive `ScreenResult.criterion_raw_values`/`criterion_passed` (fields 12/13) — buf lint + buf breaking pass. |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Recon](recon.md) — grounded codebase dossier
- [Design](design.md) — debated (7 rounds — 5 to the design skill's normal cap, 2 more under an
  explicit user override), approved architecture
- [Implementation Spec](implementation-spec.md) — 33 steps (26 core + FR-6 steps 27-33)
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Consolidate everything the platform already knows about a single stock symbol — position, orders,
a trade-entry widget, opportunity/conviction and indicator/strategy signals and fundamentals (for
watchlisted symbols), screening tools (for non-watchlisted symbols), backtest history, and backfill
coverage — into one page, superseding the narrower `/trader/positions/[symbol]` and
`/trader/orders/[id]` pages shipped by feature 096.

## Reviewers

_Snapshot finalized by /sdd-spec (2026-08-10; re-spec 2026-08-15 added the FR-6 rows) from
`docs/runbooks/reviewer-registry.md`, deduplicated across all 33 implementation-spec.md steps:_

| Role | Review Focus |
|---|---|
| `xstockstrat-ui` (service owner) | Trading UI correctness, analytics display accuracy, Connect-RPC call safety, environment scope correctness, no secret values rendered, no direct DB access, order-mutation (trade widget) safety, C-10(a) nav reachability (both `PlatformHeader.tsx`/`BottomTabBar.tsx`), C-10(b) three-way valuation parity, the new cross-segment-client sanctioned exception in `CLAUDE.md`; FR-6 stacked `recharts` overlay panels — no fabricated `0.0` for warm-up/gap points (P-03), panels reached via the `analysisClient` cross-segment exception (Steps 32-33) |
| `xstockstrat-analysis` | Additive `ScreenResult` proto fields + `screener.py` wiring correctness (Steps 1, 3-4); FYI on the single-symbol Screening section's field usage (Step 16); the new `GetIndicatorSeries` handler — own `_compute_component` loop (never the shared `evaluate_conditions_traced`), singleton semaphore, null→unset `DoubleValue` encoding, per-component fault isolation (Steps 27, 29-31) |
| `xstockstrat-portfolio` | `GetPosition` `account_id` fix (pre-existing bug, in-scope side-fix) + its paired Go regression test (Steps 5-6) |
| `xstockstrat-marketdata` (FYI) | `GetFundamentals` BFF registration only — no service-side change (Steps 14-15) |
| `xstockstrat-indicators` (FYI) | Reached only transitively through the new analysis `GetIndicatorSeries` RPC — no service-side change (Step 32) |
| Proto Reviewer | `ScreenResult.criterion_raw_values`/`criterion_passed` — additive, non-breaking (Steps 1-2); additive `GetIndicatorSeries` RPC + 4 messages + `wrappers.proto` import — additive, non-breaking (Steps 27-28) |

## Next Action

`/sdd-review unified-symbol-page impl-spec` — the FR-6 steps (27-33) are now in
implementation-spec.md (33 steps total); validate the extended spec, then `/sdd-execute
unified-symbol-page`.

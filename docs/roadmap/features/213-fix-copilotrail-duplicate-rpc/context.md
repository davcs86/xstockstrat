# Context: fix-copilotrail-duplicate-rpc  (archived 2026-10-14)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-10-14 — /sdd-archiver

**What**: SEV-3 UI bug fix. `/insights/opportunities` fired two `ListOpportunities` RPCs because the React Query key from feature 190 ends in a defaulted `sort`: the page passed `CONVICTION`, CopilotRail relied on the hook default `UNSPECIFIED`. Shipped as a one-line change to the shared `useOpportunities` default (`UNSPECIFIED`→`CONVICTION`), a stale-comment refresh and an RPC-count e2e regression — NOT the product-spec's "pin CopilotRail". All five callers now share one page-1 cache entry.

**Why (irrecoverable rationale)**: Default-value drift: feature 190 moved the page default but left the hook default behind. Pinning one caller would have passed @AC-1 and left the same defect live: CopilotRail's hook runs above the `showCopilot` guard on every route, and three other ambient consumers (`SignalReadiness`, `WatchlistDetail`, `trader/positions/[symbol]`) also default to `UNSPECIFIED` (recon found 5 callers, not 2). The shared parameter default is the single source of truth. Flipping it changes the request `sort` sent by four callers; this is display-safe only because none indexes by ranked position (`WatchlistDetail` flattens `oppData.pages` and matches per symbol, `SignalReadiness` reads one symbol's readiness, the trader page enriches one symbol's header).

**Rejected alternatives**:
- Pin only CopilotRail's `sort` to `CONVICTION` (the product-spec fix) — relocates the duplicate RPC to `/insights/watchlists` and `/trader/positions/[symbol]`.
- A `DEFAULT_OPPORTUNITY_SORT` const shared by hook default and page fallback — over-built; it overturned recon.md's single-`const` recommendation because the parameter default already is the single source (C-18).
- CopilotRail reading the page's live query state — the rail is global and mounts off-route; it needs its own subscription to the default page-1 queue.
- Contingency (not needed): had `UNSPECIFIED` and `CONVICTION` returned different opportunity SETS, the fallback was to narrow to a query-key alignment only (map ambient consumers' key to `CONVICTION` while still sending their original `sort`). The risk resolved cleanly in the e2e mock; the server-side `ListOpportunities` handler was never confirmed to treat `UNSPECIFIED` as conviction-default, so do not read the mock result as server proof.

**Scars & gotchas**:
- No type error and no visible UI symptom; the only trace was a stale "Share the ['opportunities', 0] cache" comment. It surfaced only through the feature-187 QA back-fill, where @AC-7 could not be covered.
- Connect-JSON omits the enum zero value and serializes non-zero enums by name: an `UNSPECIFIED` request carries no `sort`, `CONVICTION` carries `'OPPORTUNITY_SORT_CONVICTION'` — an RPC-count test must handle both.
- The counting test must register `page.route` BEFORE `goto` (so it cannot reuse the suite's top `beforeEach`) and stay inside the initial-load window, before the 15s poll in `useOpportunities.ts:45` perturbs the count. Red→green captured as 2 RPCs (`UNSPECIFIED` + `CONVICTION`) before the fix and 1 after; full suite 36/36.
- No Docker daemon: e2e ran host-native with `CI=1` (production build, widened timeouts, because cold `next dev` SSR warmup times out) — recorded as a "CI-equivalent fallback".

**Permanent deviations**:
- product-spec said single-file fix, "Out of Scope: refactoring useOpportunities" → shipped the shared hook default → the user signed off explicitly (F-10/P-04) before the Step-1 write.
- The page's explicit `CONVICTION` fallback (`page.tsx:105`) is now redundant; left in place on purpose as out of scope.
- Design approval was consolidated into the 189/213 impl-spec review gate ("Approved by: user @ pending"); no independent P-04 design gate.

**Cross-feature signal**: feature 190 (5-tuple key) caused the regression; feature 187 shipped "no separate RPC" with its test step still pending, so 190 broke an untested promise (`fails.md` 2554-2569). `fails.md:1648`: the key must fold all controls — the fix preserved the 5-tuple `['opportunities', minConviction, sources, actionFilter, sort]`. Five callers of one hook share one cache key, so any default change affects all five.

**Deferred follow-ons**: the strict single-RPC guard for feature-187 @AC-7 in `services/xstockstrat-ui/e2e/insights/opportunities.spec.ts` was named out of scope and never recorded as done (213's `@AC-1` is promoted separately). Confirm in the analysis handler that `UNSPECIFIED` means conviction-default (the e2e mock does not prove it).

**Ledger entries written**: insights.md (1), fails.md (0 — existing 2026-09-26 entry already cites this feature) — see the 2026-10-14 entry.
**Runtime-invariant recommendations (→ /context-constitution)**: UI-*: `useOpportunities` has five callers; its parameter defaults are the single source of the default page-1 query key, and the CopilotRail subscription runs above the `showCopilot` guard on every route.
**Pruned artifacts**: product-spec.md, recon.md, design.md, implementation-spec.md — last present at 09ec8d9a.

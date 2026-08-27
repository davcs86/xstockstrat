# Context: watchlist-opportunity-signal-cues  (archived 2026-08-26)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-08-26 — /sdd-archiver

**What**: A UI-only (`xstockstrat-ui`) feature that bundled one new capability (icon+color readiness cue coding, FR-1) with a firing-row jump (FR-2) and three fixes (breadcrumb origin FR-3, mobile parity FR-4, filter responsiveness FR-5). What actually shipped is a single shared state→cue spine: one `readinessState()` bucketer that collapsed a **previously 4×-duplicated** firing/watching/quiet/no-data branch, feeding rollup counts, all Progress-variant pickers, text labels, and a new icon cue map applied to all four readiness surfaces (the Watchlists panel, Opportunities desktop, mobile SectionRenderer, and the "Why this fired" SignalReadiness panel). It also permanently changed the position-detail breadcrumb's first crumb to always be "Opportunities" regardless of entry point.

**Why (irrecoverable rationale)**: The DRY consolidation was not incidental — recon found the 4-way branch already copied in 4 sites, so a cue feature that mirrored the buckets a 5th time was a divergence class the design deliberately killed; consolidating structurally guarantees icon↔text agreement (AC-4). (Already recorded at insights.md:2119.)

**Rejected alternatives**:
- FR-3 origin-aware `?from=opportunities` crumb (round-1 design) — lost: the user chose the unconditional Opportunities crumb; origin-aware requires threading a param from every caller and keeps "Exposure" as a default the user rejected.
- FR-5 pruning `activeSources` via a mutating `useEffect` — lost: loops on the 15s `refetchInterval` and silently wipes the selection on a transient empty fetch, worse than the stuck symptom.
- FR-1 a parallel `readinessState` mirroring the buckets (a 5th copy) — lost to consolidation.
- FR-4 `head`+flat per-symbol signal sections — lost: yields separate top-level rows, not AC-9's single grouped card.
- Wrapping the cue icon in `<span aria-label>` — lost: breaks the Badge `[&>svg]` direct-child icon slot.

**Scars & gotchas**:
- The phosphor **value** import landed a client-only lib (`React.createContext` at module scope) in the `/trader/api` server bundle via `traderBff.ts→copilot.ts→opportunityShared`; only `pnpm build` caught it, not tsc/lint/unit/dev-server e2e. Fix: a new client-leaf `src/lib/readinessCue.ts` holding the value import + cue maps; `opportunityShared` imports phosphor type-only. (Already at fails.md:1665.)
- Sandbox-only e2e limitation: trader-BFF-dependent `position-detail.spec.ts` tests abort in-sandbox; they pass in CI's prebuilt bundle. AC-13 had to use AAPL + a per-page EvaluateReadiness route mock because `READINESS_BUCKET_OVERRIDE` hangs on a non-position symbol in-sandbox.
- Playwright strict-mode locator collision: the caption "Momentum building" also matched "momentum" → needed `exact:true`.
- e2e for breadcrumb/nav-touching changes must assert **inside** `getByLabel('Position path')` because the global nav renders an "Opportunities" Link on every page (the ledger 2026-08-09 trap, honored here).

**Permanent deviations**:
- The position-detail first breadcrumb is **always** "Opportunities"→`/insights/opportunities` for *every* entry point → this deliberately **regresses "back to where I came from"** for Exposure/Portfolio/Orders/firing-jump origins → because the user explicitly signed off on it over the origin-aware alternative. No test breaks (no crumb assertion existed). If a future agent sees Exposure-origin nav "losing" its back target, it is a choice, not a defect.
- Minor: `icon?` typed as Phosphor's `Icon` type so `EnumBadge` can forward `role`/`aria-label`/`data-testid` to the svg.

**Cross-feature signal**: The server-bundle `createContext` failure is the same client-lib-crosses-RSC-boundary family as the C-10 shared-consumer entries and the in-sandbox trader-BFF test aborts — `opportunityShared`/`traderBff` is a recurring choke point where a shared `lib/` module is transitively pulled into server plumbing (fails.md:1665). This feature created the **first** durable C-16 acceptance suite for `xstockstrat-ui` — future UI features now have a suite to extend/dedup against.

**Deferred follow-ons**: The FR-3 back-navigation regression for non-Opportunities origins is left open "to revisit at review if UX objects."

**Ledger entries written**: insights.md (0), fails.md (0) — every durable lesson (one-bucketer state→visual encoding; the `page.reload()`-resets-state vacuous-green trap; the client-lib-into-server-bundle crash) was already recorded at insights.md:2119 / fails.md:1660 / fails.md:1665. The FR-3 deliberate breadcrumb regression is a signed-off product choice, preserved in this synthesis rather than the cross-feature ledger.
**Runtime-invariant recommendations (→ /context-constitution)**: candidate UI-* — `opportunityShared.tsx` sits on a server import chain (`traderBff.ts:24 → copilot.ts:7 → opportunityShared`), so it is effectively a server-reachable module despite serving client cues; any value import of a client-only React lib there breaks the `/trader/api` server bundle. (The fails.md:1665 entry already carries the transactional lesson.)
**Scenario promotion (C-16)**: all 13 `@AC-*` were already promoted at launch to `services/xstockstrat-ui/acceptance/watchlist-opportunity-signal-cues.feature` — nothing new to write (idempotent).
**Pruned artifacts**: product-spec.md, recon.md, design.md, implementation-spec.md — last present at 996210e4.

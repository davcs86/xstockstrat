# Recon: screener-watchlist-fidelity

**Generated**: 2026-08-02 (sdd-design Phase 0)
**Affected services**: `xstockstrat-ui` (only)

---

## Objective

Raise the Screener (`/insights/screener`) and Watchlists (`/insights/watchlists`) pages to the
feature-083 high-fidelity design using only data/controls already derivable from existing RPCs. No
proto/config/DB change. Livestream elements (LAST/CHG/Quotes) are deferred to `098-watchlist-live-quotes`.

## Codebase Map

### Screener
- `src/app/insights/screener/page.tsx` — page. `CriterionRow` shape (`weight`, `hardFilter`) at `:17-24`;
  **`weight` hardcoded to `1`** at `:39`; **no UI control mutates `weight`** (rows render metric/
  comparator/threshold/hard only, `:110-146`); criteria sent raw (no normalization) at `:69-77`; score
  color **inlined** at `:218` (`r.score >= 0.8 ? 'text-buy' : r.score >= 0.7 ? 'text-primary' : ''`).
- `src/hooks/useScreenSymbols.ts:9-11` — mutation wrapping `analysisClient.screenSymbols`.

### Watchlists
- `src/app/insights/watchlists/page.tsx` — flat stack of CRUD cards; renders
  `<WatchlistReadiness symbols={wl.symbols} />` at `:156`.
- `src/hooks/useWatchlists.ts` — `useWatchlists:10`, `useCreateWatchlist:21`, `useUpdateWatchlist:33`,
  `useDeleteWatchlist:46`, `useAddWatchlistSymbols:53`, `useRemoveWatchlistSymbols:61` (all via
  `useInvalidatingMutation`).
- `src/components/insights/WatchlistReadiness.tsx:40` — strategy-scoped readiness overlay; strategy
  picker via `useStrategyDefinitions` (`:41`); `useReadiness(strategyId, symbols)` (`:44`); `isFiring`
  (`:17`), `barClass` (`:21`), `blockingCondition` (`:28`, uses `ConditionState.PASS`).
- `src/hooks/useOpportunities.ts` — `useOpportunities` (polls `listOpportunities`, 15s) `:14`;
  `useReadiness` (`evaluateReadiness`, enabled only with strategy+symbols) `:23`; `useStrategyAnalytics`
  `:34`.
- `src/hooks/useStrategyDefinitions.ts:17` — `listStrategyDefinitions`.

## Patterns to REUSE (anti-duplication core)

- **Score color** → `src/lib/scoreDisplay.ts` `scoreColor` (`:14`, `>=0.8 text-buy` / `>=0.6 text-paper`).
  Screener currently **inlines** its own thresholds (`page.tsx:218`) — replace with `scoreColor` (DRY).
  `ratingVariant` (`:7`) also available for a Badge variant.
- **Readiness condition states** → `src/lib/opportunityShared.tsx` `CONDITION_STATE` map (`:28`) +
  `EnumBadge` (`:51`). Reuse for any per-condition state chip rather than re-mapping `ConditionState`.
- **Readiness overlay** → extend `WatchlistReadiness.tsx` in place (already computes `isFiring`,
  `barClass`, `blockingCondition`) rather than re-deriving readiness in the page. The **roll-up count
  and the per-row states must come from the same `useReadiness` result** (C-10(b) parity).
- **Mutation+invalidate** → `src/hooks/useInvalidatingMutation.ts` (canonical) — any new "save/add"
  mutation builds on it, as the watchlist hooks already do.
- **Cross-segment link** → watchlists→screener is **same-segment**; a plain `/insights/screener` href
  suffices (`src/lib/basepath.ts:1-3`, `BASE_PATH_INSIGHTS='/insights'`). No new base path.
- **UI primitives present** → `src/components/ui/`: `badge`, `button`, `input`, `card`, `select`,
  `skeleton`, `table`, `combobox`, `sheet`, `separator`; `EmptyState` at `src/components/shared/`;
  `cn` at `src/components/ui/utils.ts`.
- **Score/weight helpers home** → new pure helpers (weight normalization, readiness roll-up counts)
  belong in `src/lib/` where they are unit-testable (vitest coverage is scoped to `src/lib/**`).
- **Test data** → screener results are mocked inline in `e2e/mock-backend.ts` (`screenSymbols:631`);
  `evaluateReadiness:490`, `listOpportunities:485`, `listStrategyDefinitions:678` are centralized there.
  Watchlist RPCs are mocked **per-spec** via `mockWatchlists(page)` in `e2e/insights/watchlists.spec.ts`
  (`page.route('**/…PortfolioService/{ListWatchlists,CreateWatchlist,AddWatchlistSymbols,…}')`). Opportunity
  fixtures at `e2e/fixtures/opportunities.ts`. Extend these — do not invent a parallel mock.
- **Existing unit test to extend** → `src/lib/scoreDisplay.test.ts` (alongside `positionRisk.test.ts`,
  `protoTime.test.ts`, etc.).

## Dependencies

- **Proto/RPC (all existing, no change):** analysis `ScreenSymbols` (`ScreenCriterion.weight` field 8,
  `hard_filter` field 9, `ScreenResult.score`), `EvaluateReadiness`→`SymbolReadiness`/`ConditionEval`
  (`ConditionState` enum), `ListOpportunities`→`Opportunity.symbol`, `ListStrategyDefinitions`;
  portfolio `CreateWatchlist`/`AddWatchlistSymbols`/`ListWatchlists`/`Watchlist.*`.
- **Browser clients:** `analysisClient` and `insightsPortfolioClient` both bound to `/insights/api`
  (`src/lib/browserClients/*.ts`); methods are proto-generated.
- **Nav:** both routes already registered in the **Discover** group (`navGroups.tsx:44-46`) — no nav
  change; cross-links must resolve to these registered hrefs (C-10(a)).
- **Migration chain / config keys / env vars:** none touched.

## Risks / Not-found

- **`Slider` primitive MISSING** (`src/components/ui/slider*` absent). A weight control uses a native
  `<input type="range">` (or the existing `<Input type="number">`) — **no new dependency / no Radix
  Slider** to keep the diff minimal (How-to-Act #2).
- **`Tabs` primitive MISSING** (`src/components/ui/tabs*` absent). Only the deferred **Quotes** tab
  needed Tabs — so nothing to build here; the master-detail layout needs no Tabs.
- **No weight-normalization helper** in `src/lib` today — new pure helper + unit test to add.
- **Readiness strategy binding (design fork)** — carried from product-spec Open Questions: feature 083
  forbids a fabricated signal→strategy binding, so per-list "N ready" and the STRATEGY column are
  **strategy-scoped** (trader picks the strategy). Resolve in Phase 1.
- **`ListOpportunities` is user-scoped and polled** — the "in queue" mark (FR-11) is best-effort: a
  symbol counts as in-queue only if it appears in the current opportunity page.
- **fails.md traps:** 060/C-10(a) (nav reachability — no new route, but verify cross-links); 056/C-10(b)
  (derive roll-up + rows from one read path).

## Recommended Scope (advisory step boundaries)

1. **Pure helpers + unit tests** in `src/lib/` — weight normalization (display shares) and readiness
   roll-up bucketing (ready/watching/quiet), reusing `scoreColor`. (RED-before-green friendly.)
2. **Screener page** — weight control (range/number) + normalized-share display, hard/rank toggle,
   criterion display grammar, last-run metadata, score via `scoreColor`.
3. **Screener→watchlist actions** — "Save as watchlist" + "Add top-N to watchlist" via existing hooks.
4. **Watchlists page** — master-detail restructure; fold roll-up + STRATEGY + blocking-condition +
   "in queue" into the readiness detail; "Build from screener" link.
5. **E2E** — extend `e2e/insights/{screener,watchlists}.spec.ts` + `mock-backend.ts` (existing RPC
   fields only); assert derivable surfaces and the absence of LAST/CHG/Quotes.

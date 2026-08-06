# Context: screener-watchlist-fidelity  (archived 2026-08-06)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-08-06 — /sdd-archiver

**What**: Raised Screener and Watchlists to the feature-083 design's fidelity using only
already-wire-available RPC fields (`ScreenCriterion.weight`/`hard_filter`, `ScreenResult.score`,
`EvaluateReadiness`, `ListOpportunities`, portfolio `Watchlist` CRUD) — a pure UI/presentation
change with zero proto/config/DB delta. LAST price, intraday CHG%, and the Quotes tab were split to
`099-watchlist-live-quotes` because they need a streaming quote feed the platform doesn't expose.

**Why (irrecoverable rationale)**: The two design forks that most needed a human call — "does
readiness get a per-row STRATEGY column or a single caption" and "how does an un-evaluable symbol
get bucketed" — were resolved by treating a UI dimension bound to one upstream selection as visually
dishonest if repeated per row (it re-implies a per-symbol signal→strategy binding feature 083
explicitly forbids), and by giving degenerate producer output (`total_conditions==0`) its own bucket
(`nodata`) rather than folding it into a real state (`quiet`), reconciled against the *requested*
symbol set rather than the response array so the sum invariant survives a future producer that drops
rows. This reasoning is already fully inlined in `docs/roadmap/ledger/insights.md`, 2026-08-02 —
098-screener-watchlist-fidelity — design.

**Rejected alternatives** (not already inlined in the ledger entry above):
- Radix `Slider` primitive for the weight control — rejected: none exists in `src/components/ui/`;
  adding a dependency for one control violates minimalism; native range + bound numeric input covers
  both affordance and Playwright-fillability (range inputs are not reliably `fill`-able).
- Parameterizing the shared `symbolReadiness(symbol, overrides)` e2e fixture — rejected: it breaks
  the existing point-free `.map(symbolReadiness)` call site in `e2e/mock-backend.ts` (`.map` passes
  the array index as the fixture's 2nd arg) and risks the 083 signal-detail specs; overrides are
  spread at the call site instead. A future test author reaching for fixture parameterization to get
  per-symbol variation would reintroduce this exact break.
- Live relative-time tick (`setInterval`) for "last run Nm ago" — rejected as speculative
  scaffolding; renders once from `Date.now()` at render time instead.
- Persisted per-list default strategy (to show "N ready" on every master row without a picker) —
  rejected not only because it needs a new DB column (out of scope), but because it would itself
  re-encode a per-list strategy binding at the list level — the same forbidden fabricated
  signal→strategy binding pattern the caption-vs-column fork was resolved to avoid at the row level.

**Accepted known limitations (deliberate, not oversights)**:
- Symbol-notation gap: the in-queue membership check's `.toUpperCase()` only normalizes case, not
  notation variants (e.g. `BRK.B` vs `BRK-B`) — accepted because "both current sources are upper-case
  canonical."
- Best-effort polling/pagination gap on the "in queue" mark (FR-11): `ListOpportunities` is
  user-scoped and polled (15s interval), so a watchlist symbol only shows in-queue if it appears in
  the *currently fetched* opportunity page — a symbol can be an active opportunity and still not
  show in-queue due to poll timing/pagination; accepted, not a defect. Not documented anywhere in
  shipped code (`WatchlistDetail.tsx` only documents an unrelated hook-ordering constraint).

**Scars & gotchas**:
- Create-then-auto-select race in a master-detail UI: setting `selectedId` directly inside
  `useCreateWatchlist.onSuccess` raced the `ListWatchlists` refetch — a reconcile effect (reset
  selection to first item when the current selection isn't present) saw the brand-new id as absent
  and clobbered it back to the first list. Only caught by the master-detail e2e. Fixed via a
  `pendingSelectRef` that only commits the new id once it actually appears in the refetched list —
  a generically reusable pattern for any "create → auto-select" flow on invalidate-and-refetch
  mutations.
- `COMPARATOR_LABELS` stays a partial array, not an exhaustive `Record<Comparator, string>`
  (`Comparator` has `UNSPECIFIED(0)`/`BETWEEN(5)`; an exhaustive map fails `tsc`) — a recurrence of
  an already-logged trap (`fails.md` 2026-07-21), not new.

**Permanent deviations**: none architectural — shipped matches design's chosen approach; only
execution-shape changes (single-branch execution, Steps 3+4 merged into one page rewrite,
`watchlistMock` helper extraction). **Harness-branch anomaly**: product-spec.md recorded that at
execution time "the repo's live default branch is `main` (no `main-dev` exists in this checkout)" —
directly contradicting root CLAUDE.md's "Harness Default Branch" rule — and was the stated cause for
this feature being executed single-branch with a PR to `main` instead of the normal per-step
`/sdd-execute` flow into `main-dev`. This was an environment anomaly at execution time, not a mistake
by this feature; not ledger-worthy as a mistake, but recorded here since it's otherwise
unrecoverable once `product-spec.md` is pruned.

**Cross-feature signal**: none beyond what's already ledgered.

**Deferred follow-ons**: `099-watchlist-live-quotes` — named backlog feature for LAST price,
intraday CHG%, and the Quotes tab (needs a streaming/realtime quote feed the platform doesn't expose
today). Created 2026-08-02 alongside this feature's product-spec, status `idea`.

**Ledger entries written**: insights.md (1), fails.md (0) — see the 2026-08-06 entry.
**Runtime-invariant recommendations (→ /context-constitution)**: none.
**Pruned artifacts**: product-spec.md, recon.md, design.md, implementation-spec.md — last present at
`fe278020abe1e4b0c128a7a2207fd46596d8a9e8`.

# Design: unified-symbol-page

**Created**: 2026-08-10
**Rounds**: 7 (full; termination: approved. Rounds 1–5 ran to the design skill's normal hard cap;
the user then **explicitly overrode that cap** — a skill-authored process/convergence mechanism, not
a Constitution Floor (`F-*`) item, so honoring the override carries no correctness/safety risk the
way overriding an actual Floor rule would — for rounds 6–7, up to the user's stated 7-round ceiling.
Round 6 justified the override immediately: its adversary found a real, previously-approved-and-
missed defect. See `context.md` § Session 2026-08-10 for the full override rationale.)
**Approved by**: user @ 2026-08-10
**Grounded in**: recon.md

---

## Chosen Approach

### Route and page identity (resolved round 3–5)

`/trader/positions/[symbol]/page.tsx` (`recon.md` Codebase Map — feature 096) is **reused in place**
as the sole unified route — no new path. `/insights/market/[symbol]/page.tsx` (feature 083) is
deleted and replaced with an **unconditional Server Component `redirect()`** to
`/trader/positions/[symbol]`, forwarding the query string verbatim so `?strategy=<id>` threading
from `insights/opportunities/page.tsx:129-130` survives the hop (precedent for an unconditional
`redirect()`: `app/page.tsx:1-5`). `/trader/orders/[id]/page.tsx` **stays standalone, unmerged** —
an order (including a closed position's historical order) is not always "the" position view for its
symbol, and 096 already gives it a complete ticket-grammar page; this feature's own Orders & fills
section covers "see this order in the context of its symbol" without needing to fold the standalone
ticket view in.

**One real caller repoint**: `insights/opportunities/page.tsx:129-130` changes its link target from
`/insights/market/${symbol}` to `/trader/positions/${symbol}` (carrying `?strategy=${strategyId}`
forward). The three other sites recon originally flagged (`orders/[id]/page.tsx:191`,
`positions/[symbol]/page.tsx:390`, `orderShared.tsx:94`) were re-verified by grep and found to
already point at `/trader/positions/[symbol]` or `/trader/orders/[id]` — routes untouched by this
design — and need **no change** (round 3's recon-carried citation was wrong; corrected here).

Both nav duplicated special-cases for `/insights/market` — `PlatformHeader.tsx:107`'s
`resolveActive` and `BottomTabBar.tsx:18-20`'s `isGroupActive` — are **deleted**, since that route
is now redirect-only and never paints. `book`'s existing `PLATFORM_SUBNAV`/`NAV_GROUPS` entry for
`/trader/positions` (`navGroups.tsx:33-84`) is the sole remaining, correct registration. A new
**two-surface nav-reachability e2e test** (desktop `PlatformHeader` + mobile `BottomTabBar`) proves
both were updated together (C-10(a)).

### Page structure — sections gate independently of position existence (resolved round 4–5)

The prior design (rounds 1–3) inherited 096's all-or-nothing gate: `!position` renders only a
full-page `EmptyState` and stops; `position && position.symbol` gates everything else. Since the
new sections (Opportunity/Readiness/Fundamentals/Screening/Backtests/Backfill) exist specifically to
serve symbols the user does **not** hold — the exact reason `/insights/market/[symbol]` existed and
why `opportunities/page.tsx` links unheld-opportunity symbols to a symbol page — that gate would
make this feature's headline content unreachable for its intended audience. **Fixed structure:**

- **Only `usePosition`'s own loading/error state gates the position-specific UI** (stat tiles,
  avg-cost/stop price-line overlays, Risk & exit / Manage / Broker sidebar). Every other section —
  Trade widget, Orders & fills, the price chart, the watchlist-conditional split, Backtests,
  Backfill — mounts and queries **independent of `position`'s state**, each handling its own local
  loading/error/empty case.
- **Orders & fills hoisted out of the position-conditional block.** `useOrders(mode,
  selectedAccountId, {symbol})` is already fetched unconditionally at the page's top level
  (`positions/[symbol]/page.tsx:56`); only its *rendering* was nested inside the position-gated
  `PositionBody`. The card renders at the top level, gated on its own `orders.length === 0` empty
  state, independent of `position` — serving FR-3 for a symbol with historical-only orders and no
  current position (a closed position, or a watchlist symbol with a past manual order).
- **The price chart hoisted out of the position-conditional block.** `insights/market/[symbol]`
  already fetches bars and renders its candlestick chart unconditionally for every symbol — that is
  exactly the research capability FR-1's Problem Statement targets. The bars-fetch effect and chart
  `Card` move to the page's top level; only the `avgEntryPrice`/`stopPrice` price-line overlays stay
  conditional on `position` (the existing `if (avg > 0)`/`if (stop > 0)` guards already no-op
  cleanly with no position). The chart's caption/meta-line JSX, which reads `position.avgEntryPrice`
  etc. directly today, is changed to read the same top-level `avg`/`stop`/`hasStop` locals the
  overlay logic already computes, so it degrades gracefully (omits the avg/stop captions) instead of
  crashing when there is no position — **implementation-spec.md must enumerate every one of these
  ~6 `position.`-reading references as an explicit step-level checklist item**, since missing even
  one reintroduces a crash for exactly the unheld-symbol case this fix exists for.
- **Position-not-found renders a compact inline notice, not a page takeover.** The position-
  conditional block, when `usePosition` resolves not-found, shows an inline `CardNotice` ("No {mode}
  position in {symbol}" — precedent `trader/portfolio/page.tsx:152`) occupying only that block's
  slot; the rest of the page renders below it regardless.
- **Render-order fix (final, resolved without a 6th round — mechanical, not an open design
  question).** Today's error-then-EmptyState branch order
  (`{error && <p>Failed to load position...</p>}` checked *before* the `EmptyState` branch,
  `positions/[symbol]/page.tsx:150-167`) means `GetPosition`'s genuine `NotFound` error (a real
  `connect.CodeNotFound`, `portfolio_handler.go:330-340`) — the *common* case for every non-held
  visit — hits the scary error paragraph first, ahead of the intended EmptyState. Fixed: reclassify
  the error before branching — a `NotFound`-classified error (via the canonical `isNotFoundError`
  helper, `scoreDisplay.ts:36`, same helper `useStrategies.ts:34,64` already uses) routes to the
  EmptyState/`CardNotice` branch; only a genuinely different error (timeout, 5xx) still shows the
  error paragraph. `usePosition` also adopts the same `retry: (failureCount, err) =>
  !isNotFoundError(err) && failureCount < 1` guard `useStrategies.ts:54-67` already uses, so a
  NotFound doesn't burn a wasted retry before the fix even applies. **Extended (round 7)**:
  `usePosition`'s `refetchInterval: 10_000` is also made a function gated on NotFound —
  `refetchInterval: (query) => (isNotFoundError(query.state.error) ? false : 10_000)` — because the
  retry guard alone only suppresses in-attempt retries, not the outer 10s polling loop; round 6's
  adversary caught that a confirmed-NotFound position would otherwise poll `GetPosition` forever
  against a symbol that will never resolve. This mirrors the repo's own precedent: neither
  `useStrategyReport` nor `useBacktestDetail` (`useStrategies.ts:39-67`) declares `refetchInterval`
  at all once they're NotFound-aware.
- **`SignalReadiness`/`useReadiness` get the identical `isNotFoundError` treatment (round 6–7).**
  `EvaluateReadiness` genuinely aborts `grpc.StatusCode.NOT_FOUND` when `strategy_id` doesn't resolve
  (`servicer.py:1971-1976`) — reachable because `SignalReadiness.tsx:32` seeds `strategyId` directly
  from `searchParams?.get('strategy')`, an externally-controllable/bookmarkable value (a stale,
  deleted, or renamed `?strategy=` on the unified page hits this). Round 6's adversary found the
  reused-as-is component's current handling (`error ? <p>Failed to evaluate readiness.</p> : ...`,
  `SignalReadiness.tsx:65-66`) has **no** NotFound-vs-generic distinction at all — strictly worse
  than the position page's pre-fix state, not equivalent to it, and this was missed by the original
  design despite the sweep round 6 requested explicitly claiming to have checked it. Fixed:
  `useReadiness` (`hooks/useOpportunities.ts:45-51`) gets the same `retry` guard + `isNotFound`
  return field as `useBacktestDetail` (`useStrategies.ts:60-67`); `SignalReadiness.tsx` destructures
  `isNotFound` and branches to a distinct "This strategy no longer exists — pick another." message
  before the generic error paragraph. `SignalReadiness` is a **shared** component (also mounted on
  `insights/market/[symbol]` today, though that page is deleted by this design's own route
  decision) — one change, not a fork; see Open Risks for the paired test-coverage obligation this
  creates.
- **Backtests section is explicitly a history LIST only — no embedded per-run detail view (round
  7, resolving an ambiguity round 6 flagged).** Confirmed against FR-9/AC-6 (product-spec.md): "lists
  past runs... offers a way to trigger a new run" never says "view a run's detail." The design uses
  only `useBacktestHistory` (list-shaped, no NotFound semantics, `useStrategies.ts:39-49`) —
  `GetBacktest`/`useBacktestDetail` (the one hook on this page's dependency graph that already had
  NotFound handling) stays exclusively on the existing `/insights/strategies/[id]` page
  (`insights/strategies/[id]/page.tsx:49,76-81`), which is unaffected by this feature. No deep-link
  to a specific run exists there today (accepted, out-of-scope gap, not silently built around).
- **Trade widget renders unconditionally** — reusing `OrderForm` (`components/trader/OrderForm.tsx:41-48`)
  directly under `/trader`'s ambient `AccountProvider` (`app/trader/providers.tsx:6,13`), no
  `SignalOrderTicket`-style own-wrapper needed. A symbol with no position is exactly when a trader
  most needs to place an entry order — this is the same job `SignalOrderTicket` did on
  `insights/market/[symbol]`.
- **Watchlist-conditional split (FR-11)** is gated *only* on watchlist membership — never on
  position existence: on a watchlist → Opportunity/conviction + `SignalReadiness` + Fundamentals; not
  on any watchlist → Screening. Membership is a client-side scan of `useWatchlists()`'s returned
  `bindings[]` (no dedicated membership RPC exists — recon.md Risks).
- **Backtests strategy-source precedence (resolved round 5)**: `watchlistBinding.strategyId ||
  owningStrategy` — the watchlist binding first, falling back to the symbol's orders-derived
  `owningStrategy` (already computed for the "Why it's held" sidebar, `positions/[symbol]/page.tsx:59-67`)
  when unbound or absent. This mirrors the identical `threadedStrategy || opportunity?.strategyId`
  precedence pattern `insights/market/[symbol]/page.tsx:101` already establishes for `?strategy=`
  vs. binding-derived readiness, and closes a self-contradiction round 4 left open (a held-but-
  unwatchlisted symbol showing "Held under Foo" in the sidebar next to "no backtest data").
  Backtests uses the client-side filter mechanism (`ListBacktests(strategy_id)` filtered against
  `BacktestRunSummary.symbols`, recon option (a)) — zero backend change, narrower coverage (misses a
  symbol's runs under any *other* strategy) named explicitly as an accepted scope limit in FR-9/AC-6
  (product-spec.md updated in the same PR as this design), not silently dropped. A named follow-up
  (additive `symbol` field on `ListBacktestsRequest`, backed by the already-existing
  `analysis.backtest_runs.symbols` column) is recorded for full cross-strategy coverage.

### BFF wiring (resolved by explicit user decision — round 5 gate)

The debate's final adversarial check found the "only `GetFundamentals` needs a new registration"
claim (round 3) was **false** — verified against the live `traderBff.ts`, seven-plus RPCs
(`ListOpportunities`, `EvaluateReadiness`, `ScreenSymbols`, `RunBacktest`/`ListBacktests`/
`GetBacktest`, `ListWatchlists`, all of `IngestService`'s `ListBackfillJobs`) are genuinely
unregistered there, and the "reuse the cross-segment `insightsBff.ts`-bound client directly" pattern
the design had been leaning on (mirroring `useWatchlists()`'s and `SignalOrderTicket.tsx`'s existing
calls) contradicts `services/xstockstrat-ui/CLAUDE.md`'s own stated rule: "a browser component
imports only the client for its segment."

**User decision: formally adopt cross-segment client reuse as a sanctioned, documented exception**
(not dual-registration). This is the **only** change to the design that came from a direct user call
rather than the debate itself, made explicitly at the round-5 gate. Concretely:

- Every section reuses the existing hooks/browser clients bound to `/insights/api`
  (`analysisClient`, `insightsIngestClient`, `insightsPortfolioClient`) exactly as they exist today —
  `useOpportunities`/`useReadiness`/`useStrategyAnalytics`, `useScreenSymbols`,
  `useBacktestHistory`/`useBacktestDetail`/`useRunBacktest`, `useBackfillJobs`, `useWatchlists` — with
  **zero new `traderBff.ts` registrations** for any of them.
- This is safe (verified directly against code in rounds 3 **and** 6, independently — not assumed
  either time): `analysisClient.ts` / `insightsIngestClient.ts` / `insightsPortfolioClient.ts` all
  bind a **root-relative** `baseUrl: '/insights/api'`, so a browser `fetch()` issued from a page
  rendered at `/trader/positions/AAPL` resolves same-origin, not cross-origin (no CORS). **No
  segment-specific ingress routing exists** (reworded, round 7, for precision — round 3–5's phrasing
  overstated the routing rule's specificity): `.do/app.yaml`'s single `/` catch-all (everything but
  `/agent`) routes to `xstockstrat-ui`, so `/trader/api` and `/insights/api` are always served by the
  same component. `auth.ts:41-52`'s session cookies are set with `path: '/'`, not segment-scoped.
  `bffShared.ts`'s `requireSession` independently re-verifies the cookie on every dispatch regardless
  of which BFF router handled it.
- `GetFundamentals` is the **one** genuinely new registration — it exists in neither BFF today
  (confirmed absent from both `traderBff.ts:103-106` and `insightsBff.ts:85-91`), so there is no
  existing registration to reuse either way. It's added to `traderBff.ts` using the already-imported
  same-segment `marketDataClient`, mirroring the existing `getBars` entry (`traderBff.ts:104`).
- **`services/xstockstrat-ui/CLAUDE.md`'s "a browser component imports only the client for its
  segment" rule is amended in the same PR** to add a sanctioned-exception bullet, placed directly
  after the file's existing `ChartPanel.tsx`/`lightweight-charts` sanctioned-exception bullet
  (`CLAUDE.md:59-66`, before `## Docker Build Pattern` at line 68), same format — verbatim text
  (round 6–7, verified in place against the live file):

  > **Sanctioned exception — the unified `/trader/positions/[symbol]` page reuses `/insights`-segment
  > browser clients.** `analysisClient`, `insightsIngestClient`, and `insightsPortfolioClient` (all
  > `baseUrl: '/insights/api'`) are called directly from this `/trader`-segment page rather than
  > re-registered in `traderBff.ts` (feature 125 design decision, 2026-08-10): the base URLs are
  > root-relative so the browser `fetch()` stays same-origin regardless of which segment rendered the
  > page; no segment-specific ingress routing exists — `.do/app.yaml`'s single `/` catch-all routes
  > both `/trader/api` and `/insights/api` to the same DO component; the session cookie is
  > `path: '/'`, not segment-scoped; and `bffShared.ts`'s `requireSession` re-checks the session on
  > every dispatch independent of which BFF router handled it. This trades `/trader`'s BFF
  > self-containment for avoiding duplicate one-line `forward()` registrations — do not re-flag this
  > as an architecture violation in a future audit; do not treat it as precedent for arbitrary
  > cross-segment reuse without re-verifying these four facts still hold.

  **Cross-referenced (round 7)** from `docs/patterns/nextjs-frontends.md` §10 — a one-line footnote
  under "Each frontend has two BFF files" (`nextjs-frontends.md:280-282`), immediately before the
  fenced code block, pointing to the `CLAUDE.md` bullet above. Round 6's adversary found the
  canonical pattern doc states this BFF-self-containment rule as "non-negotiable"
  (`nextjs-frontends.md:256`) with no pointer to the exception — a future reader consulting the more
  authoritative doc would never discover it. **Also found (round 6, unresolved by this feature)**:
  `nextjs-frontends.md`'s surrounding "two BFF files"/nginx-forwarding text is itself a pre-existing,
  already-recorded stale-doc gap (`fails.md` 2026-08-05, `ui-consolidation-nextjs`, still unfixed as
  of this design) — footnoting a paragraph already flagged as drifted risks the footnote reading as
  endorsing stale context. **Decided by the orchestrator at the round-7 close** (no round 8
  available): the implementation step that adds the footnote must also correct the immediately
  surrounding stale "two BFF files"/nginx-forwarding text in the same edit, not leave the footnote to
  sit beside uncorrected drift — see Open Risks.
- **Rejected**: dual-registering all seven-plus RPCs in `traderBff.ts` as one-line `forward()`
  duplicates of what `insightsBff.ts` already has — the adversary's own recommended default, and the
  more conventional choice, but the user explicitly chose the leaner cross-segment-reuse path given
  the mechanism is proven safe and duplicating working registrations is exactly the kind of
  "while I'm here" scaffolding this repo's DRY guard rail and CF-N4 litmus discourage. This trades
  away `/trader`'s BFF self-containment (a future `insightsBff.ts` change now has blast radius onto
  this page) for less duplicated surface — an explicit, recorded trade-off, not an oversight.

### FR-7 Fundamentals

`GetFundamentals` on `MarketDataService` (`xstockstrat-marketdata`) — corrected from the original
product-spec's wrong citation of `RunFundamentalsScan` (`xstockstrat-analysis`), which is
admin-scope-gated and side-effecting (recon.md Risks). `GetFundamentals` is a plain, ungated,
read-through DB cache over the same underlying data (`analysis`'s own fundamentals-signal producer
reads through this exact RPC). New `traderBff.ts` registration (the one genuine BFF addition, above)
+ new display + new `e2e/fixtures/fundamentals.ts` fixture home (C-12, currently absent from
`INVENTORY.md` entirely).

### FR-8 Screening (single-symbol, watchlist-negative symbols only)

`ScreenSymbols` called with the one symbol, but the section **never shows `ScreenResult.score` or
`criterion_scores`** — both are built from `_normalize_universe`'s min-max normalization
(`screener.py:388-416`), which collapses to a content-free `0.5` for every criterion on a
single-symbol universe (confirmed live, unguarded; matches `fails.md:802-821`). Round 1's "reuse
gap/threshold" mitigation was verified factually wrong (`ScreenResult` has no such field;
`CoverageGap.gap` is an unrelated backfill date-range). **Real fix**: two additive `ScreenResult`
proto fields — `map<string, double> criterion_raw_values = 12` and `map<string, bool>
criterion_passed = 13` — populated in `screener.py`'s existing `_build_result` construction site
from values the engine already computes internally (`row["raws"]`/`row["passes"]`) but doesn't
currently expose. The single-symbol UI shows, per criterion: ref name, raw value, threshold
(client-side, from the request), pass/fail. **This is a real, additive proto change** — the analysis
service step (proto + `screener.py` wiring + `./scripts/buf-gen.sh`) is a **hard predecessor** to the
UI screening step in `implementation-spec.md`; `/sdd-spec` must not cite the generated
`criterionRawValues`/`criterionPassed` TS symbols until that regeneration has landed (C-01/F-04).
product-spec.md's Proto Contract Changes section is corrected in the same PR to name this change —
the original draft omitted it entirely under a blanket "no proto changes" claim. The new scenario
data extends the existing canonical `e2e/fixtures/screenResults.ts` (C-12's home for `ScreenResult`
fixtures, `INVENTORY.md:28`) — not a third screener fixture file. Note for a future reader: the new
maps carry the same PE/RSI/ATR/rev-growth values a second way alongside the existing named columns
(`pe=7`/`rsi=8`/`atr=9`/`rev_growth=10`) for symbols whose criteria include those four — intentional,
since the maps also generalize to arbitrary custom-formula criteria the named fields don't cover.

### FR-9 Backtesting

Covered above (strategy-source precedence). Trigger-a-new-run reuses `useRunBacktest`
(`hooks/useBacktest.ts:9-17`) unchanged — `RunBacktest` is fully synchronous (compute → persist →
ledger-emit → return within the one RPC, no job queue, confirmed in recon), so no polling/async-job
UI is needed.

### FR-10 Backfill

`ListBackfillJobs(symbol=X)` (already has a server-side `symbol` filter — corrected from the
product-spec's original wrong citation of `GetBackfillStatus`, a single-job lookup with no symbol
param) reduces the returned jobs' date ranges into a display summary client-side. New
`e2e/fixtures/backfillJobs.ts` fixture home (C-12, generalizing the existing inline `runningJob()`
factory in `e2e/insights/backfills.spec.ts`), registered in `INVENTORY.md`.

### FR-14 valuation parity + the `GetPosition` account_id fix (in-scope side-fix)

Recon found a pre-existing, latent bug: `GetPosition` (`portfolio_service.go:462-469`) never passes
`req.GetAccountId()` to the repo, unlike `ListPositions` (`:481`), which does — for a multi-account
user, `GetPosition` today silently returns whichever account's position was most-recently-opened,
ignoring which account was actually asked for. **Fixed in-scope**, as this feature's first backend
step: extend `PortfolioRepo.GetPosition` (`portfolio_repo.go:61-67`) to accept `accountID` and add a
conditional `account_id=$4` predicate mirroring `ListPositions`'s existing conditional-predicate
builder (`:90-92`); thread `req.GetAccountId()` through the service call site. **Paired regression
test (C-08)**: a Go test seeding two positions for the same `user_id+symbol+trading_mode` but
different `account_id`s, asserting `GetPosition` returns the one matching the requested account, not
merely the most-recently-opened row. Chosen in-scope rather than deferred to `/sdd-triage` because
it's the same call chain this feature already touches, and FR-14's three-way parity acceptance
criterion (this page vs. Exposure vs. Portfolio) would otherwise be unverifiable for a multi-account
user.

### Consumer surface (C-14)

UI only, `/trader` segment — the single route `/trader/positions/[symbol]` is the entire consumer
surface. No Agent tool. `/insights/market/[symbol]` remains reachable only as a redirect target (for
old bookmarks/external links), not a distinct surface.

---

## Rejected Alternatives

- **New route (e.g. `/trader/symbols/[symbol]`) with all three source pages redirecting** —
  considered in rounds 1 and 2 for cleanliness and to avoid retrofitting a page "built
  position-first"; rejected once round 4's page-structure fix (sections gate independently of
  position, not the whole page) removed the actual problem this alternative was solving. Extending
  `/trader/positions/[symbol]` in place preserves every existing inbound deep link with zero
  redirect hops.
- **Middleware-based redirect** (`middleware.ts`, which already does `NextResponse.redirect`) for
  `/insights/market/[symbol]` instead of a page-level Server Component `redirect()` — rejected: adds
  symbol/query-forwarding logic to a file with broader blast radius (governs auth on every route) for
  a need a page-level `redirect()` already handles with a proven, narrower precedent
  (`app/page.tsx:1-5`).
- **Reusing `ScreenResult.gap`/`criterion_scores` as a "safe" single-symbol screening display**
  (round 1) — rejected as factually wrong: `gap` is an unrelated backfill date-range field, and
  `criterion_scores` is built from the *same* broken universe-relative normalization the mitigation
  claimed to avoid. Replaced with genuine additive proto fields.
- **Additive `symbol` field on `ListBacktestsRequest`** (recon option (b)) for FR-9 — considered as
  the more complete backtest-to-symbol mapping (covers every strategy that included the symbol, not
  just the watchlist-bound one); rejected in favor of the zero-backend-change client-side filter
  (option (a)) per "write the minimum that solves the stated problem," with the fuller option
  recorded as a named follow-up rather than built now.
- **Dual-registering every needed RPC in `traderBff.ts`** — recon's own original recommendation
  (`recon.md:156-158`, "all through `traderBff.ts`...") and independently the adversary's recommended
  default; rejected by explicit user decision at the round-5 gate in favor of the leaner,
  already-proven-safe cross-segment client reuse (see Chosen Approach § BFF wiring) — an explicit
  trade of `/trader` BFF self-containment for less duplicated registration surface.
- **`GetPosition` account_id fix deferred to a separate `/sdd-triage` bug fix** — rejected: the same
  call chain this feature already touches, and FR-14's own acceptance criterion depends on it.
- **096's original all-or-nothing position gate** (full-page `EmptyState` on not-found, everything
  else gated on `position`) — rejected once recon/round-4's adversary confirmed it would make the
  feature's headline new sections unreachable for exactly the audience (unheld/watchlist-research
  symbols) they exist to serve.

## Open Risks

- [ ] **Opportunity-selection tie-breaking when a symbol has multiple watchlist-relevant
  `Opportunity` rows** (different strategies) is not fully specified — `insights/market/[symbol]`'s
  existing logic (`matches.find(o => o.strategyId === threadedStrategy) ?? matches[0]`) should be
  replicated for the unified page's Opportunity/conviction header, but this design does not pin down
  whether it is. To be resolved at `/sdd-spec` for the Opportunity section step, or explicitly
  confirmed as "first match" if simpler is acceptable.
- [ ] **Chart-hoist caption/meta-line refactor is an enumerable, must-not-miss diff** (~6
  `position.`-reading references in the chart `Card`'s caption/meta lines must all be changed to the
  top-level `avg`/`stop`/`hasStop` locals) — flagged as a step-level checklist item for
  `implementation-spec.md`, not a further design decision, but recorded here so it isn't lost between
  design and spec.
- [ ] **Cross-segment client reuse is a genuine architecture exception**, not (yet) a broadly-adopted
  pattern — the `services/xstockstrat-ui/CLAUDE.md` amendment (Chosen Approach § BFF wiring) must
  land in the same PR as the code that relies on it, or a future reader/reviewer has no written
  justification for why this page's hooks look cross-segment. Target: the same step that wires the
  first reused cross-segment hook.
- [x] ~~FR-9's narrower backtest coverage~~ — **Done**: reflected in product-spec.md's FR-9/AC-6
  wording in the same session as this design.
- [ ] **Performance/UX of an always-fully-rendered composite page** (7+ sections, each firing its own
  RPC, on every visit regardless of position) was named by round 4's proposer as a risk but not
  stress-tested in this design debate — each section reuses an already-cheap, already-existing RPC,
  so the risk is judged low, but flagged as a named QA check before launch rather than assumed away.
- [ ] **`e2e/insights/signal-detail.spec.ts` needs relocation/rewrite, not a re-run (round 6, real
  gap).** This spec asserts almost entirely on `insights/market/[symbol]`'s own page-shell markup
  (the Queue back-link, opportunity action badge, CONVICTION/Edge(BT) header stats) — markup that
  lives in the page this design deletes, not in `SignalReadiness.tsx`. Once that page becomes a pure
  redirect, most of this spec's assertions target markup that no longer exists at the new URL in the
  same form; "re-run existing coverage" (the original framing) is insufficient — it needs to be moved
  and rewritten against `/trader/positions/[symbol]`, verifying both the header enrichment and the
  readiness panel render correctly at the new route. Target: the implementation step that deletes
  `insights/market/[symbol]/page.tsx`.
- [ ] **`SignalReadiness`'s new NotFound branch needs its own paired test, not just old-coverage
  re-run (round 6).** Mirror `useBacktestDetail`'s existing dedicated NotFound assertion
  (`e2e/insights/backtest-coverage.spec.ts:189-197`, the `run-detail-empty` testid pattern) — a new
  test asserting the "This strategy no longer exists" message actually renders for a stale
  `?strategy=` param, not merely a re-run of pre-existing (and, per the item above, largely
  page-shell-scoped) coverage. Target: the same step as the `useReadiness`/`SignalReadiness` fix.
- [ ] **`nextjs-frontends.md`'s footnote must land alongside a fix to the stale text it sits next to,
  not beside it (round 6–7, orchestrator decision recorded above).** The surrounding "two BFF
  files"/nginx-forwarding paragraph (`nextjs-frontends.md:280-298`) is a pre-existing, already-
  recorded ledger fail (`fails.md` 2026-08-05, `ui-consolidation-nextjs`) that remains unfixed today.
  Touching this file also triggers root `CLAUDE.md`'s Teardown obligation (`/context-scrubber scan`)
  before the PR ships. Target: the step that adds the cross-reference footnote must correct the
  adjacent stale text in the same edit and run the Teardown scan.

## Constitution Rules Touched

- **C-01** (zero-assumption / evidence-cited) — honored: every claim in this design cites `recon.md`
  path:line evidence; **three** factually-wrong claims surfaced during the debate and were caught and
  corrected before approval, not shipped — round 1's "reuse gap/threshold" (wrong field), round 3's
  "listBacktests is dual-registered" (grep-false), and round 5→6's "no other section has NotFound
  semantics" page-wide-sweep claim (missed `EvaluateReadiness`'s real `NOT_FOUND` path) — the last one
  caught only because the user-extended round 6 re-ran the sweep instead of trusting the prior
  round's self-report.
- **C-08** (test-step pairing) — honored: the `GetPosition` account_id fix is paired with an explicit
  Go regression test named in the Chosen Approach, not left implicit.
- **C-09** (proto verification) — honored: the additive `ScreenResult` fields require `buf lint`/
  `buf breaking`/`./scripts/buf-gen.sh`, explicitly named as a hard predecessor step to the UI work
  that consumes the generated symbols.
- **C-10(a)** (nav reachability) — honored: both duplicated `/insights/market` nav special-cases
  (`PlatformHeader.tsx`, `BottomTabBar.tsx`) are deleted together, with a two-surface reachability
  test — the debate caught the second, mobile-only duplicate that a single-surface fix would have
  missed.
- **C-10(b)** (valuation parity across read paths) — honored: FR-14's three-way parity requirement
  (this page / Exposure / Portfolio) is what surfaced the `GetPosition` account_id gap; the fix keeps
  parity honest for multi-account users rather than leaving a known gap in the exact path this
  feature's own acceptance criterion depends on.
- **C-12** (frontend test fixtures) — honored: new fixture homes named for fundamentals and
  backfills (both currently absent/uncentralized); the new `ScreenResult` scenario data extends the
  existing canonical fixture rather than creating a redundant one.
- **C-14** (consumer surface named) — honored: `/trader` is the explicit, sole consumer surface;
  Agent is explicitly marked not applicable.
- **F-04** (never invent a path/symbol) — honored: every recon "Not found" stayed a named gap
  (fundamentals fixture absence, no watchlist-membership RPC, `ListBacktestsRequest`'s missing symbol
  field) rather than an invented citation; the debate's own self-correction of two false citations
  (round 1, round 3) is this rule operating as designed.
- **F-11** (Floor rejection halts) — honored trivially: no Floor breach was flagged by any adversary
  in any of the 7 rounds (5 to the design skill's normal cap, 2 more under the user's explicit
  override).

---

# Design Addendum — FR-6 Indicator Overlay Panels (2026-08-15)

**Created**: 2026-08-15
**Rounds**: 3 (full mode — user escalated from `quick` to full after round 1; min 2, cap 5; termination:
approved by user @ 2026-08-15). **Grounded in**: recon.md § "Recon Addendum — FR-6 Indicator Overlay
Panels (2026-08-15)".
**Scope**: this addendum covers ONLY the FR-6 amendment (indicator overlay chart panels). The original
7-round design above is unchanged.

## Chosen Approach (FR-6)

### New dedicated RPC `AnalysisService.GetIndicatorSeries` — not widening `EvaluateReadiness`

A new **additive** RPC on `AnalysisService`, with a NEW handler method peer to `EvaluateReadiness`
(`services/xstockstrat-analysis/app/handlers/servicer.py:1959`). It reuses that handler's proven
skeleton — build `propagation_meta` (`servicer.py:1963-1967`), guard `self._strategies_repo is None`
→ `UNAVAILABLE`, resolve the strategy via `self._strategies_repo.get_by_id` +
`_row_to_strategy_definition` (`servicer.py:1971-1977`), instantiate its own
`StrategyEvaluator(self._indicators, propagation_meta)` (`servicer.py:1978`) — but **diverges on one
decisive point**: instead of calling `evaluate_conditions_traced`, the handler runs its OWN loop over
`definition.components`, calling `evaluator._compute_component(comp, closes)` directly
(`evaluator.py:215-292`).

**Why a dedicated RPC and not widening `EvaluateReadiness` (round 2 → round 3 reversal).** Round 2
proposed adding `include_component_series` to `EvaluateReadiness` for "parity by construction." Round
2's adversary verified the load-bearing facts were true (the full `component_series` dict is already
built unconditionally at `evaluator.py:201-207`; the handler's missing try/except is a real
pre-existing crash bug) — but found a disqualifying flaw: `evaluate_conditions_traced` is **shared
with `ListOpportunities`** (launched feature 097's exit-rule trace on held positions, call site
`servicer.py:2207`). Any per-component fault-isolation added inside that shared method silently
changes live exit-signal semantics — a failed/omitted component resolves via `_resolve_term`→`None`→
`CONDITION_STATE_UNSPECIFIED` (`evaluator.py:512-517,554-555`), which can suppress `exit_fires` for a
held position with no visible error to the trader. A dedicated handler's try/except + semaphore live
in **its own** method and are structurally incapable of reaching the `ListOpportunities` path — that
isolation is the entire reason for the choice (user decision at the round-2 gate).

### Bar source — client supplies the candlestick's own closes+times (no server-side re-fetch)

`GetIndicatorSeriesRequest{ strategy_id, symbol, repeated double closes, repeated google.protobuf.Timestamp times }`
— **no `TimeRange`**. The page captures the exact bars it already fetched for the candlestick chart
and passes their `closes` and `times` to the RPC; the server runs `_compute_component` on those
supplied closes and zips aligned outputs against the supplied `times`. It does **not** fetch bars.

- **Round 3's option (b) ("client passes the same `TimeRange`, server re-fetches") was rejected on a
  verified false premise**: `/trader/positions/[symbol]/page.tsx:84-91` fetches bars via
  `page: { pageSize: 200 }` (a **count**), not a `TimeRange`, and discards the bars after
  `series.setData` (only `barsError` survives in state). There is no `TimeRange` to reuse.
- **Verified safe (round-3 adversary)**: `_compute_component` consumes **only** `closes` — the
  builtin path passes `values=closes` and nothing else (`evaluator.py:227-234`); the custom-formula
  path builds `input_data` from `{"close": closes}` only (`evaluator.py:237-238`), never high/low/
  volume. This is identical to what `evaluate_with_series` (`evaluator.py:142`) and
  `evaluate_conditions_traced` (`evaluator.py:200`) already feed it — so a formula that reads
  `data["high"]`/`data["volume"]` is *already* under-served in backtest/live today (a pre-existing
  platform property, out of 125's scope), and option (a) preserves exact parity with what backtest
  computes.
- **Benefit**: structural x-axis parity by construction (identical bars feed both the candlestick
  chart and the panels), zero second bars fetch, and it matches the platform's existing
  caller-supplies-`values` model (`ComputeIndicatorRequest.values` is caller-supplied,
  `indicators.proto:45`). The positions page must add small new state to retain the fetched bars
  (today it discards them, `page.tsx:96`).

### Response shape — null-safe, all-series-per-component, server-owned timestamps

`GetIndicatorSeriesResponse{ repeated google.protobuf.Timestamp times, repeated ComponentSeries components }`;
`ComponentSeries{ string ref_name, ComponentKind kind, repeated NamedSeries series, string error }`;
`NamedSeries{ string name, repeated google.protobuf.DoubleValue values }`. Requires
`import "google/protobuf/wrappers.proto"` in `analysis.proto`.

- **Null-safe encoding (`google.protobuf.DoubleValue`, not `repeated double`).** proto3 `repeated
  double` cannot represent null — a warm-up-head `None` or a custom-formula mid-series `None` would
  round-trip to a fabricated `0.0`, violating AC-4a ("no fabricated/placeholder series"). `DoubleValue`
  gives native presence; `None → unset DoubleValue`, a finite float → `DoubleValue(value=x)`. Chosen
  over a parallel bool present-mask (two arrays that can desync) and a per-point `{time,value,has_value}`
  triple (repeats timestamps N×). **Verified (round-3 adversary)** the `None` representation is real,
  not `NaN`/`0.0`: builtin warm-up head is `[None]*n` filled only at the tail (`align_indicator_points`,
  `evaluator.py:308-316`); custom-formula gaps pass through `_finite_or_none` which maps
  `None`/`NaN`/`Inf`/non-numeric → `None` (`evaluator.py:39-45`, applied at `:283`).
- **Every emitted series per component is carried** — `ComponentSeries.series` = one `NamedSeries` for
  the primary `"value"` plus each secondary the component emits (`bb.upper`/`bb.lower`,
  `macd.signal`/`macd.histogram`, `stoch.d`, or custom-formula output keys) — exactly the `series_map`
  keys `_compute_component` returns (`evaluator.py:58-67,268-291`; `IndicatorPoint.extra` per
  `indicators_engine.py:75-133`). A panel renders all of a component's lines; no sub-series is dropped
  (FR-12/P-03).
- **Server owns per-point timestamps** — `IndicatorPoint.time` is never set by the indicators service
  (`indicators.proto:59` populated nowhere; `servicer.py:66-71`), so the response's shared `times`
  array is the client-supplied bar timestamps, index-aligned across every series.

### Per-component fault isolation

Each `_compute_component` await is wrapped in `try/except (FormulaExecutionError, Exception)` **inside
the new handler's own loop**. On failure that component's `ComponentSeries` is returned with a
populated `error` string and empty `series` → the UI renders a per-panel error/no-data state; the RPC
still succeeds and every other component's panel renders. One bad custom-formula component
(soft-deleted formula, sandbox timeout, NaN output — `evaluator.py:252-291` raises
`FormulaExecutionError`) never takes down the whole section. This changes **only** the new handler,
never the shared `evaluate_conditions_traced` (so `ListOpportunities` is untouched).

### Concurrency — process-lifetime singleton semaphore

`self._component_series_sem = asyncio.Semaphore(max(1, self._cfg.get_int("analysis.series.max_concurrent_components", 4)))`
constructed once in `AnalysisServicer.__init__` (`servicer.py:117`, confirmed boot-once via
`main.py:59-69`), acquired via `async with` in the handler loop around each `_compute_component`
await (release-safe on exception). Because the handler loop is sequential (no `asyncio.gather`), the
singleton bounds **cross-request** concurrency — total in-flight `ComputeIndicator`/`ExecuteFormula`
across simultaneous page loads — the live-loop-starvation guard recon flagged, mirroring
`ScreenerEngine`'s intent (`screener.py:84-86`) but as a genuine process-lifetime singleton rather
than a per-request instance. It threads through **no** `StrategyEvaluator` call site (all 5 untouched).

- **`max(1, …)` clamp is mandatory (round-3 adversary)** — both sibling semaphores use it
  (`screener.py:84-85`, `entry_backfill.py:54-55`); dropping it means a negative config value reaches
  `asyncio.Semaphore(-n)` → `ValueError` and a `0` would deadlock the handler. `get_int`'s zero-trap
  covers config `0`→default, but the clamp covers negatives.
- **Config key `analysis.series.max_concurrent_components`** (int, default 4) — new `analysis.series.*`
  category (not `analysis.readiness.*`: this is not readiness; not `analysis.indicators.*`: collides
  in spirit with the `xstockstrat-indicators` service's own `indicators.sandbox.*` namespace). Needs a
  `services/xstockstrat-analysis/CLAUDE.md` § Config Keys row + a per-feature registered-keys entry in
  `docs/patterns/config-governance.md` (C-05).

### Parity test — evaluator-level, not cross-RPC (round-3 adversary correction)

**C-10(b) parity is proven at the evaluator/unit layer, NOT by a cross-RPC assertion.** The naive
"assert `GetIndicatorSeries`'s last-bar primary value == `EvaluateReadiness`'s `ConditionEval.lhsValue`
for the same ref" is **flaky by construction** under the chosen bar-source: `GetIndicatorSeries`
receives the client's candlestick closes (a `pageSize:200` count) while `EvaluateReadiness` fetches
its **own** bars internally via `_recent_range(_READINESS_LOOKBACK_DAYS)` → `_fetch_bars_paged`
(`servicer.py:1979,1983`) — a different-length set. For a path-dependent indicator (EMA/RSI/MACD/ATR —
recursive/Wilder seeding) the last-bar value over a different-length `closes` **legitimately differs**,
so the assertion tests bar-fetch equivalence, not computation parity. **The real invariant** ("same
`closes` → same series") is proven by a Python unit test feeding one fixed `closes` fixture through
both code paths (or feeding both RPCs an identical controlled bar set), discharging the C-10(b)
obligation deterministically. This is the ledger-056 "two paths drift apart" lesson applied correctly
rather than nominally cited.

### Rendering

Stacked `recharts` `ChartContainer`+`LineChart` panels (`FormulaRunResult.tsx:43-88` — the proven
in-repo stacked-independent-chart pattern), one panel per `ComponentSeries`, drawing every
`NamedSeries` in that component's panel as its own `<Line>`. `isLoading` skeleton gating
(`SignalReadiness.tsx:64-71`'s existing per-section pattern; **no** Suspense — `useSuspenseQuery` has
zero usages anywhere in the codebase). Explicit no-data state for zero declared components, an
unresolvable strategy, or a per-component `error`. The UI calls the new RPC through the already-bound
`analysisClient` (`baseUrl: '/insights/api'`) under **this feature's already-approved cross-segment
sanctioned exception** — no new `traderBff.ts` registration, and `xstockstrat-indicators` is not
called by the UI at all (reached only transitively, server-side, through the new analysis RPC).

- **Not a `lightweight-charts` second pane** — the sanctioned `useCandlestickChart` hook has no
  sub-pane/second-series infrastructure (recon: zero `addLineSeries`/`priceScaleId` usage anywhere),
  and `FormulaRunResult.tsx` is a proven working stacking analog. Kept the candlestick on
  `lightweight-charts` (its own sanctioned exception) and stacked recharts panels beneath it.

### Strategy resolution & no-data (inherited, not re-argued)

The strategy whose components are charted follows FR-6's existing precedence (watchlist binding, else
the strategy picker's current selection) — unchanged from the already-approved design; this addendum
only decides how a series is computed once a `strategy_id` is in hand. No resolvable strategy → skip
the RPC, show the no-data state (mirrors FR-9/AC-6's existing pattern, no new rule).

## Rejected Alternatives (FR-6)

- **Widen `EvaluateReadiness` with `include_component_series`** (round 2's recommendation) — rejected
  round 3: `evaluate_conditions_traced` is shared with launched `ListOpportunities` (`servicer.py:2207`),
  so its fault-isolation change would silently alter held-position exit-signal semantics. A dedicated
  handler is structurally isolated. (The round-2 finding that the series dict is *already computed*
  there remains true and is why the dedicated handler can reuse `_compute_component` cheaply — it just
  does so in its own loop.)
- **UI directly orchestrates `ComputeIndicator`/`ExecuteFormula` per component** (round-1 Option A,
  the recon "obvious" path) — rejected: duplicates `_compute_component`/`align_indicator_points`
  alignment logic in TypeScript (the ledger-056 "two paths drift apart" trap, for computation logic)
  and inherits the unenforced `indicators.sandbox.max_concurrent` gap into a browser-triggered
  page-load path with zero server-side throttle.
- **Server re-fetches bars from a client `TimeRange`** (round-3 option (b)) — rejected on a verified
  false premise (the candlestick fetches by `pageSize` count, not a `TimeRange`) and because
  `_compute_component` needs only closes, so a re-fetch buys nothing and introduces a differently
  windowed bar set (the source of the parity-test flake).
- **Reuse `RunBacktest`'s `BarDiagnostic.indicators` per-bar map** via a dry-run trigger — rejected:
  re-runs a full trade simulation (P&L, `backtest_runs` history writes, ledger events) merely to render
  a chart on every page view — far more expensive and side-effecting than a read.
- **`repeated double` with a NaN/sentinel for gaps** — rejected: proto3 `repeated double` cannot carry
  null, and `MessageToDict`/JSON round-trips reject `NaN`; a `0.0` sentinel fabricates a data point
  (AC-4a violation). `DoubleValue` is the null-safe choice.

## Open Risks (FR-6)

- [ ] **Uncapped component fan-out (NEW — supersedes the original design's "each section reuses a cheap
  existing RPC" risk call for FR-6).** `StrategyDefinition.components` has no server-enforced count cap
  (`analysis.proto:252`). `GetIndicatorSeries` is an N-fan-out, sandbox-subprocess-backed compute, not
  the cheap existing-RPC the original 7-round design's Open Risks assumed (`design.md` above,
  Performance/UX risk). Mitigations: single-strategy scope (only the resolved strategy's own declared
  components — no general indicator browser, per Out of Scope) and the
  `analysis.series.max_concurrent_components` semaphore bounds concurrent formula execution. But **panel
  count itself is uncapped** — a pathological strategy yields many semaphore-serialized computes and
  many stacked panels. Named QA check before launch (matches the original design's own
  performance-Open-Risk posture); a hard component cap is a candidate follow-up, not built here.
- [ ] **`/sdd-spec` must confirm the `Bar` timestamp attribute name.** `marketdata.proto:46` names it
  `time`; `evaluator.py:105`'s docstring says `.timestamp`. The client reads bar timestamps to populate
  the request `times`; `/sdd-spec` verifies the actual generated field before citing it. (Not
  design-blocking — a naming confirmation.)
- [ ] **Paired tests beyond parity (C-08).** The new `service` step must pair Python tests for: the
  evaluator-level parity invariant (above), per-component fault isolation (one component raises →
  populated `error` + empty series, RPC still OK), and the `None → unset DoubleValue` mapping. Flagged
  for `/sdd-spec`'s test-step pairing.

## Constitution Rules Touched (FR-6)

- **C-01** (evidence-cited) — honored: every claim cites recon/`path:line`; the round-3 bar-source
  correction (candlestick uses `pageSize`, not `TimeRange`) was grep-verified before adoption, and the
  false round-2 "parity by construction" premise was caught and corrected mid-debate.
- **C-05** (config naming) — honored: `analysis.series.max_concurrent_components` follows
  `<service>.<category>.<key>`; default declared in `xstockstrat-analysis/CLAUDE.md` + registered-keys log.
- **C-08 / P-06** (test-step pairing / red-before-green) — honored: the new RPC's `service` step pairs
  parity + fault-isolation + null-mapping Python tests (named as an Open Risk for `/sdd-spec`).
- **C-09** (proto verification) — honored: the additive `GetIndicatorSeries` RPC + 4 messages +
  `wrappers.proto` import require `buf lint`/`buf breaking`/`./scripts/buf-gen.sh` as a hard predecessor
  to the UI step (same governance shape as FR-8's `ScreenResult` additive fields already in this design).
- **C-10(b)** (parity across read paths) — honored: the overlay series and Readiness's `lhsValue` both
  derive from `_compute_component`; proven at the evaluator/unit layer with a fixed-closes fixture
  (cross-RPC assertion rejected as flaky under different bar windows).
- **C-14** (consumer surface) — honored: `/trader` remains the sole surface; no Agent tool.
- **F-11** (Floor halts) — honored: no Floor breach flagged in any of the 3 FR-6 rounds.

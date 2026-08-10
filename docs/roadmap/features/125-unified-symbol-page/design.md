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

# Implementation Spec: fix-symbol-page-alerts-ui

**Status**: `pending`
**Created**: 2026-11-15
**Feature**: `docs/roadmap/features/339-fix-symbol-page-alerts-ui/feature.md`
**Total Steps**: 15
**Feature Branch**: `feature/fix-symbol-page-alerts-ui`

---

Paths: `ui/` abbreviates `services/xstockstrat-ui/`, and `page.tsx` means
`ui/src/app/trader/positions/[symbol]/page.tsx`. Every `path:line` below was read on the tree
`feature/fix-symbol-page-alerts-ui@0442d300d`. `origin/main-dev@d1c97273b` is 4 commits ahead of it;
those commits change no source file under `ui/` (two `ui/docs/` files only), so the line numbers
hold. Symbols marked **new** do not exist today and are created by the step that names them.

## Execution Summary

All fifteen steps are in `xstockstrat-ui`. There is no proto, migration, config key, env var or BFF
route change: the notify RPCs the drawer needs are already on the trader BFF
(`ui/src/lib/traderBff.ts:97,104,115`).

The order follows the design's build order (design.md § Chosen Approach):

1. **Steps 1-2** — the `StatTile` wrap guard, which fixes the overflow for all three symbol-page
   grids at once.
2. **Steps 3-6** — the compact USD formatter, then the Fundamentals card redesign that uses it.
3. **Steps 7-8** — the opportunity chip label.
4. **Steps 9-10** — the stock `shadcn/tailwind.css` import, which makes the state variants of the
   shadcn primitives resolve (switch, checkbox and the other shared components).
5. **Steps 11-15** — the Alerts drawer: pure helpers first, then the e2e groundwork that changes no
   behaviour, then the drawer and its scenarios. This block lands before peer feature 344.

Each code step is paired with a test step and the pair is one atomic unit, because the test either
imports a symbol the code step creates or is the only thing that proves the code step. Step 13
stands alone.

**Consumer surfaces (C-14).** The product spec names three UI surfaces and no Agent tool:

- Trader symbol page `/trader/positions/<symbol>` — Steps 1, 5 and 7.
- Header Alerts drawer and bell — Step 14.
- The shared switch on `/accounts/notifications`, `/config-ui/fundamentals-scan` and
  `/insights/signal-sources` — Step 9. One stylesheet import serves all three pages (C-10), the
  shared checkbox, and every page that renders the other shared primitives (FR-11).

No new page or route is added, so no `PLATFORM_SUBNAV` registration is needed.

**Spec amendments made by this session (design.md D-25).** The design required three edits before
`/sdd-spec`; they were not yet made, so this session made them: `product-spec.md` gained FR-10 and
lost the "mark all read" exclusion from § Out of Scope, and `acceptance.feature` gained `@AC-10`.

**Spec amendments made by the Steps 9-10 re-spec (operator sanction, 2026-11-15).** `product-spec.md`
FR-9 now names the checkbox and gained FR-11 (state styling of the other shared primitives);
`acceptance.feature` gained `@AC-11` and `@AC-12`.

**Still open, carried from design.md § Open Risks.** None blocks this spec.

- O-12 is answered (operator, 2026-11-15: "Yes, fix the primitives. Use the switch component from
  Shadcn."; `context.md` § operator answers). It supersedes design D-4 and reopens R-4, and Steps
  9-10 are re-specified to it: the component files stay stock and `globals.css` imports the stock
  `shadcn/tailwind.css`. The operator added the full stylesheet to scope ("No, add it to the
  scope", answering whether to adopt it later as a separate feature) and asked for a checkbox
  scenario ("Yes"). `design.md` § 4 and `debate.md` still describe D-4, R-3 and R-4.
- From the Steps 9-10 re-spec: the import also draws separator lines, the navigation-menu trigger
  state and the accordion background, and hides the sidebar scrollbar. The operator's list did not
  name these; Step 9 has them announced at the first execute checkpoint.
- O-24: the Clear all scope (capped drain, no confirm, no undo) rests on a relayed reading of the
  operator's "less friction". This spec follows the approved design (D-20, D-21).
- The operator's four-item reply ("Approved", "Confirmed", "Sign-off the change, amend it", "There
  are no production instances. Staging is enough.") does not say which question each item answers.
  Only the approval is relied on here. If "Staging is enough" refers to the post-merge smoke test,
  it is run on staging only; no step depends on that reading.

**Operator questions `/sdd-execute` must ask (C-11).** The reply above was relayed again to the
impl-spec review and still could not be mapped to O-12 or O-24. O-12 has since been asked and
answered directly, so the Steps 9-10 unit has no gate question. The O-24 entry below stands as the
impl-spec review wrote it. `/sdd-execute` puts the question to the operator in the confirmation it
already shows before writing a unit, and records the answer in `context.md`:

- **Before the Steps 11-12 unit — O-24.** "Clear all marks every unread alert read on the server,
  up to 1000 per click, with no confirm and no undo, including alerts beyond the 50 listed.
  Confirm, or choose listed-only with a 'showing 50 of N' line?" A confirmation runs Steps 11-15
  as written. Listed-only is the design's unlocked fallback and needs a re-spec of Steps 11, 12,
  14 and 15 first (`drainUnread` and its notices go away).

## Scenario Coverage (C-15)

| Scenario | Step(s) | How |
|---|---|---|
| `@AC-1` | 2, 4, 6 | Step 2: the market cap fits its tile at 384px for both example values. Step 4: the compact value. Step 6: the redesigned card (groups, compact market cap, label above value). |
| `@AC-2` | 8 | Vitest on `opportunityChipLabel`, and the chip row at mobile width. |
| `@AC-3` | 15 | Stored unread alert listed, read one not listed, inbox shows 1 unread. |
| `@AC-4` | 15 | Per-row mark-read empties the drawer and badge; the inbox row is read. |
| `@AC-5` | 12, 15 | Step 12: newest-first ordering in `mergeUnread`. Step 15: the streamed alert raises the badge and lists first. |
| `@AC-6` | 10 | Vitest guard on the compiled CSS selectors, and the thumb at the trailing end in the browser. |
| `@AC-7` | 10 | The thumb at the leading end when unchecked. |
| `@AC-8` | 2 | The cost basis value fits its tile at 384px. |
| `@AC-9` | 12, 15 | Step 12: `mergeUnread` de-duplicates on `alertId`. Step 15: one row and badge "1". |
| `@AC-10` | 12, 15 | Step 12: `drainUnread` outcomes (`done`, `capped`, `error`). Step 15: Clear all end to end. |
| `@AC-11` | 10 | Vitest guard on the compiled checkbox selector, and the login checkbox changing its fill when checked. |
| `@AC-12` | 10 | Vitest guard on the compiled selectors, one per variant family and the `no-scrollbar` utility; the selected tab's background in the browser. The other rows have no browser proof. |

## Step Dependencies

- Steps 1+2 land together: Step 2 is the only proof of Step 1, and the design requires the
  mobile-overflow assertion in the same commit as the fix (fails.md, feature 083).
- Steps 3+4 land together: Step 4's test imports `fmtUsdCompact`, which Step 3 creates (§C: a test
  that references a symbol a later step creates).
- Step 5 requires Step 3: `FundamentalsSection` calls `fmtUsdCompact`.
- Steps 5+6 land together: Step 6's assertions on the group headers and the compact value pass only
  with Step 5, and Step 5 has no other proof.
- Step 6 requires Step 2: it extends the spec file and reuses the `FUNDAMENTALS_LYFT` fixture
  Step 2 creates.
- Steps 7+8 land together: Step 8's test imports `opportunityChipLabel`, which Step 7 creates.
- Step 8 requires Step 2: it extends `ui/e2e/trader/symbol-page-display.spec.ts`.
- Steps 9+10 land together: Step 10 adds a compiled-CSS guard and e2e assertions that are red until
  Step 9, and Step 9 has no other proof.
- Steps 11+12 land together: Step 12's test imports the three helpers Step 11 creates.
- Step 13 stands alone and changes no behaviour. It must land before Step 14: without the mock's
  `unreadOnly` branch the feature-270 reconnect test (`ui/e2e/trader/stream-reconnect.spec.ts:105-133`)
  loses its streamed rows when the drawer opens.
- Step 14 requires Step 11 (the helpers) and Step 13.
- Steps 14+15 land together: Step 14 turns two tests in `ui/e2e/trader/alert-stream.spec.ts`
  (`:31-45`, `:69-82`) red, and Step 15 rewrites that file.
- Every unit is two adjacent steps on the ui surface.
- Peer feature 344 (`alert-detail-page`) lands after Step 15. It must derive the value under its
  `ALERT_UNREAD_COUNT_KEY` from the merged, de-duplicated unread list, and invalidate it on
  mark-read and Clear all (design.md § Feature 344 coordination).
- Peer feature 340 (`fix-fundamentals-roe-unit`) edits `page.tsx:1095`, which Step 5 rewrites. A
  textual merge conflict is expected; whichever lands second resolves it.

**Running e2e in the execute sandbox.** A full Playwright run is impractical there (fails.md,
2026-08-10, feature 126). Every e2e command below is scoped:
`pnpm exec playwright test <file> --project=chromium --no-deps`, after pre-warming only the routes
the spec visits. If even the scoped run times out, the fallback is
`pnpm exec tsc --noEmit && pnpm run lint && pnpm exec playwright test <file> --list`.

The fallback is not a pass. It proves neither layout nor DOM state, so a step that used it records
a Deviation Log row headed **unverified AC** that names every scenario left unproven, and announces
it at the checkpoint:

- e2e is the only proof of `@AC-3`, `@AC-4`, `@AC-7` and `@AC-8`.
- e2e is the only browser proof of `@AC-11` and of the tab row of `@AC-12`; their Vitest halves
  still count.
- e2e is the only browser proof of the layout or DOM half of `@AC-1`, `@AC-2` (including the
  Step 7 chip wiring at `page.tsx:444`) and `@AC-6`, and of the end-to-end half of `@AC-5`, `@AC-9`
  and `@AC-10`. Their Vitest halves still count.

The red-before-green record for that step's e2e assertions is "not captured" in the same row. Each
named scenario stays unverified until its spec file is green in a real Playwright run: a local run,
or the `frontend-e2e` CI job on the PR (`docs/patterns/ci-overview.md`). The row is closed only
then, and any row still open is announced at session end and in the integration PR description.

---

### Step 1 — service: `StatTile` value wrap guard

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/shared/StatTile.tsx` — modify

**Reviewers**: `xstockstrat-ui` owner — Trading UI correctness, analytics display accuracy

**Codebase Evidence**:
- `ui/src/components/shared/StatTile.tsx:5-36` — `StatTile`. The tile is
  `border-r border-border px-4 py-3 last:border-r-0` (`:19`). The value div is
  `mt-1 font-mono font-semibold tabular-nums` with `text-2xl`/`text-xl` (`:21-31`) and renders
  `{value}` with no wrap guard. `value` is `string | number` (`:13`).
- All three symbol-page grids render it: `page.tsx:842-846` (position stats), `:901-…` (position
  risk), `:1120-1124` (Fundamentals). Each is `grid grid-cols-2 … sm:grid-cols-N`, so the tracks
  are `minmax(0,1fr)` and unbreakable mono text overflows them.
- Six other consumers (`grep -rln StatTile ui/src`): `components/insights/PerformanceDashboard.tsx`,
  `app/trader/portfolio/page.tsx`, `app/trader/positions/page.tsx`, `app/insights/backfills/page.tsx`,
  `app/insights/strategies/page.tsx`, `app/insights/signal-sources/page.tsx`.
- `wrap-anywhere` is not used anywhere in `ui/src` today (**Not found** by grep). It is a Tailwind
  4 utility; the pin is `tailwindcss` 4.3.3 (`ui/package.json:80`).

**Lands with**: `Step 2`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. In `StatTile.tsx`, add `wrap-anywhere` to the value div's class list (`:22-24`). Do not add
   `min-w-0` (design D-10: it does nothing here).
2. Add a helper **new** `withCommaBreaks(value: string | number): React.ReactNode`, private to the
   file (not exported). For a string it returns the text with a `<wbr />` after each `,`; for a
   number it returns the value unchanged. Render `{withCommaBreaks(value)}` in place of `{value}`.
3. Change nothing else: no truncation or ellipsis (R-1), no new prop, no change to the tile div.

**Verification**:
The union with Step 2 (one commit). On its own this step must still pass:
```bash
cd services/xstockstrat-ui && pnpm run lint && pnpm exec tsc --noEmit
```

---

### Step 2 — test: `StatTile` render test and tile-fit e2e at 384px

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/shared/StatTile.test.ts` — create
- `services/xstockstrat-ui/e2e/fixtures/fundamentals.ts` — modify
- `services/xstockstrat-ui/e2e/fixtures/positions.ts` — modify
- `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md` — modify
- `services/xstockstrat-ui/e2e/trader/symbol-page-display.spec.ts` — create

**Reviewers**: `xstockstrat-ui` owner — Trading UI correctness, analytics display accuracy

**Codebase Evidence**:
- Vitest collects only `src/**/*.test.ts` in the `node` environment (`ui/vitest.config.ts:19-20`),
  so the render test is a `.test.ts` file and builds elements with `createElement`, not JSX.
- **Not found**: no test in `ui/src` uses `renderToStaticMarkup` or `createElement` today. A
  `.test.ts` importing a `.tsx` component already works (`ui/src/lib/opportunityShared.test.ts:5`).
  `react-dom` is `^18.3.1` (`ui/package.json:53`).
- `FUNDAMENTALS_AAPL` — `ui/e2e/fixtures/fundamentals.ts:13-30` (`marketCap: 3.02e12`). The mock
  `getFundamentals` returns data for AAPL only (`ui/e2e/mock-backend.ts:729-737`), so LYFT needs a
  per-spec stub.
- `POSITION_AAPL` — `ui/e2e/fixtures/positions.ts:15-38`; `POSITIONS` holds AAPL and MSFT only
  (`:134`), and the mock `getPosition` returns NotFound for any other symbol
  (`ui/e2e/mock-backend.ts:494-502`).
- RPC paths: `xstockstrat.marketdata.v1.MarketDataService/GetFundamentals` returns
  `GetFundamentalsResponse { fundamentals }` (`packages/proto/marketdata/v1/marketdata.proto:41,252-253`);
  `xstockstrat.portfolio.v1.PortfolioService/GetPosition` returns a `Position`
  (`packages/proto/portfolio/v1/portfolio.proto:13`).
- Existing stubs: `ui/e2e/trader/offline-pnl.spec.ts:26,164` stubs
  `**/xstockstrat.portfolio.v1.PortfolioService/GetPosition` via its local `routeJson` helper
  (`:28`), together with a `ListAccounts` stub (`:163`), then goes to `/trader/positions/TSLA`
  (`:166`) — the precedent for the `@AC-8` stub. `ui/e2e/insights/data-explorer.spec.ts:47,203`
  stubs `MarketDataPath('GetFundamentals')`. The JSON unary stub at
  `ui/e2e/trader/signal-confidence-ticket.spec.ts:42-50` is the same pattern.
- The Position panel is the first Trade panel (`page.tsx:357-371`), so it is the active mobile tab
  by default (`ui/src/components/trader/SymbolPanelGroup.tsx:27,34`).
- Auth helper: `addAuthCookie` — `ui/e2e/helpers/auth.ts` (used at
  `ui/e2e/trader/alert-stream.spec.ts:2`).
- `ui/e2e/trader/symbol-page-display.spec.ts` does not exist (`ls`).

**Lands with**: `Step 1`

**TDD**: `red-green required`

**Covers**: `AC-1, AC-8`

**Instructions**:
1. Create `StatTile.test.ts`. Render with
   `renderToStaticMarkup(createElement(StatTile, { label, value }))` and assert:
   - a string value `'$6,726,553,623.93'` yields markup with a `<wbr/>` after each comma, and the
     text content with tags stripped is the original string;
   - a number value renders without `<wbr`;
   - the value element's class contains `wrap-anywhere`.
2. Fixtures (C-12), each with an `INVENTORY.md` row:
   - **new** `FUNDAMENTALS_LYFT` in `fundamentals.ts`: `symbol: 'LYFT'`, `marketCap: 6726553623.93`,
     `peRatio: 41.2`, `source: 'fmp'`, `stale: false`, `asOf: '2026-11-13T21:00:00Z'` (Connect-JSON
     string, used in `page.route` bodies only), and plausible values for the other ratio fields.
   - **new** `POSITION_LYFT_WIDE` in `positions.ts`: `symbol: 'LYFT'`, `costBasis: 1234567890.12`,
     `currentPrice: 16.42`, `accountId: BROKER_ACCOUNT_ALPACA.id`, `tradingMode: 1`, and the other
     fields `POSITION_MSFT` carries. Do not add it to `POSITIONS`.
3. Create `symbol-page-display.spec.ts` with `test.use({ viewport: { width: 384, height: 844 } })`
   and a local helper that asserts a tile fits: locate the tile as the parent of the element whose
   exact text is the label, and the value as the tile's `font-mono` child; assert
   `value.scrollWidth <= value.clientWidth`, and that the value's bounding box lies inside the
   tile's and does not intersect the next tile's value box. The `scrollWidth` check is the one that
   is red today: the value div never grows, its text overflows it.
4. `@AC-1` — one test per example value. Stub `GetFundamentals` with
   `{ fundamentals: FUNDAMENTALS_LYFT }` and with `{ ...FUNDAMENTALS_LYFT, marketCap: 3.45e12 }`
   (a spread, exempt from C-12). Go to `/trader/positions/LYFT`, wait for the Fundamentals heading,
   and run the helper on "Market cap" against "P/E". Also assert, for every Fundamentals tile, that
   the label's box is above the value's box. Keep these assertions independent of how the value is
   formatted, because Step 5 changes the market cap to a compact form.
5. `@AC-8` — stub `GetPosition` with `POSITION_LYFT_WIDE`, go to `/trader/positions/LYFT`, and run
   the helper on "Cost basis". If the Position panel does not render from that stub alone, also stub
   `ListAccounts` as `offline-pnl.spec.ts:163-166` does.
6. Name each test with its `@AC-N`.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm exec vitest run src/components/shared/StatTile.test.ts \
  && pnpm run lint && pnpm exec tsc --noEmit \
  && pnpm exec playwright test e2e/trader/symbol-page-display.spec.ts --project=chromium --no-deps \
  && pnpm exec playwright test e2e/mobile-overflow.spec.ts -g "/trader/positions" \
     --project=chromium --no-deps
grep -n "from '../fixtures" e2e/trader/symbol-page-display.spec.ts
grep -n "FUNDAMENTALS_LYFT\|POSITION_LYFT_WIDE" e2e/fixtures/INVENTORY.md
```
RED before Step 1: the Vitest `<wbr/>` assertion fails and the two e2e `scrollWidth` assertions
fail. Not run in this session: whether the `GetPosition` stub alone makes the Position panel render
for LYFT (account selection may also matter; `offline-pnl.spec.ts:163-166` pairs it with a
`ListAccounts` stub). If it still does not render with both stubs, record a deviation.
Coverage: this step adds no `src/lib/**` code, so the 40% `src/lib/**` threshold
(`pnpm run test:coverage`, `ui/vitest.config.ts:29-33`) is unaffected; e2e runs and
`src/components/**` render tests are not coverage-gated.

---

### Step 3 — service: `fmtUsdCompact`

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/money.ts` — modify

**Reviewers**: `xstockstrat-ui` owner — Trading UI correctness, analytics display accuracy

**Codebase Evidence**:
- `ui/src/lib/money.ts:4-10` — `fmtUsd(n: number | undefined | null): string`, `—` for
  null/NaN, else `$` plus `toLocaleString('en-US', …)` with two fraction digits. It is shared by the
  trader Book screens (`:1`), so it stays unchanged (design D-2).
- **Not found**: no compact USD formatter in `ui/src/lib`. Do not copy the local `fmtUsd` at
  `ui/src/components/insights/PerformanceDashboard.tsx:46` (recon.md § Patterns to REUSE).

**Lands with**: `Step 4`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
Add **new** `export function fmtUsdCompact(n: number | undefined | null): string` directly below
`fmtUsd`. It uses the same null/NaN guard (returns `—`), and otherwise returns `$` plus
`Number(n).toLocaleString('en-US', { notation: 'compact', minimumFractionDigits: 2, maximumFractionDigits: 2 })`.
Expected outputs: `6726553623.93` → `$6.73B`; `3.45e12` → `$3.45T`; `0` → `$0.00`. Add a one-line
doc comment in the style of `:3`.

**Verification**:
The union with Step 4. On its own: `cd services/xstockstrat-ui && pnpm run lint && pnpm exec tsc --noEmit`.

---

### Step 4 — test: `fmtUsdCompact`

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/money.test.ts` — modify

**Reviewers**: `xstockstrat-ui` owner — analytics display accuracy

**Codebase Evidence**:
- `ui/src/lib/money.test.ts:1-15` — one `describe('fmtSignedUsd', …)` importing from `./money`.
- Coverage is scoped to `src/lib/**` with a 40% threshold (`ui/vitest.config.ts:21-34`).

**Lands with**: `Step 3`

**TDD**: `red-green required`

**Covers**: `AC-1` (unit half: the abbreviated market cap value; the card itself is Step 6)

**Instructions**:
Add `describe('fmtUsdCompact', …)` asserting the three outputs in Step 3, `3.02e12` → `$3.02T`, and
`—` for `undefined`, `null` and `NaN`. The inputs are plain numbers, so no fixture is needed (C-12).

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm exec vitest run src/lib/money.test.ts \
  && pnpm run test:coverage && pnpm run lint && pnpm exec tsc --noEmit
```
RED before Step 3: the import of `fmtUsdCompact` does not resolve, which is why the two steps are
one unit; inside the unit, write the test against a stub that returns `''` to capture a behaviour
RED.
Coverage: `src/lib/**` lines, functions and statements must stay >= 40% under
`pnpm run test:coverage` (`ui/vitest.config.ts:29-33`).

---

### Step 5 — service: Fundamentals card redesign

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/trader/positions/[symbol]/page.tsx` — modify

**Reviewers**: `xstockstrat-ui` owner — Trading UI correctness, analytics display accuracy

**Codebase Evidence**:
- `page.tsx:1084-1129` — `FundamentalsSection`. `rows` is built at `:1087-1098`
  (`Market cap` via `fmtUsd(f.marketCap)` at `:1089`); the header with the `stale` badge is
  `:1101-1110`; the loading branch is `:1112-1113`; the error branch is `:1114-1118`; the single
  grid `grid grid-cols-2 overflow-hidden rounded-md border border-border sm:grid-cols-4` is
  `:1120-1124`.
- Imports already present: `fmtUsd, fmtSignedUsd, fmtPct, pnlClass` from `@/lib/money` (`:14`),
  `timestampToDate` from `@/lib/protoTime` (`:41`), `StatTile` (`:70`).
- Footer fields exist on the message: `as_of = 14`, `source = 16`
  (`packages/proto/marketdata/v1/marketdata.proto:240,242`).
- Date formatter to reuse: `fmtNyDate(ts)` → `YYYY-MM-DD` in America/New_York
  (`ui/src/lib/protoTime.ts:24-27`).
- The ` · ` join precedent is the opportunity meta line (`page.tsx:1074-1076`).
- Existing e2e that must stay green: FR-7 (`ui/e2e/trader/position-detail.spec.ts:164-178`, asserts
  `P/E`, `31.40`, `ROE`), the no-data state (`:180-193`), feature 220 (`:633-649`) and feature 145
  (`:651-…`).

**Lands with**: `Step 6`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Replace the flat `rows` array with two groups, each a label and four tiles (design D-9):
   - **Valuation** — Market cap, P/E, P/B, EPS.
   - **Quality & risk** — ROE, Debt/Equity, Beta, Div yield.
   Keep each value expression as it is today, except Market cap, which becomes
   `fmtUsdCompact(f.marketCap)`. Add `fmtUsdCompact` to the `@/lib/money` import.
2. Keep the header (`:1101-1110`) and the loading and error branches (`:1112-1118`) verbatim.
3. In the data branch render, per group: a header line
   `<p className="text-xs font-medium text-muted-foreground">` with the group name, then the grid
   with the same classes as `:1120` holding the four `StatTile size="md"` tiles. No `sub` lines
   (R-10).
4. Below the groups render a footer line, only when at least one part is present:
   `as of <fmtNyDate(f.asOf)>` and `f.source`, joined with ` · `, in
   `text-xs text-muted-foreground`. Add `fmtNyDate` to the `@/lib/protoTime` import.
5. Leave the other stat grids and the OrderForm (`page.tsx:430-435`) untouched.

**Verification**:
The union with Step 6. On its own: `cd services/xstockstrat-ui && pnpm run lint && pnpm exec tsc --noEmit`.

---

### Step 6 — test: redesigned Fundamentals card e2e

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/trader/symbol-page-display.spec.ts` — modify

**Reviewers**: `xstockstrat-ui` owner — Trading UI correctness, analytics display accuracy

**Codebase Evidence**:
- The spec file and `FUNDAMENTALS_LYFT` come from Step 2.
- Card heading locator in use today: `page.getByRole('heading', { name: 'Fundamentals' })`
  (`ui/e2e/trader/position-detail.spec.ts:171`).

**Lands with**: `Step 5`

**TDD**: `red-green required`

**Covers**: `AC-1`

**Instructions**:
Extend the two `@AC-1` tests from Step 2 (or add one test beside them) to assert, with the
`GetFundamentals` stub:
- the group headers "Valuation" and "Quality & risk" are visible;
- the "Market cap" tile shows `$6.73B` for `6726553623.93` and `$3.45T` for `3.45e12`, and the
  "P/E" tile shows `41.20`;
- the card holds eight tiles, each with its label above its value;
- the footer reads `as of 2026-11-13 · fmp`.
No new fixture is needed.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run lint && pnpm exec tsc --noEmit \
  && pnpm exec playwright test e2e/trader/symbol-page-display.spec.ts --project=chromium --no-deps \
  && pnpm exec playwright test e2e/trader/position-detail.spec.ts -g "Fundamentals" \
     --project=chromium --no-deps
```
RED before Step 5: the group headers are absent and the market cap shows the full-precision value.
The second command keeps the feature-220 rule and the FR-7 tests green.
Coverage: this step adds no `src/lib/**` code, so the 40% `src/lib/**` threshold
(`pnpm run test:coverage`, `ui/vitest.config.ts:29-33`) is unaffected; e2e runs and
`src/components/**` render tests are not coverage-gated.

---

### Step 7 — service: `opportunityChipLabel`

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/opportunityShared.tsx` — modify
- `services/xstockstrat-ui/src/app/trader/positions/[symbol]/page.tsx` — modify

**Reviewers**: `xstockstrat-ui` owner — Trading UI correctness

**Codebase Evidence**:
- `page.tsx:442-446` — `opportunityPanels`; the label is `o.strategyId || o.symbol` (`:444`).
  The label is rendered by `ToggleGroupItem` (`role="radio"`) in
  `ui/src/components/trader/SymbolPanelGroup.tsx:47-51`, only when there are two or more panels
  (`:29-30`) and below `md` (`:39`).
- `Opportunity.strategy_id = 7`, `source = 8` (`packages/proto/analysis/v1/analysis.proto:610,611`).
- `ui/src/lib/opportunityShared.tsx:1-125` — exports at `:20-115`; the file imports
  `@xstockstrat/proto/analysis/v1/analysis_pb` types at `:7-12`. `page.tsx` imports from it at
  `:17-22` and has `Opportunity` as a type at `:53`.
- The module is imported by server code, so it must not gain a runtime client-only import
  (`ui/src/lib/opportunityShared.tsx:4-5`; fails.md:1652).
- **Not found**: no source-to-label humanizer in `ui/src` (one inline CSS `capitalize` at
  `ui/src/app/insights/strategies/[id]/page.tsx:258`).
- Accepted gaps (design.md § 3), not changed here: the mobile `SignalRow` renders `s.strategyId`
  (`ui/src/components/mobile/SectionRenderer.tsx:187-188`), not a source field; how
  `Opportunity.source` maps into `SignalItem.strategyId` is unconfirmed by grep. Same-source rows get
  identical chips.

**Lands with**: `Step 8`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. In `opportunityShared.tsx` add **new**
   `export function opportunityChipLabel(o: { strategyId: string; source: string }): string`:
   return `o.strategyId` when non-empty; else the humanized source when `o.source` is non-empty
   (replace `_` and `-` with a space, upper-case the first character: `fundamentals` →
   `Fundamentals`); else the literal `No strategy`. It never reads the symbol. No label map.
2. At `page.tsx:444` use `label: opportunityChipLabel(o)` and add the name to the import at
   `:17-22`.

**Verification**:
The union with Step 8. On its own: `cd services/xstockstrat-ui && pnpm run lint && pnpm exec tsc --noEmit`.

---

### Step 8 — test: chip label unit test and `@AC-2` e2e

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/opportunityShared.test.ts` — modify
- `services/xstockstrat-ui/e2e/fixtures/opportunities.ts` — modify
- `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md` — modify
- `services/xstockstrat-ui/e2e/trader/symbol-page-display.spec.ts` — modify

**Reviewers**: `xstockstrat-ui` owner — Trading UI correctness

**Codebase Evidence**:
- `ui/src/lib/opportunityShared.test.ts:1-64` — imports from `./opportunityShared` at `:5`.
- `ui/e2e/fixtures/opportunities.ts:95-…` — `OPPORTUNITIES`. Rows with an empty `strategyId` and a
  source already exist (`:134-135`, `:147-148`), but none is for LYFT with source `fundamentals`.
  Rows carry `validUntil` as a `BigInt` Timestamp (`:8`), which `JSON.stringify` cannot serialize,
  so a fixture meant for `page.route` bodies omits it.
- `ListOpportunities` stub pattern: `ui/e2e/trader/signal-confidence-ticket.spec.ts:42-50`.
- The page keeps only rows whose `symbol` equals the page symbol (`page.tsx:196-199`).
- The Opportunities tab bar's accessible name is `Opportunities` (`page.tsx:552`).

**Lands with**: `Step 7`

**TDD**: `red-green required`

**Covers**: `AC-2`

**Instructions**:
1. Vitest: add `describe('opportunityChipLabel', …)` — a strategy id wins over the source; an empty
   strategy id with `source: 'fundamentals'` gives `Fundamentals`; `unusual_whales` gives
   `Unusual whales`; both empty gives `No strategy`. Pass plain `{ strategyId, source }` objects
   (scenario one-offs, C-12 exempt).
2. Fixture: **new** `LYFT_SOURCE_LABEL_OPPORTUNITIES` in `opportunities.ts` — two LYFT rows with
   distinct `opportunityKey`s, one with `strategyId: 'dip_buyer_vol_stop'`, one with
   `strategyId: ''` and `source: 'fundamentals'`, no `validUntil`. Used through `page.route` only;
   do not add the rows to `OPPORTUNITIES`. Add the `INVENTORY.md` row.
3. e2e `@AC-2` in `symbol-page-display.spec.ts` (384px viewport from Step 2): stub
   `ListOpportunities` with `{ opportunities: LYFT_SOURCE_LABEL_OPPORTUNITIES }`, go to
   `/trader/positions/LYFT`, and within `getByRole('radiogroup', { name: 'Opportunities' })` assert
   radios named `dip_buyer_vol_stop` and `Fundamentals` are visible and no radio is named `LYFT`.
   Scope every assertion to `getByRole('radio')` (design.md § 3).

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm exec vitest run src/lib/opportunityShared.test.ts \
  && pnpm run test:coverage && pnpm run lint && pnpm exec tsc --noEmit \
  && pnpm exec playwright test e2e/trader/symbol-page-display.spec.ts --project=chromium --no-deps \
  && pnpm exec playwright test e2e/trader/position-detail.spec.ts -g "feature 145" \
     --project=chromium --no-deps
grep -n "LYFT_SOURCE_LABEL_OPPORTUNITIES" e2e/fixtures/INVENTORY.md
```
RED before Step 7: the e2e finds a radio named `LYFT`. The last Playwright command guards the
feature-155 rule that a row with a strategy id keeps it as the label.
Coverage: `src/lib/**` lines, functions and statements must stay >= 40% under
`pnpm run test:coverage` (`ui/vitest.config.ts:29-33`); the e2e part of this step is not
coverage-gated.
The Step 7 wiring at `page.tsx:444` has no unit test; the `@AC-2` e2e is its only proof (see
"Running e2e in the execute sandbox" for the fallback rule).

---

### Step 9 — service: import the stock `shadcn/tailwind.css` so the primitives' state variants resolve

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/globals.css` — modify

**Reviewers**: `xstockstrat-ui` owner — config mutation safety, Trading UI correctness

**Basis**: two operator rulings (2026-11-15, verbatim; `context.md` § re-spec sessions). O-12: "Yes,
fix the primitives. Use the switch component from Shadcn." Asked whether to adopt the full shadcn
stylesheet: "No, add it to the scope". They supersede design D-4 and reopen R-3 and R-4. Evidence
below was read and compiled on `feature/fix-symbol-page-alerts-ui@525cd5d2f`.

**Codebase Evidence**:
- `ui/src/app/globals.css:1-2` imports only `tailwindcss` and `tw-animate-css` and declares no
  `@custom-variant`, so Tailwind 4 compiles every `data-<name>:` class with its built-in variant, a
  bare-attribute selector such as `[data-checked]`. Radix sets `data-state` / `data-orientation`
  instead, so those rules never match.
- `ui/node_modules/shadcn/dist/tailwind.css:28-86` defines nine `@custom-variant`s (`data-open`,
  `data-closed`, `data-checked`, `data-unchecked`, `data-selected`, `data-disabled`, `data-active`,
  `data-horizontal`, `data-vertical`) that match the Radix attributes as well as the bare ones;
  `:88` onward adds the `no-scrollbar`, `scroll-fade*` and `shimmer*` utilities, their keyframes and
  eight `@property` rules. It holds no colour token.
- It is the stock wiring: the shadcn CLI's `eject` command looks for exactly
  `@import "shadcn/tailwind.css"`. `shadcn` is a `dependency` (`ui/package.json:56`), its `exports`
  map has `"./tailwind.css"` (`ui/node_modules/shadcn/package.json:59`), and `ui/Dockerfile` runs
  `pnpm install --frozen-lockfile --filter xstockstrat-ui` (all dependencies) before the build.
- Uses in `ui/src` of the variants the import changes (`grep -rnoE "data-<name>:"`): `data-checked:`
  11 and `data-unchecked:` 4 (switch, checkbox, field, questionnaire); `data-open:` 42 and
  `data-closed:` 34 (accordion, alert-dialog, combobox, dropdown-menu, navigation-menu, select,
  sheet, sidebar, tooltip); `data-active:` 15 (tabs, sidebar); `data-horizontal:` 6 (5 class uses
  plus the comment at `ui/src/components/insights/FormulaReferencePanel.tsx:50`) and
  `data-vertical:` 11 (separator, slider, toggle-group); `data-disabled:` 16; `data-selected:` 0.
  `no-scrollbar` is used at `ui/src/components/ui/sidebar.tsx:356` and `combobox.tsx:124`.
- Compiled in this session with `@tailwindcss/postcss` 4.3.3 over `globals.css` (not a full
  `next build`), with the import as line 3: `.data-checked\:bg-primary[data-checked]` becomes
  `.data-checked\:bg-primary:where([data-state="checked"]), …:where([data-checked]:not([data-checked="false"]))`;
  `.data-open\:animate-in[data-open]` gains `[data-state="open"]`; `.data-active\:bg-background`
  gains `[data-state="active"]`; `.data-horizontal\:h-px` becomes `:where([data-orientation="horizontal"])`;
  `.no-scrollbar` is emitted. `checkBundle` (`ui/src/styles/themes/checkThemeBundle.cjs:139`) reports
  0 failures on that output for both themes.
- `ui/src/styles/themes/checkThemeBundle.test.ts:241-250` requires line 1 and line 2 of
  `globals.css` unchanged and both `@source not` lines at an index above 1. Run with the import as
  line 3: `src/styles/themes` stays green.
- Keyframes: `accordion-down` / `accordion-up` are already defined twice today, by `tw-animate-css`
  and by `ui/src/app/globals.css:69-84`; the import adds a third pair. The `globals.css` pair is
  emitted last in all three compiles, so the keyframes in effect do not change.
- `ui/src/components/ui/tabs.tsx:18-21,28,63` (`// app-specific`) use the arbitrary form
  `data-[orientation=horizontal]:`. Its compiled rules are byte-identical with and without the
  import (`.data-\[orientation\=horizontal\]\:flex-col[data-orientation="horizontal"]`), so they
  neither conflict nor apply twice. `ui/src/components/ui/sidebar.tsx` sets
  `data-active={isActive || undefined}` (`:497,643`; `ui/CLAUDE.md` § Styling); the new variant matches
  `[data-active]:not([data-active="false"])`, which gives the same result as today.
- `ui/src/components/insights/FormulaReferencePanel.tsx:50-52` describes a `data-horizontal:flex-col`
  mismatch that `tabs.tsx` already fixed by hand. The comment is stale today and this step does not
  change that.

**Lands with**: `Step 10`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. In `ui/src/app/globals.css`, insert `@import 'shadcn/tailwind.css';` as a new line 3, directly
   after `@import 'tw-animate-css';`. Add no comment.
2. Add no `@custom-variant` block by hand (the scoped two-variant design is superseded).
3. Leave the `accordion-down` / `accordion-up` keyframes at `globals.css:69-84` in place.
4. Do not edit `switch.tsx`, `checkbox.tsx`, `field.tsx`, `questionnaire.tsx`, `tabs.tsx`,
   `sidebar.tsx` or `FormulaReferencePanel.tsx`.

**Expected visible changes** (compiled CSS read against each component's classes; no browser run):
- Switch, checkbox: the checked state is drawn (`@AC-6`, `@AC-11`). Questionnaire already works.
- Tabs (6 consumers): the selected tab gains its background and text colour. Layout is unchanged.
- Alert dialog (7), dropdown menu (6), select (26), sheet (5), tooltip (3), navigation menu (desktop
  header and mobile bottom bar): open and close animations of 100-200 ms start playing. An open
  navigation-menu trigger gains a muted background and its chevron turns; an open dropdown
  sub-trigger gains the accent background.
- Separator (`ui/src/components/shared/PlatformHeader.tsx:211`,
  `ui/src/components/trader/AlertStream.tsx:95`, sidebar, field): it has no width or height today,
  so a one-pixel line appears where each is rendered.
- Slider (`ui/src/app/insights/screener/page.tsx:458`): the track gains its height and full width.
- Toggle group (4 consumers): a vertical group stacks; with `spacing=0`, joined items gain rounded
  outer corners and collapsed inner borders.
- Accordion (`ui/src/app/accounts/mcp-tools/page.tsx:112`): the open item gains a muted background
  and the panel animates.
- Combobox list (4 consumers) and the sidebar content: the scrollbar is hidden (`no-scrollbar`).
- `data-disabled:` (16 uses): Radix and Base UI set `data-disabled=""`, which matches before and
  after. Only `data-disabled="false"` would stop matching; `grep -rn "data-disabled=" ui/src` finds
  none.
- Sidebar active item: unchanged (see evidence).
- Selector weight: the rewritten rules weigh one class (`:where()` adds nothing), as shadcn ships
  them, so `aria-invalid:` / `focus-visible:` colours win over a `data-checked:` colour on the same
  control.

**Operator confirmation at the first execute checkpoint**: the list the operator was shown named the
animations, the tab background, the slider track, the toggle-group corners and the combobox
scrollbar. Found after it: the separator lines (header, Alerts drawer, sidebar), the navigation-menu
trigger background and chevron, the accordion background and the hidden sidebar scrollbar. They are
part of the same stylesheet the operator added to scope; announce them rather than assume they were
seen.

**Verification**:
The union with Step 10. On its own:
```bash
cd services/xstockstrat-ui && sed -n 3p src/app/globals.css \
  && pnpm exec prettier --check src/app/globals.css \
  && pnpm exec vitest run src/styles/themes && pnpm run lint && pnpm exec tsc --noEmit \
  && git diff --stat -- src/components
```
`sed` must print `@import 'shadcn/tailwind.css';` and the `git diff --stat` must print only
`src/components/ui/checkedVariants.test.ts` (Step 10).

---

### Step 10 — test: compiled-CSS guard, switch `@AC-6`/`@AC-7`, checkbox `@AC-11` and tab `@AC-12` e2e

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/ui/checkedVariants.test.ts` — create
- `services/xstockstrat-ui/e2e/accounts/notifications.spec.ts` — modify
- `services/xstockstrat-ui/e2e/auth.spec.ts` — modify
- `services/xstockstrat-ui/e2e/config-ui/templates.spec.ts` — modify

**Reviewers**: `xstockstrat-ui` owner — Trading UI correctness

**Codebase Evidence**:
- `ui/package.json` devDependencies list `postcss` and `@tailwindcss/postcss` directly, and
  `ui/vitest.config.ts:19-20` collects `src/**/*.test.ts` in node, so a Vitest file can compile
  `globals.css` itself (about 0.2 s, run in this session).
- `ui/src/app/globals.css:1,5` — `source('..')` scans `src/` and `@source not "../**/*.test.ts"`
  excludes test files, so class names written in the test are not emitted; a rule exists only if a
  component still carries the class.
- `ui/src/components/ui/switch.test.ts:1-9` — presence-only test; this step leaves it as is. No
  `ui/src/components/ui/*.test.ts` asserts a `data-*` class string.
- `ui/e2e/accounts/notifications.spec.ts:70-89` — the existing toggle test. It forces
  `Notification.permission` to `granted` with `page.addInitScript` (`:77-82`) because headless
  Chromium reports `denied`, and locates the control with
  `getByRole('switch', { name: 'Enable push notifications' })`.
- `PushToggle` sets `enabled` from
  `navigator.serviceWorker.ready.then((reg) => reg.pushManager.getSubscription())`
  (`ui/src/app/accounts/notifications/PushToggle.tsx:50-58`) and passes it as `checked` (`:149`).
- The thumb carries `data-slot="switch-thumb"` (`ui/src/components/ui/switch.tsx:26`).
- Tailwind 4 `translate-*` sets the standalone `translate` property, so the position check uses
  bounding boxes, not `transform` (fails.md, feature 126; design D-11).
- `ui/e2e/auth.spec.ts:134-139` — `page.goto('/auth/login')` and
  `page.getByRole('checkbox', { name: /remember me/i })`, unchecked by default; the control is the
  shared `Checkbox` at `ui/src/components/auth/AuthForm.tsx:108-113`, labelled "Remember me for 14
  days" (`:115`). The checkbox has no hover or focus background class
  (`ui/src/components/ui/checkbox.tsx:14`).
- `ui/e2e/config-ui/templates.spec.ts:17-29` — signs in as admin, opens `/config-ui/templates` and
  clicks `page.getByRole('tab', { name: 'Strategy', exact: true })`. The page renders
  `<Tabs defaultValue={String(TemplateKind.FORMULA)}>` with a default-variant `TabsList`
  (`ui/src/app/config-ui/templates/page.tsx:419-420`); the labels are "Formula", "Strategy" and
  "Signal source" (`ui/src/hooks/useTemplates.ts:31-35`). The trigger's only background class for
  the selected state is `data-active:bg-background` (`ui/src/components/ui/tabs.tsx:66`).
- `ui/playwright.config.ts:93-97` sets no `reducedMotion`, and no global CSS disables animations, so
  the new open and close animations run under e2e.

**Lands with**: `Step 9`

**TDD**: `red-green required` — capture RED → GREEN for the twelve red Vitest cases, `@AC-6`,
`@AC-11` and the `@AC-12` tab e2e. Record "red N/A — no behaviour change; characterization test
added" for `@AC-7` (passes today) and the questionnaire case.

**Covers**: `AC-6, AC-7, AC-11, AC-12`

**Instructions**:
1. Create `checkedVariants.test.ts`. In `beforeAll`, read `src/app/globals.css` (path from
   `import.meta.url`), run `postcss([tailwind()]).process(css, { from: <that path> })` with
   `tailwind` from `@tailwindcss/postcss`, and collect every rule selector with `'` replaced by `"`.
   With `it.each`, for each row find the selectors that start with the prefix, assert there is at
   least one, and assert each contains the attribute:

   | Case | Selector prefix | Must contain |
   |---|---|---|
   | switch root | `.data-checked\:bg-primary` | `[data-state="checked"]` |
   | switch thumb, on | `.data-checked\:translate-x-\[calc\(100\%-4px\)\]` | `[data-state="checked"]` |
   | switch thumb, off | `.data-unchecked\:translate-x-0` | `[data-state="unchecked"]` |
   | checkbox | `.data-checked\:text-primary-foreground` | `[data-state="checked"]` |
   | field label | `.has-data-checked\:bg-input\/30` | `[data-state="checked"]` |
   | questionnaire choice | `.group-data-checked\/questionnaire-choice\:bg-primary` | `[data-checked]` |
   | overlay open | `.data-open\:animate-in` | `[data-state="open"]` |
   | overlay closed | `.data-closed\:animate-out` | `[data-state="closed"]` |
   | active tab | `.data-active\:bg-background` | `[data-state="active"]` |
   | horizontal separator | `.data-horizontal\:h-px` | `[data-orientation="horizontal"]` |
   | vertical separator | `.data-vertical\:w-px` | `[data-orientation="vertical"]` |
   | disabled item | `.data-disabled\:opacity-50` | `[data-disabled]:not([data-disabled="false"])` |

   Add one more test: the selector list contains `.no-scrollbar`. These rows are the whole proof for
   field and questionnaire (nothing renders `FieldLabel` or `QuestionnaireChoice`) and for every
   `@AC-12` row except the tab.
2. e2e `@AC-6`: in the `push notifications page` describe of `notifications.spec.ts`, add a test
   that sets the permission to `granted` as `:77-82` does and, in the same init script, makes
   `navigator.serviceWorker.ready` resolve to an object whose `pushManager.getSubscription()`
   resolves to `{ endpoint: 'https://push.example/e2e' }` (the sentinel already used at `:48`).
   Assert the switch has `aria-checked="true"` and that the thumb's centre x is greater than the
   track's centre x.
3. e2e `@AC-7`: same page with only the permission override (no subscription). Assert
   `aria-checked="false"` and that the thumb's centre x is less than the track's centre x.
4. e2e `@AC-11`: in `auth.spec.ts`, next to the test at `:134`, add a test that opens
   `/auth/login`, reads the Remember me checkbox's computed `background-color`, calls `check()`,
   asserts `toBeChecked()` and then `not.toHaveCSS('background-color', <the unchecked value>)`.
5. e2e `@AC-12` (tab row): in the test at `templates.spec.ts:16`, after the click at `:29`, read the
   computed `background-color` of `getByRole('tab', { name: 'Formula', exact: true })` and assert
   the "Strategy" tab has `aria-selected="true"` and `not.toHaveCSS('background-color', <that value>)`.
6. Assert no colour literal anywhere: the `dark:` classes follow the OS colour scheme (design.md
   § 4) and theme values differ per `UI_THEME`.
7. No inventory fixture is needed (C-12): the only literal is the reserved push-endpoint sentinel,
   and the Vitest table holds CSS selectors, not domain data.

**Existing specs at risk from Step 9** (read, not run):
- `ui/e2e/theme/theme-bundle.spec.ts:79,88,97` use `toMatchAriaSnapshot` (`shell.aria.yml`,
  `trader-main.aria.yml`, `strategy-equity.aria.yml`). A `globals.css` change matches the `ui-theme`
  path filter (`.github/workflows/ci.yml:120-122`), so this spec runs in CI. Aria snapshots are
  probably CSS-insensitive; the Verification below runs the spec to confirm. No spec uses a
  screenshot assertion, and the only non-retrying `count()` calls
  (`ui/e2e/mobile.spec.ts:28`, `ui/e2e/trader/offline-pnl.spec.ts:155`) do not follow an overlay
  closing. Playwright waits for a target to stop moving before it clicks, and `toHaveCount(0)` /
  `toBeHidden` retry, so the plain open-click-close flows should hold.
- Real risk — a closing overlay stays mounted for its 100-200 ms exit animation. A spec that closes
  one overlay and at once addresses the next through an unscoped role locator can hit a strict-mode
  violation (two matches). The specs with the most overlay locators:
  `ui/e2e/trader/account-selector.spec.ts`, `trader/offline-accounts.spec.ts`,
  `trader/orders.spec.ts`, `trader/order-form.spec.ts`, `insights/watchlists.spec.ts`,
  `insights/strategy-authoring.spec.ts`, `config-ui/sources.spec.ts`, `mobile-sidebar.spec.ts`.
- `ui/e2e/mobile-sidebar.spec.ts` opens the mobile menu sheet, which now slides in over 200 ms. Its
  assertions (`toHaveClass(/font-medium/)`, `data-active`, the chevron `rotate`) retry and use
  classes this step does not change.
- `ui/e2e/mobile-overflow.spec.ts` (390 px on every route, 1280 px on `/trader/orders`): the header
  separator gains 1 px of width at `sm` and up (`PlatformHeader.tsx:211`); the 1280 px case has
  headroom by design (`:76-83`), and the separator is hidden at 390 px.
- `ui/e2e/mobile.spec.ts:27-32` (bottom tab bar height at least 44 px): no height class changes.
- Mitigation: add no wait in advance. If one of these specs turns red for the reason above, wait for
  the closing surface with `toHaveCount(0)` before the next action in that spec, and record a
  Deviation Log row naming the spec. Do not disable animations in `playwright.config.ts` or
  `globals.css`: that would hide the behaviour the operator accepted.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm exec vitest run src/components/ui/checkedVariants.test.ts src/styles/themes \
  && pnpm exec prettier --check src/app/globals.css src/components/ui/checkedVariants.test.ts \
  && pnpm run lint && pnpm exec tsc --noEmit \
  && pnpm exec playwright test e2e/accounts/notifications.spec.ts e2e/auth.spec.ts \
       e2e/config-ui/templates.spec.ts e2e/mobile-sidebar.spec.ts e2e/mobile-overflow.spec.ts \
       e2e/theme/theme-bundle.spec.ts --project=chromium --no-deps
```
RED before Step 9: twelve of the thirteen Vitest cases fail (all but the questionnaire row),
`@AC-6` finds the thumb at the leading end, the checkbox keeps its unchecked background and the
"Strategy" tab has the same background as "Formula".

Run in this session (2026-11-15) with a throwaway copy of the Vitest file, then reverted: before the
import, 12 failed and 1 passed; with the import as line 3, all 13 passed, `src/styles/themes` stayed
green (144 tests in total), `prettier --check` and `tsc --noEmit` were clean, and
`next lint --file src/components/ui/checkedVariants.test.ts` reported no warnings or errors.

Not run at spec time: any browser. A browser is available for the execute run:
`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers` holds `chromium-1243` and a headless shell, and
`ui/playwright.config.ts` maps it into `launchOptions.executablePath`. Unverified until then: every e2e assertion
above; that the compiled selectors produce the visible changes listed in Step 9; and whether any
existing spec turns red once animations play. The full `frontend-e2e` and `frontend-e2e-production`
CI jobs are the proof for the last point; a `globals.css` change matches the `ui-theme` path filter
(`.github/workflows/ci.yml:120-122`), so both run, with `ui-prod-image-build`. Also not run, and the
higher-risk part of the switch test: the `navigator.serviceWorker.ready` override in headless
Chromium. `ready` is an accessor on `ServiceWorkerContainer.prototype`, so a plain assignment may
not stick. If `@AC-6` cannot reach `aria-checked="true"` this way, stop and record a deviation; do
not weaken the assertion or mark `@AC-6` verified on the Vitest guard alone.
Coverage: this step adds no `src/lib/**` code, so the 40% `src/lib/**` threshold
(`pnpm run test:coverage`, `ui/vitest.config.ts:29-33`) is unaffected; e2e runs and
`src/components/**` tests are not coverage-gated.

---

### Step 11 — service: unread-alert helpers in `alertShared.ts`

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/alertShared.ts` — modify

**Reviewers**: `xstockstrat-ui` owner — Connect-RPC call safety, Trading UI correctness

**Codebase Evidence**:
- `ui/src/lib/alertShared.ts:1-17` — today only `severityLabel` and `severityVariant`.
- `ProtoTimestamp { seconds: bigint | number; nanos?: number }` — `ui/src/lib/protoTime.ts:6-9`
  (the generated Timestamp carries `bigint` seconds).
- Server behaviour the drain relies on (read-only reference): unread rows are returned
  `ORDER BY a.created_at DESC LIMIT $2` with a default limit of 50
  (`services/xstockstrat-notify/src/grpc/notifyServiceImpl.ts:231,236-242`), and the mark is one
  idempotent set `INSERT … ON CONFLICT DO NOTHING` whose JOIN drops unknown ids (`:211-218`).
- Request and response fields: `ListAlertsRequest.limit = 3`, `unread_only = 5`;
  `ListAlertsResponse.alerts = 1`; `MarkAlertReadRequest.alert_ids = 1`
  (`packages/proto/notify/v1/notify.proto:102-119`).
- **Not found**: `mergeUnread`, `pruneStreamed`, `drainUnread`, `compareCreatedAt` (grep of
  `ui/src`).

**Lands with**: `Step 12`

**Operator gate**: ask O-24 before this unit (Execution Summary § Operator questions).

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
Add to `alertShared.ts` (pure, no React and no client import). `UnreadLike` below is a **new**
structural type `{ alertId: string; createdAt?: ProtoTimestamp }`, so tests need no full `Alert`.

1. **new** `export const UNREAD_PAGE_SIZE = 50` — the list limit, the streamed-buffer cap and the
   drain page size.
2. **new** private `compareCreatedAt(a, b)` — newest first, on `Number(createdAt.seconds)`; a
   missing timestamp sorts first (a fixture tolerance only, design D-18). It is the one comparator
   for both helpers below (D-23).
3. **new** `export function mergeUnread<T extends UnreadLike>(stored: T[], streamed: T[], readIds: ReadonlySet<string>): T[]`
   — de-duplicates on `alertId`, drops ids in `readIds`, sorts with `compareCreatedAt`.
4. **new** `export function pruneStreamed<E extends { alert: UnreadLike; seq: number }>(streamed: E[], resultIds: ReadonlySet<string>, fetchSeq: number): E[]`
   — keeps an entry whose id is in `resultIds` or whose `seq >= fetchSeq`.
5. **new** `export async function drainUnread<T extends UnreadLike>({ list, mark, cutoff, maxBatches })`
   returning `{ markedIds: string[]; outcome: 'done' | 'capped' | 'error'; error?: unknown }`:
   - `list: (req: { unreadOnly: true; limit: number }) => Promise<{ alerts: T[] }>` and
     `mark: (req: { alertIds: string[] }) => Promise<unknown>` are injected.
   - `cutoff: T` is the newest listed alert at click time. An alert is eligible when it is not
     newer than `cutoff` under `compareCreatedAt` (ties are eligible) and its id is not already
     marked.
   - `maxBatches` defaults to a private constant `20` (not exported, not a config key — R-14).
     Above the constant, one constraint comment: raising it means revisiting the notify
     single-connection load (design.md § Load note).
   - Each pass: `list({ unreadOnly: true, limit: UNREAD_PAGE_SIZE })`; mark the eligible ids in one
     `mark` call if there are any; then return `done` if the page held fewer rows than the limit;
     else return `capped` if the page had no eligible id; else continue. Reaching `maxBatches`
     returns `capped`. A rejected `list` or `mark` returns `error` with the ids marked so far.

**Verification**:
The union with Step 12. On its own: `cd services/xstockstrat-ui && pnpm run lint && pnpm exec tsc --noEmit`.

---

### Step 12 — test: unread-alert helpers

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/alertShared.test.ts` — create
- `services/xstockstrat-ui/e2e/fixtures/alerts.ts` — modify
- `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md` — modify

**Reviewers**: `xstockstrat-ui` owner — Connect-RPC call safety

**Codebase Evidence**:
- `ui/src/lib/alertShared.test.ts` does not exist (`ls ui/src/lib`).
- A `src` unit test may import the e2e inventory: `ui/src/lib/positionLineage.test.ts`,
  `ui/src/lib/orderFreshness.test.ts` (grep `e2e/fixtures`).
- `ui/e2e/fixtures/alerts.ts:1-95` — existing alert fixtures carry no `createdAt`
  ("Timestamps are omitted", `:6-7`). Catalog row: `ui/e2e/fixtures/INVENTORY.md:50`.
- `alertShared.ts` is inside the coverage scope `src/lib/**` (`ui/vitest.config.ts:24`).

**Lands with**: `Step 11`

**TDD**: `red-green required`

**Covers**: `AC-5, AC-9, AC-10`

**Instructions**:
1. Fixtures (C-12) in `alerts.ts`, all **new**, with one `INVENTORY.md` row. Each carries
   `createdAt` as a Connect-JSON string built from an exported seconds constant, so the same
   object serves a `page.route` body, and a unit test can spread it with
   `createdAt: { seconds: BigInt(<constant>), nanos: 0 }`:
   - `DRAWER_ALERT_BASE_SECONDS = 1_794_736_800` (2026-11-15T10:00:00Z).
   - `DRAWER_ALERT_STORED_UNREAD` — title `Backfill 67276d1f failed`, `read: false`, at the base.
   - `DRAWER_ALERT_STORED_READ` — title `Backfill 11aa22bb done`, `read: true`, base − 60 s.
   - `DRAWER_ALERT_STREAMED` — title `Order rejected`, severity 4, base + 60 s.
   - `DRAWER_ALERT_CLEAR_A` — title `Backfill 9f8e7d6c failed`, `read: false`, base + 10 s.
   - `DRAWER_ALERT_CLEAR_B` — title `Daily loss limit reached`, `read: false`, base + 20 s.
   Give each a distinct `alertId`. They are for per-spec stubs only; do not add them to
   `ALERT_LIST_WITH_READ_STATE` or `ALERT_STREAM_ALL`.
2. `mergeUnread` cases: an alert present in both lists appears once (`@AC-9`); an id in `readIds`
   is dropped; the result is newest first, `DRAWER_ALERT_STREAMED` before
   `DRAWER_ALERT_STORED_UNREAD` (`@AC-5`); a mix of missing and present timestamps puts the missing
   one first.
3. `pruneStreamed` cases: an entry in the result is kept; an entry with `seq >= fetchSeq` is kept;
   any other entry is dropped.
4. `drainUnread` cases (`@AC-10`), driven by an in-memory `list` that returns the newest
   `limit` unmarked rows and a `mark` that records ids. Build large sets by spreading a fixture
   with a generated `alertId` and timestamp (exempt from C-12):
   - 120 eligible alerts → `done`, 120 ids marked, three `list` calls.
   - 2 eligible alerts → `done` after exactly one `list` call.
   - 150 eligible alerts with `maxBatches: 2` → `capped`, 100 ids marked.
   - `mark` rejects on the second batch → `error`, the first batch's ids in `markedIds`.
   - alerts newer than `cutoff` stay unmarked; an alert with the cutoff's timestamp is marked.
   - 50 newer-than-cutoff rows on top of eligible rows → `capped`, nothing marked.
   - phantom ids (a `mark` that removes nothing) → `capped` on the second pass, no spin.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm exec vitest run src/lib/alertShared.test.ts \
  && pnpm run test:coverage && pnpm run lint && pnpm exec tsc --noEmit
grep -n "DRAWER_ALERT_" e2e/fixtures/INVENTORY.md
```
RED: inside the unit, write the tests against signature-only helpers (returning `[]` / `done`) so
the failure is a behaviour failure, not an unresolved import.
Coverage: `src/lib/**` lines, functions and statements must stay >= 40% under
`pnpm run test:coverage` (`ui/vitest.config.ts:29-33`).

---

### Step 13 — test: e2e groundwork for the unread-only drawer (no behaviour change)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/helpers/connectStream.ts` — create
- `services/xstockstrat-ui/e2e/trader/stream-reconnect.spec.ts` — modify
- `services/xstockstrat-ui/e2e/mock-backend.ts` — modify
- `services/xstockstrat-ui/e2e/fixtures/alerts.ts` — modify
- `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md` — modify

**Reviewers**: `xstockstrat-ui` owner — Connect-RPC call safety

**Codebase Evidence**:
- `ui/e2e/trader/stream-reconnect.spec.ts:13-44` — `connectStreamBody`, `fulfillStream`, `gate`,
  used at `:63-89` and `:109-119`. `ui/e2e/helpers/connectStream.ts` does not exist (`ls`).
- `ui/e2e/mock-backend.ts:685-688` — `async listAlerts()` takes no request and always returns
  `{ alerts: ALERT_LIST_WITH_READ_STATE, unreadCount: MOCK_UNREAD_COUNT }`. `streamAlerts` yields
  `ALERT_STREAM_ALL` on every connect (`:677-679`). `markAlertRead` is a no-op (`:691-693`).
- `ui/e2e/fixtures/alerts.ts:56-63` — `ALERT_LIST_002` has the title `Order rejected`, the same as
  `ALERT_STREAM_002` (`:19-26`). `ALERT_UNREAD` spreads it (`:82-85`).
- No `unreadOnly` caller exists in `ui/src` today, and no spec outside `alert-stream.spec.ts` and
  `stream-reconnect.spec.ts` asserts the text `Order rejected` (grep of `ui/e2e`), so both changes
  below are inert until Step 14.
- `ui/tsconfig.json:21` includes `**/*.ts`, so `tsc --noEmit` type-checks `e2e/`.

**TDD**: `red-green required` — a test-infrastructure refactor: record "red N/A — no behaviour
change" and capture the green run.

**Covers**: — (it verifies no scenario; it is groundwork for `AC-3, AC-4, AC-5, AC-9, AC-10`, which
Step 15 covers)

**Instructions**:
1. Move `connectStreamBody`, `fulfillStream` and `gate` verbatim from
   `stream-reconnect.spec.ts:13-44` to `e2e/helpers/connectStream.ts` as exports, and import them
   in `stream-reconnect.spec.ts`. Change nothing else in that spec (design D-14).
2. In `mock-backend.ts`, give `listAlerts` its request parameter. When `req.unreadOnly` is true,
   return the stored unread rows (`ALERT_LIST_WITH_READ_STATE` filtered on `!read`) followed by
   `ALERT_STREAM_ALL`, with `unreadCount` equal to that list's length (5). Otherwise return what it
   returns today. Keep it stateless (R-8).
3. In `alerts.ts`, retitle `ALERT_LIST_002` to `Buying power check failed` so stored and streamed
   alerts have distinct titles (design D-12). Update the `INVENTORY.md` alert row to say so.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run lint && pnpm exec tsc --noEmit \
  && pnpm exec playwright test e2e/trader/stream-reconnect.spec.ts e2e/trader/alert-stream.spec.ts \
     e2e/accounts/notifications.spec.ts e2e/trader/live-strategies.spec.ts \
     --project=chromium --no-deps
grep -n "from '../helpers/connectStream'" e2e/trader/stream-reconnect.spec.ts
```
All four specs stay green on a tree without Step 14.
Coverage: this step adds no `src/lib/**` code, so the 40% `src/lib/**` threshold
(`pnpm run test:coverage`, `ui/vitest.config.ts:29-33`) is unaffected; e2e runs and
`src/components/**` render tests are not coverage-gated.

---

### Step 14 — service: Alerts drawer lists merged unread alerts, with mark-read and Clear all

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/trader/AlertStream.tsx` — modify

**Reviewers**: `xstockstrat-ui` owner — Connect-RPC call safety, Trading UI correctness

**Codebase Evidence**:
- `ui/src/components/trader/AlertStream.tsx:13-125` — `AlertStream`, mounted by the trader
  `AppShell` (`ui/src/components/trader/AppShell.tsx:5,24`).
  - Badge source: one-shot `listAlerts({ limit: 1 })` reading `unreadCount` (`:19-32`),
    `const unread = unreadCount` (`:48`).
  - Stream: `useReconnectingStream<Alert>('alerts', …)` (`:35-46`), de-duplicated on `alertId` and
    capped at 50 (`:42-45`).
  - `hasHighSeverity` from the streamed list (`:49`); disconnected indicator (`:53-60`); bell
    `aria-label` (`:66`); badge with the `9+` display (`:69-76`).
  - "Clear all" is the local `setAlerts([])` (`:83-92`); "No alerts" (`:97-101`); rows are a plain
    `<li>` (`:104-118`).
- `Sheet` forwards its props to the Radix root, so `onOpenChange` is available
  (`ui/src/components/ui/sheet.tsx:10`).
- Mark-read pattern to follow: `notifyClient.markAlertRead({ alertIds })` then refetch —
  `ui/src/app/accounts/notifications/AlertInbox.tsx:42-53`; a ghost per-row button at `:122-132`;
  the unconfirmed "Mark all read" at `:66-74`.
- `notifyClient` is on the `/trader/api` transport (`ui/src/lib/browserClients/notifyClient.ts:5-6`),
  and the BFF forwards `listAlerts` and `markAlertRead` with the session's identity
  (`ui/src/lib/traderBff.ts:104,115`). No new outbound backend call is added, so the header
  propagation rule is met by the existing `forward` wrapper.
- `CardNotice` — `variant="error"` sets `role="alert"`; `muted` does not
  (`ui/src/components/shared/CardNotice.tsx:5-23`).
- Helpers from Step 11: `UNREAD_PAGE_SIZE`, `mergeUnread`, `pruneStreamed`, `drainUnread`.

**Lands with**: `Step 15`

**Operator gate**: O-24 must be answered (asked before Step 11). The capped-drain parts of this
step (instruction 6, the `capped` notice, `markNotice`) exist only under that answer.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. **State.** Replace `alerts` and `unreadCount` with: `stored: Alert[]`;
   `streamed: { alert: Alert; seq: number }[]`; `readIds: Set<string>`; a `seqRef` counter;
   one `pending` flag; `fetchFailed: boolean`; `markNotice: null | 'capped' | 'error'`.
2. **Single fetch entry point.** Add `refreshUnread()`: take `seq = ++seqRef.current`, call
   `notifyClient.listAlerts({ unreadOnly: true, limit: UNREAD_PAGE_SIZE })`, and apply the result
   only if `seq` is still the latest. Applying sets `stored`, runs `pruneStreamed` over the buffer
   with the result's ids and `seq`, and clears `fetchFailed`. A failed latest fetch sets
   `fetchFailed` and keeps the previous list and badge (design D-13). Call it on mount (replacing
   `:19-32`), from `Sheet onOpenChange` when the drawer opens, and after every mark action. Nothing
   else fetches.
3. **Stream.** Keep the `useReconnectingStream` call and its arguments exactly as at `:35-41`
   (design D-8). Only the item callback changes: append `{ alert, seq: seqRef.current }` unless the
   id is already buffered, capped at `UNREAD_PAGE_SIZE`.
4. **Derived values.** `merged = mergeUnread(stored, streamed alerts, readIds)`. The badge count
   is `merged.length`, with the `9+` display kept. `hasHighSeverity` reads `merged`.
5. **Rows.** List `merged`, each still a plain `<li>` with today's content (so feature 344 can wrap
   it), plus a ghost `Button` labelled "Mark read" with `aria-label={`Mark read: ${a.title}`}`. It
   awaits `markAlertRead({ alertIds: [a.alertId] })`, adds the id to `readIds`, then calls
   `refreshUnread()`. On failure it sets `markNotice` to `error` and the row stays.
6. **Clear all.** Keep the button's slot, classes and visible text "Clear all" (`:84-91`) with no
   `aria-label`; show it when `merged.length > 0`. Its handler calls
   `drainUnread({ list: (req) => notifyClient.listAlerts(req), mark: (req) => notifyClient.markAlertRead(req), cutoff: merged[0] })`.
   Whatever the outcome, add `markedIds` to `readIds`, clear `pending` and call `refreshUnread()`.
   `capped` sets `markNotice` to `capped`; `error` sets it to `error`. There is no confirm dialog
   and no undo (design D-21).
7. **Pending.** Set `pending` around every mark call, per-row or drain, and reset `markNotice` when
   one starts. While `pending` is true, Clear all and every per-row button are disabled.
8. **Notices**, above the list inside the drawer:
   - `fetchFailed` or `markNotice === 'error'` → `<CardNotice variant="error">`.
   - `markNotice === 'capped'` → `<CardNotice variant="muted">` with the text
     "Some alerts are still unread — Clear all again".
   Keep "No alerts" for an empty `merged`.
9. Do not add a shared store, a window event or a react-query key (R-5, R-6, R-13). Do not touch
   `AlertInbox`.

Wording not confirmed by the operator: the two error-notice texts are the executor's to choose in
plain words (for example "Could not load alerts" and "Could not mark alerts read"); "Clear all" and
the capped text are fixed by the design.

**Verification**:
The union with Step 15. On its own: `cd services/xstockstrat-ui && pnpm run lint && pnpm exec tsc --noEmit`,
and `grep -n "useReconnectingStream" -A 7 src/components/trader/AlertStream.tsx` shows the
`'alerts'` key and the `streamAlerts` request unchanged.

---

### Step 15 — test: Alerts drawer scenarios

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/trader/alert-stream.spec.ts` — modify

**Reviewers**: `xstockstrat-ui` owner — Connect-RPC call safety, Trading UI correctness

**Codebase Evidence**:
- `ui/e2e/trader/alert-stream.spec.ts:1-100`. Tests that encode the old behaviour: `:31-45`
  (badge stays at the server count 2) and `:69-82` (Clear all empties a local feed). Tests that
  locate the bell through the `^2$` badge: `:47-56`, `:84-99`. The feature-271 hold test is
  `:84-99`; the high-severity test is `:58-67`.
- Bell locator that survives the disconnected state: `getByRole('button', { name: /^Alerts/ })`
  (`ui/e2e/trader/stream-reconnect.spec.ts:123`).
- Stateful `MarkAlertRead` stub precedent: `ui/e2e/accounts/notifications.spec.ts:117-120`.
- The inbox exposes `getByLabel('Unread count')` with the text `<n> unread`
  (`ui/src/app/accounts/notifications/AlertInbox.tsx:63-65`) and rows with
  `data-testid="alert-row"` and `data-read` (`:92-95`). It calls `listAlerts({})` on the same
  Connect path (`:28`).
- The default mock streams `ALERT_STREAM_ALL` on every connect (`ui/e2e/mock-backend.ts:677-679`),
  so a per-spec stream stub never calls `route.continue()` (R-15).
- A fulfilled stream body ends cleanly, so the hook shows `disconnected` until the next connection
  has been open for `STREAM_STABLE_MS` = 3 s (`ui/src/hooks/useReconnectingStream.ts:41-44,61-63`;
  `ui/src/lib/streamBackoff.ts:3`).
- Fixtures: `DRAWER_ALERT_*` (Step 12); helpers `fulfillStream`, `gate` (Step 13).

**Lands with**: `Step 14`

**TDD**: `red-green required`

**Covers**: `AC-3, AC-4, AC-5, AC-9, AC-10`

**Instructions**:
1. **Default-mock tests** (no stubs):
   - Keep "bell icon is visible".
   - Replace `:31-45` with: the bell badge shows `5` before and after the drawer is opened (the
     merged unread list: 2 stored unread plus 3 streamed).
   - In `:47-56`, `:58-67` and `:84-99`, locate the bell by role (`/^Alerts/`) instead of the `^2$`
     badge. Keep their other assertions; the feature-271 test keeps its trace header, its hold
     timeout and its `DEFAULT_UNARY_TIMEOUT_MS` assertion.
   - Delete `:69-82`; `@AC-10` below replaces it.
2. **Per-spec stub helper**, local to the file, with all state in the test's closure (design D-17,
   D-22). It registers three routes:
   - `**/xstockstrat.notify.v1.NotifyService/ListAlerts` — the unread set is the stored unread
     alerts plus every alert already streamed, minus the ids received in `MarkAlertRead` bodies.
     With `unreadOnly` in the request body it returns that set newest first; without it (the inbox)
     it returns every stored and streamed alert with `read: true` on the marked ones. Both carry
     `unreadCount` equal to the unread set's length.
   - `**/…/MarkAlertRead` — records `alertIds` and fulfils `{}`.
   - `**/…/StreamAlerts` — either holds every attempt on a promise that is never released, or
     awaits a test gate on attempt 1, then `fulfillStream(route, [alert])`, and holds every later
     attempt. No branch calls `route.continue()`.
3. **Scenarios**, each named with its `@AC-N`, the bell located by role, counts read from the badge
   inside the bell, rows read inside the drawer's `dialog`:
   - `@AC-3` — stored `DRAWER_ALERT_STORED_UNREAD` and `DRAWER_ALERT_STORED_READ`, stream held.
     Badge `1`; the opened drawer lists the unread title and not the read one; then
     `/accounts/notifications` shows `1 unread`.
   - `@AC-4` — stored `DRAWER_ALERT_STORED_UNREAD`, stream held. Open, press
     `Mark read: Backfill 67276d1f failed`; the drawer shows "No alerts"; the bell has no badge;
     on `/accounts/notifications` that row has `data-read="true"`.
   - `@AC-5` — stored `DRAWER_ALERT_STORED_UNREAD`, stream gated. Badge `1` with the drawer closed;
     add `DRAWER_ALERT_STREAMED` to the stub's streamed set and release the gate; the badge
     becomes `2` without a reload; the opened drawer lists "Order rejected" above
     "Backfill 67276d1f failed".
   - `@AC-9` — nothing stored, stream gated. Release the gate with `DRAWER_ALERT_STREAMED`; the
     stub adds it to the stored unread set only after the release. The opened drawer lists
     "Order rejected" exactly once and the badge shows `1`.
   - `@AC-10` — stored `DRAWER_ALERT_CLEAR_A` and `DRAWER_ALERT_CLEAR_B`, stream held. Badge `2`;
     open; press the button named `Clear all`; the drawer shows "No alerts"; the bell has no badge;
     the recorded `MarkAlertRead` ids hold both alerts; on `/accounts/notifications` both rows
     have `data-read="true"`.
4. **Waiting.** Never assert that the disconnected indicator is absent in these scenarios. Use
   auto-wait or `expect.poll`; any poll that crosses a fulfilled stream (`@AC-5`, `@AC-9`) gets a
   timeout of 10 s.
5. FR-8 agreement between bell and inbox is asserted only under the per-spec stubs; under the
   default mock the bell shows 5 and the inbox 2 (design.md § e2e plan).

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run lint && pnpm exec tsc --noEmit \
  && pnpm exec playwright test e2e/trader/alert-stream.spec.ts e2e/trader/stream-reconnect.spec.ts \
     e2e/accounts/notifications.spec.ts --project=chromium --no-deps
grep -n "from '../fixtures\|from '../helpers" e2e/trader/alert-stream.spec.ts
grep -n "route.continue" e2e/trader/alert-stream.spec.ts   # expect no match
```
RED before Step 14: `@AC-3` finds "No alerts" beside badge `1`; `@AC-4` finds no mark-read button;
`@AC-5` finds the badge still `1`; `@AC-9` finds no badge, because today's badge is fetched once on
mount; `@AC-10` finds both alerts unread on the Notifications page. The second and third spec files
keep three durable rules
green: `@AC-9 @feature-270` (reconnect), `@AC-5 @feature-271` (stream past the unary deadline) and
`@AC-6 @feature-203` (inbox). Not run in this session: a route handler that never settles, and the
brief disconnected indicator after a fulfilled stream; a failure there is a deviation to record,
not a reason to assert less. This is the step most likely to go red at execute for a harness
reason; a red scenario here leaves its `@AC` unverified (see "Running e2e in the execute sandbox").
Coverage: this step adds no `src/lib/**` code, so the 40% `src/lib/**` threshold
(`pnpm run test:coverage`, `ui/vitest.config.ts:29-33`) is unaffected; e2e runs and
`src/components/**` render tests are not coverage-gated.

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._

### Steps 1+2 — `StatTile` wrap guard and tile-fit tests (2026-11-15, SEV-3)

- **Render test needs a global `React`.** Codebase Evidence said a `.test.ts` importing a `.tsx`
  component already works; importing does, rendering does not: Vitest compiles the component's JSX
  to classic `React.createElement` (tsconfig `jsx: preserve`), so the first RED run failed with
  `ReferenceError: React is not defined`. `StatTile.test.ts` sets `globalThis.React` before
  rendering; no config file changed. Step 10's render test will need the same.
  **Disposition**: in-scope test detail, within Step 2's Files.
- **Position panel is not the active mobile tab.** Codebase Evidence said it is active by default
  (`SymbolPanelGroup.tsx:27,34`). It joins the Trade tabs only after `GetPosition` answers, by which
  time "Orders & fills" is active, so `@AC-8` clicks the "Position" radio first. The `GetPosition`
  stub alone renders the panel; no `ListAccounts` stub was needed (closes the Step 2 "not run" item).
  **Disposition**: in-scope test detail.
- **Value locator.** The label (`Eyebrow`) is also `font-mono`, so the e2e helper locates the value
  as the tile's `.font-mono.tabular-nums` child. **Disposition**: in-scope test detail.
- **Harness timeouts in the sandbox.** Under `pnpm dev` with `--no-deps` (no warmup project) the
  symbol page outlasts the 10 s local test timeout. `symbol-page-display.spec.ts` warms its one route
  in `beforeAll` and sets a 30 s per-test timeout (the CI value). The Verification's
  `mobile-overflow.spec.ts -g "/trader/positions"` command, unchanged, timed out on `page.goto` in
  two runs (not an overflow assertion); the Docker runner (`scripts/run-e2e.py`) failed to build
  (`corepack prepare pnpm@9.15.9` exit 1); the warmup project itself timed out. The same command
  with `--timeout=90000` passed 2/2. **Disposition**: CI-equivalent fallback — the `frontend-e2e`
  CI job (prod build, 30 s timeout) is the confirming run.
- **RED capture.** The Verification's `&&` chain stops at the red Vitest run, so the e2e RED was
  captured by running its Playwright sub-command alone: all three tests failed on the `scrollWidth`
  assertion (`Expected: <= 122`, `Received: 253` / `205` / `205`).
  **Disposition**: recorded; no unverified AC — `@AC-1` and `@AC-8` passed in a real Playwright run.

# Implementation Spec: watchlist-opportunity-signal-cues

**Status**: `in-progress`
**Created**: 2026-08-25
**Feature**: `docs/roadmap/features/155-watchlist-opportunity-signal-cues/feature.md`
**Total Steps**: 12
**Feature Branch**: `feature/watchlist-opportunity-signal-cues`
> Harness note (context.md): this session develops on the assigned
> `claude/watchlists-firing-queue-labels-w33an5` branch (from/into `main-dev`); the per-step-PR
> mechanics are adapted to that single branch.

---

## Execution Summary

UI-only feature in `xstockstrat-ui` (no proto/config/DB change). Built on **one shared
state→cue derivation** so firing/watching/quiet/no-data/in-queue is defined once and rendered
identically on every surface (design.md § Chosen Approach). Order: (1) build the shared spine —
a pure `readinessState()` bucketer in `readinessRollup.ts` + a `READINESS_CUE`/`IN_QUEUE_CUE`
render map with icons in `opportunityShared.tsx` — with unit tests; then apply it, one consumer
surface per step with its own e2e (C-14): (2) Watchlists readiness panel + firing-row jump, (3)
Opportunities desktop + mobile (cues + mobile grouping/tags), (4) the "Why this fired"
SignalReadiness panel; then the two independent fixes: (5) the unconditional Opportunities
breadcrumb, (6) the filter effective-source intersection. Every `service` step is code-bearing
(`TDD: red-green required`) and paired with an e2e/unit `test` step authored to fail first (P-06).

`xstockstrat-ui` has **no CI coverage threshold** (spec-template.md § coverage table: Next.js →
"use `pnpm test:e2e`"); the shared spine is pure `src/lib` logic covered by vitest unit tests
(`src/lib/**`, `all:false`, the feature-065 grow-the-floor scope). Each `service` step's paired
test carries the lint gate `cd services/xstockstrat-ui && pnpm run lint` (step-constraints §B).

### Consumer-surface coverage (C-14)

Product spec names one UI service, `xstockstrat-ui`, segments `/insights` (Watchlists +
Opportunities) and `/trader` (position-detail: SignalReadiness + breadcrumb). No new route → no
`PLATFORM_SUBNAV`/`NAV_GROUPS` entry (product-spec § Consumer Surfaces; context.md C-10(a) note).
Surfaces → steps: Watchlists → Steps 3/4; Opportunities desktop+mobile → Steps 5/6; SignalReadiness
→ Steps 7/8; position-detail breadcrumb → Steps 9/10; Opportunities filter → Steps 11/12.

### Scenario coverage (C-15) — every `@AC-*` → covering step

| Scenario | FR | Covered by |
|---|---|---|
| @AC-1 (firing color+icon, watchlists) | FR-1 | Step 4 |
| @AC-2 (watching color+icon, watchlists) | FR-1 | Step 4 |
| @AC-3 (in-queue icon parity, watchlists ∧ opportunities) | FR-1 | Step 4 (watchlists) + Step 6 (opportunities) |
| @AC-4 (icon always paired with text) | FR-1 | Step 4 |
| @AC-5 (firing row jump-to-detail) | FR-2 | Step 4 |
| @AC-6 (non-firing row: no jump) | FR-2 | Step 4 |
| @AC-7 (breadcrumb → Opportunities from opportunity entry) | FR-3 | Step 10 |
| @AC-8 (breadcrumb → Opportunities even from Exposure) | FR-3 | Step 10 |
| @AC-9 (mobile groups signals by symbol) | FR-4 | Step 6 |
| @AC-10 (mobile shows strategy/source/expiry tags) | FR-4 | Step 6 |
| @AC-11 (source filter narrows immediately) | FR-5 | Step 12 |
| @AC-12 (vanished source on refetch does not strand) | FR-5 | Step 12 |
| @AC-13 ("Why this fired" firing cue) | FR-1 | Step 8 |

## Step Dependencies

- **Steps 3, 5, 7 require Step 1** — every cue-rendering surface imports `readinessState`,
  `READINESS_CUE`, `IN_QUEUE_CUE`, and the icon-carrying `EnumBadge`/cue helper introduced in Step 1.
- **Step 2 covers Step 1** (unit tests for the pure bucketer + map data) — vitest `src/lib/**`.
- **Each even step covers the odd `service` step before it**: 4 covers 3, 6 covers 5, 8 covers 7,
  10 covers 9, 12 covers 11. (`xstockstrat-ui` is a frontend — the non-frontend coverage-threshold
  pairing of C-08 does not apply; the paired step is the e2e/unit proof + lint gate, P-06.)
- **Steps 9/10 (FR-3) and 11/12 (FR-5) are independent** of Steps 1–8 and of each other — no shared
  edit site. They may execute in any order relative to the cue work.
- **Step 10 must run a broad `-g`/full breadcrumb+mobile e2e scope** before being marked done
  (design.md Open Risks; ledger fails.md 2026-08-09 — the `Breadcrumb` collision surfaces on a
  *different* spec than the one under edit).
- **Fixture prerequisite (Steps 4/6):** the acceptance scenarios name symbols not in the current
  `OPPORTUNITIES`/`READINESS_BUCKET_OVERRIDE` fixtures (ELWT, BE, CAPR, HYLN, AARD). The test steps
  add them via the existing extension points (design.md Open Risks; C-12) — see each test step.

---

### Step 1 — service: Shared readiness state → cue derivation (the DRY spine)

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/readinessRollup.ts` — modify
- `services/xstockstrat-ui/src/lib/opportunityShared.tsx` — modify

**Reviewers**: xstockstrat-ui service owner — Trading UI correctness, analytics display accuracy,
Connect-RPC call safety

**Codebase Evidence**:
- `readinessRollup.ts` is a pure, unit-tested module: `isFiring(r)` at `readinessRollup.ts:11-13`
  (`r.totalConditions > 0 && r.passingConditions === r.totalConditions`); `rollupReadiness` at
  `:34-54` already branches the exact 4-way buckets in-line (`:43` nodata, `:45` `isFiring`→ready,
  `:47` `passingConditions > 0`→watching, `:49` else→quiet). `ReadinessCounts` at `:15-20`.
- The same 4-way branch is duplicated in three render-time variant pickers (design.md, "one shared
  bucketer" — do not add a 5th copy): `WatchlistReadiness.tsx:41-46` `barVariant`,
  `opportunities/page.tsx:38-43` `readinessVariant`, `SectionRenderer.tsx:60-66` inline
  `readyVariant`. Confirmed via Read.
- `opportunityShared.tsx`: `export type SemanticRole = 'buy' | 'sell' | 'paper' | 'secondary'`
  (`:12`); `export interface EnumRender { label; role }` (`:14-17`); four exhaustive
  `Record<Enum, EnumRender>` maps (`OPPORTUNITY_ACTION :20`, `CONDITION_STATE :28`,
  `POSITION_RISK_FLAG :35`, `SOURCE_HEALTH :43`) — **none gains a key**, so widening `SemanticRole`
  keeps `tsc` green (design.md round-1 adversary CONFIRMED); `EnumBadge({render})` renders
  `<Badge variant={render.role}>{render.label}</Badge>` (`:51-53`).
- `Badge` already has an `info` variant (`badge.tsx:26`) and an icon slot: the cva applies
  `[&>svg]:size-3!` to a **direct-child** svg (`badge.tsx:8`) — an icon is passed as a Badge child,
  never wrapped in a `<span>` (design.md Rejected Alternatives — wrapping breaks `[&>svg]`).
- Icons: `@phosphor-icons/react ^2.1.7` (`package.json:35`), already imported as named glyphs
  elsewhere (`SectionRenderer.tsx:3` `CaretRight, Warning`; `PlatformHeader.tsx:6` `List, Lightning,
  Sparkle, CaretRight`). Phosphor glyphs render an `<svg>` and forward `className`.

**TDD**: `red-green required`

**Covers**: `—` (paired unit tests in Step 2)

**Instructions**:
1. In `readinessRollup.ts`, add an exported string-union type and a pure bucketer that **reuses
   `isFiring`** and becomes the single source of the 4-way decision:
   ```ts
   export type ReadinessState = 'firing' | 'watching' | 'quiet' | 'nodata';
   export function readinessState(
     r: { passingConditions: number; totalConditions: number },
   ): ReadinessState {
     if (r.totalConditions === 0) return 'nodata';
     if (isFiring(r)) return 'firing';
     if (r.passingConditions > 0) return 'watching';
     return 'quiet';
   }
   ```
   Refactor `rollupReadiness` (`:41-52`) to derive each symbol's bucket from `readinessState(r)`
   (switch/lookup) instead of re-branching `isFiring`/`passingConditions` in-line — same counts,
   one decision site (design.md: collapse the duplicated branch, do not add a copy). The `!r`
   (missing row) case still maps to `nodata` before calling `readinessState`.
2. In `opportunityShared.tsx`:
   - Widen `SemanticRole` (`:12`) to `'buy' | 'sell' | 'paper' | 'secondary' | 'info'` (design:
     `info` is the in-queue color; `Badge` has the matching `info` variant, `badge.tsx:26`).
   - Add an optional icon reference to `EnumRender` (`:14-17`) — a **component reference**, keeping
     the map pure data so it stays node-env unit-testable:
     `icon?: React.ComponentType<{ className?: string }>` (add a `React`/`ComponentType` import).
   - Import the chosen Phosphor glyphs and add the readiness/queue cue maps (glyphs per design.md
     § Glyphs — verify each name resolves from `@phosphor-icons/react`, see Open Risk):
     ```ts
     import { Lightning, Eye, Moon, Question, Stack } from '@phosphor-icons/react';
     import { ReadinessState } from './readinessRollup';
     export const READINESS_CUE: Record<ReadinessState, EnumRender> = {
       firing:   { label: 'firing',  role: 'buy',       icon: Lightning },
       watching: { label: 'watching',role: 'paper',     icon: Eye },
       quiet:    { label: 'quiet',   role: 'secondary', icon: Moon },
       nodata:   { label: 'no data', role: 'secondary', icon: Question },
     };
     export const IN_QUEUE_CUE: EnumRender = { label: 'in queue', role: 'info', icon: Stack };
     ```
     (`READINESS_CUE.label` is the fallback label; watchlists overrides it with the dynamic
     `"N away"` — see Step 3. Keep the map exhaustive over `ReadinessState`, mirroring the existing
     exhaustive-`Record` C-10(a/d) guard the file's header comment describes at `:1-4`.)
   - Extend the icon rendering so a cue's `icon` shows as a **leading direct child** of the Badge
     in `EnumBadge` (`:51-53`), and provide a way to stamp the a11y/test hook the e2e asserts
     (design.md FIX A): the rendered icon carries `role="img"`, a **distinct** `aria-label` (the
     cue's `label`), and a `data-testid` of the form `readiness-cue-<state>` so
     `row.getByTestId('readiness-cue-firing')` resolves (Phosphor svgs have no accessible name by
     default — cf. `SectionRenderer.tsx:83`). Concretely: give `EnumBadge` an optional
     `testId?: string` prop and render `render.icon` as `<render.icon .../>` before the label with
     those attributes when present; callers that pass no icon (the four existing maps) are
     unchanged. Do **not** wrap the icon in a `<span>` (breaks the Badge `[&>svg]` slot).
3. Do not touch the four existing enum maps' entries or `EnumBadge`'s existing behavior for
   icon-less renders — this step is purely additive to them.

**Verification**:
- `cd services/xstockstrat-ui && pnpm run lint` — passes.
- `cd services/xstockstrat-ui && npx tsc --noEmit` (or `pnpm run build`) — passes; confirms the four
  `Record<Enum, EnumRender>` maps still compile after the `SemanticRole` widening and the `EnumRender`
  `icon?` addition (design's exhaustiveness argument).
- `grep -n "readinessState\|ReadinessState" src/lib/readinessRollup.ts` — the new export exists;
  `grep -n "READINESS_CUE\|IN_QUEUE_CUE\|icon" src/lib/opportunityShared.tsx` — the cue maps exist.
- (Behavioral proof is Step 2's unit tests.)

---

### Step 2 — test: Unit tests for the state bucketer + cue map data

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/readinessRollup.test.ts` — modify
- `services/xstockstrat-ui/src/lib/opportunityShared.test.ts` — create

**Reviewers**: xstockstrat-ui service owner — Trading UI correctness, analytics display accuracy

**Codebase Evidence**:
- `readinessRollup.test.ts` already exists (unit test for `isFiring`/`rollupReadiness`), confirmed
  via `ls src/lib/*.test.ts`. Vitest `include: ['src/**/*.test.ts']` (`vitest.config.ts:20`) —
  **`.test.ts` only, not `.test.tsx`**; coverage scoped to `src/lib/**`, `all:false` (`:25,33`), so
  a test exercising `readinessState`/the cue maps adds those files to the 40% grow-the-floor scope
  (insights.md 2026-07-13, feature 065).
- `opportunityShared.tsx` map data is pure (`icon` is an unrendered component reference), so a
  node-env `.test.ts` can import and assert it without JSX — copilot.test.ts already transitively
  imports `badge.tsx` in node env (`vitest.config.ts:15` comment), so importing `opportunityShared`
  (which imports `Badge`) is a proven-safe pattern.

**TDD**: `red-green required` (authored to fail against the pre-Step-1 tree — `readinessState`,
`READINESS_CUE`, `IN_QUEUE_CUE` do not exist yet).

**Covers**: `—` (unit-level proof of the shared spine; the `@AC-*` behaviors are proven at the
consumer surfaces in Steps 4/6/8/10/12)

**Instructions**:
1. Extend `readinessRollup.test.ts` with a `describe('readinessState')`: assert
   `{passing:3,total:3}` → `'firing'`, `{1,3}` → `'watching'`, `{0,3}` → `'quiet'`,
   `{0,0}` → `'nodata'`, `{3,0}`-style total-0 → `'nodata'`. Add one assertion that
   `rollupReadiness` still returns the same counts as before the refactor (a firing + a watching +
   a quiet + a nodata + a missing-row symbol → `{ready:1,watching:1,quiet:1,nodata:2}`), proving the
   refactor to `readinessState` is behavior-preserving.
2. Create `opportunityShared.test.ts` asserting the cue-map **data** contract: `READINESS_CUE` has
   exactly the four keys `firing/watching/quiet/nodata`; each entry has a non-empty `label`, a
   `role` that is a valid `SemanticRole` (firing→`buy`, watching→`paper`), and a defined `icon`
   (`typeof entry.icon !== 'undefined'`). Assert `IN_QUEUE_CUE.role === 'info'` and its `icon` is
   defined. (Data only — do not render; the render/a11y hooks are asserted by the Playwright steps.)

**Verification**:
- `cd services/xstockstrat-ui && pnpm run test:unit` — the new cases pass (and, run against the
  pre-Step-1 tree, fail to import `readinessState`/`READINESS_CUE`: the RED).
- `cd services/xstockstrat-ui && pnpm run test:coverage` — the `src/lib/**` 40% floor still passes
  (`readinessRollup.ts` + `opportunityShared.tsx` now counted; both are exercised).
- Test-data (C-12/C-13): these are pure-logic literals (state tuples, map keys), **not** mocked
  domain objects — no fixture home applies; inline is compliant. Recorded verdict, not blank.

---

### Step 3 — service: Watchlists readiness panel — state cues + firing-row jump (FR-1, FR-2)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/insights/WatchlistReadiness.tsx` — modify

**Reviewers**: xstockstrat-ui service owner — Trading UI correctness, analytics display accuracy,
Connect-RPC call safety

**Codebase Evidence**:
- The bound-row branch maps `evaluatedRows` at `WatchlistReadiness.tsx:208-261`; each row has
  `r.symbol` (`:218`), the `Progress variant={barVariant(r)}` bar (`:221-225`), the state-label
  `<span>` (`:226-237`) whose text is `stateLabel(r)` (`:236`) and whose color class is chosen
  in-line by `isFiring(r)`/`hasData(r)` (`:229-234`), the in-queue `Badge variant="info"
  data-testid="in-queue"` gated on `queued` (`:242-246`, `queued = inQueue?.has(...)` `:211`), the
  blocking condition (`:248-250`), and `BindingRowControls` (`:251-258`). `binding.strategyId` is
  present on every bound row (`bound = bindings.filter(b => b.strategyId)`, `:152`).
- `stateLabel(r)` at `:56-60` currently returns `"no data"` / `"firing"` / `"N away"` — it never
  emits `"quiet"` (a 0-passing evaluated row wrongly reads `"N away"`), the AC-4/AC-2 gap design.md
  FIX B fixes.
- `barVariant(r)` at `:41-46` is one of the three duplicated 4-way pickers to collapse onto
  `readinessState` (design.md § Chosen Approach).
- Reuse target for the jump (FR-2): the `reviewHref` shape in `opportunities/page.tsx:172-175`
  (`/trader/positions/${symbol}?strategy=${strategyId}`).
- `Link` is already the app's nav primitive (`next/link`, imported in `opportunities/page.tsx:3`).
- Imports already present: `isFiring, rollupReadiness` from `@/lib/readinessRollup` (`:17`),
  `Badge` (`:5`), `Progress` (`:6`).

**TDD**: `red-green required`

**Covers**: `—` (paired e2e in Step 4)

**Instructions**:
1. Import the shared spine: `readinessState` from `@/lib/readinessRollup` and
   `READINESS_CUE, IN_QUEUE_CUE, EnumBadge` from `@/lib/opportunityShared`.
2. **State cue (FR-1, AC-1/2/4):** rewrite `barVariant` and `stateLabel` to derive from
   `readinessState(r)` (do not keep the parallel `isFiring`/`hasData` branch — one bucketer, DRY):
   - `barVariant`: map `firing→'buy'`, `watching→'paper'`, `quiet→'sell'`, `nodata→'muted'`
     (preserves today's exact Progress colors, `progress.tsx:13-26`).
   - `stateLabel`: `firing→'firing'`, `watching→`\`${r.totalConditions - r.passingConditions} away\`,
     `quiet→'quiet'` (the FIX B correction), `nodata→'no data'`.
   - In the state-label `<span>` (`:226-237`), render the cue icon **beside** the text via the
     Step-1 icon-carrying badge/`EnumBadge` so color **+** icon **+** text are all present
     (AC-4 — icon never sole differentiator): pass the `READINESS_CUE[state]` render but with the
     dynamic `stateLabel` as its label, and `testId={`readiness-cue-${state}`}`. Keep the existing
     text color classes (`:227-234`) or fold them into the badge — the visible state text
     (`firing`/`N away`/`quiet`/`no data`) must remain present in the row's text content.
3. **In-queue cue (FR-1, AC-3):** replace the literal `in queue` badge (`:242-246`) with the shared
   `IN_QUEUE_CUE` render (icon + `info` color + "in queue" text) via `EnumBadge`, keeping
   `data-testid="in-queue"` on the badge and the `queued` gate unchanged. The icon is
   `IN_QUEUE_CUE.icon` (`Stack`) — assert-able as `readiness-cue-*` is not needed here; the e2e keys
   off `in-queue` + the icon.
4. **Firing-row jump (FR-2, AC-5/6):** in the bound-row branch only, render a `Link` to
   `/trader/positions/${r.symbol}?strategy=${binding.strategyId}` (reusing the `reviewHref` shape),
   placed beside `BindingRowControls` (`:251-258`), rendered **only when `isFiring(r)`** (non-firing
   rows show nothing — AC-6). Give the link an explicit, **distinct** `aria-label` (e.g.
   `Open ${r.symbol} detail`) and a stable `data-testid` (e.g. `jump-${binding.symbol}`) so it never
   collides with the symbol text or the cue icon's accessible name (design.md FR-2 / round-2
   adversary; ledger fails.md 2026-08-09 role/label-collision class). Do **not** add a jump to the
   unbound-row branch (`:264-287`) — unbound rows have no strategy and never fire.

**Verification**:
- `grep -n "readinessState\|IN_QUEUE_CUE\|isFiring(r)\|jump-\|Open " src/components/insights/WatchlistReadiness.tsx`
  — confirms cue wiring + the `isFiring`-gated jump link.
- Lint runs in Step 4's verification (`cd services/xstockstrat-ui && pnpm run lint`).
- No new outbound gRPC call is added (the panel already calls `evaluateReadiness` via `useQueries`,
  `:162-167`) — header-propagation gate N/A; recorded, not blank.

---

### Step 4 — test: e2e for Watchlists cues + firing-row jump

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/insights/watchlists.spec.ts` — modify
- `services/xstockstrat-ui/e2e/mock-backend.ts` — modify (extend `READINESS_BUCKET_OVERRIDE` if a
  dedicated firing/non-firing symbol pair is needed beyond the existing `READY1`/`WATCH1`)
- `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md` — modify (only if a new fixture symbol is added)

**Reviewers**: xstockstrat-ui service owner — Trading UI correctness, analytics display accuracy

**Codebase Evidence**:
- `watchlists.spec.ts` already drives the readiness panel: it adds `READY1 WATCH1 QUIET1 NODATA1`
  and asserts the rollup + per-row states (`:288-301`), asserts `"1 away"` + `getByTestId('in-queue')`
  for an AAPL "2 of 3" row that is on the queue (`:82-84`), and scopes selectors under
  `getByTestId('readiness-row-<sym>')` (`:27,44-50,351-358`).
- The bucket mock exists: `READINESS_BUCKET_OVERRIDE` (`mock-backend.ts:72-80`) forces
  `READY1`=3/3 (firing), `WATCH1`=1/3, `QUIET1`=0/3, `NODATA1`=0/0, spread over `symbolReadiness` in
  `evaluateReadiness` (`:663-668`); the in-queue mark is driven by `ListOpportunities`
  (`WatchlistDetail.tsx:83`, per INVENTORY.md:25). `symbolReadiness`/bucket rows catalogued in
  `INVENTORY.md:26,50`. Watchlist seeding via `mockWatchlists(page, seed)` (`helpers/watchlistMock.ts:29`).

**TDD**: `red-green required` (assertions on the firing icon `readiness-cue-firing`, the `"quiet"`
text, the in-queue icon, and the firing-row jump link fail on the pre-Step-3 tree).

**Covers**: `AC-1, AC-2, AC-3, AC-4, AC-5, AC-6`

**Instructions**:
1. Reuse the existing `READY1/WATCH1/QUIET1/NODATA1` bucket symbols (they already produce
   firing/watching/quiet/no-data). If a scenario needs a *bound firing* row for the jump (AC-5) and a
   *non-firing bound* row for AC-6, seed a watchlist via `mockWatchlists` binding a firing symbol
   (e.g. `READY1`, or add a dedicated `HYLN`=3/3 + `AARD`=1/3 pair to `READINESS_BUCKET_OVERRIDE`
   with a catalog row in `INVENTORY.md`). Prefer extending the existing override map over new
   fixtures (C-12: a new domain symbol gets a catalog row in the same step; overrides are the
   established extension point).
2. **AC-1 (firing):** a bound 3/3 row shows the buy/green cue — assert, scoped to that
   `readiness-row-*`, `getByTestId('readiness-cue-firing')` visible **and** the text `firing` visible.
3. **AC-2 (watching):** a bound 2/3 (or 1/3) row shows the paper/amber cue —
   `getByTestId('readiness-cue-watching')` visible and the dynamic `"N away"` text visible.
4. **AC-3 (in-queue, watchlists half):** for a symbol on the opportunity queue, the row's
   `getByTestId('in-queue')` badge is visible and contains the in-queue icon (assert the badge and
   its svg/`role="img"` icon). This is the same `IN_QUEUE_CUE` render Step 6 asserts on the
   Opportunities surface — reference the shared map so the parity is explicit.
5. **AC-4 (icon + text, never icon-only):** for a firing, watching, quiet, and no-data row, assert
   both the `readiness-cue-<state>` icon **and** the state's text (`firing` / `N away` / `quiet` /
   `no data`) are present in the row. Include the `quiet` case explicitly (the FIX B regression: a
   0-passing evaluated row now reads `"quiet"`, not `"N away"`).
6. **AC-5 (firing-row jump):** on a firing bound row for a symbol bound to a strategy, activate the
   row's jump action (`getByTestId('jump-<symbol>')` / the `Open <symbol> detail` link) and assert
   navigation to `/trader/positions/<symbol>?strategy=<strategyId>` (assert the link `href`, or click
   and assert `page.url()`).
7. **AC-6 (non-firing: no jump):** on a non-firing bound row (e.g. "2 away"), assert the jump
   action is **absent** (`getByTestId('jump-<symbol>')` count 0 within that row).

**Verification**:
- `cd services/xstockstrat-ui && pnpm test:e2e -- watchlists` — all new cases pass.
- `cd services/xstockstrat-ui && pnpm run lint` — passes (the code-quality gate for Step 3).
- `grep -n "from '../fixtures'\|helpers/watchlistMock\|READINESS_BUCKET_OVERRIDE" e2e/insights/watchlists.spec.ts e2e/mock-backend.ts`
  — confirms test data comes from the mock/fixture homes (C-12), not inline domain literals; confirm
  `INVENTORY.md` updated iff a new symbol was added.

---

### Step 5 — service: Opportunities desktop + mobile — cues, in-queue, mobile grouping + tags (FR-1, FR-4)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/insights/opportunities/page.tsx` — modify
- `services/xstockstrat-ui/src/components/mobile/sections.ts` — modify
- `services/xstockstrat-ui/src/components/mobile/SectionRenderer.tsx` — modify

**Reviewers**: xstockstrat-ui service owner — Trading UI correctness, analytics display accuracy,
Connect-RPC call safety

**Codebase Evidence**:
- Desktop: `readinessVariant(passing,total)` at `opportunities/page.tsx:38-43` is the 2nd duplicated
  4-way picker (collapse onto `readinessState`). `SymbolGroupCard` header at `:393-403` (the symbol
  `Link` + `{n} signal(s)` count — the per-symbol slot where the in-queue cue belongs, AC-3);
  `OpportunityRow` at `:421-523` renders the action badge (`EnumBadge render={OPPORTUNITY_ACTION[o.action]}`,
  `:450`), the strategy id (`:452-454`), provenance chips (`opportunityChips(o)` `:46-48`, rendered
  `:455-459`), the expiry (`expiresLabel(o.validUntil)` `:61-65`, rendered `:460-462`), and the
  readiness meter (`:480-490`).
- Mobile model: `mobileSections` builds one `{kind:'signal', …}` per row (`:179-188`) — carries
  `badge/conviction/readiness/caption/href/muted` only, **no** `strategyId`/chips/expiry. `symbolGroups`
  (the desktop per-symbol grouping) at `:192-200`.
- `sections.ts:9-28`: the `Section` union; the `signal` kind fields at `:12-23`. `SectionRenderer.tsx`
  renders `sections.map` **flat** (`:22-24`, no nesting); the `signal` case body is `:55-138` (its
  inline `readyVariant` 4-way picker at `:60-66` is the 3rd duplicate; the `mobile-muted-${symbol}`
  testid at `:74`; `EnumBadge` for `s.badge` at `:80`).
- `IN_QUEUE_CUE`/`READINESS_CUE`/`EnumBadge` from Step 1; `opportunityChips`/`expiresLabel` are file-
  local helpers already in `opportunities/page.tsx`. The in-queue set for opportunities is inherent —
  every listed row *is* in the queue — so the SymbolGroupCard header renders `IN_QUEUE_CUE` directly.

**TDD**: `red-green required`

**Covers**: `—` (paired e2e in Step 6)

**Instructions**:
1. **Desktop cues (FR-1):** replace `readinessVariant` (`:38-43`) with a derivation from
   `readinessState({passingConditions, totalConditions})` (import from `@/lib/readinessRollup`),
   mapping to the same `buy/paper/sell/muted` Progress variants. Optionally surface the
   `READINESS_CUE[state]` icon beside the `OpportunityRow` readiness meter label (`:476-494`) so the
   desktop readiness state is icon-coded consistently with Watchlists — keep the existing `N/M`
   count text (icon + color + text).
2. **In-queue cue on opportunities (FR-1, AC-3):** in the `SymbolGroupCard` header (`:393-403`),
   render the shared `IN_QUEUE_CUE` via `EnumBadge` (icon + `info` color + "in queue" text) — the
   same render Step 3 uses on Watchlists, giving AC-3's "same in-queue icon and info color" parity.
   Add a stable hook (e.g. `data-testid="opportunity-in-queue"`) for the e2e.
3. **Mobile grouping (FR-4, AC-9):** add a `signalGroup` section kind to `sections.ts`:
   `{ kind:'signalGroup'; symbol: string; href?: string; signals: <the signal fields minus kind>[] }`
   (no `count` — use `signals.length`, design.md). Extend the existing `signal` kind (`:12-23`) with
   `strategyId?: string`, `chips?: string[]`, `expiry?: string`.
4. In `SectionRenderer.tsx`, **extract** the current `signal`-case body (`:67-126`) into one shared
   `SignalRow` component (no orphaned duplicate — design.md / C-10), preserving the
   `mobile-muted-${symbol}` testid (`:74`) and rendering the new `strategyId`/`chips`/`expiry` when
   present (mirroring the desktop `OpportunityRow` tags). Render `SignalRow` from **both** the
   `signal` case and a new `signalGroup` case; `signalGroup` draws a card whose header mirrors
   `SymbolGroupCard` (`opportunities/page.tsx:393-403`) with the symbol + `signals.length` and its
   own `mobile-sections`-consistent container. Replace the inline `readyVariant` (`:60-66`) with
   `readinessState` (or keep it inside `SignalRow` deriving from it) — one bucketer.
5. In `opportunities/page.tsx`, change `mobileSections` (`:179-188`) to build from `symbolGroups`
   (`:192-200`) — one `signalGroup` per symbol, each `signals[]` carrying `badge`, `conviction`,
   `readiness`, `caption`, `href` (`reviewHref(o)`), `muted`, **and** the newly-surfaced
   `strategyId: o.strategyId || undefined`, `chips: opportunityChips(o)`, `expiry:
   expiresLabel(o.validUntil)` (AC-10). Keep the `sm:hidden` `SectionRenderer` wiring (`:309-325`)
   unchanged.

**Verification**:
- `grep -n "readinessState\|IN_QUEUE_CUE\|signalGroup\|SignalRow\|strategyId\|expiry" src/app/insights/opportunities/page.tsx src/components/mobile/sections.ts src/components/mobile/SectionRenderer.tsx`
  — confirms the shared cue, the in-queue badge, the new section kind, the shared row, and the tags.
- Lint runs in Step 6's verification.
- No new outbound gRPC call (the page already calls `useOpportunities`/`listPortfolios`,
  `page.tsx:86,119-124`) — header-propagation gate N/A; recorded.

---

### Step 6 — test: e2e for Opportunities in-queue cue + mobile parity

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/insights/opportunities.spec.ts` — modify
- `services/xstockstrat-ui/e2e/fixtures/opportunities.ts` — modify (add the CAPR pair)
- `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md` — modify (catalog the CAPR rows)

**Reviewers**: xstockstrat-ui service owner — Trading UI correctness, analytics display accuracy

**Codebase Evidence**:
- `opportunities.spec.ts` drives the real `ListOpportunities` chain, exercises source-chip filtering
  and per-card badges, and asserts on the desktop cards; the mobile view is the `sm:hidden`
  `SectionRenderer` (`page.tsx:309-325`). Existing `OPPORTUNITIES` fixture (`e2e/fixtures/opportunities.ts`)
  already carries an `AMZN` two-strategy pair (`:94-121`) — the grouping precedent — and each row's
  Connect-JSON shape (`symbol/action/conviction/strategyId/source/validUntil/provenance`), catalogued
  in `INVENTORY.md:25`. Mobile container testid `mobile-sections` (`SectionRenderer.tsx:21`);
  muted marker `mobile-muted-${symbol}` (`:74`).
- Mobile assertions must run on a mobile viewport (`sm:hidden` gates the mobile tree) — follow the
  existing project pattern for mobile-view specs (`page.setViewportSize` to a phone width so
  `sm:hidden` is active) if the spec is not already project-configured for it.

**TDD**: `red-green required` (mobile grouping into one card, the mobile strategy/source/expiry tags,
and the opportunities in-queue icon all fail on the pre-Step-5 tree — mobile currently renders flat
`signal` rows with no tags).

**Covers**: `AC-3, AC-9, AC-10`

**Instructions**:
1. Add a `CAPR` pair to `OPPORTUNITIES` (design.md Open Risk — fixtures): two rows, strategies
   `quality-dip-buy` and `momentum`, `source: 'watchlist'`, an expiry whose local `HH:MM` renders
   `14:30` (a `validUntil.seconds` chosen so `expiresLabel` → `14:30`; follow the existing
   `VALID_UNTIL` bigint pattern at `opportunities.ts:8`). Add a catalog row to `INVENTORY.md`
   (C-12 — a new domain symbol gets a fixture + catalog entry in the same step).
2. **AC-3 (in-queue, opportunities half):** assert the `CAPR` desktop card header shows the in-queue
   cue (`opportunity-in-queue` testid) with its icon and `info` color — the same `IN_QUEUE_CUE`
   render Step 4 asserts on Watchlists (state the parity in a comment referencing the shared map).
3. **AC-9 (mobile grouping):** on a mobile viewport, assert `CAPR` renders as a **single** grouped
   card containing both its signals (one `signalGroup` card, not two top-level `signal` rows) — e.g.
   one card element for `CAPR` with two signal rows beneath it. Reuse the existing `AMZN` pair or the
   new `CAPR` pair.
4. **AC-10 (mobile tags):** on a mobile viewport, for the `CAPR` signal assert the strategy id
   (`quality-dip-buy`), a `watchlist` source chip, and the expiry `14:30` are all visible in the
   mobile card (they are absent today).

**Verification**:
- `cd services/xstockstrat-ui && pnpm test:e2e -- opportunities` — new cases pass.
- `cd services/xstockstrat-ui && pnpm run lint` — passes (code-quality gate for Step 5).
- `grep -n "from '../fixtures'\|from './fixtures'\|OPPORTUNITIES\|CAPR" e2e/insights/opportunities.spec.ts e2e/fixtures/opportunities.ts`
  — test data from the fixture home (C-12); confirm `INVENTORY.md` carries the CAPR row.

---

### Step 7 — service: "Why this fired" (SignalReadiness) firing cue (FR-1, AC-13)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/insights/SignalReadiness.tsx` — modify

**Reviewers**: xstockstrat-ui service owner — Trading UI correctness, analytics display accuracy,
Connect-RPC call safety

**Codebase Evidence**:
- `SignalReadiness.tsx` is the user-confirmed 4th cue surface (design.md; context.md 2026-08-25
  "4th surface IN SCOPE"). The summary line at `:86-103` renders the conviction `Progress` +
  `{readiness.passingConditions}/{readiness.totalConditions} conditions` text (`:87-94`).
  `readiness` (`:51`) carries `conviction`, `passingConditions`, `totalConditions`, `conditions[]`
  — the exact shape `readinessState`/`isFiring` accept.
- The file already imports `EnumBadge` + `CONDITION_STATE` from `@/lib/opportunityShared` (`:7`) and
  `Progress` (`:5`); it is rendered on `/trader/positions/[symbol]` (used by that page, confirmed via
  grep) and `/insights/market/[symbol]`.

**TDD**: `red-green required`

**Covers**: `—` (paired e2e in Step 8)

**Instructions**:
1. Import `readinessState` from `@/lib/readinessRollup` and `READINESS_CUE` from
   `@/lib/opportunityShared`.
2. In the summary line (`:86-103`), when `readinessState(readiness) === 'firing'` (i.e. a
   3/3-conditions trace), render the firing cue — the same `READINESS_CUE.firing` icon (`Lightning`)
   and buy/green color used on Watchlists and Opportunities — alongside the existing `"N/M
   conditions"` text, via the Step-1 icon-carrying `EnumBadge` (`testId="readiness-cue-firing"`).
   Do not alter the non-firing rendering, the exit-rule badge (`:95-102`), the per-condition list
   (`:104-125`), or the track-record block (`:129-145`) — this is a single additive cue on the
   summary line (design.md § FR-1 4th surface, minimal edit).

**Verification**:
- `grep -n "readinessState\|READINESS_CUE\|readiness-cue-firing" src/components/insights/SignalReadiness.tsx`
  — confirms the firing cue on the summary line.
- Lint runs in Step 8's verification. No new outbound gRPC call (the panel already calls
  `useReadiness`/`useOpportunities`/`useStrategyAnalytics`, `:34,46-53`) — header-propagation N/A.

---

### Step 8 — test: e2e for the "Why this fired" firing cue

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/trader/position-detail.spec.ts` — modify
- `services/xstockstrat-ui/e2e/mock-backend.ts` — modify (only if a 3/3 firing readiness for the
  target symbol/strategy is not already producible)

**Reviewers**: xstockstrat-ui service owner — Trading UI correctness, analytics display accuracy

**Codebase Evidence**:
- `position-detail.spec.ts` already drives `/trader/positions/<symbol>?strategy=<id>` and the
  `signal-readiness` panel (e.g. `:299` `?strategy=strat-live-001`, `:349-355` interacts with
  `Strategy for Why this fired`). The panel testid is `data-testid="signal-readiness"`
  (`SignalReadiness.tsx:56`).
- `evaluateReadiness` mock returns `symbolReadiness` (2/3) by default and honors
  `READINESS_BUCKET_OVERRIDE` (`mock-backend.ts:650-668`); a firing (3/3) trace for the panel needs
  a symbol whose `EvaluateReadiness` returns `passingConditions === totalConditions` with a full
  `conditions[]` (extend `symbolReadiness` for a dedicated firing symbol, or add a `conditions`-
  bearing 3/3 override — the panel needs `conditions.length > 0` to render the summary, `:80`).

**TDD**: `red-green required` (the `readiness-cue-firing` cue on the panel summary line fails on the
pre-Step-7 tree).

**Covers**: `AC-13`

**Instructions**:
1. Ensure a firing (3/3, non-empty conditions) readiness is producible for a `(symbol, strategy)`
   the spec opens (e.g. `HYLN` + `quality-dip-buy`, or reuse an existing firing fixture) — extend the
   `evaluateReadiness` mock/fixture if needed, keeping the change to a dedicated symbol so other
   specs' default 2/3 shape is untouched (mirrors the `READINESS_BUCKET_OVERRIDE` discipline).
2. Navigate to `/trader/positions/<symbol>?strategy=<id>` for that firing pair; within
   `getByTestId('signal-readiness')` assert the summary line shows `getByTestId('readiness-cue-firing')`
   (the Lightning icon, buy/green) **and** the existing `"3/3 conditions"` text (AC-13).

**Verification**:
- `cd services/xstockstrat-ui && pnpm test:e2e -- position-detail` — the AC-13 case passes.
- `cd services/xstockstrat-ui && pnpm run lint` — passes (code-quality gate for Step 7).
- `grep -n "from '../fixtures'\|symbolReadiness\|READINESS_BUCKET_OVERRIDE" e2e/trader/position-detail.spec.ts e2e/mock-backend.ts`
  — test data from the mock/fixture homes (C-12).

---

### Step 9 — service: Position-detail breadcrumb → unconditional Opportunities (FR-3)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/trader/positions/[symbol]/page.tsx` — modify

**Reviewers**: xstockstrat-ui service owner — Trading UI correctness, analytics display accuracy

**Codebase Evidence**:
- The breadcrumb call is at `positions/[symbol]/page.tsx:377-380`:
  `<PageBreadcrumb ariaLabel="Position path" items={[{ label: 'Exposure', href: '/trader/positions' }, { label: symbol }]} />`.
- `PageBreadcrumb` (`components/shared/PageBreadcrumb.tsx:26-48`) renders each non-last item with an
  `href` as a `BreadcrumbLink` and the last as `BreadcrumbPage`; `ariaLabel` has no default (the
  deliberate collision guard, `:11-16`).
- The nav renders an "Opportunities" `Link` on every page (`navGroups.tsx`, Decide group) — so
  AC-7/AC-8 must assert **inside** `getByLabel('Position path')`, not page-wide (design.md FIX C;
  ledger fails.md 2026-08-09).

**TDD**: `red-green required`

**Covers**: `—` (paired e2e in Step 10)

**Instructions**:
1. Change the first breadcrumb crumb (`:379`) from `{ label: 'Exposure', href: '/trader/positions' }`
   to `{ label: 'Opportunities', href: '/insights/opportunities' }`, **unconditionally** — for every
   entry point (design.md § FR-3, user-mandated CHANGE; context.md 2026-08-25 signed off). Keep
   `ariaLabel="Position path"` and the terminal `{ label: symbol }` crumb unchanged. Do not thread a
   `?from` param and do not branch on origin. Update the adjacent comment (`:375-376`) to reflect that
   the first crumb now returns to Opportunities (it currently references the old "← Exposure"
   rationale).

**Verification**:
- `grep -n "Opportunities\|/insights/opportunities\|Position path" src/app/trader/positions/[symbol]/page.tsx`
  — confirms the crumb label + href changed and `ariaLabel` is intact.
- Lint runs in Step 10's verification.

---

### Step 10 — test: e2e for the Opportunities breadcrumb (scoped, broad-swept)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/trader/position-detail.spec.ts` — modify
- `services/xstockstrat-ui/e2e/breadcrumb.spec.ts` — modify (only if the "Position detail" crumb
  assertion needs updating for the new first crumb — see below)

**Reviewers**: xstockstrat-ui service owner — Trading UI correctness, analytics display accuracy

**Codebase Evidence**:
- `breadcrumb.spec.ts` asserts, for the "Position detail (new)" site
  (`/trader/positions/AAPL`), `getByLabel('Position path', {exact:true})` count 1 (`:117`) and
  `getByRole('link', {name:'AAPL', exact:true})` count 1 (`:122-124`). The new first crumb is a
  **distinct** link name ("Opportunities"), so both AAPL-keyed exact-count-1 invariants stay green
  (design.md FIX C) — but re-run this spec to confirm.
- `position-detail.spec.ts` navigates to `/trader/positions/AAPL` and `…?strategy=…` (`:18,299`).
- `PageBreadcrumb` first crumb links `href="/insights/opportunities"` after Step 9; the nav's own
  "Opportunities" `Link` also exists → AC-7/AC-8 **must scope inside** `getByLabel('Position path')`.

**TDD**: `red-green required` (asserting the first crumb is "Opportunities" → `/insights/opportunities`
fails on the pre-Step-9 tree, where it is "Exposure" → `/trader/positions`).

**Covers**: `AC-7, AC-8`

**Instructions**:
1. **AC-7:** open `/trader/positions/CAPR` by activating an opportunity (or directly, per the
   product spec's unconditional design — the crumb is origin-independent). Within
   `getByLabel('Position path', {exact:true})`, assert the **first** crumb is a link labeled exactly
   `Opportunities` whose `href` is `/insights/opportunities` (scope the `getByRole('link', {name:
   'Opportunities', exact:true})` **under** the "Position path" landmark so it does not match the
   global nav link).
2. **AC-8:** open `/trader/positions/CAPR` from the Exposure table (as `position-detail.spec.ts:57-64`
   enters, clicking the Exposure symbol) and assert the identical breadcrumb outcome — the first
   crumb is "Opportunities" → `/insights/opportunities`, **not** "Exposure" — proving it is
   unconditional.
3. If `breadcrumb.spec.ts`'s "Position detail" case has any assertion that presumed an "Exposure"
   first crumb, update it; otherwise leave it (its AAPL-keyed count-1 invariants are unaffected).

**Verification**:
- `cd services/xstockstrat-ui && pnpm test:e2e -- position-detail` — AC-7/AC-8 pass.
- **Broad sweep (design.md Open Risks; ledger 2026-08-09):** before marking this step done, run the
  wider breadcrumb + mobile scope, not just this spec:
  `cd services/xstockstrat-ui && pnpm test:e2e -- -g "breadcrumb|Breadcrumb|Position|mobile"`
  (or the full suite) — confirms no `getByRole('link')`/`getByLabel` collision surfaced on a
  *different* spec (the failure mode that spec's own run cannot catch).
- `cd services/xstockstrat-ui && pnpm run lint` — passes (code-quality gate for Step 9).

---

### Step 11 — service: Opportunities filter — effective-source intersection (FR-5)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/insights/opportunities/page.tsx` — modify

**Reviewers**: xstockstrat-ui service owner — Trading UI correctness, analytics display accuracy,
Connect-RPC call safety

**Codebase Evidence**:
- Recon confirmed **no** staleness in the `sources` derivation (built from **unfiltered**
  `opportunities`, `page.tsx:129-132`) and `ToggleGroup` is plain controlled Radix (`:257-267`).
  The one real defect (design.md FR-5, recon Risk): `activeSources` (`:90`) is never reconciled
  against the current `sources`; `useOpportunities` refetches every 15s (`useOpportunities.ts:21`),
  so if a selected source vanishes from a later fetch, its (now hidden) pill's filter still applies
  → empty list with **no visible active pill** ("stuck"). The row filter applies `activeSources` at
  `:141` (`activeSources.length === 0 || activeSources.includes(o.source)`); the pill active state
  is `activeSources.length === 0` (`:253`) / `activeSources.includes(s)` (`:262`).

**TDD**: `red-green required`

**Covers**: `—` (paired e2e in Step 12)

**Instructions**:
1. Compute a render-time **effective** source set:
   `const effectiveSources = activeSources.filter((s) => sources.includes(s));` (place it after
   `sources` `:129-132` and before `rows` `:134`). Leave stored `activeSources` **untouched** so a
   vanished-then-returning source re-activates (design.md § FR-5). Add `effectiveSources` (or
   `sources`) to the `rows` `useMemo` dependency array if not already covered by `activeSources`.
2. In the `rows` filter (`:141`), use `effectiveSources` instead of `activeSources`:
   `(effectiveSources.length === 0 || effectiveSources.includes(o.source))`. This makes a
   filter keyed only on sources that still exist — a selection referencing a vanished source falls
   back to showing the available rows (AC-12), while "All sources" (`activeSources=[]` →
   `effectiveSources=[]` → all rows) is unchanged (AC-11 pass-through).
3. Drive the pill active state from `effectiveSources` too: the per-source `ToggleGroupItem` active
   class (`:262`) and `aria-pressed`/active semantics should reflect `effectiveSources.includes(s)`
   so a stale/vanished source shows no phantom active pill. "All sources" stays
   `activeSources.length === 0` (an empty selection is genuinely "all").
4. **Do not add a `useEffect` that mutates `activeSources`** — it loops on the 15s `refetchInterval`
   and silently wipes the selection on a transient empty fetch (design.md Rejected Alternatives;
   this is the whole point of the render-time intersection). `actionFilter` needs no reconcile
   (static options `:274-277`).

**Verification**:
- `grep -n "effectiveSources\|activeSources" src/app/insights/opportunities/page.tsx` — confirms the
  intersection is computed and used in the filter + pill state, and that no mutating `useEffect` on
  `activeSources` was introduced (`grep -n "useEffect" src/app/insights/opportunities/page.tsx`
  should show only the pre-existing localStorage-hydration effect `:100-105`).
- Lint runs in Step 12's verification. No new outbound gRPC call — header-propagation N/A.

---

### Step 12 — test: e2e for filter responsiveness (in-place refetch RED)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/insights/opportunities.spec.ts` — modify

**Reviewers**: xstockstrat-ui service owner — Trading UI correctness, analytics display accuracy

**Codebase Evidence**:
- `opportunities.spec.ts` already has a source-filter test (`getByRole('button', {name:
  'marketwatch'}).click()` then asserts the queue narrows, `:83-108`) and an "All sources"
  `aria-pressed` test (`:134-139`) — the AC-11 shape already exists to extend.
- The spec already uses a **per-page stateful `page.route()`** mock of `ListOpportunities`
  (`:27-50`, the `watchlistMock.ts` isolation pattern) — the exact mechanism needed to return a
  **shrunk source set on a later fetch**.
- Design.md FIX D (ledger 074/080): the RED must drive fetch #2 **in place** (a window `focus`
  event → React Query `refetchOnWindowFocus`, or a manual `refetchQueries`) with a closure-counter
  `page.route` returning the shrunk source set on the 2nd call — **never `page.reload()`** (a reload
  remounts and resets `activeSources`, so the stuck state never forms → vacuous green).

**TDD**: `red-green required` (AC-12 must be proven RED on the pre-Step-11 tree — the stuck-empty,
no-active-pill state — before the fix makes it green; AC-11 already passes and guards no regression).

**Covers**: `AC-11, AC-12`

**Instructions**:
1. **AC-11 (source narrows immediately):** with rows from `watchlist` and `screener` sources
   present, select only the `watchlist` source pill and assert the pill shows active and only
   `watchlist`-sourced rows remain visible. (Extend the existing `:83-108` test or add sources to
   the per-page mock; `screener`/`watchlist` sources may need adding to the mocked `ListOpportunities`
   payload — reuse `OPPORTUNITIES`/fixtures, C-12.)
2. **AC-12 (vanished source does not strand):** using a **closure-counter** `page.route` on
   `ListOpportunities` that returns a queue **with** `screener` rows on the 1st fetch and **without**
   any `screener` rows on the 2nd, select only the `screener` pill (rows visible), then trigger an
   **in-place** refetch (dispatch a window `focus` event, or call `queryClient.refetchQueries` /
   `page.evaluate` on the React Query cache) — **not** `page.reload()`. Assert the queue does **not**
   become stuck empty with no active pill: the available (non-`screener`) rows show and no phantom
   `screener` filter remains applied (no active `screener` pill).
3. Prove AC-12 is RED against `main-dev`/pre-Step-11 before Step 11's fix (P-06 / design FIX D):
   without the effective-source intersection, the stuck-empty state forms and the assertion fails.

**Verification**:
- `cd services/xstockstrat-ui && pnpm test:e2e -- opportunities` — AC-11 + AC-12 pass after Step 11;
  AC-12 demonstrably fails before it (capture the RED per the TDD gate).
- `cd services/xstockstrat-ui && pnpm run lint` — passes (code-quality gate for Step 11).
- `grep -n "page.route\|ListOpportunities\|reload\|focus\|refetch" e2e/insights/opportunities.spec.ts`
  — confirms the in-place refetch mechanism and the **absence** of `page.reload()` in the AC-12 test.

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._

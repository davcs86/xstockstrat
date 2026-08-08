# Recon: shadcn-migration-high-confidence

**Created**: 2026-08-08
**From**: product-spec.md
**Affected services**: `xstockstrat-ui`

---

## Objective

Replace 27 high-confidence hand-rolled UI shapes across 12 `xstockstrat-ui` files with shared
`ui/*` primitives — 8 new (Tabs, Toggle Group, Alert Dialog, Alert, Checkbox, Breadcrumb,
Accordion, Progress) and 3 already-existing-but-bypassed (Badge, Skeleton, Textarea) — as a
like-for-like markup substitution with no visual/behavioral redesign.

## Codebase Map

- **`xstockstrat-ui`** (Next.js / TypeScript)
  - Preset config: `services/xstockstrat-ui/components.json:3` — `"style": "radix-rhea"`
    (matches CLAUDE.md's `bLTl5gh6` preset claim and sibling feature 123's context.md finding).
  - Styling conventions: `services/xstockstrat-ui/CLAUDE.md:31-58` § Styling — `npx shadcn@latest
    add <name>` for new primitives; `apply --preset bLTl5gh6 --yes` to re-apply; app-specific
    `cva` variants marked `// app-specific`, guarded by a mirrored `<name>.test.ts`.
  - Existing primitive inventory (`ls services/xstockstrat-ui/src/components/ui/*.tsx`):
    `button.tsx, textarea.tsx, input-group.tsx, badge.tsx, combobox.tsx, sheet.tsx, input.tsx,
    card.tsx, table.tsx, skeleton.tsx, select.tsx, separator.tsx` — the 8 primitives FR-1
    through FR-9 add (`tabs, toggle-group, alert-dialog, alert, checkbox, breadcrumb, accordion,
    progress`) are confirmed **absent**.
  - Component-test pattern (for FR-12): `services/xstockstrat-ui/src/components/ui/button.test.ts`,
    `badge.test.ts` — `import { describe, expect, it } from 'vitest'; import { buttonVariants }
    from './button'; expect(buttonVariants({ variant: 'buy' })).toContain('bg-buy')`. No
    `@testing-library/react`/`jsdom` — these are pure logic assertions on the exported `cva`
    variants function, not rendered-DOM tests.

## Patterns to REUSE

- New primitives (FR-1–FR-4, FR-7–FR-9) → match the **post-119 function-component shape**, not
  the classic shadcn `forwardRef` template: `select.tsx` (`function Select({ ...props })`),
  `button.tsx:46` (`function Button({ className, variant = 'default', ... })`) — **none of the 7
  existing primitives use `React.forwardRef` or set `.displayName`** (feature 119 replaced that
  pattern with `data-slot="..."` props-spread). A hand-authored fallback per FR-12 must match this
  shape, not the older forwardRef convention product-spec.md:41 implies.
- App-specific `cva` variant precedent (for FR-2's buy/sell Toggle Group reconciliation) →
  `button.tsx:7-44` (`buy`/`sell` variants, comment at `button.tsx:22`) and `badge.tsx:7-33`
  (`buy/sell/paper/live/warning/info`, comment at `badge.tsx:19-20`).
  - `Select` uses the unified `radix-ui` package import (not per-primitive `@radix-ui/react-select`),
    icons from `@tabler/icons-react`.
  - `Sheet` reuses `Button` (`variant="ghost" size="icon-sm"`) for its close control — same
    reuse-over-reinvent pattern applies to any new primitive needing a dismiss control (Alert
    Dialog's cancel, Accordion's none).
- `ui/skeleton.tsx:3-13` already sets both `data-slot="skeleton"` and `data-testid="skeleton"` +
  `aria-hidden="true"` — FR-11 (Skeleton adoption in `insights/page.tsx`/`auth/login/page.tsx`)
  needs no new primitive, just wiring.
- `ui/textarea.tsx`, `ui/input.tsx` — plain function components, `cn()` from
  `@/components/ui/utils`, no variants — FR-6's Textarea adoption follows this shape directly.

## Dependencies

- Proto/RPC: none
- Migration: none
- Config keys: none
- Inter-service edges: none
- New env vars / ports: none

## Risks / Not-found

- **FR-6 citation drift (minor)**: `FormulaWorkspace.tsx:278-284` is off by one line — the
  checkbox `<label>` block actually closes at line **285**, not 284. Accurate range:
  `278-285`. All other 20 of 21 spot-checked FR citations matched current `main-dev` exactly.
- **e2e selectors at risk** (the product spec's own Open Question — now resolved with evidence):
  - `RuleEditor.tsx:157-175` (Visual/JSON toggle) — `e2e/insights/strategy-authoring.spec.ts:64,214,243`
    use `getByRole('button', { name: 'JSON' })`; textarea via `getByLabel('Entry rule JSON')`/
    `'Exit rule JSON'` (`:66,68,216,218,245,247`). A Tabs swap must preserve `role=button` +
    accessible names "JSON"/"Visual" and the textarea `aria-label`s.
  - `screener/page.tsx:348-378` (hard/rank toggle) — `e2e/insights/screener.spec.ts:148`
    `getByRole('button', { name: 'hard filter' })`. A Toggle Group swap must preserve `role=button`
    + accessible names `"hard filter"`/`"rank only"` (currently via `aria-label` at `:352,366`).
  - `OrdersTable.tsx:140-149` (Cancel/Confirm) — `e2e/trader/orders.spec.ts:174,178` use
    `getByTestId('cancel-ord-filled')`/`'cancel-ord-new'`. The `data-testid` must survive the
    Alert Dialog migration.
  - `OrderForm.tsx:144-157` (Buy/Sell) — `e2e/trader/order-form.spec.ts:104-105` use exact-name
    role lookups `{ name: 'BUY', exact: true }`/`'SELL'`. Case-sensitive text must be preserved.
  - `CopilotRail.tsx:124-126,149-165` — `e2e/copilot.spec.ts:35,38` use
    `getByTestId('copilot-queue-summary')`/`'copilot-concentration'`. `data-testid`s must survive
    the Alert-primitive migration.
  - `WatchlistReadiness.tsx:200-220` — `e2e/insights/watchlists.spec.ts:25,42-140,203,236` use
    `getByTestId(\`readiness-row-${symbol}\`)`/`'in-queue'` extensively. Must survive the Progress
    migration.
  - `PlatformHeader.tsx:260-269` (breadcrumb) — `e2e/nav-reachability.spec.ts:70-71` use
    `getByLabel('Breadcrumb')` (`aria-label="Breadcrumb"`). The Breadcrumb primitive swap must
    keep that same accessible label.
  - Lower/no e2e-selector risk (no hits found, treat as lower priority but not zero-risk since
    the greps were pattern-targeted, not exhaustive): `PlatformHeader.tsx:209-253` mobile nav
    accordion, `FormulaReferencePanel.tsx:49-63` tab strip, `accountShared.tsx:213-245`,
    `ChartPanel.tsx:118-132`, `insights/market/[symbol]/page.tsx:184-196`,
    `trader/positions/[symbol]/page.tsx:302-316`, `NamespaceEditor.tsx:124-144`,
    `config-ui/audit/page.tsx:15-22` (no dedicated e2e spec found under `e2e/config-ui/` at all —
    this page may be untested by e2e), `SignalReadiness.tsx:71-82`, `insights/page.tsx:24-53`,
    `auth/login/page.tsx:33-43`, `FormulaWorkspace.tsx` checkbox/textareas,
    `ParameterEditor.tsx:236-244`.
- **PlatformHeader.tsx sequencing**: confirmed no in-flight feature besides sibling `121` has a
  planned edit to this file (`096-position-and-order-detail-pages`, `implementation-ready`,
  cites it in `recon.md` for nav-context only — no match in its `implementation-spec.md`;
  `112-watchlist-screen-improvements` already `launched`). Sequencing risk is scoped to 120↔121
  only, consistent with the product-spec's own Open Question and the sdd-review overlap scan.
- **Ledger trap** (`docs/roadmap/ledger/insights.md`, 2026-08-08 — shadcn-ui-migration — reuse):
  Vitest's `resolve.alias` for `@/*` can silently diverge from `tsconfig.json`'s `paths` — any
  file whose import graph starts using `@/...`-style imports (which the shadcn CLI generates)
  can break Vitest resolution even when Next's bundler is unaffected, and the failure can surface
  on an unrelated pre-existing test file, not the changed one. Run the full Vitest suite after
  adding each new primitive, not just files touching it directly.

## Recommended Scope

Advisory step grouping (not binding — `/sdd-spec` decides final sequencing):
1. Add all 8 new primitives (FR-1–FR-4, FR-7–FR-9) + their `<name>.test.ts` regression tests
   (FR-12) in one batch — no call-site risk yet.
2. Wire the 3 "adopt existing primitive" FRs (FR-6 Textarea, FR-10 Badge, FR-11 Skeleton) —
   lowest risk, no new primitive dependency.
3. Migrate call sites with **no e2e-selector risk found** first (tab strips, breadcrumbs outside
   `PlatformHeader.tsx`, timeframe switchers, accordion mobile nav).
4. Migrate call sites with **confirmed e2e-selector risk** last, each paired with the e2e spec
   update in the same step: `RuleEditor.tsx` Tabs, `screener/page.tsx` Toggle Group,
   `OrdersTable.tsx`/`OrderForm.tsx` (Alert Dialog / Toggle Group), `CopilotRail.tsx` Alert,
   `WatchlistReadiness.tsx` Progress, `PlatformHeader.tsx` Breadcrumb.
5. Sequence `PlatformHeader.tsx`'s two FRs (FR-7 Breadcrumb, FR-8 Accordion) as adjacent steps in
   this feature so no half-finished edit from this feature overlaps with itself; leave the
   120↔121 cross-feature ordering to the merge-order note recommended by the review's overlap
   scan.

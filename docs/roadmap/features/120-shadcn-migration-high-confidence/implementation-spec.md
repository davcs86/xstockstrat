# Implementation Spec: shadcn-migration-high-confidence

**Status**: `pending`
**Created**: 2026-08-09
**Feature**: `docs/roadmap/features/120-shadcn-migration-high-confidence/feature.md`
**Total Steps**: 36
**Feature Branch**: `feature/shadcn-migration-high-confidence`

---

## Execution Summary

Ten primitives are added to or adopted from `services/xstockstrat-ui/src/components/ui/` — 8 new
(Tabs, Toggle Group, Alert Dialog, Alert, Checkbox, Breadcrumb, Accordion, Progress) and 3 already
present but bypassed (Textarea, Badge, Skeleton) — to replace the 27 hand-rolled occurrences design.md
tiered. Steps 1-3 are the zero-primitive-dependency, zero-e2e-risk warm-up (adopt Skeleton/Badge/
Textarea). Steps 4-34 cover the 8 new primitives in FR order (Tabs, Toggle Group, Alert Dialog, Alert,
Checkbox, Breadcrumb, Accordion, Progress); each primitive's add-step is immediately followed by its
lowest-risk consumer wire, then any remaining no-e2e-risk consumers, then — for the 7 call sites
(across 6 primitives — Toggle Group has two, `screener/page.tsx` and `OrderForm.tsx`) `recon.md` §
Risks confirmed carry a load-bearing e2e selector (`RuleEditor.tsx` Tabs, `screener/
page.tsx` + `OrderForm.tsx` Toggle Group, `OrdersTable.tsx` Alert Dialog, `CopilotRail.tsx` Alert,
`WatchlistReadiness.tsx` Progress, `PlatformHeader.tsx` Breadcrumb) — a **mandatory
two-step split** (Constitution P-06): step A swaps the markup and runs the *unmodified* e2e spec,
recording the actual pass/fail; step B updates the spec's selectors to match the new Radix-based DOM.
`PlatformHeader.tsx`'s two FRs (Breadcrumb FR-7, Accordion FR-8) are interleaved as adjacent steps
(25-30) per `recon.md`'s sequencing risk, with Accordion's wire landing ahead of Breadcrumb's tier-4
pair per design.md's explicit ordering. Each primitive-add step bundles the primitive file with its
FR-12 mechanical regression test (`<name>.test.ts`) in one step — mirroring how `button.tsx`/
`button.test.ts` and `badge.tsx`/`badge.test.ts` already exist with identical mtimes (feature 119) —
rather than a separate paired `test` step, since `xstockstrat-ui` carries no CI coverage threshold
(`reference/spec-template.md`'s coverage table marks Next.js services n/a) and the test is a mechanical
companion to the primitive, not a coverage-driving asset. Toggle Group, Alert, and Progress each carry
an app-specific `cva` variant (buy/sell; warning; buy/paper/sell/muted) per design.md's DRY
reconciliation; the other 5 primitives get a minimal presence/default-variant test only. Step 35 runs
the full verification suite (`pnpm lint && pnpm build && pnpm test:unit && pnpm test:e2e`) plus the
manual screenshot compare AC-6 requires for `config-ui/audit/page.tsx` (no e2e spec exists for that
route). Step 36 records the AC-6 per-primitive migration summary in `context.md`.

## Step Dependencies

- Steps 4-8 (Tabs) require Step 4's primitive-add before any wire step.
- Steps 9-13 (Toggle Group) require Step 9's primitive-add. Toggle Group has **no** tier-2/3 interim
  wire (recon.md: both its consumers are confirmed e2e-risk) — Step 9 is followed directly by two
  tier-4 pairs (Steps 10-11, 12-13).
- Steps 14-17 (Alert Dialog) require Step 14's primitive-add before Step 15 (`accountShared.tsx`) and
  Steps 16-17 (`OrdersTable.tsx`).
- Steps 18-22 (Alert) require Step 18's primitive-add before Steps 19-20 and 21-22.
- Steps 23-24 (Checkbox) require Step 23's primitive-add before Step 24.
- Steps 25-30 (`PlatformHeader.tsx` — Breadcrumb FR-7 + Accordion FR-8) must run as an unbroken block
  in this exact order (recon.md § Risks "PlatformHeader.tsx sequencing"): Step 25 (Breadcrumb add) →
  Step 26 (Breadcrumb no-e2e-risk wire: `NamespaceEditor.tsx`, `config-ui/audit/page.tsx`) → Step 27
  (Accordion add) → Step 28 (Accordion wire: `PlatformHeader.tsx` mobile nav) → Steps 29-30 (Breadcrumb
  tier-4 pair: `PlatformHeader.tsx` desktop breadcrumb). Accordion's wire (Step 28) intentionally lands
  ahead of Breadcrumb's tier-4 pair (Steps 29-30) per design.md's explicit ordering, even though
  Breadcrumb (FR-7) is numerically first — both FRs stay adjacent so no half-finished edit to this
  shared file survives across a step boundary (F-09).
- Steps 31-34 (Progress) require Step 31's primitive-add before Step 32 and Steps 33-34.
- Step 35 (full verification) requires every prior step (1-34) complete.
- Step 36 (context.md) requires Step 35's recorded results.
- Cross-feature (soft, non-blocking per `feature.md`'s Reviewers/overlap note): Steps 25-30 touch
  `PlatformHeader.tsx`, also cited by sibling `121-shadcn-migration-medium-confidence`'s FR-13
  (Navigation Menu evaluation, `:156-291` superset range) — land this feature's `PlatformHeader.tsx`
  steps and merge before 121 rebase-checks its own citation, or re-verify 121's range first.

---

### Step 1 — service: Adopt Skeleton in insights/page.tsx and auth/login/page.tsx (FR-11)

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/insights/page.tsx` — modify
- `services/xstockstrat-ui/src/app/auth/login/page.tsx` — modify

**Reviewers**: xstockstrat-ui service owner — Trading UI correctness, analytics display accuracy, no secret values rendered in UI

**Codebase Evidence**:
- `src/app/insights/page.tsx:24-53` — `DashboardSkeleton()` returns raw `<div className="h-60 rounded-md bg-secondary/40 animate-pulse" />` (confirmed at L45) inside an `AppShell`/`Card` shell; used as the `Suspense fallback` at L57.
- `src/app/auth/login/page.tsx:33-43` — `LoginSkeleton()` returns three raw `<div className="h-10 rounded-md bg-secondary animate-pulse" />` / `bg-secondary/80` divs inside `AuthCardShell`; used as the `Suspense fallback` at L47.
- `src/components/ui/skeleton.tsx:3-13` — existing `Skeleton` component: `<div data-slot="skeleton" data-testid="skeleton" aria-hidden="true" className={cn('animate-pulse rounded-2xl bg-muted', className)} {...props} />`. Already sets `data-testid="skeleton"` and `aria-hidden` — no new primitive needed (recon.md § Patterns to REUSE).

**TDD**: N/A (no e2e-risk call site identified for either skeleton — recon.md § Risks; a loading-placeholder swap has no distinguishing assertion to red/green against, verified by running the existing e2e suite green before and after)

**Instructions**:
1. In `src/app/insights/page.tsx`, import `Skeleton` from `@/components/ui/skeleton` and replace the raw `<div className="h-60 rounded-md bg-secondary/40 animate-pulse" />` (L45) with `<Skeleton className="h-60" />` (keep the surrounding `Card`/`CardHeader`/`CardContent` structure and the `Strategy Scores` "Loading…" text at L35 unchanged — this step touches only the equity-curve placeholder div, the one hand-rolled `animate-pulse` div in this file).
2. In `src/app/auth/login/page.tsx`, import `Skeleton` and replace the three raw `animate-pulse` divs (L37-39) with three `<Skeleton className="h-10" />` (the third keeps its distinct opacity — `<Skeleton className="h-10 bg-secondary/80" />` or pass the existing class via `className` — confirm `Skeleton`'s `cn()` merge lets a caller-supplied `bg-*` override the base `bg-muted`).
3. Delete the raw markup being replaced in both files — do not leave it dead alongside the new `Skeleton` usage (AC-2).

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm build && pnpm test:e2e -g "insights" && pnpm test:e2e -g "auth"
```
Confirm no new build/type errors and the existing e2e suite for `/insights` and `/auth/login` stays green (no spec asserts on the raw `animate-pulse` class, per recon.md § Risks — both sites listed as no e2e-selector hits found).

---

### Step 2 — service: Adopt Badge for CopilotRail.tsx "beta" pill (FR-10)

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/copilot/CopilotRail.tsx` — modify

**Reviewers**: xstockstrat-ui service owner — Trading UI correctness

**Codebase Evidence**:
- `src/components/copilot/CopilotRail.tsx:124-126` — raw `<span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">beta</span>`.
- `src/components/ui/badge.tsx:35-51` — existing `Badge` component, `data-slot="badge"`, `badgeVariants` cva with `default/secondary/destructive/outline/ghost/link` plus app-specific `buy/sell/paper/live/warning/info` (L19-26).

**TDD**: N/A (no e2e-risk — `e2e/copilot.spec.ts` asserts `copilot-queue-summary`/`copilot-concentration`/`copilot-footer` testids and rail visibility, not the "beta" pill's markup, per a targeted grep of that spec)

**Instructions**:
1. Import `Badge` from `@/components/ui/badge` into `CopilotRail.tsx`.
2. Replace the `<span>` at L124-126 with `<Badge variant="outline" className="text-[10px] uppercase tracking-wide">beta</Badge>` (or `variant="secondary"` — pick whichever existing variant's default background/text most closely matches the current `bg-muted`/`text-muted-foreground` look; do not invent a new variant for a purely cosmetic pill).
3. This is disambiguated from FR-4's separate Alert edit on the same file (`CopilotRail.tsx:149-165`, handled in Step 21-22) — touch only L124-126 in this step.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm build && pnpm test:e2e -g "copilot"
```

---

### Step 3 — service: Adopt Textarea in FormulaWorkspace.tsx and RuleEditor.tsx (FR-6)

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/insights/FormulaWorkspace.tsx` — modify
- `services/xstockstrat-ui/src/components/insights/RuleEditor.tsx` — modify

**Reviewers**: xstockstrat-ui service owner — Trading UI correctness

**Codebase Evidence**:
- `src/components/insights/FormulaWorkspace.tsx:254-259` — raw `<textarea className="flex min-h-[60px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" value={description} onChange={...} placeholder="What it computes and the inputs it expects" />` (Description field).
- `src/components/insights/FormulaWorkspace.tsx:351-356` — raw `<textarea className="flex min-h-[120px] w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" value={jsonInput} onChange={...} spellCheck={false} />` (Input data JSON field).
- `src/components/insights/RuleEditor.tsx:327-335` — raw `<textarea aria-label={\`${label} JSON\`} className={cn('flex min-h-[140px] w-full rounded-md border border-input bg-secondary px-3 py-2 font-mono text-sm ...')} placeholder='{ "op": "AND", ... }' value={value} onChange={...} />`.
- `src/components/ui/textarea.tsx:5-16` — existing `Textarea` component: plain function, `cn()` merge, `data-slot="textarea"`, base classes `flex field-sizing-content min-h-16 w-full resize-none rounded-2xl border border-transparent bg-input/50 ...` — already added by `119-shadcn-ui-migration`; no new primitive file needed (product-spec.md FR-6, recon.md § Patterns to REUSE).

**TDD**: N/A (no e2e-risk — `e2e/insights/strategy-authoring.spec.ts:66,68,216,218,245,247` locate the JSON textareas via `getByLabel('Entry rule JSON')`/`'Exit rule JSON'`, which read the `aria-label` prop, not the element's class list — the `aria-label` must be preserved verbatim on the new `Textarea`, confirmed by running the existing suite green after the swap rather than a dedicated red/green pair)

**Instructions**:
1. In `FormulaWorkspace.tsx`, import `Textarea` from `@/components/ui/textarea` and replace both raw `<textarea>` elements (L254-259, L351-356) with `<Textarea>`, passing each site's own sizing modifier via `className` (`min-h-[60px]` and `min-h-[120px] font-mono text-xs` respectively — these are the "different min-h/sizing/tone modifiers per site" product-spec.md FR-6 describes, not byte-identical strings) and keeping `value`/`onChange`/`placeholder`/`spellCheck` props unchanged.
2. In `RuleEditor.tsx`, import `Textarea`, replace the raw `<textarea>` at L327-335 with `<Textarea>`, and **preserve the `aria-label={\`${label} JSON\`}` prop exactly** — this is the e2e-load-bearing accessor `strategy-authoring.spec.ts` depends on. Pass the site's `min-h-[140px] font-mono text-sm bg-secondary` sizing/tone via `className`.
3. Delete each raw `<textarea>` block being replaced (AC-2/AC-3 — these three sites collapse to the one shared `Textarea` implementation).

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm build && pnpm test:e2e -g "strategy-authoring" && pnpm test:e2e -g "formula"
```
Confirm `getByLabel('Entry rule JSON')`/`'Exit rule JSON'` still resolve (the aria-label survives).

---

### Step 4 — service: Add ui/tabs.tsx primitive + regression test (FR-1, FR-12)

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/ui/tabs.tsx` — create
- `services/xstockstrat-ui/src/components/ui/tabs.test.ts` — create

**Reviewers**: xstockstrat-ui service owner — Trading UI correctness

**Codebase Evidence**:
- `services/xstockstrat-ui/components.json:3` — preset `"style": "radix-rhea"` (`bLTl5gh6`); `CLAUDE.md:31-33` — `npx shadcn@latest add <name>` is the primary authoring path.
- `src/components/ui/select.tsx:1-11` — shape to match: `'use client'`, `import { Select as SelectPrimitive } from 'radix-ui'`, plain function components (`function Select({ ...props })`), `data-slot="select"` — confirmed **no** `React.forwardRef`/`.displayName` anywhere in the file (recon.md § Patterns to REUSE — post-119 convention).
- `src/components/ui/button.test.ts:1-16` — mirrored test shape: `import { describe, expect, it } from 'vitest'`, assert on the exported `cva` variants function's output string.
- `ls services/xstockstrat-ui/src/components/ui/*.tsx` (recon.md § Codebase Map) — `tabs.tsx` confirmed **absent** today.

**TDD**: `red N/A — mechanical regression guard, not a true red-green cycle` (corrected 2026-08-09,
round-4 cross-check audit finding: the prior wording claimed `tabs.test.ts` proves a
module-not-found red before `tabs.tsx` exists, but Instructions 1 and 3 below author the primitive
*before* the test file — by construction, no red state is ever produced by following the
Instructions in order). `tabs.test.ts` is instead a same-step mechanical guard, matching FR-12's
"survives a future `apply --preset` re-run" intent — it locks in the primitive's exported surface
immediately after creation. If a genuine captured-red sequence is preferred, write `tabs.test.ts`
first (Instruction 3 before Instruction 1) — that import would fail to resolve until `tabs.tsx`
exists, giving a real red — but the Instructions below are not sequenced that way; do not claim red
was captured unless the executor actually reorders and records it.

**Instructions**:
1. Run `npx shadcn@latest add tabs` from `services/xstockstrat-ui/` against the existing `components.json` preset. If the CLI is unavailable in the execution environment, hand-author `tabs.tsx` matching `select.tsx`'s shape: `'use client'`, `import { Tabs as TabsPrimitive } from 'radix-ui'`, plain function components (`Tabs`, `TabsList`, `TabsTrigger`, `TabsContent`) each with `data-slot="tabs-*"`, using `cn()` from `@/components/ui/utils` for class merging — **not** `React.forwardRef`/`.displayName` — and note the fallback in `context.md` (product-spec.md FR-12).
2. Tabs needs **no app-specific variant** — none of its 5 consumers require order-side/paper/status coloring (unlike Toggle Group/Alert/Progress below). Skip the `// app-specific` reconciliation step.
3. Create `tabs.test.ts` mirroring `button.test.ts`'s import shape: assert the exported `Tabs`/`TabsList`/`TabsTrigger`/`TabsContent` symbols exist (e.g. `expect(Tabs).toBeDefined()`) — a minimal presence test per design.md's "5 primitives with no app-specific variant get a minimal test."
4. Run the full Vitest suite (not just `tabs.test.ts`) per the ledger's `resolve.alias` drift trap (`insights.md` 2026-08-08, shadcn-ui-migration) — already fixed at `vitest.config.ts:16`, but re-verify no regression.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm test:unit -- tabs.test.ts && pnpm test:unit && pnpm build
```
Confirm `tabs.test.ts` passes and the full unit suite has no new failures (the alias-drift check).

---

### Step 5 — service: Wire Tabs → FormulaReferencePanel.tsx (lowest-risk first wire)

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/insights/FormulaReferencePanel.tsx` — modify

**Reviewers**: xstockstrat-ui service owner — Trading UI correctness

**Codebase Evidence**:
- `src/components/insights/FormulaReferencePanel.tsx:17-24` — `type Tab = 'contract' | 'libraries' | 'limits' | 'templates'`; `const TABS: { id: Tab; label: string }[] = [...]`.
- `src/components/insights/FormulaReferencePanel.tsx:49-63` — hand-rolled tab strip: `<div className="flex gap-1 border-b border-border px-2 py-1.5">{TABS.map((t) => <button key={t.id} onClick={() => setTab(t.id)} className={...}>{t.label}</button>)}</div>`.
- `src/components/insights/FormulaReferencePanel.tsx:65-145` — the four content blocks (`{tab === 'contract' && (...)}`, `'libraries'`, `'limits'`, `'templates'`) map cleanly onto `TabsContent` panels (genuine per-tab content switch, unlike the timeframe-switcher sites in Step 6).
- No e2e-selector hits for this file per recon.md § Risks (lower-risk list).

**TDD**: N/A (no e2e-risk call site; verified by running the existing insights e2e suite green pre/post)

**Instructions**:
1. Import `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent` from `@/components/ui/tabs`.
2. Replace `useState<Tab>` + the hand-rolled button strip (L49-63) with `<Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}><TabsList>{TABS.map((t) => <TabsTrigger key={t.id} value={t.id}>{t.label}</TabsTrigger>)}</TabsList>...</Tabs>`.
3. Wrap each of the four content blocks (L66-144) in `<TabsContent value="contract">`/`'libraries'`/`'limits'`/`'templates'` inside the `Tabs` root, replacing the `{tab === 'x' && (...)}` conditional guards (Tabs' own `value` prop now gates visibility).
4. Delete the old `useState`-driven conditional rendering and the raw button strip (AC-2).

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm build && pnpm test:e2e -g "formula"
```

---

### Step 6 — service: Wire Tabs → remaining no-e2e-risk timeframe-switcher consumers

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/insights/market/[symbol]/page.tsx` — modify
- `services/xstockstrat-ui/src/app/trader/positions/[symbol]/page.tsx` — modify
- `services/xstockstrat-ui/src/components/trader/ChartPanel.tsx` — modify

**Reviewers**: xstockstrat-ui service owner — Trading UI correctness

**Codebase Evidence**:
- `src/app/insights/market/[symbol]/page.tsx:184-196` — timeframe switcher: `<div className="flex gap-1">{TIMEFRAMES.map(({ value, label }) => <button key={value} onClick={() => setTimeframe(value)} className={...}>{label}</button>)}</div>`, immediately followed (L200-212) by the chart `CardContent` — the "content" is external to the switcher, unconditionally rendered.
- `src/app/trader/positions/[symbol]/page.tsx:302-316` — same shape: `{TIMEFRAMES.map(({ value, label }) => <button key={value} onClick={() => onTimeframe(value)} className={...}>{label}</button>)}`.
- `src/components/trader/ChartPanel.tsx:118-132` — same shape: `{TIMEFRAMES.map(({ value, label }) => <button key={value} onClick={() => setTimeframe(value)} className={...}>{label}</button>)}`.
- None of the three has an e2e-selector hit per recon.md § Risks lower-risk list.

**TDD**: N/A (no e2e-risk; verified by running the trader + insights e2e suites green pre/post — `ChartPanel.tsx` also carries the sanctioned `lightweight-charts` exception per `CLAUDE.md` § Styling, unaffected by this markup-only swap)

**Instructions**:
1. In each of the three files, import `Tabs`, `TabsList`, `TabsTrigger` (no `TabsContent` — the chart/content below is unconditionally rendered outside the switcher, not gated per-tab; do not force these into `TabsContent` panels, which would change what's currently unconditional rendering).
2. Replace the hand-rolled `{TIMEFRAMES.map(...)}` button strip with `<Tabs value={timeframe} onValueChange={(v) => setTimeframe(v as Timeframe)}><TabsList>{TIMEFRAMES.map(({ value, label }) => <TabsTrigger key={value} value={value}>{label}</TabsTrigger>)}</TabsList></Tabs>` (substituting the correct state setter name per file: `setTimeframe`, `onTimeframe`, `setTimeframe`).
3. Delete each raw button-strip block (AC-2/AC-3 — this collapses the duplicated timeframe-tab-bar shape AC-3 names).

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm build && pnpm test:e2e -g "chart-panel" && pnpm test:e2e -g "positions" && pnpm test:e2e -g "market"
```

---

### Step 7 — test: RuleEditor.tsx Tabs swap — red (unmodified spec against new markup)

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/insights/RuleEditor.tsx` — modify

**Reviewers**: xstockstrat-ui service owner — Trading UI correctness, Connect-RPC call safety

**Codebase Evidence**:
- `src/components/insights/RuleEditor.tsx:114-151` — `mode` state (`'visual' | 'json'`), `switchTo()` handler.
- `src/components/insights/RuleEditor.tsx:157-174` — the Visual/JSON button pair (the wrapper `<div>` spans `:157-175`; the two `<Button>` elements themselves are `:157-174`): `<Button type="button" size="sm" variant={mode === 'visual' ? 'default' : 'outline'} onClick={() => switchTo('visual')}>Visual</Button>` / the `JSON` twin.
- `e2e/insights/strategy-authoring.spec.ts:64` — `const jsonButtons = page.getByRole('button', { name: 'JSON' });` then `.nth(0)`/`.nth(1)` (also L214, L243) — this selector currently matches because the buttons are literal `<Button>` (shadcn `Button` renders `<button>`, `role="button"` implicit).
- `radix-ui@^1.6.7` is already an installed dependency (`package.json:47`, recon.md § Codebase Map) — Radix's `Tabs.Trigger` renders with `role="tab"` inside a `role="tablist"`/`Tabs.List`, not `role="button"` — this is the mandatory verification item design.md flags (§ Cross-cutting verification note), to be confirmed against the actual CLI-generated `tabs.tsx` from Step 4, not assumed.

**TDD**: red-green required (Constitution P-06) — this step is the **red** half: swap the markup, then run the *unmodified* `strategy-authoring.spec.ts` and record the actual pass/fail before touching the spec file.

**Instructions**:
1. Import `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent` from `@/components/ui/tabs` in `RuleEditor.tsx`.
2. Replace the two `<Button>` elements at L156-174 with `<Tabs value={mode} onValueChange={(v) => switchTo(v as 'visual' | 'json')}><TabsList><TabsTrigger value="visual">Visual</TabsTrigger><TabsTrigger value="json">JSON</TabsTrigger></TabsList></Tabs>` — note `switchTo` already guards the visual→json transition (parse-error check at L133-151); preserve that guard by keeping `onValueChange` routed through `switchTo`, not a bare `setMode`.
3. Wrap the visual-builder block (L179-325) in `<TabsContent value="visual">` and the JSON `<Textarea>` (from Step 3) in `<TabsContent value="json">`, both inside the `Tabs` root.
4. **Do not touch `strategy-authoring.spec.ts` in this step.** Run it as-is against the new markup and record the actual result (per Radix's `role="tab"` vs the spec's `getByRole('button', ...)`, a failure is anticipated but must be *observed*, not assumed — P-03).

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm test:e2e -g "strategy-authoring" 2>&1 | tee /tmp/step7-red-run.log
```
Record the actual pass/fail in `context.md` (per design.md's mandatory instruction — even an unexpected pass must be recorded, not silently treated as "it worked").

---

### Step 8 — test: RuleEditor.tsx Tabs swap — green (update spec selectors)

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/insights/strategy-authoring.spec.ts` — modify

**Reviewers**: xstockstrat-ui service owner — Trading UI correctness

**Codebase Evidence**:
- `e2e/insights/strategy-authoring.spec.ts:64,66,68,214,216,218,243,245,247` — every `getByRole('button', { name: 'JSON' })` / `getByLabel('Entry rule JSON')` / `'Exit rule JSON'` call site that touches the Visual/JSON toggle (the `getByLabel` calls target the textarea's `aria-label`, unaffected by the Tabs swap — Step 3 already preserved that prop).
- Step 7's recorded red-run output (this step depends on Step 7's actual observed failure mode).

**TDD**: red-green required — this is the **green** half, paired with Step 7.

**Instructions**:
1. Based on Step 7's recorded actual failure, update every `getByRole('button', { name: 'JSON' })` (and the implicit `'Visual'` counterpart the `.nth(0)`/`.nth(1)` pattern relies on) to the role Radix's `Tabs.Trigger` actually renders — expected `getByRole('tab', { name: 'JSON' })` per Radix's documented `Tabs.Trigger` → `role="tab"` contract, but set the exact role from Step 7's observed DOM, not from this citation alone.
2. Leave the `getByLabel('Entry rule JSON')`/`'Exit rule JSON'` calls unchanged — they target the textarea, not the tab trigger.
3. Re-run the full spec and confirm green.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm test:e2e -g "strategy-authoring"
```
All cases in `strategy-authoring.spec.ts` pass.

---

### Step 9 — service: Add ui/toggle-group.tsx primitive + buy/sell variant + test (FR-2, FR-12)

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/ui/toggle-group.tsx` — create
- `services/xstockstrat-ui/src/components/ui/toggle-group.test.ts` — create

**Reviewers**: xstockstrat-ui service owner — Trading UI correctness, Connect-RPC call safety

**Codebase Evidence**:
- `src/components/ui/button.tsx:22-25` — app-specific variant precedent: `buy: 'bg-buy text-background hover:bg-buy/90 font-semibold'` / `sell: 'bg-sell text-white hover:bg-sell/90 font-semibold'`, marked `// app-specific`.
- `src/components/trader/OrderForm.tsx:144-157` — current Buy/Sell hand-rolled toggle: `{(['buy', 'sell'] as OrderSide[]).map((s) => <Button key={s} type="button" variant={side === s ? (s === 'buy' ? 'buy' : 'sell') : 'outline'} onClick={() => setSide(s)} className="w-full">{s.toUpperCase()}</Button>)}`.
- `src/components/ui/button.test.ts:1-16` — mirrored variant-test shape.
- Both Toggle Group consumers (`screener/page.tsx`, `OrderForm.tsx`) are confirmed e2e-risk (recon.md § Risks) — no low-risk first wire exists, so this primitive goes straight to the two tier-4 pairs (Steps 10-13), no interim wire step.

**TDD**: `red N/A — mechanical regression guard, not a true red-green cycle` (corrected 2026-08-09: Instructions author `toggle-group.tsx` before `toggle-group.test.ts`, so no module-not-found red is ever produced by construction — see Step 4's identical correction for the full rationale). Same-step guard locking in the `buy`/`sell` variant surface.

**Instructions**:
1. Run `npx shadcn@latest add toggle-group`. Fallback: hand-author matching `select.tsx`'s shape (`import { ToggleGroup as ToggleGroupPrimitive } from 'radix-ui'`, plain functions, `data-slot`, no forwardRef).
2. Add an app-specific `buy`/`sell` variant to the regenerated file's `cva()` `variants` object, marked `// app-specific` — mirroring `button.tsx:22-25`, for `OrderForm.tsx`'s Buy/Sell reconciliation (product-spec.md FR-2).
3. **Verify Radix's actual rendered ARIA role** for `ToggleGroup.Item` against the CLI-generated file — design.md flags this as unverified (not `role="button"` as today's hand-rolled `Button`-based toggle implies; confirm the real value, do not assume `role="radio"`/`"radiogroup"`). Record the confirmed role in `context.md` — both `screener/page.tsx` (Step 10-11) and `OrderForm.tsx` (Step 12-13) need this same fact.
4. Create `toggle-group.test.ts` mirroring `button.test.ts`: `expect(toggleGroupItemVariants({ variant: 'buy' })).toContain('bg-buy')` (exact export name depends on the CLI-generated file's actual `cva()` binding — confirm the name at authoring time).

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm test:unit -- toggle-group.test.ts && pnpm test:unit && pnpm build
```

---

### Step 10 — test: screener/page.tsx Toggle Group swap — red

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/insights/screener/page.tsx` — modify

**Reviewers**: xstockstrat-ui service owner — Trading UI correctness

**Codebase Evidence**:
- `src/app/insights/screener/page.tsx:348-378` — hard/rank segmented toggle: two `<button aria-label="hard filter" aria-pressed={c.hardFilter} ...>hard</button>` / `<button aria-label="rank only" aria-pressed={!c.hardFilter} ...>rank</button>` inside `<div className="inline-flex overflow-hidden rounded-md border border-border">`.
- `e2e/insights/screener.spec.ts:148` — `await page.getByRole('button', { name: 'hard filter' }).click();` (test name at line ~141: "the hard/rank toggle flips the sent hardFilter (feature 098, FR-2)").

**TDD**: red-green required — red half.

**Instructions**:
1. Import `ToggleGroup`, `ToggleGroupItem` from `@/components/ui/toggle-group` in `screener/page.tsx`.
2. Replace the raw two-button `div` (L349-378) with `<ToggleGroup type="single" value={c.hardFilter ? 'hard' : 'rank'} onValueChange={(v) => v && updateCriterion(i, { hardFilter: v === 'hard' })}><ToggleGroupItem value="hard" aria-label="hard filter">hard</ToggleGroupItem><ToggleGroupItem value="rank" aria-label="rank only">rank</ToggleGroupItem></ToggleGroup>` — preserve the `aria-label`s verbatim (the e2e selector targets them, not button text).
3. Do not touch `screener.spec.ts` yet. Run it unmodified and record the actual result — Step 9's role-verification finding (button vs. radio) determines whether `getByRole('button', ...)` still resolves.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm test:e2e -g "screener" 2>&1 | tee /tmp/step10-red-run.log
```
Record actual pass/fail in `context.md`.

---

### Step 11 — test: screener/page.tsx Toggle Group swap — green

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/insights/screener.spec.ts` — modify

**Reviewers**: xstockstrat-ui service owner — Trading UI correctness

**Codebase Evidence**:
- `e2e/insights/screener.spec.ts:148` — `page.getByRole('button', { name: 'hard filter' })`.
- Step 10's recorded red-run result.

**TDD**: red-green required — green half.

**Instructions**:
1. Based on Step 10's observed result, update `getByRole('button', { name: 'hard filter' })` to the role `ToggleGroupItem` actually renders (confirmed in Step 9) if the unmodified spec failed; leave unchanged if it still passed (record either outcome).
2. The `aria-label`s (`'hard filter'`/`'rank only'`) are preserved from Step 10, so only the `role` half of the locator should need adjustment, if any.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm test:e2e -g "screener"
```

---

### Step 12 — test: OrderForm.tsx Toggle Group swap — red

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/trader/OrderForm.tsx` — modify

**Reviewers**: xstockstrat-ui service owner — Order execution correctness, Trading UI correctness

**Codebase Evidence**:
- `src/components/trader/OrderForm.tsx:144-157` — `<div className="grid grid-cols-2 gap-2">{(['buy', 'sell'] as OrderSide[]).map((s) => <Button key={s} type="button" variant={side === s ? (s === 'buy' ? 'buy' : 'sell') : 'outline'} onClick={() => setSide(s)} className="w-full">{s.toUpperCase()}</Button>)}</div>`.
- `e2e/trader/order-form.spec.ts:104-105` — `await expect(page.getByRole('button', { name: 'BUY', exact: true })).toBeVisible(); await expect(page.getByRole('button', { name: 'SELL', exact: true })).toBeVisible();` — **exact-case** match on `'BUY'`/`'SELL'` (uppercase, matching `.toUpperCase()` in the current markup).

**TDD**: red-green required — red half.

**Instructions**:
1. Import `ToggleGroup`, `ToggleGroupItem` from `@/components/ui/toggle-group`.
2. Replace the `<div className="grid grid-cols-2 gap-2">...</div>` (L145-157) with `<ToggleGroup type="single" value={side} onValueChange={(v) => v && setSide(v as OrderSide)} className="grid grid-cols-2 gap-2"><ToggleGroupItem value="buy" variant="buy">BUY</ToggleGroupItem><ToggleGroupItem value="sell" variant="sell">SELL</ToggleGroupItem></ToggleGroup>` — use the Step 9 app-specific `buy`/`sell` variant so the order-side coloring survives; **keep the label text exact-case `'BUY'`/`'SELL'`** (the e2e assertion uses `exact: true`).
3. Run `order-form.spec.ts` unmodified and record the actual result (same button-vs-radio role question as Step 10).

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm test:e2e -g "order-form" 2>&1 | tee /tmp/step12-red-run.log
```
Record actual pass/fail in `context.md`.

---

### Step 13 — test: OrderForm.tsx Toggle Group swap — green

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/trader/order-form.spec.ts` — modify

**Reviewers**: xstockstrat-ui service owner — Order execution correctness, Trading UI correctness

**Codebase Evidence**:
- `e2e/trader/order-form.spec.ts:104-105` (exact-case `'BUY'`/`'SELL'`); `:104` also has an earlier `.getByRole('button', { name: /buy|sell/i }).last()` at a different test (case-insensitive regex — check whether that call site needs the same role fix).
- Step 12's recorded red-run result.

**TDD**: red-green required — green half.

**Instructions**:
1. Based on Step 12's observed result, update the two exact-case role lookups (and the case-insensitive `/buy|sell/i` lookup earlier in the file, if it also targets this control) to the role `ToggleGroupItem` renders, confirmed in Step 9.
2. Do not change the `'BUY'`/`'SELL'` text expectations — those are preserved verbatim per Step 12.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm test:e2e -g "order-form"
```

---

### Step 14 — service: Add ui/alert-dialog.tsx primitive + test (FR-3, FR-12)

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/ui/alert-dialog.tsx` — create
- `services/xstockstrat-ui/src/components/ui/alert-dialog.test.ts` — create

**Reviewers**: xstockstrat-ui service owner — Trading UI correctness, Connect-RPC call safety

**Codebase Evidence**:
- `src/components/ui/sheet.tsx:1-12` — shape to match (`'use client'`, `import { Dialog as SheetPrimitive } from 'radix-ui'`, plain functions, `data-slot`) — `AlertDialog` is Radix's `AlertDialog` primitive, same package-import convention.
- `src/components/ui/sheet.tsx:65-72` — reuse-a-`Button`-for-dismiss precedent: `<Button variant="ghost" ... size="icon-sm"><IconX /></Button>` inside `SheetPrimitive.Close asChild` — same reuse pattern applies to `AlertDialogCancel`/`AlertDialogAction`.
- No app-specific variant needed — Alert Dialog is one of the 5 primitives getting a minimal presence test only (design.md § Chosen Approach).

**TDD**: `red N/A — mechanical regression guard, not a true red-green cycle` (corrected 2026-08-09: the primitive is authored before `alert-dialog.test.ts`, so no module-not-found red is ever produced by construction — see Step 4's identical correction for the full rationale).

**Instructions**:
1. Run `npx shadcn@latest add alert-dialog`. Fallback: hand-author matching `sheet.tsx`'s shape (`import { AlertDialog as AlertDialogPrimitive } from 'radix-ui'`, plain functions, `data-slot`, reuse `Button` for `AlertDialogCancel`/`AlertDialogAction` per `sheet.tsx`'s close-button precedent).
2. Create `alert-dialog.test.ts` — minimal presence test asserting the exported `AlertDialog`/`AlertDialogTrigger`/`AlertDialogContent`/`AlertDialogAction`/`AlertDialogCancel` symbols exist.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm test:unit -- alert-dialog.test.ts && pnpm test:unit && pnpm build
```

---

### Step 15 — service: Wire Alert Dialog → accountShared.tsx AccountRow (lowest-risk first wire)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/trader/accountShared.tsx` — modify

**Reviewers**: xstockstrat-ui service owner — Order execution correctness, Trading UI correctness

**Codebase Evidence**:
- `src/components/trader/accountShared.tsx:187-200` — `async function handleRemove()`: calls `tradingClient.deregisterBrokerAccount(...)`, sets `removing`/`confirming` state in a `finally` block.
- `src/components/trader/accountShared.tsx:213-245` — current two-step inline confirm: `Remove` button (L218-220) sets `confirming=true`; when `confirming`, renders `Confirm`/`Cancel` buttons (L232-243) each `disabled={removing}`.
- No e2e-selector hit for this file (recon.md § Risks lower-risk list) — this is the "easier," already-two-button (Confirm/Cancel) shape design.md picks as Alert Dialog's first wire (round 2 correction: `accountShared.tsx` is the easier site, `OrdersTable.tsx` the harder one).
- **Round-3 design finding (must be honored)**: Radix's `AlertDialogAction` closes the dialog on click by default. `handleRemove` is `async` and the current UI keeps Confirm/Cancel visible-but-`disabled={removing}` across the in-flight `deregisterBrokerAccount` call — a naive `onClick={handleRemove}` on `AlertDialogAction` would let the dialog auto-close mid-flight instead.

**TDD**: N/A (no e2e-risk call site; verified by running the trader e2e suite green pre/post)

**Instructions**:
1. Import `AlertDialog`, `AlertDialogTrigger`, `AlertDialogContent`, `AlertDialogAction`, `AlertDialogCancel` (and `AlertDialogDescription` for the "Deregister…" copy) from `@/components/ui/alert-dialog`.
2. Replace the `confirming` state machine (the `Remove` button at L218-220 plus the conditional confirm block at L225-245) with `<AlertDialog><AlertDialogTrigger asChild><Button size="sm" variant="ghost">Remove</Button></AlertDialogTrigger><AlertDialogContent><AlertDialogDescription>Deregister {account.displayName}? In-flight orders will complete but no new orders can be placed.</AlertDialogDescription><AlertDialogCancel disabled={removing}>Cancel</AlertDialogCancel><AlertDialogAction disabled={removing} onClick={(e) => { e.preventDefault(); handleRemove(); }}>Confirm</AlertDialogAction></AlertDialogContent></AlertDialog>`.
3. **The `event.preventDefault()` inside `AlertDialogAction`'s `onClick` is mandatory** (design.md round-3 finding) — it stops Radix's default auto-close so the dialog stays open, Confirm/Cancel stay visible-but-disabled, exactly matching the pre-migration UX across the async `handleRemove()` call. Do not ship a bare `onClick={handleRemove}`.
4. Remove the `confirming` `useState` and its conditional-render block entirely (AC-2).

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm build && pnpm test:e2e -g "accounts"
```
Manually confirm (or add an assertion if `e2e/trader/accounts.spec.ts` — or wherever `AccountRow` is exercised — covers a remove flow) that the dialog stays open with Confirm/Cancel disabled during the in-flight call, not auto-closing.

---

### Step 16 — test: OrdersTable.tsx Alert Dialog swap — red

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/trader/OrdersTable.tsx` — modify

**Reviewers**: xstockstrat-ui service owner — Order execution correctness, Trading UI correctness

**Codebase Evidence**:
- `src/components/trader/OrdersTable.tsx:58-66` — `handleCancel(orderId)`: `if (pendingCancel !== orderId) { setPendingCancel(orderId); return; } cancelOrder({ orderId }); setPendingCancel(null);` — a single label-toggling button (arm on first click, confirm on second), not a separate dismiss control.
- `src/components/trader/OrdersTable.tsx:140-149` — `<Button ... variant={pendingCancel === order.orderId ? 'destructive' : 'outline'} onClick={() => handleCancel(order.orderId)} data-testid={\`cancel-${order.orderId}\`}>{pendingCancel === order.orderId ? 'Confirm' : 'Cancel'}</Button>`.
- `e2e/trader/orders.spec.ts:174,178` — `page.getByTestId('cancel-ord-filled')` (disabled-state check) and `page.getByTestId('cancel-ord-new')` (`await cancelBtn.click(); await expect(cancelBtn).toHaveText('Confirm'); await cancelBtn.click();`).
- Design.md's Open Risks: this site's single label-toggling button "means the two-step split for that site needs a fuller test restructure (open the dialog, assert two distinct elements) than the tier-4 template's 'rename the selector' shape implies" — this is the **harder** shape, wired second per design.md.

**TDD**: red-green required — red half.

**Instructions**:
1. Import `AlertDialog`, `AlertDialogTrigger`, `AlertDialogContent`, `AlertDialogAction`, `AlertDialogCancel` from `@/components/ui/alert-dialog`.
2. Replace the single label-toggling `Button` (L140-149) and the `pendingCancel` arm/confirm state machine (`handleCancel`, L58-66) with `<AlertDialog><AlertDialogTrigger asChild><Button type="button" variant="outline" size="sm" disabled={isTerminal} data-testid={\`cancel-${order.orderId}\`}>Cancel</Button></AlertDialogTrigger><AlertDialogContent><AlertDialogCancel data-testid={\`cancel-${order.orderId}-dismiss\`}>Dismiss</AlertDialogCancel><AlertDialogAction onClick={() => cancelOrder({ orderId: order.orderId })} data-testid={\`cancel-${order.orderId}-confirm\`}>Confirm</AlertDialogAction></AlertDialogContent></AlertDialog>` — this restructures a **single toggling element** into **two distinct elements** (trigger + confirm action), exactly the "fuller test restructure" design.md's Open Risks flags. Keep the `pendingCancel` state removed entirely (`handleCancel` is no longer needed — `AlertDialogTrigger` opens the dialog natively).
3. Remove the now-dead `pendingCancel` `useState` and `handleCancel` function (AC-2).
4. Do not touch `orders.spec.ts` yet. Run it unmodified — expect `getByTestId('cancel-ord-new')`'s "click once → text becomes 'Confirm'" assertion to fail, since the trigger button's text no longer changes (it opens a dialog instead); record the actual observed failure.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm test:e2e -g "orders" 2>&1 | tee /tmp/step16-red-run.log
```
Record actual pass/fail in `context.md`.

---

### Step 17 — test: OrdersTable.tsx Alert Dialog swap — green (restructure the spec)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/trader/orders.spec.ts` — modify

**Reviewers**: xstockstrat-ui service owner — Order execution correctness, Trading UI correctness

**Codebase Evidence**:
- `e2e/trader/orders.spec.ts:169-184` — the `'Edit is enabled for NEW/PARTIALLY_FILLED and disabled for FILLED'` test (`getByTestId('cancel-ord-filled')` disabled check, unaffected — the trigger button keeps the same `data-testid` and `disabled={isTerminal}` gate) and the `'Cancel requires a confirmation step then issues CancelOrder'` test (needs restructuring per Step 16).
- Step 16's recorded red-run result and the new two-element DOM shape (`cancel-${orderId}` trigger, `cancel-${orderId}-confirm` action).

**TDD**: red-green required — green half.

**Instructions**:
1. Rewrite the `'Cancel requires a confirmation step then issues CancelOrder'` test: click `getByTestId('cancel-ord-new')` (opens the dialog) → assert `getByTestId('cancel-ord-new-confirm')` is visible → click it → `await expect.poll(() => cancelRequested).toBe(true)`. This asserts **two distinct elements** (trigger + confirm), not a single element's changing text — the fuller restructure design.md's Open Risks anticipated.
2. The disabled-state test (`cancel-ord-filled`) needs no behavioral change — confirm it still targets the trigger's `data-testid` and still resolves.
3. Confirm no other spec in the trader e2e suite depends on the old single-button toggle text (`'Cancel'`→`'Confirm'` on the same element).

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm test:e2e -g "orders"
```
All cases in `orders.spec.ts` pass, including the restructured cancel-confirmation test.

---

### Step 18 — service: Add ui/alert.tsx primitive + warning variant + test (FR-4, FR-12)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/ui/alert.tsx` — create
- `services/xstockstrat-ui/src/components/ui/alert.test.ts` — create

**Reviewers**: xstockstrat-ui service owner — Trading UI correctness

**Codebase Evidence**:
- `src/components/copilot/CopilotRail.tsx:150-154` — `className={cn('rounded-md border p-3', flag.level === 'watch' ? 'border-yellow-500/40 bg-yellow-500/5' : 'bg-background')}` — identical tone tokens duplicated at:
- `src/components/mobile/SectionRenderer.tsx:112-116` — `className={cn('flex items-start gap-2 rounded-md border p-3 text-sm', s.tone === 'warn' ? 'border-yellow-500/40 bg-yellow-500/5' : 'bg-card')}`.
- `src/components/ui/badge.tsx:25` — precedent for the same yellow tone already named `warning` on `Badge`: `warning: 'border-transparent bg-yellow-500/20 text-yellow-400'`.

**TDD**: `red N/A — mechanical regression guard, not a true red-green cycle` (corrected 2026-08-09: the primitive is authored before `alert.test.ts`, so no module-not-found red is ever produced by construction — see Step 4's identical correction). Same-step guard locking in the `warning` variant.

**Instructions**:
1. Run `npx shadcn@latest add alert`. Fallback: hand-author matching `badge.tsx`'s cva shape (plain function, `data-slot="alert"`, `cn()` merge).
2. Add an app-specific `warning` variant to the regenerated file's `cva()` `variants`, marked `// app-specific`, using the `border-yellow-500/40 bg-yellow-500/5` token pair duplicated across `CopilotRail.tsx`/`SectionRenderer.tsx` (design.md round-2 finding — collapses both sites onto `variant="warning"` instead of a conditional className layered on top).
3. Create `alert.test.ts` mirroring `badge.test.ts`: `expect(alertVariants({ variant: 'warning' })).toContain('bg-yellow-500/5')` (or the exact class the reconciled variant emits).

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm test:unit -- alert.test.ts && pnpm test:unit && pnpm build
```

---

### Step 19 — service: Wire Alert → CardNotice.tsx (lowest-risk first wire)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/shared/CardNotice.tsx` — modify

**Reviewers**: xstockstrat-ui service owner — Trading UI correctness, analytics display accuracy

**Codebase Evidence**:
- `src/components/shared/CardNotice.tsx:1-22` (full file) — `<Card><CardContent className="pt-5"><p className={\`text-sm ${variant === 'error' ? 'text-destructive' : 'text-muted-foreground'}\`}>{children}</p></CardContent></Card>`.
- Real consumers beyond the FR-4-cited file (design.md round-2, verified by grepping rendered strings): `src/components/trader/OrderBook.tsx:71-72`, `src/components/trader/PortfolioPanel.tsx:15-16`, `src/app/trader/portfolio/page.tsx:69-70,152` — all four confirmed to carry no e2e-load-bearing selectors on `CardNotice`'s rendered text ("Loading portfolio…", "Portfolio unavailable", "No open positions in the selected account.").
- Design.md round-3 finding: swapping only the inner `<p>` for `AlertDescription` means `CardNotice` never touches the `Alert` root, so it gains none of `role="alert"` (which lives on the `Alert` root) — a real accessibility regression on the `error` tone specifically.

**TDD**: N/A (no e2e-risk call site across any of its 4 real consumers, verified by grep per design.md round-2 — run the trader + portfolio e2e suites green pre/post)

**Instructions**:
1. Import `AlertDescription` from `@/components/ui/alert` (not the full `Alert` root — the wrapper decision below keeps `Card`/`CardContent`).
2. Replace the inner `<p className={...}>{children}</p>` with `<AlertDescription className={variant === 'error' ? 'text-destructive' : 'text-muted-foreground'}>{children}</AlertDescription>` — **keep the existing `<Card><CardContent className="pt-5">` wrapper unchanged** (design.md round-2: a full `Card`→bare-`Alert` replacement would visibly change box chrome for all 4 real consumers, crossing into the out-of-scope "visual/behavioral redesign" the product spec forbids).
3. **Add `role={variant === 'error' ? 'alert' : undefined}` on `CardNotice`'s own returned `<Card>` element** (design.md round-3 fix) — this closes the `role="alert"` gap the inner-only swap would otherwise leave, without touching the wrapper decision.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm build && pnpm test:e2e -g "portfolio" && pnpm test:e2e -g "orders"
```
Confirm none of the 4 consumers' e2e coverage breaks (OrderBook, PortfolioPanel, trader/portfolio page — all exercised by the trader/portfolio e2e specs).

---

### Step 20 — service: Wire Alert → SectionRenderer.tsx 'note' section kind (remaining no-e2e-risk)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/mobile/SectionRenderer.tsx` — modify

**Reviewers**: xstockstrat-ui service owner — Trading UI correctness

**Codebase Evidence**:
- `src/components/mobile/SectionRenderer.tsx:110-123` — `case 'note': return (<div className={cn('flex items-start gap-2 rounded-md border p-3 text-sm', s.tone === 'warn' ? 'border-yellow-500/40 bg-yellow-500/5' : 'bg-card')}>{s.tone === 'warn' && <Warning weight="fill" className="mt-0.5 h-4 w-4 shrink-0 text-yellow-400" />}<span>{s.text}</span></div>);`.
- No e2e spec references this rendered content per a fresh grep (design.md round-4 finding, tier 3).

**TDD**: N/A (no e2e-risk; verified by running the mobile-companion e2e coverage, if any, green pre/post — `docs/patterns/...` mobile section dispatcher has no dedicated e2e per recon)

**Instructions**:
1. Import `Alert`, `AlertDescription` from `@/components/ui/alert`.
2. Replace the raw `<div>` (L111-122) with `<Alert variant={s.tone === 'warn' ? 'warning' : 'default'}>{s.tone === 'warn' && <Warning weight="fill" className="h-4 w-4" />}<AlertDescription>{s.text}</AlertDescription></Alert>` — use the Step 18 app-specific `warning` variant instead of the hand-rolled conditional className, closing the second half of the `CopilotRail.tsx`/`SectionRenderer.tsx` duplication (design.md round-2 DRY finding).
3. Delete the raw `<div>` block being replaced (AC-2/AC-3).

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm build && pnpm test:e2e -g "mobile"
```

---

### Step 21 — test: CopilotRail.tsx Alert swap — red

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/copilot/CopilotRail.tsx` — modify

**Reviewers**: xstockstrat-ui service owner — Trading UI correctness

**Codebase Evidence**:
- `src/components/copilot/CopilotRail.tsx:149-165` — `<section className={cn('rounded-md border p-3', flag.level === 'watch' ? 'border-yellow-500/40 bg-yellow-500/5' : 'bg-background')} data-testid="copilot-concentration"><p ...>{flag.level === 'watch' && <Warning ... />}Concentration</p><p className="text-sm">{flag.text}</p></section>`.
- `e2e/copilot.spec.ts:38` — `await expect(page.getByTestId('copilot-concentration')).toBeVisible();`.

**TDD**: red-green required — red half.

**Instructions**:
1. Import `Alert`, `AlertDescription`, `AlertTitle` (if the generated primitive exposes a title sub-part) from `@/components/ui/alert`.
2. Replace the `<section>` (L150-164) with `<Alert variant={flag.level === 'watch' ? 'warning' : 'default'} data-testid="copilot-concentration"><AlertTitle>{flag.level === 'watch' && <Warning weight="fill" className="h-3.5 w-3.5" />}Concentration</AlertTitle><AlertDescription>{flag.text}</AlertDescription></Alert>` — **preserve `data-testid="copilot-concentration"` on the outermost element**, since that is what `copilot.spec.ts:38` targets (a `data-testid` survives a component swap by construction as long as it's forwarded — confirm the generated `Alert` root spreads `...props` so `data-testid` passes through).
3. This is disambiguated from FR-10's Badge edit on the same file (`CopilotRail.tsx:124-126`, already landed in Step 2) — touch only L149-165 here.
4. Run `copilot.spec.ts` unmodified and record the actual result — a `data-testid` swap is expected to still pass, but this must be observed per design.md's mandatory-even-when-expected-to-pass instruction (P-06, `fails.md` 2026-07-29 074).

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm test:e2e -g "copilot" 2>&1 | tee /tmp/step21-red-run.log
```
Record actual pass/fail in `context.md` — even if it passes unmodified, the run and its result must be recorded, not skipped.

---

### Step 22 — test: CopilotRail.tsx Alert swap — green (confirm or fix)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/copilot.spec.ts` — modify only if Step 21 recorded a failure

**Reviewers**: xstockstrat-ui service owner — Trading UI correctness

**Codebase Evidence**:
- Step 21's recorded red-run result.
- `e2e/copilot.spec.ts:35,38` — `getByTestId('copilot-queue-summary')` (unaffected, not part of this swap) / `getByTestId('copilot-concentration')`.

**TDD**: red-green required — green half.

**Instructions**:
1. If Step 21 recorded a pass, no spec change is needed — record that outcome explicitly in `context.md` as the closing half of the pair (do not leave this step a no-op without a record).
2. If Step 21 recorded a failure (e.g. `data-testid` not forwarded to the rendered DOM element, or an unexpected wrapper), fix the selector or the `Alert` primitive's prop-spreading (whichever is the actual root cause) and re-run.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm test:e2e -g "copilot"
```

---

### Step 23 — service: Add ui/checkbox.tsx primitive + test (FR-5, FR-12)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/ui/checkbox.tsx` — create
- `services/xstockstrat-ui/src/components/ui/checkbox.test.ts` — create

**Reviewers**: xstockstrat-ui service owner — Trading UI correctness

**Codebase Evidence**:
- `src/components/ui/select.tsx:1-11` — shape to match (`import { Checkbox as CheckboxPrimitive } from 'radix-ui'`, plain function, `data-slot="checkbox"`).
- No app-specific variant needed (design.md — one of the 5 minimal-test primitives).

**TDD**: `red N/A — mechanical regression guard, not a true red-green cycle` (corrected 2026-08-09: the primitive is authored before `checkbox.test.ts`, so no module-not-found red is ever produced by construction — see Step 4's identical correction).

**Instructions**:
1. Run `npx shadcn@latest add checkbox`. Fallback: hand-author matching `select.tsx`'s shape.
2. Create `checkbox.test.ts` — minimal presence test asserting `Checkbox` is exported and defined.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm test:unit -- checkbox.test.ts && pnpm test:unit && pnpm build
```

---

### Step 24 — service: Wire Checkbox → FormulaWorkspace.tsx and ParameterEditor.tsx

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/insights/FormulaWorkspace.tsx` — modify
- `services/xstockstrat-ui/src/components/insights/ParameterEditor.tsx` — modify

**Reviewers**: xstockstrat-ui service owner — Trading UI correctness

**Codebase Evidence**:
- `src/components/insights/FormulaWorkspace.tsx:278-285` — `<label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} />Public (visible to all users)</label>` (label block confirmed closing at L285, per recon.md § Risks off-by-one fix — product-spec.md FR-5 already corrected to `278-285`).
- `src/components/insights/ParameterEditor.tsx:236-244` — `<label className="flex items-end gap-2 text-xs"><input type="checkbox" aria-label={\`parameter required ${i}\`} checked={p.required} onChange={(e) => update(i, { required: e.target.checked })} />Required</label>`.
- Neither site has an e2e-selector hit per recon.md § Risks (lower-risk list).

**TDD**: N/A (no e2e-risk; verified by running the insights e2e suite green pre/post)

**Instructions**:
1. In `FormulaWorkspace.tsx`, import `Checkbox` from `@/components/ui/checkbox`. Replace `<input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} />` with `<Checkbox checked={isPublic} onCheckedChange={(checked) => setIsPublic(checked === true)} />` (Radix `Checkbox`'s `onCheckedChange` passes `boolean | 'indeterminate'`, not a raw change event — normalize accordingly). Keep the surrounding `<label>` text.
2. In `ParameterEditor.tsx`, import `Checkbox`. Replace `<input type="checkbox" aria-label={...} checked={p.required} onChange={(e) => update(i, { required: e.target.checked })} />` with `<Checkbox aria-label={\`parameter required ${i}\`} checked={p.required} onCheckedChange={(checked) => update(i, { required: checked === true })} />` — preserve the indexed `aria-label` exactly.
3. Delete both raw `<input type="checkbox">` elements (AC-2).

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm build && pnpm test:e2e -g "formula" && pnpm test:e2e -g "parameter"
```

---

### Step 25 — service: Add ui/breadcrumb.tsx primitive + test (FR-7, FR-12)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/ui/breadcrumb.tsx` — create
- `services/xstockstrat-ui/src/components/ui/breadcrumb.test.ts` — create

**Reviewers**: xstockstrat-ui service owner — Trading UI correctness

**Codebase Evidence**:
- No app-specific variant needed (design.md — minimal-test primitive).
- `src/components/ui/select.tsx:1-11` — shape to match.

**TDD**: `red N/A — mechanical regression guard, not a true red-green cycle` (corrected 2026-08-09: the primitive is authored before `breadcrumb.test.ts`, so no module-not-found red is ever produced by construction — see Step 4's identical correction).

**Instructions**:
1. Run `npx shadcn@latest add breadcrumb`. Fallback: hand-author matching `select.tsx`'s shape (Breadcrumb has no Radix primitive dependency in the standard shadcn recipe — it is typically plain `nav`/`ol`/`li` markup with `data-slot`s; confirm against the CLI-generated file or the hand-authored fallback's own equivalent structure).
2. Create `breadcrumb.test.ts` — minimal presence test.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm test:unit -- breadcrumb.test.ts && pnpm test:unit && pnpm build
```

---

### Step 26 — service: Wire Breadcrumb → NamespaceEditor.tsx and config-ui/audit/page.tsx (no-e2e-risk)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/config-ui/[namespace]/NamespaceEditor.tsx` — modify
- `services/xstockstrat-ui/src/app/config-ui/audit/page.tsx` — modify

**Reviewers**: xstockstrat-ui service owner — config mutation safety, Trading UI correctness

**Codebase Evidence**:
- `src/app/config-ui/[namespace]/NamespaceEditor.tsx:124-144` — `<div className="space-y-4">{/* Breadcrumb */}<div className="flex flex-wrap items-center gap-2"><Link href={\`/config-ui?env=${env}&mode=${mode}\`} ...>← namespaces</Link><span className="text-muted-foreground">/</span><h1 className="text-base font-semibold"><span className="text-primary font-mono">{namespace}</span></h1><div className="flex gap-1.5 ml-1"><Badge ...>{env}</Badge><Badge ...>{mode}</Badge></div></div>{...}</div>`.
- `src/app/config-ui/audit/page.tsx:15-22` — `<div className="flex items-center gap-2"><Link href="/config-ui" ...>← namespaces</Link><span className="text-muted-foreground">/</span><h1 className="text-base font-semibold">Audit Log</h1></div>` — **byte-for-byte identical** `Link` + `/` separator + heading shape to `NamespaceEditor.tsx`'s opening three elements (the two "byte-for-byte identical" occurrences product-spec.md FR-7 names).
- No dedicated e2e spec exists under `e2e/config-ui/` for the audit page at all (recon.md § Risks — confirmed absent).

**TDD**: N/A (audit page has no e2e coverage to red/green against — AC-6 routes it to a manual screenshot compare in Step 35 instead; `NamespaceEditor.tsx` has no e2e-selector hit per recon.md)

**Instructions**:
1. Import `Breadcrumb`, `BreadcrumbList`, `BreadcrumbItem`, `BreadcrumbLink`, `BreadcrumbSeparator`, `BreadcrumbPage` from `@/components/ui/breadcrumb`.
2. In `NamespaceEditor.tsx`, replace the `Link` + `/` + `namespace` heading (L126-135) with `<Breadcrumb><BreadcrumbList><BreadcrumbItem><BreadcrumbLink href={\`/config-ui?env=${env}&mode=${mode}\`}>← namespaces</BreadcrumbLink></BreadcrumbItem><BreadcrumbSeparator /><BreadcrumbItem><BreadcrumbPage>{namespace}</BreadcrumbPage></BreadcrumbItem></BreadcrumbList></Breadcrumb>`, keeping the `env`/`mode` `Badge`s (L136-143) outside the `Breadcrumb`, unchanged.
3. In `audit/page.tsx`, replace the identical `Link` + `/` + heading shape (L16-21) with `<Breadcrumb><BreadcrumbList><BreadcrumbItem><BreadcrumbLink href="/config-ui">← namespaces</BreadcrumbLink></BreadcrumbItem><BreadcrumbSeparator /><BreadcrumbItem><BreadcrumbPage>Audit Log</BreadcrumbPage></BreadcrumbItem></BreadcrumbList></Breadcrumb>` — this is the second half of AC-3's "duplicate breadcrumb… reduced to one shared implementation."
4. Delete both raw markup blocks being replaced (AC-2).

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm build && pnpm test:e2e -g "config-ui"
```
No e2e spec exists for the audit page (confirmed) — the manual screenshot compare happens in Step 35.

---

### Step 27 — service: Add ui/accordion.tsx primitive + test (FR-8, FR-12)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/ui/accordion.tsx` — create
- `services/xstockstrat-ui/src/components/ui/accordion.test.ts` — create

**Reviewers**: xstockstrat-ui service owner — Trading UI correctness

**Codebase Evidence**:
- No app-specific variant needed (design.md — minimal-test primitive).
- `src/components/ui/select.tsx:1-11` — shape to match.

**TDD**: `red N/A — mechanical regression guard, not a true red-green cycle` (corrected 2026-08-09: the primitive is authored before `accordion.test.ts`, so no module-not-found red is ever produced by construction — see Step 4's identical correction).

**Instructions**:
1. Run `npx shadcn@latest add accordion`. Fallback: hand-author matching `select.tsx`'s shape (`import { Accordion as AccordionPrimitive } from 'radix-ui'`, plain functions, `data-slot`).
2. Create `accordion.test.ts` — minimal presence test.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm test:unit -- accordion.test.ts && pnpm test:unit && pnpm build
```

---

### Step 28 — service: Wire Accordion → PlatformHeader.tsx mobile nav groups

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/shared/PlatformHeader.tsx` — modify

**Reviewers**: xstockstrat-ui service owner — Trading UI correctness

**Codebase Evidence**:
- `src/components/shared/PlatformHeader.tsx:209-253` — mobile nav (`<nav aria-label="Mobile" className="mt-6 flex flex-col gap-1">{NAV_GROUPS.map((group) => { const isOpen = expanded === group.key; return (<div key={group.key}><button type="button" aria-expanded={isOpen} onClick={() => setExpanded((prev) => (prev === group.key ? '' : group.key))} className={...}>{group.icon}<span className="flex-1">{group.label}</span><CaretDown className={cn('h-4 w-4 transition-transform', isOpen && 'rotate-180')} /></button>{isOpen && (<div className="ml-4 mt-1 ...">{visibleItems(group.items).map((sub) => <SheetClose asChild key={sub.href}><Link href={sub.href} ...>{sub.label}</Link></SheetClose>)}</div>)}</div>); })}</nav>`) — this block lives inside the existing `Sheet`/`SheetContent` (L195-255) that hosts the mobile menu.
- Zero e2e-selector hits for this block per recon.md § Risks.
- Per `## Step Dependencies`, this step lands after Step 26 (Breadcrumb's no-e2e-risk wire) and before Steps 29-30 (Breadcrumb's tier-4 pair) — both FR-7/FR-8 stay adjacent on this shared file (recon.md sequencing risk), and Accordion needs no red/green round-trip so it ships first among the two remaining `PlatformHeader.tsx` edits.

**TDD**: N/A (no e2e-risk; verified by running `nav-reachability.spec.ts` and any mobile-menu spec green pre/post)

**Instructions**:
1. Import `Accordion`, `AccordionItem`, `AccordionTrigger`, `AccordionContent` from `@/components/ui/accordion`.
2. Replace the `expanded`-state-driven `NAV_GROUPS.map` block (L210-252) with `<Accordion type="single" collapsible value={expanded} onValueChange={(v) => setExpanded(v ?? '')}>{NAV_GROUPS.map((group) => <AccordionItem key={group.key} value={group.key}><AccordionTrigger className={cn(group.key === activeGroup.key ? 'bg-accent text-foreground font-medium' : 'text-muted-foreground')}>{group.icon}<span className="flex-1">{group.label}</span></AccordionTrigger><AccordionContent><div className="ml-4 mt-1 ...">{visibleItems(group.items).map((sub) => <SheetClose asChild key={sub.href}><Link href={sub.href} ...>{sub.label}</Link></SheetClose>)}</div></AccordionContent></AccordionItem>)}</Accordion>` — `AccordionTrigger` supplies its own chevron/rotation affordance by convention (confirm the CLI-generated file's default chevron icon doesn't visually duplicate `CaretDown` — drop the hand-rolled `CaretDown` if `AccordionTrigger` already renders one, per AC-4's "no visual/behavioral redesign beyond swapping markup" — a doubled chevron would be a regression, not a like-for-like swap).
3. Remove the `expanded` state's manual toggle logic where `Accordion`'s own `value`/`onValueChange` now owns it; keep `expanded`/`setExpanded` as the controlling state variable so `activeGroup` comparisons elsewhere in the file (if any) stay intact.
4. Delete the raw button/chevron/conditional-render block being replaced (AC-2).

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm build && pnpm test:e2e -g "nav-reachability"
```

---

### Step 29 — test: PlatformHeader.tsx desktop Breadcrumb swap — red

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/shared/PlatformHeader.tsx` — modify

**Reviewers**: xstockstrat-ui service owner — Trading UI correctness

**Codebase Evidence**:
- `src/components/shared/PlatformHeader.tsx:260-269` — `<div className="hidden sm:flex items-center gap-2 px-4 sm:px-6 h-9 border-t border-border/60"><span className="text-xs text-muted-foreground shrink-0" aria-label="Breadcrumb"><span className="text-muted-foreground">{activeGroup.label}</span>{activeItem && (<><span className="mx-1.5 opacity-50">/</span><span className="text-foreground font-medium">{activeItem.label}</span></>)}</span><Separator orientation="vertical" className="h-4 mx-1" />...</div>` — this is structurally **a label span**, not a `Link`-based crumb trail like `NamespaceEditor.tsx`/`audit/page.tsx` (Step 26) — the third, structurally-different Breadcrumb occurrence FR-7 names.
- `e2e/nav-reachability.spec.ts:70-71` — `await expect(page.getByLabel('Breadcrumb')).toContainText(item.label); await expect(page.getByLabel('Breadcrumb')).toContainText(group.tab);` — targets the `aria-label="Breadcrumb"`, case-sensitive as written but Playwright's `getByLabel` default matching is case-insensitive substring (design.md's cross-cutting verification note — likely moot, confirm via this red run rather than assuming).

**TDD**: red-green required — red half.

**Instructions**:
1. Import `Breadcrumb`, `BreadcrumbList`, `BreadcrumbItem`, `BreadcrumbPage`, `BreadcrumbSeparator` from `@/components/ui/breadcrumb`.
2. Replace the `<span aria-label="Breadcrumb">` block (L261-269) with a `Breadcrumb` composition that **preserves `aria-label="Breadcrumb"` on the outermost rendered element** (verify the CLI-generated `Breadcrumb` root forwards arbitrary props via `{...props}` — if it does not, apply `aria-label="Breadcrumb"` directly on whichever element `nav-reachability.spec.ts`'s `getByLabel` needs to resolve against, confirmed by this step's own red run): `<Breadcrumb aria-label="Breadcrumb"><BreadcrumbList><BreadcrumbItem><BreadcrumbPage>{activeGroup.label}</BreadcrumbPage></BreadcrumbItem>{activeItem && (<><BreadcrumbSeparator /><BreadcrumbItem><BreadcrumbPage className="text-foreground font-medium">{activeItem.label}</BreadcrumbPage></BreadcrumbItem></>)}</BreadcrumbList></Breadcrumb>`. Keep the sibling `Separator` (L270) and the `<nav aria-label="Section">` (L271+) unchanged — this step touches only L260-269.
3. Run `nav-reachability.spec.ts` unmodified and record the actual result.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm test:e2e -g "nav-reachability" 2>&1 | tee /tmp/step29-red-run.log
```
Record actual pass/fail in `context.md`.

---

### Step 30 — test: PlatformHeader.tsx desktop Breadcrumb swap — green

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/nav-reachability.spec.ts` — modify only if Step 29 recorded a failure

**Reviewers**: xstockstrat-ui service owner — Trading UI correctness

**Codebase Evidence**:
- `e2e/nav-reachability.spec.ts:70-71`.
- Step 29's recorded red-run result.

**TDD**: red-green required — green half.

**Instructions**:
1. If Step 29 passed unmodified, record that outcome in `context.md` — no spec edit needed (design.md flagged this as "likely moot in practice" given Playwright's case-insensitive `getByLabel`, but the pass must still be *observed and recorded*, not assumed).
2. If Step 29 failed (the `aria-label` did not survive on a `getByLabel`-resolvable element), fix the `Breadcrumb` composition from Step 29 to carry `aria-label="Breadcrumb"` on the correct DOM node and re-run — do not rewrite the spec's assertion to match a broken component (the accessible label is the contract to preserve, per recon.md's e2e risk framing).

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm test:e2e -g "nav-reachability"
```

---

### Step 31 — service: Add ui/progress.tsx primitive + buy/paper/sell/muted variant + test (FR-9, FR-12)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/ui/progress.tsx` — create
- `services/xstockstrat-ui/src/components/ui/progress.test.ts` — create

**Reviewers**: xstockstrat-ui service owner — Trading UI correctness, analytics display accuracy

**Codebase Evidence**:
- `src/components/insights/WatchlistReadiness.tsx:202-207` — `<div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted"><div className={cn('h-full', barClass(r))} style={{ width: \`${Math.round(r.conviction * 100)}%\` }} /></div>` — `barClass(r)`'s firing-state taxonomy is the semantically-meaningful state design.md promotes into a shared variant (not decoration).
- `src/components/insights/SignalReadiness.tsx:73-78` — `<div className="h-2 w-40 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary" style={{ width: \`${Math.round(readiness.conviction * 100)}%\` }} /></div>` — static `bg-primary` fill, no state logic (verified by reading the file — stays on `variant="default"`).
- `src/components/mobile/SectionRenderer.tsx:65-70` — `<div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary" style={{ width: \`${Math.round(s.conviction * 100)}%\` }} /></div>` — same static shape as `SignalReadiness.tsx`, stays `variant="default"`.
- `src/components/ui/badge.tsx:21-24` — same `buy`/`sell`/`paper` design tokens the Progress variant reuses.

**TDD**: `red N/A — mechanical regression guard, not a true red-green cycle` (corrected 2026-08-09: the primitive is authored before `progress.test.ts`, so no module-not-found red is ever produced by construction — see Step 4's identical correction).

**Instructions**:
1. Run `npx shadcn@latest add progress`. Fallback: hand-author matching `select.tsx`'s shape (`import { Progress as ProgressPrimitive } from 'radix-ui'`).
2. Add an app-specific `buy`/`paper`/`sell`/`muted` variant to the regenerated file's `cva()` `variants`, marked `// app-specific`, promoting `WatchlistReadiness.tsx`'s existing `barClass(r)` firing-state taxonomy into the primitive (design.md — this is semantically meaningful state, not decoration, per the round-2 decision).
3. **Verify the primitive's fill mechanism** against the CLI-generated file: confirm whether it drives the filled width via an inline `style={{ transform: ... }}` on an `Indicator` sub-part (Radix's documented pattern) rather than this codebase's current inline `style={{ width }}` — this affects how `value` (0-100) is consumed by callers in Steps 32/33-34. Record the confirmed mechanism in `context.md` (design.md Open Risks — unverified until this step runs).
4. Create `progress.test.ts` mirroring `badge.test.ts`: assert each of `buy`/`paper`/`sell`/`muted` renders its expected class token.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm test:unit -- progress.test.ts && pnpm test:unit && pnpm build
```

---

### Step 32 — service: Wire Progress → SignalReadiness.tsx and SectionRenderer.tsx (no-e2e-risk)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/insights/SignalReadiness.tsx` — modify
- `services/xstockstrat-ui/src/components/mobile/SectionRenderer.tsx` — modify

**Reviewers**: xstockstrat-ui service owner — Trading UI correctness, analytics display accuracy

**Codebase Evidence**:
- `src/components/insights/SignalReadiness.tsx:73-78` (cited above, Step 31 evidence) — static `bg-primary` fill, `readiness.conviction` is a 0-1 float, current markup multiplies by 100 and rounds inline.
- `src/components/mobile/SectionRenderer.tsx:65-70` (cited above) — same shape, `s.conviction` 0-1 float.
- Both confirmed no-e2e-risk per recon.md § Risks.

**TDD**: N/A (no e2e-risk; verified by running the insights + mobile e2e suites green pre/post)

**Instructions**:
1. Import `Progress` from `@/components/ui/progress` in both files.
2. In `SignalReadiness.tsx`, replace the two-div bar (L73-77) with `<Progress value={Math.round(readiness.conviction * 100)} className="h-2 w-40" variant="default" />` — using whichever prop name Step 31 confirmed drives the fill.
3. In `SectionRenderer.tsx`, replace the two-div bar (L65-69) with `<Progress value={Math.round(s.conviction * 100)} className="h-1.5 w-16" variant="default" />`.
4. Delete both raw two-div bar blocks (AC-2/AC-3 — the "triplicated progress-bar shape" AC-3 names starts collapsing here; the third site, `WatchlistReadiness.tsx`, is Steps 33-34).

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm build && pnpm test:e2e -g "market" && pnpm test:e2e -g "mobile"
```

---

### Step 33 — test: WatchlistReadiness.tsx Progress swap — red

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/insights/WatchlistReadiness.tsx` — modify

**Reviewers**: xstockstrat-ui service owner — Trading UI correctness, analytics display accuracy

**Codebase Evidence**:
- `src/components/insights/WatchlistReadiness.tsx:195-237` — the full `<li data-testid={\`readiness-row-${binding.symbol}\`}>` row (verified: the `<li>` block actually closes at L237, not L225 as an earlier citation had it), including the bar (L202-207, cited in Step 31) and the `queued && <Badge variant="info" data-testid="in-queue">in queue</Badge>` (L221-225) — Step 33's actual edit targets only L202-207, this range is cited for row-scope context only.
- `e2e/insights/watchlists.spec.ts:25,42-140,203,236` — extensive `getByTestId(\`readiness-row-${symbol}\`)` / `'in-queue'` usage — these `data-testid`s are on the `<li>` and the `Badge`, **not** on the Progress bar itself, so they are not directly at risk from the Progress swap — but design.md flags the row's overall structure as e2e-risk because the bar sits inside the same `<li>` these tests scope into.

**TDD**: red-green required — red half.

**Instructions**:
1. Import `Progress` from `@/components/ui/progress`.
2. Replace the two-div bar (L202-207) with `<Progress value={Math.round(r.conviction * 100)} className="h-1.5 w-20" variant={/* map barClass(r)'s firing state to buy/paper/sell/muted per Step 31's variant */}` — using the Step 31 app-specific variant, not a hand-rolled `cn('h-full', barClass(r))` className.
3. Keep the `data-testid={\`readiness-row-${binding.symbol}\`}` (on the `<li>`) and `data-testid="in-queue"` (on the `Badge`) untouched — this step only replaces the inner bar markup.
4. Run `watchlists.spec.ts` unmodified and record the actual result — the `data-testid`s should survive since they're outside the swapped element, but this must be confirmed, not assumed (per design.md's mandatory red-run instruction).

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm test:e2e -g "watchlists" 2>&1 | tee /tmp/step33-red-run.log
```
Record actual pass/fail in `context.md`. Also confirm by inspection (or a quick harness check) that the `Math.round(r.conviction * 100)` value passed to `Progress`'s `value` prop renders the same visible fill width as the old inline `style={{ width }}` did — Step 31's fill-mechanism finding determines whether this needs an additional adjustment.

---

### Step 34 — test: WatchlistReadiness.tsx Progress swap — green

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/insights/watchlists.spec.ts` — modify only if Step 33 recorded a failure

**Reviewers**: xstockstrat-ui service owner — Trading UI correctness, analytics display accuracy

**Codebase Evidence**:
- Step 33's recorded red-run result.
- `e2e/insights/watchlists.spec.ts:25,42-140,203,236`.

**TDD**: red-green required — green half.

**Instructions**:
1. If Step 33 passed unmodified, record that outcome in `context.md`.
2. If it failed, diagnose whether the failure is in the `data-testid` locations (should not be, per Step 33's evidence) or in a value/visual assertion this suite happens to make against the bar itself — fix the component (not the test) if the `value`/fill-mapping from Step 31/33 is wrong, or update the spec only if it was asserting on the old hand-rolled implementation detail (AC-5's "no test rewritten to assert on the old hand-rolled DOM shape" constraint).

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm test:e2e -g "watchlists"
```

---

### Step 35 — test: Full-suite verification + config-ui/audit manual screenshot compare

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**: none (verification-only step; no source changes)

**Reviewers**: xstockstrat-ui service owner — Trading UI correctness, analytics display accuracy, config mutation safety, Connect-RPC call safety, environment scope correctness

**Codebase Evidence**:
- Product-spec.md Acceptance Criteria 4 (`pnpm lint`/`pnpm build` pass with no new errors), 5 (full Playwright suite passes, no test rewritten to assert on old hand-rolled DOM), 6 (`config-ui/audit/page.tsx` — recon.md-confirmed no e2e spec exists — needs a manual screenshot compare instead).
- `services/xstockstrat-ui/package.json:10-19` — `lint`, `build`, `test:unit`, `test:coverage`, `test:e2e` scripts.

**TDD**: N/A (verification-only step, no code change)

**Instructions**:
1. Run the complete lint/build/unit/e2e suite (not scoped `-g` filters — every prior step already ran its own targeted subset; this is the full-suite closing gate).
2. For `config-ui/audit/page.tsx` (no e2e spec exists, confirmed absent both at recon time and in Step 26): manually load `/config-ui/audit` before and after this feature's changes (or compare a captured screenshot against `main-dev`'s pre-migration render) and confirm the Breadcrumb swap (Step 26) produced no visible layout/style regression — record the comparison result in `context.md` per AC-6.
3. Confirm AC-3: grep for any remaining independent copies of a migrated widget's markup (e.g. `grep -rn "animate-pulse" src/app/insights/page.tsx src/app/auth/login/page.tsx` should show none outside `Skeleton`'s own implementation; `grep -rn "overflow-hidden rounded-full bg-muted" src/components/insights/SignalReadiness.tsx src/components/insights/WatchlistReadiness.tsx src/components/mobile/SectionRenderer.tsx` should show none outside `Progress`'s own implementation).

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm lint && pnpm build && pnpm test:unit && pnpm test:e2e
```
All green, no new lint/build errors, full e2e suite passes. Screenshot comparison and AC-3 greps recorded in `context.md`.

---

### Step 36 — docs: Record per-primitive migration summary in context.md

**Status**: `pending`
**Service**: `docs/`
**Files**:
- `docs/roadmap/features/120-shadcn-migration-high-confidence/context.md` — modify

**Reviewers**: none

**Codebase Evidence**: N/A (documentation step)

**TDD**: N/A (docs)

**Instructions**:
Append a session entry recording, per primitive (Tabs, Toggle Group, Alert Dialog, Alert, Checkbox,
Breadcrumb, Accordion, Progress, plus the 3 adopted primitives), which call sites were migrated, the
outcome of every mandatory red-before-green run (Steps 7-8, 10-13, 16-17, 21-22, 29-30, 33-34) — pass
or fail on the *unmodified* spec, and the fix applied if it failed — the Step 31 fill-mechanism/value-
scaling finding, the Step 9/Step 12 ARIA-role finding for Toggle Group, and the Step 35 manual
screenshot-compare result for `config-ui/audit/page.tsx`, per Acceptance Criterion 6.

**Verification**:
```bash
grep -c "Step " docs/roadmap/features/120-shadcn-migration-high-confidence/context.md
```
Confirm the new session entry names every primitive and every red-before-green outcome (AC-6).

---

## Deviation Log

**Step 6** — `ChartPanel.tsx`'s timeframe switcher was classified "no e2e-risk" in recon.md § Risks,
but `e2e/trader/chart-panel.spec.ts` has 3 assertions (`getByRole('button', { name: '15m'|'1h'|'1d' })`)
against it — a missed evidence gap, not caught until Step 6's own e2e run. **Disposition**: fixed
now (user confirmed via blocker `AskUserQuestion`) — updated the 3 assertions to
`getByRole('tab', ...)` matching Radix `TabsTrigger`'s actual rendered role; re-ran green
(11/11 passed).

# Implementation Spec: shadcn-migration-medium-confidence

**Status**: `pending`
**Created**: 2026-08-08
**Last Updated**: 2026-08-08 (FR-13 amendment — added Steps 17-20, real `NavigationMenu`
migration steps, replacing the prior "no code step" text, per `design.md`'s Round 3
user-directed override; old Step 17 renumbered to Step 21)
**Feature**: `docs/roadmap/features/121-shadcn-migration-medium-confidence/feature.md`
**Total Steps**: 21
**Feature Branch**: `feature/shadcn-migration-medium-confidence`

---

## Execution Summary

This spec covers **only tranche 1** of the product spec — FR-1, FR-2, FR-3, FR-10, FR-11, FR-12,
FR-13 — the seven FRs `recon.md` § Recommended Scope and `design.md` confirm have **no
cross-feature dependency** on sibling `120-shadcn-migration-high-confidence`. It adds four new
primitives (`switch`, `slider`, `collapsible`, `navigation-menu`), reuses two existing ones
(`badge`, `table`) at four more call sites, consolidates two independently-built filter toolbars
into one shared `FilterToolbar`, and migrates `PlatformHeader.tsx`'s/`BottomTabBar.tsx`'s hand-built
nav onto the new `navigation-menu` primitive. All work lands in `services/xstockstrat-ui/` only; no
proto, config, or DB changes.

**Tranche 2 — deliberately NOT specced here.** FR-4 through FR-9 consume `ui/alert-dialog.tsx`,
`ui/tabs.tsx`, `ui/toggle-group.tsx`, `ui/alert.tsx`, `ui/checkbox.tsx`, `ui/accordion.tsx` — a fresh
`ls services/xstockstrat-ui/src/components/ui/` this session confirms **none of these six exist yet**
on `main-dev` (current inventory: `badge, button, card, combobox, input-group, input, select,
separator, sheet, skeleton, table, textarea, utils` + their `.test.ts` guards). All six are added by
sibling `120-shadcn-migration-high-confidence`, which is `spec-ready`/not yet merged. Writing concrete
steps against those paths now would violate **F-04** (never invent a file path). **Re-run
`/sdd-spec shadcn-migration-medium-confidence` after `120` merges to `main-dev`** to plan FR-4–FR-9
with grounded evidence for the primitives it adds; `docs/roadmap/features/merge-order.md` should carry
this as a registered blocking-dependency row per product-spec's Open Questions.

**FR-13 (Navigation Menu migration) — four real code steps.** `design.md` § Round 3 records the
user-directed override that supersedes the original round-1/round-2 KEEP AS-IS recommendation:
`PlatformHeader.tsx`'s and `BottomTabBar.tsx`'s hand-built `<Link>` nav must actually be replaced with
`ui/navigation-menu.tsx`, using the standalone `NavigationMenuLink`-inside-`NavigationMenuItem`
pattern (no dropdowns/flyouts). `design.md` § Chosen Approach point 5 is the authoritative migration
plan — add the primitive, migrate `PlatformHeader.tsx`'s two desktop nav regions, migrate
`BottomTabBar.tsx`'s single mobile nav, then re-run `e2e/nav-reachability.spec.ts` to confirm the
C-10(a) contract still resolves. Steps 17–20 below implement this; `design.md`/`recon.md` are final and
were not re-derived here, only translated into concrete steps with grounded file:line citations.

**Ordering.** Steps 1–12 (FR-1/FR-2/FR-3/FR-10/FR-11) are independent of each other and of Steps
13–16 (FR-12) and Steps 17–20 (FR-13); execute in numeric order for a readable diff, not because of a
hard dependency. Within FR-13, Step 17 (the primitive) must land before Steps 18–19 (the two
migrations), which must both land before Step 20 (the e2e regression check). Step 21 is the
whole-feature verification gate and must run last, after every other step (1–20).

## Step Dependencies

- Step 2 [test] requires Step 1 [service]: exercises the FR-1 swap Step 1 lands.
- Step 4 [test] requires Step 3 [service]: exercises the FR-2 swap Step 3 lands.
- Step 6 [test] requires Step 5 [service]: exercises the FR-3 swap Step 5 lands.
- Step 9 [test] requires Steps 7 and 8 [service]: exercises both FR-10 swaps.
- Step 12 [test] requires Steps 10 and 11 [service]: exercises both FR-11 swaps.
- Step 16 [test] requires Steps 13–15 [service]: exercises the FR-12 consolidation.
- Step 18 [service] requires Step 17 [service]: migrates `PlatformHeader.tsx` onto the
  `ui/navigation-menu.tsx` primitive Step 17 lands.
- Step 19 [service] requires Step 17 [service]: migrates `BottomTabBar.tsx` onto the same primitive.
- Step 20 [test] requires Steps 18 and 19 [service]: exercises both FR-13 nav migrations against
  `e2e/nav-reachability.spec.ts`.
- Step 21 [test] requires Steps 1–20: whole-feature `lint`/`build`/`test:e2e` gate (acceptance
  criterion 5), runs after every other step.
- **Deferred, not a step in this spec**: FR-4 through FR-9 — re-run `/sdd-spec` once
  `120-shadcn-migration-high-confidence` merges to `main-dev` (see Execution Summary).

---

### Step 1 — service: Add `ui/switch.tsx` primitive and swap the config-ui sources "Active" checkbox (FR-1)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/ui/switch.tsx` — create
- `services/xstockstrat-ui/src/app/config-ui/sources/page.tsx` — modify (lines 504-515)

**Reviewers**: `xstockstrat-ui` service owner — Trading UI correctness, config mutation safety, no
secret values rendered in UI

**Codebase Evidence**:
- Target markup confirmed via Read: `services/xstockstrat-ui/src/app/config-ui/sources/page.tsx:504-515`
  — `<input type="checkbox" id="active-toggle" checked={form.active} onChange={(e) =>
  setField('active', e.target.checked)} className="h-4 w-4" />` + `<label htmlFor="active-toggle"
  className="text-sm">Active</label>`.
- Confirmed absent: `grep -rn "ui/switch" services/xstockstrat-ui/src/` → zero hits; `ls
  services/xstockstrat-ui/src/components/ui/` → no `switch.tsx`.
- Primitive shape to match — `services/xstockstrat-ui/src/components/ui/badge.tsx:35-51` (plain
  `function Badge({ className, variant, asChild, ...props })`, `cva()`+`cn()` from
  `@/components/ui/utils`, `data-slot="badge"`, no `React.forwardRef`/`displayName`); import
  convention — `services/xstockstrat-ui/src/components/ui/select.tsx:4` (`import { Select as
  SelectPrimitive } from 'radix-ui'` — the unified package, confirmed in `package.json:` `"radix-ui":
  "^1.6.7"`, no per-primitive `@radix-ui/react-switch` install needed).
- `components.json:3` — preset `radix-rhea`; adding a primitive not yet present is `npx shadcn@latest
  add <name>` per `services/xstockstrat-ui/CLAUDE.md` § Styling.

**TDD**: N/A (no red-green — this is a like-for-like markup swap with no new conditional logic;
Step 2 provides e2e regression coverage instead, per the "no coverage threshold" row for
`xstockstrat-ui` in `reference/spec-template.md`).

**Instructions**:
1. Run `npx shadcn@latest add switch` from `services/xstockstrat-ui/` against the existing
   `components.json` preset. If the CLI is unavailable (network/registry), hand-author
   `src/components/ui/switch.tsx` matching the confirmed shape: `import { Switch as SwitchPrimitive }
   from 'radix-ui'`, a plain `function Switch({ className, ...props })` wrapping
   `SwitchPrimitive.Root`/`SwitchPrimitive.Thumb`, `data-slot="switch"`, `cn()` from
   `@/components/ui/utils` — no `forwardRef`/`displayName` (matches `badge.tsx:35`, `select.tsx:9`).
   Do not add an app-specific `cva` variant — this primitive needs none (no `buy`/`sell`/paper-live
   semantics apply to a config-active toggle).
2. In `src/app/config-ui/sources/page.tsx`, import `{ Switch } from '@/components/ui/switch'` (or the
   relative `../../../components/ui/switch` matching this file's existing import style — confirm by
   reading its current import block before editing) and replace lines 504-515's `<div
   className="flex items-center gap-2">...<input type="checkbox".../><label htmlFor="active-toggle">
   Active</label></div>` with `<div className="flex items-center gap-2"><Switch id="active-toggle"
   checked={form.active} onCheckedChange={(v) => setField('active', v)} /><label
   htmlFor="active-toggle" className="text-sm">Active</label></div>` — same `id`/`htmlFor` pairing,
   same `setField('active', ...)` call, only the control's shape changes (Radix `Switch`'s
   `onCheckedChange` receives the boolean directly, replacing `e.target.checked`).

**Verification**:
```bash
cd services/xstockstrat-ui && test -f src/components/ui/switch.tsx && grep -n "function Switch" src/components/ui/switch.tsx && ! grep -n "forwardRef\|displayName" src/components/ui/switch.tsx
grep -n "type=\"checkbox\"" src/app/config-ui/sources/page.tsx | grep -q "active-toggle" && echo "FAIL: old checkbox still present" || echo "OK: checkbox removed"
pnpm lint
```

---

### Step 2 — test: e2e regression for FR-1 (config-ui sources Active toggle)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/config-ui/sources.spec.ts` — modify (only if it needs a new
  role-based assertion; otherwise verification-only, no diff)

**Reviewers**: `xstockstrat-ui` service owner — Trading UI correctness, config mutation safety

**Codebase Evidence**:
- `services/xstockstrat-ui/e2e/config-ui/sources.spec.ts` exists (confirmed via `ls
  e2e/config-ui/`) but `grep -n "active-toggle\|Active\\b" e2e/config-ui/sources.spec.ts` returns no
  hits — the "Active" checkbox has **no existing e2e coverage** of its own (pre-existing gap, not
  introduced by this feature).
- Fixture home: `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md` — no signal-source-registration
  fixture row is touched by this swap (the form's `active` boolean is local component state, not a
  fixture-backed domain object); no new fixture needed.

**TDD**: N/A (no pre-existing assertion to redden; this step proves the existing suite stays green
and, since there is no old assertion to update, satisfies acceptance criterion 5's "assertions
updated... where the old ones no longer apply" by having none to update).

**Instructions**:
Run the existing `sources.spec.ts` suite unmodified against the Step 1 change to confirm no
regression. If the suite interacts with the Active toggle anywhere not caught by the grep above
(re-verify with a full read of the spec before concluding "no change needed"), update that
interaction to Radix `Switch`'s accessible role (`page.getByRole('switch', { name: 'Active' })` /
`.click()`) instead of a raw checkbox locator.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm test:e2e -- e2e/config-ui/sources.spec.ts
```

---

### Step 3 — service: Add `ui/slider.tsx` primitive and swap the screener weight range input (FR-2)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/ui/slider.tsx` — create
- `services/xstockstrat-ui/src/app/insights/screener/page.tsx` — modify (lines 396-405)

**Reviewers**: `xstockstrat-ui` service owner — analytics display accuracy

**Codebase Evidence**:
- Target markup confirmed via Read: `services/xstockstrat-ui/src/app/insights/screener/page.tsx:396-405`
  — `<input type="range" aria-label="weight slider" min={0} max={1} step={0.05} value={c.weight}
  onChange={(e) => updateCriterion(i, { weight: Number(e.target.value) })} className="w-28
  accent-primary" />`, immediately followed (lines 406-415) by a numeric `<Input>` mirror of the same
  `c.weight` value — this numeric mirror is **not** part of FR-2's swap and stays unchanged.
- Confirmed absent: `grep -rn "ui/slider" services/xstockstrat-ui/src/` → zero hits.
- Same primitive-shape and `radix-ui` unified-package evidence as Step 1 (`badge.tsx:35`,
  `select.tsx:4`, `package.json` `radix-ui@^1.6.7`).

**TDD**: N/A (like-for-like markup swap; Step 4 provides e2e regression coverage).

**Instructions**:
1. Run `npx shadcn@latest add slider`, or hand-author `src/components/ui/slider.tsx` matching the
   confirmed shape (`import { Slider as SliderPrimitive } from 'radix-ui'`, plain `function Slider({
   className, ...props })`, `data-slot="slider"`, `cn()`, no `forwardRef`/`displayName`). No
   app-specific `cva` variant needed.
2. In `src/app/insights/screener/page.tsx`, import `{ Slider }` and replace the `<input
   type="range" .../>` (lines 396-405) with `<Slider aria-label="weight slider" min={0} max={1}
   step={0.05} value={[c.weight]} onValueChange={([v]) => updateCriterion(i, { weight: v })}
   className="w-28" />` — Radix `Slider` is array-valued (single-thumb: `[c.weight]`) and its
   `onValueChange` callback receives the array, matching this file's existing `updateCriterion(i,
   {...})` call shape. Preserve the `aria-label="weight slider"` for the paired numeric `<Input>`
   mirror at lines 406-415, which stays untouched.

**Verification**:
```bash
cd services/xstockstrat-ui && test -f src/components/ui/slider.tsx && grep -n "function Slider" src/components/ui/slider.tsx
grep -n "type=\"range\"" src/app/insights/screener/page.tsx | grep -q "weight slider" && echo "FAIL: old range input still present" || echo "OK: range input removed"
pnpm lint
```

---

### Step 4 — test: e2e regression for FR-2 (screener weight slider)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/insights/screener.spec.ts` — modify (only if an existing assertion
  targets the range input directly; verification-only otherwise)

**Reviewers**: `xstockstrat-ui` service owner — analytics display accuracy

**Codebase Evidence**:
- `grep -n "weight slider\|weight-share" services/xstockstrat-ui/e2e/insights/screener.spec.ts` →
  no hits on `weight slider` (no existing interaction with the range control); `weight-share` (the
  `data-testid` on the normalized-share `<span>` at `screener/page.tsx:417-419`) is unrelated to the
  slider itself and untouched by this swap.
- Existing `screen-results`/`result-row` `data-testid` assertions (`e2e/insights/screener.spec.ts`
  lines 47, 51, 79, 94, etc.) belong to the results table (FR-11's target, Steps 10-12), not this
  slider — no overlap.

**TDD**: N/A (no pre-existing slider assertion to redden).

**Instructions**:
Run the existing `screener.spec.ts` suite unmodified against the Step 3 change. Re-read the spec
before concluding no update is needed — if any case drives the weight control via
`page.locator('input[type="range"]')` or similar, update it to `page.getByLabel('weight slider')`
(role `slider`), which continues to resolve against the Radix `Slider`'s `aria-label`.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm test:e2e -- e2e/insights/screener.spec.ts
```

---

### Step 5 — service: Add `ui/collapsible.tsx` primitive and convert the "Edit keys" disclosure (FR-3)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/ui/collapsible.tsx` — create
- `services/xstockstrat-ui/src/components/trader/accountShared.tsx` — modify (`AccountRow`,
  lines 213-249; `EditCredentialsForm`, lines 116-167 unchanged in body, now rendered inside
  `CollapsibleContent`)

**Reviewers**: `xstockstrat-ui` service owner — Trading UI correctness

**Codebase Evidence**:
- The actual expand/collapse interaction lives in `AccountRow` (`accountShared.tsx:174-252`), not
  `EditCredentialsForm` itself: a local `editing` boolean (`React.useState`, line 184) toggled by the
  "Edit keys" `<Button>` (`onClick={() => setEditing((v) => !v)}`, lines 215-217), and `{account.isActive
  && editing && <EditCredentialsForm .../>}` (lines 247-249) conditionally renders the form.
  `EditCredentialsForm` (lines 116-167) is the panel content — its own body (the `<form>` returned at
  line 149) does not change; only its host wrapper changes from a bare conditional render to
  `CollapsibleContent`.
- Confirmed absent: `grep -rn "ui/collapsible" services/xstockstrat-ui/src/` → zero hits.
- Same primitive-shape and `radix-ui` unified-package evidence as Steps 1/3.
- No existing e2e coverage: `grep -rn "Edit keys" services/xstockstrat-ui/e2e/` → zero hits (confirmed
  this session) — pre-existing gap, not introduced here.

**TDD**: N/A (like-for-like interaction swap — same `editing`-gated visibility, different
implementation; Step 6 provides e2e coverage).

**Instructions**:
1. Run `npx shadcn@latest add collapsible`, or hand-author `src/components/ui/collapsible.tsx`
   matching the confirmed shape (`import { Collapsible as CollapsiblePrimitive } from 'radix-ui'`;
   export `Collapsible`, `CollapsibleTrigger`, `CollapsibleContent` as plain function components
   wrapping `CollapsiblePrimitive.Root`/`.Trigger`/`.Content`, `data-slot` on each, no
   `forwardRef`/`displayName`).
2. In `accountShared.tsx`, import `{ Collapsible, CollapsibleTrigger, CollapsibleContent } from
   '../ui/collapsible'`. Wrap the `editing`-controlled region: make `Collapsible`'s `open={editing}
   onOpenChange={setEditing}` the outer element; move the "Edit keys" `<Button>` (lines 215-217) inside
   a `CollapsibleTrigger asChild` (keep its existing `onClick`-free `Button` — `CollapsibleTrigger`
   drives the toggle itself, so drop the manual `onClick={() => setEditing((v) => !v)}` since
   `open`/`onOpenChange` now own that state transition); wrap the conditional
   `{account.isActive && editing && <EditCredentialsForm .../>}` block (lines 247-249) in
   `<CollapsibleContent>{account.isActive && <EditCredentialsForm account={account} onDone={() =>
   setEditing(false)} />}</CollapsibleContent>` so the content still only mounts for an active account,
   matching today's guard. `EditCredentialsForm`'s own body (lines 116-167) is unchanged.

**Verification**:
```bash
cd services/xstockstrat-ui && test -f src/components/ui/collapsible.tsx && grep -n "function Collapsible" src/components/ui/collapsible.tsx
grep -n "CollapsibleTrigger\|CollapsibleContent" src/components/trader/accountShared.tsx
pnpm lint
```

---

### Step 6 — test: e2e regression for FR-3 (Edit keys disclosure)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/trader/account-selector.spec.ts` — modify (only if it drives
  "Edit keys"; add a minimal new case otherwise, scoped to this feature's like-for-like requirement)

**Reviewers**: `xstockstrat-ui` service owner — Trading UI correctness

**Codebase Evidence**:
- No existing e2e file exercises "Edit keys" (`grep -rn "Edit keys" services/xstockstrat-ui/e2e/` →
  zero hits, confirmed this session) — `AccountRow`/`AccountsModule` is otherwise covered by
  `e2e/trader/account-selector.spec.ts` per the fixture inventory row (`e2e/fixtures/INVENTORY.md`
  line 14: `BROKER_ACCOUNT_ALPACA`/`BROKER_ACCOUNT_IBKR`/`BROKER_ACCOUNT_NEW`/`BROKER_ACCOUNTS`,
  consumed by `e2e/trader/{orders,order-form,account-selector}.spec.ts`).
- Fixture reuse: `BROKER_ACCOUNT_ALPACA` (`e2e/fixtures/accounts.ts`) — no new fixture needed.

**TDD**: N/A (net-new minimal case, not a red-before-green regression — the product spec's
"like-for-like substitution only" scope does not mandate new e2e coverage where none existed, but a
one-case smoke check for the primitive swap is proportionate here since Step 5 changes the DOM shape
enough that an untested regression would be silent).

**Instructions**:
Add one minimal case to `e2e/trader/account-selector.spec.ts` (or the accounts page spec it already
covers) using the existing `BROKER_ACCOUNT_ALPACA` fixture: click "Edit keys", assert the credential
form becomes visible (`page.getByPlaceholder('API Key')` or similar, matching
`CredentialFields`'s existing inputs), click "Edit keys" again (or `Cancel`), assert it collapses.
Use Radix `Collapsible`'s accessible state (`aria-expanded` on the trigger) if a role-based assertion
is more robust than a visibility check.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm test:e2e -- e2e/trader/account-selector.spec.ts
```

---

### Step 7 — service: Route `AlertStream.tsx`'s unread-count pill through `Badge` (FR-10)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/trader/AlertStream.tsx` — modify (lines 46-58)

**Reviewers**: `xstockstrat-ui` service owner — Trading UI correctness

**Codebase Evidence**:
- Target confirmed via Read: `services/xstockstrat-ui/src/components/trader/AlertStream.tsx:46-58` —
  hand-rolled `<span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center
  rounded-full text-[10px] font-bold ${hasHighSeverity ? 'bg-destructive text-white' : 'bg-primary
  text-primary-foreground'}">{unread > 9 ? '9+' : unread}</span>`, gated by `{unread > 0 && (...)}`
  (line 49). `Badge` is already imported in this file (line 7: `import { Badge } from '../ui/badge'`).
  `hasHighSeverity` (line 42) is the existing conditional this maps onto `Badge`'s `destructive`
  variant; the non-high-severity case maps onto `default` (`badge.tsx:12`: `bg-primary
  text-primary-foreground`, an exact match for the current hand-rolled non-destructive branch).

**TDD**: N/A (like-for-like markup swap; Step 9 provides e2e regression coverage for both FR-10 sites).

**Instructions**:
Replace the `<span>` (lines 50-57) with `<Badge variant={hasHighSeverity ? 'destructive' : 'default'}
className="absolute -top-1 -right-1 h-4 min-w-4 justify-center px-1 text-[10px]">{unread > 9 ? '9+' :
unread}</Badge>` — keep the same positioning classes (`absolute -top-1 -right-1`) as overrides via
`className` (per `cn()`'s merge order, `className` overrides `badgeVariants()`'s own `h-5`/padding
where they conflict), preserving the pill's current compact size instead of `Badge`'s default
padded-text sizing.

**Verification**:
```bash
cd services/xstockstrat-ui && grep -n "Badge variant={hasHighSeverity" src/components/trader/AlertStream.tsx
pnpm lint
```

---

### Step 8 — service: Resolve `AccountSelector.tsx`'s status dot — `Badge` or documented exception (FR-10)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/trader/AccountSelector.tsx` — modify (lines 64-77)

**Reviewers**: `xstockstrat-ui` service owner — Trading UI correctness

**Codebase Evidence**:
- Target confirmed via Read: `services/xstockstrat-ui/src/components/trader/AccountSelector.tsx:73-75`
  — `{hasCredentialIssue && (<span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full
  bg-destructive" />)}`, a bare 2px un-lettered dot over the gear icon `<Link>` (lines 64-77). `Badge`
  is already imported in this file (line 10) and used elsewhere in it (line 48, the broker-label pill).
- `design.md` § Chosen Approach point 2 (explicitly deferred this call to execute time): try `Badge`
  first; `badge.tsx:8`'s box model (`h-5 w-fit ... gap-1 ... rounded-2xl`, sized for padded text) may
  actively fight a bare dot. If overriding it needs more `className` surgery than the current 8-line
  hand-rolled `<span>`, keep the hand-rolled span with a one-line `// no clean shadcn-primitive fit —
  Badge's box model is sized for padded text, see 121-shadcn-migration-medium-confidence design.md §2`
  comment, and record which way it fell in `context.md`.

**TDD**: N/A (either outcome is a like-for-like visual swap or a documented no-op; Step 9 covers
regression either way).

**Instructions**:
At execute time, render both candidates side by side (dev server or Storybook-less visual check) and
pick the one that reproduces today's 2px destructive dot without an ad hoc-looking override chain:
- **If `Badge` wins**: replace the `<span>` with `<Badge variant="destructive" className="absolute
  -top-0.5 -right-0.5 h-2 w-2 min-w-0 rounded-full p-0" />` (or the minimal override set that actually
  reproduces the dot).
- **If the hand-rolled span wins**: leave the markup unchanged, add the one-line comment above it, and
  append a `context.md` note recording the exception per this step's Codebase Evidence.

**Verification**:
```bash
cd services/xstockstrat-ui && grep -n "bg-destructive" src/components/trader/AccountSelector.tsx
pnpm lint
```

---

### Step 9 — test: e2e regression for FR-10 (AlertStream + AccountSelector badges)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/trader/alert-stream.spec.ts` — verification-only unless an
  existing assertion targets the old `<span>` markup directly
- `services/xstockstrat-ui/e2e/trader/account-selector.spec.ts` — verification-only, same condition

**Reviewers**: `xstockstrat-ui` service owner — Trading UI correctness

**Codebase Evidence**:
- Both spec files exist (`ls services/xstockstrat-ui/e2e/trader/` confirmed
  `alert-stream.spec.ts`, `account-selector.spec.ts`).

**TDD**: N/A (regression check over an already-existing suite).

**Instructions**:
Run both existing spec files unmodified against Steps 7–8. Read each first — if either targets the
unread-count pill or the status dot via a class-based locator (e.g. `.bg-destructive`) rather than
text/role, update the locator to the new `Badge`-rendered markup (or leave unchanged if Step 8 kept
the hand-rolled span).

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm test:e2e -- e2e/trader/alert-stream.spec.ts e2e/trader/account-selector.spec.ts
```

---

### Step 10 — service: Route `strategies/[id]/page.tsx`'s Past Runs table through `ui/table.tsx` (FR-11)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/insights/strategies/[id]/page.tsx` — modify (lines 469-541)

**Reviewers**: `xstockstrat-ui` service owner — analytics display accuracy

**Codebase Evidence**:
- Target confirmed via Read: `services/xstockstrat-ui/src/app/insights/strategies/[id]/page.tsx:469-541`
  — raw `<table className="w-full text-sm">...<tbody>{pastRuns.map((run) => (<tr key={run.backtestId}
  data-testid="past-run-row" role="button" tabIndex={0} aria-selected={selectedRunId ===
  run.backtestId} onClick={...} onKeyDown={...} className={cn('border-t border-border cursor-pointer
  hover:bg-secondary/60', selectedRunId === run.backtestId && 'bg-secondary')}>...`.
- Reuse pattern: `services/xstockstrat-ui/src/components/trader/LiveStrategiesPanel.tsx:35,45-50`
  (`<TableRow key={s.strategyId} className="cursor-pointer" onClick={...}>`) — confirms `TableRow` is
  a plain `<tr {...props}>` (`table.tsx:43-54`) that accepts arbitrary props/handlers additively, so
  `role="button"`, `aria-selected`, `onKeyDown`, and the existing `cn(...)` className all pass straight
  through unchanged.
- e2e `data-testid`s to preserve: `page.getByTestId('past-runs')` (the `Card`, line 463, untouched) and
  `page.getByTestId('past-run-row')` (`e2e/insights/backtest-coverage.spec.ts:159,191,207` — asserted
  by role/text, e.g. `.toContainText('15.00%')`).

**TDD**: N/A (like-for-like markup swap, same interaction; Step 12 provides e2e regression coverage).

**Instructions**:
Import `{ Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'`
(match this file's existing import alias style). Replace the raw `<table>`/`<thead>`/`<tbody>` (lines
469-541) with `Table`/`TableHeader`/`TableBody`, the header `<tr>`/`<th>` with `TableRow`/`TableHead`
(preserving each header's existing `className`s, e.g. `text-left text-xs text-muted-foreground` on the
row, `py-1.5 pr-3 font-medium` per head), and the body `<tr>` with `TableRow` carrying **all** existing
props verbatim — `key`, `data-testid="past-run-row"`, `role="button"`, `tabIndex={0}`,
`aria-selected={...}`, `onClick={...}`, `onKeyDown={...}`, `className={cn(...)}` — and each `<td>` with
`TableCell`, preserving each cell's existing `className`.

**Verification**:
```bash
cd services/xstockstrat-ui && grep -n "^import.*ui/table" src/app/insights/strategies/\[id\]/page.tsx
grep -n "<table\b" src/app/insights/strategies/\[id\]/page.tsx | grep -q . && echo "FAIL: raw table tag remains" || echo "OK"
pnpm lint
```

---

### Step 11 — service: Route `screener/page.tsx`'s results grid through `ui/table.tsx` (FR-11)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/insights/screener/page.tsx` — modify (lines 552-626 — the
  exact range re-verified this session; product-spec's own `~555-605` marker was approximate)

**Reviewers**: `xstockstrat-ui` service owner — analytics display accuracy

**Codebase Evidence**:
- Exact range re-verified via Read this session (recon.md flagged the product-spec's `~555-605` as
  approximate — corrected here): `services/xstockstrat-ui/src/app/insights/screener/page.tsx:552-626`
  — `<table className="w-full text-sm min-w-[640px]" data-testid="screen-results">...<tr key={r.symbol}
  className="border-b" data-testid="result-row">...`. Ten columns (Rank/Symbol/Score/P-E/RSI/ATR/Rev
  growth/Held/Passed/Status), each cell already using `Badge` (`held`, `passed`/`status` cells) —
  those inner `Badge` usages are unaffected, only the surrounding `table`/`tr`/`td`/`th` change.
- `data-testid`s to preserve: `screen-results` (on the `<table>`, asserted by
  `e2e/insights/screener.spec.ts` lines 47/79/94/112/134/150/168/213/252/296/463/484) and `result-row`
  (on each `<tr>`, lines 51/101).
- Wrapping `<div className="w-full overflow-x-auto">` (line 551) around the table stays — `Table`
  itself already renders its own `overflow-x-auto` wrapper (`table.tsx:9`), so nesting the existing div
  around `Table` is redundant; **drop the manual wrapper div** and let `Table`'s own `data-slot="table-
  container"` div own the scroll behavior (per Step constraints — CF-N4, don't leave a needless
  duplicate wrapper).

**TDD**: N/A (like-for-like markup swap; Step 12 provides e2e regression coverage).

**Instructions**:
Import `{ Table, TableHeader, TableBody, TableRow, TableHead, TableCell }` (reuse the same import
statement as Step 10 if both land in the same PR/branch — one import line, not two). Replace the
`<div className="w-full overflow-x-auto"><table ...></table></div>` block (lines 551-627) with `<Table
className="min-w-[640px]" data-testid="screen-results">` (carrying the `min-w-[640px]` and
`data-testid` that were on the raw `<table>`) wrapping `TableHeader`/`TableBody` built from
`TableRow`/`TableHead`/`TableCell`, preserving every cell's existing content, `className`, and the
body row's `key={r.symbol}` + `data-testid="result-row"` + `className="border-b"`.

**Verification**:
```bash
cd services/xstockstrat-ui && grep -n "data-testid=\"screen-results\"" src/app/insights/screener/page.tsx
grep -n "<table\b" src/app/insights/screener/page.tsx | grep -q . && echo "FAIL: raw table tag remains" || echo "OK"
pnpm lint
```

---

### Step 12 — test: e2e regression for FR-11 (Past Runs + screener results tables)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/insights/backtest-coverage.spec.ts` — verification-only
- `services/xstockstrat-ui/e2e/insights/screener.spec.ts` — verification-only

**Reviewers**: `xstockstrat-ui` service owner — analytics display accuracy

**Codebase Evidence**:
- Both specs already assert via `data-testid` (`past-run-row`/`past-runs` in
  `backtest-coverage.spec.ts:124,151,159,166,191,197,207`; `screen-results`/`result-row` in
  `screener.spec.ts`, cited in Step 11) — since `Table`/`TableRow`/`TableCell` forward all props
  including `data-testid` (`table.tsx` — every sub-component is `React.ComponentProps<'tag'> &
  {...props}`), these assertions require **no locator changes**, only confirmation the suite still
  passes against the new markup.

**TDD**: N/A (regression check over an already-existing, testid-based suite — no assertion needed
updating per the evidence above, satisfying acceptance criterion 5's exemption for assertions that
still apply).

**Instructions**:
Run both spec files unmodified against Steps 10–11. If either fails, the failure means a
`data-testid`, `className`, or interaction prop was dropped during the `Table` conversion — fix the
conversion, not the test.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm test:e2e -- e2e/insights/backtest-coverage.spec.ts e2e/insights/screener.spec.ts
```

---

### Step 13 — service: Create shared `FilterToolbar.tsx` (FR-12)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/shared/FilterToolbar.tsx` — create

**Reviewers**: `xstockstrat-ui` service owner — Trading UI correctness

**Codebase Evidence**:
- `design.md` § Chosen Approach point 4 (the round-1/round-2 debate's converged, non-rejected shape):
  a **slot-based control row**, not a `layout` variant enum (rejected — see `design.md` § Rejected
  Alternatives). Props surface: optional `search: { value, onChange, placeholder }`; `filters:
  Array<{ value, onValueChange, options: {value,label}[], ariaLabel }>` (each rendered as an existing
  `ui/select.tsx` `Select`); optional `dateRange: { from, to, onFromChange, onToChange }`;
  `activeFilterCount: number`; `onClear: () => void`; `clearPlacement: 'inline' | 'trailing'`.
- The two source shapes it must cover, both fully re-read this session:
  `services/xstockstrat-ui/src/components/trader/AccountsModule.tsx:94-135` (search `Input` with a
  `Search` icon, 3 `Select`s, no date range) and
  `services/xstockstrat-ui/src/components/trader/OrderFilters.tsx:88-132` (no search input, 3
  `Select`s, 2 date `Input`s, grid layout). Per `design.md`, the surrounding `Card`/`CardHeader`/
  `CardContent` chrome and grid-vs-flex layout stay owned by each call site — `FilterToolbar` renders
  only the controls row itself.
- Import sources: `Input` — `services/xstockstrat-ui/src/components/ui/input.tsx` (already used by
  both source files); `Select`/`SelectContent`/`SelectItem`/`SelectTrigger`/`SelectValue` —
  `services/xstockstrat-ui/src/components/ui/select.tsx`; `Button` —
  `services/xstockstrat-ui/src/components/ui/button.tsx`; icon — `Search` from `lucide-react`
  (already imported by `AccountsModule.tsx:12`).

**TDD**: N/A (a new presentational component with no business logic of its own — Step 16 proves it
via the two consuming pages' e2e suites, which is where the behavior actually lives).

**Instructions**:
Create `src/components/shared/FilterToolbar.tsx`, `'use client'`, exporting `FilterToolbar` as a
plain function component (matching this codebase's non-`ui/` shared-component convention — e.g.
`EmptyState.tsx` in the same directory) with the props surface from Codebase Evidence:
- Render the optional `search` slot as `<div className="relative flex-1 min-w-[160px]"><Search
  className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground
  pointer-events-none" /><Input placeholder={search.placeholder} className="pl-8 h-8 text-sm"
  value={search.value} onChange={(e) => search.onChange(e.target.value)} /></div>` when `search` is
  provided (`AccountsModule.tsx`'s shape).
- Render `filters.map(f => <Select key={f.ariaLabel} value={f.value} onValueChange={f.onValueChange}>
  <SelectTrigger aria-label={f.ariaLabel} className="h-8 text-sm"><SelectValue /></SelectTrigger>
  <SelectContent>{f.options.map(o => <SelectItem key={o.value} value={o.value}>{o.label}
  </SelectItem>)}</SelectContent></Select>)`.
- Render the optional `dateRange` slot as two `<Input type="date">`s (matching `OrderFilters.tsx:120-
  131`'s `aria-label="Filter from date"`/`"Filter to date"`) when provided.
- Wrap search+filters(+dateRange) in a `<div className="flex flex-wrap gap-2">` (matching
  `AccountsModule.tsx:94`'s existing flex toolbar row) — **not** a grid; `OrderFilters.tsx`'s grid
  layout stays owned by that call site around `FilterToolbar`, per design.md.
- Render the Clear button: when `clearPlacement === 'inline'`, render nothing here (the caller places
  it in its own header row using `activeFilterCount`/`onClear` directly, matching
  `AccountsModule.tsx:75-89`'s existing `CardHeader` placement); when `clearPlacement === 'trailing'`,
  render `{activeFilterCount > 0 ? <div className="mt-3 flex justify-end"><Button type="button"
  variant="outline" size="sm" onClick={onClear}>Clear filters</Button></div> : null}` **if**
  `OrderFilters.tsx`'s current unconditional Clear button should become conditional — otherwise match
  today's unconditional behavior exactly (`OrderFilters.tsx:134`'s button has no `activeFilterCount`
  guard today); preserve **today's behavior** (unconditional) for `'trailing'` to keep this a
  like-for-like substitution, not a new gating rule.

**Verification**:
```bash
cd services/xstockstrat-ui && test -f src/components/shared/FilterToolbar.tsx
grep -n "export function FilterToolbar" src/components/shared/FilterToolbar.tsx
pnpm lint
```

---

### Step 14 — service: Wire `AccountsModule.tsx` and `OrderFilters.tsx` to `FilterToolbar` (FR-12)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/trader/AccountsModule.tsx` — modify (lines 93-135, the
  filter toolbar `<div>`)
- `services/xstockstrat-ui/src/components/trader/OrderFilters.tsx` — modify (lines 88-132, the
  filter grid)

**Reviewers**: `xstockstrat-ui` service owner — Trading UI correctness, Connect-RPC call safety
(order filters feed the `useOrders` server-side query)

**Codebase Evidence**:
- `AccountsModule.tsx:41-46` already computes `activeFilterCount`; lines 75-89 already render the
  conditional "Clear filters" `Button` in `CardHeader` (stays as `clearPlacement: 'inline'` — no
  change to that block). Lines 93-135 are the toolbar this step replaces with `<FilterToolbar
  search={{ value: search, onChange: setSearch, placeholder: 'Search by name…' }} filters={[{
  value: brokerFilter, onValueChange: (v) => setBrokerFilter(v as BrokerFilter), options: [{value:
  'all',label:'All brokers'},{value:'alpaca',label:'Alpaca'},{value:'ibkr',label:'IBKR'}], ariaLabel:
  'Broker' }, /* activeFilter, statusFilter analogously */]} activeFilterCount={activeFilterCount}
  onClear={() => { setSearch(''); setBrokerFilter('all'); setActiveFilter('all');
  setStatusFilter('all'); }} clearPlacement="inline" />`.
- `OrderFilters.tsx` has **no `activeFilterCount` computation today** (confirmed via full Read this
  session — `reset()` at line 80 clears all fields but nothing counts them) — this step does not add
  one; pass `activeFilterCount={0}` (a value that never suppresses the `'trailing'` unconditional
  Clear button per Step 13's Instructions) so `FilterToolbar`'s prop contract is satisfied without
  inventing new behavior `OrderFilters.tsx` never had. Symbol `Input`, the three `Select`s
  (`side`/`orderType`/`status`), and the two date `Input`s all map onto `FilterToolbar`'s
  `filters`/`dateRange` props using this file's existing `SIDE_OPTIONS`/`TYPE_OPTIONS`/
  `STATUS_OPTIONS` arrays (lines 15-39) as `options`.
- Acceptance criterion 4 requires **zero duplicated toolbar-composition JSX remaining** in either
  file after this step — both files must render `FilterToolbar`, not a parallel hand-rolled copy.

**TDD**: N/A (wiring an already-tested primitive into two consumers; Step 16 covers behavior via
existing e2e suites for both pages).

**Instructions**:
1. In `AccountsModule.tsx`: import `{ FilterToolbar } from '@/components/shared/FilterToolbar'`
   (or the relative path matching this file's import style). Replace the `<div className="flex
   flex-wrap gap-2">...</div>` block (lines 93-135) with the `FilterToolbar` call from Codebase
   Evidence. Leave the `CardHeader` count/Clear-button block (lines 65-91) untouched — it already
   implements `'inline'` placement.
2. In `OrderFilters.tsx`: import `FilterToolbar`. Replace the `<div className="grid grid-cols-1
   sm:grid-cols-2 lg:grid-cols-3 gap-3">...</div>` block (lines 88-132) **and** the trailing `<div
   className="mt-3 flex justify-end"><Button ...>Clear filters</Button></div>` block (lines 133-135)
   with a single `FilterToolbar` call using `search` omitted (this file has no search-icon input —
   its symbol `Input` stays a `filters`-array-adjacent plain field the way it renders today, or is
   passed through `FilterToolbar`'s `filters` array if the abstraction naturally covers a plain text
   filter; if it does not cleanly fit `filters`' `{value,onValueChange,options,ariaLabel}` shape
   because a symbol filter is free text, keep `symbol`'s `Input` as a sibling of `FilterToolbar`
   inside the same grid `<div>` rather than forcing it through a Select-shaped prop), `dateRange`
   populated from `from`/`to`, `clearPlacement="trailing"`, `activeFilterCount={0}`, `onClear=reset`.

**Verification**:
```bash
cd services/xstockstrat-ui && grep -n "FilterToolbar" src/components/trader/AccountsModule.tsx src/components/trader/OrderFilters.tsx
grep -c "SelectTrigger" src/components/trader/AccountsModule.tsx src/components/trader/OrderFilters.tsx
# expect 0 in both (all Selects now render inside FilterToolbar, not inline in these files)
pnpm lint
```

---

### Step 15 — service: Broker/order-type/order-status coverage note for FR-12 (trading-domain gate)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**: none — this step is a verification-only confirmation, no new diff beyond Step 14's

**Reviewers**: `xstockstrat-ui` service owner — Connect-RPC call safety, environment scope correctness

**Codebase Evidence** (trading-domain survey, triggered because the product spec and touched files
mention `BrokerType`/Alpaca/IBKR/`OrderType`/`OrderStatus` — `reference/discovery-checklist.md` §
Trading-domain survey):
- `AccountsModule.tsx:5,31-32` (`BrokerType.ALPACA`/`BrokerType.IBKR`) — both broker values remain
  handled identically after Step 14; `FilterToolbar` only changes *how* the `brokerFilter` `Select`
  renders, not which `BrokerType` values are offered (`AccountsModule.tsx:109-111`'s three
  `SelectItem`s carry over verbatim into `FilterToolbar`'s `filters[0].options`).
- `OrderFilters.tsx:3,21-27` (`PbOrderType.{MARKET,LIMIT,STOP,STOP_LIMIT,TRAILING_STOP}`) — all five
  `OrderType` values remain in `TYPE_OPTIONS` (lines 21-27), unchanged by Step 14; `FilterToolbar`
  does not touch the enum-to-option mapping.
- `OrderFilters.tsx:30-38` (`PbOrderStatus.{NEW,PARTIALLY_FILLED,FILLED,CANCELED,EXPIRED,REJECTED,
  PENDING_APPROVAL}`) — all seven `OrderStatus` values remain in `STATUS_OPTIONS`, unchanged.
- No `TRADING_MODE` reference in either touched file (`grep -n "TRADING_MODE\|TradingMode"
  src/components/trader/{AccountsModule,OrderFilters}.tsx` → zero hits) — this feature does not touch
  paper/live gating.
- **Conclusion**: FR-12 is a presentational consolidation only — it re-parents existing `Select`
  option arrays into a shared wrapper without adding, removing, or reordering any broker/order-type/
  order-status value. No handling gap is introduced; broker/order-type/fill-state coverage is
  unaffected by this step.

**TDD**: N/A (documentation/verification step, no code change of its own).

**Instructions**:
No code change. This step exists to satisfy `reference/step-constraints.md` §A's requirement that a
step touching `BrokerType`/`OrderType`/`OrderStatus` either handle all enum values or explicitly note
non-affectedness — recorded here per the Codebase Evidence above, confirming Step 14 preserves every
existing enum value's handling.

**Verification**:
```bash
cd services/xstockstrat-ui && grep -c "SelectItem" src/components/shared/FilterToolbar.tsx  # sanity: filters render via SelectItem, not a shortened list
diff <(grep -oE "BrokerType\.[A-Z]+" src/components/trader/AccountsModule.tsx | sort -u) <(git show HEAD~1:services/xstockstrat-ui/src/components/trader/AccountsModule.tsx 2>/dev/null | grep -oE "BrokerType\.[A-Z]+" | sort -u) || true
```

---

### Step 16 — test: e2e regression for FR-12 (FilterToolbar in AccountsModule + OrderFilters)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/trader/account-selector.spec.ts` — verification-only unless a
  filter-toolbar interaction needs a locator update
- `services/xstockstrat-ui/e2e/trader/orders.spec.ts` — verification-only, same condition

**Reviewers**: `xstockstrat-ui` service owner — Trading UI correctness, Connect-RPC call safety

**Codebase Evidence**:
- Fixture reuse (no new fixtures needed, per `recon.md` § Patterns to REUSE and
  `e2e/fixtures/INVENTORY.md` lines 14/25): `BROKER_ACCOUNT_ALPACA`/`BROKER_ACCOUNT_IBKR`/
  `BROKER_ACCOUNTS` (`e2e/fixtures/accounts.ts`) for the `AccountsModule` toolbar;
  `ORDER_FILLED`/`ORDER_WORKING`/`ORDERS` (`e2e/fixtures/orders.ts`) for `OrderFilters`.
- Both spec files already interact with these pages' filter controls by accessible label
  (`Filter by symbol`, `Filter by side`, etc. — `OrderFilters.tsx:96,100,107,114,124,130`'s
  `aria-label`s, preserved verbatim by Step 14's `FilterToolbar` wiring since the same `aria-label`
  props pass straight through `filters[].ariaLabel`/`dateRange`).

**TDD**: N/A (regression check; role/label-based locators are the ones acceptance criterion 5 says
survive a markup swap unmodified — verify that holds, don't assume it).

**Instructions**:
Run both spec files unmodified against Step 14. If a case breaks, check whether it used a
class-based or DOM-structure-based locator (rather than `getByLabel`/`getByPlaceholder`/`getByRole`)
that the `FilterToolbar` extraction legitimately changed the structure under — fix the locator to the
accessible query, not the component.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm test:e2e -- e2e/trader/account-selector.spec.ts e2e/trader/orders.spec.ts
```

---

### Step 17 — service: Add `ui/navigation-menu.tsx` primitive (FR-13)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/ui/navigation-menu.tsx` — create
- `services/xstockstrat-ui/src/components/ui/navigation-menu.test.ts` — create

**Reviewers**: `xstockstrat-ui` service owner — Trading UI correctness (shared nav shell renders on
every UI segment)

**Codebase Evidence**:
- `design.md` § Chosen Approach point 5 (Round 3 override): add `ui/navigation-menu.tsx` via `npx
  shadcn@latest add navigation-menu` against the existing `components.json` preset (`radix-rhea`);
  hand-authored fallback matches the confirmed post-119 shape — plain function components,
  `data-slot`, `cn()`, **no** `forwardRef`/`displayName` — the same shape `ui/badge.tsx:35`,
  `ui/select.tsx:9,27,53`, `ui/sheet.tsx:10,42` already use.
- `recon.md` § Codebase Map Round 3 addendum: verified live shadcn Navigation Menu API — 9 named
  exports: `NavigationMenu`, `NavigationMenuList`, `NavigationMenuItem`, `NavigationMenuContent`,
  `NavigationMenuTrigger`, `NavigationMenuLink`, `NavigationMenuIndicator`, `NavigationMenuViewport`,
  `navigationMenuTriggerStyle` (a `cva()` helper). `NavigationMenuLink` is documented as usable
  standalone inside a `NavigationMenuItem` with no paired `Trigger`/`Content` — the flat-nav pattern
  Steps 18-19 need (`render={<Link href="..." />}`).
- Confirmed absent: `grep -rn "ui/navigation-menu" services/xstockstrat-ui/src/` → zero hits
  (`recon.md` § Risks/Not-found).
- `recon.md` flags the `render={<Link .../>}` import-source/prop-name pairing as "**not
  independently confirmed for `navigation-menu.tsx` specifically**" — verify the exact import source
  (the unified `radix-ui` package vs `@base-ui/react`) and prop name against the CLI-generated file
  (or shadcn's live registry JSON) before hand-authoring a fallback.

**TDD**: N/A for the primitive itself — no app-specific `cva` variant to guard (unlike
`badge.tsx:19-24`'s `buy`/`sell`/`paper`/`live` keys), so there is no red assertion to write first.
The companion test file asserts the exported surface exists, per product-spec.md FR-14's convention
(mirroring `badge.test.ts`/`button.test.ts`), not a red-before-green flow.

**Instructions**:
1. Run `npx shadcn@latest add navigation-menu` from `services/xstockstrat-ui/` against the existing
   `components.json` preset. If the CLI is unavailable (network/registry), hand-author
   `src/components/ui/navigation-menu.tsx` matching the confirmed shape: plain function components
   for `NavigationMenu`/`NavigationMenuList`/`NavigationMenuItem`/`NavigationMenuContent`/
   `NavigationMenuTrigger`/`NavigationMenuLink`/`NavigationMenuIndicator`/`NavigationMenuViewport`,
   each `data-slot`-marked, `cn()` from `@/components/ui/utils`, plus the `navigationMenuTriggerStyle`
   `cva()` helper — no `forwardRef`/`displayName`. Before hand-authoring, verify the exact import
   source and the render-prop name against shadcn's live registry JSON, since `recon.md` flags this as
   unconfirmed for this specific primitive.
2. Create `src/components/ui/navigation-menu.test.ts` mirroring `badge.test.ts`/`button.test.ts`'s
   shape: import the exported surface from `./navigation-menu` and assert it exists (e.g. each of the
   9 exports is defined/is a function, or a single assertion that `navigationMenuTriggerStyle()`
   returns a non-empty className string). Keep it minimal — there is no app-specific variant to guard
   here, unlike `badge`/`button`'s `buy`/`sell`/`paper` `cva` keys.

**Verification**:
```bash
cd services/xstockstrat-ui && test -f src/components/ui/navigation-menu.tsx && grep -n "function NavigationMenu" src/components/ui/navigation-menu.tsx && ! grep -n "forwardRef\|displayName" src/components/ui/navigation-menu.tsx
test -f src/components/ui/navigation-menu.test.ts
pnpm vitest run src/components/ui/navigation-menu.test.ts
pnpm lint
```

---

### Step 18 — service: Migrate `PlatformHeader.tsx`'s two desktop nav regions onto `NavigationMenu` (FR-13)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/shared/PlatformHeader.tsx` — modify (desktop row-1
  Primary nav `:170-190`; desktop row-2 Section nav `:271-287`, nested inside the `:260-288` row-2
  wrapper — the `aria-label="Breadcrumb"` `<span>` at `:261` is a sibling of this `<nav>`, not touched,
  owned by sibling `120`'s FR-7)

**Reviewers**: `xstockstrat-ui` service owner — Trading UI correctness (shared nav shell renders on
every UI segment)

**Codebase Evidence**:
- `recon.md` § Codebase Map Round 3 addendum: Row-1 Primary tabs — exact re-read range `:170-190`,
  `<nav aria-label="Primary" className="hidden sm:flex items-center gap-1 flex-1">`, one flat `<Link>`
  per `NAV_GROUPS` entry, `aria-current={isActive ? 'page' : undefined}` (`:177`), zero
  dropdown/flyout/nesting.
- Row-2 Section links — the `<nav aria-label="Section" className="flex items-center gap-1
  overflow-x-auto">` element itself is `:271-287`, nested inside the row-2 wrapper `<div>` at
  `:260-288`. Active-state logic consumed by both regions: `isItemActive` (`:81-84`), `resolveActive`
  (`:87-95`).
- `e2e/nav-reachability.spec.ts` selectors that must keep resolving (`recon.md`'s exact re-read):
  line 60 `page.getByRole('navigation', { name: 'Primary' })`, line 61 `page.getByRole('navigation',
  { name: 'Section' })`, line 65 `primary.getByRole('link', { name: group.tab, exact: true })`,
  line 67 `section.getByRole('link', { name: item.label, exact: true })`, line 68
  `expect(page).toHaveURL(...)`.
- `design.md` § Chosen Approach point 5: one `NavigationMenuItem`/`NavigationMenuLink` per
  `NAV_GROUPS`/`activeItems` entry, `NavigationMenuLink` used standalone (no `Trigger`/`Content`
  pairing — there is no dropdown here), `render={<Link href={...} />}` to preserve Next.js
  client-side routing, carrying the exact same `aria-current` and `cn(...)` active/inactive classes
  the current `<Link>` carries. The `NavigationMenu` root itself takes the `aria-label`
  (`"Primary"`/`"Section"`) and the current `<nav>`'s `className`, and passes `viewport={false}` (no
  dropdown flyout exists, so `Viewport`/`Indicator` machinery is unused weight).
- Mobile `Sheet` disclosure (`:195-255`) is explicitly out of scope — accordion-like expand/collapse,
  not a flat-link nav; sibling `120`'s FR-8 Accordion migration already targets this same `:209-253`
  range.

**TDD**: N/A (like-for-like markup swap preserving `role`/`aria-label`/`aria-current` exactly — no
new conditional logic; Step 20 provides the e2e regression gate).

**Instructions**:
1. Import `{ NavigationMenu, NavigationMenuList, NavigationMenuItem, NavigationMenuLink,
   navigationMenuTriggerStyle } from '@/components/ui/navigation-menu'` (or this file's existing
   relative-import style — confirm before editing).
2. Replace the Row-1 `<nav aria-label="Primary" className="hidden sm:flex items-center gap-1
   flex-1">` block (`:170-190`) with `<NavigationMenu aria-label="Primary" viewport={false}
   className="hidden sm:flex items-center gap-1 flex-1"><NavigationMenuList>` wrapping one
   `<NavigationMenuItem key={group.id}><NavigationMenuLink render={<Link
   href={group.items[0].href} />} aria-current={isActive ? 'page' : undefined} className={cn(...)}>
   {group.tab}</NavigationMenuLink></NavigationMenuItem>` per `NAV_GROUPS` entry, preserving the exact
   `aria-current` logic (`:177`) and existing `cn(...)` active/inactive classes verbatim.
3. Replace the Row-2 `<nav aria-label="Section" className="flex items-center gap-1
   overflow-x-auto">` block (`:271-287`) with the same `NavigationMenu`/`NavigationMenuList`/
   `NavigationMenuItem`/`NavigationMenuLink` pattern, one item per `activeItems` entry, preserving
   `aria-current={isItemActive(pathname, item) ? 'page' : undefined}` verbatim. Leave the sibling
   `aria-label="Breadcrumb"` `<span>` at `:261` completely untouched.
4. Leave the mobile `Sheet` block (`:195-255`) untouched — out of scope per `design.md`.

**Verification**:
```bash
cd services/xstockstrat-ui && grep -n "NavigationMenu" src/components/shared/PlatformHeader.tsx
grep -n 'aria-label="Primary"' src/components/shared/PlatformHeader.tsx
grep -n 'aria-label="Section"' src/components/shared/PlatformHeader.tsx
grep -n 'aria-label="Breadcrumb"' src/components/shared/PlatformHeader.tsx  # confirm untouched, still present
pnpm lint
```

---

### Step 19 — service: Migrate `BottomTabBar.tsx`'s flat nav onto `NavigationMenu` (FR-13)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/mobile/BottomTabBar.tsx` — modify (`:25-56`; the nav
  element itself is `:28-54` per `recon.md`'s Round 3 re-read)

**Reviewers**: `xstockstrat-ui` service owner — Trading UI correctness (mobile nav shell)

**Codebase Evidence**:
- `recon.md` § Codebase Map Round 3 addendum: whole file is 56 lines; the nav element itself is
  `:28-54` (`aria-label="Mobile primary"`, `data-testid="mobile-tab-bar"`), four `<Link>`s built from
  `TABS = NAV_GROUPS.slice(0, 4)` (`:8`), `isGroupActive` (`:10-18`) drives active styling.
- `design.md` § Chosen Approach point 5: `NavigationMenu` root carries the `aria-label`/
  `data-testid`/fixed-positioning classes, `NavigationMenuItem` per `TABS` entry (each `flex-1` so
  the four tabs still split the width evenly — the equal-width class moves from the `Link` itself to
  the `NavigationMenuItem` `<li>`, since `NavigationMenuList` renders a `<ul>`/`<li>` structure the
  current flat-`<Link>` markup doesn't have), `aria-current` preserved.
- `e2e/nav-reachability.spec.ts` never touches the mobile `Sheet` or `BottomTabBar` (`recon.md`'s
  full-file re-read) — no selector in that spec targets this file; Step 20 still runs the full suite
  as the regression gate regardless.

**TDD**: N/A (like-for-like markup swap; Step 20 provides the e2e regression gate).

**Instructions**:
1. Import `{ NavigationMenu, NavigationMenuList, NavigationMenuItem, NavigationMenuLink } from
   '@/components/ui/navigation-menu'` (or this file's existing relative-import style).
2. Replace the `<nav aria-label="Mobile primary" data-testid="mobile-tab-bar" ...>` block (`:28-54`)
   with `<NavigationMenu aria-label="Mobile primary" data-testid="mobile-tab-bar" viewport={false}
   className={/* the current nav's fixed-positioning classes, unchanged */}><NavigationMenuList
   className="flex w-full">` wrapping one `<NavigationMenuItem key={tab.id} className="flex-1">
   <NavigationMenuLink render={<Link href={...} />} aria-current={isGroupActive(...) ? 'page' :
   undefined} className={cn(...)}>{tab.label}</NavigationMenuLink></NavigationMenuItem>` per `TABS`
   entry — move the equal-width `flex-1` class from the `Link` onto `NavigationMenuItem`, preserving
   every other existing class and the `aria-current` logic verbatim.

**Verification**:
```bash
cd services/xstockstrat-ui && grep -n "NavigationMenu" src/components/mobile/BottomTabBar.tsx
grep -n 'data-testid="mobile-tab-bar"' src/components/mobile/BottomTabBar.tsx
grep -n 'aria-label="Mobile primary"' src/components/mobile/BottomTabBar.tsx
pnpm lint
```

---

### Step 20 — test: e2e regression for FR-13 (`nav-reachability.spec.ts` against the `NavigationMenu` swap)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/nav-reachability.spec.ts` — verification-only unless a selector
  breaks

**Reviewers**: `xstockstrat-ui` service owner — Trading UI correctness (C-10(a) shared-shell
contract)

**Codebase Evidence**:
- `recon.md` § Codebase Map Round 3 addendum: `e2e/nav-reachability.spec.ts` full-file re-read —
  line 60 `page.getByRole('navigation', { name: 'Primary' })`, line 61
  `page.getByRole('navigation', { name: 'Section' })`, line 65 `primary.getByRole('link', {
  name: group.tab, exact: true })`, line 67 `section.getByRole('link', { name: item.label, exact:
  true })`, line 68 `expect(page).toHaveURL(...)`, lines 70-71 `page.getByLabel('Breadcrumb')`
  (unrelated — owned by sibling `120`'s FR-7, must stay passing).
- `design.md` § Chosen Approach point 5: `NavigationMenuLink` used standalone (no `Trigger`/
  `Content` pairing) renders an anchor-equivalent element, not a `button`/`menuitem`, so
  `role=navigation`/`role=link`/`aria-current` are preservable without a spec rewrite — this step
  exists to verify that claim against the real Steps 18-19 markup, not assume it holds.
- This is this feature's own red-before-green discipline applied to a markup-only swap: role/label
  -based selectors are the ones acceptance criterion 5 says should survive a markup swap unmodified
  (the identical pattern this spec already uses in Steps 2/4/6/9/12/16), so the correct verification
  order is run the existing suite first against Steps 18-19's changes, not rewrite the spec
  pre-emptively.

**TDD**: N/A (regression check over an already-existing, role/label-based suite — same pattern as
this spec's other e2e steps; no pre-existing assertion needs to redden since the C-10(a) contract
being tested is unchanged by design, only the markup implementing it).

**Instructions**:
Run `e2e/nav-reachability.spec.ts` unmodified against Steps 18-19's changes. If a case fails, read
the spec first — if the failure is a role/label mismatch caused by `NavigationMenuLink` rendering a
different accessible role than a plain `<Link>` (e.g. because the render-prop/import-source pairing
`recon.md` flagged as unconfirmed turned out to require a different composition), fix Steps 18-19's
markup to restore the exact `role=navigation`/`role=link`/`aria-current` contract rather than
rewriting this spec's selectors — the whole point of the standalone-`Link`-inside-`Item` pattern
(`design.md` § Round 3) is that no selector rework should be needed.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm test:e2e -- e2e/nav-reachability.spec.ts
```

---

### Step 21 — test: Whole-feature verification gate (acceptance criterion 5)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**: none — verification-only, runs after Steps 1–20

**Reviewers**: `xstockstrat-ui` service owner — full review scope (final gate)

**Codebase Evidence**:
- Product-spec acceptance criterion 5: "`pnpm lint` and `pnpm build` pass with no new errors;
  `pnpm test:e2e` passes for every spec covering a touched page/component."
- `package.json` scripts confirmed: `"lint": "next lint"`, `"build": "next build"`,
  `"test:e2e": "playwright test"` (`services/xstockstrat-ui/package.json:8,10,15`).

**TDD**: N/A (whole-suite gate, not a new behavioral assertion).

**Instructions**:
No code change. Run the full lint, build, and e2e suite once every prior step in this spec has landed,
to catch any cross-step interaction (e.g. a shared import, a type error surfacing only when all seven
FRs' files compile together) that a per-step `pnpm lint` alone would miss.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm lint && pnpm build && pnpm test:e2e
```

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._

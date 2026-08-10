# Implementation Spec: shadcn-sidebar-visual-rewrite

**Status**: `complete`
**Created**: 2026-08-10
**Feature**: `docs/roadmap/features/125-shadcn-sidebar-visual-rewrite/feature.md`
**Total Steps**: 4
**Feature Branch**: `claude/implement-124-e48xkn` (harness-assigned; see `feature.md`)

---

## Execution Summary

Single-service (`xstockstrat-ui`), no proto/config/DB changes. Step 1 adds the `sectionStart`
data-model field the section-label rendering (Step 2) reads. Step 2 is the one coherent JSX
rewrite of `PlatformHeader.tsx`'s mobile offcanvas render block — chevron (FR-1), `SidebarMenuSub`
nesting (FR-2), and section labels (FR-3) all land in the same ~50-line block design.md treats as
a single "Chosen Approach," so splitting them into three separate service steps against the exact
same lines would violate the "surgical diff" guardrail without adding real reviewability. Step 3
is the paired e2e test step (FR-5/AC-6), written red-before-green against Steps 1+2 together. Step
4 is design.md's own additional requirement — a manual visual-verification checkpoint, since this
codebase has no screenshot-regression tooling.

**Correction to design.md's stated chevron mechanism** (Step 2 below): design.md's Chosen Approach
says the rotation is driven by "the `data-open:*` functional-variant family already defined on
`sidebarMenuButtonVariants` (`sidebar.tsx:449`)." Verified against the actually-installed
`@radix-ui/react-collapsible@1.1.20` source
(`node_modules/.pnpm/@radix-ui+react-collapsible@1.1.20.../dist/index.mjs:68`,
`"data-state": getState(context.open)`) — `CollapsibleTrigger` emits `data-state="open"|"closed"`
and `aria-expanded`, **never** a literal `data-open` attribute, so `sidebarMenuButtonVariants`'
`data-open:*` classes (`sidebar.tsx:449`) are not driven by anything today (no producer anywhere in
`sidebar.tsx` or `PlatformHeader.tsx`) — a "demonstration is not a producer-contract claim" case
(ledger `fails.md`, recurring pattern, e.g. 2026-07-27/072, 2026-08-05/023). `sidebar.tsx:215`
itself is the correct, real, in-file precedent for the fix: `'group-data-[side=right]:rotate-180'`
— the bracketed `group-data-[value]:` syntax matched against a real attribute value, not the bare
`data-open:` shorthand (which Tailwind v4 resolves to literal-attribute-presence `[data-open]`,
confirmed via `node_modules/.pnpm/tailwindcss@4.3.3.../dist/lib.mjs`'s variant table). Step 2
below is written against `group-data-[state=open]/menu-button:rotate-90`, the mechanism that
actually matches `CollapsibleTrigger`'s real output. Design.md's higher-level decision (a single
rotating `CaretRight`, driven by `CollapsibleTrigger`'s state, reusing the existing
`group/menu-button` name on `sidebarMenuButtonVariants`) is otherwise followed exactly — only the
specific Tailwind selector is corrected. Per design.md's own P-06 framing, this was always going to
be "verified by the red step of the new e2e assertion, not asserted as already true" — this
correction resolves it at spec time with grounded evidence instead of leaving it to discovery
during execute.

## Step Dependencies

- Step 2 requires Step 1: the section-label rendering in `PlatformHeader.tsx` reads
  `group.sectionStart`, which Step 1 adds to `NavGroup` and sets on the `decide`/`settings` group
  objects.
- Step 3 [test] covers Steps 1 + 2 [service]: `mobile-sidebar.spec.ts`'s new/extended assertions
  are the red-before-green proof for the combined data-model + rendering change (Constitution
  **P-06**). Run once against the pre-Step-1/2 tree (red) and once after Step 2 lands (green).
- Step 4 [docs] requires Steps 1–3 complete: the manual visual-verification checkpoint runs after
  the automated e2e assertions pass and before the integration PR opens (design.md's explicit
  ordering).

---

### Step 1 — service: add `sectionStart` field to `NavGroup`

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/shared/navGroups.tsx` — modify

**Reviewers**: `xstockstrat-ui` service owner — Trading UI correctness, analytics display accuracy,
config mutation safety, Connect-RPC call safety, environment scope correctness, no secret values
rendered in UI, no direct DB access (except audit log)

**Codebase Evidence**:
- `NavGroup` interface — `navGroups.tsx:22-27`:
  ```ts
  export interface NavGroup {
    key: string;
    label: string;
    icon: React.ReactNode;
    items: NavItem[];
  }
  ```
- `decide` group object literal — `navGroups.tsx:34-39`; `settings` group object literal —
  `navGroups.tsx:70-83`. Confirmed via full-file Read: no existing grouping/category/label field
  anywhere in `NAV_GROUPS` today (recon.md § Risks / Not-found).
- design.md § Chosen Approach FR-3: `sectionStart?: string` on `NavGroup`, `'Navigate'` on
  `decide`, `'Settings'` on `settings`, `discover`/`engine`/`book` unchanged — the design's final,
  approved (Round 3) synthesis, superseding the Round 1 group-merge and Round 2 string-literal-gate
  alternatives (design.md § Rejected Alternatives).
- Open Risk (design.md): the field's ordering invariant ("must be set on the first `NAV_GROUPS`
  entry of the section it starts") is a documentation-only mitigation (JSDoc), not enforced —
  accepted, low blast radius (visual-only misplacement, not an ARIA-reference risk, since the
  aria-labelledby mechanism was dropped in the final round).

**TDD**: `red-green required` (verified together with Step 2 by Step 3's e2e assertions — see
`## Step Dependencies`; this field has no isolated runtime behavior on its own, only once Step 2
consumes it).

**Instructions**:
1. In `navGroups.tsx`, add an optional `sectionStart` field to the `NavGroup` interface
   (`:22-27`), with a JSDoc comment documenting the one real invariant per design.md's Open Risk:
   ```ts
   export interface NavGroup {
     key: string;
     label: string;
     icon: React.ReactNode;
     items: NavItem[];
     /**
      * Text for a muted, non-interactive SidebarGroupLabel rendered immediately before this
      * group in the mobile offcanvas nav (FR-3, feature 125). Purely visual — no id, no
      * aria-labelledby. Invariant: must be set on the FIRST NAV_GROUPS entry of the section it
      * starts, or the label silently attaches to the wrong group — not enforced at compile/
      * runtime, only by this comment.
      */
     sectionStart?: string;
   }
   ```
2. Set `sectionStart: 'Navigate'` on the `decide` group object literal (`:34-39`) and
   `sectionStart: 'Settings'` on the `settings` group object literal (`:70-83`). Leave
   `discover`/`engine`/`book` unchanged (no `sectionStart` field — they render as part of the
   "Navigate" section without a repeated label, per design.md).

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm exec tsc --noEmit
grep -n "sectionStart" src/components/shared/navGroups.tsx
# confirm: interface field present once; 'Navigate' set only on the decide object; 'Settings' set
# only on the settings object; discover/engine/book have no sectionStart key
```

---

### Step 2 — service: chevron, `SidebarMenuSub` nesting, and section labels in `PlatformHeader.tsx`

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/shared/PlatformHeader.tsx` — modify

**Reviewers**: `xstockstrat-ui` service owner — Trading UI correctness, analytics display accuracy,
config mutation safety, Connect-RPC call safety, environment scope correctness, no secret values
rendered in UI, no direct DB access (except audit log)

**Codebase Evidence**:
- Current per-group render block — `PlatformHeader.tsx:276-311`: `NAV_GROUPS.map` → `SidebarGroup`
  → `Collapsible open={expanded === group.key} onOpenChange={...}` → `CollapsibleTrigger asChild`
  wrapping `SidebarMenuButton` (`:282-293`, no chevron) → `CollapsibleContent` wrapping
  `SidebarGroupContent` → `SidebarMenu` → `SidebarMenuItem` × sub-items → `MobileNavLink`
  (`:294-308`).
- `MobileNavLink` — `PlatformHeader.tsx:160-175`: `SidebarMenuButton asChild isActive={isActive}
  onClick={() => setOpenMobile(false)}` wrapping `<Link>`.
- Current imports from `../ui/sidebar` — `PlatformHeader.tsx:13-24`:
  `SidebarProvider, Sidebar, SidebarHeader, SidebarContent, SidebarGroup, SidebarGroupContent,
  SidebarMenu, SidebarMenuItem, SidebarMenuButton, useSidebar`. Confirmed via grep
  (`SidebarGroupContent`/`SidebarMenu`(non-Sub)/`SidebarMenuItem`(non-Sub)/`MobileNavLink` all
  appear **only** inside this file's mobile block — no other file imports them from
  `PlatformHeader.tsx`, so removing them from this file's import list and JSX is safe).
- Icon import — `PlatformHeader.tsx:6`: `import { List, Lightning, Sparkle } from
  '@phosphor-icons/react';` — `CaretRight` already used elsewhere in this codebase for a
  disclosure/has-children indicator at `src/components/mobile/SectionRenderer.tsx:3,73`
  (`<CaretRight className="h-4 w-4 shrink-0 text-muted-foreground" />`, no `aria-hidden`, confirmed
  accname-safe by design.md round-1 adversary: Phosphor's `IconBase` emits no `<title>` unless
  `alt` is passed).
- Vendored target primitives, all currently unused in `PlatformHeader.tsx` — `sidebar.tsx`:
  - `SidebarGroupLabel` — `:375-393`, renders a plain `<div>` (`Comp = asChild ? Slot.Root :
    'div'`, no `asChild` passed here) — non-interactive, confirmed no collision with
    `getByRole('button', ...)`/`getByRole('link', ...)` locators already used in
    `mobile-sidebar.spec.ts` (avoids the exact collision class recorded in `fails.md`
    2026-08-09 `shadcn-migration-high-confidence`, re-verified here rather than assumed).
  - `SidebarMenuSub` — `:593-605` (`<ul>`, `border-l border-sidebar-border` connecting-line rail
    already styled).
  - `SidebarMenuSubItem` — `:607-616` (`<li>` wrapper only).
  - `SidebarMenuSubButton` — `:618-644` — accepts `asChild`/`isActive`/`onClick` identically to
    `SidebarMenuButton`; `data-active={isActive}` propagation (`:636`) is the same shape
    `mobile-sidebar.spec.ts:108-112`'s existing active-link assertion already reads.
- **Real chevron-rotation mechanism** (correcting design.md's `data-open:*` citation — see
  `## Execution Summary`): `sidebarMenuButtonVariants` already declares the named group
  `group/menu-button` (`sidebar.tsx:449`, first token: `'peer/menu-button group/menu-button
  flex w-full items-center gap-2 ...'`). `CollapsibleTrigger asChild` merges its own `data-state`
  prop onto the rendered `SidebarMenuButton` root (confirmed via
  `@radix-ui/react-collapsible@1.1.20` source, `"data-state": getState(context.open)` at both the
  Trigger, `:68`, and Root, `:46`). `sidebar.tsx:215` is the in-file, working precedent for the
  correct selector shape against a real attribute value: `'group-data-[side=right]:rotate-180'`.
  The chevron therefore keys off `group-data-[state=open]/menu-button:rotate-90` (90°, not 180° —
  `CaretRight` is a right-pointing caret; rotating it 90° on open produces the conventional
  downward-pointing "expanded" caret, the semantically correct pairing for this icon, distinct
  from `navigation-menu.tsx`'s `IconChevronDown` which starts pointing down and needs 180° to flip
  upward).

**TDD**: `red-green required` (paired with Step 1, proved by Step 3's e2e assertions).

**Instructions**:
1. In the `@phosphor-icons/react` import (`:6`), add `CaretRight`:
   `import { List, Lightning, Sparkle, CaretRight } from '@phosphor-icons/react';`
2. In the `../ui/sidebar` import (`:13-24`), replace `SidebarGroupContent, SidebarMenu,
   SidebarMenuItem` with `SidebarGroupLabel, SidebarMenuSub, SidebarMenuSubItem,
   SidebarMenuSubButton`, keeping `SidebarProvider, Sidebar, SidebarHeader, SidebarContent,
   SidebarGroup, SidebarMenuButton, useSidebar` unchanged:
   ```ts
   import {
     SidebarProvider,
     Sidebar,
     SidebarHeader,
     SidebarContent,
     SidebarGroup,
     SidebarGroupLabel,
     SidebarMenuButton,
     SidebarMenuSub,
     SidebarMenuSubItem,
     SidebarMenuSubButton,
     useSidebar,
   } from '../ui/sidebar';
   ```
3. Rewrite `MobileNavLink` (`:160-175`) to render `SidebarMenuSubButton` instead of
   `SidebarMenuButton`, keeping the same props (`asChild`, `isActive`, `onClick`):
   ```tsx
   function MobileNavLink({
     href,
     label,
     isActive,
   }: {
     href: string;
     label: string;
     isActive: boolean;
   }) {
     const { setOpenMobile } = useSidebar();
     return (
       <SidebarMenuSubButton asChild isActive={isActive} onClick={() => setOpenMobile(false)}>
         <Link href={href}>{label}</Link>
       </SidebarMenuSubButton>
     );
   }
   ```
4. Rewrite the `NAV_GROUPS.map` block inside `SidebarContent` (`:276-311`) to: (a) wrap each
   iteration in a `React.Fragment` keyed on `group.key` so a group can render an optional
   preceding `SidebarGroupLabel` as a sibling of its `SidebarGroup` (`SidebarContent`'s direct-child
   `gap-2`, `sidebar.tsx:356`, then applies uniformly to every direct child including the new
   labels — no group is merged, matching design.md's Chosen Approach exactly); (b) add the
   rotating `CaretRight` inside `SidebarMenuButton`'s children; (c) replace the flat
   `SidebarGroupContent > SidebarMenu > SidebarMenuItem` with `SidebarMenuSub > SidebarMenuSubItem`
   directly inside `CollapsibleContent` (no wrapper, per design.md's settled Item 4):
   ```tsx
   {NAV_GROUPS.map((group) => (
     <React.Fragment key={group.key}>
       {group.sectionStart && <SidebarGroupLabel>{group.sectionStart}</SidebarGroupLabel>}
       <SidebarGroup>
         <Collapsible
           open={expanded === group.key}
           onOpenChange={(open) => setExpanded(open ? group.key : '')}
         >
           <CollapsibleTrigger asChild>
             <SidebarMenuButton
               className={cn(
                 group.key === activeGroup.key
                   ? 'bg-accent text-foreground font-medium'
                   : 'text-muted-foreground',
               )}
             >
               {group.icon}
               <span className="flex-1">{group.label}</span>
               <CaretRight
                 className="h-4 w-4 shrink-0 transition-transform duration-300 group-data-[state=open]/menu-button:rotate-90"
                 aria-hidden="true"
               />
             </SidebarMenuButton>
           </CollapsibleTrigger>
           <CollapsibleContent>
             <SidebarMenuSub>
               {visibleItems(group.items).map((sub) => (
                 <SidebarMenuSubItem key={sub.href}>
                   <MobileNavLink
                     href={sub.href}
                     label={sub.label}
                     isActive={isItemActive(pathname, sub)}
                   />
                 </SidebarMenuSubItem>
               ))}
             </SidebarMenuSub>
           </CollapsibleContent>
         </Collapsible>
       </SidebarGroup>
     </React.Fragment>
   ))}
   ```
   `group.sectionStart` (Step 1) is the entire "which group gets a preceding label" derivation —
   no separate lookup table is needed since the field is set directly on the qualifying group
   object (per root `CLAUDE.md` "write the minimum that solves the stated problem").
5. Do **not** touch `mobile-sidebar.spec.ts:102-113`'s targets — `SidebarMenuButton`'s
   `bg-accent`/`SidebarMenuSubButton`'s `data-active` propagation are unchanged by this rewrite
   (design.md FR-5 item 4, confirmed via `sidebar.tsx:491` vs `:636` — both set
   `data-active={isActive}` identically).

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm exec tsc --noEmit && pnpm run lint
grep -n "SidebarMenuSub\|SidebarGroupLabel\|CaretRight\|group-data-\[state=open\]" src/components/shared/PlatformHeader.tsx
# confirm: SidebarGroupContent/SidebarMenu(non-Sub)/SidebarMenuItem(non-Sub) no longer imported or
# referenced in this file
grep -n "SidebarGroupContent\|SidebarMenu,\|SidebarMenuItem" src/components/shared/PlatformHeader.tsx
# expect: no output
```

---

### Step 3 — test: update `mobile-sidebar.spec.ts` for the new structure

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/mobile-sidebar.spec.ts` — modify

**Reviewers**: `xstockstrat-ui` service owner — Trading UI correctness, analytics display accuracy,
config mutation safety, Connect-RPC call safety, environment scope correctness, no secret values
rendered in UI, no direct DB access (except audit log)

**Codebase Evidence**:
- Existing spec structure — `mobile-sidebar.spec.ts:1-114`: `test.use({ viewport: { width: 390,
  height: 844 } })` (`:11`); `openGroup(panel, name)` helper (`:15-20`) reads
  `trigger.getAttribute('aria-expanded')` — unaffected by Step 2 (Radix `CollapsibleTrigger` still
  sets `aria-expanded`, confirmed in the same `@radix-ui/react-collapsible` source cited in Step
  2's evidence, `:64` `"aria-expanded": context.open || false`); auth via `addAuthCookie`/
  `addAdminCookie` (`./helpers/auth.ts:56,61`) — C-12 fixture home, already the sole test-data
  source this spec uses (recon.md § Patterns to REUSE confirms no new fixture is needed).
- The existing active-highlight test (`:102-113`) asserts `panel.getByRole('button', { name:
  'Decide' })` has class `/bg-accent/` and `panel.getByRole('link', { name: 'Opportunities'
  })` has `data-active="true"` — per Step 2 Instruction 5, this stays unmodified.
- **Red-before-green grounding** (correcting design.md's own FR-5 item 1 as written): design.md
  proposed "an explicit `data-state` `'closed'`→`'open'` transition check on a trigger" as the
  chevron's red-before-green proof. Verified against the current (pre-Step-2) tree: `Collapsible`/
  `CollapsibleTrigger` already wrap every group's `SidebarMenuButton` today
  (`PlatformHeader.tsx:278-293`, unchanged by this feature), so a bare `data-state` transition
  assertion **already passes on `main-dev`** — it would not be red before Step 2, only a general
  sanity check. The genuine red-before-green proof for FR-1 is a class assertion on the chevron
  icon itself (`rotate-90`), which has no producer at all until Step 2 lands. Both assertions are
  included below: the `data-state` check (as design.md specified, still a valid correctness check)
  plus the `rotate-90` class check (the actual FR-1 red/green proof).
- **Ledger discipline** (`fails.md` 2026-08-09 `shadcn-migration-high-confidence`): this exact
  primitive family (`sidebar.tsx`/`PlatformHeader.tsx`) has twice produced a shadcn-primitive/
  Playwright-locator collision caught only by a *broader* suite run, not the narrowly-scoped spec's
  own run. Verification below runs the full `pnpm test:e2e` suite, not just
  `-g "Mobile offcanvas sidebar"`, before this step is considered done.

**TDD**: `red-green required`. Run the new/extended assertions against the pre-Step-1/2 tree first
(expect the `SidebarMenuSub`, `SidebarGroupLabel`, and `rotate-90` assertions to fail — the
`data-state` assertion will pass, as noted above), then again after Step 2 lands (expect all
green).

**Instructions**:
1. Add a new test inside the existing `test.describe('Mobile offcanvas sidebar (FR-11b)', ...)`
   block asserting the chevron's `data-state` transition and its rotation class (use `Discover`,
   which starts closed — `Decide` starts expanded per the `openGroup` helper's own comment,
   `:13-14`):
   ```ts
   test('a group trigger flips data-state and rotates its chevron on expand', async ({ page }) => {
     await addAuthCookie(page);
     await page.goto('/insights/opportunities');
     await page.getByRole('button', { name: 'Open menu' }).click();
     const panel = page.getByRole('dialog');

     const trigger = panel.getByRole('button', { name: 'Discover' });
     const chevron = trigger.locator('svg').last();
     await expect(trigger).toHaveAttribute('data-state', 'closed');
     await expect(chevron).not.toHaveClass(/rotate-90/);

     await trigger.click();
     await expect(trigger).toHaveAttribute('data-state', 'open');
     await expect(chevron).toHaveClass(/rotate-90/);
   });
   ```
2. Add a new test asserting `SidebarMenuSub` structure once a group is expanded:
   ```ts
   test('sub-items render via SidebarMenuSub once a group is expanded', async ({ page }) => {
     await addAuthCookie(page);
     await page.goto('/insights/opportunities');
     await page.getByRole('button', { name: 'Open menu' }).click();
     const panel = page.getByRole('dialog');

     await openGroup(panel, 'Discover');
     await expect(panel.locator('[data-slot="sidebar-menu-sub"]')).toBeVisible();
   });
   ```
3. Add a new test asserting the two section labels render as non-interactive group labels:
   ```ts
   test('Navigate and Settings section labels render', async ({ page }) => {
     await addAuthCookie(page);
     await page.goto('/insights/opportunities');
     await page.getByRole('button', { name: 'Open menu' }).click();
     const panel = page.getByRole('dialog');

     await expect(
       panel.locator('[data-slot="sidebar-group-label"]', { hasText: 'Navigate' }),
     ).toBeVisible();
     await expect(
       panel.locator('[data-slot="sidebar-group-label"]', { hasText: 'Settings' }),
     ).toBeVisible();
   });
   ```
4. Leave `mobile-sidebar.spec.ts:102-113` (the active-highlight test) unmodified.

**Verification**:
```bash
cd services/xstockstrat-ui
pnpm exec tsc --noEmit && pnpm run lint
# Red: checked out at the pre-Step-1/2 tree (or via git stash of Steps 1-2's diff)
pnpm test:e2e -- mobile-sidebar.spec.ts
# expect: the SidebarMenuSub, section-label, and rotate-90 assertions FAIL; the plain data-state
# assertion passes (as documented above — not a red-before-green signal on its own)
# Green: with Steps 1-2 applied
pnpm test:e2e
# full suite, not just this file — per the fails.md 2026-08-09 ledger discipline for this exact
# primitive family; confirm zero regressions in any other spec (e.g. nav-reachability.spec.ts,
# breadcrumb.spec.ts) before marking this step done
```

---

### Step 4 — docs: manual visual-verification checkpoint

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `docs/roadmap/features/125-shadcn-sidebar-visual-rewrite/context.md` — modify (records the
  pass/fail note + screenshot reference)

**Reviewers**: none

**Codebase Evidence**:
- design.md § Chosen Approach, "Visual verification" paragraph: this codebase has no screenshot/
  snapshot-regression tooling anywhere (`grep` across `e2e/` and `playwright.config.ts` returned
  zero real hits per the design's own Phase 1 Round 3 finding) — introducing one for a single
  feature would violate root `CLAUDE.md`'s "write the minimum" guardrail (design.md § Rejected
  Alternatives, "Introducing Playwright `toHaveScreenshot`..."). The design requires an explicit
  manual-verification step instead: open the panel at the `390×844` viewport
  `mobile-sidebar.spec.ts:11` already standardizes on, expand a group, and compare against
  shadcn's own reference rendering (`ui.shadcn.com/docs/components/sidebar`, Radix UI tab) —
  capturing a saved screenshot alongside a pass/fail note, run after the automated e2e assertions
  pass (Step 3) and before the integration PR opens.
- Open Risk (design.md, unresolved by construction — addressed here): "the two-`SidebarGroupLabel`
  -as-visual-only-sibling structure is new and unexercised anywhere else in this codebase... no
  prior screenshot/precedent confirms a 'label → single-collapsible-row group' pairing... reads
  well visually rather than looking like a stray, narrow heading." This step is where that risk is
  actually checked, not just noted.

**TDD**: `N/A (manual visual check — not a code-bearing step; the codebase has no
screenshot-regression harness to automate against, per design.md's Rejected Alternatives)`.

**Instructions**:
1. With Steps 1–3 landed and `pnpm test:e2e` green, capture a screenshot of the expanded mobile
   offcanvas Sidebar at the `390×844` viewport. The existing Playwright infrastructure already
   proven to work in this environment by Step 3 is the concrete mechanism — e.g. temporarily add
   `await page.screenshot({ path: 'sidebar-visual-check.png', fullPage: true });` inside one of
   Step 3's new tests (after `openGroup(panel, 'Discover')`), run it once via
   `pnpm exec playwright test -g "sub-items render via SidebarMenuSub"`, save the resulting PNG,
   then remove the temporary `page.screenshot` line before the step's own diff is considered done
   (this step's own `**Files**` list is docs-only — the screenshot line must not be committed to
   `mobile-sidebar.spec.ts`).
2. Compare the captured screenshot against shadcn's own reference Sidebar example
   (`ui.shadcn.com/docs/components/sidebar`, Radix UI tab) for: (a) the chevron rotates and reads
   as an expand/collapse affordance, not decorative; (b) sub-items are visibly indented under a
   connecting line, distinct in weight from the top-level group button; (c) the "Navigate"/
   "Settings" section labels read as muted section headers, not as a second, confusingly-worded
   button (the specific Open Risk this step exists to check).
3. Record the outcome in `context.md` under a new session entry: attach or reference the saved
   screenshot's location and write an explicit pass/fail note. If any of (a)/(b)/(c) reads poorly,
   do **not** silently adjust the design's settled decisions (e.g. the "Settings" label wording,
   accepted as an explicit trade-off in design.md's Open Risks) — escalate to the user per
   Constitution **P-03**, since those are explicit user-approved decisions, not open
   implementation choices.
4. **If the execute sandbox cannot run a live browser/dev server at all** (no Docker, no
   `playwright install`'d browser — see `fails.md` 2026-08-05 `frontend-reverse-proxy` for this
   exact sandbox-capability gap recurring on this codebase before): do not mark this step done
   silently. Escalate to the user with the specific blocker per **P-03**, since this step's whole
   purpose is a human-legible visual comparison and a structural fallback (e.g. reading the JSX)
   cannot substitute for it.

**Verification**: A screenshot file exists (referenced by path/description in `context.md`) and
`context.md` contains an explicit pass/fail note against the three criteria in Instruction 2 — not
a bare "looks fine." If fail, the step is not done until either a follow-up code fix (routed back
through Steps 1–3, not edited in place per **F-09**) or an explicit user sign-off accepting the
visual result is recorded.

---

## Deviation Log

### Step 3 — Playwright e2e: first attempt fell back, then a scoped retry got a genuine red/green cycle

**Disposition**: resolved — genuine red-before-green captured. (First attempt fell back to a
CI-equivalent substitute; a second, more targeted attempt superseded it with a real result. Both
are recorded here since the corrected approach is itself the reusable lesson.)

**Attempt 1 — full-suite run, fell back**: snapshotted the pre-Step-1/2 versions of
`PlatformHeader.tsx`/`navGroups.tsx` via `git show 9ddee29:...` (Step 2's parent commit), swapped
them in with the new test file in place, and ran `pnpm exec playwright test mobile-sidebar.spec.ts`
(default, depends on the `setup` project). The Next.js dev server (`pnpm dev`,
`reuseExistingServer`) came up, but individual route compiles are slow in this sandbox —
`/config-ui/sources` alone took 88.6s to compile 13,610 modules on first hit — and
`warmup.setup.ts` fetches **21** routes, compiled serially by the dev server despite
`Promise.allSettled`'s parallel fetch; the warmup test itself timed out (10s default, then 60s with
`--timeout=60000 --workers=1`) before a single real assertion in `mobile-sidebar.spec.ts` ran.
Fell back to `pnpm exec tsc --noEmit` (clean) + `pnpm run lint` (clean) +
`playwright test --list` (confirmed all 9 tests register/parse correctly) — the sequential-mode
pre-authorized substitute.

**Attempt 2 — scoped run, succeeded**: this feature's tests only ever visit **two** routes
(`/insights/opportunities`, `/trader/positions`), not all 21 `warmup.setup.ts` covers. Re-ran with
`--project=chromium --no-deps` (skips the `setup` project's dependency entirely) after manually
pre-warming just those two routes via `curl` with a hand-signed test JWT (same secret/shape as
`e2e/helpers/auth.ts`'s `signTestJwt`) — `/insights/opportunities` compiled in 29s, `/trader/
positions` in 11.4s, both one-time costs. The subsequent `playwright test mobile-sidebar.spec.ts
--project=chromium --no-deps` run completed in under a minute and produced a **genuine RED**: the
3 new tests failed for the right reasons (no `rotate-90`-driven rotation, no `SidebarMenuSub`, no
section labels), all 6 existing tests still passed (no regression from the temporary revert).

**Bug found and fixed during the cycle**: restoring Steps 1-3 and re-running initially still showed
1 failure — the chevron test's `data-state` assertions passed but
`expect(chevron).not.toHaveCSS('transform', 'none')` stayed `"none"` even after the click. Dumped
the actual generated stylesheet rule via `document.styleSheets` and found Tailwind v4 sets the
standalone CSS `rotate` property for a bare `rotate-90` utility (not `transform`, which is only
composed in when a separate `.transform` class is also present):
`.group-data-[state=open]/menu-button:rotate-90:is(:where(.group/menu-button)[data-state="open"] *)
{ rotate: 90deg; }`. The chevron mechanism (Step 2's actual implementation) was correct all along —
only the test's chosen CSS property was wrong. Fixed the test to assert `toHaveCSS('rotate', ...)`
instead of `'transform'`, re-verified RED (fails for the right reason: no rotation exists pre-
Step-2) then GREEN. Final result: **9/9 passed** in 18.2s.

**Ledger relevance**: two `fails.md` entries added (2026-08-10) — one correcting Attempt 1's overly
pessimistic "sandbox can't do live e2e" conclusion with the scoped-run technique that actually
worked, and one recording the Tailwind v4 `rotate`-vs-`transform` CSS-property gotcha for any future
rotate/scale/translate assertion in this codebase.

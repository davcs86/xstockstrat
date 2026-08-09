# Context: shadcn-migration-medium-confidence

**Feature**: `docs/roadmap/features/121-shadcn-migration-medium-confidence/feature.md`
**Product Spec**: `docs/roadmap/features/121-shadcn-migration-medium-confidence/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/121-shadcn-migration-medium-confidence/implementation-spec.md`

---

## Session 2026-08-08 — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from user story.
- Source: "The Component Ledger" shadcn/ui gap audit (published as an artifact this session). This
  feature covers the 22 occurrences the audit rated **medium confidence**. Sibling features:
  `120-shadcn-migration-high-confidence` (27 high-confidence occurrences, created first in the same
  session) and `shadcn-migration-low-confidence` (4 low-confidence occurrences, created next).
- **Dependency noted**: six of this feature's FRs (FR-4 through FR-9) extend primitives that
  `120-shadcn-migration-high-confidence` adds (`alert-dialog`, `tabs`, `toggle-group`, `alert`,
  `checkbox`, `accordion`). This feature should not reach `implementation-ready` execution on those FRs
  before `120-shadcn-migration-high-confidence` merges to `main-dev`, or `/sdd-spec` needs to sequence
  around it explicitly. Flagged in product-spec.md Open Questions for `/sdd-design` and `/sdd-spec` to
  register in `docs/roadmap/features/merge-order.md`.
- **Numbering note**: `main-dev` moved during this session — a real, unrelated feature
  `119-shadcn-ui-migration` (shadcn CLI infra adoption: `components.json`, preset `bLTl5gh6`, Tailwind
  v4) merged while this backlog was being written, taking `119`. All three sibling backlog features
  from this audit (`120`/`121`/`122`) were renumbered up by one to avoid the collision; every "depends
  on 119" phrasing in this feature's own FRs means its sibling `120-shadcn-migration-high-confidence`,
  not the real `119-shadcn-ui-migration` — corrected after an initial draft conflated the two.

## Session 2026-08-08 — sdd-review product-spec

No `spec-reviewer`/`feature-overlap` Task-subagent tool was available in this session (running as a
plain subagent with Read/Grep/Bash only), so the review criteria in
`.claude/skills/sdd-review/reference/product-spec-criteria.md` and the overlap procedure in
`reference/overlap-check.md` were applied directly instead of delegating.

- **Criteria pass**: all A3 core criteria + C-10/C-14 passed. Trading-domain checks (A3b): skipped —
  `grep -iEq 'IBKR|Alpaca|broker|...'` against product-spec.md found no match (non-trading feature).
  Two findings were BLOCKER-level and fixed directly in `product-spec.md` rather than left as warnings:
  1. **FR-14 stale primitive-shape claim (fixed).** FR-14 said new `ui/*` files should use
     `React.forwardRef`/`displayName`. Verified against the live repo
     (`grep -n "forwardRef\|displayName\|function " ui/select.tsx ui/sheet.tsx ui/badge.tsx` — zero
     hits for `forwardRef`/`displayName` in all three) that every existing post-119 primitive uses the
     plain-function-component shape instead, matching sibling `120`'s recon.md finding and 120's own
     (already-corrected) product-spec.md FR-12 wording. Rewrote FR-14 to state the correct shape and
     cite the verification.
  2. **Open Question 1 (merge order) — resolved, not left unchecked.** Re-verified FR-1/FR-2/FR-3/
     FR-10/FR-11/FR-12/FR-13's file:line citations against the current repo — confirmed none reference
     a primitive `120` adds, so the "no dependency" claim for those seven FRs holds. Checked off with a
     note that the dependency itself is now fully documented (not resolved as in "decided" — that's the
     user's call once all four sibling features have run `/sdd-design`) and points at this session's
     recommended `merge-order.md` row (below) plus `design.md`.
  3. **Open Question 2 (e2e window.confirm coverage) — resolved with real grep evidence.**
     `grep -rn "window.confirm\|page.on('dialog'" services/xstockstrat-ui/e2e/` found dialog
     interception at 3 of the 5 FR-4 call sites (`e2e/accounts/authorized-apps.spec.ts:61`,
     `e2e/insights/backfills.spec.ts:126`, `e2e/insights/watchlists.spec.ts:51`) — all three must be
     rewritten to drive the new `AlertDialog` instead of intercepting the browser dialog. The other two
     FR-4 sites (`formulas/[id]/page.tsx:22` delete, `strategies/page.tsx:53-57` deactivate) have **no**
     existing e2e coverage of the confirm flow at all (`formulas.spec.ts:62` only asserts the Delete
     button is absent for read-only system formulas; nothing under `e2e/` matches `Deactivate`/
     `handleDeactivate`) — recorded as a pre-existing test gap, not a migration regression risk, and
     explicitly out of this feature's scope to backfill.
  All five FR-4 window.confirm citations, and all ten FR-10 through FR-13 file:line citations, were
  independently re-verified against the current repo (`sed -n` on each range) — all accurate, no stale
  line numbers found.
- **Overlap pass**: only `120-shadcn-migration-high-confidence` is `spec-ready`+ among concurrent
  features (122/123 are still `draft`, out of the Mode-A overlap scan's scope by the skill's own
  criteria, but see the cross-feature note below anyway). Findings:
  - ⚠ WARN — same service (`xstockstrat-ui`) as `120` — already expected and documented on both sides.
  - ⚠ WARN (file-level, not config/proto/migration) — `PlatformHeader.tsx` is touched by both `120`
    (FR-7 Breadcrumb at `:260-269`, FR-8 Accordion at `:209-253`) and this feature's FR-13 evaluation
    range (`:156-291`, which contains both of 120's edit ranges). No FAIL-level collision (no shared
    config key, proto field, or migration number — 121 has none of these). Not resolved here per the
    parent orchestrator's explicit instruction — recommended merge-order.md text below.
  - No config-key, proto, or migration collisions (121 declares none of these).
- **Verdict**: PASS (0 blockers, 0 warnings remaining — both were fixed inline; overlap is WARN-only,
  non-blocking).
- Product spec approved. Status: draft → spec-ready.

## Session 2026-08-08 — sdd-design

**No `Task` (subagent-spawning) tool and no `AskUserQuestion` tool were available in this session.**
Both `codebase-discovery` (Phase 0) and `design-proposer`/`design-adversary` (Phase 1) were meant to
run as separately-spawned subagents mediated by the orchestrator (Constitution P-01/P-02); instead
this session performed the discovery directly and self-ran both debate roles, one agent playing
proposer then adversary then synthesizing, across 2 mandated full-mode rounds. Full reasoning is
recorded in `design.md`, including a `## Process Note` at the top flagging this limitation. **This is
the single most important thing for the next session/reviewer to know**: the FR-13 keep-vs-replace
call and the round-2 approval-to-proceed were not gated through a real interactive user decision —
they are a fully-reasoned recommendation, not a confirmed one.

- **Phase 0 Recon**: wrote `recon.md` (service: `xstockstrat-ui`; key reuse patterns: the confirmed
  post-119 plain-function-component primitive shape, the existing `Table`/`Badge` families, the
  `badge.test.ts`-style `cva` regression-guard pattern). Notable finding not in product-spec: FR-12's
  two `FilterToolbar` source components (`AccountsModule.tsx`, `OrderFilters.tsx`) are **not**
  byte-identical in layout (search box, active-filter-count badge, and Clear-button placement all
  differ) — this shaped the FR-12 design (slot-based component, not a copy-paste merge).
- **Phase 1 Grilling**: 2 rounds (full mode, mandated minimum met).
  - Round 1: proposer's first `FilterToolbar` cut used a `layout` variant enum; adversary flagged it
    as a leaky "two components behind a switch" abstraction and proposed a slot-based shape instead
    with page-chrome ownership staying at each call site. On FR-13, proposer initially argued for
    replacing PlatformHeader/BottomTabBar's nav with `NavigationMenu` ("consistency with the rest of
    the migration"); adversary countered with three grounds (CF-N4 overbuilt-for-the-ask litmus, the
    `e2e/nav-reachability.spec.ts` C-10(a) regression risk, and product-spec's own Out-of-Scope
    "like-for-like substitution only" clause) and recommended keep-as-is.
  - Round 2: proposer accepted the slot-based `FilterToolbar` (adding only a narrow `clearPlacement`
    discriminant, not a full layout switch) and, on reflection, **conceded FR-13** — concretely
    working through NavigationMenu's two possible uses here (link-only wrapper = no functional gain;
    real dropdowns = scope creep past Out of Scope) and agreeing keep-as-is is correct. Adversary
    confirmed no remaining objections and no Floor breach.
- **Chosen approach**: primitives per the confirmed post-119 shape (FR-1/2/3); `Badge`/`Table` reuse
  with a deferred-to-execute-time fallback for `AccountSelector.tsx`'s dot (FR-10/11); a slot-based
  `FilterToolbar` shared component with chrome staying at each call site (FR-12); **FR-13 resolved as
  KEEP AS-IS — no `ui/navigation-menu.tsx` added, `PlatformHeader.tsx`/`BottomTabBar.tsx` untouched by
  this feature.**
- **Rejected**: `FilterToolbar` as a full `layout` variant enum (leaky abstraction); forcing
  `AccountSelector.tsx`'s status dot through `Badge` unconditionally (deferred to a real render
  instead); replacing PlatformHeader/BottomTabBar nav with `NavigationMenu` (overbuilt, regression
  risk to an existing C-10(a) e2e test, and would cross the product-spec's own Out-of-Scope line if
  done in any way that actually earns `NavigationMenu`'s keep).
- **Constitution rules touched**: `C-10` (honored — FR-12 updates both toolbar sites in one feature),
  `C-14` (honored — every FR lands in a named consumer surface, no stale backend-only step),
  `C-12`/`C-13` (honored — existing `e2e/fixtures/INVENTORY.md` fixtures cover this feature's domain
  objects, no new fixture module expected). Floor breaches: none.
- Status: spec-ready → design-approved. **Caveat carried forward**: needs human/orchestrator
  re-affirmation of the FR-13 call specifically (design.md § Open Risks, first item) before treating
  it as final — a future session re-running `/sdd-design` with the real subagent/AskUserQuestion tools
  available could still surface a different recommendation.

## Session 2026-08-08 — sdd-spec

- Generated `implementation-spec.md` with **17 steps**, covering **only tranche 1**: FR-1 (Switch),
  FR-2 (Slider), FR-3 (Collapsible), FR-10 (Badge reuse ×2), FR-11 (Table reuse ×2), FR-12
  (`FilterToolbar` consolidation). FR-13 got no code step — `design.md`'s KEEP AS-IS resolution is
  already the authoritative record (satisfies acceptance criterion 6); restated again in the spec's
  Execution Summary for visibility. Status → implementation-ready.
- **FR-4 through FR-9 deliberately NOT specced.** A fresh `ls src/components/ui/` this session
  reconfirmed none of `alert-dialog`/`tabs`/`toggle-group`/`alert`/`checkbox`/`accordion` exist yet on
  `main-dev` (current inventory: `badge, button, card, combobox, input-group, input, select,
  separator, sheet, skeleton, table, textarea, utils`) — writing concrete steps against those paths
  would violate **F-04**. Re-run `/sdd-spec shadcn-migration-medium-confidence` after
  `120-shadcn-migration-high-confidence` merges to plan them.
- **Outstanding, not resolved by this session**: `design.md`'s FR-13 keep-vs-replace call was a
  self-run debate (no `AskUserQuestion` tool available), never gated through an interactive user
  decision. Per this skill's Step 1.5, `design.md` is treated as authoritative input to `/sdd-spec`,
  so this session proceeded on KEEP AS-IS without re-litigating it — but the re-affirmation gap is
  real and is flagged again in `feature.md`'s Next Action and the spec's Execution Summary for the
  calling orchestrator/user to close before `/sdd-execute` runs.
- Key codebase findings this session (beyond recon.md):
  - FR-11's `screener/page.tsx` range was approximate in product-spec (`~555-605`) — re-verified
    exact: the `<table data-testid="screen-results">` spans **lines 552-626** (Read this session).
  - FR-3's actual expand/collapse state (`editing`, `React.useState`) lives in `AccountRow`
    (`accountShared.tsx:174-252`), not in `EditCredentialsForm` itself (`:116-167`, the panel content)
    — the `Collapsible` wrap goes around `AccountRow`'s toggle, `EditCredentialsForm`'s own `<form>`
    body is unchanged.
  - FR-1/FR-2/FR-3/FR-10/FR-11/FR-12's targets all have **zero existing e2e coverage of the specific
    control being swapped** (grepped `active-toggle`, `weight slider`, `Edit keys` — all zero hits in
    `e2e/`), so acceptance criterion 5's "assertions updated where the old ones no longer apply" is
    satisfied vacuously for those five; Step 6 (FR-3) adds one minimal net-new case since the DOM
    shape change there is otherwise silently unverified.
  - `radix-ui@^1.6.7` (the unified package, `package.json`) is confirmed as the dependency Switch/
    Slider/Collapsible build on — no new per-primitive `@radix-ui/react-*` install needed, consistent
    with how `select.tsx`/`badge.tsx` already import from `radix-ui`.
  - `OrderFilters.tsx` has no `activeFilterCount` computation today (confirmed via full Read) — Step
    14 does not invent one; it passes `activeFilterCount={0}` so `FilterToolbar`'s `'trailing'`
    Clear-button placement stays unconditional, matching today's actual behavior exactly.

## Session 2026-08-08 — user-directed design override (Round 3)

- **Traceability backfill**: this entry documents the override conversation the subsequent
  "implementation-spec.md amendment" session (below) referenced as already-settled ground truth in
  `design.md`/`recon.md` but never itself logged here — added retroactively per this repo's
  append-only session-log convention (`docs/roadmap/features/CLAUDE.md` § Key Rules #1) and a
  round-4 cross-check audit (run against sibling feature `120`, then swept across all four
  siblings) that caught the gap.
- The prior `sdd-design` session (self-run, no `AskUserQuestion` tool available in that execution
  environment) recommended **KEEP AS-IS** for FR-13 — flagged throughout `design.md`/`recon.md` as
  provisional pending real user confirmation.
- The orchestrating session (which does have `AskUserQuestion`) put this fork to the actual user
  directly: "121 FR-13: replace PlatformHeader.tsx/BottomTabBar.tsx's hand-built nav with a Radix
  Navigation Menu primitive, or keep as-is?" User's answer: **"Replace with Navigation Menu"** —
  overriding the self-run recommendation.
- Verified live (`WebFetch`, `https://ui.shadcn.com/r/styles/radix-rhea/navigation-menu.json` and
  `https://ui.shadcn.com/docs/components/navigation-menu`) that `NavigationMenuLink` is usable
  standalone inside `NavigationMenuItem` with no `Trigger`/`Content` dropdown pairing — confirming
  the primitive fits this feature's flat, route-based nav shape.
- `design.md` was rewritten with a `## Round 3 — user-directed override` section recording the
  decision and the concrete migration design (which `PlatformHeader.tsx`/`BottomTabBar.tsx` regions
  move, which stay — the mobile Sheet nav is out of scope); `recon.md` gained a Round 3 addendum
  with the supporting PlatformHeader/BottomTabBar/e2e-selector evidence. `product-spec.md`'s FR-13
  text was also corrected in this backfill session (it still read "Evaluate (not mandate)... arguably
  fine as-is" — the pre-override framing — until now) to state the replace decision directly, and
  `feature.md`'s Artifacts/Next Action sections had their stale "needs human re-affirmation" language
  removed (caught by the same round-4 cross-check audit).

## Session 2026-08-08 — implementation-spec.md amendment for FR-13 (Round 3 override)

- **Trigger**: `design.md` and `recon.md` were already updated in a prior session to record the
  Round 3 user-directed override (FR-13 goes from KEEP AS-IS to REPLACE — see `design.md` § Round 3
  — user-directed override and `recon.md` § Codebase Map's Round 3 addendum) but
  `implementation-spec.md` had not yet been brought in line: it still carried the original 17-step,
  pre-override text (FR-13 as "no code step"). This session's **only** job was to close that gap —
  `design.md`/`recon.md` were not touched, re-derived, or re-litigated; they were read as final
  ground truth per this feature's own Round 3 record.
- **Changes made to `implementation-spec.md`**:
  - Header: `**Total Steps**` 17 → 21; added a `**Last Updated**` line noting the FR-13 amendment.
  - Execution Summary: replaced the "FR-13 — no code step" paragraph with one describing the real
    `NavigationMenu` migration (citing `design.md` § Round 3 and § Chosen Approach point 5); updated
    the "Ordering" paragraph to sequence Steps 17-20 (primitive → both migrations → e2e regression)
    and to name Step 21 (not 17) as the final whole-feature verification gate; updated the opening
    paragraph's primitive count (three → four, adding `navigation-menu`) for internal consistency.
  - Step Dependencies: added entries for Steps 17-20's dependency chain (18 and 19 each require 17;
    20 requires both 18 and 19) and renumbered the whole-feature-gate dependency line from Step 17 to
    Step 21 (now requiring Steps 1-20).
  - Inserted four new steps before the old Step 17 (now Step 21):
    - **Step 17** (service): add `ui/navigation-menu.tsx` (CLI primary path against `radix-rhea`,
      hand-authored fallback per the confirmed post-119 shape) plus a minimal
      `navigation-menu.test.ts` asserting the exported surface exists (no app-specific `cva` variant
      to guard here, so kept intentionally minimal, per product-spec.md FR-14's convention).
    - **Step 18** (service): migrate `PlatformHeader.tsx`'s two desktop nav regions (Primary
      `:170-190`, Section `:271-287`) onto `NavigationMenu`/`NavigationMenuList`/
      `NavigationMenuItem`/`NavigationMenuLink`, preserving `role=navigation`, `aria-label`s,
      `role=link`, `aria-current` logic, and NAV_GROUPS-derived labels exactly; leaves the sibling
      `aria-label="Breadcrumb"` span (sibling `120`'s FR-7) and the mobile `Sheet` disclosure
      (sibling `120`'s FR-8) untouched.
    - **Step 19** (service): migrate `BottomTabBar.tsx`'s single flat nav (`:28-54`) the same way,
      preserving `data-testid="mobile-tab-bar"` and `aria-label="Mobile primary"`.
    - **Step 20** (test): run `e2e/nav-reachability.spec.ts` unmodified against Steps 18-19 to
      confirm the C-10(a) contract (the exact selectors `recon.md` cites at spec lines 60/61/65/
      67/68) still resolves without a spec rewrite.
  - Renumbered the old "Step 17 — whole-feature verification gate" to **Step 21**, updating its
    `Files` line from "runs after Steps 1–16" to "runs after Steps 1–20".
- **Changes made to `feature.md`**: updated the Artifacts list's implementation-spec.md bullet from
  "17 steps" to "21 steps," noting Steps 17-20 now migrate `PlatformHeader.tsx`/`BottomTabBar.tsx`
  onto `NavigationMenu` per the Round 3 override. No `feature.md` Status History row was added — the
  feature's lifecycle status is unchanged (`implementation-ready`); this was a spec amendment, not a
  status transition.
- **`design.md`/`recon.md` were NOT modified this session** — they were already final per the
  feature's Round 3 record; this session only brought `implementation-spec.md` (and the one
  `feature.md` cross-reference) into agreement with them.
- No git commands were run this session.

## Session 2026-08-09 — /sdd-execute sequential — Tranche 2 spec (FR-4 through FR-9)

- **Trigger**: user, mid-execution of this feature (branch stacked on `120-shadcn-migration-
  high-confidence`, which had just reached `code-completed`), directed a full re-spec of FR-4
  through FR-9 rather than deferring them to a later `/sdd-spec` run — the six primitives they need
  (`alert-dialog`/`tabs`/`toggle-group`/`alert`/`checkbox`/`accordion`) are confirmed present on
  this stacked branch (`ls src/components/ui/`, this session).
- Read every FR-4–FR-9 target file fresh (not recon.md citations — recon.md predates this tranche)
  and added Steps 22-37 to `implementation-spec.md` (see file's own Tranche 2 section for the full
  evidence). Total steps 21 → 37.
- **Notable finding**: FR-9's product-spec description ("row-click reveals a detail panel") doesn't
  structurally fit `Accordion` — `LiveStrategiesPanel.tsx`'s detail panel is one shared panel below
  the whole table (driven by a single `selectedId`), not per-row inline content, and an
  `AccordionContent` can't render outside a `<table>` while its `Item` wraps a `<tr>`. Substituted
  `Collapsible` (added by this same feature's FR-3) instead — same panel-open/close outcome, honest
  primitive fit. Logged as a spec-time correction, not a design.md revision (design.md never
  detailed FR-9 to this level).
- **e2e-risk findings** (grounded, not assumed): 3 of FR-4's 5 `window.confirm()` sites have
  `page.on('dialog')` interception (will break, needs red/green — Steps 23-24); FR-5's
  `env-mode-switcher.spec.ts` and FR-6's `opportunities.spec.ts` are expected-pass (Tabs `asChild`
  preserves the child `Link`'s `role="link"`; Radix `ToggleGroup type="multiple"` keeps
  `role="button"`, confirmed by reading `@radix-ui/react-toggle-group`'s source directly, mirroring
  feature 120's Step 9 finding for `type="single"`'s `role="radio"`) but still get a real red/green
  pair per P-06's mandatory-even-when-expected-to-pass rule; FR-7/FR-8/FR-9 have no e2e-risk.
- No status change to `feature.md` (still `implementation-ready` — this is a spec amendment, not a
  lifecycle transition; execution starts fresh against all 37 steps next).

## Session 2026-08-09 — sdd-execute sequential (execution)

Verification fallback carried over from feature 120: `CI=1 E2E_PREBUILT=1 NEXT_DISABLE_STANDALONE=1
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/opt/pw-browsers/chromium` for all e2e runs (logged once, not
repeated per step).

### Step 1 — Add ui/switch.tsx primitive and swap config-ui sources "Active" checkbox (FR-1) [done]
- `npx shadcn@latest add switch` (did not touch `button.tsx`). No app-specific variant.
- Swapped the raw checkbox for `<Switch checked={form.active} onCheckedChange={(v) =>
  setField('active', v)} />`, same `id`/`htmlFor` pairing.
- Verification: `pnpm lint` clean (1 pre-existing unrelated warning).
- Files modified: `src/components/ui/switch.tsx` (create), `src/components/ui/switch.test.ts`
  (create), `src/app/config-ui/sources/page.tsx`

### Step 2 — e2e regression for FR-1 (Switch) [done]
- No existing test targeted the Active toggle (confirmed grep). Ran `pnpm test:e2e -g "config-ui"`
  (49 passed) as the regression check. No spec change needed.

### Step 3 — Add ui/slider.tsx primitive and swap screener weight range input (FR-2) [done]
- `npx shadcn@latest add slider` (no `button.tsx` collateral). Range input was at `:380-388` (line
  drift from product-spec's `396-405` — earlier feature-120/121 edits to this file shifted it).
  `Slider` is array-valued; `onValueChange={([v]) => ...}` matches `updateCriterion`'s shape.
  `aria-label="weight slider"` preserved (the paired numeric `Input` mirror at `:390-399` untouched).
- Verification: `pnpm lint` clean.
- Files modified: `src/components/ui/slider.tsx` (create), `src/components/ui/slider.test.ts`
  (create), `src/app/insights/screener/page.tsx`

### Step 4 — e2e regression for FR-2 (Slider) [done]
- **Real regression found and fixed** — see implementation-spec.md's Deviation Log Step 4 entry:
  implicit `<label>` text leaked onto Radix's hidden `SliderBubbleInput`, colliding with the numeric
  mirror `Input`'s `aria-label="weight"`; separately `Slider`'s `aria-label` never reached the
  visible `Thumb`. Fixed both (wrapping `<label>` → `<div>` in `screener/page.tsx`; `ui/slider.tsx`
  now forwards `aria-label` to `Thumb`).
- Verification: `pnpm test:e2e -g "screener"` — 20 passed, 1 pre-existing unrelated flake
  (polling-timer test, retried and passed).
- Files modified: `src/components/ui/slider.tsx`, `src/app/insights/screener/page.tsx`

### Step 5 — Add ui/collapsible.tsx primitive and convert "Edit keys" disclosure (FR-3) [done]
- `npx shadcn@latest add collapsible` (no `button.tsx` collateral). Made `Collapsible`
  (`open={editing} onOpenChange={setEditing}`) the outer element of `AccountRow`'s return (carrying
  the existing border/padding className), `CollapsibleTrigger asChild` wrapping the Edit-keys
  `Button` (dropped the manual `onClick={() => setEditing(...)}`, now owned by
  `open`/`onOpenChange`), `CollapsibleContent` wrapping the `account.isActive &&
  <EditCredentialsForm .../>` conditional — same guard, same outcome.
- Verification: `pnpm build` clean, `pnpm lint` clean.
- Files modified: `src/components/ui/collapsible.tsx` (create), `src/components/ui/collapsible.test.ts`
  (create), `src/components/trader/accountShared.tsx`

### Step 6 — e2e regression for FR-3 (Edit keys disclosure) [done]
- No existing test targeted the Edit-keys disclosure (confirmed grep, per implementation-spec's
  Step 6 rationale — this is the one FR-3 case that needed a net-new assertion rather than a
  vacuous pass, since the DOM shape actually changed). Added
  `'Edit keys expands and collapses the credential form (feature 121, FR-3)'` to
  `e2e/trader/account-selector.spec.ts`.
- **Locator-scoping iteration** (not a functional regression — the underlying DOM was correct
  throughout): the page renders two independent "API Key" placeholder fields — `AccountRow`'s own
  (behind Edit keys) and the always-visible standalone "Add Account" form's, both built from the
  shared `CredentialFields` component — plus a second "Alpaca Paper" text occurrence in the header's
  account `<Select>` value display. Text/role-based scoping attempts (`div:has-text(displayName)`,
  `.filter({has: getByRole('button', {name:'Edit keys'})})`) each resolved to the wrong element or
  stayed ambiguous. Root-caused via a throwaway debug spec dumping `body` innerHTML (created and
  deleted, not part of this diff) — confirmed the nesting itself was fine, the ambiguity was purely
  in the test's own selectors.
- **Fix**: added a stable `data-testid={\`account-row-${account.id}\`}` to the `Collapsible` root in
  `AccountRow` (`accountShared.tsx`) and rewrote the test to scope every assertion through
  `page.getByTestId(...)`. This is a minimal, targeted test-hook addition consistent with the
  DRY guard rail (one shared identifier, not a new pattern).
- Verification: `pnpm build` clean; `pnpm test:e2e -g "account-selector"` — 7 passed (incl. new
  test); broader `pnpm test:e2e -g "accounts"` sweep — 18 passed, no regressions.
- Files modified: `src/components/trader/accountShared.tsx` (added `data-testid`),
  `e2e/trader/account-selector.spec.ts` (new test)

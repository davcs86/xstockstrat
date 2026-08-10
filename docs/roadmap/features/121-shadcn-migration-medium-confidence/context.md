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

### Step 7 — Route AlertStream.tsx's unread-count pill through Badge (FR-10) [done]
- Replaced the hand-rolled `<span>` (lines 50-57) with `<Badge variant={hasHighSeverity ?
  'destructive' : 'default'} className="absolute -top-1 -right-1 h-4 min-w-4 justify-center px-1
  text-[10px]">{unread > 9 ? '9+' : unread}</Badge>` per spec, same positioning/sizing overrides
  via `className`.
- Verification: `pnpm lint` clean.
- Files modified: `src/components/trader/AlertStream.tsx`

### Step 8 — Resolve AccountSelector.tsx's status dot — Badge or documented exception (FR-10) [done]
- Evaluated per `design.md` §2's deferred call: `badge.tsx`'s `destructive` variant is
  `bg-destructive/10 text-destructive` (translucent, sized for padded text — `h-5 w-fit ... rounded-2xl
  px-2 py-0.5`), not a solid 2px dot. Reproducing the current solid `bg-destructive` dot would need a
  larger override set (`h-2 w-2 min-w-0 rounded-full p-0 border-0 bg-destructive`, ~9 classes) than the
  existing 6-class hand-rolled span — **hand-rolled span kept**, per Step 8's explicit fallback
  criterion. Added the one-line `// no clean shadcn-primitive fit ...` comment pointing at design.md §2.
- Verification: `pnpm lint` clean.
- Files modified: `src/components/trader/AccountSelector.tsx` (comment only, markup unchanged)

### Step 9 — e2e regression for FR-10 (AlertStream + AccountSelector badges) [done]
- `account-selector.spec.ts`: no locator changes needed (Step 8 left `AccountSelector.tsx`'s markup
  unchanged).
- `alert-stream.spec.ts`: one real fix — `'high-severity alerts use destructive badge colour'` used a
  class-based locator (`page.locator('span.bg-destructive')`) that broke once the pill became a
  `Badge` (whose `destructive` variant renders `bg-destructive/10`, not the literal `bg-destructive`
  class the old hand-rolled span had). Rewrote to `page.locator('span[data-slot="badge"]
  [data-variant="destructive"]')`, scoping on Badge's own semantic attributes instead of a
  transitional utility class.
- Verification: `pnpm build` clean; `pnpm test:e2e -- e2e/trader/alert-stream.spec.ts
  e2e/trader/account-selector.spec.ts` — 12 passed.
- Files modified: `e2e/trader/alert-stream.spec.ts`

### Step 10 — Route strategies/[id]/page.tsx's Past Runs table through ui/table.tsx (FR-11) [done]
- Imported `Table/TableHeader/TableBody/TableRow/TableHead/TableCell`; swapped the raw
  `<table>/<thead>/<tbody>` for the primitive equivalents, carrying every existing prop verbatim on
  the body row (`data-testid="past-run-row"`, `role="button"`, `tabIndex`, `aria-selected`, `onClick`,
  `onKeyDown`, `cn(...)` className) and every cell's className.
- **Deviation from the step's literal instructions (not scope creep — same fix Step 11 explicitly
  mandates for the sibling table)**: dropped the manual `<div className="overflow-x-auto">` wrapper.
  `Table` already renders its own `data-slot="table-container"` div with `overflow-x-auto`
  (`table.tsx:9`), so keeping the outer div would double-wrap the same scroll behavior — the same
  CF-N4 redundancy Step 11's own Codebase Evidence calls out for `screener/page.tsx`. Applied here for
  consistency since the same primitive produces the same wrapper either way.
- Verification: `pnpm lint` clean; `grep "<table\b"` → none remain.
- Files modified: `src/app/insights/strategies/[id]/page.tsx`

### Step 11 — Route screener/page.tsx's results grid through ui/table.tsx (FR-11) [done]
- Same primitive swap; reused the single `ui/table` import line per the step's instruction. Dropped
  the manual `<div className="w-full overflow-x-auto">` wrapper as directed (Table's own container
  div supersedes it) — the "Wide table → scroll horizontally" comment above it still applies verbatim
  since `Table` still provides that behavior, just via its own wrapper now.
- Verification: `pnpm lint` clean; `grep "<table\b"` → none remain;
  `data-testid="screen-results"` preserved on `Table`.
- Files modified: `src/app/insights/screener/page.tsx`

### Step 12 — e2e regression for FR-11 (Past Runs + screener results tables) [done]
- No locator changes needed — both specs assert via `data-testid`/role/text, all forwarded unchanged
  through `Table`'s prop passthrough, per the step's own evidence.
- Verification: `pnpm build` clean; `pnpm test:e2e -- e2e/insights/backtest-coverage.spec.ts
  e2e/insights/screener.spec.ts` — 30 passed, including the phone-frame no-overflow test (confirms
  the wrapper-div removal didn't regress horizontal scroll containment).
- Files modified: none (verification-only, as specced)

### Step 13 — Create shared FilterToolbar.tsx (FR-12) [done]
- Slot-based component per design.md §4's approved shape: optional `search`, `filters` array
  (rendered as `ui/select.tsx` `Select`s), optional `dateRange`, `activeFilterCount`, `onClear`,
  `clearPlacement: 'inline' | 'trailing'`.
- **One addition beyond the spec's literal prop list**: added an optional `className` per `filters`
  entry, needed to preserve `AccountsModule.tsx`'s three distinct per-select widths
  (`w-[110px]`/`w-[110px]`/`w-[120px]`) — the spec's `{value,onValueChange,options,ariaLabel}` shape
  had no width slot, and dropping the widths would not be a like-for-like substitution. Optional, so
  `OrderFilters.tsx`'s three selects (which had no fixed width) simply omit it.
- **Lint fix**: `activeFilterCount` is part of the approved props surface (design.md §4) but neither
  current `clearPlacement` mode reads it internally — `'inline'` callers own their own count/Clear-
  button entirely outside `FilterToolbar` (`AccountsModule.tsx`'s `CardHeader`), and `'trailing'`
  renders unconditionally (matching today's `OrderFilters.tsx` behavior, no gating). Left it in the
  TS interface (callers must still pass it) but did not destructure it in the function body, with a
  comment explaining why — avoids a real `@typescript-eslint/no-unused-vars` error without dropping
  the design-approved prop.
- Verification: `pnpm lint` clean (after the above fix); `test -f` + `grep "export function
  FilterToolbar"` both pass.
- Files created: `src/components/shared/FilterToolbar.tsx`

### Step 14 — Wire AccountsModule.tsx and OrderFilters.tsx to FilterToolbar (FR-12) [done]
- `AccountsModule.tsx`: replaced the inline toolbar `<div>` with `<FilterToolbar search={...}
  filters={[broker, state, status]} activeFilterCount={activeFilterCount} onClear={...}
  clearPlacement="inline" />`; the `CardHeader` count/Clear-button block was left untouched (already
  `'inline'`-shaped). Dropped now-unused `Input`/`Select*`/`Search` imports.
- `OrderFilters.tsx`: symbol stayed a sibling `Input` inside the retained `grid` div (free text, does
  not fit `filters`' Select-shaped prop, per the step's own fallback instruction) alongside a single
  `<FilterToolbar filters={[side, orderType, status]} dateRange={...} activeFilterCount={0}
  onClear={reset} clearPlacement="trailing" />`. Dropped now-unused `Button`/`Select*` imports.
- **Known, spec-mandated layout change** (not a defect): `FilterToolbar`'s own root is a
  `flex flex-wrap` row (Step 13's instruction, design.md §4 — "not a grid"), so inside
  `OrderFilters.tsx`'s 3-column grid the 5 side/type/status/from/to controls now render as one grid
  cell (wrapping internally) rather than 5 separate grid cells each getting their own column
  placement. This is the documented outcome of "OrderFilters.tsx's grid layout stays owned by that
  call site around FilterToolbar" — recording it here since it's a real (if minor) visual reflow, not
  because it's a bug.
- Verification: `pnpm lint` clean; `grep -c "SelectTrigger"` → 0 in both files (all Selects now
  render inside `FilterToolbar`).
- Files modified: `src/components/trader/AccountsModule.tsx`, `src/components/trader/OrderFilters.tsx`

### Step 15 — Broker/order-type/order-status coverage note for FR-12 [done]
- Verification-only, no code change. Re-confirmed post-Step-14: `AccountsModule.tsx` still carries
  both `BrokerType.ALPACA`/`BrokerType.IBKR`; `OrderFilters.tsx` still carries all 5 `PbOrderType`
  values and all 7 `PbOrderStatus` values, all now surfaced through `FilterToolbar`'s `options` arrays
  rather than inline `SelectItem`s but with zero enum values dropped, added, or reordered.
- Files modified: none

### Step 16 — e2e regression for FR-12 (FilterToolbar in AccountsModule + OrderFilters) [done]
- No locator changes needed — both specs assert via accessible label/role/text
  (`getByLabel`/`getByRole`), all of which pass straight through `FilterToolbar`'s `ariaLabel`/
  `dateRange` props unchanged.
- Verification: `pnpm build` clean; `pnpm test:e2e -- e2e/trader/account-selector.spec.ts
  e2e/trader/orders.spec.ts` — 13 passed, including order-type/order-status-dependent tests
  (`create form offers all 5 order types...`, `PENDING_APPROVAL is surfaced...`).
- Files modified: none (verification-only, as specced)

### Step 17 — Add ui/navigation-menu.tsx primitive (FR-13) [done]
- `npx shadcn@latest add navigation-menu --yes --overwrite` succeeded, no collateral damage
  (`git status --short` confirmed only the new file). Reformatted with `prettier --write` to match
  repo convention (CLI output uses double quotes/no semicolons). No `forwardRef`/`displayName`,
  confirmed post-119 shape. `@tabler/icons-react` (used by the generated `NavigationMenuTrigger`'s
  chevron) was already a dependency (`package.json:35`) — no new install needed.
- **Real finding, resolves the step's own flagged unknown**: `design.md`/`recon.md` assumed
  `NavigationMenuLink` takes a `render={<Link .../>}` prop (the Base UI/newer-radix-ui pattern this
  codebase's `combobox.tsx` uses). Verified directly against the installed package this session:
  `radix-ui@1.6.7`'s `navigation-menu.mjs` is a 3-line re-export of `@radix-ui/react-navigation-menu`
  (`export * from "@radix-ui/react-navigation-menu"`), and that package (`@1.2.22`) is the **classic**
  Radix Primitives API — `grep -c render` on its `index.mjs` → 0 hits; `NavigationMenuLink` is built
  with `React.forwardRef` and re-exported as `Link` (`index.mjs:372,804`). It supports `asChild`, not
  `render`. Steps 18-19 use `<NavigationMenuLink asChild>` wrapping a plain `<Link>`, not the
  `render={<Link .../>}` shape design.md assumed. Documented inline in `PlatformHeader.tsx` with a
  comment pointing here.
- Verification: `pnpm vitest run src/components/ui/navigation-menu.test.ts` — 2 passed; `pnpm lint`
  clean.
- Files created: `src/components/ui/navigation-menu.tsx`, `src/components/ui/navigation-menu.test.ts`

### Step 18 — Migrate PlatformHeader.tsx's two desktop nav regions onto NavigationMenu (FR-13) [done]
- Row-1 Primary and Row-2 Section `<nav>` blocks both swapped for
  `NavigationMenu`/`NavigationMenuList`/`NavigationMenuItem`/`NavigationMenuLink asChild` wrapping a
  `Link`, preserving `aria-current` and every existing `cn(...)` active/inactive class verbatim (Slot
  cloning via `asChild` forwards `aria-current`/`className` onto the rendered `<a>` exactly as the
  original direct-`Link` markup did). `aria-label="Breadcrumb"` span (sibling `120`'s FR-7) and the
  mobile `Sheet` (sibling `120`'s FR-8) both untouched.
- **Deviation (visual-fidelity fix, not spec-mandated, not scope creep)**: added `className="gap-1"`
  to both `NavigationMenuList`s. The step's instructions put `gap-1` on the outer `NavigationMenu`
  wrapper (matching the original `<nav className="... gap-1">"`), but `NavigationMenu`'s only child is
  `NavigationMenuList` — the actual `<ul>`/`<li>` item spacing is governed by `NavigationMenuList`'s
  own default (`gap-0`, `navigation-menu.tsx:39`), so the outer `gap-1` alone would not reproduce the
  original inter-link spacing. Added `gap-1` directly to `NavigationMenuList` to close that gap.
- Verification: `pnpm lint` clean; all 3 `aria-label` grep checks pass (Primary/Section present,
  Breadcrumb untouched).
- Files modified: `src/components/shared/PlatformHeader.tsx`

### Step 19 — Migrate BottomTabBar.tsx's flat nav onto NavigationMenu (FR-13) [done]
- Same `NavigationMenu`/`NavigationMenuList`/`NavigationMenuItem`/`NavigationMenuLink asChild`
  pattern; `flex-1` moved from the `Link` onto `NavigationMenuItem` per the step's instructions (the
  four tabs now split width via the `<li>`, not the anchor).
- **Deviation (functional fix, not spec-mandated)**: `ui/navigation-menu.tsx`'s `NavigationMenu` root
  defaults to `max-w-max` (content-sized). This bar is `fixed inset-x-0 bottom-0` — with a
  content-capped max-width it would not span edge-to-edge on wider phone viewports (unlike
  `PlatformHeader.tsx`'s two navs, where a sibling `ml-auto`/normal-flow layout absorbs the same
  default harmlessly). Added `max-w-none` to the passed `className` to override it, with an inline
  comment explaining why. Verified via `e2e/mobile.spec.ts`'s "bottom tab bar is visible with four
  ≥44px targets" test (Step 20's sweep) — confirms the bar still spans and tap targets are correct.
- Verification: `pnpm lint` clean; `data-testid`/`aria-label` grep checks pass.
- Files modified: `src/components/mobile/BottomTabBar.tsx`

### Step 20 — e2e regression for FR-13 (nav-reachability.spec.ts) [done]
- No locator changes needed. `pnpm build` initially produced a truncated `.next` (background-process
  interruption unrelated to the code change — a `next build` run was killed mid-way by an earlier
  container/session hiccup this session had seen before; a clean `rm -rf .next` + rebuild fixed it,
  confirmed via a present `.next/BUILD_ID`).
- Verification: `pnpm test:e2e -- e2e/nav-reachability.spec.ts` — 2 passed (the full C-10(a) walk).
  Extra regression sweep beyond the step's own scope, given this touches the shared shell on every
  route: `pnpm test:e2e -- e2e/mobile.spec.ts e2e/insights/backfills.spec.ts` (both reference nav
  landmarks) — 10 passed, no regressions.
- Files modified: none (verification-only, as specced)

### Step 21 — Whole-feature verification gate (tranche 1, acceptance criterion 5) [done]
- `pnpm lint` clean (same one pre-existing unrelated warning as every prior step).
- `pnpm build` clean.
- `pnpm test:e2e` (full suite, no filter): two false-start failures before the real result, both
  environmental (stray leftover processes from earlier steps' background/foreground build-and-test
  cycles this session, not code defects): (1) `EADDRINUSE 127.0.0.1:3000` — a `next start` from a
  prior background verification hadn't been reaped; killed the stray `pnpm start`/`next-server`
  processes (`ss -ltnp`/`ps aux` located PIDs 22459/22494/22495). (2) `EADDRINUSE 127.0.0.1:9091` —
  the mock gRPC backend's port, self-resolved (no listener found on retry) between attempts. Third
  run, clean ports confirmed via `ss -ltn` beforehand: **256 passed, 0 failed** (2.6m).
- All 20 tranche-1 steps (FR-1/2/3/10/11/12/13) verified together with zero cross-step interaction
  failures — the mandated whole-feature gate before tranche 2 starts.
- Files modified: none (verification-only, as specced)

## Tranche 2 (FR-4 through FR-9) execution

### Step 22 — Wire Alert Dialog to the five window.confirm() sites (FR-4) [done]
- All 5 sites converted to the established `AlertDialog`/`AlertDialogTrigger asChild`/
  `AlertDialogContent`/`AlertDialogDescription`/`AlertDialogCancel`/`AlertDialogAction` pattern
  (same shape as feature 120 Step 14 and this feature's own Step 5 `accountShared.tsx` usage — no
  `Header`/`Footer`, description + Cancel + Action directly): `WatchlistDetail.tsx` delete,
  `FormulaWorkspace.tsx` delete, `strategies/page.tsx`'s `StrategyRow` deactivate,
  `backfills/page.tsx` cancel, `authorized-apps/page.tsx` disconnect. Each page-level handler had its
  `window.confirm(...) ... return;` guard stripped, leaving only the mutation call.
- `WatchlistDetail.tsx`'s `onDelete` prop signature simplified from `(watchlistId, name) => void` to
  `(watchlistId) => void` — the dialog now owns the confirm message (using `watchlist.name` directly
  from the component's own props), so the page no longer needs `name` threaded through just to build
  a confirm string.
- Verification: `grep -rn "window.confirm"` across all 7 touched files → zero hits; `pnpm build` —
  compiled successfully, zero type errors; `pnpm lint` clean.
- Files modified: `src/components/insights/WatchlistDetail.tsx`,
  `src/app/insights/watchlists/page.tsx`, `src/components/insights/FormulaWorkspace.tsx`,
  `src/app/insights/formulas/[id]/page.tsx`, `src/app/insights/strategies/page.tsx`,
  `src/app/insights/backfills/page.tsx`, `src/app/accounts/authorized-apps/page.tsx`

### Step 23 — red run for the 3 e2e-covered FR-4 sites [done]
- Ran `authorized-apps.spec.ts`/`backfills.spec.ts`/`watchlists.spec.ts` unmodified against Step 22.
  **3 failed, exactly as predicted**: each `page.on('dialog', d => d.accept())` site's click now only
  opens the `AlertDialog` (no browser-native dialog to auto-accept), so the mutation never fires and
  the post-action assertion times out. Recorded failure detail:
  - `authorized-apps.spec.ts:66` — `getByText('Claude.ai (E2E)')` expected count 0, got 2 (the row's
    own text plus the now-open dialog's description text, which also names the app).
  - `backfills.spec.ts:144` — `getByText('canceled', {exact:true})` never appears (job stays
    `running`; the Cancel click only opened the dialog).
  - `watchlists.spec.ts:54` — the empty-state text never appears (list never actually deleted).
- Verification: `pnpm test:e2e -g "authorized-apps|backfills|watchlists"` — 3 failed / 21 passed (the
  3 failures are exactly the 3 sites Step 22 flagged, no other regressions).
- Files modified: none (this step only ran the existing specs to record the red state)

### Step 24 — green fix for the 3 e2e-covered FR-4 sites [done]
- All 3 specs updated to the same pattern: click the trigger button → click
  `getByRole('button', {name: 'Confirm'})` → assert the original outcome. Removed the 3
  `page.on('dialog', ...)` registrations (no longer relevant — no native dialog exists).
- **Note for future e2e authors on this feature**: the AlertDialog's trigger button and its own
  `AlertDialogCancel` share the literal label "Cancel" at 2 of these 5 sites
  (`backfills/page.tsx`'s Cancel-the-job button vs. the dialog's own Cancel-the-dialog button). Not
  an actual test-locator collision here (only one "Cancel" exists before the dialog opens, so the
  trigger click is unambiguous; the tests never need to click the dialog's own Cancel), but worth
  flagging for the next spec that touches this site.
- Verification: `pnpm test:e2e -g "authorized-apps|backfills|watchlists"` — **24 passed, 0 failed**
  (red→green pair complete, P-06 satisfied).
- Files modified: `e2e/accounts/authorized-apps.spec.ts`, `e2e/insights/backfills.spec.ts`,
  `e2e/insights/watchlists.spec.ts`

### Step 25 — record the 2 e2e-uncovered FR-4 sites [done]
- No code change (verification-only per spec). The 2 sites without confirm-flow e2e coverage —
  `formulas/[id]/page.tsx` delete and `strategies/page.tsx` deactivate — remain a pre-existing test
  gap (not introduced by this feature; `formulas.spec.ts` only asserts Delete is absent for read-only
  system formulas, and no spec exercises `handleDeactivate`). Their only gate is the `pnpm build`
  type-check already run in Step 22, confirmed here for the acceptance-criterion-5 record.
- Files modified: none

### Step 26 — Wire Tabs to config-ui/page.tsx's EnvModeSwitcher (FR-5) [done, reverted]
- Initial implementation: two `Tabs`/`TabsList`/`TabsTrigger asChild` blocks wrapping the existing
  `Link`s, per the spec's literal code sample. `pnpm build`/`pnpm lint` both clean at that point.
- **Real regression found in Step 27** (see below) — reverted this step's `Tabs` wrapping back to
  the original plain `<Link>`/`<Badge>` markup, keeping only the `Tabs`/`TabsList`/`TabsTrigger`
  import removed. Added an inline comment in `config-ui/page.tsx` explaining why (points here).
- Files modified: `src/app/config-ui/page.tsx`

### Step 27 — e2e regression for FR-5 (EnvModeSwitcher) [done]
- **Ran unmodified against the initial Tabs-wrapped Step 26 — all 4 real assertions failed**
  (`getByRole('link', {name: 'dev'})` etc. — "element(s) not found"). Root cause, confirmed by
  reading the installed package directly (not assumed): `@radix-ui/react-tabs@1.1.21`'s
  `TabsTrigger` hardcodes `role: "tab"` on its own element (`index.mjs:114`) — with `asChild`,
  Radix's Slot merges ALL of `Tabs.Trigger`'s own props onto the child, including that explicit
  `role="tab"`, which **overrides** the child `<Link>`'s implicit `role="link"` (an explicit ARIA
  role attribute always wins over an element's implicit role). This is actually *correct* Tabs
  behavior for a real client-side tab-panel switcher — the mismatch is that `EnvModeSwitcher` isn't
  one: every "tab" click does a full page navigation via the `Link`'s `href` query params, not an
  in-place panel swap. `Tabs`/`TabsTrigger` is a semantically wrong primitive for this control,
  parallel to this same tranche's FR-9 Accordion→Collapsible finding (a structural/primitive-fit
  mismatch discovered by actually exercising the primitive, not by reading its docs).
- Per this step's own instruction ("fix Step 26's markup — do not rewrite the spec's `link` role
  expectations, since the underlying element genuinely is still an anchor tag"), reverted Step 26
  rather than touching the test.
- Verification (after the revert): `pnpm build` clean; `pnpm test:e2e -g
  "EnvModeSwitcher|opportunities|backtest-coverage|Go to Step"` — **28 passed, 0 failed** (bundled
  with Steps 29/31's regressions since they share one test run this session).
- Files modified: none (the fix landed in Step 26's own file)

### Step 28 — Wire Toggle Group to opportunities/page.tsx's source-filter pills (FR-6) [done]
- Replaced the per-item `<button onClick={() => toggleSource(s)}>` loop with `<ToggleGroup
  type="multiple" value={activeSources} onValueChange={setActiveSources}>` wrapping
  `ToggleGroupItem`s, preserving the exact `cn(...)` active/inactive classes per item. Removed the
  now-unused `toggleSource` helper (confirmed via grep it had no other call sites) to avoid an
  unused-var lint error. The "All sources" reset button stayed a plain `Button`, untouched, outside
  the `ToggleGroup` — it clears the array rather than joining it.
- Verification: `pnpm build` clean; `pnpm lint` clean.
- Files modified: `src/app/insights/opportunities/page.tsx`

### Step 29 — e2e regression for FR-6 (opportunities source pills) [done]
- Confirmed empirically (not assumed): `type="multiple"` keeps each `ToggleGroupItem` as a native
  `<button>` with `aria-pressed` (Root gets `role="toolbar"`, not `role="radio"` — that remap is
  `type="single"`-only, per feature 120 Step 9's finding). `getByRole('button', {name: 'marketwatch'})`
  continued to resolve correctly.
- Verification: bundled into Step 27's run — 28 passed, including all 5
  `e2e/insights/opportunities.spec.ts` cases (source-chip filter, snooze/dismiss persistence, etc.).
- Files modified: none

### Step 30 — Wire Alert to BacktestDiagnostics.tsx and StrategyWizard.tsx (FR-7) [done]
- `BacktestDiagnostics.tsx`: `<p data-testid="no-trade-reason" ...>` → `<Alert
  data-testid="no-trade-reason"><AlertDescription>{noTradeMsg}</AlertDescription></Alert>`, variant
  `default` per spec (no destructive/warning tone for a no-trade notice).
- `StrategyWizard.tsx`: the `border-destructive` `<div>` wrapper → `<Alert variant="destructive">`
  wrapping `AlertDescription` + the existing "Go to Step N" `Button`, both unchanged internally.
- Verification: `pnpm build` clean; `pnpm lint` clean.
- Files modified: `src/components/insights/BacktestDiagnostics.tsx`,
  `src/components/insights/StrategyWizard.tsx`

### Step 31 — e2e regression for FR-7 (BacktestDiagnostics + StrategyWizard) [done]
- No locator changes needed — `data-testid` and the inner `Button`'s role both forward through
  `Alert`/`AlertDescription`'s prop spread unchanged.
- Verification: bundled into Step 27's run — all 10 `backtest-coverage.spec.ts` cases and the
  `strategy-authoring.spec.ts` "Go to Step" case passed.
- Files modified: none

### Step 32 — Wire Checkbox to backfills/page.tsx's "Overwrite existing bars" (FR-8) [done]
- `<input type="checkbox" checked={overwrite} onChange={...} />` → `<Checkbox checked={overwrite}
  onCheckedChange={(v) => setOverwrite(v === true)} />` inside the existing `<label>`, same
  normalize-to-boolean pattern as feature 120 Step 24.
- Verification: `pnpm build` clean; `pnpm lint` clean.
- Files modified: `src/app/insights/backfills/page.tsx`

### Step 33 — build-only verification for FR-8 (no e2e coverage exists) [done]
- No code change. `pnpm build` (Step 32's build) is the gate — confirmed clean, recorded here per
  spec.
- Files modified: none

### Step 34 — Wire Collapsible to LiveStrategiesPanel.tsx's detail panel (FR-9) [done]
- `{selectedId && <StrategyAlertFeed strategyId={selectedId} />}` → `<Collapsible
  open={!!selectedId} onOpenChange={(open) => !open && setSelectedId(null)}><CollapsibleContent>
  {selectedId && <StrategyAlertFeed strategyId={selectedId} />}</CollapsibleContent></Collapsible>`
  — same conditional-render outcome, `Collapsible`'s own open/close transition now applies. Uses
  `Collapsible` (added by this feature's own FR-3), not `Accordion`, per this tranche's earlier
  structural-fit finding (Accordion's Item/Content pairing can't wrap a shared below-table panel).
- Verification: `pnpm build` clean; `pnpm lint` clean.
- Files modified: `src/components/trader/LiveStrategiesPanel.tsx`

### Step 35 — build-only verification for FR-9 (no e2e coverage exists) [done]
- No code change. `pnpm build` (Step 34's build) is the gate — confirmed clean, recorded here per
  spec.
- Files modified: none

### Step 36 — Tranche 2 targeted e2e sweep (FR-4 through FR-9 combined) [done]
- Ran the combined grep-pattern set from every tranche-2 step's own verification
  (`authorized-apps|backfills|watchlists|EnvModeSwitcher|opportunities|backtest-coverage|Go to
  Step|formulas|strategies`) together to catch any cross-step interaction.
- Verification: **72 passed, 0 failed** (49.1s).
- Files modified: none

### Step 37 — Whole-feature (Tranche 1 + 2) verification gate [done]
- `pnpm lint` clean (same one pre-existing unrelated warning as every prior step).
- `pnpm test:unit` — **24 test files, 85 tests, all passed** (includes the new
  `navigation-menu.test.ts` from Step 17 alongside every other primitive's regression guard).
- `pnpm build` clean.
- `pnpm test:e2e` (full suite, no filter) — **256 passed, 0 failed** (2.8m). No environmental
  false-starts this run (ports confirmed free via `ss -ltn` before launching, learned from Step 21's
  stray-process issue).
- All 37 steps across both tranches (FR-1 through FR-13) verified together. Feature 121 is
  code-complete.
- Files modified: none (verification-only, as specced)

## Feature summary (post-execution)

All 37 implementation-spec steps landed across 2 tranches:
- **Tranche 1** (Steps 1-21): FR-1 Switch, FR-2 Slider, FR-3 Collapsible, FR-10 Badge reuse (2
  sites, 1 kept as a documented hand-rolled exception), FR-11 Table reuse (2 sites), FR-12 shared
  `FilterToolbar.tsx` (new component, 2 call sites), FR-13 `NavigationMenu` (replacing the original
  design.md KEEP-AS-IS recommendation per the user's Round 3 override — `PlatformHeader.tsx` +
  `BottomTabBar.tsx`).
- **Tranche 2** (Steps 22-37, added mid-session per user direction to cover FR-4 through FR-9 in
  this same pass): FR-4 `AlertDialog` (5 `window.confirm()` sites), FR-5 `Tabs` for
  `EnvModeSwitcher` (**reverted** — see Steps 26-27, a genuine primitive/role mismatch), FR-6
  `ToggleGroup` (opportunities source pills), FR-7 `Alert` (2 sites), FR-8 `Checkbox` (1 site), FR-9
  `Collapsible` (substituted for the product-spec's original "Accordion" framing — a structural-fit
  finding, not a design.md revision).
- **Two primitive-fit findings that changed the plan mid-execution**, both logged in
  `docs/roadmap/ledger/fails.md` for sibling features: (1) `NavigationMenuLink` uses classic Radix
  `asChild`, not the `render` prop design.md assumed (Step 17); (2) `Tabs.Trigger` hardcodes
  `role="tab"`, which breaks `role="link"` when `asChild`-wrapping a full-page-navigation `Link` —
  reverted `EnvModeSwitcher` to plain `Link`s (Steps 26-27).
- **One new shared component**: `src/components/shared/FilterToolbar.tsx` (FR-12).
- Final state: `pnpm lint`/`pnpm build`/`pnpm test:unit`/`pnpm test:e2e` all clean (Step 37).

## Session 2026-08-10 (CI: feature status automation)

- Promotion PR #923 merged to main
- Feature promoted and committed: be21f3389151ccac1bfd68e7aa96d73d3d4efd78
- Status updated: `code-completed` → `launched`
- Launched date: 2026-08-10

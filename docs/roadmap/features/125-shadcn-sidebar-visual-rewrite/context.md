# Context: shadcn-sidebar-visual-rewrite

**Feature**: `docs/roadmap/features/125-shadcn-sidebar-visual-rewrite/feature.md`
**Product Spec**: `docs/roadmap/features/125-shadcn-sidebar-visual-rewrite/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/125-shadcn-sidebar-visual-rewrite/implementation-spec.md`

---

## Session 2026-08-10T00:00:00Z — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from a user story delivered as a
  chat instruction with an attached screen recording ("create a followup feature to rewrite the
  sidebar menu. I'm attaching the Shadcn example vs what we have implemented").
- The video could not be read directly (unsupported media type for the Read tool); extracted 14
  representative frames via Python/OpenCV (`opencv-python-headless`, `cv2.VideoCapture` +
  `cap.set(cv2.CAP_PROP_POS_FRAMES, idx)`) and viewed them via Read to compare our live mobile
  offcanvas Sidebar against shadcn's own reference example.
- Findings grounded directly in feature 124's own implementation: `ui/sidebar.tsx` (vendored Step
  15) already exports `SidebarMenuSub`/`SidebarMenuSubItem`/`SidebarMenuSubButton`, but Step 17's
  `PlatformHeader.tsx` wiring never used them — sub-items render via the same flat
  `SidebarMenu`/`SidebarMenuItem` primitives as top-level groups, with no chevron and no
  indentation cue. This is the exact gap the video comparison surfaced.
- Read `docs/runbooks/feature-workflow.md` and `docs/runbooks/reviewer-registry.md` for governance
  gates and reviewer roles (UI-only, non-breaking → 1 service owner approval, same
  `xstockstrat-ui` service owner role feature 124 used).
- Read `docs/roadmap/ledger/fails.md` (page 1) and `docs/roadmap/ledger/insights.md` (page 1), then
  a targeted grep for `shadcn-table-actions-responsive|SidebarProvider|Sidebar collapsible|
  min-h-svh` across both ledger files found one directly relevant entry:
  `insights.md`'s `2026-08-09 — shadcn-table-actions-responsive — design` — a process lesson (not
  a Sidebar-technical one) that mid-round design decisions must be written into
  `recon.md`/`context.md` before the next debate round spawns, or a later adversary reading only
  the durable artifacts will raise a false-alarm regression. Surfaced this as a "Known trap" in
  the product spec's Open Questions since it hit this exact feature family (124) once already.
  `fails.md` had no matching entries for this scope.
- Out-of-scope items (org/team switcher, user-account footer, icon-collapse desktop rail mode, and
  a "More" overflow affordance given the current small item count) recorded explicitly in the
  product spec rather than left implicit, per the user's own framing of the request ("confirm
  during design").
- **User correction**: "the always visible is not the point, but the layout and interaction are" —
  sharpened the Problem Statement and the icon-collapse-rail Out of Scope bullet so the spec can't
  be misread as asking for a persistently-visible/desktop-rail Sidebar. The scope is layout
  (chevron disclosure affordance, `SidebarMenuSub`-based nesting/indentation, section-label
  grouping) and interaction (chevron rotation on toggle) within the existing mobile-offcanvas
  surface — visibility/placement (offcanvas vs. rail) is a separate, explicitly out-of-scope axis.
  No FRs changed; this was a framing/emphasis fix, not a scope fix.

## Session 2026-08-10T08:00:00Z — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Criteria pass (spec-reviewer): PASS WITH WARNINGS. No Floor (F-*) or Commandment (C-*) breach.
  Every code reference verified live (`PlatformHeader.tsx`, `ui/sidebar.tsx`'s unused
  `SidebarMenuSub*`/`SidebarGroupLabel` exports, `navGroups.tsx`). Warnings: (1) Acceptance
  Criteria 1-4/6 are qualitative/visual rather than quantitative — inherent to a visual/interaction
  rewrite, not a defect; (2) the two Open Questions (More-overflow scope, section-label boundary)
  remain unchecked at product-spec stage, each with a stated design-time resolution path —
  consistent with feature 124's own precedent. Both non-blocking.
- Overlap findings: none (CLEAN). Feature 125 touches only `PlatformHeader.tsx`/`ui/sidebar.tsx` in
  `xstockstrat-ui`; every other feature that recently touched those files (120/121/122/123/124) is
  already merged to `main-dev`, confirmed directly against the live code. No merge-order entry
  required — no in-flight collision to record.

## Session 2026-08-10T09:00:00Z — sdd-design Phase 0 + Phase 1 Round 1

- Phase 0 Recon: wrote `recon.md` (service: `xstockstrat-ui`). Key finds: the vendored
  `SidebarMenuSub*`/`SidebarGroupLabel` primitives are unused but already fully styled; a
  reusable rotating-chevron idiom already exists at `navigation-menu.tsx:74-77`; feature 124's
  "keyboard-accessible row" behavior is inherited from Radix, not custom app code — nothing to
  preserve beyond not disturbing `CollapsibleTrigger`; `mobile-sidebar.spec.ts:102-113`'s
  active-trigger/active-link assertions are a hard constraint any restructuring must survive or
  explicitly update in the same PR.
- Phase 1 Round 1 — Proposer: single rotating `CaretRight` (phosphor-icons) on `SidebarMenuButton`
  via its own `group/menu-button` scope; `SidebarMenuSub*` swap for sub-items; FR-3 resolved by
  **merging** `NAV_GROUPS.slice(0, 4)` into one outer `SidebarGroup` with a `"Platform"`
  `SidebarGroupLabel`, Settings rendered separately below a `SidebarSeparator`, no new
  `navGroups.tsx` field; "More" overflow explicitly out of scope.
- Phase 1 Round 1 — Adversary (NEEDS WORK, no Floor breach): the chevron's `aria-hidden` fix is
  confirmed accname-safe (Phosphor's `IconBase` emits no `<title>` unless `alt` is passed). But
  **merging the four groups into one `SidebarGroup` loses `SidebarContent`'s `gap-2` inter-group
  spacing** (`sidebar.tsx:356`) — a real visual regression the proposal didn't evidence against.
  Also flagged: merging forces a duplicated ~15-line render block (once for the merged `.map`,
  once for standalone Settings) unless factored into a shared helper (DRY guard rail); leaving
  Settings unlabeled is a partial-AC-3-compliance judgment call stated as settled rather than
  explicitly flagged for sign-off; FR-5/AC-6's *new* assertions (rotate state, `SidebarMenuSub`
  structure) weren't concretely named, only the *existing*-locator risk was; `SidebarSeparator`
  needs a new import (trivial); the `"Platform"` label text itself is an unexamined content choice.
  Adversary's suggested alternative: **don't merge the groups** — render a standalone
  `SidebarGroupLabel` "Platform" as a leading sibling in `SidebarContent`, ahead of the *unchanged*
  5-group `.map`, then a `SidebarSeparator`, then Settings' own group as today. Avoids the spacing
  loss and the duplication risk in one move.
- **Known-trap discipline** (per the `insights.md` 2026-08-09 entry cited in `recon.md`): recording
  this synthesis here, before Round 2 spawns, specifically to avoid the mid-round-decision-lost gap
  that previously caused a false-alarm regression in this same `sidebar.tsx`/`PlatformHeader.tsx`
  family during feature 124.
- Floor status: no `F-*` breach. Gate presented to user; full mode requires ≥2 rounds, so Round 2
  is mandatory regardless of the user's answer — offered "Run another round" and "Inject a
  constraint / steer" only (no Approve option yet, per the grilling protocol).
- **User steer**: "give settings it's own label too" — resolves the open Settings-labeling
  objection from Round 1: Settings gets its own `SidebarGroupLabel` (not just a bare
  `SidebarSeparator`), satisfying AC-3's "label (or labels)" wording without a partial-compliance
  judgment call. Feeding this into Round 2 as a hard constraint on the proposer.

## Session 2026-08-10T10:00:00Z — sdd-design Phase 1 Round 2

- Round 2 — Proposer: rejects Round 1's group-merge outright. All 5 `NAV_GROUPS` keep their own
  unchanged `SidebarGroup`; two `SidebarGroupLabel`s ("Navigate", "Settings") render as siblings
  inside `SidebarContent`, gated by `group.key` inside the existing unchanged `.map` — zero
  render-block duplication, `SidebarContent`'s `gap-2` (`sidebar.tsx:356`) applies uniformly since
  nothing is merged. `MobileNavLink` swaps `SidebarMenuButton` → `SidebarMenuSubButton`. Chevron
  mechanism carried forward unchanged from Round 1. Proposer self-flagged two unresolved risks:
  the `SidebarGroupContent` wrapper choice (no in-repo precedent for `SidebarMenuSub`'s parent
  chain) and "Settings" label text literally duplicating its own trigger button's text.
- Round 2 — Adversary (NEEDS WORK, no Floor breach): (1) the `group.key === 'decide'`/`'settings'`
  string-literal gating silently resolves product-spec's own Open Question (new `navGroups.tsx`
  field vs. presentational-only) without saying so, and is fragile to reordering; (2) splitting
  `SidebarGroupLabel` out as a sibling of 4 separate `SidebarGroup`s forfeits ARIA
  group/label association (no `aria-labelledby`) that shadcn's canonical nested structure
  provides for free; (3) the `data-open`-driven chevron rotation is inherited from Round 1
  unverified specifically against `CollapsibleTrigger` — corroborated by precedent across 6+
  other vendored primitives sharing the same `radix-ui` package, but the ledger's "a demonstration
  is not a producer-contract claim" pattern (fails.md 2026-07-27/29/08-05) applies; (4) both
  proposer-self-flagged risks (wrapper choice, label duplication) are unresolved, not just noted;
  (5) no visual/screenshot verification step exists anywhere for a feature whose core acceptance
  criterion is inherently visual.
- **Synthesis (orchestrator) — current best approach**, resolving every Round 2 objection:
  - Replace the `group.key` string-literal gate with an explicit `sectionStart?: string` field on
    `NavGroup` (`navGroups.tsx:22-27`) — e.g. `sectionStart: 'Navigate'` on the `decide` group,
    `sectionStart: 'Settings'` on the `settings` group — closing OQ-2 explicitly (a real data-model
    decision, not an implicit one) and removing the reorder-fragility.
  - Add `aria-labelledby` on each `SidebarGroup` pointing at its preceding label's `id` when one
    precedes it, closing the ARIA-association gap.
  - Drop the `SidebarGroupContent` wrapper inside `CollapsibleContent` — render
    `CollapsibleContent > SidebarMenuSub > SidebarMenuSubItem` directly, matching shadcn's
    canonical nesting rather than an unprecedented wrapper combo (resolves the proposer's own
    flagged risk with a smaller diff, not a bigger one).
  - Chevron mechanism: no separate manual verification required — the proposed e2e `data-state`
    before/after assertion **is** the verification, enforced by Constitution **P-06** (red-before-
    green): if the `CollapsibleTrigger`/`data-open` assumption is wrong, the RED step fails loudly
    before any GREEN implementation lands.
  - "Settings" label duplicating its own trigger text: accepted as a documented, intentional
    trade-off — the user gave an explicit instruction ("give Settings its own label too"); a muted
    small-caps section label above a bold pill button repeating the same word is a common enough
    UI pattern, and second-guessing explicit user direction on wording is out of scope for this
    synthesis. Recorded as an accepted Open Risk, not silently dropped.
  - New requirement added to the chosen approach: an explicit visual verification step (a
    Playwright screenshot assertion, or at minimum a recorded manual-review checkpoint in
    `context.md`) before the integration PR — this feature's central acceptance criterion
    ("match shadcn's own reference example") is inherently visual and nothing in either round's
    proposal verified it.
  - Floor status: no `F-*` breach in either round.
- Gate presented to user: `R = 2` meets full mode's mandated minimum, so **Approve** is now
  offered alongside **Run another round** and **Inject a constraint / steer**.
- **User chose**: "Run another round" (no specific steer given). Round 3 will pressure-test the
  orchestrator's own Round 2 synthesis rather than re-litigate settled ground: firm up the
  `sectionStart` field's concrete shape/values on `NavGroup`, ground the visual-verification
  requirement in whatever screenshot/snapshot tooling (if any) already exists in this repo's e2e
  conventions rather than leaving it abstract, and confirm the `aria-labelledby` wiring is
  concretely specified (which element gets the `id`, which gets the `aria-labelledby`).

## Session 2026-08-10T11:00:00Z — sdd-design Phase 1 Round 3

- Round 3 — Proposer (firms up items 2/3/7, carries 1/4/5/6 forward unchanged): `sectionStart?:
  string` added to `NavGroup` (`navGroups.tsx:22-27`), set on `decide`→`'Navigate'` and
  `settings`→`'Settings'`; a precomputed `groupsWithSection` derivation (carry-forward loop over
  `NAV_GROUPS`) drives which group gets a preceding `SidebarGroupLabel`; **every** group under a
  section (not just the first) gets `aria-labelledby` pointing at that section's label `id` —
  static string ids judged safe (single-mount panel, no dup-id risk). `SidebarGroupContent`
  wrapper dropped per the settled Item 4. Visual verification: grepped `e2e/` and
  `playwright.config.ts` for screenshot/snapshot tooling — **none exists anywhere in this
  codebase** — proposed a manual-verification checklist step (not new snapshot infra, per root
  CLAUDE.md's minimalism principle) recording pass/fail + deviations in `context.md`.
- Round 3 — Adversary (NEEDS WORK, no Floor breach): **`SidebarGroup` renders with no explicit
  `role`** (`sidebar.tsx:364-372`, a bare `<div>`) — implicit role `generic`, which is excluded
  from accessible-name computation per WAI-ARIA. `aria-labelledby` on a `role=generic` element is
  not reliably exposed to assistive tech — the "valid IDREF, no dup id" check the proposer ran
  confirms syntactic validity, not that it actually reaches AT (the same "demonstration ≠
  producer-contract" shape ledger-flagged 4 times already: fails.md 2026-07-27/29/08-05,
  2026-08-09 `shadcn-migration-high-confidence`). Even granting a `role="group"` fix, giving 4
  sibling groups the **identical** accessible name ("Navigate") adds no real value beyond what
  each `SidebarMenuButton`'s own already-correct accessible name (its visible trigger text)
  provides — proposed simpler alternative: **drop the `aria-labelledby`/id-sharing mechanism
  entirely, keep `SidebarGroupLabel` purely visual.** Also flagged: the `sectionStart` derivation's
  carry-forward loop depends on an **undocumented ordering invariant** (a `sectionStart`-bearing
  group must be first in its section) with no compile/test-time signal if violated — `NAV_GROUPS`
  is already order-significant for a second consumer (`BottomTabBar.slice(0,4)`,
  `navGroups.tsx:31-32`). Minor: Item 7's manual checkpoint produces only a boolean, no durable
  artifact to re-check against later.
- **Synthesis (orchestrator) — final chosen approach**:
  - **Section labels become purely visual** — no `id`, no `aria-labelledby`, no `role="group"`.
    Adopting the adversary's simpler alternative: `SidebarGroup`'s implicit `generic` role means
    the ARIA-association mechanism likely wouldn't reach assistive tech as designed even with the
    fix, and each `SidebarMenuButton` already computes a correct, distinct accessible name from its
    own visible text — a shared, identical accessible name across 4 siblings adds complexity
    (id-plumbing, `groupsWithSection` derivation, an ordering invariant to maintain) without a
    real accessibility win. Per root CLAUDE.md's "write the minimum that solves the stated
    problem": FR-3 asks for a visual, non-interactive section label — satisfied without the ARIA
    machinery. This also resolves Round 3's ordering-invariant objection for free, since dropping
    `aria-labelledby` removes the only consumer of the id-derivation that depended on it — the
    `sectionStart` field + `groupsWithSection` derivation (which group gets a preceding label) is
    still needed and kept, just without producing an `id`/`aria-labelledby` pair.
  - `sectionStart?: string` on `NavGroup` gets a JSDoc comment documenting the ordering invariant
    (must be set on the first `NAV_GROUPS` entry of the section it starts) as a documentation-only
    mitigation, since the mechanism's blast radius is now visual-only (a misplaced label), not an
    invalid-ARIA-reference risk.
  - Item 7: the manual-verification checkpoint captures a saved screenshot (attached to
    `context.md` or the integration PR) alongside the pass/fail note — not the boolean alone.
  - Items 1 (no merge), 4 (`SidebarMenuSub` nests directly), 5 (chevron mechanism, e2e-verified),
    6 (Settings label duplication, accepted trade-off) carried forward unchanged from Round 2 —
    none challenged in Round 3.
  - Floor status: no `F-*` breach across all 3 rounds.
- Gate presented to user (R=3, ≥ mandated minimum): **user approved.** `design.md` written.
- Status: `spec-ready` → `design-approved`.

## Open Threads

- [ ] Visual read of the purely-visual two-`SidebarGroupLabel` structure is unprecedented in this
  codebase (no prior screenshot/example of "label → single-collapsible-row group" vs. shadcn's
  canonical "label → multiple flat items"). To be addressed at the `/sdd-spec` step that performs
  the manual visual-verification checkpoint (screenshot + pass/fail note).
- [ ] "Settings" label text duplicates its own trigger button's text — accepted trade-off per
  explicit user instruction, not to be silently reworded at `/sdd-spec`/implementation time.
- [ ] `sectionStart`'s ordering invariant (must be set on the first `NAV_GROUPS` entry of the
  section it starts) is documented only via JSDoc, not enforced — low blast radius (visual-only
  misplacement). To be addressed at the `/sdd-spec` step that adds the field.

## Session 2026-08-10T13:00:00Z — sdd-review impl-spec (advisory)

- Result: 0 failures, 3 warnings (advisory — did not block). Overlap: CLEAN (no collisions vs. the
  only other `implementation-ready` feature, 096 — disjoint file sets).
- Criteria pass (spec-reviewer): every `path:line` citation across all 4 steps independently
  spot-checked against live code and found exact, including a third-party dependency version
  (`@radix-ui/react-collapsible@1.1.20`) cross-checked via `pnpm-lock.yaml`. No `F-*` Floor risk
  anywhere in this spec (no migration/proto/config/gRPC-header surface touched). Noted the spec
  demonstrates real diligence, independently re-verifying and correcting two claims inherited from
  `design.md` (the chevron's actual CSS mechanism, the red-before-green proof) rather than trusting
  them at face value.
- Unresolved ⚠ carried into execution:
  - Step 3: `impl-spec-criteria.md`'s coverage-threshold criterion doesn't map cleanly onto a
    Playwright e2e step (this service's CI coverage gate is vitest-unit-scoped to `src/lib/**`, per
    `xstockstrat-ui/CLAUDE.md`) — [x] resolved (reviewer judged not a genuine gap; no action needed).
  - Step 4: the manual-verification checkpoint's Verification is prose, not a bash command — a
    deliberate, well-reasoned deviation (no screenshot-regression tooling exists anywhere in this
    codebase; building one for a single feature was explicitly rejected in `design.md` as overbuilt)
    — [x] resolved (reviewer judged justified, correctly cites P-03/F-09 for follow-up).
  - Cross-cutting: AC-5 (product-spec) requires `pnpm lint && pnpm build` + full `pnpm test:e2e` to
    pass, but no step's Verification runs `pnpm build` (only `tsc --noEmit` + lint + e2e) —
    **[x] resolved** — ran `NEXT_DISABLE_STANDALONE=1 pnpm build` at the feature-end checkpoint
    (after Step 4); succeeds cleanly, all routes compile. AC-5 fully satisfied.

## Session 2026-08-10T13:00:00Z — sdd-spec

- Generated `implementation-spec.md` with 4 steps (navGroups field → PlatformHeader rewrite →
  e2e test → manual visual checkpoint). Status → `implementation-ready`.
- Key codebase findings:
  - **Corrected design.md's stated chevron mechanism.** design.md's Chosen Approach cited
    `sidebarMenuButtonVariants`'s `data-open:*` classes (`sidebar.tsx:449`) as the thing that
    would drive the chevron rotation. Verified against the actually-installed
    `@radix-ui/react-collapsible@1.1.20` source
    (`node_modules/.pnpm/@radix-ui+react-collapsible@1.1.20.../dist/index.mjs:68`) —
    `CollapsibleTrigger` emits `data-state="open"|"closed"`, never a literal `data-open`
    attribute, so those `data-open:*` classes have no producer anywhere in this codebase today
    (dead CSS) — a "demonstration is not a producer-contract claim" instance (ledger `fails.md`
    recurring pattern). The real, working in-file precedent is `sidebar.tsx:215`'s
    `group-data-[side=right]:rotate-180` (bracket syntax against a real attribute value).
    `implementation-spec.md` Step 2 uses `group-data-[state=open]/menu-button:rotate-90` instead
    (90°, not 180° — `CaretRight` is a right-pointing caret, so 90° produces the conventional
    downward "expanded" caret, unlike `navigation-menu.tsx`'s down-pointing `IconChevronDown`
    which needs 180° to flip).
  - **Corrected design.md's proposed red-before-green proof for FR-1.** design.md's FR-5 item 1
    proposed a bare `data-state` `'closed'→'open'` transition assertion as the chevron's
    red-before-green proof. Verified this would already pass on `main-dev` today —
    `Collapsible`/`CollapsibleTrigger` already wrap every group's `SidebarMenuButton`
    (`PlatformHeader.tsx:278-293`, unchanged by this feature) — so it is not actually red before
    Step 2. `implementation-spec.md` Step 3 adds a `rotate-90` class assertion on the chevron
    icon itself alongside the `data-state` check, since only the class assertion has no producer
    until Step 2 lands.
  - `SidebarGroupContent`/`SidebarMenu`(non-Sub)/`SidebarMenuItem`(non-Sub)/`MobileNavLink` are
    all used **only** inside `PlatformHeader.tsx`'s mobile block — confirmed via repo-wide grep —
    so Step 2's import/JSX swap is self-contained, no cross-file impact.
  - `group.sectionStart` (Step 1) is itself the entire "which group gets a preceding label"
    derivation once ARIA-association was dropped in design.md's Round 3 — no separate
    `groupsWithSection` lookup structure is needed; inline `{group.sectionStart && <SidebarGroupLabel>...}`
    suffices (root `CLAUDE.md` "write the minimum" guardrail).

## Session 2026-08-10T14:00:00Z — sdd-execute (sequential) boot

- BOOT SEQUENCE B3: `feature/shadcn-sidebar-visual-rewrite` does not exist on origin (never
  created — no code work had happened yet). Fell back toward `origin/main-dev`, but none of this
  feature's spec files exist there either (the feature never merged). Resolved by loading
  authoritative spec files from `origin/claude/implement-124-e48xkn` instead — the actual
  harness-assigned session branch, confirmed byte-identical to the local working tree and already
  carrying every artifact this feature has produced (product-spec.md through
  implementation-spec.md). Same resolution feature 124 used for the identical situation.
- Corrected `feature.md`'s **Development Branch** field to `claude/implement-124-e48xkn`
  (harness-assigned; see note) to match reality, added an explanatory note, logged a Status
  History row. No lifecycle status change (stays `implementation-ready`).
- Confirmed `origin/main-dev` (`b70b645`) is an ancestor of the current branch — already up to
  date, no merge needed for the re-spec gate's `main-dev`-sync step.
- Sequential mode entry confirmation: user agreed. Proceeding to the re-spec gate (§5.3).
- Re-spec gate (§5.3): codebase-discovery re-validated all 4 steps' Codebase Evidence against the
  live tree — every `path:line` citation matched exactly, no drift, no `## Not found`. No re-spec
  needed (directive: none).
- Up-front confirm (§5.4): user proceeded. Plan: Steps 1-4, all surface `ui`, one checkpoint
  expected at feature end (4 steps ≤ 5 cap, no surface boundary — all four are `xstockstrat-ui`).
- Tooling setup (steps 1-4): node22 ✓ v22.22.2 · pnpm ✓ 9.15.0 · tsc ✓ · next/lint ✓ · playwright ✓
  · chromium ✓ (pre-provisioned `/opt/pw-browsers`). Nothing installed — all present.

### Step 1 — add `sectionStart` field to `NavGroup` [done]
- Added the optional `sectionStart?: string` field to `NavGroup` with the JSDoc-documented
  ordering invariant; set `'Navigate'` on `decide`, `'Settings'` on `settings`; `discover`/`engine`/
  `book` untouched. `pnpm exec tsc --noEmit` clean; grep confirms the field appears once and each
  value is set on exactly the intended group object.
- Files modified: `services/xstockstrat-ui/src/components/shared/navGroups.tsx`
- Deviations: none

### Step 2 — chevron, SidebarMenuSub nesting, section labels in PlatformHeader.tsx [done]
- Added `CaretRight` to the icon import; swapped `SidebarGroupContent, SidebarMenu, SidebarMenuItem`
  for `SidebarGroupLabel, SidebarMenuSub, SidebarMenuSubItem, SidebarMenuSubButton` in the
  `../ui/sidebar` import; `MobileNavLink` now renders `SidebarMenuSubButton`; the `NAV_GROUPS.map`
  render block wraps each iteration in a keyed `React.Fragment` rendering an optional
  `SidebarGroupLabel` (from `group.sectionStart`) as a sibling of the unchanged `SidebarGroup`,
  adds the rotating `CaretRight` chevron inside `SidebarMenuButton`
  (`group-data-[state=open]/menu-button:rotate-90`), and nests `SidebarMenuSub`/`SidebarMenuSubItem`
  directly inside `CollapsibleContent` (no wrapper). `tsc --noEmit` clean; `pnpm run lint` clean
  (one pre-existing, unrelated warning in `strategies/[id]/page.tsx`, present before this feature —
  same warning feature 124's PR documented). Both grep checks confirm exactly as specified: the new
  primitives appear, and `SidebarGroupContent`/non-Sub `SidebarMenu`/`SidebarMenuItem` are fully
  gone from this file.
- Files modified: `services/xstockstrat-ui/src/components/shared/PlatformHeader.tsx`
- Deviations: none

### Step 3 — update mobile-sidebar.spec.ts for the new structure [done]
- Added 3 new tests per spec: chevron `data-state`/rotation transition, `SidebarMenuSub`
  structural presence, and the two section labels' visibility. Left the existing 6 tests
  (`:23-113`) unmodified, including the active-highlight test per Step 2 Instruction 5.
- **TDD — resolved with a genuine red-before-green cycle, after one fallback then a corrected
  retry**:
  1. **Attempt 1** (full-suite, default `playwright test`): timed out during `warmup.setup.ts`'s
     21-route pre-warm (this sandbox's Next.js dev-mode compiler took 88.6s for one route alone,
     13,610 modules). Fell back to `tsc --noEmit` + `pnpm run lint` + `playwright test --list`
     (sequential-mode pre-authorized substitute).
  2. **Attempt 2** (scoped, `--project=chromium --no-deps` + manual pre-warm of just the 2 routes
     this spec actually visits via `curl` + a hand-signed test JWT): completed in under a minute.
     Got a genuine RED (3 new tests fail for the right reasons; 6 existing still pass) against the
     pre-Step-1/2 snapshot.
  3. Restoring Steps 1-3 and re-running still showed 1 failure — not a real bug, but **my own test
     was checking the wrong CSS property**: Tailwind v4 sets the standalone `rotate` property for a
     bare `rotate-90` utility, not `transform` (confirmed by reading the actual generated
     stylesheet rule via `document.styleSheets`). Fixed the assertion (`toHaveCSS('rotate', ...)`),
     re-verified RED then **GREEN: 9/9 passed in 18.2s**.
  Full narrative: `implementation-spec.md` § Deviation Log, Step 3. Logged two `fails.md` entries
  (2026-08-10): one correcting Attempt 1's overly pessimistic conclusion with the scoped-run
  technique that actually worked, one recording the Tailwind v4 `rotate`-vs-`transform` gotcha.
- Files modified: `services/xstockstrat-ui/e2e/mobile-sidebar.spec.ts`
- Deviations: none in the final state (genuine red-before-green achieved). The Deviation Log
  documents the two intermediate missteps (Attempt 1's premature fallback, the wrong CSS property)
  and how each was corrected, per P-03 — not because either is still open.

### Step 4 — manual visual-verification checkpoint [done]
- Since Step 3's scoped run proved this sandbox *can* run a live browser (Attempt 1's "sandbox
  can't do it" conclusion was superseded), performed the actual visual check rather than escalating
  Step 4 as a blocker per its own Instruction 4 fallback.
- Added a temporary `page.screenshot({ path: 'sidebar-visual-check.png', fullPage: true })` inside
  the "sub-items render via SidebarMenuSub" test (after `openGroup(panel, 'Discover')`), ran it via
  `pnpm exec playwright test mobile-sidebar.spec.ts --project=chromium --no-deps -g "sub-items
  render via SidebarMenuSub"`, captured the panel at the `390×844` viewport with Decide collapsed
  and Discover expanded (single-open-group behavior — expanding Discover closed Decide, the
  previously-default-open group). Removed the temporary line immediately after — confirmed via
  `git diff` the test file exactly matches its Step 3-committed state, no screenshot code shipped.
  Screenshot archived at the session scratchpad (`feature-125-sidebar-visual-check.png`) and sent
  to the user directly.
- **Verdict against the three criteria (Instruction 2): PASS.**
  - (a) Chevron rotation reads as an expand/collapse affordance: Discover (open, showing
    Watchlists/Screener) shows a visibly rotated caret distinct from Engine/Book/Settings'
    (collapsed) unrotated right-pointing carets — not merely decorative.
  - (b) Sub-items visibly indented, distinct weight from top-level buttons: Watchlists/Screener
    render narrower, indented, and in a lighter pill style clearly subordinate to the full-width
    bold Discover button above them. Minor cosmetic note (non-blocking, not one of the three
    pass/fail criteria): the `SidebarMenuSub` connecting-line rail (`border-l border-sidebar-border`
    per `sidebar.tsx:599`) is present but visually subtle against this dark theme at screenshot
    compression — the indentation/weight distinction alone already satisfies the criterion.
  - (c) "Navigate"/"Settings" section labels read as muted headers, not confusingly-worded buttons:
    both render as small, muted, non-pill, non-bold text clearly visually distinct from the bold
    full-width pill buttons below them — including "Settings," which despite literally repeating
    its button's text (the accepted design.md trade-off) reads unambiguously as a label, not a
    second interactive control, confirming that trade-off held up visually as reasoned.
  - No escalation needed — no design decision (label wording, structure) required revisiting.
- Files modified: `docs/roadmap/features/125-shadcn-sidebar-visual-rewrite/context.md` (this entry)
- Deviations: none.

## Session 2026-08-10T17:00:00Z — post-checkpoint user visual review + correction

At the feature-end checkpoint, presented the completed 4-step implementation for the integration
PR. The user pushed back on the visual result (Step 4's screenshot), leading to a substantive
correction cycle before the integration PR could proceed. Full narrative (fully argued in
sequence, no step skipped):

1. **Initial pushback**: "the always visible is not the point... looks like collapsible sections
   over a sheet component" — comparing our render against `ui.shadcn.com/docs/components/radix/
   sidebar`. Fetched the live page (`WebFetch`) rather than relying on memory: confirmed
   "collapsible groups are the exception, not the rule" in shadcn's own docs, and that top-level
   items are normally plain flat rows.
2. **Deeper structural check**: fetched the exact "Collapsible SidebarGroup" example code and
   found shadcn's canonical composition nests `Collapsible` inside `SidebarMenuItem` (itself inside
   `SidebarMenu`) — our implementation nested it directly inside `SidebarGroup`, skipping that
   wrapper entirely. Presented this diagnosis with a 3-way scope question (fix now / broader
   rework / follow-up feature).
3. **User confirmed the exact fix**: pasted the literal `SidebarMenu > SidebarMenuItem >
   SidebarMenuButton (+ SidebarMenuSub for the nested case)` structure to use. Asked one
   confirming question (flat-vs-collapsible for single-item groups) — user clarified their actual
   point was narrower: "we don't need the Collapsible, CollapsibleTrigger or CollapsibleContent
   wrappers" (initially read as removing interactivity entirely — asked a clarifying question with
   a concrete before/after preview).
4. **User reframed once more**: "the problem is the styling on the collapsible sections... I want
   something slick like the documentation page." Fetched `ui.shadcn.com/docs` itself (the docs
   site's own live nav, not a component-page code sample) for a concrete "slick" reference:
   confirmed it's plain-text rows, typography-driven active/hover state, no persistent background
   pills. Proposed a concrete restyle plan (flatten `SidebarMenuButton`, drop the persistent
   `bg-accent` active fill, verify `SidebarMenuSub`'s connecting line contrast) and got approval.
5. **Implemented**: `SidebarMenu`/`SidebarMenuItem` wrapper added, chevron scope renamed to
   `group/collapsible` (matching shadcn's own naming, not a borrowed precedent), active-group
   styling changed to `rounded-md` + `font-medium text-foreground` (no persistent fill). `tsc`/lint
   clean. Full e2e re-run (`--project=chromium --no-deps --workers=1`) found ONE real regression:
   `mobile-sidebar.spec.ts:108`'s `toHaveClass(/bg-accent/)` assertion, now correctly failing since
   the persistent fill was deliberately removed — fixed the assertion to `/font-medium/`, re-ran
   clean (one unrelated flake, passed on isolated retry and full re-run).
6. **Screenshot sent — still didn't look right.** The restyled screenshot looked visually identical
   to before (still a solid pill background on every row). Root-caused via direct
   `getComputedStyle` measurement (`Engine` button, `data-active="false"`, background =
   `oklch(0.268...)` = `--sidebar-accent` — should be transparent when inactive): a real bug in the
   **vendored primitive** (`ui/sidebar.tsx`), not our styling at all — `data-active={isActive}`
   always renders the attribute (React stringifies `false` to `"false"`, doesn't omit it), and
   Tailwind's bare `data-active:bg-sidebar-accent` variant matches on attribute *presence*, not its
   value. Confirmed identically on `SidebarMenuSubButton`. Confirmed via grep this feature's
   `PlatformHeader.tsx` is the *only* consumer of either component. Asked before touching the
   vendored file (touching it needs documenting per the `button.tsx`/`badge.tsx` reconciliation
   convention) — user approved. Fixed: `data-active={isActive || undefined}` at both sites in
   `sidebar.tsx`, documented in `xstockstrat-ui/CLAUDE.md`. Re-verified full suite (9/9 green,
   isolated flake retry only), captured a new screenshot — dramatic visual improvement, flat
   typography-driven rows matching the shadcn docs-nav aesthetic.
7. **One more visual question**: the panel appeared not to reach the full viewport height in the
   screenshot (a card and a floating circular button visible below/around the panel's apparent
   bottom edge). Measured directly via Playwright (`boundingBox()`): panel height = 844px, exactly
   matching the 844px viewport — genuinely full-height. Root-caused the visual artifact: (a) the
   floating "N" circle is Next.js's own dev-mode toolbar indicator (`<nextjs-portal>`), dev-server
   only, never present in the production build; (b) the screenshot used `fullPage: true`, which
   captures the entire scrollable *document*, not just the viewport — since the sidebar overlay is
   `fixed`-positioned (correctly scoped to the viewport only), a full-page capture reveals page
   content below the fold that the overlay was never meant to cover. Re-captured with
   `fullPage: false` (viewport-only) — clean, no artifact, no gap. Confirmed with the user: not a
   real bug.
8. **User signed off** on the corrected result. Proceeding to finalize documentation
   (`design.md` ADDENDUM, `implementation-spec.md` Deviation Log, `xstockstrat-ui/CLAUDE.md`, this
   entry — all done as of this session) and a final `pnpm build` re-verification before the
   integration PR.

**Ledger writes**: `fails.md` — "shadcn-sidebar-visual-rewrite — assumption" (2026-08-10, third
entry that date): the 3-round design debate verified the reference's *visual styling* but never
its *actual DOM composition*, because no round fetched the live shadcn docs page — all evidence
was `recon.md` citations, which can only describe our own codebase. Proposes future
external-reference-match features include a live-reference-fetch step in Phase 0 Recon, not defer
that check to a post-implementation human screenshot comparison.

**Files modified this session**: `services/xstockstrat-ui/src/components/shared/PlatformHeader.tsx`,
`services/xstockstrat-ui/src/components/ui/sidebar.tsx`, `services/xstockstrat-ui/e2e/
mobile-sidebar.spec.ts`, `services/xstockstrat-ui/CLAUDE.md`,
`docs/roadmap/features/125-shadcn-sidebar-visual-rewrite/{design.md,implementation-spec.md,
context.md}`, `docs/roadmap/ledger/fails.md`.

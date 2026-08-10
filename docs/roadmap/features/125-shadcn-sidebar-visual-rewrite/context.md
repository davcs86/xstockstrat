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

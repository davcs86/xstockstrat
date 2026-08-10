# Design: shadcn-sidebar-visual-rewrite

**Created**: 2026-08-10
**Rounds**: 3 (full; termination: approved)
**Approved by**: user @ 2026-08-10T12:00:00Z
**Grounded in**: recon.md

---

## Chosen Approach

The mobile offcanvas `Sidebar`'s five `NAV_GROUPS` entries (`navGroups.tsx:33-84`) keep rendering
through the same single `.map` inside `SidebarContent`, each still wrapped in its own unchanged
`SidebarGroup` (`PlatformHeader.tsx:276-311`) — **no groups are ever merged**. This preserves
`SidebarContent`'s `gap-2` inter-child spacing (`sidebar.tsx:356`, applies only to direct children)
across every transition, and keeps the existing `Collapsible`/`CollapsibleTrigger`/
`CollapsibleContent` render block written exactly once (no duplication risk).

**FR-1 (chevron disclosure)**: a rotating `CaretRight` icon (`@phosphor-icons/react` — same import
already used by `PlatformHeader.tsx:6`, and by `SectionRenderer.tsx:3,73` elsewhere in this
codebase) is added inside `CollapsibleTrigger`'s `SidebarMenuButton` child, rotated via the
already-present `group/menu-button` named group and the `data-open:*` functional-variant family
already defined on `sidebarMenuButtonVariants` (`sidebar.tsx:449`) — the same idiom demonstrated at
`navigation-menu.tsx:74-77` and used across 6+ other vendored primitives sharing the same
`radix-ui` package (`accordion.tsx`, `dropdown-menu.tsx`, `sheet.tsx`, `alert-dialog.tsx`).
Correctness of this mechanism specifically for `CollapsibleTrigger` is verified by the red step of
the new e2e assertion below, not by a separate manual check — Constitution **P-06**.

**FR-2 (sub-item nesting)**: `MobileNavLink` (`PlatformHeader.tsx:160-175`) switches its rendered
primitive from `SidebarMenuButton` to `SidebarMenuSubButton` (`sidebar.tsx:618-644` — accepts
identical `asChild`/`isActive`/`onClick` props, so `data-active` propagation and
`mobile-sidebar.spec.ts:108-112`'s existing assertion are unaffected). Inside each group's
`CollapsibleContent`, the flat `SidebarMenu`/`SidebarMenuItem` list is replaced by
`SidebarMenuSub`/`SidebarMenuSubItem` (`sidebar.tsx:593-616`) nested **directly** —
`CollapsibleContent > SidebarMenuSub > SidebarMenuSubItem`, with the `SidebarGroupContent` wrapper
dropped rather than kept, to match shadcn's canonical nesting instead of an unprecedented wrapper
combination.

**FR-3 (section-label grouping)**: an optional `sectionStart?: string` field is added to the
`NavGroup` interface (`navGroups.tsx:22-27`), set to `'Navigate'` on the `decide` group's object
literal and `'Settings'` on the `settings` group's object literal (`discover`/`engine`/`book` get
no new field). A small derivation (`groupsWithSection`, a carry-forward scan over `NAV_GROUPS`
computed once outside the JSX `.map`) determines which group is immediately preceded by a
`SidebarGroupLabel` (`sidebar.tsx:375-393`, vendored and previously unused) reading that group's
`sectionStart` text. **The label is purely visual** — no `id`, no `aria-labelledby`, no
`role="group"` — see Rejected Alternatives for why the ARIA-association route was tried and
dropped. Settings gets its own `"Settings"` label per explicit user instruction, even though this
duplicates its own trigger button's visible text — an accepted, intentional trade-off (see Open
Risks). The `sectionStart` field carries a JSDoc comment documenting its one real invariant: it
must be set on the first `NAV_GROUPS` entry of the section it starts, or the label silently
attaches to the wrong group.

**FR-4 (keyboard accessibility preserved)**: nothing to add. Feature 124's "keyboard-accessible
row" behavior is inherited for free from Radix `CollapsiblePrimitive.CollapsibleTrigger` rendering
a native `<button>` (`ui/collapsible.tsx:9-13`) — there is no custom app-authored `onKeyDown`/
`tabIndex` code to preserve (confirmed absent in recon: 0 matches across `PlatformHeader.tsx` and
`src/components/shared/`). As long as `CollapsibleTrigger` stays the interactive element through
this restructuring — which it does, unchanged — this requirement holds by construction.

**FR-5 (updated e2e coverage)**: `mobile-sidebar.spec.ts` gains four new/extended assertions in the
same PR: (1) an explicit `data-state` `'closed'`→`'open'` transition check on a trigger (the
concrete, feasible proxy for the chevron's CSS rotation, which isn't directly E2E-assertable
without visual snapshotting); (2) `[data-slot="sidebar-menu-sub"]` visible after opening a group,
confirming the flat `SidebarMenu` is gone; (3) `[data-slot="sidebar-group-label"]` with text
`'Navigate'` and `'Settings'` both visible — confirmed non-colliding with
`mobile-sidebar.spec.ts:16`'s `getByRole('button', { name })` locators since `SidebarGroupLabel`
renders a plain `<div>` (`sidebar.tsx:380`, no `asChild`), not an interactive role; (4) the existing
active-highlight assertion (`:102-113`) needs **no change** — `SidebarMenuSubButton`'s `data-active`
propagation is identical to `SidebarMenuButton`'s.

**Consumer surface (C-14)**: this entire change lands inside `PlatformHeader.tsx`'s already-mounted
mobile offcanvas `Sidebar`, reachable from every segment (`/trader`, `/insights`, `/config-ui`,
`/accounts`) exactly as it is today — no new registration, no new route, the surface was already
reachable and stays reachable through the same trigger.

**Visual verification (new, not in product-spec's original FRs but required by this design)**: this
codebase has no screenshot/snapshot-regression tooling anywhere (`grep` across `e2e/` and
`playwright.config.ts` returned zero real hits) — introducing one for a single feature would
violate root `CLAUDE.md`'s "write the minimum" guardrail. Instead, `/sdd-spec` must include an
explicit manual-verification step: at the `390×844` viewport `mobile-sidebar.spec.ts:11` already
standardizes on, open the panel, expand a group, and compare against shadcn's own reference
rendering (`ui.shadcn.com/docs/components/sidebar`, Radix UI tab) — capturing a saved screenshot
(attached to `context.md` or the integration PR) alongside a pass/fail note, run after the
automated e2e assertions pass and before the integration PR opens.

## Rejected Alternatives

- **Merging the four workflow groups (Decide/Discover/Engine/Book) into one outer `SidebarGroup`
  with a single `SidebarGroupLabel`** (Round 1) — rejected because `SidebarGroup` itself carries no
  `gap-*` of its own (`sidebar.tsx:369`); only `SidebarContent`'s direct-child `gap-2` provides
  inter-group spacing, so merging strips it — a visible regression on a feature whose entire
  premise is a visual rewrite. Also would have forced the ~15-line Collapsible/Trigger/Content
  render block to appear twice (once for the merged `.map`, once for standalone Settings) absent a
  shared helper — a DRY-guard-rail risk.
- **Gating the section label on hardcoded `group.key === 'decide'` / `'settings'` string literals**
  (Round 1/2 draft) — rejected in favor of an explicit `sectionStart?: string` field on `NavGroup`:
  the string-literal version silently resolved product-spec's own Open Question (new data-model
  field vs. purely presentational) without saying so, and was fragile to any future reordering of
  `NAV_GROUPS`.
- **`aria-labelledby` linking each `SidebarGroup` to its section's `SidebarGroupLabel` id, with
  `role="group"` added to make the association reach assistive tech** (Round 3) — rejected because
  even with the `role="group"` fix, giving 4 sibling groups an **identical** accessible name
  ("Navigate") adds no real value: each `SidebarMenuButton` already computes a correct, distinct
  accessible name from its own visible trigger text. The mechanism would have added real complexity
  (id-plumbing, a `groupsWithSection` derivation, an ordering invariant on `sectionStart` to
  maintain) for an accessibility improvement that, once actually exposed, tells a screen-reader
  user nothing beyond what they already hear from each button. Per root `CLAUDE.md`'s "write the
  minimum that solves the stated problem": FR-3 asks for a visual, non-interactive label —
  satisfied without the ARIA machinery.
- **Keeping the flat `SidebarMenu`/`SidebarMenuItem` list and faking nesting via `className`
  indentation alone** — rejected outright: FR-2 explicitly requires the vendored `SidebarMenuSub*`
  primitives, and a className-only fake would forgo the already-styled connecting-line rail
  (`border-l border-sidebar-border`, `sidebar.tsx:599`) for free.
- **Introducing Playwright `toHaveScreenshot`/snapshot-based visual regression testing for this
  feature** — rejected because this codebase has no such tooling anywhere today, and the feature's
  acceptance criterion ("match shadcn's reference example") is irreducibly a subjective visual
  comparison against an external, not-locally-stored baseline — a pixel-diff tool wouldn't validate
  that any better than a documented manual check, and building the infrastructure for one feature
  would be scope creep beyond what was asked.

## Open Risks

- [ ] The two-`SidebarGroupLabel`-as-visual-only-sibling structure is new and unexercised anywhere
  else in this codebase — no prior screenshot/precedent confirms a "label → single-collapsible-row
  group" pairing (vs. shadcn's canonical "label → multiple flat items" pairing) reads well visually
  rather than looking like a stray, narrow heading. Mitigated, not eliminated, by the manual visual
  verification step — to be addressed at the `/sdd-spec` step that performs that check.
- [ ] "Settings" as a section-label text literally duplicates the Settings group's own trigger
  button text (`navGroups.tsx:72`) — visually distinguishable only by weight/color/size (muted
  `text-xs` label vs. bold pill button, `sidebar.tsx:386-388` vs. `449`), not by different wording.
  Accepted as an intentional trade-off per explicit user instruction ("give Settings its own label
  too") — not to be silently reworded at `/sdd-spec` or implementation time without checking back
  with the user first.
- [ ] `sectionStart`'s ordering invariant (must be set on the first `NAV_GROUPS` entry of the
  section it starts) is documented only via a JSDoc comment, not enforced by a compile-time or
  runtime check — a future reorder could silently misplace a label. Low blast radius (visual-only
  misplacement, not an invalid ARIA reference, now that the ARIA mechanism was dropped) — to be
  addressed at the `/sdd-spec` step that adds the field, by writing the JSDoc clearly.

## Constitution Rules Touched

- `C-01` (zero-assumption / evidence-cited steps) — honored by: every claim in this design cites
  `recon.md` `path:line`; the two content/structural questions the proposer flagged as genuinely
  unresolved (label wording, `SidebarMenuSub`'s parent-chain precedent) were surfaced as open
  risks/assumptions across the debate rather than asserted as settled facts.
- `C-10` (integration completeness) — not implicated; this is a rewrite of a single existing
  surface, not a change duplicated across code paths.
- `C-14` (name the consumer surface) — honored by: the Chosen Approach section states explicitly
  that the change lands inside the already-reachable mobile offcanvas `Sidebar` across all four
  segments, with no new registration needed.
- `P-01` (single-orchestrator authority) — honored by: all three debate rounds' proposer/adversary
  subagents were read-only advisors; every write (recon.md, design.md, context.md, feature.md) was
  made by the orchestrating skill.
- `P-02` (no lateral subagent coordination) — honored by: the adversary in each round received only
  the proposer's returned approach text (verbatim) plus recon.md/product-spec.md/Constitution/
  ledger — never the proposer's raw subagent transcript; each round's proposer received only the
  orchestrator's synthesized prior-round state, never the adversary's raw output.
- `P-04` (phase-gate approval, recorded) — honored by: each round's synthesis was presented to the
  user via `AskUserQuestion` before advancing; Round 1 and Round 2 gates were answered ("run
  another round" / steering constraint) and recorded in `context.md`; Round 3's gate was answered
  "Approve design," recorded here.
- `P-05` (incremental checkpointing) — honored by: every round's proposer output, adversary
  objections, and orchestrator synthesis were written to `context.md` as they happened (not batched
  to session end), specifically to avoid the exact mid-round-decision-lost gap the
  `shadcn-table-actions-responsive` ledger entry (`insights.md`, 2026-08-09) flagged as having
  already caused a false-alarm regression in this same `sidebar.tsx`/`PlatformHeader.tsx` family.
- `P-06` (red-before-green) — honored by: the chevron-rotation mechanism's correctness against
  `CollapsibleTrigger` specifically (an inference from sibling-primitive precedent, not a confirmed
  fact) is treated as verified by the new e2e assertion's RED step, not asserted as already true —
  if the `data-open` assumption is wrong, the failing test catches it before any GREEN
  implementation lands.
- `F-11` (Floor rejection halts) — honored by: no `F-*` violation was flagged by either adversary
  across all 3 rounds; nothing to halt.

---

## ADDENDUM 2026-08-10 (post-implementation, user visual review)

The 3-round debate above approved a design that turned out, on the user's own visual review of
the implemented result against the real shadcn Sidebar docs, to have two real gaps neither the
debate nor `/sdd-spec`'s grounding caught. Recorded here per the `insights.md` 2026-08-09
`shadcn-table-actions-responsive` lesson (mid-process decisions must be written down, not left in
conversation) — this correction happened during `/sdd-execute`, after the feature-end checkpoint,
triggered by the user comparing a screenshot against `ui.shadcn.com/docs/components/sidebar`
directly (something no debate round or `/sdd-spec` grounding pass had done — every round checked
the *visual styling* of the reference, never its actual DOM composition or the docs site's own
live nav styling).

**Gap 1 — missing `SidebarMenu`/`SidebarMenuItem` wrapper.** The Chosen Approach above (FR-1/FR-2)
composed `SidebarGroup > Collapsible > CollapsibleTrigger(SidebarMenuButton) >
CollapsibleContent(SidebarMenuSub)` directly — omitting the `SidebarMenu`/`SidebarMenuItem`
(`<ul>`/`<li>`) wrapper shadcn's own "Collapsible SidebarMenu" reference pattern always includes.
**Corrected** to `SidebarGroup > SidebarGroupContent > SidebarMenu > SidebarMenuItem > Collapsible
> ...` (verbatim structure the user supplied, sourced from shadcn's own component tree). The
chevron's group-scope class also moved from reusing `SidebarMenuButton`'s pre-existing
`group/menu-button` name to a dedicated `group/collapsible` set on the `Collapsible` root itself —
matching shadcn's own "Collapsible SidebarGroup" doc example's naming exactly, not a lookalike
assembled from a different precedent in the file.

**Gap 2 — a real bug in the vendored primitive, misread as a styling choice.** The user's
complaint ("looks like collapsible sections over a sheet, not a slick shadcn sidebar") traced back
not to any FR-1/FR-2/FR-3 decision above, but to `ui/sidebar.tsx` itself:
`SidebarMenuButton`/`SidebarMenuSubButton` render `data-active={isActive}` unconditionally, and
`sidebarMenuButtonVariants`'s bare `data-active:bg-sidebar-accent` Tailwind variant matches on
attribute **presence**, not value — `data-active="false"` still satisfies `[data-active]`. Every
row was therefore permanently painted with the accent background regardless of actual state,
which is what read as "chunky pill buttons" rather than shadcn's own flat, typography-driven
docs-nav look. **Fixed** in the vendored file: `data-active={isActive || undefined}` at both call
sites, documented in `xstockstrat-ui/CLAUDE.md`'s functional-variant-customization list (survives
a future `apply --preset` regeneration the same way the `button.tsx`/`badge.tsx` customizations
do). This was never a design-level decision to revisit — none of the 3 rounds' Chosen Approach or
Rejected Alternatives touched `data-active` semantics at all; it was a latent primitive bug,
uncovered only once someone looked at real rendered pixels next to the real reference.

**What did NOT change**: the "no group merge" decision (Round 1's core finding), the
`sectionStart`-driven purely-visual section labels (Round 3's settled ARIA-scope-vs-complexity
trade-off), the "Settings" label wording trade-off, and the ordering-invariant JSDoc mitigation —
all still hold exactly as approved. This addendum corrects composition and a primitive defect, not
the feature's core visual-hierarchy decisions.

**Process lesson** (candidate for a fresh `insights.md`/`fails.md` entry, see `context.md`): a
design debate that verifies a proposal's *visual styling* against a reference without also
checking the reference's *actual DOM composition* (component tree, not just how it looks) can
approve a structurally-incomplete design that happens to look "close enough" until someone
compares rendered output pixel-by-pixel. Neither `design-proposer` nor `design-adversary` fetched
`ui.shadcn.com`'s live docs pages in any of the 3 rounds — all evidence was `recon.md`'s codebase
citations, which by construction can only describe *our own* code, never the reference it's
supposed to match.

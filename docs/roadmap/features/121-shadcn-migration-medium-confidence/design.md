# Design: shadcn-migration-medium-confidence

**Created**: 2026-08-08
**Last Updated**: 2026-08-08 (Round 3 — user-directed override on FR-13; see below)
**Rounds**: 2 (full; termination: approved) + Round 3 (user-directed override, not a debate round)
**Approved by**: subagent synthesis 2026-08-08 for rounds 1-2 (**not** gated through an interactive
user AskUserQuestion prompt — see Process Note below); **FR-13 specifically re-decided by explicit
user confirmation in Round 3**, superseding the round-2 self-run recommendation — see `## Round 3 —
user-directed override`.
**Grounded in**: recon.md

---

## Process Note (read before the rest of this file)

This design session ran as a non-interactive subagent with no `Task` (subagent-spawning) tool and no
`AskUserQuestion` tool available in its environment — both were called for by the orchestrating
session's instructions but do not exist here. Rather than skip the adversarial debate or silently
guess at the FR-13 fork, this session ran the full proposer/adversary debate **itself**, in two
rounds, playing both roles directly and mediating between them exactly as `/sdd-design` would (P-01/
P-02 honored in substance), and recorded the complete reasoning below so a human — or the calling
orchestrator — can review and override before this design is treated as final.

**The FR-13 keep-vs-replace call and the round-2 approval below were recommendations from that
self-run debate, not confirmed user decisions, at the time this file was first written.** That gap
has since been closed for FR-13 specifically: see `## Round 3 — user-directed override` below, where
the user was asked directly and overrode round 2's KEEP AS-IS with REPLACE. The rest of this design
(FR-1 through FR-12) was never re-litigated and still carries the original self-run-debate caveat.

---

## Chosen Approach

**1. New primitives (FR-1/FR-2/FR-3).** Add `ui/switch.tsx`, `ui/slider.tsx`, `ui/collapsible.tsx` via
`npx shadcn@latest add switch slider collapsible` against the existing `components.json` preset
(`recon.md` § Codebase Map: preset `radix-rhea`, `radix-ui@^1.6.7` already a dependency — no new
package needed). If the CLI is unavailable at execute time, hand-author matching the confirmed
post-119 shape: plain function component (`function X({ className, ...props })`), `cva()` + `cn()`
from `ui/utils.ts`, `data-slot` props, **no** `React.forwardRef`/`displayName` — the same shape
`ui/badge.tsx:35`, `ui/select.tsx:9,27,53`, and `ui/sheet.tsx:10,42` already use (`recon.md` §
Codebase Map; independently confirmed against sibling `120`'s recon.md finding). Swap FR-1
(`config-ui/sources/page.tsx:504-515`), FR-2 (`insights/screener/page.tsx:396-405`), FR-3
(`accountShared.tsx:116-167`) onto them, like-for-like.

**2. Badge reuse (FR-10).** Route `AlertStream.tsx:46-58`'s unread-count pill through the existing
`ui/badge.tsx` `Badge` (it already carries text — `9+` / a number — and Badge's `default`/
`destructive` variants map directly onto the existing `hasHighSeverity` conditional). For
`AccountSelector.tsx:64-77`'s un-lettered 2px status dot: attempt `Badge` first; if its box model
(`h-5`, `w-fit`, `gap-1`, `rounded-2xl` — sized for padded text, per `recon.md` § Risks) actively
fights a bare dot with override classNames worse than the current 8-line hand-rolled `<span>`, keep
the hand-rolled span and record the exception with a one-line comment in the file plus a note in
`context.md` — this is a legitimate "no clean shadcn-primitive fit" case, not a corner cut (the
product spec's own Out of Scope precedent — "12 bespoke widgets... correctly not reinvented" — covers
exactly this kind of call). Resolve which way it falls at `/sdd-execute` time with a real render, not
here.

**3. Table reuse (FR-11).** Route `insights/strategies/[id]/page.tsx:470-500` and
`insights/screener/page.tsx:~555-605` (re-verify the exact range at `/sdd-spec` time — `recon.md` §
Risks flags it as approximate) onto the existing `ui/table.tsx` family, matching the consumption
pattern already live in `config-ui/audit/page.tsx:29-52` and `LiveStrategiesPanel.tsx:35-64`
(`recon.md` § Patterns to REUSE). `strategies/[id]/page.tsx`'s selectable-row interaction
(`role="button"`, `aria-selected`, keyboard handler) is preserved as props/handlers passed straight
onto `TableRow` — `TableRow` is a plain `<tr {...props}>` (`table.tsx:41-50`) with no interaction
logic of its own to conflict with, so this is additive, not a rewrite of the interaction.

**4. `FilterToolbar` (FR-12).** New `src/components/shared/FilterToolbar.tsx`, a **slot-based control
row**, not a layout-mode switch — this is the direct outcome of the round-1/round-2 debate (see
Rejected Alternatives). It owns only the filter *controls*: an optional `search` slot (`{value,
onChange, placeholder}`), an N-length `filters` array of `{value, onValueChange, options, ariaLabel}`
(each rendered as an existing `ui/select.tsx` `Select`), an optional `dateRange` slot (`{from, to,
onFromChange, onToChange}`), an `activeFilterCount` + `onClear`, and a `clearPlacement: 'inline' |
'trailing'` discriminant that controls only where the Clear button renders relative to the count (4
lines of JSX, not two component trees) — `'inline'` matches `AccountsModule.tsx`'s
CardHeader-badge-plus-button row, `'trailing'` matches `OrderFilters.tsx`'s below-the-grid button. The
surrounding `Card`/`CardHeader`/`CardContent` chrome — which genuinely differs between the two call
sites (`recon.md` § Risks) — stays owned by each call site, not by `FilterToolbar`, so the shared
component never has to reconcile two different page-chrome shapes into one. Both
`AccountsModule.tsx:55-135` and `OrderFilters.tsx:85-138` render it with no duplicated
toolbar-composition JSX remaining (acceptance criterion 4).

**5. Navigation Menu replacement (FR-13) — REPLACE, add `ui/navigation-menu.tsx`.** Supersedes the
round-1/round-2 KEEP AS-IS recommendation below — see `## Round 3 — user-directed override`. Add
`src/components/ui/navigation-menu.tsx` (CLI primary path: `npx shadcn@latest add navigation-menu`
against the existing `components.json` preset; hand-authored fallback per the confirmed post-119
shape — plain function components, `data-slot`, `cn()`, no `forwardRef`/`displayName` — if the CLI is
unavailable, matching `recon.md` § Patterns to REUSE). Wrap `PlatformHeader.tsx`'s two desktop nav
regions in `NavigationMenu`/`NavigationMenuList`/`NavigationMenuItem`/`NavigationMenuLink`:
- **Row-1 Primary tabs** (`recon.md` § Codebase Map Round 3 addendum: `PlatformHeader.tsx:170-190`) —
  one `NavigationMenuItem`/`NavigationMenuLink` per `NAV_GROUPS` entry, `NavigationMenuLink` used
  standalone (no `Trigger`/`Content` pairing — there is no dropdown here), `render={<Link
  href={group.items[0].href} />}` to preserve Next.js client-side routing, carrying the exact same
  `aria-current={isActive ? 'page' : undefined}` and `cn(...)` active/inactive classes the current
  `<Link>` carries. The `NavigationMenu` root itself takes the `aria-label="Primary"` and
  `className="hidden sm:flex items-center gap-1 flex-1"` the current `<nav>` carries, and passes
  `viewport={false}` (no dropdown flyout exists, so the `Viewport`/`Indicator` machinery is unused
  weight, not a feature this migration adds).
- **Row-2 Section links** (`PlatformHeader.tsx:271-287`, nested inside the `:260-288` row-2 wrapper) —
  same pattern, one `NavigationMenuItem`/`NavigationMenuLink` per `activeItems` entry, `aria-label=
  "Section"` on the root, `aria-current={isItemActive(pathname, item) ? 'page' : undefined}` preserved.
  The sibling `aria-label="Breadcrumb"` `<span>` at `:261` is **not** inside this `<nav>` and is left
  completely untouched — it belongs to sibling `120`'s FR-7 Breadcrumb migration.
- **`BottomTabBar.tsx`**'s single flat nav (`:28-54`, `aria-label="Mobile primary"`,
  `data-testid="mobile-tab-bar"`) gets the same treatment: `NavigationMenu` root carries the
  `aria-label`/`data-testid`/fixed-positioning classes, `NavigationMenuItem` per `TABS` entry (each
  `flex-1` so the four tabs still split the width evenly — the equal-width class moves from the `Link`
  itself to the `NavigationMenuItem` `<li>`, since `NavigationMenuList` renders a `<ul>`/`<li>`
  structure the current flat-`<Link>` markup doesn't have), `aria-current` preserved.
- **Mobile `Sheet` disclosure is explicitly OUT of scope** (`PlatformHeader.tsx:195-255`) — it is
  accordion-like expand/collapse (`aria-expanded`, local `useState`), not a flat-link nav, so it is
  structurally not what `NavigationMenu` models; sibling `120`'s FR-8 Accordion migration already
  targets this same `:209-253` range. This call is made explicitly here, not left implicit: FR-13 is
  scoped to the two `PlatformHeader.tsx` desktop `<nav>` regions and `BottomTabBar.tsx`'s single nav
  only.

Preserving `role=navigation`/`aria-label`s exactly and `role=link` on every item (`NavigationMenuLink`
renders an anchor-equivalent element, not a `button`/`menuitem`, when used standalone per `recon.md`'s
verified API) keeps `e2e/nav-reachability.spec.ts`'s selectors (`recon.md` § Codebase Map Round 3
addendum: lines 60/61/65/67/68/70-71) passing without a spec rewrite. Consumer-surface consequence:
the shared nav shell (which every UI segment renders) changes markup but not behavior or the reachable
route set, so there is no regression to the `/trader`/`/insights`/`/config-ui`/`/accounts` consumer
surfaces named in product-spec's `## Consumer Surface(s)`.

**Consumer surface.** All five points above land directly in the named UI segments
(`recon.md`/product-spec `## Consumer Surface(s)`: `/insights`, `/trader`, `/config-ui`,
`/accounts`) — no backend service is touched, so there is no separate "wire it to the surface" step;
the markup swap **is** the surface change.

## Rejected Alternatives

- **FilterToolbar as a `layout: 'header-badge' | 'grid'` variant prop** (round-1 proposer's first
  cut) — rejected: two full layout modes in one component is closer to "two copies glued together
  behind a switch" than a DRY consolidation, which is what C-10 asks for. The chosen slot-based
  design instead pushes layout ownership back to each call site and only parameterizes the one thing
  that's genuinely a binary choice (Clear-button placement).
- **Force `AccountSelector.tsx`'s un-lettered status dot through `Badge` unconditionally** — rejected
  as a blanket rule: `Badge`'s box model is built for padded text pills (`recon.md` confirms
  `h-5`/`w-fit`/`gap-1`/`rounded-2xl`), and a bare 2px dot fighting that with overrides could produce
  a worse result than the existing 8-line span. Chosen approach defers the final call to a real
  render at execute time rather than mandating "every FR-10 site must use Badge" as an inflexible
  rule.
- **KEEP AS-IS: leave `PlatformHeader.tsx` row-1/row-2 nav and `BottomTabBar.tsx` as hand-built
  `<Link>` rows (FR-13)** — this was the round-1/round-2 debate's converged recommendation, and it
  held until `## Round 3 — user-directed override` below. It is recorded here, not deleted, because it
  was a real (reasoned, not lazy) recommendation that a later explicit user decision superseded — see
  Round 3 for why it no longer stands. The original three grounds for KEEP AS-IS:
  1. **Overbuilt for what's there** (CF-N4 litmus, root `CLAUDE.md`): `NavigationMenu`'s
     dropdown/flyout value — `Indicator`/`Viewport`, hover-triggered submenus, roving-tabindex
     keyboard nav across a multi-level menu — has no target in a flat, one-level, route-driven nav
     (`recon.md` § Codebase Map: three `<Link>`-only regions, zero dropdown/flyout behavior anywhere
     in `PlatformHeader.tsx` or `BottomTabBar.tsx`).
  2. **Two ways to apply it, both looked bad at the time.** `NavigationMenuLink`-only (no dropdowns)
     looked like a Radix wrapper around what a plain `<Link>` already does — extra dependency surface
     for apparently zero functional gain. Actually using dropdown/flyout capability would invent new
     interaction the product doesn't have today, crossing product-spec's own Out of Scope line.
     (Round 3 resolves this: the user's directive is specifically the standalone-`Link`-inside-`Item`
     usage, i.e. option 1, accepting the primitive-consistency value as the point, not a defect.)
  3. **Perceived regression risk to an existing C-10(a) test.** `e2e/nav-reachability.spec.ts`
     (`recon.md` § Codebase Map) walks the *rendered* shell by role/label — the debate assumed a
     `NavigationMenu` rewrite would change the DOM shape enough (trigger buttons, portalled content,
     `role="menu"` semantics) to need selector rework. Round 3's grounding shows this assumption was
     too pessimistic for the standalone-`Link` pattern specifically: `NavigationMenuLink` used without
     `Trigger`/`Content` renders as a plain link-equivalent element, not a menu trigger, so
     `role=navigation`/`role=link`/`aria-current` are preservable without a spec rewrite (Chosen
     Approach point 5 above).
  The mobile `BottomTabBar` case was argued as even weaker (four flat links, no expand/collapse) —
  Round 3 applies the same standalone-`Link` pattern there for consistency with `PlatformHeader.tsx`,
  since the user's directive names both files.

## Round 3 — user-directed override

This design session's original Chosen Approach point 5 (KEEP AS-IS) and its `## Open Risks` item 1
were explicit that the FR-13 call was a **self-run debate's recommendation, not a confirmed user
decision** — see `## Process Note` at the top of this file, and `feature.md`'s Status History /
`context.md`'s 2026-08-08 sdd-design session entry, both of which flagged the gap and asked for
explicit human re-affirmation before `/sdd-spec`/`/sdd-execute` treated it as final.

That re-affirmation has now happened, and it went the other way: **the user was asked directly and
overrode the KEEP AS-IS recommendation.** The directive: `PlatformHeader.tsx`'s and `BottomTabBar.tsx`'s
hand-built nav must actually be replaced with a Radix Navigation Menu primitive
(`ui/navigation-menu.tsx`), using the standalone `NavigationMenuLink`-inside-`NavigationMenuItem`
pattern (no dropdowns/flyouts — the round-1/round-2 debate's "extra dependency surface for zero
functional gain" reading of this specific usage is not how the user weighed it; consistency with the
rest of this feature's primitive-migration work was the deciding factor, not a claimed new nav-UX
capability).

**This is a supersession, not a silent reversal.** The prior recommendation is preserved verbatim in
`## Rejected Alternatives` above (now re-labeled "KEEP AS-IS" as the rejected alternative, replacing
`NavigationMenu` as what used to be rejected) precisely so a future reader can see both what the
self-run debate concluded and why a human overrode it, rather than the record being quietly rewritten
as if REPLACE had been the answer all along. The three original KEEP AS-IS grounds were reasoned, not
careless — the override does not invalidate them as reasoning, it just weighs "match the rest of this
migration's primitive coverage" more heavily than "avoid an unforced dependency for a flat nav," which
is a legitimate call only a human principal can make since it is a product/consistency preference, not
a correctness question. `recon.md` § Codebase Map's Round 3 addendum re-grounds the concrete migration
plan (exact line ranges, the verified shadcn Navigation Menu API, the e2e contract) so Chosen Approach
point 5 above cites real evidence, not just "the user said so."

**What changes as a result**: `implementation-spec.md` FR-13 goes from "no code step" to four real
numbered steps (primitive + migrate `PlatformHeader.tsx` + migrate `BottomTabBar.tsx` + e2e
regression), and acceptance criterion 1's "`ui/navigation-menu.tsx` exists only if FR-13's evaluation
concludes replacement is warranted" (product-spec.md) is now satisfied — the evaluation concluded (by
user directive) that it is warranted.

## Open Risks

- [x] **RESOLVED (Round 3, 2026-08-08).** FR-13's keep-as-is recommendation was not confirmed through
  an interactive user gate at design time (no `AskUserQuestion` tool was available in that session).
  The user has since been asked directly and **overrode** it — REPLACE, per `## Round 3 —
  user-directed override` above. `implementation-spec.md` now carries real numbered steps for FR-13;
  no further re-affirmation needed.
- [ ] **This entire design session ran without `Task`/`AskUserQuestion` tools** — the proposer/
  adversary debate was self-run by one agent instead of two independently-spawned subagents mediated
  by an orchestrator. The reasoning is recorded in full for audit, but it did not get the benefit of
  genuinely independent adversarial pressure a separately-spawned `design-adversary` subagent would
  apply. Flagged for the calling orchestrator's awareness — to be reviewed at the orchestrator's
  discretion, no specific step.
- [ ] **`insights/screener/page.tsx:~555-605` (FR-11) is an approximate range** (product-spec's own
  `~` marker, not re-verified this recon pass) — `/sdd-spec` must re-grep the exact boundaries before
  citing a line range in a step.
- [ ] **`AccountSelector.tsx`'s status-dot Badge-fit is not pre-decided** — resolve with a real render
  comparison at execute time (see Chosen Approach point 2) — to be addressed when FR-10 executes.
- [ ] **FR-9's row-click-to-external-panel interaction on `LiveStrategiesPanel.tsx` doesn't literally
  match `Accordion`'s per-item expand-in-place model** (`recon.md` § Risks) — out of this round's
  build order (FR-9 is blocked on `120` merging), but recorded so it isn't lost — to be addressed when
  FR-9 is specced, after `120` lands.

## Constitution Rules Touched

- `C-10` (integration completeness across shared/duplicated surfaces) — honored by: FR-12's
  `FilterToolbar` updates *both* `AccountsModule.tsx` and `OrderFilters.tsx` in the same feature, with
  acceptance criterion 4 requiring zero duplicated toolbar JSX remaining in either file. FR-13
  (Round 3: REPLACE) touches both nav-rendering surfaces (`PlatformHeader.tsx` desktop rows,
  `BottomTabBar.tsx`) in the same feature, so the shared `NAV_GROUPS` data model has no lingering
  hand-built consumer left after this feature lands — the mobile `Sheet` disclosure is the one
  intentional exception, recorded as out of scope, not an omission. FR-13 doesn't invoke C-10(a) (no
  new route/page is added) or C-10(c) (no shared mutable resource) — confirmed not applicable.
- `C-14` (name the consumer surface, keep it in scope) — honored by: product-spec's `## Consumer
  Surface(s)` names every touched UI segment; this design's Chosen Approach confirms each FR lands
  directly in a named segment with no backend-only step left stale.
- `C-12`/`C-13` (test mocks from the canonical fixture home) — honored by: `recon.md` § Patterns to
  REUSE confirms `e2e/fixtures/INVENTORY.md` already carries fixtures for every domain object this
  feature's e2e specs touch (accounts, orders, strategies, watchlists) — no new fixture module
  expected; `/sdd-spec` re-confirms per-step.
- `P-04` (phase-gate approval, recorded) — **added 2026-08-09 (round-4 cross-check audit finding)**,
  previously omitted from this list despite being the exact subject of this feature's design history.
  **Only partially honored**: Round 3's FR-13 decision (keep vs. replace) went through a real,
  recorded `AskUserQuestion` gate — P-04 is satisfied for FR-13 specifically. **FR-1/FR-2/FR-3/
  FR-10/FR-11/FR-12 — the bulk of this feature's scope, Steps 1–16 of `implementation-spec.md` —
  were never re-gated.** They rest entirely on Rounds 1-2's self-run debate (no `Task`/
  `AskUserQuestion` tool available in that session — see § Process Note above), which was
  explicitly flagged there as provisional pending real confirmation, and that confirmation never
  came for anything except FR-13. This includes real design choices an independent reviewer might
  contest: `FilterToolbar`'s slot-based shape (vs. a layout-mode-switch), the Badge/Table reuse
  calls, and the `AccountSelector.tsx` status-dot fallback decision. `/sdd-execute`'s own per-step
  confirmation gate provides a second checkpoint before any of these actually get built, but the
  *design* itself should not be read as fully P-04-compliant.
- `F-*` (Floor) — none breached. No proto, migration, or config-key change; no security/auth
  surface touched; no applied migration edited.

## Rounds

**2** (full mode, mandated minimum met) + **Round 3 (user-directed override, not a debate round)**.
Termination of the original 2-round debate: converged synthesis after round 2 — proposer and adversary
reached full agreement on both open questions (FilterToolbar's slot shape, FR-13 keep-as-is) with no
unresolved Floor breach. See Process Note above: this was a self-run debate (no `Task`/
`AskUserQuestion` tools available), not a tool-mediated, user-gated approval. Round 3 is not a further
debate round — it is the calling orchestrator putting the flagged FR-13 gap directly to the user (as
Open Risks item 1 asked for) and recording the answer: **REPLACE**, overriding round 2's KEEP AS-IS.
See `## Round 3 — user-directed override` above for the full record.

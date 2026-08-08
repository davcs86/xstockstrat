# Design: shadcn-migration-medium-confidence

**Created**: 2026-08-08
**Rounds**: 2 (full; termination: approved)
**Approved by**: subagent synthesis 2026-08-08 — **not gated through an interactive user
AskUserQuestion prompt; see Process Note below**
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

**The FR-13 keep-vs-replace call and the round-2 approval below are both recommendations from that
self-run debate, not confirmed user decisions.** The calling orchestrator should treat `design.md`'s
Chosen Approach as an evidence-backed proposal and re-affirm it (or override) before `/sdd-spec`
builds a numbered plan on top of it — this is called out again in the final report.

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

**5. Navigation Menu evaluation (FR-13) — KEEP AS-IS, do not add `ui/navigation-menu.tsx`.**
`PlatformHeader.tsx:156-291` and `BottomTabBar.tsx:25-56` stay hand-built `<Link>` rows. Full
reasoning in Rejected Alternatives below (this was the round-1→round-2 debate's central question).
Consumer-surface consequence: none — the shared nav shell (which every UI segment renders) is
unchanged, so there is no regression to the `/trader`/`/insights`/`/config-ui`/`/accounts` consumer
surfaces named in product-spec's `## Consumer Surface(s)`, and `e2e/nav-reachability.spec.ts`
(`recon.md` § Codebase Map) keeps passing unmodified.

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
- **Replace `PlatformHeader.tsx` row-1 tabs and `BottomTabBar.tsx` with a Radix `NavigationMenu`
  (FR-13)** — rejected after both debate rounds, on three independent grounds:
  1. **Overbuilt for what's there** (CF-N4 litmus, root `CLAUDE.md`): `NavigationMenu`'s actual value
     — `Indicator`/`Viewport`, hover-triggered flyout submenus, roving-tabindex keyboard nav across a
     multi-level menu — has no target here. The nav is flat, one level, entirely route-driven
     (`recon.md` § Codebase Map: three `<Link>`-only regions, zero dropdown/flyout behavior anywhere
     in `PlatformHeader.tsx` or `BottomTabBar.tsx`).
  2. **Two ways to apply it, both bad.** Using `NavigationMenu.Link`-only (no dropdowns) is a Radix
     wrapper around what a plain `<Link>` already does — extra dependency surface and bundle weight
     for zero functional gain. Actually using its dropdown/flyout capability would invent new
     interaction the product doesn't have today, which crosses product-spec's own Out of Scope line
     ("Any visual/behavioral redesign beyond swapping the underlying markup... like-for-like
     substitution only").
  3. **Unforced regression risk to an existing C-10(a) test.** `e2e/nav-reachability.spec.ts`
     (`recon.md` § Codebase Map) walks the *rendered* shell by role/label and asserts breadcrumb
     correctness — a `NavigationMenu` rewrite changes the DOM shape enough (trigger buttons, portalled
     content, `role="menu"` semantics) that this spec's selectors would likely need rework, for a
     component swap the audit itself flagged as only "arguably" a fit.
  The mobile `BottomTabBar` case is even weaker: four flat links, no expand/collapse at all — nothing
  a `NavigationMenu` adds there beyond a mobile-tab-bar's job of staying simple and fast.

## Open Risks

- [ ] **FR-13's keep-as-is recommendation was not confirmed through an interactive user gate** — no
  `AskUserQuestion` tool was available in this session. Recorded as the debate's converged
  recommendation with full reasoning above; the calling orchestrator/user should explicitly re-affirm
  or override before `/sdd-spec` locks it in as a non-step (i.e., before treating "no
  `ui/navigation-menu.tsx`, no `PlatformHeader.tsx`/`BottomTabBar.tsx` edits" as settled). — to be
  confirmed before or during `/sdd-spec`.
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
  acceptance criterion 4 requiring zero duplicated toolbar JSX remaining in either file. FR-13's
  keep-as-is doesn't invoke C-10(a) (no new route/page is added) or C-10(b)/(c) (no authoritative
  displayed value, no shared mutable resource) — confirmed not applicable.
- `C-14` (name the consumer surface, keep it in scope) — honored by: product-spec's `## Consumer
  Surface(s)` names every touched UI segment; this design's Chosen Approach confirms each FR lands
  directly in a named segment with no backend-only step left stale.
- `C-12`/`C-13` (test mocks from the canonical fixture home) — honored by: `recon.md` § Patterns to
  REUSE confirms `e2e/fixtures/INVENTORY.md` already carries fixtures for every domain object this
  feature's e2e specs touch (accounts, orders, strategies, watchlists) — no new fixture module
  expected; `/sdd-spec` re-confirms per-step.
- `F-*` (Floor) — none breached. No proto, migration, or config-key change; no security/auth
  surface touched; no applied migration edited.

## Rounds

**2** (full mode, mandated minimum met). Termination: converged synthesis after round 2 — proposer
and adversary reached full agreement on both open questions (FilterToolbar's slot shape, FR-13
keep-as-is) with no unresolved Floor breach. See Process Note above: this was a self-run debate
(no `Task`/`AskUserQuestion` tools available), not a tool-mediated, user-gated approval.

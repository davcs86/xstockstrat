# Context: shadcn-sidebar-visual-rewrite  (archived 2026-08-16)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-08-16 — /sdd-archiver

**What**: Mobile sidebar canonical "Collapsible SidebarMenu" composition fix — brought the vendored offcanvas sidebar up to shadcn's reference visual hierarchy. Replaced flat pill list with `CollapsibleTrigger`/`CollapsibleContent`/`SidebarMenuSub`/`SidebarMenuSubItem` nesting, chevron rotation indicators, `SidebarGroupLabel` section headers (driven by `sectionStart: true` flag on `NavGroup`), and the vendored `data-active={isActive || undefined}` bug fix. 4 steps. Executed on harness-assigned branch `claude/implement-124-e48xkn` (same pattern as feature 124).

**Why (irrecoverable rationale)**: `data-open:*` CSS in vendored `sidebar.tsx:449` is dead — `CollapsibleTrigger` emits `data-state`, never a literal `data-open` attribute (verified against `@radix-ui/react-collapsible` source at spec time). The working in-file precedent is `sidebar.tsx:215`'s `group-data-[side=right]:rotate-180`. `data-active={isActive}` is a vendored primitive bug: Tailwind's bare `data-active:bg-sidebar-accent` variant matches on attribute presence, not value — `{false}` still renders the attribute and fires the style (fix: `{isActive || undefined}`). `NAV_GROUPS` has 2 order-significant consumers: the route-based active logic and the section-grouping render — reordering entries changes both the visual hierarchy and which item gets the active indicator. `fullPage: true` misleads for fixed-position overlays (see Fails). Post-design user visual review found the design/implementation omitted shadcn's `SidebarMenu`/`SidebarMenuItem` wrapper around each collapsible group — user supplied the correct DOM structure; corrected and documented in design.md ADDENDUM.

**Rejected alternatives**:
- Chevron group named `group/menu-button` (design.md FR-1 spec) — actual implementation uses `group/collapsible` (Collapsible root, matching shadcn's own naming convention); this is a permanent deviation, not a regression.
- Merging nav groups to reduce DOM nesting — rejected: would lose `SidebarContent` gap-2 spacing between groups.
- Using `aria-labelledby`/`role="group"` for section headers — rejected: `SidebarGroup`'s implicit `generic` role wouldn't reliably expose the association, and each `SidebarMenuButton` already has a correct accessible name (design.md round 2).
- Active indicator via `data-active` class styling — changed to typography-only after discovering the attribute-presence bug was the "chunky pill" root cause, not a styling choice.

**Scars & gotchas**:
- `data-open:*` classes in vendored `ui/sidebar.tsx` are dead CSS (no producer emits `data-open`) — a future `npx shadcn add sidebar` would re-introduce this dead CSS if the upstream vendor hasn't fixed it.
- `data-active={isActive}` (without `|| undefined`) in vendored `sidebar.tsx` causes presence-based Tailwind variants to fire for all items — also likely re-introduced by a fresh `npx shadcn add sidebar`.
- `SidebarMenu`/`SidebarMenuItem` wrappers are required around each collapsible group — omitting them breaks shadcn's own DOM composition; discovered from user's reference and not derivable from design.md alone.
- Playwright `fullPage: true` misrepresents fixed-position overlay height — see Fails.
- Vitest alias trap (`@/` imports in shadcn-regenerated files break Vitest without `resolve.alias`) — pre-existing; documented in feature 119's Ledger entry (insights.md:1361).

**Permanent deviations**:
- Chevron scope renamed from `group/menu-button` to `group/collapsible` (Collapsible root, matching shadcn's naming).
- Added `SidebarGroupContent > SidebarMenu > SidebarMenuItem` wrappers (required by shadcn's own DOM structure; not in design.md spec).
- Active indicator changed to typography-only (root cause was the `data-active` attribute-presence bug, not a styling preference).
- Inline `sectionStart` label rendering (not a separate `SidebarGroup` as design.md implied).

**Cross-feature signal**: `sidebar.tsx` bugs (`data-open:*` dead CSS; `data-active={false}` presence match) are likely present in other shadcn-generated components that use `data-open` or bare `data-*:` variants — audit the full vendored component set.

**Deferred follow-ons**: screenshot-regression tooling (noted as absent; all visual verification was manual); desktop sidebar (out of scope — this feature only targeted the mobile offcanvas sidebar).

**Ledger entries written**: insights.md 0 NEW (2 DUPs skipped: insights.md:1352, insights.md:1375); fails.md 2 NEW (`data-active` attribute-presence bug; `fullPage: true` misleads for fixed overlays) + 4 DUPs skipped (fails.md:971, fails.md:973, fails.md:1017, fails.md:1038).

**Runtime-invariant recommendations (→ /context-constitution)**:
- UI-N1: all bare Tailwind `data-*:` variants require `data-x={value || undefined}`, not `data-x={value}` — `{false}` still renders the attribute and activates presence-based variants. Applies to all vendored shadcn primitives.
- UI-N2: `data-open:*` CSS in `ui/sidebar.tsx` is dead — `CollapsibleTrigger` emits `data-state`, not `data-open`; any future `data-open:` addition to shadcn primitives will silently be inert.

**Pruned artifacts**: product-spec.md, recon.md, design.md, implementation-spec.md — last present at this commit; recoverable via `git show <pre-archive-SHA>:<path>`.

# Product Spec: shadcn-ui-migration

**Created**: 2026-08-08

---

## Problem Statement

`xstockstrat-ui`'s `src/components/ui/` primitives (button, card, input, select, table, sheet,
badge, separator, skeleton, combobox) were hand-written to mimic shadcn/ui's conventions (`cva`,
`cn()`, Radix + CSS-variable theming) but were never scaffolded through the actual shadcn CLI.
There is no `components.json`, so there's no registry-tracked source of truth for these
components, no `shadcn add` workflow to pull new primitives or upstream fixes, and drift between
this hand-rolled copy and the real shadcn/ui project accumulates silently. The user wants the UI
layer to use shadcn/ui's own formal tooling instead.

## User Story

As an `xstockstrat-ui` developer, I want the component layer scaffolded and managed by the
official shadcn/ui CLI, so that adding or updating a primitive is a tracked `shadcn add`/`diff`
operation instead of hand-maintained copy-paste, and the theme follows shadcn's documented
CSS-variable convention exactly.

## Functional Requirements

FR-1. Initialize the shadcn/ui CLI in `services/xstockstrat-ui` (`components.json`), configured
      for the existing Next.js App Router + TypeScript + Tailwind setup (style: `new-york` or
      `default` — decide in design; path aliases matching current `tsconfig.json`).
FR-2. Re-generate every primitive currently under `src/components/ui/` (button, badge, card,
      combobox, input, select, separator, sheet, skeleton, table) via the shadcn CLI
      (`npx shadcn@latest add <component>`), replacing the hand-rolled file with the CLI-emitted
      one, then re-apply this app's existing variant additions (e.g. `Button`'s `buy`/`sell`
      variants) as documented customizations on top of the generated file — not by hand-editing
      away from what the CLI would regenerate.
FR-3. Align `tailwind.config.js` and `src/app/globals.css` CSS variables to shadcn's canonical
      theme output (same token names/roles the CLI would emit for the chosen style/base color),
      while preserving the existing Nocturne dark HSL values and the `buy`/`sell`/`paper`
      semantic color extensions (feature 083) — these are additive to shadcn's model already
      (`hsl(var(--x))` tokens), not something shadcn replaces.
FR-4. Every existing usage site (35+ files under `src/` importing from `components/ui`) continues
      to compile and render unchanged visually and behaviorally — this is a tooling/source
      migration, not a redesign.
FR-5. Document the new component-add workflow (`npx shadcn@latest add <name>`) and the
      variant-customization convention in `services/xstockstrat-ui/CLAUDE.md`.

## Out of Scope

- Any visual redesign, new color palette, or new component variants beyond what already exists.
- Adding new shadcn primitives not currently used anywhere in the app (e.g. `accordion`,
  `tooltip`, `dialog` beyond the existing `sheet`) unless a design-phase gap analysis finds an
  existing hand-rolled pattern that duplicates one (e.g. any inline dropdown/menu reimplementing
  what `dialog`/`popover` would give for free) — noted as an open question below, not assumed.
- Changing the `insights`/`trader`/`config-ui` route structure, business logic, or gRPC/BFF call
  chains.
- Migrating other services' UI code (none exists — `xstockstrat-ui` is the only frontend).

## Affected Services

- `xstockstrat-ui` — sole owner of the component layer being migrated.

## Consumer Surface(s)

- [x] **UI** — `xstockstrat-ui`, all three segments (`/trader`, `/insights`, `/config-ui`): every
      existing page/route continues to render through the migrated primitives. This is a
      component-implementation swap reachable everywhere the app is already reachable — no new
      pages, routes, or nav entries, so **C-10** `PLATFORM_SUBNAV` registration does not apply.
- [ ] **Agent**
- [ ] **None**

## Proto Contract Changes

- [x] No proto changes required

## Config Key Changes

- [x] No new config keys

## Database Changes

- [x] No schema changes

## Feature Workflow Notes

Branch to create: `feature/shadcn-ui-migration` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (`xstockstrat-ui`) — UI-only change, no proto/config/schema gate

## Acceptance Criteria

1. `services/xstockstrat-ui/components.json` exists and is a valid shadcn/ui config pointing at
   `src/components/ui`, `src/app/globals.css`, and `tailwind.config.js`.
2. Every primitive listed in FR-2 is present under `src/components/ui/` in the form the shadcn CLI
   would emit for this repo's `components.json` (verifiable via `npx shadcn@latest diff`), with
   this app's variant additions layered on top and clearly attributable (comment or isolated
   `cva` extension) so a future `shadcn add --overwrite` doesn't silently destroy them.
3. `tailwind.config.js` / `globals.css` CSS variables match shadcn's canonical token set; the
   Nocturne HSL values and `buy`/`sell`/`paper` tokens are unchanged in value.
4. `pnpm --filter xstockstrat-ui build`, the Vitest unit suite, and the Playwright e2e suite for
   all three segments pass with no behavior/visual regression.
5. `services/xstockstrat-ui/CLAUDE.md` documents the `shadcn add` workflow and the
   variant-customization convention.

## Open Questions

- [ ] Which shadcn style baseline (`new-york` vs `default`) most closely matches the current
      hand-rolled component markup/class structure, minimizing the diff `shadcn add --overwrite`
      would produce against each existing file? Resolve in `/sdd-design`.
- [ ] `combobox.tsx` is not a standalone shadcn registry component — shadcn composes it from
      `command` + `popover`. Design phase must decide: adopt the two-primitive composition (and
      keep a thin local `Combobox` wrapper), or keep the current single-file implementation as a
      documented, intentional exception to the "everything through the CLI" rule.
- [ ] No `docs/roadmap/ledger/fails.md` entry names a prior shadcn/Tailwind-theme migration
      attempt — no known trap to design around beyond the general cross-segment context-provider
      and E2E-re-run risks already on record (see ledger entries on shared/reused components).

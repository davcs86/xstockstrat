# Product Spec: shadcn-ui-migration

**Created**: 2026-08-08

---

## Problem Statement

`xstockstrat-ui`'s `src/components/ui/` primitives (button, card, input, select, table, sheet,
badge, separator, skeleton, combobox) were hand-written to mimic shadcn/ui's conventions (`cva`,
`cn()`, Radix + CSS-variable theming) but were never scaffolded through the actual shadcn CLI.
There is no `components.json`, so there's no registry-tracked source of truth for these
components, no `shadcn add` workflow to pull new primitives or upstream fixes, and drift between
this hand-rolled copy and the real shadcn/ui project accumulates silently.

**Scope decision (2026-08-08, explicit user direction during `/sdd-design`):** the user wants
**full** shadcn/ui adoption, not a hybrid that keeps the old Nocturne visual identity — including a
specific pre-selected visual preset (tweakcn share ID `bLTl5gh6`, style `radix-rhea`, applied via
the official `shadcn apply --preset` command). Live verification in a scratch dir (see
`design.md` § Live verification spikes) confirmed this preset targets **Tailwind v4** (its
generated CSS imports `shadcn/tailwind.css`, a module that does not resolve under this app's
pinned Tailwind v3.4.3) and ships a different dependency stack (`@base-ui/react`, unified
`radix-ui` package, `@tabler/icons-react`, `tw-animate-css`) including a fully rebuilt
compound-component `Combobox`. The user explicitly chose full adoption including the Tailwind v4
migration this implies (see product-spec Acceptance Criteria / design.md for the confirmed
tradeoff). This materially expands the original scope from "swap the component source" to
"migrate the build to Tailwind v4 and adopt the new component/dependency stack" — recorded here
per Constitution **C-11**/**P-04** (explicit user sign-off for a Commandment-level scope change),
not silently absorbed.

## User Story

As the `xstockstrat-ui` maintainer, I want the component layer, theme, and build tooling fully
migrated to official shadcn/ui tooling — including the specific visual preset I selected
(`bLTl5gh6`) — so the app runs on shadcn's actual current stack (Tailwind v4, Base UI, the
unified `radix-ui` package) instead of a hand-rolled approximation of an older shadcn convention.

## Functional Requirements

FR-1. Migrate `services/xstockstrat-ui` from Tailwind v3.4.3 to Tailwind v4 (PostCSS plugin
      swap `tailwindcss`+`autoprefixer` → `@tailwindcss/postcss`; `tailwind.config.js`'s existing
      `theme.extend` — colors, `fontFamily.mono`, `borderRadius`, `keyframes`/`animation` — ported
      to the CSS-first `@theme`/`@import` v4 convention; `tailwindcss-animate` → `tw-animate-css`).
      Root CLAUDE.md's Language Versions & Tooling table does not currently track a Tailwind
      version — add a row there as part of this step so the pin is governed going forward.
FR-2. Initialize the shadcn/ui CLI in `services/xstockstrat-ui` (`components.json`, style
      `radix-rhea`, `iconLibrary: tabler`, path aliases matching current `tsconfig.json`) and
      apply preset `bLTl5gh6` via `npx shadcn@latest apply --preset bLTl5gh6 --yes` (per the
      user's explicit selection) to regenerate every primitive currently under
      `src/components/ui/` (button, badge, card, combobox, input, select, separator, sheet,
      skeleton, table) plus any primitives the preset itself requires (`textarea`,
      `input-group` — confirmed additions from the live spike).
FR-3. Re-apply this app's functional (non-brand) customizations on top of the regenerated files:
      `Button`'s `buy`/`sell` variants, `Badge`'s `buy`/`sell`/`paper`/`live`/`warning`/`info`
      variants, `Skeleton`'s `data-testid`/`aria-hidden`, `TableRow`'s custom hover/selected
      classes — documented as customizations, not brand-identity preservation (the Nocturne dark
      HSL values themselves are **not** preserved; the preset's own dark palette replaces them
      per the user's explicit "no hybrid" direction).
FR-4. Rewrite the app's 3 `combobox.tsx` call sites (`ChartPanel.tsx`, `ComponentEditor.tsx`,
      `RuleEditor.tsx`) against the preset's Base-UI-driven compound `Combobox`
      (`Combobox`/`ComboboxTrigger`/`ComboboxContent`/`ComboboxList`/`ComboboxItem`/etc.) instead
      of the old single prop-based component — a real API rewrite, not an import swap.
FR-5. Every existing usage site (35+ files under `src/` importing from `components/ui`) continues
      to compile and render correctly under the new stack — visual appearance changes (new
      preset), but behavior (what each screen does) does not.
FR-6. Document the new component-add workflow (`npx shadcn@latest add <name>` /
      `apply --preset`), the variant-customization convention, and the Tailwind v4 setup in
      `services/xstockstrat-ui/CLAUDE.md`.

## Out of Scope

- Changing the `insights`/`trader`/`config-ui`/`accounts` route structure, business logic, or
  gRPC/BFF call chains.
- Migrating other services' UI code (none exists — `xstockstrat-ui` is the only frontend).
- Adding shadcn primitives beyond what the app currently uses **and** what preset `bLTl5gh6`
  itself requires as dependencies of the primitives being migrated (`textarea`, `input-group`) —
  no speculative additions (e.g. `accordion`, `tooltip`) beyond that closed set.

## Affected Services

- `xstockstrat-ui` — sole owner of the component layer being migrated.

## Consumer Surface(s)

- [x] **UI** — `xstockstrat-ui`, all **four** segments (`/trader`, `/insights`, `/config-ui`,
      `/accounts`): every existing page/route continues to render through the migrated
      primitives. `/accounts` (feature 051, OAuth authorized-apps + MCP tool catalog) was omitted
      from the original draft of this checklist; it imports `components/ui` primitives the same
      as the other three and has its own `e2e/accounts/` suite — corrected here per the
      `/sdd-design` adversarial round (2026-08-08). This is a component-implementation swap
      reachable everywhere the app is already reachable — no new pages, routes, or nav entries,
      so **C-10** `PLATFORM_SUBNAV` registration does not apply.
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

1. `services/xstockstrat-ui` builds and runs on Tailwind v4 (`@tailwindcss/postcss`,
   `tw-animate-css`); `tailwindcss`, `autoprefixer`, and `tailwindcss-animate` are removed.
2. `services/xstockstrat-ui/components.json` exists (style `radix-rhea`, `iconLibrary: tabler`)
   and preset `bLTl5gh6` is applied via `shadcn apply --preset` — confirmed reproducible the same
   way it was verified live in `/sdd-design` (see `design.md` § Live verification spikes).
3. Every primitive listed in FR-2 is present under `src/components/ui/` in the preset-emitted
   form, with this app's *functional* variant additions (`buy`/`sell`/`paper`/etc.) layered back
   on top and covered by the regression test in criterion 6 — the preset's own visual/token
   values are **not** overridden (no Nocturne-value preservation; see Problem Statement).
4. `combobox.tsx`'s 3 call sites (`ChartPanel.tsx`, `ComponentEditor.tsx`, `RuleEditor.tsx`) are
   rewritten against the new compound `Combobox` API and behave equivalently (same filtering/
   selection/free-text behavior each call site had before).
5. `pnpm --filter xstockstrat-ui build`, the Vitest unit suite, and the Playwright e2e suite for
   all **four** segments (`/trader`, `/insights`, `/config-ui`, `/accounts`) pass. Visual
   appearance is expected to change (new preset) — assert *behavior* parity, not pixel parity.
6. A regression check (Vitest unit test) asserts that `buttonVariants({variant:'buy'|'sell'})`
   and `badgeVariants({variant:'buy'|'sell'|'paper'})` render their expected non-stock classes —
   the mechanical guard that keeps a future `shadcn add --overwrite` from silently dropping them.
7. `bash scripts/check-duplication.sh services/xstockstrat-ui/src` passes (DRY guard rail) after
   regeneration.
8. `services/xstockstrat-ui/CLAUDE.md` documents the Tailwind v4 setup, the `shadcn add`/
   `apply --preset` workflow, and the variant-customization convention. Root `CLAUDE.md`'s
   Language Versions & Tooling table gains a Tailwind row.

## Open Questions

All prior open questions were resolved during `/sdd-design` via live CLI verification and
explicit user direction — see `design.md` § Live verification spikes and the Problem Statement
scope-decision note above. None remain open.

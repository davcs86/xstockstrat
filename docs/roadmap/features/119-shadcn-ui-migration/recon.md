# Recon: shadcn-ui-migration

**Created**: 2026-08-08
**From**: product-spec.md
**Affected services**: `xstockstrat-ui`

---

## Objective

Migrate `xstockstrat-ui`'s 11 hand-rolled `src/components/ui/` primitives to shadcn/ui-CLI-managed
components (`components.json` + `shadcn add`), aligning the Tailwind/CSS-variable theme to shadcn's
canonical convention, while preserving the Nocturne dark theme (feature 083) values and the app's
`buy`/`sell`/`paper` semantic extensions, with zero behavior/visual regression across all three
segments (`/trader`, `/insights`, `/config-ui`).

## Codebase Map

- **`xstockstrat-ui`** (Next.js 15 App Router, React 18, TypeScript, pnpm 9.15.0)
  - Primitives: `services/xstockstrat-ui/src/components/ui/{badge,button,card,combobox,input,select,separator,sheet,skeleton,table,utils}.tsx`
  - Tailwind config: `services/xstockstrat-ui/tailwind.config.js:1-72`
  - Global theme CSS: `services/xstockstrat-ui/src/app/globals.css:1-42`
  - Path alias: `services/xstockstrat-ui/tsconfig.json:17` (`"@/*": ["./src/*"]`)
  - PostCSS: `services/xstockstrat-ui/postcss.config.js:1-7` (`tailwindcss`, `autoprefixer`)
  - No `components.json` anywhere in the repo (confirmed via Glob).
  - No `next.config.js` `basePath` key — segments are directory-based (`src/app/{trader,insights,config-ui,accounts}`), so shadcn CLI's framework detection is unaffected — `services/xstockstrat-ui/next.config.js:1-38`.

## Existing component inventory (blast radius)

| File | Radix wrapped | Stock shadcn shape? | App-specific additions |
|---|---|---|---|
| `badge.tsx:5-26` | none | yes, + extra variants | `buy`/`sell`/`paper`/`live`/`warning`/`info` variants (lines 14-16 for buy/sell/paper) |
| `button.tsx:6-32` | `react-slot` | yes, + extra variants | `buy`/`sell` variants (lines 17-18) |
| `card.tsx:1-51` | none | yes | class tweaks only (`p-5`, `rounded-xl`) |
| `combobox.tsx:1-160` | **none — fully custom** | **no shadcn equivalent** | no Radix Popover/Command; self-contained, no portal (comment line 39) |
| `input.tsx:1-22` | none | yes | class diff (`bg-secondary`) |
| `select.tsx:1-82` | `react-select` | yes | class diffs (`bg-secondary`/`bg-card`) |
| `separator.tsx:1-25` | `react-separator` | yes | none |
| `sheet.tsx:1-79` | `react-dialog` | partial | omits stock `SheetDescription`/`SheetFooter` |
| `skeleton.tsx:1-17` | none | partial | adds `data-testid="skeleton"` + `aria-hidden` (feature 083, comment lines 3-6) |
| `table.tsx:1-55` | none | partial | omits stock `TableCaption`/`TableFooter`; custom `TableRow` hover/selected classes (line 29) |
| `utils.ts:1-6` | — | yes, unmodified | — |

`package.json` Radix deps present: `react-dialog@^1.1.2`, `react-select@^2.1.2`,
`react-separator@^1.1.0`, `react-slot@^1.1.0` only — no `react-popover`, `react-command`
equivalent (`cmdk`), `react-accordion`, `react-tooltip`, etc. Other relevant deps:
`class-variance-authority@^0.7.1`, `clsx@^2.1.1`, `tailwind-merge@^2.5.4`,
`tailwindcss@^3.4.3`, `tailwindcss-animate@^1.0.7`, `lucide-react@^0.460.0`,
`@phosphor-icons/react@^2.1.7` (two icon libs already in use).

61 files across `src/` import from `components/ui`. Per-component importer lists (all files)
are recorded in the sdd-story recon digest and are not repeated in full here; notable
concentrations:
- `button.tsx`, `badge.tsx`, `card.tsx`: broad use across all three segments (20+ files each).
- `combobox.tsx`: only 3 importers — `components/trader/ChartPanel.tsx:8`,
  `components/insights/ComponentEditor.tsx:4`, `components/insights/RuleEditor.tsx:3`.
- `buy`/`sell` variant usage (blast radius for those two custom variants):
  `components/trader/orderShared.tsx:39`, `components/trader/OrderForm.tsx:150,208`,
  `app/trader/orders/[id]/page.tsx:115`, `components/insights/FormulaRunResult.tsx:64`
  (reuses `buy` semantically for "success").

## Patterns to REUSE

- shadcn's CSS-variable theming (`hsl(var(--x))` token convention) → already the pattern in place
  at `globals.css:9-30` / `tailwind.config.js:9-38` — this is a values-preserving alignment, not a
  new system. Nocturne dark HSL values must carry over unchanged.
- `cn()` helper → reuse `utils.ts:1-6` unmodified; it already matches the shadcn CLI's emitted file
  byte-for-byte (stock, unmodified per digest item 1).
- Custom variant layering pattern (`buy`/`sell` on Button/Badge) → the existing `cva` `variants`
  object structure at `button.tsx:6-32` / `badge.tsx:5-26` is exactly how shadcn expects
  app-specific variants to be layered on top of a generated file; reuse this shape when
  reconciling post-`shadcn add` diffs, don't invent a different customization mechanism.
- Client Component boundary convention → `services/xstockstrat-ui/CLAUDE.md:181` ("Radix
  primitives (Select/Dialog) are Client Components ('use client') to avoid hydration mismatch") —
  any new Radix-backed primitive (e.g. Popover/Command for combobox) must follow this.

## Dependencies

- Proto/RPC: none
- Migration: none
- Config keys: none
- Inter-service edges: none (this is a component/build-tooling change, no new service calls)
- New env vars / ports: none
- New npm deps likely needed for CLI-managed equivalents of components already covering current
  functionality: `@radix-ui/react-popover`, `cmdk` (only if `combobox.tsx` is rebuilt on shadcn's
  Command+Popover composition — a design decision, not yet made). No other new deps anticipated;
  `tailwindcss-animate`, `class-variance-authority`, `clsx`, `tailwind-merge` are already present
  and are exactly what the shadcn CLI would install.

## Risks / Not-found

- `combobox.tsx` has no direct shadcn registry component — product-spec's Open Questions already
  flags this as a design decision (adopt Command+Popover composition vs. keep as documented
  exception). Recon confirms only 3 call sites, so blast radius is small either way.
- Whether the shadcn CLI can run non-interactively/offline in this sandboxed environment is not
  discoverable from repo content (external tool behavior) — must be verified live during
  execution; if CLI network access is blocked, the fallback is to hand-author `components.json`
  and files matching the CLI's known output shape (documented risk, not a blocker for design).
- No `docs/roadmap/ledger/fails.md` entry names a prior UI-theme/library migration attempt.
  Adjacent-but-relevant fails.md entries (component reuse across segments must check for missing
  context providers; a new near-duplicate primitive should first check for an existing
  primitive+variant) apply generally to any touched component but name no shadcn-specific trap.
- `sheet.tsx` and `table.tsx` already omit some stock shadcn sub-exports
  (`SheetDescription`/`SheetFooter`, `TableCaption`/`TableFooter`) — regenerating via the CLI will
  add these exports back; unused additions are harmless (dead exports) but should be noted as
  an intentional superset, not treated as scope creep requiring their own consumers.

## Recommended Scope

1. **Tooling init** — add `components.json`, verify `shadcn add`/`diff` run against this repo's
   Tailwind v3 + App Router setup without altering unrelated files.
2. **Theme alignment** — reconcile `tailwind.config.js`/`globals.css` token names against what the
   CLI's chosen style/base-color would emit, preserving Nocturne HSL values and `buy`/`sell`/`paper`
   token values exactly (a diff-only value-preserving pass).
3. **Per-primitive regeneration** — one pass per existing primitive (button, badge, card, input,
   select, separator, sheet, skeleton, table), re-applying documented app-specific
   variants/customizations on top of each CLI-emitted file. Group low-risk/no-custom-variant ones
   (card, input, separator, utils) together; high-risk ones with custom variants (button, badge)
   or non-stock shapes (sheet, table, skeleton) get individual attention.
4. **`combobox.tsx` decision** — resolved by the grilling round below.
5. **Verification** — full build + Vitest + Playwright (all 3 segments) + visual spot-check of
   `buy`/`sell` order-side coloring (the highest-risk custom variant, directly trading-UI-facing).
6. **Docs** — `services/xstockstrat-ui/CLAUDE.md` gets the `shadcn add` workflow + variant
   convention documented (product-spec FR-5).

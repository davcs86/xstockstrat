# Implementation Spec: shadcn-ui-migration

**Status**: `pending`
**Created**: 2026-08-08
**Feature**: `docs/roadmap/features/119-shadcn-ui-migration/feature.md`
**Total Steps**: 11
**Feature Branch**: `feature/shadcn-ui-migration`

---

## Execution Summary

Tailwind v3→v4 lands first (Step 1) since the user's chosen preset (`bLTl5gh6`) requires it — its
generated `globals.css` imports `shadcn/tailwind.css`, which the installed `shadcn` npm package does
not export, and cannot resolve under Tailwind v3 tooling (design.md § Live verification spikes). The
shadcn CLI then regenerates every primitive in one pass (Step 2), which deliberately leaves the app
non-building in two places — the `combobox.tsx` call sites (whose old prop-based API is replaced by a
compound Base-UI component) and the `button.tsx`/`badge.tsx` `buy`/`sell`/`paper` variant keys (which
the preset's regenerated `cva` object does not know about) — until Steps 3/4 (combobox rewrite + its
e2e parity check) and Steps 5-8 (low-risk primitive reconciliation, select/sheet Client Component
boundary, then button/badge + their red-before-green Vitest guard) land. Per-step verification
therefore uses scoped `grep`/`tsc --noEmit` checks rather than a full `pnpm build` until Step 7 makes
the tree whole again. Step 9 removes the now-unreferenced old individual `@radix-ui/react-*` packages
(`lucide-react` stays — still 19 live consumers outside `components/ui/`, confirmed this session).
Step 10 runs the full build/unit/e2e/DRY sweep across all 4 segments (`/trader`, `/insights`,
`/config-ui`, `/accounts`), and Step 11 documents the new shadcn workflow in both
`services/xstockstrat-ui/CLAUDE.md` and root `CLAUDE.md`'s Language Versions & Tooling table.

## Step Dependencies

- Step 2 requires Step 1: the preset's `apply --preset` output targets Tailwind v4 — confirmed live
  (design.md), not tractable on the app's pinned v3.4.3.
- Step 3 requires Step 2: `combobox.tsx`'s new compound API (`Combobox`/`ComboboxTrigger`/
  `ComboboxContent`/etc.) only exists once the preset has been applied.
- Step 4 requires Step 3: e2e parity verification runs against the rewritten call sites.
- Steps 5, 6, 7 each require Step 2 (they reconcile primitives the preset just regenerated) but are
  independent of each other and of Steps 3/4 — sequenced here low-risk → medium-risk → highest-risk
  (custom variants), matching design.md's own risk ordering. None of 5/6/7 depends on 3/4 or vice
  versa; they may execute in any relative order as long as all land before Step 9/10.
- Step 8 requires Step 7: paired red-before-green Vitest guard (Constitution P-06) — Step 8's tests
  must be authored and run red against the pre-Step-7 tree *before* Step 7's variant-key fix commits.
- Step 9 requires Steps 2, 3, 5, 6, 7: every consumer of the 4 candidate-for-removal individual Radix
  packages must have already migrated off them (via the preset regeneration + reconciliation) before
  the zero-consumer cleanup grep can be trusted.
- Step 10 requires Steps 1-9: this is the point the whole tree is expected to build/type-check/pass
  e2e together — see the Step 2/3/5/6/7 Verification notes explaining why full-build checks are
  deliberately deferred until here.
- Step 11 has no hard technical dependency but is sequenced last since it documents the finished
  workflow, including the exact live-verified CLI invocation and the regression-test file paths that
  only exist after Steps 2 and 8.

---

### Step 1 — service: Tailwind v3 → v4 migration

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/package.json` — modify
- `services/xstockstrat-ui/postcss.config.js` — modify
- `services/xstockstrat-ui/tailwind.config.js` — delete
- `services/xstockstrat-ui/src/app/globals.css` — modify
- `services/xstockstrat-ui/pnpm-lock.yaml` — modify

**Reviewers**: xstockstrat-ui (Service Owner) — Trading UI correctness, analytics display accuracy, config mutation safety, Connect-RPC call safety, environment scope correctness, no secret values rendered in UI, no direct DB access (except audit log)

**Codebase Evidence**:
- `package.json:63,68-69` — `"autoprefixer": "^10.4.19"`, `"tailwindcss": "^3.4.3"`,
  `"tailwindcss-animate": "^1.0.7"` in `devDependencies`.
- `postcss.config.js:1-6` — `module.exports = { plugins: { tailwindcss: {}, autoprefixer: {} } };`
- `tailwind.config.js:1-72` — full `theme.extend`: `colors.border/input/ring/background/foreground/
  primary/secondary/destructive/muted/accent/card` (`hsl(var(--x))` wrappers, L10-39), `colors.buy/
  sell/paper` literal HSL (L41-43), `fontFamily.mono` (L45-48), `borderRadius.lg/md/sm` (L49-53),
  `keyframes`/`animation` for `accordion-down`/`accordion-up` (L54-67), `plugins: [require('tailwindcss-animate')]` (L70). Confirmed no `safelist`, `important`, or `theme()` call anywhere in the file.
- `src/app/globals.css:1-3` — `@tailwind base; @tailwind components; @tailwind utilities;`; `:9-30` —
  the `:root` HSL custom-property block (Nocturne dark theme, feature 083).
- `design.md` § "1. Tailwind v3 → v4 migration" — confirms the config is tractable to port (no
  complicating patterns) and that `tailwindcss-animate` has a documented v4 successor
  (`tw-animate-css`, already in the preset's own dependency list).
- `design.md` § Open Risks item 1 — "the exact `@theme` syntax... has not been executed yet... if the
  port surfaces an unexpected v4 syntax gap, escalate rather than improvise (P-03)."

**TDD**: `N/A (build-tooling/config step — no new testable application logic; this step is
value-preserving by design (design.md), so correctness is behavior parity, not a new red/green
target)`

**Instructions**:
1. In `package.json`, remove `tailwindcss`, `autoprefixer`, `tailwindcss-animate` from
   `devDependencies`; add `@tailwindcss/postcss` and `tw-animate-css`. **Resolve the exact version
   pins live at execute time** (do not guess a version number here — Step 2 confirms the versions the
   `apply --preset` step itself installs, which must be compatible).
2. In `postcss.config.js`, replace the `tailwindcss: {}, autoprefixer: {}` plugin pair (L3-4) with
   the v4 single-plugin form. **Verify the exact plugin key name (`@tailwindcss/postcss`) against the
   installed package's own README/docs before committing** — do not proceed on an unverified
   assumption (P-03).
3. Port `tailwind.config.js`'s `theme.extend` block into `globals.css` using Tailwind v4's CSS-first
   `@theme` convention: replace the `@tailwind base/components/utilities` directives (L1-3) with
   `@import "tailwindcss";`, then add an `@theme { ... }` (or equivalent v4-native) block carrying
   every value currently in `theme.extend` unchanged — the `hsl(var(--x))` color wrappers, the `buy`/
   `sell`/`paper` literal HSL values, `fontFamily.mono`, `borderRadius.lg/md/sm`, and the
   `accordion-down`/`accordion-up` keyframes/animation pair. **The exact `@theme` block syntax has not
   been verified live in any prior session (design.md § Open Risks item 1) — verify against the
   installed `tailwindcss@4` package's own documentation before writing this block; if the syntax
   does not map cleanly, stop and escalate per Constitution P-03 rather than guessing.** This step is
   value-preserving — only the syntax convention changes, not any Nocturne color/radius/animation
   value.
4. Delete `tailwind.config.js` — v4's CSS-first convention supersedes it, and no other configuration
   (`safelist`, `important`, extra plugins) lives there to migrate elsewhere.
5. Add `@import "tw-animate-css";` to `globals.css`, replacing the removed
   `plugins: [require('tailwindcss-animate')]`.
6. Run `pnpm install` from the repo root; commit the regenerated `pnpm-lock.yaml` in this step.

**Verification**:
```bash
cd services/xstockstrat-ui
pnpm --filter @xstockstrat/proto run build
NEXT_DISABLE_STANDALONE=1 pnpm build
pnpm run test:unit
pnpm exec eslint postcss.config.js
```
Both must pass with **no visual/behavioral change** — this step only changes the Tailwind syntax
convention, not any token value. If the `@theme` port surfaces a build failure, that is the
documented Open Risk materializing: stop and escalate (P-03) rather than improvising a workaround.

---

### Step 2 — service: shadcn CLI init + apply preset `bLTl5gh6`

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/components.json` — create
- `services/xstockstrat-ui/package.json` — modify
- `services/xstockstrat-ui/pnpm-lock.yaml` — modify
- `services/xstockstrat-ui/src/app/globals.css` — modify
- `services/xstockstrat-ui/src/components/ui/badge.tsx` — modify (regenerated by the CLI)
- `services/xstockstrat-ui/src/components/ui/button.tsx` — modify (regenerated by the CLI)
- `services/xstockstrat-ui/src/components/ui/card.tsx` — modify (regenerated by the CLI)
- `services/xstockstrat-ui/src/components/ui/combobox.tsx` — modify (regenerated by the CLI)
- `services/xstockstrat-ui/src/components/ui/input.tsx` — modify (regenerated by the CLI)
- `services/xstockstrat-ui/src/components/ui/select.tsx` — modify (regenerated by the CLI)
- `services/xstockstrat-ui/src/components/ui/separator.tsx` — modify (regenerated by the CLI)
- `services/xstockstrat-ui/src/components/ui/sheet.tsx` — modify (regenerated by the CLI)
- `services/xstockstrat-ui/src/components/ui/skeleton.tsx` — modify (regenerated by the CLI)
- `services/xstockstrat-ui/src/components/ui/table.tsx` — modify (regenerated by the CLI)
- `services/xstockstrat-ui/src/components/ui/textarea.tsx` — create (preset dependency)
- `services/xstockstrat-ui/src/components/ui/input-group.tsx` — create (preset dependency)

**Reviewers**: xstockstrat-ui (Service Owner) — Trading UI correctness, analytics display accuracy, config mutation safety, Connect-RPC call safety, environment scope correctness, no secret values rendered in UI, no direct DB access (except audit log)

**Codebase Evidence**:
- `design.md` § "2. shadcn CLI init + preset application" — style `radix-rhea`, `iconLibrary:
  "tabler"`, `baseColor: "stone"`, `aliases.utils: "@/components/ui/utils"` ("unchanged from
  original round's reasoning — `utils.ts` location is a project convention, not a preset concern").
- `design.md` § Live verification spikes — `components.json` must exist first or `apply --preset`
  hangs on an unsuppressable interactive `add`-machinery prompt; `apply --preset bLTl5gh6 --yes`
  still needs a piped `y` on stdin to clear a "Would you like to continue?" confirmation; regenerates
  `badge`/`button`/`card`/`combobox`/`input`/`select`/`separator`/`sheet`/`skeleton`/`table` plus
  `textarea`/`input-group`; adds `@base-ui/react`, `@tabler/icons-react`, `radix-ui` (unified),
  `tw-animate-css`, `shadcn` (devDependency) to `package.json`; writes `globals.css` with
  `oklch(...)` values, a `:root` (light) block **and** a `.dark` block.
- `recon.md` § Existing component inventory — the exact 10 pre-migration files being regenerated
  (`badge.tsx:5-26`, `button.tsx:6-32`, `card.tsx:1-51`, `combobox.tsx:1-160`, `input.tsx:1-22`,
  `select.tsx:1-82`, `separator.tsx:1-25`, `sheet.tsx:1-79`, `skeleton.tsx:1-17`, `table.tsx:1-55`).
- `src/components/ui/utils.ts:1-6` — confirmed byte-for-byte stock shadcn shape (recon.md); should
  survive the regeneration unchanged.
- `tsconfig.json:17` — `"@/*": ["./src/*"]`, the path-alias base `components.json`'s `aliases` must
  resolve against.

**TDD**: `N/A (regeneration step — no new testable logic of its own; the app is intentionally left
non-building until Steps 3/7 land, per the Step Dependencies note above)`

**Instructions**:
1. Hand-author `components.json` first (per design.md's confirmed live finding that `apply --preset`
   hangs without it): `style: "radix-rhea"`, `tailwind.baseColor: "stone"`, `tailwind.cssVariables:
   true`, `tailwind.css` pointing at `src/app/globals.css`, `aliases.components: "@/components"`,
   `aliases.ui: "@/components/ui"`, `aliases.utils: "@/components/ui/utils"` (per design.md's
   explicit call-out), `aliases.hooks: "@/hooks"`, `aliases.lib: "@/lib"`, `iconLibrary: "tabler"`,
   `rsc: true`, `tsx: true`. **Verify this exact JSON shape against the installed `shadcn` CLI's own
   schema before writing it** — design.md's spike confirms the *values* (style/iconLibrary/
   aliases.utils) but not independently the full field list in this session; follow the live schema
   if it differs (P-03).
2. Run `printf 'y\n' | npx shadcn@latest apply --preset bLTl5gh6 --yes` from
   `services/xstockstrat-ui/` — the confirmed-live invocation from design.md § Live verification
   spikes.
3. Confirm the apply step regenerated exactly the 10 existing primitives plus `textarea`/
   `input-group` — no other new primitive files (Out of Scope boundary: no speculative additions
   like `accordion`/`tooltip`).
4. Per the user's dark-only decision (design.md § "Dark-only decision"): fold the written `.dark`
   block's values into `:root`, then delete the separate light block and the now-redundant `.dark`
   selector — the app renders the preset's dark palette unconditionally, no theme toggle.
5. Confirm `package.json` gained `@base-ui/react`, `@tabler/icons-react`, `radix-ui`,
   `tw-animate-css`, `shadcn` (devDependency). **Do not** manually remove the old individual
   `@radix-ui/react-*` packages or `lucide-react` here — that is Step 9's job, gated on a
   confirmed-zero-external-consumer grep.
6. Commit the regenerated `pnpm-lock.yaml`.

**Verification**:
```bash
cd services/xstockstrat-ui
cat components.json   # style: radix-rhea, iconLibrary: tabler present
ls src/components/ui/  # badge/button/card/combobox/input/select/separator/sheet/skeleton/table/textarea/input-group/utils.ts present
grep -n "oklch" src/app/globals.css
grep -c "\.dark" src/app/globals.css   # 0 — folded into :root, no separate dark selector left
```
**Do not run `pnpm build`/`tsc --noEmit` (whole-repo) at this step** — it is expected to fail:
`combobox.tsx`'s new compound API breaks its 3 existing call sites, and `button.tsx`/`badge.tsx` no
longer have the `buy`/`sell`/`paper` variant keys their consumers reference. Both are resolved in
Steps 3 and 7 respectively; the first full-build verification in this spec is Step 4's scoped check,
and the definitive one is Step 10.

---

### Step 3 — service: Rewrite the 3 `combobox.tsx` call sites against the new compound API

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/trader/ChartPanel.tsx` — modify
- `services/xstockstrat-ui/src/components/insights/ComponentEditor.tsx` — modify
- `services/xstockstrat-ui/src/components/insights/RuleEditor.tsx` — modify

**Reviewers**: xstockstrat-ui (Service Owner) — Trading UI correctness, analytics display accuracy, config mutation safety, Connect-RPC call safety, environment scope correctness, no secret values rendered in UI, no direct DB access (except audit log)

**Codebase Evidence**:
- `ChartPanel.tsx:8` — `import { Combobox, type ComboboxOption } from '../ui/combobox';`; `:32-35` —
  `symbolOptions` memo (`symbols.map((s) => ({ value: s }))`); `:92-101` — call site: `value={symbol}`,
  `onChange={setSymbol}`, `options={symbolOptions}`, `maxResults={50}`, `placeholder="Symbol"`,
  `aria-label="Chart symbol"`, `className="w-28"`, `inputClassName="h-7 text-xs"`.
- `ComponentEditor.tsx:4` — `import { Combobox } from '@/components/ui/combobox';`; `:110-121` — call
  site: `aria-label="formula"`, `placeholder="Select a formula…"`, `emptyText="No matching formulas"`,
  `value={value.formulaId}`, `onChange={selectFormula}`,
  `options={formulas.map(f => ({value: f.formulaId, label: f.name, hint: f.formulaId}))}`.
- `RuleEditor.tsx:4` — `import { Combobox } from '@/components/ui/combobox';`; `:199-210` — lhs call
  site (`aria-label="left operand"`, no `allowFreeText`); `:230-242` — rhs call site
  (`aria-label="right operand"`, `allowFreeText`, `placeholder="component or number"`).
- `design.md` § "4. Combobox — real rewrite, not a wrapper" — preset ships `Combobox`/
  `ComboboxTrigger`/`ComboboxContent`/`ComboboxList`/`ComboboxItem`/`ComboboxChips` on
  `@base-ui/react`'s `Combobox` primitive; each site must preserve substring filtering, the
  `allowFreeText` path (RuleEditor rhs only), and the `maxResults` cap (ChartPanel only).
- `e2e/insights/strategy-authoring.spec.ts:268-291` — "formula picker filters by substring (AC-7)"
  (that test's own pre-existing name, unrelated to this feature's AC numbering) is the existing
  regression guard for the `ComponentEditor` call site: opens via
  `page.getByLabel('formula', { exact: true }).click()`, asserts both formula labels visible, types
  `'RSI'`, asserts substring filtering narrows the list.
- `e2e/trader/chart-panel.spec.ts` — confirmed via full-file read to contain **no** direct assertion
  on the symbol `Combobox` — lowest-risk of the 3 call sites.

**TDD**: `N/A (scoped API-surface rewrite, no new business logic of its own — behavior-equivalence is
proven by the paired Step 4 e2e run, which is where red-before-green applies)`

**Instructions**:
1. Read the new `src/components/ui/combobox.tsx` emitted by Step 2's `apply --preset` to confirm its
   exact exported compound-component shape and prop contract before touching any call site — do not
   guess the new API surface from the design.md summary alone.
2. Rewrite `ChartPanel.tsx`'s call site (L92-101): reproduce substring filtering over
   `symbolOptions`, the `maxResults={50}` cap (or document any lost capability explicitly, since
   product-spec AC-4 requires equivalent — not superset or subset — behavior), the `placeholder`/
   sizing classes, and the `aria-label="Chart symbol"` semantic (even if it must move to a different
   sub-component in the new API).
3. Rewrite `ComponentEditor.tsx`'s call site (L110-121): reproduce the formula list with `label`/
   `hint` (formula id) rendering, the `emptyText="No matching formulas"` empty state, and keep an
   element addressable by `getByLabel('formula', { exact: true })` — or, if the new API's structure
   makes that impossible, note the correct new locator for Step 4 to adopt, preserving the assertion
   the test exists to make (substring filtering), not its literal locator string.
4. Rewrite `RuleEditor.tsx`'s two call sites (L199-210 lhs, L230-242 rhs): preserve
   `aria-label="left operand"` / `aria-label="right operand"`, and reproduce the rhs's
   `allowFreeText` behavior (typed text matching no `refOptions` entry is still committed via
   `onChange` — it may be a numeric literal) while the lhs site keeps rejecting/not-committing pure
   free text.
5. Do not touch `combobox.tsx` itself in this step (already regenerated by Step 2) — only the 3
   consumer files.

**Verification**:
```bash
cd services/xstockstrat-ui
pnpm exec tsc --noEmit 2>&1 | grep -E "ChartPanel|ComponentEditor|RuleEditor"   # expect no output
pnpm exec eslint src/components/trader/ChartPanel.tsx src/components/insights/ComponentEditor.tsx src/components/insights/RuleEditor.tsx
```
A full `pnpm build` may still fail at this point on the not-yet-reconciled `buy`/`sell` Button/Badge
variants (Step 7's scope) — that is expected. This step's own scope is validated by the `tsc`
scoped-file check above; behavior parity is proven in Step 4.

---

### Step 4 — test: E2E parity verification for the 3 rewritten combobox call sites

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/insights/strategy-authoring.spec.ts` — modify (only if Step 3's
  rewritten `ComponentEditor.tsx` changes the `formula` combobox's locator shape; confirm via the
  before/after run in Instructions before editing)
- `services/xstockstrat-ui/e2e/trader/chart-panel.spec.ts` — modify only if a new assertion for the
  symbol combobox is warranted (optional — AC-4 requires behavior equivalence, not new coverage)

**Reviewers**: xstockstrat-ui (Service Owner) — Trading UI correctness, analytics display accuracy, config mutation safety, Connect-RPC call safety, environment scope correctness, no secret values rendered in UI, no direct DB access (except audit log)

**Codebase Evidence**:
- `e2e/insights/strategy-authoring.spec.ts:268-291` — the existing formula-picker substring-filter
  test (full text confirmed via Read this session; see Step 3's Codebase Evidence for the quoted
  locator/assertion sequence).
- `e2e/fixtures/INVENTORY.md:18` — `FORMULA_RSI`, `FORMULA_MACD`, `FORMULAS` are the canonical
  fixture home for this test's data (`e2e/fixtures/formulas.ts`), already imported by
  `strategy-authoring.spec.ts` and `formulas.spec.ts` — C-12 is already satisfied for this spec; no
  new inline domain literal should be introduced here.

**TDD**: `red-green required` — the pre-Step-3 state (compound API landed in Step 2, call sites still
on the old prop shape) is the implicit red baseline (proven by Step 3's own build failure before its
fix); this step's green run is the direct proof of product-spec AC-4 behavior parity.

**Instructions**:
1. Run `strategy-authoring.spec.ts`'s `'formula picker filters by substring (AC-7)'` test against
   Step 3's rewritten `ComponentEditor.tsx` **before** editing the spec file, to see whether the
   existing `getByLabel('formula', { exact: true })` locator still resolves.
2. If the locator no longer resolves, update the spec's locator to the correct new element **without
   weakening the assertion** — it must still prove substring filtering narrows the visible option
   list, not just that *some* element exists.
3. Manually exercise (or add an assertion for) `ChartPanel.tsx`'s symbol combobox and `RuleEditor.tsx`
   's lhs/rhs operand combos against a local dev build: symbol substring filtering + the 50-result
   cap behavior; lhs rejects pure free text; rhs commits free text (e.g. typing "1.5" is accepted as
   the comparator's right-hand value).
4. Per C-12, any new inline literal introduced in a spec edit here must reuse
   `e2e/fixtures/formulas.ts` rather than declaring a fresh one.

**Verification**:
```bash
cd services/xstockstrat-ui
pnpm exec playwright test e2e/insights/strategy-authoring.spec.ts -g "formula picker filters by substring"
pnpm exec playwright test e2e/trader/chart-panel.spec.ts
```
Both must pass. If Step 7's `buy`/`sell` variant fix hasn't landed yet, running these specific specs
against a dev server (not a full production build) is sufficient at this point; the full-suite run is
Step 10.

---

### Step 5 — service: Reconcile low-risk primitives (card, input, separator, table's TableRow, skeleton)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/ui/card.tsx` — modify
- `services/xstockstrat-ui/src/components/ui/input.tsx` — modify
- `services/xstockstrat-ui/src/components/ui/separator.tsx` — modify
- `services/xstockstrat-ui/src/components/ui/table.tsx` — modify
- `services/xstockstrat-ui/src/components/ui/skeleton.tsx` — modify

**Reviewers**: xstockstrat-ui (Service Owner) — Trading UI correctness, analytics display accuracy, config mutation safety, Connect-RPC call safety, environment scope correctness, no secret values rendered in UI, no direct DB access (except audit log)

**Codebase Evidence**:
- `card.tsx:8` — `'rounded-xl border border-border bg-card text-card-foreground shadow-sm'` (class
  tweaks only, per recon.md's inventory row).
- `input.tsx:11` — `bg-secondary` class diff (recon.md).
- `table.tsx:25-34` — `TableRow`'s custom hover/selected classes: `'border-b border-border/50
  transition-colors hover:bg-accent/30 data-[state=selected]:bg-accent'`.
- `skeleton.tsx:8-16` — `data-testid="skeleton"` + `aria-hidden`, feature-083 comment (L3-6:
  "Loading skeleton primitive (feature 083, FR-17)").
- `separator.tsx:1-25` — recon.md confirms "none" (no app-specific diff).
- `services/xstockstrat-ui/CLAUDE.md` § "Non-happy states" — `src/components/ui/skeleton.tsx`
  (`Skeleton`) is depended on by the feature-083 non-happy-states convention.
- Repo-wide grep (confirmed this session): zero hits for `data-testid="skeleton"` or
  `data-[state=selected]:bg-accent`/`border-border/50` in `e2e/` — no existing automated test asserts
  either customization.

**TDD**: `N/A — no existing automated test asserts skeleton's data-testid or TableRow's hover/selected
classes (confirmed via repo-wide grep), so there is no red baseline to run first; correctness is
proven by direct grep + the Step 10 full e2e sweep`

**Instructions**:
1. Read each of the 5 regenerated files (post-Step-2) and diff against the pre-migration versions
   quoted in Codebase Evidence.
2. `card.tsx`: re-apply structural class *additions* the app actually depends on only if the preset's
   own default diverges from what current usage requires — per AC-3, the preset's own visual/token
   values are **not** overridden, so do not re-impose the old pixel values wholesale.
3. `input.tsx`: confirm whether `bg-secondary` (or the preset's own equivalent background token) needs
   re-adding; likely a no-op per AC-3 — document if so.
4. `table.tsx`: re-add `TableRow`'s custom hover/selected classes onto the regenerated structure —
   this is a functional affordance (row-selection visual feedback), explicitly in scope per FR-3.
5. `skeleton.tsx`: re-add `data-testid="skeleton"` + `aria-hidden` onto the regenerated element.
6. `separator.tsx`: confirm it still compiles against its Client Component boundary requirement — no
   functional re-application expected.

**Verification**:
```bash
cd services/xstockstrat-ui
grep -n 'data-testid="skeleton"' src/components/ui/skeleton.tsx
grep -n "data-\[state=selected\]:bg-accent" src/components/ui/table.tsx
pnpm exec tsc --noEmit 2>&1 | grep -E "card\.tsx|input\.tsx|separator\.tsx|table\.tsx|skeleton\.tsx"   # expect no output
pnpm exec eslint src/components/ui/card.tsx src/components/ui/input.tsx src/components/ui/separator.tsx src/components/ui/table.tsx src/components/ui/skeleton.tsx
```

---

### Step 6 — service: Reconcile select.tsx, sheet.tsx (Client Component boundary + stock sub-exports)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/ui/select.tsx` — modify
- `services/xstockstrat-ui/src/components/ui/sheet.tsx` — modify

**Reviewers**: xstockstrat-ui (Service Owner) — Trading UI correctness, analytics display accuracy, config mutation safety, Connect-RPC call safety, environment scope correctness, no secret values rendered in UI, no direct DB access (except audit log)

**Codebase Evidence**:
- `select.tsx:1` — `'use client';`; `:3` — `import * as SelectPrimitive from '@radix-ui/react-select';`
  (will become the preset's `@base-ui/react`/unified `radix-ui` import per design.md § "6. Dependency
  stack swap").
- `sheet.tsx:1` — `'use client';`; `:3` — `import * as DialogPrimitive from '@radix-ui/react-dialog';`;
  recon.md's inventory: "omits stock `SheetDescription`/`SheetFooter`" (partial shape).
- `services/xstockstrat-ui/CLAUDE.md` § "Frontend gotchas" — "**Radix primitives** (Select/Dialog) are
  Client Components (`'use client'`) to avoid hydration mismatch."
- `recon.md` § "Patterns to REUSE" — "Client Component boundary convention... any new Radix-backed
  primitive... must follow this."
- `design.md` § "5. React 18 compatibility" — regenerated `button.tsx`/`badge.tsx` dropped
  `React.forwardRef` in favor of plain function components, a documented convention-drift precedent
  that makes a similar drift (e.g. a missing `'use client'`) plausible here too.

**TDD**: `N/A — structural-convention check (Client Component boundary), not new testable logic;
proven by the grep below plus Step 10's full e2e sweep (Radix Select is exercised by, e.g.,
chart-panel.spec.ts's bar-count selector test)`

**Instructions**:
1. Confirm the regenerated `select.tsx` and `sheet.tsx` (from Step 2) both retain a `'use client'`
   directive at the top of the file. If dropped by the regeneration, add it back manually.
2. `sheet.tsx`: the regenerated file will likely add the stock `SheetDescription`/`SheetFooter`
   exports the hand-rolled version omitted — per recon.md's Risk note, leave these additions in
   place as an intentional superset; do not delete them or force new consumers onto them.
3. No functional re-application is otherwise required for these two files — neither had a `buy`/
   `sell`-style custom variant, only structural/import differences the CLI regeneration resolves.

**Verification**:
```bash
cd services/xstockstrat-ui
head -1 src/components/ui/select.tsx src/components/ui/sheet.tsx   # both 'use client';
grep -n "SheetDescription\|SheetFooter" src/components/ui/sheet.tsx
pnpm exec tsc --noEmit 2>&1 | grep -E "select\.tsx|sheet\.tsx"   # expect no output
pnpm exec eslint src/components/ui/select.tsx src/components/ui/sheet.tsx
```

---

### Step 7 — service: Reconcile button.tsx/badge.tsx (buy/sell/paper/live/warning/info variants)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/ui/button.tsx` — modify
- `services/xstockstrat-ui/src/components/ui/badge.tsx` — modify

**Reviewers**: xstockstrat-ui (Service Owner) — Trading UI correctness, analytics display accuracy, config mutation safety, Connect-RPC call safety, environment scope correctness, no secret values rendered in UI, no direct DB access (except audit log)

**Codebase Evidence**:
- `button.tsx:6-32` — full `cva` `buttonVariants`: `variant.buy: 'bg-buy text-background
  hover:bg-buy/90 font-semibold'`, `variant.sell: 'bg-sell text-white hover:bg-sell/90
  font-semibold'` (L17-18); `:40-45` — `React.forwardRef` wrapper.
- `badge.tsx:5-26` — full `cva` `badgeVariants`: `buy`/`sell`/`paper`/`live`/`warning`/`info`
  (L14-19).
- Consumer blast radius (recon.md, confirmed): `components/trader/orderShared.tsx:39`,
  `components/trader/OrderForm.tsx:150,208`, `app/trader/orders/[id]/page.tsx:115`,
  `components/insights/FormulaRunResult.tsx:64` (Button `buy`); Badge `buy`/`sell`/`paper`/`live`/
  `warning`/`info` used across 20+ files (recon.md's "broad use across all three segments" note).
- `design.md` § "5. React 18 compatibility" — confirmed via repo-wide grep (re-confirmed this
  session): **zero** external call sites pass a `ref` prop into `Button`/`Badge`/`Input`/`Select`,
  so the regenerated plain-function-component shape is not a live break.

**TDD**: `red-green required` — Step 8 writes the Vitest regression-guard tests against this step's
**pre**-reconciliation state (post-Step-2 files, missing the variant keys) to see them fail, then this
step's variant re-addition makes them pass. Author Step 8's tests before this step's own fix commits,
observe red, then commit this step's fix and observe green (Constitution P-06).

**Instructions**:
1. Read the regenerated `button.tsx`/`badge.tsx` (post-Step-2) to confirm the current `cva`
   `variants.variant` object shape — it will differ from the pre-migration default/destructive/
   outline/secondary/ghost/link set; reconcile against what the preset actually emits, not an
   assumed match to the old L11-16.
2. Add the `buy`/`sell` keys back into `button.tsx`'s `variants.variant` object with their existing
   class strings (`'bg-buy text-background hover:bg-buy/90 font-semibold'` /
   `'bg-sell text-white hover:bg-sell/90 font-semibold'`) — these reference the `buy`/`sell` Tailwind
   color tokens Step 1 already ported into `@theme`, so the color values themselves are untouched.
3. Add the `buy`/`sell`/`paper`/`live`/`warning`/`info` keys back into `badge.tsx`'s
   `variants.variant` object with their existing class strings.
4. Do not re-add `React.forwardRef` to either file — the regenerated plain-function-component shape
   is confirmed safe (Codebase Evidence above).
5. Confirm `size` variants on `button.tsx` (`default`/`sm`/`lg`/`icon`) are preserved by the
   regeneration or re-added if the preset dropped app-specific sizing consumer sites depend on.

**Verification**:
```bash
cd services/xstockstrat-ui
grep -n "buy:\|sell:" src/components/ui/button.tsx
grep -n "buy:\|sell:\|paper:\|live:\|warning:\|info:" src/components/ui/badge.tsx
pnpm --filter @xstockstrat/proto run build
NEXT_DISABLE_STANDALONE=1 pnpm build
pnpm exec eslint src/components/ui/button.tsx src/components/ui/badge.tsx
```
The `pnpm build` here is expected to **succeed** for the first time in this spec, assuming Steps 3,
5, 6 have already landed — this is the step that resolves the last of Step 2's two deliberate
breakages.

---

### Step 8 — test: Vitest regression-guard tests for buy/sell/paper variants

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/ui/button.test.ts` — create
- `services/xstockstrat-ui/src/components/ui/badge.test.ts` — create

**Reviewers**: xstockstrat-ui (Service Owner) — Trading UI correctness, analytics display accuracy, config mutation safety, Connect-RPC call safety, environment scope correctness, no secret values rendered in UI, no direct DB access (except audit log)

**Codebase Evidence**:
- `vitest.config.ts:10` — `test.include: ['src/**/*.test.ts']` (note: `.test.ts`, **not**
  `.test.tsx`) — a plain-`.ts` test file anywhere under `src/` is picked up; `buttonVariants`/
  `badgeVariants` are plain `cva()`-returned functions (no JSX), so a `.ts` test needs no React
  renderer and matches this glob exactly.
- `vitest.config.ts:9` — `environment: 'node'` (no jsdom) — consistent with testing a pure
  string-returning function.
- `vitest.config.ts:15,23` — `coverage.include: ['src/lib/**']`, `coverage.all: false` — this new
  test file lives under `src/components/ui/`, **outside** the coverage-scoped path, so it does not
  count toward (and need not raise) the 40% `src/lib` threshold; the product-spec's AC-6 only
  requires the test to exist and pass.
- Confirmed via `find`: zero existing `*.test.ts*` files under `src/components/ui/`.
- `button.tsx` — `export { Button, buttonVariants };`; `badge.tsx` — `export { Badge, badgeVariants
  };` — both already export the `cva` function directly; no new export needed.

**TDD**: `red-green required` (paired with Step 7 — see that step's TDD note).

**Instructions**:
1. Create `src/components/ui/button.test.ts` importing `buttonVariants` from `./button`. Assert
   `buttonVariants({ variant: 'buy' })` and `buttonVariants({ variant: 'sell' })` each return a class
   string containing `'bg-buy'` and `'bg-sell'` respectively.
2. Create `src/components/ui/badge.test.ts` importing `badgeVariants` from `./badge`. Assert
   `badgeVariants({ variant: 'buy' })`, `badgeVariants({ variant: 'sell' })`, and
   `badgeVariants({ variant: 'paper' })` each contain `'bg-buy/20'`, `'bg-sell/20'`, `'bg-paper/20'`
   respectively.
3. **Red-before-green (P-06):** run these tests against Step 7's *pre*-reconciliation tree (before
   Step 7's variant-key re-addition commits) — both must **fail** (the regenerated post-Step-2 `cva`
   object has no `buy`/`sell`/`paper` keys). Then apply Step 7's fix and re-run — both must pass.
4. This is the mechanical guard product-spec AC-6 requires: a future `shadcn add --overwrite` that
   drops these variant keys will fail these two tests loudly.

**Verification**:
```bash
cd services/xstockstrat-ui
pnpm run test:unit -- button.test badge.test
```
Both files pass with a non-zero assertion count (per the `fails.md` 2026-07-29 (074) warning about
silently-skipped suites — this test has no external I/O or graceful-skip surface, but confirm the
run output shows real assertions executing, not a vacuous pass).

---

### Step 9 — service: Dependency cleanup — remove unreferenced old Radix packages

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/package.json` — modify
- `services/xstockstrat-ui/pnpm-lock.yaml` — modify

**Reviewers**: xstockstrat-ui (Service Owner) — Trading UI correctness, analytics display accuracy, config mutation safety, Connect-RPC call safety, environment scope correctness, no secret values rendered in UI, no direct DB access (except audit log)

**Codebase Evidence**:
- Repo-wide grep (confirmed this session): `grep -rn "@radix-ui/react-dialog\|@radix-ui/react-select\|
  @radix-ui/react-separator\|@radix-ui/react-slot" services/xstockstrat-ui/src --include=*.tsx
  --include=*.ts | grep -v "src/components/ui/"` → **zero matches** — these 4 packages have no
  consumer outside `src/components/ui/` on the pre-migration tree; by this step those files
  (`button.tsx`, `select.tsx`, `sheet.tsx`) have already been regenerated onto the preset's own
  imports (Steps 2/6/7), so they are now fully unreferenced.
- Repo-wide grep (confirmed this session): `lucide-react` has **19 confirmed importers outside
  `src/components/ui/`** (e.g. `components/trader/AccountSelector.tsx:5`,
  `components/trader/AlertStream.tsx:5`, `components/insights/WatchlistDetail.tsx:4`,
  `app/accounts/mcp-tools/page.tsx:4`, plus 15 more) — **do not remove `lucide-react`**.
- `design.md` § "6. Dependency stack swap" — "an explicit cleanup pass checks whether anything
  outside `src/components/ui/` still imports the old individual Radix packages or `lucide-react`
  directly; if not, remove them" — the grep found `lucide-react` **is** still referenced, so it
  stays; only the 4 zero-consumer `@radix-ui/react-*` packages are candidates.
- `package.json:33-36` — the 4 candidate-for-removal entries in their pre-migration form.

**TDD**: `N/A (dependency-list cleanup — no application logic changes; safety is proven by the
pre-removal zero-consumer grep plus the post-removal build)`

**Instructions**:
1. Re-run the exact grep from Codebase Evidence against the tree as it stands after Steps 2-8 (not
   the pre-migration result quoted above — re-verify live, since intervening steps may have changed
   imports).
2. For each of the 4 packages confirmed still zero-hit, remove it from `package.json`'s
   `dependencies`.
3. Do **not** remove `lucide-react`; re-confirm its importer count with
   `grep -rln "lucide-react" src --include=*.tsx --include=*.ts | grep -v "src/components/ui/" | wc -l`
   before concluding. If any of the 4 Radix packages instead shows a live consumer at execute time,
   keep that package and record the deviation rather than breaking a working import (recon.md § Risks
   explicitly warns against this).
4. Run `pnpm install` to regenerate `pnpm-lock.yaml`; commit it.

**Verification**:
```bash
cd services/xstockstrat-ui
grep -rn "@radix-ui/react-dialog\|@radix-ui/react-select\|@radix-ui/react-separator\|@radix-ui/react-slot" src --include=*.tsx --include=*.ts | grep -v "src/components/ui/"   # zero matches
pnpm --filter @xstockstrat/proto run build
NEXT_DISABLE_STANDALONE=1 pnpm build
```

---

### Step 10 — test: Full verification sweep (build, unit, e2e all 4 segments, DRY guard rail)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**: (no source files modified by this step — any failure surfaced here is fixed at its owning
step and recorded in the Deviation Log, not patched here)

**Reviewers**: xstockstrat-ui (Service Owner) — Trading UI correctness, analytics display accuracy, config mutation safety, Connect-RPC call safety, environment scope correctness, no secret values rendered in UI, no direct DB access (except audit log)

**Codebase Evidence**:
- `.github/workflows/ci.yml:429-533` — `frontend-e2e-build`/`frontend-e2e` jobs: `pnpm build` with
  `NEXT_DISABLE_STANDALONE=1`, then `pnpm test:e2e --shard=N/2`, chromium only in CI.
- `.github/workflows/ci.yml:534-591` — `node-test` job: `pnpm run test:coverage`, `xstockstrat-ui`
  entry (L561-562, `coverage_threshold: 40` — the job's own inline comment L559-560 notes the real
  gate is vitest's own `vitest.config.ts` scoped `src/lib` threshold).
- `.jscpd.json` — DRY guard rail config (`minTokens: 100`, excludes `e2e/**`, `*.test.ts`, etc.).
- `package.json:12` — `"lint:dup": "jscpd --config ../../.jscpd.json --threshold 0 src"`.
- product-spec.md Acceptance Criteria 5 and 7 — `pnpm --filter xstockstrat-ui build`, Vitest unit
  suite, Playwright e2e suite for all 4 segments must pass; `bash scripts/check-duplication.sh
  services/xstockstrat-ui/src` must pass.
- `e2e/` directory listing (confirmed this session): `e2e/{trader,insights,config-ui,accounts}/` all
  present with specs, plus root-level `auth.spec.ts`, `copilot.spec.ts`, `mobile.spec.ts`,
  `mobile-overflow.spec.ts`, `nav-reachability.spec.ts`, `non-happy-states.spec.ts`.

**TDD**: `N/A (integration sweep — this step's job is to prove everything already red/green-verified
per-step remains green together, not to introduce a new unit of behavior)`

**Instructions**:
1. Run the full production build (standard, not the E2E-only `NEXT_DISABLE_STANDALONE` variant) to
   confirm the standalone-output path Docker actually ships also compiles cleanly.
2. Run `next lint` across the whole `src/` tree — the first whole-repo lint pass in this spec (every
   prior step only scoped `eslint` to its own touched files).
3. Run the full Vitest unit suite with coverage; **the gate is the existing `coverage_threshold: 40`
   for `xstockstrat-ui`** (`.github/workflows/ci.yml:561-562`, enforced via `vitest.config.ts`'s
   `coverage.include: ['src/lib/**']`) — confirm it still passes at ≥40%. This feature does not touch
   `src/lib/**` production code, only adds the two new `src/components/ui/*.test.ts` files from
   Step 8, which sit outside the coverage-scoped path and neither raise nor lower this number.
4. Run the full Playwright e2e suite across all 4 segments — every spec under `e2e/trader/`,
   `e2e/insights/`, `e2e/config-ui/`, `e2e/accounts/`, plus the root-level specs — must pass. Visual
   appearance is expected to differ (new preset, per AC-5); any *behavioral* failure is a real
   regression to fix at its owning step (Steps 3/5/6/7/9), recorded in the Deviation Log.
5. Run the DRY duplication check.
6. Manually spot-check (per design.md § "7. Verification") the `buy`/`sell` order-side coloring on the
   trading dashboard (`OrderForm.tsx`, `orderShared.tsx`) — the highest-risk, most trading-relevant
   visual signal in this migration.

**Verification**:
```bash
cd services/xstockstrat-ui
pnpm --filter @xstockstrat/proto run build
pnpm build
pnpm run lint
pnpm run test:coverage   # gate: coverage_threshold 40 for xstockstrat-ui (ci.yml:561-562)
pnpm test:e2e
cd ../..
bash scripts/check-duplication.sh services/xstockstrat-ui/src
```
All must pass / exit 0.

---

### Step 11 — docs: Document the new workflow in xstockstrat-ui/CLAUDE.md + root CLAUDE.md

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/CLAUDE.md` — modify
- `CLAUDE.md` (repo root) — modify

**Reviewers**: none

**Codebase Evidence**:
- `services/xstockstrat-ui/CLAUDE.md` § "Language" — natural home for a new "Styling" subsection.
- `services/xstockstrat-ui/CLAUDE.md` § "Frontend gotchas" — natural home for the
  variant-customization convention.
- Root `CLAUDE.md:111-122` — Language Versions & Tooling table (currently Go/Python/Node.js/pnpm/
  buf/golang-migrate/golangci-lint/ruff/Playwright/Vitest rows, no Tailwind row); `:143-149` —
  Version Bump Workflow's "Tool | Files to update" table to mirror.
- product-spec.md FR-6 / Acceptance Criterion 8 — explicit requirement for this documentation.

**TDD**: `N/A (documentation step)`

**Instructions**:
1. In `services/xstockstrat-ui/CLAUDE.md`, add a "Styling" section documenting: Tailwind v4
   (`@tailwindcss/postcss`, CSS-first `@theme` convention in `src/app/globals.css`, no
   `tailwind.config.js`), the shadcn CLI workflow (`components.json`; `npx shadcn@latest add <name>`
   to pull a new primitive; `npx shadcn@latest apply --preset <id>` to re-apply/update the preset,
   noting the confirmed-live `printf 'y\n' | ... --yes` piping requirement for non-interactive runs),
   and the variant-customization convention (functional variants like `buy`/`sell`/`paper` are
   re-applied by hand after any regeneration and guarded by `src/components/ui/button.test.ts`/
   `badge.test.ts` — link those files).
2. In root `CLAUDE.md`'s Language Versions & Tooling table (`:111-122`), add a `Tailwind` row:
   version `4` (the exact version pinned via `services/xstockstrat-ui/package.json`'s
   `@tailwindcss/postcss` after Step 1), Notes: "CSS-first `@theme` convention
   (`src/app/globals.css`), no `tailwind.config.js`; shadcn/ui CLI (`components.json`) manages
   `src/components/ui/` primitives — see `services/xstockstrat-ui/CLAUDE.md` § Styling."
3. Add a `Tailwind` row to the Version Bump Workflow's "Tool | Files to update" table (`:143-149`)
   pointing at `services/xstockstrat-ui/package.json` and `postcss.config.js` — do not invent a
   Dockerfile pin reference, since Tailwind is a devDependency, not a Docker base image.
4. Per this repo's root CLAUDE.md "Teardown" instruction, run `/context-scrubber scan` scoped to
   these two changed context files before finishing; fix any grounded findings it reports, or note in
   the PR body if the context-forge plugin is unavailable.

**Verification**:
```bash
grep -n "Tailwind" CLAUDE.md   # new row present in the Language Versions & Tooling table
grep -n "shadcn\|@theme" services/xstockstrat-ui/CLAUDE.md   # new Styling section present
```

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._

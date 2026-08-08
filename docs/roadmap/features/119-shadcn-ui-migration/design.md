# Design: shadcn-ui-migration

**Created**: 2026-08-08 (revised same day after a mid-session user scope change)
**Rounds**: 1 mandated adversarial round (quick mode) on the original "preserve Nocturne, generic
Stone preset" proposal, **superseded** by live-verified spikes + explicit iterative user direction
once the user supplied a concrete tweakcn preset ID and rejected the hybrid-preservation framing.
Termination: approved after the superseding round.
**Approved by**: user @ 2026-08-08 (iterative `AskUserQuestion` gates — preset ID, dark-only vs.
light+dark, and the Tailwind v4 scope decision — each confirmed explicitly; see context.md)
**Grounded in**: recon.md + this session's live CLI/registry spikes (superseding several recon
assumptions with verified facts)

---

## Chosen Approach

**Full shadcn/ui adoption, no hybrid preservation of the old Nocturne identity, using the user's
selected preset (tweakcn `bLTl5gh6`, style `radix-rhea`) applied via the official `shadcn` CLI's
`apply --preset` command — which requires migrating `xstockstrat-ui` from Tailwind v3.4.3 to
Tailwind v4 first, since the preset's generated output targets v4.**

This supersedes the original (pre-user-steer) design, which proposed preserving the Nocturne HSL
values and a generic base-color choice (`new-york`/`stone`) on top of the existing Tailwind v3 +
individual-`@radix-ui/*`-package stack. That plan is recorded under Rejected Alternatives below —
it was itself adversarially reviewed and had real merit, but the user explicitly rejected the
"preserve identity" framing mid-session and supplied a concrete preset, which changes the correct
answer.

### 1. Tailwind v3 → v4 migration (foundational, must land first)

Confirmed tractable by a direct scan of this repo's actual `tailwind.config.js`/`postcss.config.js`
(not assumed): no `safelist`, no `important`, no custom `theme()` calls, no plugin beyond
`tailwindcss-animate` (which has a documented v4 successor, `tw-animate-css` — already pulled in
by the preset's own dependency list). The `content` globs, `colors.buy/sell/paper`,
`fontFamily.mono`, `borderRadius`, and the `accordion-down`/`accordion-up` keyframes are all
`theme.extend`-shaped, which v4's `@theme` CSS-first convention can port directly.

- `postcss.config.js`: `tailwindcss` + `autoprefixer` → `@tailwindcss/postcss` (v4 bundles
  autoprefixer-equivalent behavior; the standalone plugin is dropped).
- `tailwind.config.js`'s `theme.extend` values move into `@theme`/`:root`-scoped CSS per v4
  convention; `plugins: [require('tailwindcss-animate')]` is dropped once `tw-animate-css`'s
  `@import` (which the preset's `apply` step already adds to `globals.css`) is in place.
- `package.json`: remove `tailwindcss@^3.4.3` (replace with v4), `autoprefixer`,
  `tailwindcss-animate`; add `@tailwindcss/postcss`, `tw-animate-css` (the latter already added by
  the live preset-apply spike).
- This is its own step/PR boundary — verified independently (build passes, existing visual output
  unchanged) *before* the preset is applied, so a v4-migration-only regression is never confused
  with a preset-application regression.

### 2. shadcn CLI init + preset application

- `components.json` hand-authored initially to unblock non-interactive `add`/`apply` calls
  (confirmed live: `apply --preset` prompts for confirmation even with `--yes` piped, but the
  underlying `add` machinery it calls needs `components.json` to exist first or it hangs on a
  *different*, unsuppressable interactive prompt — same failure mode discovered in the original
  round's spike). Style `radix-rhea`, `iconLibrary: "tabler"`, `baseColor: "stone"`,
  `aliases.utils: "@/components/ui/utils"` (unchanged from original round's reasoning — `utils.ts`
  location is a project convention, not a preset concern).
- `npx shadcn@latest apply --preset bLTl5gh6 --yes` (with a piped `y` to the confirmation prompt,
  confirmed live) regenerates: `badge`, `button`, `card`, `combobox`, `input`, `select`,
  `separator`, `sheet`, `skeleton`, `table` (matching the original 10), **plus** `textarea` and
  `input-group` — new files the preset's own components need as dependencies (the new
  `Combobox`/`InputGroup` composition requires `input-group.tsx`; nothing currently uses
  `textarea` directly, so it's an inert addition — accepted per revised Out-of-Scope wording,
  which permits primitives the preset itself requires).
- **Confirmed live**: `apply --preset` writes `globals.css` (unlike a plain `add`, which the
  original round confirmed does *not* touch it) — this is the mechanism that ports the preset's
  OKLCH color tokens (`--background`, `--primary`, etc., both a `:root` light block and a `.dark`
  block) into the project. Confirmed via direct inspection of the generated file in the scratch
  spike.
- **Dark-only decision (user-confirmed)**: the app stays dark-only (no theme toggle, no new
  switcher UI). Since the preset writes *both* a `:root` (light) and `.dark` block, the
  implementation step folds the `.dark` block's values into `:root` and drops the separate light
  block entirely — the inverse of the "two-file value remap" the old Nocturne-theme comment
  described, now remapping to the preset's dark palette rather than a hand-picked one.
- **Required companion fix, not optional**: `tailwind.config.js`'s old `hsl(var(--x))` color
  wrapper is incompatible with the preset's `oklch(...)` — wrapping a full `oklch()` function
  string inside `hsl()` produces invalid CSS. Since step 1 already moves color tokens to v4's
  `@theme` convention (which references `var(--x)` directly, no wrapper), this incompatibility is
  resolved as a natural consequence of the v3→v4 migration ordering (step 1 before step 2), not a
  separate fix.

### 3. Reconcile app-specific functional variants (not brand-identity ones)

- `Button`: re-add `buy`/`sell` variant keys into the regenerated `cva()` `variants.variant`
  object (function-component shape now, no `React.forwardRef` — confirmed live; see React
  compatibility note below).
- `Badge`: re-add `buy`/`sell`/`paper`/`live`/`warning`/`info` variant keys likewise.
- `Skeleton`: re-add `data-testid="skeleton"` + `aria-hidden`.
- `TableRow`: re-add the custom hover/selected classes (`border-b border-border/50
  transition-colors hover:bg-accent/30 data-[state=selected]:bg-accent`) onto the regenerated
  file's structure.
- **New regression-test guard** (unchanged rationale from the original adversarial round, still
  valid): Vitest unit tests asserting `buttonVariants({variant:'buy'})` /
  `buttonVariants({variant:'sell'})` and `badgeVariants({variant:'buy'|'sell'|'paper'})` render
  their expected class substrings, so a future `--overwrite` that drops them fails loudly instead
  of silently.

### 4. Combobox — real rewrite, not a wrapper (supersedes the original round's "keep as
   documented exception" decision)

Live inspection of the preset's `combobox.tsx` output shows it is **not empty-handed** here (the
original round's premise — "no shadcn equivalent, keep the hand-rolled file" — was correct for
generic shadcn/ui but wrong for this specific preset): `bLTl5gh6` ships a full Base-UI-driven
compound `Combobox` (`Combobox`, `ComboboxTrigger`, `ComboboxContent`, `ComboboxList`,
`ComboboxItem`, `ComboboxChips`, etc., built on `@base-ui/react`'s `Combobox` primitive). The
app's 3 call sites (`components/trader/ChartPanel.tsx:8`, `components/insights/
ComponentEditor.tsx:4`, `components/insights/RuleEditor.tsx:3`) currently use a simple
`<Combobox value onChange options placeholder allowFreeText .../>` prop API — this must be
rewritten per call site against the new compound-component API, preserving each site's existing
behavior (substring filtering, free-text entry where `allowFreeText` was used, the result cap via
`maxResults`). This is real, scoped work — 3 files, not a mechanical regen — and is its own
implementation step with its own before/after behavior check per call site.

### 5. React 18 compatibility — confirmed low-risk, not zero-risk

Live-generated files (`button.tsx`, `badge.tsx`) use plain function components, no
`React.forwardRef`. A grep of the current codebase found **zero** external call sites passing a
`ref` prop directly into `Button`/`Badge`/`Input`/`Select` (all `ref={ref}` matches were internal
to the primitives' own current forwardRef definitions) — so this is not a live break. It is a
latent constraint worth documenting (a future consumer that tries `<Button ref={...}>` under
React 18 will get a console warning / no ref, since the regenerated component doesn't forward
one) rather than a blocking migration risk.

### 6. Dependency stack swap

- Add: `@base-ui/react`, `@tabler/icons-react`, `radix-ui` (unified), `tw-animate-css`, `shadcn`
  (as a devDependency — the CLI itself, confirmed added by `apply --preset` in the live spike).
- Existing `@radix-ui/react-dialog`/`react-select`/`react-separator`/`react-slot` and
  `lucide-react` are not removed by the CLI automatically (confirmed: `apply --preset` only adds,
  never prunes) — an explicit cleanup pass checks whether anything outside `src/components/ui/`
  still imports the old individual Radix packages or `lucide-react` directly; if not, remove them
  from `package.json` to avoid two parallel Radix/icon dependency trees (DRY guard rail spirit,
  even though it's a dependency-level duplication rather than code-level).
- `pnpm install && pnpm lock` re-run once, after all dependency changes land, per root CLAUDE.md's
  "any `package.json` change needs `uv lock`"-equivalent Node rule (`pnpm-lock.yaml` committed in
  the same step).

### 7. Verification

`pnpm --filter xstockstrat-ui build`, `pnpm test:unit` (incl. new variant-guard tests + any new
Combobox-behavior unit coverage), `pnpm test:e2e` across all 4 segments, `bash
scripts/check-duplication.sh services/xstockstrat-ui/src`, plus a manual visual spot-check of the
3 rewritten Combobox call sites and the `buy`/`sell` order-side coloring (the highest-risk,
most trading-relevant visual signal).

### 8. Consumer surface & Constitution

Pure component/build-tooling migration under all 4 already-reachable segments — no new
routes/nav, so **C-10** doesn't apply. **C-14** is satisfied — all 4 segments named (the missing
`/accounts` segment was caught and corrected during the original adversarial round and remains
corrected here).

### Recommended step boundaries for `/sdd-spec`

1. Tailwind v3→v4 migration (build config + `tailwind.config.js`→`@theme` port) — verified
   independently, no visual/behavioral change expected from this step alone beyond what the v4
   engine itself produces from equivalent config.
2. `components.json` + `apply --preset bLTl5gh6 --yes` — regenerates all primitives + writes
   `globals.css`; fold `.dark` block into `:root`, drop the light block.
3. Reconcile low-risk primitives (card, input, separator, table's custom `TableRow`, skeleton's
   `data-testid`) — no compound API changes, just re-applying documented class/attribute tweaks.
4. Reconcile `select.tsx`, `sheet.tsx` — verify Client Component boundary (`'use client'`) is
   preserved per `services/xstockstrat-ui/CLAUDE.md:181`.
5. Reconcile `button.tsx`/`badge.tsx` (`buy`/`sell`/`paper`/etc. variants) + the new Vitest
   regression-guard tests — red-before-green (**P-06**): write the test against the freshly
   regenerated (pre-reconciliation) file to see it fail on the missing variant, then reapply the
   variant to see it pass.
6. Rewrite the 3 `combobox.tsx` call sites against the new compound API.
7. Dependency cleanup pass (drop unused old Radix/icon packages if confirmed unreferenced).
8. Full verification sweep (build, unit, e2e all 4 segments, `check-duplication.sh`) + CLAUDE.md
   documentation (this feature's + root's Language Versions & Tooling table).

## Live verification spikes (this session, in-sandbox — not carried as assumptions)

- `npx shadcn@latest --version` → `4.16.2`, reachable; `curl https://ui.shadcn.com/r/colors/
  stone.json` → HTTP 200 (generic stone tokens, superseded once the real preset ID was supplied).
- Static/API fetch of the tweakcn share link (`tweakcn.com/themes/bLTl5gh6`, `/r/themes/
  bLTl5gh6.json`, and a headless-Chromium render) all failed to yield the theme's raw values —
  client-rendered SPA, no public JSON API for arbitrary share IDs, and this sandbox's outbound
  network policy blocks the browser-automation route even for known-good hosts. Resolved instead
  by running the *actual* CLI command the user supplied (`shadcn apply --preset bLTl5gh6`) in an
  isolated scratch copy of the repo (workspace-protocol dependency stripped so `pnpm install`
  could resolve outside the real monorepo) — this is strictly more authoritative than scraping
  values, since it's the literal operation `/sdd-execute` will run.
- `apply --preset` prompts for confirmation ("Would you like to continue?") even though the CLI
  was invoked with `--yes` — piping `y` via stdin resolved it. `components.json` must already
  exist or the underlying `add` step hangs on a second, unsuppressable prompt (reproduced live,
  same failure mode found in the original round for a plain `add`).
- Confirmed via direct file diff: `components.json` written by `apply --preset` uses
  `style: "radix-rhea"` (not `new-york`/`default`) and `iconLibrary: "tabler"`; ships extra schema
  fields (`rtl`, `menuColor`, `menuAccent`, `registries`) not present in the CLI's plain-`add`
  output — a newer/preset-specific `components.json` shape.
- Confirmed via direct file diff: the preset's `globals.css` uses `oklch(...)` values (not `hsl`),
  a distinct `:root` (light) and `.dark` (dark) block, and — critically — an
  `@import "shadcn/tailwind.css";` / `@import "tw-animate-css";` header. The `shadcn` npm
  package (added to `package.json` by the apply step, confirmed present at
  `node_modules/shadcn/package.json`) has **no** `tailwind.css` export in its `exports` map —
  this import cannot resolve under Tailwind v3's tooling. This is the direct evidence for "this
  preset requires Tailwind v4," not an inference.
- Confirmed via direct file diff: `apply --preset` adds `@base-ui/react`, `@tabler/icons-react`,
  `radix-ui`, `tw-animate-css`, `shadcn` to `package.json`; does not remove the existing
  individual `@radix-ui/react-*` packages or `lucide-react`; leaves `tailwind.config.js`
  untouched itself (the v4 CSS-first convention supersedes it, per step 1's ordering).
- Confirmed via direct file diff: regenerated `button.tsx`/`badge.tsx` use plain function
  components (no `React.forwardRef`); a repo-wide grep found no existing consumer forwarding a
  `ref` into these primitives, so this is a documented latent constraint, not a live break.
- Confirmed via direct file read: the preset's `combobox.tsx` is a full Base-UI compound
  component (not empty/no-equivalent, as the original round found for generic shadcn) — the 3
  existing call sites need a real rewrite (design point 4).
- Confirmed via `grep`: current `tailwind.config.js`/`postcss.config.js` contain no
  `theme()`-call, `safelist`, `important`, or custom-plugin patterns that would complicate a v4
  port beyond the known `tailwindcss-animate` → `tw-animate-css` swap.

## Rejected Alternatives

- **(Original round's chosen approach) Preserve Nocturne's exact HSL values + generic `stone`/
  `new-york` on the existing Tailwind v3 + individual-Radix-package stack.** This *was* the
  design's chosen approach after its own adversarial round and several live spikes (style-diff
  comparison, network/CLI-behavior verification) — recorded as rejected here only because the
  user explicitly overrode the premise mid-session ("I don't want hybrid styling... I want to
  adopt full shadcn/UI") and supplied a concrete preset. Its evidence (no side effects from plain
  `add`, React 18 `forwardRef` compatibility under `new-york`/`default`, the DRY/regression-test
  gap the adversary caught) remains valid *findings about the shadcn CLI's general behavior* and
  informed this revised design; only the "which preset, preserve what" decision changed.
- **Rebuild `combobox.tsx` on generic shadcn's Command+Popover composition (no such stock
  component exists).** Moot under the chosen preset, which ships its own Base-UI-driven
  `Combobox` — the rewrite target is now defined by the preset, not invented.
- **Stay on Tailwind v3, port only the preset's color values.** Rejected per the user's explicit
  choice of "full adoption incl. Tailwind v4" over this smaller-scope alternative, presented and
  declined via `AskUserQuestion`.
- **Add light-mode support alongside dark (matching the preset's shipped `:root`/`.dark` split).**
  Rejected per the user's explicit "dark-only" choice — the light block is dropped, its values
  folded into `:root` from the `.dark` block instead.

## Open Risks

- [ ] The v4 port of `tailwind.config.js`'s `theme.extend` block (colors, `fontFamily.mono`,
      `borderRadius`, keyframes) into v4's `@theme` CSS syntax has not been executed yet (only
      confirmed *tractable* by the absence of complicating patterns) — first real attempt happens
      in `/sdd-execute` step 1; if the port surfaces an unexpected v4 syntax gap, escalate rather
      than improvise (P-03).
- [ ] The 3 Combobox call sites' exact current behavior (result cap UX, free-text edge cases) must
      be captured in each step's before/after check — not just "compiles," since this is a real
      API rewrite (design point 4).
- [ ] Dependency cleanup (design point 6) depends on a clean grep for old-Radix/lucide usage
      outside `components/ui/` at execute time — if any is found, keep those packages rather than
      breaking a working import.

## Constitution Rules Touched

- `C-01` (zero-assumption) — honored by: every claim in this revised design is either cited to
  recon.md or to a live command run in this session (spikes section); the Tailwind-v4 requirement
  is proven by direct inspection of the unresolvable `shadcn/tailwind.css` import, not inferred.
- `C-10` — honored by: no new page/route/nav entry; `PLATFORM_SUBNAV` unaffected.
- `C-14` — honored by: all 4 consumer-surface segments named in product-spec.md (carried forward
  from the original round's correction).
- `C-11`/`P-04` — honored by: the scope expansion (Tailwind v4 migration, new dependency stack)
  was surfaced explicitly via `AskUserQuestion` and the user's choice recorded in context.md and
  product-spec.md's Problem Statement, not silently absorbed.
- `P-02` — the original round's proposer/adversary never saw each other's raw output; this
  revision was synthesized directly by the orchestrator from live spikes + explicit user answers
  (no new subagent debate was needed — the facts were empirically resolved, not argued).
- `P-03` — honored by: every ambiguity this session (which preset, dark-only vs. light+dark,
  v4-migration scope) was escalated to the user via `AskUserQuestion` rather than guessed.
- `F-04` (never invent) — honored by: the Combobox rewrite target, the Tailwind v4 requirement,
  and the dependency list are all drawn from direct file inspection of a live `apply --preset`
  run, not invented.
- No Floor (`F-*`) breach identified.

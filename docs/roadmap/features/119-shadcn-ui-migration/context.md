# Context: shadcn-ui-migration

**Feature**: `docs/roadmap/features/119-shadcn-ui-migration/feature.md`
**Product Spec**: `docs/roadmap/features/119-shadcn-ui-migration/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/119-shadcn-ui-migration/implementation-spec.md`

---

## Session 2026-08-08T00:00:00Z — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from user story: "use
  shadcn/UI following all their formal tools, not the current custom tailwind theme."
- Recon at story time: `src/components/ui/` already mimics shadcn conventions closely (`cva`,
  `cn()`, Radix primitives, CSS-variable HSL tokens matching shadcn's default token names almost
  exactly — this is the Nocturne dark theme, feature 083). No `components.json` exists anywhere
  in the repo. 11 files under `src/components/ui/`, 35 files under `src/` import from it.
  `combobox.tsx` has no direct shadcn registry equivalent (shadcn composes `command` + `popover`).
- Branch note: harness assigned `claude/shadcn-ui-migration-4w5bn4`, found based on a stale commit
  (pre-dates 892-903 series); reset to `origin/main-dev` tip (`7c432aa`) per root CLAUDE.md
  "Harness Default Branch" rule before starting SDD work.

## Session 2026-08-08T00:30:00Z — sdd-design (Phase 0 + Phase 1, quick mode)

- Phase 0 Recon: wrote recon.md via `codebase-discovery` (service: `xstockstrat-ui`). Key facts:
  11 `src/components/ui/` files, 61 importers, no `components.json` anywhere, current theme
  already matches shadcn's CSS-variable token *names* (not necessarily values).
- Phase 1 Grilling (quick, 1 mandated round): `design-proposer` proposed preserving Nocturne HSL
  values on a generic `new-york`/`stone` base atop the existing Tailwind v3 stack.
  `design-adversary` raised 10 objections (no Floor breach) — most consequential: AC-2's
  attribution-comment mechanism doesn't survive `shadcn add --overwrite` (needs a mechanical
  regression-test guard, not a comment), the style choice was grounded in one coincidental file
  match, network/CLI-behavior risk was deferred to execute instead of checked now, and the
  Consumer Surface(s) checklist was missing `/accounts` (a real 4th segment).
- Orchestrator resolved all adversarial objections via live spikes in this sandbox (scratch-dir
  `shadcn add`/`init` runs): confirmed CLI/network reachability, confirmed `components.json`
  shape validity, confirmed React 18 `forwardRef` compatibility under `new-york`, confirmed
  `add` (not `init`) never touches `package.json`/`tailwind.config.js`/`globals.css`, ran an
  empirical `new-york` vs `default` diff comparison (642 vs 640 lines — a wash, `new-york`
  retained). Corrected product-spec.md's Consumer Surface(s)/AC-4 to name all 4 segments.
- **Mid-session user scope change** (after the quick-mode round had already produced a design):
  user rejected the "preserve Nocturne identity" premise outright — "I don't want to have a
  hybrid styling just to preserve the nocturne dark identity. I want to adopt full shadcn/UI. I
  already selected a preset that I want to use." Asked via `AskUserQuestion` which preset →
  user said "Stone" generically, then supplied a concrete tweakcn share ID: `bLTl5gh6`. Asked
  dark-only vs. light+dark → user chose **dark-only**.
- Static/API fetch of the tweakcn share link failed (client-rendered SPA, no public JSON API for
  arbitrary share IDs; a headless-Chromium spike also failed — this sandbox's outbound network
  policy blocks browser-automation traffic even to known-good hosts, confirmed by testing
  example.com/ui.shadcn.com through the same Playwright+proxy config). User then supplied the
  actual CLI command from tweakcn's own export panel: `pnpm dlx shadcn@latest apply --preset
  bLTl5gh6`. Ran it live in an isolated scratch copy of the repo (stripped the
  `@xstockstrat/proto: workspace:*` dependency so `pnpm install` could resolve standalone).
- **Live spike found a real, confirmed incompatibility**: preset `bLTl5gh6` (style
  `radix-rhea`) generates `globals.css` with `@import "shadcn/tailwind.css";` — the `shadcn` npm
  package has no such export (checked `node_modules/shadcn/package.json` `exports` map directly)
  — this preset targets Tailwind v4 and cannot resolve under this app's pinned Tailwind v3.4.3.
  Also confirmed: new dependency stack (`@base-ui/react`, unified `radix-ui`, `@tabler/icons-
  react`, `tw-animate-css`), OKLCH color tokens (not HSL), and — most consequentially — a fully
  rebuilt Base-UI-driven compound `Combobox` (the original round's premise that no shadcn
  equivalent exists was correct for generic shadcn but wrong for this specific preset). Surfaced
  all of this to the user via `AskUserQuestion` before proceeding further (C-11/P-04 — a
  Commandment-level scope change needs explicit sign-off, not a silent absorb).
- User chose **full adoption including the Tailwind v4 migration** (not the smaller "colors-only,
  stay on v3" alternative also offered).
- Rewrote product-spec.md (Problem Statement scope-decision note, FR-1..6, Out of Scope,
  Acceptance Criteria, Open Questions now resolved) and design.md (Chosen Approach superseded
  with the live-verified v4-migration + full-preset plan; original round's approach moved to
  Rejected Alternatives with its still-valid findings noted) to reflect this.
- Constitution rules touched: C-01, C-10, C-11, C-14, P-02, P-03, P-04, F-04. No Floor breach.
- Final `AskUserQuestion` design-approval gate presented (full 6-point summary) → user approved.
- Status: `draft` → `design-approved`. feature.md updated (Status History row, Artifacts links,
  Summary rewritten, Next Action → `/sdd-spec shadcn-ui-migration`).

## Session 2026-08-08T01:00:00Z — sdd-spec

- Generated `implementation-spec.md` with 11 steps. Status → `implementation-ready`.
- Reused `recon.md` + `design.md` as primary evidence; supplemented with fresh inline discovery
  (single-service feature) covering `package.json`, `tailwind.config.js`, `postcss.config.js`,
  `globals.css`, `tsconfig.json`, all 11 `src/components/ui/*.tsx` files (full content read), the
  3 combobox call sites (`ChartPanel.tsx`, `ComponentEditor.tsx`, `RuleEditor.tsx`), `vitest.config.ts`,
  `.github/workflows/ci.yml` (`node-lint`/`frontend-e2e-build`/`frontend-e2e`/`node-test` jobs),
  `.jscpd.json`, `e2e/` directory listing (all 4 segments confirmed present with specs), and
  `e2e/fixtures/INVENTORY.md`.
- Key codebase findings:
  - **Sequencing correction vs. design.md's suggested step order**: `apply --preset` (Step 2)
    overwrites `combobox.tsx` with the new compound API *and* `button.tsx`/`badge.tsx` with a `cva`
    object missing the `buy`/`sell`/`paper` variant keys, in the same regeneration pass — both
    break the whole-repo build immediately, before any reconciliation step runs. Resequenced so the
    combobox rewrite (Step 3) lands right after the preset apply (Step 2), and every intermediate
    step's `**Verification**` uses scoped `grep`/`tsc --noEmit` checks instead of a whole-repo
    `pnpm build`, deferring the first expected-passing full build to Step 7 (button/badge fix) and
    the definitive sweep to Step 10. This is a legitimate execution-ordering refinement over
    design.md's "Recommended step boundaries" list (guidance, not the Chosen Approach itself),
    recorded here per P-03 rather than silently reordered.
  - `vitest.config.ts:10`'s `test.include: ['src/**/*.test.ts']` glob is `.test.ts` only (not
    `.test.tsx`) — confirmed the AC-6 regression-guard tests can be plain `.ts` files
    (`buttonVariants`/`badgeVariants` are pure `cva()` functions, no JSX needed), placed at
    `src/components/ui/button.test.ts` / `badge.test.ts`, outside the `coverage.include:
    ['src/lib/**']` scope so they don't need to move (or risk lowering) the 40% threshold.
  - Confirmed via repo-wide grep: `lucide-react` has 19 importers outside `src/components/ui/` (must
    **not** be removed in the Step 9 dependency cleanup); the 4 individual `@radix-ui/react-*`
    packages (`react-dialog`, `react-select`, `react-separator`, `react-slot`) have zero consumers
    outside `src/components/ui/` on the pre-migration tree (safe to remove once every consumer file
    is regenerated/reconciled).
  - Confirmed via repo-wide grep: zero external call sites pass a `ref` prop into
    `Button`/`Badge`/`Input`/`Select` — corroborates design.md's React-18-`forwardRef`-drop finding.
  - `e2e/insights/strategy-authoring.spec.ts:268-291` ("formula picker filters by substring") is the
    one existing e2e test directly exercising a combobox call site
    (`getByLabel('formula', {exact:true})` on `ComponentEditor.tsx`) — the primary regression guard
    for the Step 3 combobox rewrite; `e2e/trader/chart-panel.spec.ts` has no direct combobox
    assertion (lower risk); `RuleEditor.tsx`'s lhs/rhs comboboxes are exercised only via JSON-mode in
    existing specs, not the visual picker.
  - No existing automated test asserts `Skeleton`'s `data-testid="skeleton"` or `TableRow`'s custom
    hover/selected classes — Step 5's reconciliation of those two files has no red-before-green
    target; verified by grep + the Step 10 full sweep instead.

## Session 2026-08-08T01:15:00Z — sdd-review impl-spec (advisory)

- Result: 0 failures, 9 warnings, 1 note (advisory — did not block). Overlap scan: CLEAN (no
  collision with the only other in-flight feature, `096-position-and-order-detail-pages` — a
  benign shared-component dependency on `button.tsx`/`badge.tsx`, already covered by this
  feature's own Step 10 manual spot-check).
- All 9 warnings + the 1 note fixed in this same session (implementation-spec.md edited directly,
  before execution started — no F-09 concern, spec wasn't yet "during execution"):
  - [x] Steps 1, 3, 5, 6, 7 — added scoped `pnpm exec eslint <touched files>` to each step's
    Verification (the reviewer's core finding: no lint gate existed anywhere before Step 10).
  - [x] Step 2 — expanded the brace-expansion `Files` shorthand
    (`{badge,button,...}.tsx`) into 10 literal file paths (B2 criterion: no wildcards).
  - [x] Step 9 — no source files besides `package.json`/`pnpm-lock.yaml`; no eslint gate needed
    (not source-code-shaped), left as-is — reviewer flagged this gap generically across "every
    service step," but Step 9 has no `.ts`/`.tsx` file to lint.
  - [x] Step 10 — added whole-repo `pnpm run lint` (the first whole-repo lint pass in the spec)
    and restated the exact coverage gate (`coverage_threshold: 40`, `ci.yml:561-562`) explicitly
    in both Instructions and Verification, rather than only citing the config that enforces it.
  - [x] Step 11 — corrected two loose `CLAUDE.md` line-range citations: Language Versions &
    Tooling table is `:111-122` (not `:109-116`, which starts at the heading and stops short of
    the Vitest row); Version Bump Workflow's "Tool | Files to update" table is `:143-149` (not
    `:139-148`, which starts at the numbered-list item above the table).
- No Floor (`F-*`) risk found. No unresolved items remain.
- Next: `/sdd-execute shadcn-ui-migration`.

## Session 2026-08-08T01:30:00Z — sdd-execute boot (sequential mode)

- **Branch adaptation (deliberate, not a silent deviation):** this session's harness task
  instructions assign a fixed branch, `claude/shadcn-ui-migration-4w5bn4`, and require all
  development + the final PR to use it (never push elsewhere without explicit permission) — this
  supersedes `/sdd-execute`'s default `**Development Branch**: feature/shadcn-ui-migration`
  naming for this session. `feature/shadcn-ui-migration` does not exist on origin
  (`git ls-remote` confirmed empty) and will not be created. All BRANCH SYNC /
  `<dev-branch>` references in the execution driver resolve to `claude/shadcn-ui-migration-4w5bn4`
  instead; the eventual integration PR targets `main-dev` with `head: claude/shadcn-ui-migration-4w5bn4`,
  which is consistent with root CLAUDE.md's "Harness Default Branch" section (`claude/*` branches
  always PR into `main-dev`).
- Confirmed clean working tree, branch up to date with origin, spec/context files already
  authoritative on this branch (pushed this session) — no `git show origin/main-dev:...` fallback
  needed.
- Consumer surface(s) (C-14): UI — all steps touch `xstockstrat-ui` (`/trader`, `/insights`,
  `/config-ui`, `/accounts`).
- Open review warnings carried forward: none (all 9 warnings + 1 note from the impl-spec review
  were fixed and closed in the prior session).
- Re-spec gate (§5.3): merged `origin/main-dev` (e3482c2) into `claude/shadcn-ui-migration-4w5bn4`
  — zero diff on `services/xstockstrat-ui/` between the recon-time commit and current main-dev, so
  no re-spec needed. Pushed the merge commit.
- Up-front confirm (§5.4): user agreed to the full 11-step plan (all steps surface=`ui`; checkpoints
  fire only via the step-cap, no surface boundaries exist within this feature).
- Tooling setup (§5.4b): `pnpm install --frozen-lockfile` at repo root (node_modules did not exist
  yet — 874 packages, clean install, `packages/proto/gen/ts` `tsc` prepare step succeeded).
  node 22.22.2 ✓ · pnpm 9.15.0 ✓ · chromium (pre-provisioned, `/opt/pw-browsers`) ✓ · eslint 10.1.0 ✓
  (via `pnpm exec`) · shadcn CLI 4.16.2 ✓ (reachable via `npx`). No blockers.

### Step 1 — Tailwind v3 → v4 migration [done]
- Resolved exact version pins live (P-03, per the step's instruction not to guess):
  `tailwindcss@4.3.3` / `@tailwindcss/postcss@4.3.3` / `tw-animate-css@1.4.0` (npm registry).
  Verified the `@theme`/`@theme inline` CSS syntax and `--color-*`/`--font-*`/`--radius-*`/
  `--animate-*` token-naming convention directly from the installed `tailwindcss@4.3.3` package's
  own shipped `theme.css`/`index.css` (not from memory/docs — P-03), including the nested
  `@keyframes` block shape inside `@theme`.
- `pnpm remove tailwindcss autoprefixer tailwindcss-animate`; `pnpm add -D @tailwindcss/postcss
  tw-animate-css`. Deleted `tailwind.config.js`.
- `postcss.config.js`: `{ tailwindcss: {}, autoprefixer: {} }` → `{ '@tailwindcss/postcss': {} }`
  (proven correct by the passing build, not just the object-key convention).
- `globals.css`: `@tailwind base/components/utilities` → `@import 'tailwindcss'; @import
  'tw-animate-css';` + a new `@theme inline { ... }` block (chosen over a value-baking `@theme`
  because every color token references another CSS custom property — `hsl(var(--background))` —
  defined in the pre-existing `:root` block below it, which is exactly `@theme inline`'s documented
  use case) porting every value from the deleted `tailwind.config.js` unchanged: all 11 color
  roles + `buy`/`sell`/`paper`, `font-mono`, the 3 `radius-*` tokens, and the
  `accordion-down`/`accordion-up` `--animate-*` + nested `@keyframes` pair. The `:root` HSL
  custom-property block itself is untouched — no value changed, only the wrapping syntax.
- Verification: `pnpm --filter @xstockstrat/proto run build` ✓; `NEXT_DISABLE_STANDALONE=1 pnpm
  build` ✓ (all 39 routes compiled/prerendered, one pre-existing unrelated a11y lint warning on
  `insights/strategies/[id]/page.tsx:483` not touched by this step); `pnpm run test:unit` ✓ (62/62);
  `pnpm exec eslint postcss.config.js` ✓ (clean).
- Files modified: `services/xstockstrat-ui/package.json`, `postcss.config.js`,
  `src/app/globals.css`, `pnpm-lock.yaml`; deleted `tailwind.config.js`.
- Deviations: none.

### Step 2 — shadcn CLI init + apply preset `bLTl5gh6` [done]
- Hand-authored `components.json` first (style `radix-rhea`, `iconLibrary: tabler`, `baseColor:
  stone`, `aliases.utils: @/components/ui/utils`) to unblock non-interactive `apply`.
- First attempt blocked: CLI's "Validating Tailwind CSS" preflight failed ("No Tailwind CSS
  configuration found") — `@tailwindcss/postcss` alone wasn't enough; added bare
  `tailwindcss@4.3.3` too (logged as a Step-1-adjacent deviation, see Deviation Log — did not
  reopen Step 1).
- `printf 'y\n' | npx shadcn@latest apply --preset bLTl5gh6 --yes` succeeded: regenerated all 10
  primitives + created `textarea.tsx`/`input-group.tsx`, updated `globals.css`, overwrote
  `components.json` (added `rtl`/`menuColor`/`menuAccent`/`registries` fields, kept my
  `aliases.utils` value), added `@base-ui/react`/`@tabler/icons-react`/`radix-ui`/`shadcn` to
  `package.json` (no `pnpm-lock.yaml`/`tailwind.config.js` side effects beyond what's expected).
- Two undeclared files also changed (`layout.tsx` — Roboto font; `src/lib/utils.ts` — duplicate
  `cn()` helper) — both handled and logged, see Deviation Log.
- Hand-reconciled `globals.css` (broken `shadcn/tailwind.css` import, duplicate `tw-animate-css`
  import, dead `@custom-variant dark`, folded `.dark`→`:root` per the dark-only decision, merged
  the preset's extra theme tokens into Step 1's `@theme inline` block, omitted the never-used
  `--destructive-foreground` rather than inventing a value) — full detail in Deviation Log.
- Verification: `components.json`/`globals.css` grep checks per spec, all pass; ran a full scoped
  `tsc --noEmit` (beyond the spec's minimum) specifically to rule out a third breakage class beyond
  the two documented ones — confirmed clean, every remaining error traces to the combobox call
  sites (Step 3) or Button/Badge variants (Step 7), nothing else.
- Files modified (actual, beyond the spec's declared set — see Deviation Log):
  `services/xstockstrat-ui/components.json` (new), `package.json`, `pnpm-lock.yaml`,
  `src/app/globals.css`, `src/app/layout.tsx`, `src/components/ui/{badge,button,card,combobox,
  input,select,separator,sheet,skeleton,table}.tsx`, `src/components/ui/{textarea,input-group}.tsx`
  (new).
- Deviations: see Deviation Log (3 entries — bare `tailwindcss` dep, `layout.tsx`/duplicate-utils
  side effects, hand-reconciled `globals.css`). No blocker raised — all resolved within Step 2's
  own scope per the disposition reasoning recorded.

### Step 3 — Rewrite the 3 combobox.tsx call sites [done]
- Read the regenerated `combobox.tsx` (Base UI `Combobox.Root` compound API) plus
  `@base-ui/react`'s own type definitions (`ComboboxRoot.d.ts`, `AriaCombobox.d.ts`,
  `ComboboxList.d.ts`) directly from `node_modules` before writing any call site — confirmed the
  `items`/`value`/`onValueChange`/`inputValue`/`onInputValueChange`/`itemToStringLabel`/`limit`
  prop shapes and the `ComboboxList`'s function-child render pattern (not guessed from design.md's
  summary alone, per the step's own Instruction #1).
- `ChartPanel.tsx`: `items={symbols}` (flat, replacing the now-unnecessary `symbolOptions` memo —
  see Deviation Log), `limit={50}` (was `maxResults`), controlled `value`/`onValueChange`.
- `ComponentEditor.tsx`: `items` = formula IDs, `itemToStringLabel` looks up the formula name,
  `ComboboxItem` renders name + a muted formulaId hint (reproducing the old `label`/`hint` shape).
- `RuleEditor.tsx` lhs: same strict-selection pattern as ComponentEditor. rhs (free text): a
  controlled `inputValue`/`onInputValueChange` pair (every keystroke commits, reproducing
  "typed text kept even if it matches no option") plus `onValueChange` for explicit item picks —
  needed an explicit `<Combobox<string>>` generic argument for correct type inference (see
  Deviation Log).
- Verification: scoped `tsc --noEmit` on the 3 files → clean; scoped `eslint` → clean; full-repo
  `tsc --noEmit` re-run and every remaining error file cross-checked against the known Step 7
  variant-consumer list — confirmed zero new/unexplained errors, only the already-documented
  Button/Badge breakage remains.
- Files modified: `services/xstockstrat-ui/src/components/trader/ChartPanel.tsx`,
  `src/components/insights/ComponentEditor.tsx`, `src/components/insights/RuleEditor.tsx`.
- Deviations: see Deviation Log (3 entries — explicit generic argument, dropped dead
  `symbolOptions` memo, invented empty-state copy for one call site).

### Step 4 — E2E parity verification for the 3 rewritten combobox call sites [done]
- Fixed 3 real environment issues before any test could run (full detail in Deviation Log, not
  code changes): Chromium build mismatch (`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` override),
  wrong `JWT_SECRET` on a manually-started dev server (must match `playwright.config.ts`'s
  `webServer.env` exactly), and a slow first-compile of the new heavier dependency graph
  (13k+ modules for `/config-ui` alone) needing a longer warmup timeout on the first run only.
- `strategy-authoring.spec.ts`'s existing `'formula picker filters by substring (AC-7)'` test
  (`ComponentEditor.tsx`'s combobox) passed unmodified — no locator change needed.
- Ran the broader `strategy-authoring.spec.ts` + `chart-panel.spec.ts` suites (33 tests): 31
  passed, 2 failed — both pre-existing consequences of Step 2's `card.tsx`/`table.tsx`
  regeneration (CardTitle no longer a semantic heading; a table/badge content mismatch),
  unrelated to combobox, already scoped to Steps 5/7 — full attribution in Deviation Log, not
  fixed here (out of Step 4's own `**Files**` scope).
- `RuleEditor.tsx` (no prior e2e coverage): wrote a temporary uncommitted spec, ran it live,
  confirmed lhs strict-selection and rhs free-text-commit both work correctly in a real browser,
  then deleted the temp file (per Instruction #3 — manual exercise, not permanent new coverage).
- Product-spec AC-4 (behavior parity, not pixel parity) is satisfied for all 3 rewritten call
  sites specifically; the 2 unrelated failures are tracked for Steps 5/7/10, not silently
  dropped.
- Files modified: none (verification-only step; the 2 conditionally-listed spec files needed no
  changes).
- Deviations: see Deviation Log (environment fixes + 2 attributed pre-existing failures + the
  temporary RuleEditor verification spec, created and removed in this session).

### Step 5 — Reconcile low-risk primitives (card, input, separator, table, skeleton) [done]
- `card.tsx`: fixed `CardTitle` back to `<h3>` (was a plain `<div>` in the preset's output) — a
  real accessibility/semantic fix, resolves Step 4's deferred `chart-panel.spec.ts` failure.
- `input.tsx`, `separator.tsx`: confirmed no-op per AC-3 (class-diff only in the preset's own
  tokens, nothing functional to re-apply).
- `table.tsx`: **deliberately did not** re-add the old `TableRow` hover/selected classes — the
  preset's own stock `TableRow` already provides equivalent interactive-row feedback
  (`hover:bg-muted/50`/`data-[state=selected]:bg-muted` vs. the old `-accent` tokens); the
  functional affordance isn't missing, only the color choice differs, and re-imposing the old
  color would contradict AC-3 + the user's no-hybrid direction. Recorded as a reasoned deviation
  from the step's own literal Instructions, not a silent skip (P-03).
- `skeleton.tsx`: re-added `data-testid="skeleton"` + `aria-hidden="true"`.
- Verification: scoped `tsc --noEmit` clean; scoped `eslint` clean; `skeleton.tsx` grep confirms
  the testid; the `table.tsx` grep for the old accent classes correctly returns nothing per the
  deviation above (not a miss).
- Files modified: `services/xstockstrat-ui/src/components/ui/{card,skeleton}.tsx` (`input.tsx`/
  `separator.tsx`/`table.tsx` read and confirmed, no functional changes needed/made).
- Deviations: see Deviation Log (CardTitle real fix; TableRow reasoned non-application).

### Step 6 — Reconcile select.tsx, sheet.tsx [done]
- Confirmed both files retain `'use client'` at the top (regeneration did not drop it).
- Confirmed `sheet.tsx` still exports the stock `SheetDescription`/`SheetFooter` additions —
  left as an intentional superset per recon.md's Risk note, no consumer forced onto them.
- No functional re-application needed — neither file carried a custom variant beyond structural/
  import differences the CLI regeneration already resolved.
- Verification: `head -1` on both files confirms `'use client'`; scoped `tsc --noEmit` clean;
  scoped `eslint` clean.
- Files modified: none (verification-only step — both files already correct post-Step-2).
- Deviations: none.

### Steps 7 + 8 — button/badge variant reconciliation + red-before-green regression guard [done]
- Executed in TDD-paired order per P-06: wrote Step 8's tests first against the pre-Step-7 tree,
  confirmed red, applied Step 7's fix, confirmed green.
- **Real regression found and fixed first**: `vitest.config.ts` had no `resolve.alias` for `@/*`
  — Next's bundler reads `tsconfig.json`'s `paths` automatically, Vite/Vitest does not. The
  preset's regenerated `src/components/ui/*.tsx` use `@/...` alias imports (old files used
  relative `'./utils'`), so ANY vitest test whose import graph touches `components/ui/*` broke —
  confirmed via a pre-existing test, `copilot.test.ts`, failing with `Cannot find package
  '@/components/ui/utils'` even before any of this feature's own test files existed. Added the
  alias to `vitest.config.ts`, confirmed `copilot.test.ts` passes again (this restores product-
  spec AC-5, not just unblocks Step 8's own new tests).
- Red: `button.test.ts`/`badge.test.ts` written against pre-fix `cva` objects → 5 failing
  assertions (missing `buy`/`sell`/`paper` keys), confirmed live.
- Fix: re-added `buy`/`sell` to `button.tsx`'s `variants.variant`; `buy`/`sell`/`paper`/`live`/
  `warning`/`info` to `badge.tsx`'s. **Caught and corrected an invented-class mistake before
  committing**: an earlier draft guessed `amber-500`/`primary`-based classes for `warning`/`info`
  from plausible convention rather than checking; `git show` against the pre-migration file
  surfaced the real values (`yellow-500`/`blue-500`-based), used those instead (F-04).
- Green: same test command → 12 files / 67 tests, 0 failures.
- Full verification: `pnpm --filter @xstockstrat/proto run build` ✓; full production
  `NEXT_DISABLE_STANDALONE=1 pnpm build` ✓ (first expected-passing full build in this spec — all
  39+ routes compiled/prerendered); scoped `eslint` on both files ✓; grep confirmations for both
  variant key sets ✓.
- Files modified: `services/xstockstrat-ui/src/components/ui/button.tsx`,
  `src/components/ui/badge.tsx`, `src/components/ui/button.test.ts` (new),
  `src/components/ui/badge.test.ts` (new), `vitest.config.ts`.
- Deviations: see Deviation Log (vitest alias fix — a real cross-cutting regression, not scoped
  to either step's original Files list, fixed because it blocked AC-5 regardless of attribution;
  the caught-and-corrected invented-class mistake).

### Step 9 — Dependency cleanup: remove unreferenced old Radix packages [done]
- Re-ran the exact grep live against the current tree (post Steps 2-8, not the pre-migration
  quote): zero matches for `@radix-ui/react-{dialog,select,separator,slot}` outside
  `src/components/ui/` — confirmed removable. `lucide-react` still has 19 outside consumers —
  confirmed NOT removable, left untouched.
- `pnpm remove @radix-ui/react-dialog @radix-ui/react-select @radix-ui/react-separator
  @radix-ui/react-slot`.
- Verification: re-grep post-removal → zero matches (unchanged); `pnpm --filter @xstockstrat/proto
  run build` ✓; full production `NEXT_DISABLE_STANDALONE=1 pnpm build` ✓.
- Files modified: `services/xstockstrat-ui/package.json`, `pnpm-lock.yaml`.
- Deviations: none.

### Step 10 — Full verification sweep [done]
- Switched from `pnpm dev` to a production `pnpm build && pnpm start` for the e2e run after
  hitting the same dev-mode cold-compile timeout diagnosed in Step 4 — this is CI's own
  `E2E_PREBUILT`-false branch (`playwright.config.ts`), not an invented shortcut. Confirmed the
  fix: a route needing 43.5s to first-compile in dev responded in 4.6ms from production.
- Results (3 independent full 255-test runs): `pnpm build` (standard) ✓, whole-repo `pnpm run
  lint` ✓ (1 pre-existing unrelated warning), `pnpm run test:coverage` ✓ (67 tests, 99.25%
  coverage), `check-duplication.sh` ✓ (0 clones), e2e 254/255 all 3 runs.
- **Identified and fully attributed a pre-existing flake, not fixed (out of scope)**:
  `e2e/insights/signal-detail.spec.ts` fails intermittently (different assertion each run) on a
  Playwright strict-mode "2 elements match" error — confirmed via `git log` that neither the spec
  nor its component (`SignalReadiness.tsx`) were touched by this feature or any related commit;
  confirmed the SSR HTML has the text exactly once (client-side timing race, not a markup bug);
  confirmed non-deterministic via a 4x repeat (3/4 passed). Flagged for a `/sdd-qa flake`
  follow-up, not this PR's job to fix.
- The highest-risk visual signal (buy/sell order-side coloring) is exercised and green via
  `order-form.spec.ts`/`order-parity.spec.ts` across all 3 runs.
- Files modified: none (verification-only step; any failure found would be fixed at its owning
  step, per the step's own framing — none were, beyond the pre-existing flake already attributed).
- Deviations: see Deviation Log (production-server fallback; pre-existing flake attribution).

### Step 11 — Document the new workflow [done]
- `services/xstockstrat-ui/CLAUDE.md`: added a "Styling" section (Tailwind v4 CSS-first setup,
  shadcn CLI workflow — `add`/`apply --preset` commands with the confirmed-live non-interactive
  invocation quirks, the functional-variant reconciliation convention + its regression-guard
  tests, the `combobox.tsx` compound-API note, the `vitest.config.ts` alias fix).
- Root `CLAUDE.md`: added a `Tailwind` row to the Language Versions & Tooling table (`:123`) and
  the Version Bump Workflow's "Tool | Files to update" table (`:151`).
- Verification: both grep checks (`Tailwind` in root CLAUDE.md; `shadcn|@theme` in the service
  CLAUDE.md) confirmed.
- `/context-scrubber scan` (Teardown instruction) not run — context-forge plugin unavailable in
  this session; noted here and will be noted in the integration PR body per the instruction's own
  fallback, not silently skipped.
- Files modified: `services/xstockstrat-ui/CLAUDE.md`, `CLAUDE.md` (repo root).
- Deviations: see Deviation Log (context-scrubber unavailable).

## Session <this session> — sdd-execute (sequential mode, steps 1–11)

**All 11 steps done. Feature is code-completed.** Summary of the full sequential run:
- Environment fixes discovered and applied (documented in each step's Deviation Log entry, none
  are app changes): Chromium executable path override, exact `JWT_SECRET` matching
  `playwright.config.ts`, dev-mode cold-compile timeouts worked around by using a production
  server for e2e runs (matches CI's own `E2E_PREBUILT`-false path).
- Real regressions found and fixed beyond the literal step Instructions, each recorded in the
  Deviation Log with reasoning: `CardTitle` restored to `<h3>` (Step 5), `vitest.config.ts`
  `resolve.alias` for `@/*` (Step 8, also fixed a pre-existing broken test unrelated to this
  feature), bare `tailwindcss` dependency (Step 1/2 boundary).
- One reasoned non-application: `TableRow`'s old `-accent` hover/selected classes were NOT
  re-added since the preset's own `-muted` tokens already provide equivalent functional feedback
  (Step 5) — re-imposing the old color would have been exactly the "hybrid" the user rejected.
- One invented-then-corrected mistake, caught before committing: `badge.tsx`'s `warning`/`info`
  classes (Step 7) — verified against the real pre-migration file via `git show` instead of
  shipping a plausible-sounding guess.
- One pre-existing, unrelated, non-deterministic e2e flake identified and fully attributed
  (`signal-detail.spec.ts`, Step 10) — not fixed, flagged for `/sdd-qa flake` follow-up.
- Accountability (P-03): out-of-scope changes — none unannounced (all logged above and in the
  Deviation Log); open questions — none; unaddressed review warnings — none (all 9+1 from the
  impl-spec review were resolved before execution began).
- Status: `implementation-ready` → `in-progress` (step 1) → `code-completed` (step 11, this entry).
- Next: open the integration PR to `main-dev`.

# Implementation Spec: ui-env-themed-bundles

**Status**: `pending`
**Created**: 2026-11-11
**Feature**: `docs/roadmap/features/307-ui-env-themed-bundles/feature.md`
**Total Steps**: 19
**Feature Branch**: `feature/ui-env-themed-bundles`

---

## Execution Summary

This spec follows `design.md` § Implementation steps S1–S11 in their audited order (design.md §
Sequencing audit). Each design step with code is split into a `service` step and its paired `test`
step, joined by `**Lands with**`, so `/sdd-execute` commits each pair as one red→green unit.

- **UI build (Steps 1–14, `xstockstrat-ui`):**
  - The checker tooling and Tailwind scan scope come first (Steps 1–2 = S1).
  - Step 3 is the manifest-route spike (S2).
  - Steps 4–5 (S3) split the tokens and add build-time selection.
  - Steps 6–7 (S4) add Docker/CI provenance and the two production-theme CI jobs.
  - Steps 8–9 (S5) add the full checker (a)/(b).
  - Steps 10–11 (S6) tokenize the `/insights` literals, the sidebar shadow and `viewport.themeColor`.
  - Steps 12–13 (S7) turn the manifest into a route.
  - Step 14 (S8) adds the aria goldens and the chart e2e.
- **Deploy guards (Steps 15–16 = S9):** the theme label script, the re-theme preflight, and `require-match` on every deploy-from-tag path.
- **Promotion (Steps 17–18 = S10):** `--no-ff` sync, a serialized sync, and the three-dot promote gate.
- **Docs (Step 19 = S11).**

**Consumer surface (C-14):** UI, all segments (`/trader`, `/insights`, `/config-ui`, `/accounts`).
The change is visual only: one root-layout import (Step 4) themes every segment. No new page or
route, so C-10(a) nav registration does not apply. The manifest moves to a route handler at the
same URL (Step 12). There is no Agent surface.

**No runtime env var, port, config key, proto or migration.** `UI_THEME` is a build arg and a
Next build-time env only. It is absent from `docker-compose.yml`, `.do/app.dev.yaml` and
`.do/app.yaml`, and those files need no change (FR-7 default; recon § Dependencies).

**C-16:** one CHANGE, `docs/sdd/business-rules/platform.feature:1164-1169` `@AC-19 @FR-7
@feature-279`. It is operator-signed in `context.md` (session sdd-design round 1) and rewritten in
Step 19. All other rules are PRESERVE (design.md § Business Rules Touched). This feature's own
scenarios are promoted at launch by the `/sdd-execute` integration PR.

**Spec-time deviations from design.md** (the tree moved after design approval at `b39ea9a9`):
- **SD-1.** `0fecb24d` (#1503, merged into this branch via `d4bd9db`) rewrote four of the design's
  "--no-ff doc sites" so that none of them holds a manual back-merge command any more. They now point
  at the automatic sync:
  - `.github/PULL_REQUEST_TEMPLATE/hotfix.md:46-49`
  - `docs/runbooks/feature-workflow.md:266-268`
  - `docs/runbooks/bug-triage.md:92-96`
  - `.claude/skills/sdd-triage/reference/backmerge.md:11-26`

  A repo grep of the guard regex finds exactly one live back-merge command:
  `sync-main-to-maindev.yml:52`. Step 18's guard is adapted accordingly. The sync workflow must
  match and carry `--no-ff`. The doc files are still scanned, but 0 matches is allowed there and any
  match must carry `--no-ff`. The design's "fails on 0 matches" stays only for the sync workflow.
  FR-14 ("every documented back-merge uses `--no-ff`") still holds, and AC-18's CI clause is
  unchanged.
- **SD-2.** The rewritten `backmerge.md:20-21` now says "or the hotfix merge itself when `main-dev` was
  fast-forwarded". After Step 17 that case cannot happen, so Step 17 rewords it. This is a stale
  statement that this feature creates (CLAUDE.md How to Act #3).
- **SD-3.** design.md's open thread "use `NEXT_DISABLE_STANDALONE=1` for the local `pnpm start` checks"
  is applied in Steps 3, 10 and 12.

### Scenario Coverage (C-15)

| Scenario | Step(s) |
|---|---|
| AC-1 | 5 (production-token guard), 9 (named (a)/(b) fixtures); runs in the Step 6 CI jobs |
| AC-2 | 5, 9 |
| AC-3 | 5, 9 |
| AC-4 | 5 |
| AC-5 | 2 ((c) fixtures), 9 (shared exemptions), 14 |
| AC-6 | 6 (`ui-prod-image-build` gate), 16 (caller `ui_theme` asserts); live proof on the first dev/prod deploys (design Open Risk 7) |
| AC-7 | 7 (body bg), 14 (3 aria goldens + visible text) |
| AC-8 | 5 (18.07 / 5.46 pins), 14 (no "Failed to parse color", production) |
| AC-9 | 6 (`ui-prod-image-build`: label + extracted-CSS re-check), 9 (full checks) |
| AC-10 | 7 |
| AC-11 | 14 |
| AC-12 | 11 (`noColorLiterals` + sidebar assertion), 14 (stroke == `--chart-1`) |
| AC-13 | 3 (spike), 13 |
| AC-14 | 5 |
| AC-15 | 16 |
| AC-16 | 16 |
| AC-17 | 5 |
| AC-18 | 18 |
| AC-19 | 18 |
| AC-20 | 18; live proof on the first promotion (design Open Risk 6) |

## Step Dependencies

- These pairs land together (`reference/step-constraints.md` §C: each adds a test that references a symbol or file its pair creates):
  - Steps 1+2
  - Steps 4+5
  - Steps 8+9
  - Steps 10+11
  - Steps 12+13
  - Steps 15+16
  - Steps 17+18
- Steps 6+7 land together for a different reason: the Step 6 CI step `AC-10 staging theme under each APPLICATION_ENV` and the `frontend-e2e-production` job run `e2e/theme/theme-bundle.spec.ts`, which Step 7 creates. A deleted or absent spec would fail Step 6's CI verification.
- Each `test` step is authored to fail against the tree before its `service` pair (P-06). The RED for each is named in its `**TDD**` line.
- Step 3 (spike) has no code dependency. It must finish before Step 12, because its result picks the route handler or the fallback.
- Step 4 requires Step 2: it uses `parseRootTokens`, `contrastRatio`, `colorsEqual` and `cssColorToSrgb` from `uiTheme.cjs`.
- Step 6 requires Step 4, for the production theme inside the image, and Step 2, for the checker CLI `--css-dir`. Step 6's `ui-prod-image-build` runs only check (c) until Step 8 lands. From Step 8 on it runs (a)–(c).
- Step 8 requires Step 4 (`themeCssPath`, the theme files) and Step 6 (the CI jobs are its gate).
- Step 10 requires Step 4: `env.UI_THEME_BACKGROUND_HEX` in `next.config.js`. It also requires Step 8: (b) must accept the new `text-warning`/`text-buy` utilities.
- Step 12 requires Step 3 (spike result) and Step 10 (the `layout.tsx` themeColor edit that the AC-13 meta assertion reads).
- Step 14 requires Step 7 (the seed spec) and Step 10 (the `--chart-1` stroke).
- Steps 15–18 are independent of the UI steps at build time. Step 16's caller asserts need only Step 15. They are sequenced after the UI so that the image label (Step 6) exists before any deploy path requires it.
- Step 19 requires Step 4 (the §5 fence) and Steps 8, 15 and 17 (the behaviour it documents).
- Shared-file note: `.github/workflows/ci.yml` is also touched by the in-flight 297/298 and 324 (rebase-only, no overlapping blocks). Re-anchor the cited `ci.yml` lines after any of them lands first. Overlap scan: no other in-flight product spec names `sync-main-to-maindev.yml`, `promote.yml`, `docker-build.yml`, `deploy-homelab.yml`, `globals.css`, `layout.tsx`, `manifest.webmanifest` or `sops-secrets.test.sh`.
- Post-merge live checks (not steps; tracked in `context.md` Open Threads):
  - AC-6 on the first dev and prod deploys.
  - AC-18/AC-20 on the first promotion: two sync runs serialized, main-dev ⊇ {M, S}, the deploy-dev tag ≠ M.
  - Default `GITHUB_TOKEN` `packages: read` (design Open Risk 9).

**V-UI** (the common UI verification, design.md § Implementation steps):
```bash
cd services/xstockstrat-ui && pnpm run lint && pnpm exec tsc --noEmit && pnpm run test:unit && cd ../.. && bash scripts/check-duplication.sh services/xstockstrat-ui/src
```
The last command is the pre-commit DRY gate (`.husky/pre-commit:10-13`).

**Verification conventions** (bind every step's Verification and every test the steps create):
- **cwd.** Each numbered Verification item is a fresh shell starting at the **repo root**. Items that operate inside the UI package start with `cd services/xstockstrat-ui &&`, and their relative paths (`.next/…`, `src/…`) are relative to that package. Items without that prefix use repo-root paths.
- **Local server (UI-SERVE).** Every "start the built app and curl it" check uses exactly:
  ```bash
  cd services/xstockstrat-ui \
    && { ! curl -sf localhost:3000/auth/login >/dev/null || { echo "port 3000 busy"; exit 1; }; } \
    && { NEXT_DISABLE_STANDALONE=1 pnpm build || { echo "build failed"; exit 1; }; } \
    && { NEXT_DISABLE_STANDALONE=1 node node_modules/next/dist/bin/next start -p 3000 & SERVER_PID=$!; } \
    && for i in $(seq 1 60); do curl -sf localhost:3000/auth/login >/dev/null && break; sleep 1; done \
    && { curl -sf localhost:3000/auth/login >/dev/null || { echo "server not ready"; kill "$SERVER_PID"; exit 1; }; }
  # … the step's curl checks …
  kill "$SERVER_PID"; wait "$SERVER_PID" 2>/dev/null
  ```
  The server is launched through Next's own binary (not `pnpm start`), so `$SERVER_PID` is the server process itself and `kill` frees port 3000 without `pkill`/`lsof`; the port-busy guard makes a leftover server fail loudly instead of answering the next check. For the production variant, prefix the build and start commands with `UI_THEME=production`.
- **Spawned processes in tests.** Tests that spawn `node` resolve every script path absolutely from the test file (`fileURLToPath(new URL('<relative>', import.meta.url))`) and pass an explicit `cwd`; nothing depends on the directory vitest was started from.
- **Loading `uiTheme.cjs`.** Vitest tests (`*.test.ts` under `src/`) use `createRequire(import.meta.url)`. Playwright specs under `e2e/` (transpiled as CJS, `package.json` has no `"type"`) use `const { createRequire } = require('node:module'); const req = createRequire(__filename);` and `req('../../src/styles/themes/uiTheme.cjs')`. Record the form that passes `pnpm run lint` and `pnpm exec tsc --noEmit` in `context.md` at Step 7; Steps 13 and 14 reuse it.
- **Line citations.** Cited `file:line` anchors are against the pre-spec tree (`d4bd9db`/`c5cd058e`); earlier steps of this spec shift them (e.g. Step 1 in `globals.css`, Step 4 in `layout.tsx`, Step 6 in `ci.yml` and the UI `Dockerfile`). At execute time locate every edit by content, symbol or key (the `:root` block, the `themeColor` property, the `shell-lint` chain, the `ui-theme` filter, the `COPY … public` comment), never by the cited number alone.
- **E2E runs.** Every Playwright check runs through `./scripts/run-e2e.sh <path>` (built image, CI mode) or the explicit `docker run` forms in Steps 6/7/14, never host `pnpm test:e2e`, which starts `pnpm dev` locally (`playwright.config.ts:128-133`).
- **Searching emitted CSS.** Always read every file recursively (`find .next/static/css -name '*.css' -exec cat {} +`), never `*.css` at the top level only. Built CSS is minified by lightningcss (leading zeros dropped, `L` possibly emitted as a percentage). A grep for a token value matches both forms, e.g. `grep -cE "oklch\((0?\.63|63%) 0?\.16 262\)"`. The checker OK line is the authoritative result; greps are smoke checks.
- **Self-matching scans.** No step writes a literal that a test of this feature scans for into a scanned file. That covers the FR-10 needle (`APPLICATION_ENV`), the palette class/var names and the AC-12 colour regex, including in comments.

---

### Step 1 — service: theme helper, bundle checker (c) + CLI, Tailwind scan scope, build chain

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/styles/themes/uiTheme.cjs` — create
- `services/xstockstrat-ui/src/styles/themes/checkThemeBundle.cjs` — create
- `services/xstockstrat-ui/src/app/globals.css` — modify
- `services/xstockstrat-ui/package.json` — modify
- `services/xstockstrat-ui/.eslintrc.json` — modify

**Reviewers**: `xstockstrat-ui` owner — trading UI correctness, analytics display accuracy, environment (`production`/`staging`) scope correctness

**Codebase Evidence**:
- `src/styles/` does not exist: `ls services/xstockstrat-ui/src/styles` → not found. **Not found**: the helper and the checker are created from scratch. The design is in design.md §1 A/B.
- `services/xstockstrat-ui/src/app/globals.css`:
  - `:1` `@import 'tailwindcss';`
  - `:2` `@import 'tw-animate-css';`
  - `@theme inline` at `:8-80`
  - shared order-side literals `--color-buy: hsl(159 52% 54%)`, `--color-sell: hsl(359 63% 67%)`, `--color-paper: hsl(43 41% 64%)` at `:44-46`
  - a comment with hex codes at `:41`
- `services/xstockstrat-ui/package.json:8` is `"build": "next build",`. `:10` is `"lint": "next lint"`, and `:17` is `"test:unit": "vitest run"`.
- `services/xstockstrat-ui/.eslintrc.json` has one `overrides` entry (`src/lib/headers.ts`, `src/lib/auth.ts`) and extends `plugin:@typescript-eslint/recommended`. That config flags `require()` in `.cjs` files.
- `services/xstockstrat-ui/vitest.config.ts:20` `include: ['src/**/*.test.ts']`. New tests under `src/styles` are picked up, and coverage stays scoped to `src/lib/**` (`:25`).
- `useCandlestickChart.ts:38-39` reads `--color-buy`/`--color-sell` with `'green'`/`'red'` fallbacks (Open Risk 1).
- `tailwindcss` and `@tailwindcss/postcss` are pinned at `4.3.3` (`package.json:68,80`). `postcss.config.js` holds only `@tailwindcss/postcss`.
- The build chain covers `Dockerfile:20` (`RUN pnpm --filter xstockstrat-ui run build`), `Dockerfile.e2e:65` (same), and the Playwright webServer `pnpm build && pnpm start` (`playwright.config.ts:128-133`).

**Lands with**: `Step 2`

**TDD**: `red-green required`. RED: Step 2's tests fail because `uiTheme.cjs`/`checkThemeBundle.cjs` do not exist and the `globals.css` line-1 pin does not match. A second RED is the lint probe in Verification 2.

**Covers**: —

**Deploy-file parity**: `UI_THEME` is read only by the build-time checker CLI and `next.config.js`; `docker-compose.yml`, `.do/app.dev.yaml` and `.do/app.yaml` are intentionally unchanged.

**Instructions**:
1. Create `uiTheme.cjs`, a CommonJS module with no dependencies (`fs`/`path` only), with the **S1 exports** from design.md §1 A:
   - `resolveUiTheme(v)`:
     - `undefined` → `'staging'`;
     - `'staging'` or `'production'` → itself;
     - anything else, including `''`, throws an `Error` whose message names `"staging"` and `"production"`.
   - `parseRootTokens(css)` returns a name → value map for the custom properties of a single `:root{}` block.
   - `cssDeclarations(css)` and `colorLiterals(value, valueOffset)`: the tokenizer in design.md §1 B steps 1–4, which defines comment blanking, preludes never scanned, `;` splits at paren depth 0, `!important` stripping, string/escape skipping, the literal/non-literal colour-function rule, `color-mix` operand recursion, descent into other functions, skipped identifiers, and byte offsets.
   - `cssColorToSrgb(text)` accepts:
     - oklch (numeric or `%` L, leading dot);
     - hsl/hsla and rgb/rgba;
     - `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`;
     - `/` alpha as a number or `%`.

     It clamps each channel to [0,1] before the 8-bit conversion. lab, lch, oklab, hwb and `color()` throw `unsupported colour syntax at <file>:<offset>`.
   - `relativeLuminance`, `contrastRatio` and `colorsEqual(x, y)`: R, G and B (0–255, rounded) each within ±1, **and** |αx−αy| ≤ 0.01, with α = 1 when absent.
2. Create `checkThemeBundle.cjs`: a pure `checkBundle(cssFiles, theme, sources)` that runs **check (c) only**, plus the CLI from design.md §1 A.
   - Check (c): `--color-buy`, `--color-sell`, `--color-paper` and `--color-warning` are each declared in the emitted CSS and `colorsEqual` the `globals.css` `@theme inline` literals.
   - CLI:
     - `--css-dir <dir>` defaults to `.next/static/css`, relative to cwd.
     - Files: `fs.readdirSync(dir, { recursive: true })` filtered to `**/*.css`. Zero files fails with `no CSS under <dir>`.
     - Theme: `resolveUiTheme(process.env.UI_THEME)`.
     - Sources resolve from `__dirname`: **`globals.css` only** in this step.
     - On success it prints `checkThemeBundle: <theme> bundle OK (<n> css files)`. On failure it prints each failure line and exits 1.
3. `globals.css`:
   - `:1` becomes `@import 'tailwindcss' source('..');`.
   - Keep `:2` `@import 'tw-animate-css';` unchanged.
   - Directly after it, add `@source not "../**/*.test.ts";` and `@source not "../styles/themes";`.
   - Add one 2-line constraint comment above them. It states that text naming palette utilities or palette vars in scanned source emits palette CSS, which the theme check rejects in every build. Write it with no literal utility or palette-var name.
   - In `@theme inline`, after `--color-paper` (`:46`), add `--color-warning: hsl(43 41% 64%);`.
4. `package.json:8`: `"build": "next build && node src/styles/themes/checkThemeBundle.cjs"`.
5. `.eslintrc.json`: add an `overrides` entry `{ "files": ["*.cjs"], "rules": { "@typescript-eslint/no-require-imports": "off", "@typescript-eslint/no-var-requires": "off" } }`.

**Verification**: the union with Step 2. Run inside `services/xstockstrat-ui` unless noted.
1. `pnpm run test:unit -- src/styles` (may run the full suite, a superset; accepted at convergence).
2. Lint RED probe:
   - With the `*.cjs` override removed, `pnpm run lint` fails on the `.cjs` `require`. With it restored, lint passes.
   - If `next lint` does not lint `.cjs` at all, the probe cannot fail. In that case append `&& eslint src/styles/themes/*.cjs` to `package.json`'s `lint` script, re-run the probe, and record the outcome in `context.md`.
3. Selector diff for the scan scope:
   - Run `NEXT_DISABLE_STANDALONE=1 pnpm build` with the `globals.css:1` edit reverted, and save the selector set of `.next/static/css`. Run it again with the edit in place.
   - The only selectors that may disappear are those whose class strings live outside `src/`, or only in `src/**/*.test.ts` / `src/styles/themes/**`.
   - The `:root` token declarations must be byte-identical between the two builds.
4. Record in `context.md`:
   - Open Risk 1: whether `--color-buy/sell/paper/warning` are emitted after the edit. If any is missing, add an unlayered `:root{}` in `globals.css` that declares the four shared literals, in this step, so that (c) passes.
   - The candle-colour status.
   - The full non-token colour-literal inventory, from a one-off `node -e` over `cssDeclarations`/`colorLiterals` on `.next/static/css`, checked against the design.md §1 B table.
   - The `color-mix` and fallback forms, and any named colour or lab/lch/oklab/`color()`.
5. `node src/styles/themes/checkThemeBundle.cjs --css-dir .next/static/css` prints the OK line.
6. V-UI.
7. CI: `e2e-build` is green. It runs the `package.json:8` chain, so (c) runs in the staging build.

---

### Step 2 — test: helper, tokenizer, check (c), CLI and scan-scope pin

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/styles/themes/uiTheme.test.ts` — create
- `services/xstockstrat-ui/src/styles/themes/checkThemeBundle.test.ts` — create

**Reviewers**: `xstockstrat-ui` owner — trading UI correctness, analytics display accuracy, environment (`production`/`staging`) scope correctness

**Codebase Evidence**:
- The vitest include `src/**/*.test.ts` is at `vitest.config.ts:20`, and the node environment is set at `:19`.
- No existing CSS or colour test helper exists in `src/`. `grep -rn "cssColorToSrgb\|contrastRatio" services/xstockstrat-ui/src` → none. `src/lib/chartColors.ts:24` `cssColorToRgb` is a browser canvas path and is not reusable in node (recorded trade-off, design.md C-18).
- C-12: the fixtures are synthetic CSS strings, not domain objects, so they stay inline (scenario one-offs). `e2e/fixtures/INVENTORY.md` has no CSS or theme fixtures.

**Lands with**: `Step 1`

**TDD**: `red-green required`. RED: before Step 1, the `require('./uiTheme.cjs')` / `checkThemeBundle.cjs` imports fail, and the `globals.css` line-1 pin (`@import 'tailwindcss' source('..');`) does not match the current `:1` `@import 'tailwindcss';`.

**Covers**: `AC-5`

**Instructions**:
1. `uiTheme.test.ts`, loaded via `createRequire(import.meta.url)`:
   - **Parser cases:**
     - `%` L;
     - alpha as a number and as `%`;
     - keyword skip;
     - lab/lch/oklab/hwb/`color()` throw;
     - out-of-gamut clamping;
     - the `colorsEqual` alpha rule (opaque white vs `oklch(1 0 0 / 10%)` is not equal);
     - `resolveUiTheme` with undefined, `''`, `'prod'`, `'staging'` and `'production'`.
   - **Tokenizer cases**, each asserting the exact `colorLiterals` result, from design.md S1:
     - `hsl(var(--x))` → []
     - `rgb(var(--x) / .5)` → []
     - `oklch(from var(--x) l c h)` → []
     - `color-mix(in oklch, var(--a), var(--b) 5%)` → []
     - `color-mix(in oklab, #fff 10%, transparent)` → [`#fff`]
     - nested `color-mix(in srgb, color-mix(in oklab, oklch(0.5 0.1 200) 50%, var(--x)), #000)` → [oklch, `#000`]
     - `var(--tw-shadow-color, rgb(0 0 0/.1))` → [rgb]
     - `0 0 #0000` → [`#0000`]
     - `'#fff'` and `url(#fff)` → []
     - `a\#ccc` → []
     - `#ffffff1a` → [`#ffffff1a`]
     - `transparent`, `currentcolor` and `red` → []
   - **Structure cases for `cssDeclarations`:**
     - comments are stripped, including one that contains `oklch(1 0 0 / 10%)`;
     - the selectors `.x\[stroke\=\'\#ccc\'\]` and `[stroke='#fff']` yield no literal;
     - an `@supports (color: color-mix(in lab, red, red))` prelude yields none, while its inner declarations are scanned;
     - `@property { initial-value: #fff }` is scanned;
     - `!important` is stripped;
     - offsets are correct.
2. `checkThemeBundle.test.ts`:
   - (c) fixtures: all four shared roles present and equal pass; a missing `--color-warning` fails; a `--color-buy` off by 2 per channel fails.
   - The CLI spawned via `node` (`child_process.spawnSync`) over a temp dir holding a nested `chunks/x.css` proves the recursive listing. An empty dir fails with `no CSS under`. The default dir is cwd-relative: spawn with `cwd` = a temp dir that holds `.next/static/css/a.css`, and pass the script absolutely as `fileURLToPath(new URL('./checkThemeBundle.cjs', import.meta.url))`.
   - Static pin on `src/app/globals.css`:
     - line 1 is exactly `@import 'tailwindcss' source('..');`;
     - line 2 is `@import 'tw-animate-css';`;
     - both `@source not` lines appear after line 2.
   - Build every palette class or var name a fixture needs at runtime by concatenation, for example `['--color', f, String(n)].join('-')`. No literal palette utility or `--color-<family>-<n>` may appear in the source (fails.md:3983 rule).

**Verification**: as Step 1 (the pair runs as one unit). In addition, run `grep -nE "(bg|text|border|ring)-(stone|emerald|zinc|yellow|blue)-[0-9]" services/xstockstrat-ui/src/styles/themes/*.test.ts`; it must return nothing.
**Coverage:** `vitest.config.ts` coverage is scoped to `src/lib/**` (40% lines/functions/statements, `:25,:29-33`); `src/styles/**` is outside it, so no new threshold applies. `pnpm run test:coverage` must stay ≥ 40%.

---

### Step 3 — test: RED spike — manifest route handler

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `docs/roadmap/features/307-ui-env-themed-bundles/context.md` — modify (spike result only; the throwaway route is deleted before commit)

**Reviewers**: `xstockstrat-ui` owner — trading UI correctness, analytics display accuracy, environment (`production`/`staging`) scope correctness

**Codebase Evidence**:
- `services/xstockstrat-ui/public/manifest.webmanifest` is static. It holds `display: standalone`, `start_url: /trader`, `background_color`/`theme_color` `#0a0e14`, and the 192/512/maskable icons.
- `next.config.js:20-25` sets the `no-cache` header for `source: '/manifest.webmanifest'`.
- `src/app/layout.tsx:12` sets `metadata.manifest: '/manifest.webmanifest'`.
- `src/middleware.ts:22` excludes `manifest.webmanifest` from the auth matcher.
- `next.config.js:7` sets `output` to standalone unless `NEXT_DISABLE_STANDALONE` is set. `pnpm start` is unsupported on a standalone build (`next.config.js:3-6`).

**TDD**: `N/A (throwaway spike; it records evidence that selects Step 12's mechanism, and no code is committed)`

**Covers**: `AC-13` (spike evidence for the route mechanism)

**Instructions**:
1. Temporarily move `public/manifest.webmanifest` aside.
2. Add a throwaway `src/app/manifest.webmanifest/route.ts`:
   - `export const dynamic = 'force-dynamic'`;
   - a `GET` that returns the current manifest JSON with `Content-Type: application/manifest+json`.
3. Run UI-SERVE (see Verification conventions).
4. Record in `context.md`:
   - `curl -sI localhost:3000/manifest.webmanifest` shows `Cache-Control: no-cache` and `content-type: application/manifest+json`;
   - the build route table marks `/manifest.webmanifest` as ƒ (dynamic);
   - `curl -s localhost:3000/auth/login | grep -c 'rel="manifest"'` prints `1`.
5. Restore `public/manifest.webmanifest` and delete the throwaway route. `git status --porcelain services/xstockstrat-ui` must show nothing.
6. If any check fails, record "route handler rejected; Step 12 takes the fallback". The fallback is a gitignored `public/manifest.webmanifest` that `next.config.js` writes at config load (design.md §1 D).

**Verification**: `context.md` holds the three observed results and the chosen mechanism (route or fallback). `git status --porcelain services/xstockstrat-ui` is empty.
**Coverage:** throwaway spike; nothing is committed, so no threshold applies.

---

### Step 4 — service: token split, production palette, build-time selection

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/styles/themes/staging.css` — create
- `services/xstockstrat-ui/src/styles/themes/production.css` — create
- `services/xstockstrat-ui/src/styles/themes/uiTheme.cjs` — modify
- `services/xstockstrat-ui/src/app/globals.css` — modify
- `services/xstockstrat-ui/src/app/layout.tsx` — modify
- `services/xstockstrat-ui/next.config.js` — modify
- `services/xstockstrat-ui/src/lib/chartColors.ts` — modify (comment only)
- `docs/patterns/ui-ux-governance.md` — modify (§5 fence only)

**Reviewers**: `xstockstrat-ui` owner — trading UI correctness, analytics display accuracy, environment (`production`/`staging`) scope correctness

**Codebase Evidence**:
- `globals.css` (verified at `d4bd9db`, 141 lines):
  - `:82` `@layer base {`
  - `:83-86` the preset history comment
  - `:87` `:root {` through `:125` `}`
  - the inner comment at `:112-115`
  - `:126` blank
  - `:127-129` `*`, `:131-136` `body`, `:138-140` `html`
  - `:141` the closing brace

  All `:root` values are oklch, for example `--primary: oklch(0.432 0.095 166.913)` at `:93` and `--background: oklch(0.147 0.004 49.25)` at `:88`.
- `src/app/layout.tsx:3` `import './globals.css';`. `<html>` at `:25` has no `dark` or `data-theme`.
- `next.config.js`: `nextConfig` is a plain object exported at `:46` (`module.exports = nextConfig;`). It has no `webpack` or `env` key, and `:7` is its only env switch.
- `src/lib/chartColors.ts:5-6`: the comment `... Defined in \`globals.css\` \`:root\`. */` goes stale after the split (design AR4).
- The preset rationale already lives in `services/xstockstrat-ui/CLAUDE.md` § Styling (`:23`), so the `:83-86` comment can be deleted (comment rule 5).
- `docs/patterns/ui-ux-governance.md` §5 runs from `:132` to `:162`, with items 1–7. Item 8 and its fence are new.

**Lands with**: `Step 5`

**TDD**: `red-green required`. RED: Step 5's `themes.test.ts` and `nextConfig.test.ts` fail. The theme files, `themeCssPath`/`themeBackgroundHex`, the `@theme-tokens$` alias and `env.UI_THEME_BACKGROUND_HEX` do not exist yet.

**Covers**: —

**Deploy-file parity**: `UI_THEME` and `env.UI_THEME_BACKGROUND_HEX` are build-time only (Dockerfile build arg / `next.config.js` `env`); nothing reads them at runtime, so `docker-compose.yml`, `.do/app.dev.yaml` and `.do/app.yaml` are intentionally unchanged (Steps 1 and 12 carry their own note; see also Step 6).

**Instructions**:

Keep these edits in one commit with Step 5 (`Lands with`); do not split them by file.
1. `staging.css`: move the `:root { … }` block inside `@layer base` of `globals.css` (`:87-125` in the pre-spec tree; Step 1 shifts it, so locate it by content) verbatim into an **unlayered** `:root{}` block. This is FR-3: byte-identical values, keeping its inner comment (pre-spec `:112-115`). Nothing else goes in the file.
2. `production.css`: one unlayered `:root{}` with the same token names and these values (design.md § Tokens and pinned literals):

   | Token(s) | Value |
   |---|---|
   | `--background` | `oklch(0.16 0.022 262)` |
   | `--foreground`, `--card-foreground`, `--popover-foreground`, `--accent-foreground`, `--sidebar-foreground`, `--sidebar-accent-foreground` | `oklch(0.975 0.006 250)` |
   | `--card`, `--popover`, `--sidebar` | `oklch(0.22 0.026 262)` |
   | `--primary` | `oklch(0.63 0.16 262)` |
   | `--primary-foreground` | `oklch(0.16 0.04 264)` |
   | `--secondary` | `oklch(0.27 0.02 260)` |
   | `--secondary-foreground` | `oklch(0.985 0 0)` |
   | `--muted` | `oklch(0.265 0.02 258)` |
   | `--muted-foreground` | `oklch(0.72 0.02 255)` |
   | `--accent`, `--sidebar-accent` | `oklch(0.285 0.03 262)` |
   | `--destructive` | `oklch(0.704 0.191 22.216)` |
   | `--border`, `--sidebar-border` | `oklch(0.75 0.04 260 / 18%)` |
   | `--input` | `oklch(0.75 0.04 260 / 24%)` |
   | `--ring`, `--sidebar-ring` | `oklch(0.62 0.12 262)` |
   | `--radius` | `0.45rem` |
   | `--chart-1` | `oklch(0.87 0.03 255)` |
   | `--chart-2` | `oklch(0.74 0.12 235)` |
   | `--chart-3` | `oklch(0.68 0.11 200)` |
   | `--chart-4` | `oklch(0.64 0.15 320)` |
   | `--chart-5` | `oklch(0.58 0.06 255)` |
   | `--chart-grid` | `oklch(0.45 0.03 260 / 0.55)` |
   | `--sidebar-primary` | `oklch(0.68 0.16 285)` |
   | `--sidebar-primary-foreground` | `oklch(0.2 0.06 285)` |

   The file has no comments, so jscpd sees differing lines (`.jscpd.json:4` minTokens 100).
3. `globals.css`: delete, by content, the `/* shadcn/ui preset … */` comment that follows `@layer base {`, the `:root { … }` block through its closing brace, and the blank line after it (pre-spec `:83-126`). `:82` `@layer base {` is then directly followed by the `*`/`body`/`html` rules and the closing brace.
4. `layout.tsx:3` becomes two lines: `import './globals.css';` then `import '@theme-tokens';`.
5. `uiTheme.cjs`: add `themeCssPath(theme)`, which returns `path.join(__dirname, theme + '.css')`, and `themeBackgroundHex(theme)`, which returns the lowercase `#rrggbb` of that file's `--background` via `parseRootTokens` + `cssColorToSrgb`. Staging must give `#0c0a09` and production `#080d17`.
6. `next.config.js`:
   - At the top: `const { resolveUiTheme, themeCssPath, themeBackgroundHex } = require('./src/styles/themes/uiTheme.cjs'); const uiTheme = resolveUiTheme(process.env.UI_THEME);`. This throws on an unknown value, so `dev`, `build` and e2e all fail fast.
   - In `nextConfig`, add `env: { UI_THEME_BACKGROUND_HEX: themeBackgroundHex(uiTheme) }`.
   - Add `webpack(config) { config.resolve.alias = { ...config.resolve.alias, '@theme-tokens$': themeCssPath(uiTheme) }; return config; }`.
   - Add one constraint comment (≤2 lines), exactly: `// Theme is fixed at build time from UI_THEME only; never read a runtime environment variable here (FR-10).` The comment must not contain the literal `APPLICATION_ENV`, because Step 5's FR-10 test scans this file for it (see Verification conventions → Self-matching scans).
7. `chartColors.ts:6`: change "Defined in `globals.css` `:root`" to "Defined per theme in `src/styles/themes/*.css`".
8. `ui-ux-governance.md` §5: add item 8 as a heading line, one sentence "Staging token values are frozen per feature 307 FR-3; these staging pairs fall below the baseline and are recorded as known deviations, not fixed.", and the fence `<!-- 307:staging-contrast-deviations:begin -->` … `<!-- 307:staging-contrast-deviations:end -->` holding exactly these 8 lines:
   - `- primary/background: 2.6`
   - `- primary/card: 2.3`
   - `- chart-3/background: 2.6`
   - `- chart-3/card: 2.3`
   - `- chart-4/background: 1.9`
   - `- chart-4/card: 1.7`
   - `- chart-5/background: 1.3`
   - `- chart-5/card: 1.2`

   If Step 5's helper computes a different failing set or ratio, use the computed values and record them (P-03). Step 19 writes the surrounding prose.

**Verification**: the union with Step 5.
1. V-UI.
2. `cd services/xstockstrat-ui && NEXT_DISABLE_STANDALONE=1 pnpm build`, then `NEXT_DISABLE_STANDALONE=1 UI_THEME=production pnpm build`. Both pass, and each prints the checker OK line.
3. `cd services/xstockstrat-ui && UI_THEME=prod pnpm build` exits non-zero with an error naming `staging` and `production`.
4. `cd services/xstockstrat-ui && find .next/static/css -name '*.css' -exec cat {} + | grep -cE "oklch\((0?\.63|63%) 0?\.16 262\)"` is ≥1 after the production build. `find .next/static/css -name '*.css' -exec cat {} + | grep -cE "oklch\((0?\.432|43\.2%) 0?\.095 166\.913\)"` is 0 after the production build, and ≥1 after re-running `NEXT_DISABLE_STANDALONE=1 pnpm build` (staging) — item 2 builds production last, so `.next` holds only production CSS until that rebuild. This is a manual AC-1/AC-3 smoke test; Step 9 makes it a gate.
5. `./scripts/check-context-map.sh`.

---

### Step 5 — test: theme files, contrast pins, next.config selection

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/styles/themes/themes.test.ts` — create
- `services/xstockstrat-ui/src/styles/themes/nextConfig.test.ts` — create
- `services/xstockstrat-ui/src/styles/themes/uiTheme.test.ts` — modify

**Reviewers**: `xstockstrat-ui` owner — trading UI correctness, analytics display accuracy, environment (`production`/`staging`) scope correctness

**Codebase Evidence**:
- `src/lib/deploymentEnv.ts:8` and `src/telemetry.ts:47` are the only runtime readers of `APPLICATION_ENV` (`grep -rn APPLICATION_ENV services/xstockstrat-ui/src`; the `configUiBff.ts:40,44` hits are comments). None of them feeds styling.
- `docs/patterns/ui-ux-governance.md` §5 holds the fence that Step 4 writes.
- The AC literals are pinned in `acceptance.feature` lines AC-1 (`oklch(0.63 0.16 262)`), AC-8 (18.07, 5.46) and AC-17 (2.6).

**Lands with**: `Step 4`

**TDD**: `red-green required`. RED: before Step 4, the theme files and the fence are missing, and `themeCssPath`/`themeBackgroundHex` and `nextConfig.env` are undefined, so every assertion fails.

**Covers**: `AC-1, AC-2, AC-3, AC-4, AC-8, AC-14, AC-17`

**Instructions**:
1. `themes.test.ts`, reading `staging.css`/`production.css` through `parseRootTokens`:
   - **Shape.** Each file is exactly one `:root{}` with only custom-property declarations, and the two name sets are equal.
   - **AC-2 / FR-3 baseline.** Pin the 33 original `:root` name→value pairs from `globals.css:88-124` at `9eaf04f` (unchanged at `c5cd058e`; e.g. `--primary` = `oklch(0.432 0.095 166.913)`, `--background` = `oklch(0.147 0.004 49.25)`) as a literal map in the test, generated once with `git show 9eaf04f:services/xstockstrat-ui/src/app/globals.css | sed -n 88,124p`. Assert `parseRootTokens(staging.css)` deep-equals it (same names, byte-identical values).
   - **AC-8.** `contrastRatio(foreground, background)` = 18.07 ± 0.05 and `contrastRatio(primary-foreground, primary)` = 5.46 ± 0.05 in production. If either misses by more than 0.05, stop and ask the operator to re-pin (P-03). Do not edit the AC.
   - **AC-14.** In production, each text pair is ≥4.5: every `X`/`X-foreground` pair (background/foreground, card, popover, primary, secondary, muted, accent, sidebar, sidebar-primary, sidebar-accent), plus `primary`, `muted-foreground` and `destructive` on `background` and on `card`. `ring` on `background` is ≥3.
   - **Non-text.** In production, `--chart-1..5` on `card` and on `background` are each ≥3.
   - **AC-1 guard.** No production token is `colorsEqual` to `oklch(0.432 0.095 166.913)`.
   - **AC-17.** The set of staging pairs below threshold (the AC-14 pair set plus the chart non-text pairs, computed from `staging.css`) equals the set parsed from the §5 fence. Each fence ratio equals the computed ratio rounded to one decimal place. §5 item 8 contains the phrase `frozen per feature 307 FR-3` (written in Step 4).
   - **FR-5.** `--color-buy/sell/paper` are not declared in either theme file.
2. `nextConfig.test.ts`, loading `next.config.js` fresh per case: `const req = createRequire(import.meta.url)`, and before each case `delete req.cache[req.resolve('../../../next.config.js')]` and `delete req.cache[req.resolve('./uiTheme.cjs')]`, then set or delete `process.env.UI_THEME` (`vi.resetModules` does not clear Node's CJS cache, so it is not used):
   - **AC-3.** With `UI_THEME` unset, the alias target ends in `staging.css`, checked by calling `config.webpack({ resolve: { alias: {} } })`.
   - **Background hex.** `env.UI_THEME_BACKGROUND_HEX === themeBackgroundHex(theme)` for both themes.
   - **AC-4.** `spawnSync('node', ['-e', "require('./next.config.js')"], { cwd: fileURLToPath(new URL('../../..', import.meta.url)), env: { ...process.env, UI_THEME: 'prod' } })` (the `cwd` is the UI package root) exits non-zero, and stderr names `staging` and `production`.
   - **FR-10 static.** The token `['APPLICATION', 'ENV'].join('_')` (built by concatenation so this test file cannot match itself) is absent from `next.config.js`, from the non-test files under `src/styles/themes/` (`*.cjs`, `*.css`) and from `src/app/layout.tsx`. `*.test.ts` files are excluded from the scan. Step 13 adds `src/app/manifest.webmanifest/route.ts`.
3. `uiTheme.test.ts`: add `themeCssPath` (both themes; an unknown theme throws) and `themeBackgroundHex('staging') === '#0c0a09'` / `('production') === '#080d17'`.

**Verification**: as Step 4.
**Coverage:** `vitest.config.ts` coverage is scoped to `src/lib/**` (40% lines/functions/statements, `:25,:29-33`); `src/styles/**` is outside it, so no new threshold applies. `pnpm run test:coverage` must stay ≥ 40%.

---

### Step 6 — service: Docker ARG + theme label, production-theme CI jobs, AC-10 step

**Status**: `pending`
**Service**: `xstockstrat-ui` + CI/CD
**Files**:
- `services/xstockstrat-ui/Dockerfile` — modify
- `Dockerfile.e2e` — modify
- `services/xstockstrat-ui/playwright.config.ts` — modify
- `.github/workflows/ci.yml` — modify
- `docs/patterns/ci-overview.md` — modify

**Reviewers**: `xstockstrat-ui` owner — trading UI correctness, environment (`production`/`staging`) scope correctness; Platform Lead (advisory, per product spec) — cross-service architecture, deploy-pipeline consistency

**Codebase Evidence**:
- `services/xstockstrat-ui/Dockerfile`:
  - `:1` `FROM node:24-alpine AS base`;
  - the builder stage at `:16-20`, with `:20` `RUN pnpm --filter xstockstrat-ui run build`;
  - the runner at `:22-31`, with `:26` `COPY … .next/static ./services/xstockstrat-ui/.next/static` and `:27-28` the public/ comment.
- `Dockerfile.e2e`:
  - the builder at `:58-65`, with `:64` `ENV NEXT_DISABLE_STANDALONE=1` and `:65` `RUN pnpm --filter xstockstrat-ui run build`;
  - the runner at `:70`;
  - `:111-112` `ENV CI=true` / `ENV E2E_PREBUILT=1`;
  - `:121` `ENTRYPOINT ["pnpm", "test:e2e"]`.
- `playwright.config.ts`: `:163` `APPLICATION_ENV: 'development',`. Under `E2E_PREBUILT` the webServer runs `pnpm start` (`:129-133`).
- `.github/workflows/ci.yml`:
  - the `ci` filter at `:41-42`;
  - the `xstockstrat-ui` filter at `:64`;
  - the `sops:` filter at `:87-101`, followed by `ledger:` at `:102`;
  - `e2e-build` at `:531-569`, whose pattern is at `:540-554`: `actions/checkout@v7`, `docker/setup-buildx-action@v3`, `docker/build-push-action@v6`, `context: .`, `load: true`, and `type=gha` cache with `mode=max`;
  - `frontend-e2e` begins at `:567` (at `c5cd058e`): "run e2e tests" `:589-594`, "extract playwright report" `:596-600`, `upload-artifact@v7` `:604`;
  - `setup-node@v7` with Node 24 at `:515-519`;
  - `ci-gate` begins at `:1114` (at `c5cd058e`); its `needs:` list, echo block and skipped-counts-as-pass logic follow it. Re-anchor every `ci.yml` line at execute time by job/filter key, not number (297/298/324 also edit this file).
- `scripts/config-wiring.test.mjs:663-675` `ciFilterGlobs` parses filter blocks by exact indentation (`            ${name}:` and `^ {14}- '…'$`). The new filter must use the same form and must not split the `config-wiring` block.
- `docs/patterns/ci-overview.md:26-27` holds the `frontend-e2e-build` / `frontend-e2e` rows.
- `docker-build.yml:88-89` uses the cache scope `type=gha,scope=${{ matrix.service }}`, so the UI deploy cache is `scope=xstockstrat-ui`.

**Lands with**: `Step 7`

**TDD**: `N/A (Docker/CI plumbing; RED/GREEN is shown by docker inspect and the Step 7 spec, not a unit test)`

**Covers**: `AC-6, AC-9` (the `ui-prod-image-build` gate: theme label + extracted-CSS checker)

**Deploy-file parity**: `UI_THEME` is a build arg (plus an e2e-image ENV) and `E2E_APPLICATION_ENV` is test-only; neither is read at runtime, so `docker-compose.yml`, `.do/app.dev.yaml` and `.do/app.yaml` are intentionally unchanged.

**Instructions**:
1. `services/xstockstrat-ui/Dockerfile`:
   - Before `:1`, add the global `ARG UI_THEME=staging`.
   - In `builder`, add `ARG UI_THEME` before `:20`.
   - In `runner`, after `:22`, add `ARG UI_THEME` and `LABEL io.xstockstrat.ui-theme=$UI_THEME`.
   - Add no runtime `ENV UI_THEME`.
2. `Dockerfile.e2e`: add the same global `ARG UI_THEME=staging` and the builder `ARG UI_THEME` before `:65`. In the runner, add `ARG UI_THEME` and `ENV UI_THEME=$UI_THEME`, so the spec knows the built theme.
3. `playwright.config.ts:163`: `APPLICATION_ENV: process.env.E2E_APPLICATION_ENV ?? 'development',`.
4. `ci.yml`:
   - **`ui-theme` filter.** Insert it after the `sops:` block (`:101`) and before `ledger:` (`:102`), in the `            ui-theme:` / `              - '…'` form, with:
     - `services/xstockstrat-ui/src/styles/**`
     - `services/xstockstrat-ui/src/app/globals.css`
     - `services/xstockstrat-ui/src/app/layout.tsx`
     - `services/xstockstrat-ui/src/app/manifest.webmanifest/**`
     - `services/xstockstrat-ui/src/app/insights/**`
     - `services/xstockstrat-ui/src/components/insights/**`
     - `services/xstockstrat-ui/src/components/ui/sidebar.tsx`
     - `services/xstockstrat-ui/src/lib/chartColors.ts`
     - `services/xstockstrat-ui/src/hooks/useCandlestickChart.ts`
     - `services/xstockstrat-ui/next.config.js`
     - `services/xstockstrat-ui/postcss.config.js`
     - `services/xstockstrat-ui/package.json`
     - `services/xstockstrat-ui/Dockerfile`
     - `services/xstockstrat-ui/playwright.config.ts`
     - `services/xstockstrat-ui/e2e/theme/**`
     - `services/xstockstrat-ui/e2e/helpers/**`
     - `services/xstockstrat-ui/e2e/fixtures/**`
     - `services/xstockstrat-ui/e2e/mock-backend.ts`
     - `Dockerfile.e2e`
   - **`frontend-e2e-production` job.** Insert it after `frontend-e2e`, copied verbatim from design.md §1 E:
     - `needs: changes`; `if` on `ui-theme` or `ci`;
     - checkout v7, buildx v3;
     - build-push v6 with `file: Dockerfile.e2e`, `build-args: UI_THEME=production`, `tags: xstockstrat-e2e:prod`, `load: true`, `cache-from` both `e2e-build` and `e2e-build-production` scopes, and `cache-to` `scope=e2e-build-production,mode=max`;
     - `docker run --name e2e-production xstockstrat-e2e:prod e2e/theme/ --grep-invert @AC-10`;
     - report extraction and upload (`playwright-report-production`), mirroring `:596-608`.
   - **`ui-prod-image-build` job**, verbatim from design.md §1 E:
     - checkout v7, `setup-node@v7` Node 24 with no pnpm cache, buildx v3;
     - build-push v6 with `file: services/xstockstrat-ui/Dockerfile`, `build-args: UI_THEME=production`, `tags: xstockstrat-ui:prod-ci`, `load: true`, `push: false`, `cache-from` `scope=xstockstrat-ui` + `scope=ui-prod-image-build`, and `cache-to` `scope=ui-prod-image-build,mode=max`;
     - a run step that asserts the `io.xstockstrat.ui-theme` label is `production`, `docker create`/`docker cp` the image's `/app/services/xstockstrat-ui/.next/static/css` to `$RUNNER_TEMP/ui-css`, and runs `UI_THEME=production node services/xstockstrat-ui/src/styles/themes/checkThemeBundle.cjs --css-dir "$RUNNER_TEMP/ui-css"`.
   - **`frontend-e2e` AC-10 step.** Add it after "run e2e tests" (`:589-594`) and before "extract playwright report" (`:596`): `name: AC-10 staging theme under each APPLICATION_ENV`, `if: matrix.shard == 1`, and a loop over `staging production` that runs `docker run --rm -e E2E_APPLICATION_ENV="$env" xstockstrat-e2e:ci e2e/theme/theme-bundle.spec.ts --grep @AC-10 || exit 1`.
   - **`ci-gate`.** Append `- frontend-e2e-production` and `- ui-prod-image-build` to `needs` (after `:1140`). Add `echo "frontend-e2e-production: ${{ needs.frontend-e2e-production.result }}"` and `echo "ui-prod-image-build: ${{ needs.ui-prod-image-build.result }}"` after `:1167`.
5. `docs/patterns/ci-overview.md`: add rows for `frontend-e2e-production` (production-theme e2e of `e2e/theme/`, on the `ui-theme`/`ci` filters) and `ui-prod-image-build` (production UI image, theme label plus extracted-CSS checker), after `:27`.

**Verification**: the union with Step 7.
1. `docker run --rm -i -v "$PWD/.hadolint.yaml:/.config/hadolint.yaml" hadolint/hadolint < services/xstockstrat-ui/Dockerfile`, and the same for `Dockerfile.e2e`. Both are clean.
2. `docker build --build-arg UI_THEME=production -f services/xstockstrat-ui/Dockerfile -t ui:p .` then `docker inspect -f '{{ index .Config.Labels "io.xstockstrat.ui-theme" }}' ui:p` prints `production`. With no build arg it prints `staging`.
3. Run the `ui-prod-image-build` script locally against `ui:p`: `cid=$(docker create ui:p); docker cp "$cid:/app/services/xstockstrat-ui/.next/static/css" /tmp/ui-css; docker rm "$cid"; UI_THEME=production node services/xstockstrat-ui/src/styles/themes/checkThemeBundle.cjs --css-dir /tmp/ui-css` prints the OK line. This runs (c) only until Step 8.
4. `node --test scripts/config-wiring.test.mjs` (the filter parser is intact).
5. `yq e '.jobs["frontend-e2e-production"].needs, .jobs["ui-prod-image-build"].needs' .github/workflows/ci.yml` prints `changes` twice. `actionlint .github/workflows/ci.yml` if available.
6. CI: `frontend-e2e` (both shards plus the AC-10 step), `frontend-e2e-production` and `ui-prod-image-build` are green.
7. `cd services/xstockstrat-ui && pnpm run lint && pnpm exec tsc --noEmit` (covers `playwright.config.ts` and the Step 7 spec).

---

### Step 7 — test: seed `e2e/theme/theme-bundle.spec.ts` (AC-10, AC-7 background)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/theme/theme-bundle.spec.ts` — create

**Reviewers**: `xstockstrat-ui` owner — trading UI correctness, environment (`production`/`staging`) scope correctness

**Codebase Evidence**:
- `e2e/theme/` does not exist (`ls services/xstockstrat-ui/e2e/theme` → not found).
- The auth helper is `import { addAuthCookie } from '../helpers/auth';` (pattern at `e2e/insights/backtest-sizing.spec.ts:2,18`). Routes are served by `e2e/mock-backend.ts`.
- C-12: the spec uses no new domain object. It reuses the existing mock-backend data (the `/trader` default view) and `addAuthCookie`, so no inventory row is needed.
- `uiTheme.cjs` exports `cssColorToSrgb`, `colorsEqual` (Step 1) and `themeBackgroundHex` (Step 4). The spec loads it through the Playwright form in Verification conventions → Loading `uiTheme.cjs` (`createRequire(__filename)`), and records the passing form in `context.md`.

**Lands with**: `Step 6`

**TDD**: `red-green required`. RED: run `@AC-10` with `E2E_APPLICATION_ENV=production` against the e2e image built **with** `--build-arg UI_THEME=production`. Body bg ≠ `#0c0a09`, so it fails. This proves the assertion distinguishes themes. GREEN is the staging image in both runs.

**Covers**: `AC-7, AC-10`

**Instructions**:
1. Create the spec with `test.describe('UI theme bundle (feature 307)')`.
2. `@AC-10 staging bundle background is independent of APPLICATION_ENV`:
   - `addAuthCookie(page)`, then `page.goto('/trader')`;
   - read `getComputedStyle(document.body).backgroundColor`, canonicalised via `cssColorToSrgb`;
   - assert `colorsEqual(bg, '#0c0a09')` and `themeBackgroundHex('staging') === '#0c0a09'`;
   - no skip and no `UI_THEME` branch.
3. `@AC-7 body background matches the built theme`: body bg `colorsEqual` `themeBackgroundHex(process.env.UI_THEME ?? 'staging')`.
4. Title tags carry the `@AC-N` strings, so the Step 6 `--grep @AC-10` / `--grep-invert @AC-10` select them.

**Verification**: as Step 6, plus:
**Coverage:** e2e only; no line-coverage threshold applies (vitest coverage is scoped to `src/lib/**`, 40%).

- RED proof (expected to FAIL on the background assertion): `docker build --build-arg UI_THEME=production -f Dockerfile.e2e -t xstockstrat-e2e:red . && docker run --rm -e E2E_APPLICATION_ENV=production xstockstrat-e2e:red e2e/theme/theme-bundle.spec.ts --grep @AC-10`.
- `./scripts/run-e2e.sh e2e/theme/` is green (staging image).
- The RED run above fails on the background assertion.
- `grep -n "helpers/auth" services/xstockstrat-ui/e2e/theme/theme-bundle.spec.ts` shows the auth import (C-12).

---

### Step 8 — service: full checker — token set T, set N, checks (a) and symmetric (b)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/styles/themes/checkThemeBundle.cjs` — modify

**Reviewers**: `xstockstrat-ui` owner — trading UI correctness, analytics display accuracy, environment (`production`/`staging`) scope correctness

**Codebase Evidence**:
- Check (a) requires every selected token to have ≥1 literal declaration, so Step 2's (c)-only and CLI temp-dir fixtures would fail once (a) is active; Step 9 item 0 updates them in this same commit pair (F-05).
- `checkThemeBundle.cjs` (Step 1) loads only `globals.css`. `themeCssPath` (Step 4) resolves the theme files.
- Today's tree holds the constructs (b) must tolerate (design.md §1 B table, re-verified at `d4bd9db`):
  - `src/components/ui/sidebar.tsx:322,356` `[--radius:var(--radius-xl)]`;
  - `sidebar.tsx:455` `hsl(var(--sidebar-border))` / `hsl(var(--sidebar-accent))`;
  - `src/components/ui/chart.tsx:66` `[stroke='#ccc']` / `[stroke='#fff']` selectors;
  - `src/components/ui/button.tsx:16` `color-mix(in oklch, var(--secondary), var(--foreground) 5%)`;
  - `src/app/insights/strategies/[id]/page.tsx:287,515` `text-[hsl(38_92%_50%)]` and `:555` `text-[hsl(163_100%_44%)]`.
- The palette utilities in use are listed in design.md §1 B (`badge.tsx:25-26`, `alert.tsx:15,17`, `StatTile.tsx:28`, `PerformanceDashboard.tsx:120`, `screener/page.tsx:568`, `slider.tsx:49`, `toggle.tsx:22`, `button.tsx:27`, `sheet.tsx:34`, `alert-dialog.tsx:31`). None collides with any non-shared token (minimum margin Δ5).

**Lands with**: `Step 9`

**TDD**: `red-green required`. RED: Step 9's (a)/(b) fixtures fail against the Step 1 checker, which implements (c) only. A second RED is probe (ii) in Verification 2.

**Covers**: —

**Instructions** (design.md §1 B, implemented exactly):
1. Extend the source loader to `staging.css` and `production.css` via `themeCssPath`.
2. **T** is the exact custom-property names in the `:root{}` of `staging.css` ∪ `production.css` (`parseRootTokens`).
   - A **literal token declaration** is one whose name is in T and whose value contains neither `var(` nor `calc(`.
   - Every other declaration, under any selector or at-rule, is scanned by (b). That includes T-name declarations whose value contains `var(`/`calc(`.
3. **N** is every colour token in T whose staging and production values are not `colorsEqual`, recorded as (theme, name, value) for both themes. `--radius` is not a colour. The shared tokens (today `--secondary-foreground`, `--destructive`) and the `globals.css` shared literals are excluded.
4. **(a)**:
   - Every literal token declaration of a T colour name `colorsEqual`s the selected theme's value. `--radius` is compared length-normalised.
   - A value that does not parse as exactly one colour, or as a length for `--radius`, fails `unparseable token value <v> at <file>:<offset>`. Named colours fail too.
   - Every selected token needs at least one literal declaration; otherwise it fails `theme token --<name> has no literal declaration`.
5. **(b)**: every colour literal from a scanned declaration is tested against every n ∈ N. A match fails with exactly `colour literal <v> at <file>:<offset> equals <theme> --<name>; use the theme token`, where `<file>` is relative to `--css-dir`. Emit one line per (literal, theme, token) match.
6. Keep (c) unchanged. Leave the `uiTheme.cjs` API unchanged.

**Verification**: the union with Step 9.
1. V-UI.
2. Scan and symmetric RED/GREEN probe (record in `context.md`):
   - (i) Create `src/styles/themes/probe.test.ts` with a literal stone-950 background utility and a literal `var()` of its palette var. `cd services/xstockstrat-ui && NEXT_DISABLE_STANDALONE=1 pnpm build && NEXT_DISABLE_STANDALONE=1 UI_THEME=production pnpm build` both **pass**, because the file is excluded.
   - (ii) Move the same content to `src/probe.ts` as `export const probe = '…';`. The staging build **fails** with `… equals staging --background; use the theme token`, and the production build fails with the same line. Record whether bare `--color-*`/`var(--color-*)` strings emit.
   - (iii) Delete both probe files. `git status --porcelain` shows neither.
3. **Gate:** `cd services/xstockstrat-ui && NEXT_DISABLE_STANDALONE=1 pnpm build && NEXT_DISABLE_STANDALONE=1 UI_THEME=production pnpm build` both pass on today's tree (which still holds `hsl(38 92% 50%)`, `hsl(163 100% 44%)` and `hsl(var(--sidebar-border))`). This proves the §1 B table.
4. CI: `e2e-build`/`frontend-e2e`, `frontend-e2e-production` and `ui-prod-image-build` (now running (a)–(c) on the extracted CSS) are green.

---

### Step 9 — test: checker fixtures for (a), (b), tolerance and exemptions

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/styles/themes/checkThemeBundle.test.ts` — modify

**Reviewers**: `xstockstrat-ui` owner — trading UI correctness, analytics display accuracy, environment (`production`/`staging`) scope correctness

**Codebase Evidence**: as Step 8. The fixtures are synthetic CSS one-offs, so they stay inline (C-12/C-13 exemption).

**Lands with**: `Step 8`

**TDD**: `red-green required`. RED: run against the Step 1 checker ((c) only). The (a)/(b) fixtures that must fail pass instead, and the "no literal declaration" fixture passes.

**Covers**: `AC-1, AC-2, AC-3, AC-5, AC-9`

**Instructions** (design.md S5 fixtures). Run each through `checkBundle` for **both** `staging` and `production` unless noted:
0. **Update Step 2's fixtures.** Every existing (c) fixture in `checkThemeBundle.test.ts` and both CLI temp-dir fixtures (`chunks/x.css`, `.next/static/css/a.css`) gain an unlayered `:root{}` carrying the selected theme's literal token values, built from `parseRootTokens(<theme>.css)`. They must still pass with (a) and (b) active.
1. **(a), arbitrary property:**
   - `.s{--radius:var(--radius-xl)}` plus a literal `:root` passes;
   - `.s{--primary:calc(1px)}` is skipped by (a);
   - a bundle whose only `--background` declaration is `var(--x)` fails `theme token --background has no literal declaration`;
   - `.s{--primary:var(--x, oklch(0.432 0.095 166.913))}` fails via (b).
2. **(a), wrong value:** a production call with the staging `--primary` literal as a `:root` declaration fails (a).
3. **(a), unparseable:** `--primary: red` fails `unparseable token value`.
4. **(b), symmetric:** a palette declaration equal to a staging non-shared token fails in both calls with the exact message. The same holds for a production token.
5. **(b), translucent fallback:** `.x{border-color:#ffffff1a}` fails in both calls (it equals staging `--border`).
6. **(b), color-mix operand:** `color-mix(in oklab, oklch(0.74 0.12 235) 50%, transparent)` fails in a staging call (prod `--chart-2`).
7. **(b), var()-argument functions:** `hsl(var(--sidebar-border))` and `color-mix(in oklch, var(--secondary), var(--foreground) 5%)` pass.
8. **(b), selector only:** `.a\[stroke\=\'\#ccc\'\]{stroke:var(--border)}` passes.
9. **Tolerance:** off by 1 channel fails; off by 2 passes. Δα 0.01 fails; Δα 0.02 passes.
10. **Alpha rule:** an opaque white declaration vs staging `--border` passes.
11. **Shared exemptions:** the `--destructive` value as a palette declaration passes. The four shared literals pass.
12. **AC-1 (named):**
    - A production bundle containing `oklch(0.432 0.095 166.913)` as a plain declaration fails via (b); as a `--primary` declaration it fails via (a).
    - A production bundle whose `:root` holds the production values passes, and a staging bundle whose `:root` holds the staging values passes. These are AC-2/AC-3 equivalents in unit form.
13. **Concatenated names:** build every palette class or var name at runtime (`const pal = (f, n) => ['--color', f, String(n)].join('-')`).

**Verification**: as Step 8, plus `grep -nE -- "--color-(stone|emerald|zinc|yellow|blue)-[0-9]" services/xstockstrat-ui/src/styles/themes/checkThemeBundle.test.ts`, which returns nothing.
**Coverage:** `vitest.config.ts` coverage is scoped to `src/lib/**` (40% lines/functions/statements, `:25,:29-33`); `src/styles/**` is outside it, so no new threshold applies. `pnpm run test:coverage` must stay ≥ 40%.

---

### Step 10 — service: FR-11 tokenization + `viewport.themeColor`

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/insights/EquityCurveChart.tsx` — modify
- `services/xstockstrat-ui/src/app/insights/data-explorer/page.tsx` — modify
- `services/xstockstrat-ui/src/app/insights/page.tsx` — modify
- `services/xstockstrat-ui/src/app/insights/strategies/[id]/page.tsx` — modify
- `services/xstockstrat-ui/src/components/ui/sidebar.tsx` — modify
- `services/xstockstrat-ui/src/app/layout.tsx` — modify

**Reviewers**: `xstockstrat-ui` owner — trading UI correctness, analytics display accuracy

**Codebase Evidence** (the AC-12 regex grep at `d4bd9db`, excluding `src/components/ui` and `*.test.ts`):
- `EquityCurveChart.tsx`:
  - `:21-24` `LINE_COLORS` (`hsl(163 100% 44%)`, `hsl(210 100% 60%)`, `hsl(38 92% 55%)`, `hsl(280 70% 60%)`)
  - `:27` `AXIS_TICK` `hsl(215 16% 47%)`
  - `:155,263` `stroke="hsl(222 20% 14%)"`
  - `:201` marker fill entry/exit `hsl(163 100% 44%)`/`hsl(0 84% 60%)`
  - `:202` `stroke="hsl(222 47% 7%)"`
- `data-explorer/page.tsx`:
  - `:56` `CHART_CONFIG` `value.color 'hsl(163 100% 44%)'`
  - `:57` `AXIS_TICK`
  - `:272,559` the grid stroke
  - `:291,568` the series stroke
- `insights/page.tsx`:
  - `:59` `score.color`
  - `:181` the grid stroke
  - `:183-184` the axis tick fill
  - `:189-190` the series stroke and dot fill
- `strategies/[id]/page.tsx:287,515` `text-[hsl(38_92%_50%)]` and `:555` `text-[hsl(163_100%_44%)]`.
- `src/app/layout.tsx:20` `themeColor: '#0a0e14',`.
- `src/components/ui/sidebar.tsx:455` `shadow-[0_0_0_1px_hsl(var(--sidebar-border))] … hover:shadow-[0_0_0_1px_hsl(var(--sidebar-accent))]`. This is invalid against oklch tokens (recon).
- Token precedents:
  - `src/components/insights/PerformanceDashboard.tsx:40` (`color: 'var(--chart-1)'`), `:213` (`stroke="var(--chart-grid)"`), `:240,249` (`stroke="var(--color-equity)"`);
  - `src/components/insights/FormulaRunResult.tsx:10,25`;
  - `ChartContainer` emits `--color-<key>` (`src/components/ui/chart.tsx:90-100`).
- The only non-test hit outside these sites is the `src/lib/chartColors.ts:2` comment line (excluded as a comment).
- `--color-warning` exists from Step 1, and `--color-buy` is at `globals.css:44`. Both give the utilities `text-warning`/`text-buy` via `@theme inline`.

**Lands with**: `Step 11`

**TDD**: `red-green required`. RED: Step 11's `noColorLiterals.test.ts` reports every site above and the `sidebar.tsx` `hsl(var(--sidebar-border))` string.

**Covers**: —

**Instructions** (design.md §1 C). Change only colour values; keep DOM, copy and behaviour.
1. `EquityCurveChart.tsx`:
   - `LINE_COLORS` → `['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)']`;
   - `AXIS_TICK.fill` → `'var(--muted-foreground)'`;
   - both grid strokes → `"var(--chart-grid)"`;
   - marker fill → `m.kind === 'entry' ? 'var(--color-buy)' : 'var(--color-sell)'`;
   - marker stroke → `"var(--card)"`.
2. `data-explorer/page.tsx`: `CHART_CONFIG.value.color` → `'var(--chart-1)'`, `AXIS_TICK.fill` → `'var(--muted-foreground)'`, grid strokes → `"var(--chart-grid)"`, series strokes → `"var(--color-value)"`.
3. `insights/page.tsx`: `score.color` → `'var(--chart-1)'`, grid stroke → `"var(--chart-grid)"`, tick fills → `'var(--muted-foreground)'`, series stroke and dot fill → `"var(--color-score)"`.
4. `strategies/[id]/page.tsx`: `:287,515` `text-[hsl(38_92%_50%)]` → `text-warning`, and `:555` `text-[hsl(163_100%_44%)]` → `text-buy`.
5. `sidebar.tsx:455`: `shadow-[0_0_0_1px_var(--sidebar-border)]` and `hover:shadow-[0_0_0_1px_var(--sidebar-accent)]`, marked with a trailing `// app-specific` comment, as is the house convention for app edits to `ui/*` primitives.
6. `layout.tsx:20`: `themeColor: process.env.UI_THEME_BACKGROUND_HEX,`.

**Verification**: the union with Step 11.
1. V-UI. `src/lib/chartColors.test.ts`, `src/components/ui/button.test.ts` and `badge.test.ts` stay green.
2. UI-SERVE (see Verification conventions), then `curl -s localhost:3000/auth/login | grep -o '<meta name="theme-color" content="[^"]*"'` shows `#0c0a09`.
3. Repeat with `UI_THEME=production` on both commands; the curl shows `#080d17`.
4. Both builds print the checker OK line. (b) accepts the new `text-warning`/`text-buy`, because their literals are shared and not in N.
5. If Step 1 recorded `--color-warning` as unemitted, confirm (c) now passes, because `text-warning` exists.
6. After each build, `cd services/xstockstrat-ui && find .next/static/css -name '*.css' -exec cat {} + | grep -oE -- '--tw-shadow:[^;}]*sidebar-border[^;}]*' | head -1` prints a `--tw-shadow` declaration containing `0 0 0 1px` and `var(--sidebar-border)` (Tailwind v4 puts the shadow value in `--tw-shadow`; `box-shadow` only composes the `--tw-*` vars). A `--tw-shadow-color:` declaration alone is a FAIL: it means the value was parsed as a colour only. Record the output in `context.md`.

---

### Step 11 — test: `noColorLiterals.test.ts` (AC-12 static scan)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/styles/noColorLiterals.test.ts` — create

**Reviewers**: `xstockstrat-ui` owner — trading UI correctness, analytics display accuracy

**Codebase Evidence**:
- The AC-12 regex is `/hsl\(\s*\d|oklch\(|#[0-9a-fA-F]{6}\b/`, with its scope ("non-comment line in src/**/*.ts or src/**/*.tsx outside src/components/ui and *.test.ts"), in `acceptance.feature` (AC-12).
- The comment-only hit is `src/lib/chartColors.ts:2` (`// … oklch(...)`), so the scanner must skip lines whose trimmed text starts with `//`, `/*` or `*`.
- No `hsl(var(` ban across `src`: design R8 F1 dropped it, because it would match the Step 2/9 fixtures (fails.md:3983).

**Lands with**: `Step 10`

**TDD**: `red-green required`. RED: on the pre-Step-10 tree, the scan reports the sites in Step 10's evidence plus `layout.tsx:20`, and the sidebar assertion finds `hsl(var(--sidebar-border))`.

**Covers**: `AC-12`

**Instructions**:
1. Walk `src/` recursively with `fs`, keeping `*.ts`/`*.tsx` and excluding `src/components/ui/**` and `*.test.ts`.
2. For each line that is not a comment line, test the AC-12 regex verbatim. Collect `<path>:<line>`, and assert the list is empty with the list as the failure message.
3. Separately, assert that `src/components/ui/sidebar.tsx` does not contain `hsl(var(--sidebar-border))`.

**Verification**: as Step 10.
**Coverage:** `vitest.config.ts` coverage is scoped to `src/lib/**` (40% lines/functions/statements, `:25,:29-33`); `src/styles/**` is outside it, so no new threshold applies. `pnpm run test:coverage` must stay ≥ 40%.

---

### Step 12 — service: per-theme PWA manifest route

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/public/manifest.webmanifest` — delete
- `services/xstockstrat-ui/src/app/manifest.webmanifest/route.ts` — create (or, if Step 3 chose the fallback: `services/xstockstrat-ui/next.config.js` and `services/xstockstrat-ui/.gitignore` — modify)
- `services/xstockstrat-ui/Dockerfile` — modify (comment `:27-28`)

**Reviewers**: `xstockstrat-ui` owner — trading UI correctness, environment (`production`/`staging`) scope correctness

**Codebase Evidence**:
- `public/manifest.webmanifest` holds `name`, `short_name`, `description`, `display: standalone`, `start_url: /trader`, `scope: /`, `background_color`/`theme_color` `#0a0e14`, and three icons.
- These are preserved:
  - `next.config.js:23` no-cache header;
  - `src/middleware.ts:22` matcher exclusion;
  - `src/app/layout.tsx:12` `metadata.manifest`;
  - `/sw.js`.
- `e2e/accounts/pwa.spec.ts:11-25` asserts `display`, `start_url /trader`, 192/512 and `maskable`. `services/xstockstrat-ui/acceptance/pwa-notifications.feature` (@AC-1 @feature-165) is a PRESERVE rule.
- `Dockerfile:27-28` comment: "copy it so the PWA manifest, icons, and service worker (feature 165) are served at runtime".
- `next.config.js` `env.UI_THEME_BACKGROUND_HEX` comes from Step 4.

**Lands with**: `Step 13`

**TDD**: `red-green required`. RED: Step 13's AC-13 test fails before this step on the production build (the manifest reports `#0a0e14`, not `#080d17`) and on the staging build (`#0a0e14` ≠ `#0c0a09`).

**Covers**: —

**Deploy-file parity**: the route reads only the build-time-inlined `UI_THEME_BACKGROUND_HEX`; `docker-compose.yml`, `.do/app.dev.yaml` and `.do/app.yaml` are intentionally unchanged.

**Instructions**:
1. **Route (Step 3 passed):**
   - Delete `public/manifest.webmanifest`.
   - Create `route.ts` with `export const dynamic = 'force-dynamic';` and a `GET` returning `Response.json(...)` with the same fields and icon list, `theme_color` and `background_color` = `process.env.UI_THEME_BACKGROUND_HEX`, and header `Content-Type: application/manifest+json`.
   - Keep the `next.config.js:23` header entry: it still applies to the route URL.
2. **Fallback (Step 3 failed):**
   - Delete the tracked `public/manifest.webmanifest`.
   - In `next.config.js`, at config load, write `public/manifest.webmanifest` with the same JSON and the theme hex.
   - Add `public/manifest.webmanifest` to `services/xstockstrat-ui/.gitignore`.
3. `Dockerfile:27-28`: reword the comment to say the PWA icons and service worker are served from public/, and the manifest comes from the route (or from the generated file in the fallback).

**Verification**: the union with Step 13.
1. V-UI.
2. UI-SERVE (see Verification conventions), then the Step 3 curl checks (`no-cache`, `application/manifest+json`, ƒ, one `rel="manifest"`), and `curl -s localhost:3000/manifest.webmanifest | grep -o '"theme_color":"#[0-9a-f]*"'` prints `#0c0a09`. With `UI_THEME=production` it prints `#080d17`.
3. `./scripts/run-e2e.sh e2e/accounts/pwa.spec.ts` (repo root) is green. It runs the built e2e image, so it exercises the built route, not `pnpm dev`, and needs no host browser.
4. CI: `frontend-e2e` and `frontend-e2e-production`.

---

### Step 13 — test: AC-13 manifest + meta theme-color e2e; FR-10 static on the route

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/theme/theme-bundle.spec.ts` — modify
- `services/xstockstrat-ui/src/styles/themes/nextConfig.test.ts` — modify

**Reviewers**: `xstockstrat-ui` owner — trading UI correctness, environment (`production`/`staging`) scope correctness

**Codebase Evidence**:
- The request-fixture pattern is `request.get('/manifest.webmanifest')` (`e2e/accounts/pwa.spec.ts:14`).
- `themeBackgroundHex` is in `uiTheme.cjs` (Step 4), and the spec seeded in Step 7 already loads it.

**Lands with**: `Step 12`

**TDD**: `red-green required`. RED as stated in Step 12.

**Covers**: `AC-13`

**Instructions**:
1. Add `@AC-13 PWA chrome colour follows the theme` to the spec:
   - `request.get('/manifest.webmanifest')`: `theme_color` and `background_color` equal `themeBackgroundHex(process.env.UI_THEME ?? 'staging')`; the `cache-control` header contains `no-cache`; `display === 'standalone'`; the icon sizes include `192x192` and `512x512`.
   - `page.goto('/trader')` after `addAuthCookie`: `meta[name="theme-color"]`'s `content` equals the same hex.
2. `nextConfig.test.ts` FR-10 static: if Step 3 chose the route, add `src/app/manifest.webmanifest/route.ts` to the scanned file list (same concatenated needle; test files stay excluded). If Step 3 chose the fallback, add nothing: the generator lives in `next.config.js`, which is already scanned.

**Verification**: as Step 12, plus `./scripts/run-e2e.sh e2e/theme/` is green.
**Coverage:** e2e only; no line-coverage threshold applies (vitest coverage is scoped to `src/lib/**`, 40%).

---

### Step 14 — test: aria goldens, chart parse-error guard, `--chart-1` stroke

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/theme/theme-bundle.spec.ts` — modify
- `services/xstockstrat-ui/e2e/theme/theme-bundle.spec.ts-snapshots/shell.aria.yml` — create
- `services/xstockstrat-ui/e2e/theme/theme-bundle.spec.ts-snapshots/trader-main.aria.yml` — create
- `services/xstockstrat-ui/e2e/theme/theme-bundle.spec.ts-snapshots/strategy-equity.aria.yml` — create

**Reviewers**: `xstockstrat-ui` owner — trading UI correctness, analytics display accuracy

**Codebase Evidence**:
- `/insights/strategies/strat-history-001` with bt-hist-2 is opened by `e2e/insights/backtest-sizing.spec.ts:32-43` (`page.getByTestId('past-run-row')`, `rows.first().click()`, `getByTestId('equity-curve-chart')`). The fixture data is `e2e/mock-backend.ts:807-851` (`strat-history-001`, `bt-hist-2`).
- The chart-readiness pattern is `page.locator('[data-testid="chart-container"] .tv-lightweight-charts')` (`e2e/trader/chart-panel.spec.ts:194`).
- `page.clock.setFixedTime` is unused in `e2e/` today. Playwright is pinned at `1.62.1` (`package.json:67`), which supports `page.clock` and `toMatchAriaSnapshot`.
- C-12: this step reuses the existing `strat-history-001`/`bt-hist-2` mock-backend fixtures and `addAuthCookie`. No new domain object.
- `docs/patterns/ui-ux-governance.md` §7 lists "no visual-regression/snapshot baseline" as a non-goal. The scoped exception for these 3 aria goldens is documented in Step 19.

**TDD**: `red-green required`. RED:
1. Before the goldens exist, the aria assertions fail in CI mode (missing snapshot, no `--update-snapshots`).
2. The AC-12 stroke assertion fails when Step 10's `EquityCurveChart.tsx` `LINE_COLORS` edit is temporarily reverted. Record that run, then restore.

**Covers**: `AC-5, AC-7, AC-8, AC-11, AC-12`

**Instructions**:
1. **AC-7.** Add three named aria goldens via `expect(locator).toMatchAriaSnapshot({ name: 'shell.aria.yml' })`, `{ name: 'trader-main.aria.yml' }` and `{ name: 'strategy-equity.aria.yml' }` (the named form writes files to `<spec>-snapshots/`; the unnamed form would inline YAML into the spec). Each is captured under `page.clock.setFixedTime(<mock-backend fixed epoch>)`. At execute time confirm Playwright 1.62.1 writes them to the three paths in **Files** and record the actual paths in `context.md`; because `page.clock` is unused in `e2e/` today, also record that the fixed time took effect (the golden contains no wall-clock text, or such text is matched by an aria `/regex/`):
   - the shell banner and navigation;
   - the `/trader` main;
   - `/insights/strategies/strat-history-001` with bt-hist-2 opened, using the `backtest-sizing.spec.ts:32-43` steps.

   Assert visible text with `toContainText` on the same regions. One golden serves both themes (the default snapshot path has no theme suffix).
2. **AC-8 / AC-11.** Collect `page.on('console')` and `page.on('pageerror')` on the `/trader` chart view until `.tv-lightweight-charts` is visible. Assert no message contains `Failed to parse color`. This runs in both themes: staging via `frontend-e2e`, production via `frontend-e2e-production`.
3. **AC-12.** On the equity curve, the first series path's computed `stroke` `colorsEqual`s the computed value of `--chart-1` on `document.documentElement`, canonicalised through `cssColorToSrgb`.
4. **AC-5.** In each build, the computed `--color-buy`, `--color-sell` and `--color-paper` `colorsEqual` `hsl(159 52% 54%)`, `hsl(359 63% 67%)` and `hsl(43 41% 64%)`.
5. Generate the goldens from the repo root (`run-e2e.sh` mounts no volume and copies out only `playwright-report`, so goldens it writes never reach the host):
   ```bash
   docker build -f Dockerfile.e2e -t xstockstrat-e2e:gold . \
     && docker run --name e2e-gold xstockstrat-e2e:gold e2e/theme/ --update-snapshots; \
     docker cp e2e-gold:/workspace/services/xstockstrat-ui/e2e/theme/theme-bundle.spec.ts-snapshots services/xstockstrat-ui/e2e/theme/; \
     docker rm e2e-gold
   ```
   (`Dockerfile.e2e:118` sets `WORKDIR /workspace/services/xstockstrat-ui`.) `docker cp` writes host-owned files, so no `chown` is needed; this resolves design Open Risk 8.

**Verification**:
- `ls services/xstockstrat-ui/e2e/theme/theme-bundle.spec.ts-snapshots/ | grep -cE '^(shell|trader-main|strategy-equity).*\.aria\.yml$'` prints `3` (tolerates a `-<project>` suffix). If Playwright adds a suffix, update the three **Files** entries to the recorded names.
- `./scripts/run-e2e.sh e2e/theme/` is green (staging).
- `docker build --build-arg UI_THEME=production -f Dockerfile.e2e -t xstockstrat-e2e:prod . && docker run --rm xstockstrat-e2e:prod e2e/theme/ --grep-invert @AC-10` is green with the same goldens.
- `grep -n "helpers/auth" services/xstockstrat-ui/e2e/theme/theme-bundle.spec.ts` (C-12).
- `cd services/xstockstrat-ui && pnpm run lint && pnpm exec tsc --noEmit`.
- Coverage: e2e only. UI vitest threshold unchanged: `cd services/xstockstrat-ui && pnpm run test:coverage` stays ≥ 40% (`src/lib/**`, `vitest.config.ts:29-33`); this step adds no covered `src/lib` code.
- CI: `frontend-e2e` and `frontend-e2e-production`.

---

### Step 15 — service: UI theme label guard — preflight, callers, deploy paths

**Status**: `pending`
**Service**: CI/CD (deploy pipeline)
**Files**:
- `scripts/ui-theme-label.sh` — create
- `.github/workflows/docker-build.yml` — modify
- `.github/workflows/deploy-dev.yml` — modify
- `.github/workflows/deploy-prod.yml` — modify
- `.github/workflows/homelab-images.yml` — modify
- `.github/workflows/deploy-homelab.yml` — modify
- `.github/workflows/prod-up.yml` — modify
- `.github/workflows/staging-up.yml` — modify
- `.github/workflows/deploy.yml` — modify
- `.github/workflows/ci.yml` — modify

**Reviewers**: Platform Lead (advisory, per product spec) — cross-service architecture, deploy-pipeline consistency; `xstockstrat-ui` owner — environment (`production`/`staging`) scope correctness

**Codebase Evidence**:
- `docker-build.yml`:
  - `workflow_call.inputs` at `:5-18` (`image_tag`, `latest_tag`, `build_migrator`);
  - `jobs.build` at `:21` with `permissions` `:24-26`;
  - the UI matrix leg at `:53-54`;
  - `docker/login-action@v4` at `:65-71`;
  - `REPO="ghcr.io/davcs86/xstockstrat/${{ matrix.service }}"` at `:77`;
  - `docker/build-push-action@v7` at `:80-90`, with no `build-args` and cache `scope=${{ matrix.service }}` at `:88-89`.
- Callers:
  - `deploy-dev.yml:37-41` (`latest_tag: latest-dev`);
  - `deploy-prod.yml:36-40` (`latest_tag: latest`);
  - `homelab-images.yml:23-27` (`latest_tag: homelab-manual`, bare `workflow_dispatch:` at `:6`, summary at `:35`).
- `deploy-homelab.yml`:
  - `env.REGISTRY: ghcr.io/davcs86/xstockstrat` at `:34`;
  - "Validate the image tag (production only from main)" at `:73-86`, which writes `IMAGE_TAG` to `GITHUB_ENV` at `:86`;
  - `uses: ./.github/actions/setup-sops` at `:88`;
  - the image-commit checkout at `:111-116`;
  - the GHCR login idiom `printf '%s' "$GH_TOKEN" | docker login ghcr.io -u "$GITHUB_ACTOR" --password-stdin` at `:123`;
  - `packages: read` already at `:59`.
- `prod-up.yml`: `jobs.up.permissions` `:27-28` (`contents: read`), `check` at `:36-49`, `db` at `:51-55`, and `image_tag` default `latest` at `:16-19`.
- `staging-up.yml`: `permissions` at `:24-25`, `check` at `:33-46`, `db` at `:48`.
- `deploy.yml`: the `validate` job at `:22-29` (case step only, no permissions); `deploy` `needs: validate` at `:32`; the checkout pin `actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1  # v7.0.1` at `:44`; `doctl apps update` at `:101`.
- Pins in `scripts/sops-secrets.test.sh` that this step must respect (design.md § Dependent tests/pins):
  - prod-up `uses:` list exactly `CHECKOUT DOCTL setup-sops` at `:1031-1032`, so the login must be a `run:` step;
  - `permissions.contents == read` at `:1030`;
  - deploy-homelab "no `uses:` after resolve" at `:1083`.
- `ci.yml`:
  - the `scripts` filter at `:68-70` (`scripts/**`, `.claude/hooks/**`);
  - the `sops` filter at `:87-101`;
  - the shell-lint chain at `:705`.

**Lands with**: `Step 16`

**TDD**: `red-green required`. RED: Step 16's `group_uitheme` fails with `expected exactly one ui-theme step`, and `ui-theme-label.test.sh` fails because the script is missing, both before the workflow and script edits.

**Covers**: —

**Deploy-file parity**: `ui_theme`, `IMAGE_TAG` and `GH_TOKEN` are workflow inputs / step env only; no runtime env var or port is added, so `docker-compose.yml`, `.do/app.dev.yaml` and `.do/app.yaml` are intentionally unchanged.

**Instructions** (design.md §1 F, implemented exactly):

Keep these edits in one commit with the paired test step (`Lands with`); do not split them by file.

1. `scripts/ui-theme-label.sh`:
   - bash 3.2, `#!/usr/bin/env bash`, `set -euo pipefail`;
   - a single registry constant at line start: `UI_IMAGE_REPO=ghcr.io/davcs86/xstockstrat/xstockstrat-ui`;
   - the subcommands `refuse-retheme <tag> <theme>` and `require-match <tag> <target_env>`.

   Each subcommand reads `docker buildx imagetools inspect "$UI_IMAGE_REPO:$tag" --format '{{json .Image}}'`, and `jq` picks the label from the rootfs shape or the `["linux/amd64"]` shape. Any other shape is an error. Outcomes and the exact `::error::`/`::warning::` texts are listed in design.md §1 F:
   - `refuse-retheme`:
     - absent, equal or no label → exit 0;
     - differs → `::error::refusing to re-theme <ref>: SHA <tag> already built with UI theme <x>; was main-dev fast-forwarded to main? Back-merges must be --no-ff`, exit 1;
     - any other inspect failure → exit 1.
   - `require-match`:
     - absent → `::error::<ref> not found; was docker-build.yml run for <tag>?`;
     - equal → pass;
     - no label → silent pass on staging, a `::warning::` naming the unlabelled image on production;
     - differs → `::error::xstockstrat-ui:<tag> carries io.xstockstrat.ui-theme=<x>; refusing to deploy to <env>`;
     - any other failure → exit 1.
2. `docker-build.yml`:
   - Add a required input `ui_theme` (type string).
   - Add a `preflight-ui-theme` job with `permissions: {contents: read, packages: read}`. Its steps are, in this order:
     - `actions/checkout@v7`;
     - a `case "$T" in staging|production) ;; *) exit 1;; esac` validation;
     - `docker/login-action@v4` as at `:65-71`;
     - `bash scripts/ui-theme-label.sh refuse-retheme "$TAG" "$T"`, with `TAG`/`T` passed via `env:`.
   - Give `build` `needs: preflight-ui-theme`.
   - Add `build-args: ${{ matrix.service == 'xstockstrat-ui' && format('UI_THEME={0}', inputs.ui_theme) || '' }}` to the build-push step. Leave the cache scope unchanged.
3. Callers:
   - `deploy-dev.yml` `with:` → `ui_theme: staging`;
   - `deploy-prod.yml` `with:` → `ui_theme: production`;
   - `homelab-images.yml`: give `workflow_dispatch:` a required `ui_theme` choice input `[staging, production]`; pass `ui_theme: ${{ inputs.ui_theme }}`; the `:35` summary names the theme.
4. Deploy-path `ui-theme` steps. Each is a `run:` step with `id: ui-theme`, `env.GH_TOKEN: ${{ github.token }}`, the exact `:123` login line, and no inlined `${{ }}` in `run:`.
   - `prod-up.yml`: between `check` and `db`, with `if: steps.check.outputs.app_id == ''`, `env.IMAGE_TAG: ${{ inputs.image_tag }}`, and `require-match "$IMAGE_TAG" production`. Add `packages: read` to `jobs.up.permissions`.
   - `staging-up.yml`: the same between `check` and `db`, with `staging`. Add `packages: read`.
   - `deploy.yml` `validate`:
     - add `permissions: {contents: read, packages: read}`;
     - after the case step, add the `:44` checkout pin;
     - then the `ui-theme` step with `env: {E: ${{ inputs.environment }}, IMAGE_TAG: ${{ inputs.image_tag }}, GH_TOKEN: ${{ github.token }}}` and `require-match "$IMAGE_TAG" "$E"`;
     - add no `if:`.
   - `deploy-homelab.yml`: between "Validate the image tag" (`:73-86`) and setup-sops (`:88`), with `require-match "$IMAGE_TAG" "$TARGET_ENV"`. `IMAGE_TAG` comes from `GITHUB_ENV`. Add no `if:`.
5. `ci.yml`:
   - Add these to the `scripts` filter: `.github/workflows/deploy.yml`, `docker-build.yml`, `deploy-dev.yml`, `deploy-prod.yml`, `prod-up.yml`, `staging-up.yml`, `homelab-images.yml` and `deploy-homelab.yml` (each a full `.github/workflows/<name>.yml` path).
   - Add `scripts/ui-theme-label.sh` to the `sops` filter.
   - Append `&& bash scripts/ui-theme-label.test.sh` to the `:705` chain.

**Verification**: the union with Step 16.
1. `bash scripts/ui-theme-label.test.sh`.
2. `bash scripts/sops-secrets.test.sh deploy produp homelab uitheme` (needs yq), then the full `bash scripts/sops-secrets.test.sh`.
3. `shellcheck scripts/*.sh && shfmt -d -i 2 scripts/*.sh`.
4. `bash scripts/homelab-render.test.sh` (triggered by the deploy-homelab edit; must stay green).
5. RED first: run `bash scripts/sops-secrets.test.sh uitheme` before the workflow edits. It must fail with `expected exactly one ui-theme step`.
6. `node --test scripts/config-wiring.test.mjs` (`ci.yml` filter blocks intact).
7. CI: `shell-lint`, `sops-secrets` and `homelab-render` are green.

---

### Step 16 — test: `ui-theme-label.test.sh` + `group_uitheme`

**Status**: `pending`
**Service**: CI/CD (deploy pipeline)
**Files**:
- `scripts/ui-theme-label.test.sh` — create
- `scripts/sops-secrets.test.sh` — modify

**Reviewers**: Platform Lead (advisory) — deploy-pipeline consistency; `xstockstrat-ui` owner — environment (`production`/`staging`) scope correctness

**Codebase Evidence**:
- House directive: `scripts/sops-secrets.test.sh:4` `# shellcheck disable=SC2015,SC2016 # …`, with `set -uo pipefail` at `:5`.
- Helpers in `sops-secrets.test.sh`:
  - `fail()` `:9-12`
  - `need()` `:14-20` (requires mikefarah yq v4)
  - `step_idx()` `:888-890`
  - `CHECKOUT_PIN` `:1021`
  - `group_produp()` `:1024`, `group_homelab()` `:1057`
  - the default `groups` list at `:1385`
- Ordering already pinned elsewhere: `deploy needs validate` (`sops-secrets.test.sh:768`), and prod-up/staging-up order around `db` (`:1050`, `produp_lifecycle :946-951`).
- `docker-build.yml:77` `REPO="ghcr.io/davcs86/xstockstrat/${{ matrix.service }}"` and `deploy-homelab.yml:34` `REGISTRY: ghcr.io/davcs86/xstockstrat` are the registry-drift targets.
- C-13: the fake-`docker` JSON shapes are test data with one consumer (this script), so inline is compliant.

**Lands with**: `Step 15`

**TDD**: `red-green required`. RED as stated in Step 15.

**Covers**: `AC-6, AC-15, AC-16`

**Instructions**:
1. `scripts/ui-theme-label.test.sh`:
   - Line 1 is `#!/usr/bin/env bash`.
   - Line 2 is `# shellcheck disable=SC2015,SC2016 # \`A && B || fail\` is the assertion idiom (fail always exits); literal ${{ }} is matched text`.
   - Line 3 is `set -uo pipefail`.

   Put a fake `docker` on `PATH` that emits both JSON shapes, an absent ref and an arbitrary failure. Cover:
   - **AC-15:** `refuse-retheme abc1234 staging` against a `production` label fails with `refusing to re-theme`.
   - **AC-16:** all 11 rows of the Scenario Outline, against `require-match`.
   - **Static yq asserts:**
     - the docker-build `ui_theme` input is required;
     - `.jobs.build.needs == preflight-ui-theme`;
     - the preflight step order is checkout → case → login → refuse-retheme;
     - deploy-dev passes `with.ui_theme == staging` and deploy-prod `production`;
     - homelab-images has a required choice input `[staging, production]` and passes it;
     - the UI leg's `build-args` expression names `UI_THEME`.
   - **Registry drift**, verbatim from design.md S9: `UI_IMAGE_REPO` is defined once and ends in `/xstockstrat-ui`; the docker-build `REPO` prefix and the deploy-homelab `REGISTRY` both equal `${repo%/xstockstrat-ui}`.
2. `scripts/sops-secrets.test.sh`: add `ui_theme_step()` and `group_uitheme()` verbatim from design.md S9. Append `uitheme` to the default `groups` list at `:1385`.

**Verification**: as Step 15.
**Coverage:** shell test. UI vitest threshold unchanged: `cd services/xstockstrat-ui && pnpm run test:coverage` stays ≥ 40% (`src/lib/**`, `vitest.config.ts:29-33`); this step adds no covered `src/lib` code.

---

### Step 17 — service: `--no-ff` sync, serialized sync, three-dot promote gate, promotion docs

**Status**: `pending`
**Service**: CI/CD (promotion automation) + SDD skills/docs
**Files**:
- `.github/workflows/sync-main-to-maindev.yml` — modify
- `.github/workflows/promote.yml` — modify
- `.claude/skills/promote/SKILL.md` — modify
- `.claude/skills/sdd-triage/reference/backmerge.md` — modify
- `.github/PULL_REQUEST_TEMPLATE/promotion.md` — modify
- `.github/workflows/ci.yml` — modify

**Reviewers**: Platform Lead (advisory) — cross-service architecture, deploy-pipeline consistency

**Codebase Evidence**:
- `sync-main-to-maindev.yml`:
  - `on: push: branches: [main]` at `:3-6`, followed directly by `jobs:` at `:8`;
  - the `BEHIND` early exit at `:46-50`;
  - `:52` `if ! git merge origin/main \` with `--no-edit` and `-m …` at `:53-54`;
  - the conflict path `git merge --abort` at `:55`;
  - the push retry loop at `:61-74`, which only re-fetches.
- `promote.yml`:
  - `:40-47` "Validate — main-dev is ahead of main" (`AHEAD=$(git log origin/main..origin/main-dev --oneline | wc -l …)`);
  - "Commit and push changelog" at `:188-193`;
  - `:223` `echo "> Squash-merging breaks git ancestry and causes \`main-dev\` to appear permanently ahead of \`main\`."`.
- `.claude/skills/promote/SKILL.md`:
  - `:64-69` the `git log origin/main..origin/main-dev --oneline` check plus "If the output is empty: stop";
  - `:223` "permanently ahead";
  - `:332-334` and `:341-343` sync prose ("merges the resulting main commit back into main-dev"; "merges the new `main` tip back into `main-dev`").
- `.claude/skills/sdd-triage/reference/backmerge.md:20-21` "(the sync merge, or the hotfix merge itself when `main-dev` was fast-forwarded)" (SD-2).
- `.github/PULL_REQUEST_TEMPLATE/promotion.md:15-16` "main-dev appears permanently ahead".
- Concurrency style precedent: `deploy-homelab.yml:54-56` (`concurrency: group: … cancel-in-progress: false`).
- `grep -rnE 'git merge([[:space:]]+-[^[:space:]]+)*[[:space:]]+(origin/)?main([^-[:alnum:]_/]|$)'` over `.github/`, `docs/runbooks/`, `.claude/skills/`, `scripts/` and `CLAUDE.md` matches only `sync-main-to-maindev.yml:52` and the comment at `scripts/workflow-tests/merge-train-resolve.test.mjs:12`. The design's four doc sites no longer hold merge commands (SD-1).
- `ci.yml:68-70` is the `scripts` filter, and `:705` is the shell-lint chain.

**Lands with**: `Step 18`

**TDD**: `red-green required`. RED: Step 18's script on the current tree fails, naming `sync-main-to-maindev.yml:52` (no `--no-ff`), the missing workflow `concurrency`, and the two-dot/commit-count gate (`AHEAD=$(git log` present).

**Covers**: —

**Instructions**:

Keep these edits in one commit with the paired test step (`Lands with`); do not split them by file.

1. `sync-main-to-maindev.yml`:
   - `:52` → `if ! git merge --no-ff origin/main \`.
   - Between `on:` and `jobs:`, add:
     ```yaml
     concurrency:
       group: sync-main-to-maindev
       cancel-in-progress: false
     ```
   - Leave the retry loop unchanged.
2. `promote.yml:40-47`: replace the step body with
   `if git diff --quiet origin/main...origin/main-dev; then echo "::error::main-dev has no changes since its merge base with main. Nothing to promote."; exit 1; fi`
   and rename the step "Validate — main-dev has changes to promote". It stays before "Commit and push changelog".
   Reword `:223` to exactly `Squash-merging breaks git ancestry: the promoted main-dev commits never become ancestors of main, so the next promotion's diff re-shows changes that are already promoted.` (inside the existing `echo "> …"` with the same quoting). With `--no-ff` back-merges, main-dev always carries tree-identical sync commits, so "main-dev appears ahead of main" is no longer a squash symptom. None of the reworded lines (here, `SKILL.md:223`, `promotion.md:15-16`, root `CLAUDE.md:345`, `infra-ci.md:163`) may contain the word "permanently".
3. `promote/SKILL.md`:
   - `:64-69` → the same three-dot content gate (`git diff --quiet origin/main...origin/main-dev` → stop "main-dev has no changes since its merge base with main. Nothing to promote.").
   - `:223` → the same rewording as `promote.yml:223`.
   - `:332-334` and `:341-343` → state that the sync makes a `--no-ff` merge commit on `main-dev`, so dev and prod never build the same SHA (SHA-tagged images are themed per environment). Each promotion leaves one tree-identical merge commit on `main-dev`, and that is expected.
4. `backmerge.md:20-21`: drop "or the hotfix merge itself when `main-dev` was fast-forwarded". The printed commit is the sync merge commit (always a `--no-ff` merge since feature 307), or the merged `sync/main-into-main-dev` PR.
5. `.github/PULL_REQUEST_TEMPLATE/promotion.md:15-16`: the same rewording as `promote.yml:223`.
6. `ci.yml`:
   - Add these to the `scripts` filter: `.github/workflows/sync-main-to-maindev.yml`, `.github/workflows/promote.yml`, `.github/PULL_REQUEST_TEMPLATE/hotfix.md`, `.github/PULL_REQUEST_TEMPLATE/promotion.md`, `docs/runbooks/feature-workflow.md`, `docs/runbooks/bug-triage.md`, `.claude/skills/sdd-triage/reference/backmerge.md` and `.claude/skills/promote/SKILL.md`.
   - Append `&& bash scripts/backmerge-no-ff.test.sh` to the `:705` chain.

**Verification**: the union with Step 18.
1. RED: `bash scripts/backmerge-no-ff.test.sh` on the pre-edit tree fails, naming `sync-main-to-maindev.yml:52`, the missing concurrency and the commit-count gate.
2. Apply the edits.
3. GREEN: `bash scripts/backmerge-no-ff.test.sh` prints `backmerge-no-ff.test.sh: all assertions passed`.
4. `shellcheck scripts/*.sh && shfmt -d -i 2 scripts/*.sh`.
5. `./scripts/check-context-map.sh` and `node --test scripts/workflow-tests/*.test.mjs` (the `.claude/skills/**` edits trigger the context-map job).
6. `actionlint .github/workflows/sync-main-to-maindev.yml .github/workflows/promote.yml` if available.

---

### Step 18 — test: `backmerge-no-ff.test.sh` (guard, static asserts, hermetic git fixture)

**Status**: `pending`
**Service**: CI/CD (promotion automation)
**Files**:
- `scripts/backmerge-no-ff.test.sh` — create

**Reviewers**: Platform Lead (advisory) — deploy-pipeline consistency

**Codebase Evidence**:
- As Step 17.
- The guard regex is verified not to match:
  - the `--abort` at `sync-main-to-maindev.yml:55`;
  - the `merge-base` lines;
  - `origin/main-dev`;
  - `deploy-homelab.yml:84` (`git merge-base --is-ancestor "$src" origin/main`).
- The comment at `scripts/workflow-tests/merge-train-resolve.test.mjs:12` is outside the scanned file list.
- The fixture needs git ≥2.32 (`GIT_CONFIG_GLOBAL`) and ≥2.28 (`init -b`).

**Lands with**: `Step 17`

**TDD**: `red-green required`. RED as stated in Step 17.

**Covers**: `AC-18, AC-19, AC-20`

**Instructions**:
1. Use the header and `fail`/`git_q`/`check_fixture` body verbatim from design.md S10 (`# shellcheck disable=SC2015 …`, `set -uo pipefail`, `cd "$(git rev-parse --show-toplevel)"`, `GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1`, `mktemp -d` + `trap`).
2. `check_backmerge_no_ff`, adapted per SD-1, runs `grep -nE 'git merge([[:space:]]+-[^[:space:]]+)*[[:space:]]+(origin/)?main([^-[:alnum:]_/]|$)'` per file:
   - `.github/workflows/sync-main-to-maindev.yml`: **≥1 match required**, and every whole matched line contains `--no-ff`.
   - `.github/PULL_REQUEST_TEMPLATE/hotfix.md`, `docs/runbooks/feature-workflow.md`, `docs/runbooks/bug-triage.md`, `.claude/skills/sdd-triage/reference/backmerge.md` and `.claude/skills/promote/SKILL.md`: 0 matches are allowed, and any matched line must contain `--no-ff`.
   - Each failure names `<file>:<line>`.
3. Static asserts:
   - `yq e '.concurrency.group' .github/workflows/sync-main-to-maindev.yml` = `sync-main-to-maindev` and `.concurrency."cancel-in-progress"` = `false`;
   - `promote.yml` contains `git diff --quiet origin/main...origin/main-dev`, and `AHEAD=$(git log` is absent;
   - the gate step's index is below the index of "Commit and push changelog";
   - `promote/SKILL.md` contains `git diff --quiet origin/main...origin/main-dev`.
4. Run `check_backmerge_no_ff`, the static asserts and `check_fixture` (AC-18 new merge SHA ≠ M with `HEAD^2 = M`, AC-19 three-dot empty after syncs and non-empty after a real change, AC-20 main-dev ⊇ {M, S} after two sequential syncs). Then print `backmerge-no-ff.test.sh: all assertions passed`.

**Verification**: as Step 17.
**Coverage:** shell test. UI vitest threshold unchanged: `cd services/xstockstrat-ui && pnpm run test:coverage` stays ≥ 40% (`src/lib/**`, `vitest.config.ts:29-33`); this step adds no covered `src/lib` code.

---

### Step 19 — docs: governance §1/§5/§7/§9, UI CLAUDE.md, platform @AC-19 CHANGE, wording sites

**Status**: `pending`
**Service**: `docs/` + `services/xstockstrat-ui/CLAUDE.md`
**Files**:
- `docs/patterns/ui-ux-governance.md` — modify
- `services/xstockstrat-ui/CLAUDE.md` — modify
- `docs/patterns/docker-build.md` — modify
- `docs/runbooks/infra-cost-reduction.md` — modify
- `CLAUDE.md` — modify
- `docs/launch-pdfs/infra-ci.md` — modify
- `docs/sdd/business-rules/platform.feature` — modify

**Reviewers**: none

**Codebase Evidence**:
- `docs/patterns/ui-ux-governance.md` sections:
  - §1 at `:22-55`; `:24-27` says the `@theme inline` block in `globals.css` is the single source and the values are the `:root` properties; `:46-49` is the dark-only rule.
  - §5 at `:132-162`, items 1–7, plus the Step 4 fence.
  - §7 at `:178-187` ("no visual-regression/snapshot baseline").
  - §9 at `:231-246`, rows a–f.
- `services/xstockstrat-ui/CLAUDE.md`: § Styling `:23`, § Docker Build Pattern `:87`, § PWA & Push Notifications `:319`.
- Root `CLAUDE.md:345`: "Squash breaks git ancestry: `main-dev` stays permanently "ahead" of `main` …".
- `docs/launch-pdfs/infra-ci.md:163`: "`main-dev` would stay permanently "ahead" of `main`".
- `docs/sdd/business-rules/platform.feature:1164-1169` `@AC-19 @FR-7 @feature-279` "A manual run redeploys an already-built SHA".
- `docs/patterns/docker-build.md:86` (Services: xstockstrat-ui section).
- `docs/runbooks/infra-cost-reduction.md` holds the prod-up/staging-up lifecycle prose (`:45-59`).

**TDD**: `N/A (docs only)`

**Covers**: —

**Instructions**:
1. `ui-ux-governance.md`:
   - **§1:** `:root` values are per theme in `src/styles/themes/{staging,production}.css`, selected at build time by `UI_THEME`. `@theme inline` stays the single mapping. Both themes are dark-only.
   - **§5 item 8:** the WCAG baseline (4.5:1 text, 3:1 non-text) and the pair set it applies to. Keep the Step 4 sentence (`frozen per feature 307 FR-3`) and the fence byte-identical; Step 5 asserts both.
   - **§7:** a scoped exception for the 3 `e2e/theme/` aria goldens.
   - **§9 row g:** staging contrast shortfalls → §5.
   - **§9 row h:** the palette utilities still in use (`badge.tsx:25-26`, `alert.tsx:15,17`, `PerformanceDashboard.tsx:120`, `screener/page.tsx:568`, `StatTile.tsx:28`).
   - **The trap**, written without any literal utility or palette-var name (design.md S11 trap wording rule): a hardcoded colour in emitted CSS within ±1 sRGB / ±0.01 α of a theme-specific token of either theme fails every build.
2. `services/xstockstrat-ui/CLAUDE.md`:
   - **Styling:**
     - per-theme `:root` in `src/styles/themes/`;
     - checks (a)–(c) chained into `pnpm build`;
     - the `source('..')` scan scope with the two `@source not` lines;
     - the trap;
     - the Turbopack note (a Next 16/Turbopack switch needs `turbopack.resolveAlias`);
     - the shadcn re-apply line from design.md S11, verbatim.
   - **Docker:** `ARG UI_THEME` and `LABEL io.xstockstrat.ui-theme`.
   - **PWA:** the manifest is served by `src/app/manifest.webmanifest/route.ts`, or by the Step 3 fallback.
3. `docs/patterns/docker-build.md`: the UI `ARG UI_THEME` / label. `docs/runbooks/infra-cost-reduction.md`: prod-up/staging-up refuse an image whose theme label differs from the target.
4. Root `CLAUDE.md:345` and `docs/launch-pdfs/infra-ci.md:163`: replace "permanently ahead" with the ancestry reason, as in Step 17.
5. `platform.feature:1164-1169`: rename the scenario to "A manual run redeploys an already-built SHA whose UI theme label matches the target environment". Add a `Given` that the `xstockstrat-ui:98c78d3` image carries `io.xstockstrat.ui-theme="staging"`, and an in-file note `# Changed by @feature-307 (ui-env-themed-bundles), operator-signed 2026-11-10`. Keep `@AC-19 @FR-7 @feature-279`.

**Verification**:
1. `npx markdownlint-cli2 --config .markdownlint.yaml "**/CLAUDE.md"` (the markdown-lint job).
2. `./scripts/check-context-map.sh`.
3. `cd services/xstockstrat-ui && pnpm run test:unit` (AC-17 still parses the §5 fence and finds the frozen sentence).
4. `cd services/xstockstrat-ui && NEXT_DISABLE_STANDALONE=1 pnpm build && NEXT_DISABLE_STANDALONE=1 UI_THEME=production pnpm build` pass. CLAUDE.md is outside the `source('..')` scan.
5. `grep -rn "permanently" CLAUDE.md docs/launch-pdfs/infra-ci.md .github/workflows/promote.yml .claude/skills/promote/SKILL.md .github/PULL_REQUEST_TEMPLATE/promotion.md` returns no output.
6. `cd services/xstockstrat-ui && pnpm run lint`.
7. Coverage: docs-only step; no coverage threshold applies.

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._

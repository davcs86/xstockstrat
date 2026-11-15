# Implementation Spec: chart-series-palette

**Status**: `pending`
**Created**: 2026-11-15
**Feature**: `docs/roadmap/features/342-chart-series-palette/feature.md`
**Total Steps**: 10
**Feature Branch**: `feature/chart-series-palette`

---

## Execution Summary

The order is `design.md` § Build order (D-12). Steps 1-2 build the colour-vision helper and its 49
reference tests, because every later floor check depends on that maths being right. Step 3 runs the
feasibility gate on the 12 candidate values and records them in `context.md` before any token is
written; a gate failure stops the feature and escalates to the operator. Steps 4-5 land the tokens,
`SERIES_PALETTE` and the theme tests as one unit. Steps 6-7 add the slot helper, Steps 8-9 wire
`IndicatorPanels.tsx` and prove it in the browser on both theme builds, and Step 10 updates the docs.

**Consumer surface (C-14).** UI only: `/trader` symbol page `/trader/positions/[symbol]`. Steps 8-9
land the change there. No Agent tool, backend service, proto, config key or migration is touched;
that is the product spec's decision, not an omission. It is an existing route, so C-10 nav
registration does not apply.

**Open objections adopted here.** `design.md` left O-25, O-26 and O-27 as direction for this spec.
All three are adopted: the collision line and the `nonSharedTokens` export are in Steps 1 and 3
(O-25), the candidate origin and the reorder rule are in Step 3 (O-26), and the worst-pair failure
message is in Step 5 (O-27). O-24 is not closed; see Step Dependencies.

## Scenario Coverage (C-15)

| Scenario | Covered by |
|---|---|
| `@AC-1` Both themes define twelve series colors | Step 5 |
| `@AC-2` Five series across four indicators get five different colors | Step 7 (slot order), Step 9 (drawn lines) |
| `@AC-3` Each legend swatch matches its line | Step 9 |
| `@AC-4` Every series color meets the contrast floor in both themes | Step 5 |
| `@AC-5` Series colors stay distinguishable for normal and red-green color-blind vision | Step 5 (floors), Step 2 (the maths the floors rest on) |
| `@AC-6` A thirteenth series reuses the first color | Step 7 (slot wrap), Step 9 (drawn lines) |

## Step Dependencies

- **Before Step 1: O-24 is still open.** `design.md` asks the operator to confirm, at the
  `/sdd-spec` gate, that the relayed "Confirmed" (floors, D-27) and "Agreed" (approval) answered
  this feature's questions. This run could not confirm it: the relayed request again holds
  unlabeled answers for a multi-feature batch, and the question text was not available. Put the
  question to the operator at `/sdd-execute`'s Phase-2 confirmation. If either answer belonged to a
  peer feature, D-27/D-28, the FR-4 and @AC-5 amendments and Steps 3 and 5 reopen.
- Step 2 requires Step 1: the tests load `colorVision.cjs`. Step 2 [test] covers Step 1 [service].
- Step 3 requires Steps 1-2: the gate calls `pairDistances` and the exported `nonSharedTokens`, and
  its numbers mean nothing until the 49 reference tests pass.
- Steps 4+5 land together: Step 4 adds 12 tokens to `staging.css`, which fails the byte-identical
  pin at `themes.test.ts:102-104` until Step 5 splits it, and Step 5 imports `SERIES_PALETTE`,
  which Step 4 creates (`step-constraints.md` §C: a pinned resource changes with the step that
  repoints its pins; a test references a symbol the companion creates). One consumer surface (ui).
- Steps 4+5 require Step 3: the token bytes are copied from the Step 3 `context.md` entry.
- Step 6 requires Step 4: `seriesSlots` imports `SERIES_PALETTE`. Step 7 [test] covers Step 6
  [service].
- Step 8 requires Steps 4 and 6. Step 9 [test] covers Step 8 [service] and requires Step 7 (the two
  fixtures).
- Step 10 requires Steps 4-9: it documents what landed.
- **Peer overlap (rebase only, no hard dependency).** Peer feature 341 (`fix-indicator-pane-warmup`)
  also modifies `src/components/trader/IndicatorPanels.tsx`, `src/lib/indicatorChart.ts`,
  `src/lib/indicatorChart.test.ts`, `e2e/trader/position-detail.spec.ts` and
  `e2e/fixtures/INVENTORY.md` (its spec, on its own branch, `:532,577,580,678,680,722,760-761`; that
  list is provisional until 341 lands). No migration, proto field or config key collides. Whichever
  feature merges second rebases Steps 6-9's files by hand; `merge-order.md` has no row for either
  feature, and adding one is the operator's decision.
- No deferred consumer surface.

## Verification conventions

- **cwd.** Every Verification item is a fresh shell at the repo root. Items for the UI package start
  with `cd services/xstockstrat-ui &&`.
- **Line anchors** are against `feature/chart-series-palette@88bb165fb`. Earlier steps shift them;
  locate each edit by the quoted content.
- **E2E** runs through `python3 scripts/run-e2e.py <args>` (built image, CI mode), never host
  `pnpm test:e2e`, which starts `pnpm dev` (`playwright.config.ts:128-133`). If Docker is not
  available, use the scoped fallback in `fails.md:981` and record it in the Deviation Log; the
  integration PR's CI run is then the deciding signal.
- **Tailwind scan.** `src/lib/seriesPalette.ts`, `src/lib/indicatorChart.ts` and
  `IndicatorPanels.tsx` are scanned (`globals.css:1,5-6`). No step writes an `rgb(` literal, an
  `oklch(`/`hsl(`/hex literal or a palette-utility-shaped string into them (`fails.md:3983`,
  `noColorLiterals.test.ts:8`). The 12 colour values live only in the two theme files, the Step 3
  command and `context.md`.
- **UI lint gate** (step-constraints §B): `cd services/xstockstrat-ui && pnpm run lint && pnpm exec tsc --noEmit`.
  `tsconfig.json:21` includes `**/*.ts`, so `tsc` compiles tests and `e2e/` too.
- **Coverage.** `vitest.config.ts:25,29-33` scopes coverage to `src/lib/**` at 40%.
  `src/styles/**` is outside it.

---

### Step 1 — service: colour-vision helper and the `nonSharedTokens` export

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/styles/themes/colorVision.cjs` — create
- `services/xstockstrat-ui/src/styles/themes/checkThemeBundle.cjs` — modify

**Reviewers**: Service owner — `xstockstrat-ui` — Trading UI correctness, analytics display accuracy

**Codebase Evidence**:
- **Not found** — no CIEDE2000 or colour-vision simulation exists: `grep -rn "ciede\|deuteranop\|protanop" services/xstockstrat-ui/src services/xstockstrat-ui/e2e` returns nothing (recon.md:90). `colorVision.cjs` is created from scratch.
- `src/styles/themes/uiTheme.cjs:269` — `function cssColorToSrgb(text, where = 'input')` returns `{r,g,b}` in 0–255 (clamped, unrounded) and `a`; `:285-286` parses `rgb(r g b)`. Exported at `:343-354`.
- `src/styles/themes/uiTheme.cjs:244-245` — `toByte` clamps to 0..1 before scaling; `gamma` is the sRGB encode. `:319-323` holds the sRGB decode (`s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4`) inside `relativeLuminance`; neither `gamma` nor the decode is exported.
- `src/styles/themes/checkThemeBundle.cjs:59-73` — `function nonSharedTokens(themeTokens)` takes `{ staging: Map, production: Map }` and returns `[{ theme, name, color }]`; `:193` is `module.exports = { checkBundle, loadSources, main };`.
- `src/styles/themes/checkThemeBundle.test.ts:11` destructures only `checkBundle` and `loadSources`, so adding an export breaks no caller.
- `.eslintrc.json:34` — the `*.cjs` override that lets these files use `require`.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Create `src/styles/themes/colorVision.cjs` in the style of `uiTheme.cjs` (`'use strict'`, CommonJS). It requires `cssColorToSrgb` from `./uiTheme.cjs` and exports exactly `{ MACHADO, simulate, toLab, ciede2000, pairDistances }`:
   - `MACHADO` — `{ deuteranopia, protanopia }`, each a 3×3 row-major matrix: the severity-1.0 matrices of Machado, Oliveira and Fernandes, "A Physiologically-based Model for Simulation of Color Vision Deficiency", IEEE TVCG 15(6), 2009.
   - `simulate(srgb, sim)` — `srgb` is `{r,g,b}` in 0–255, `sim` is `'normal' | 'deuteranopia' | 'protanopia'`. `'normal'` returns the input. Otherwise: decode each channel to linear light, multiply by `MACHADO[sim]`, clamp each linear channel to 0..1, encode, and return `{r,g,b}` in 0–255 **unrounded** (D-20). There is no other clamp and no byte rounding.
   - `toLab(srgb)` — sRGB decode, the sRGB (D65) RGB→XYZ matrix, white point equal to that matrix's row sums (D-21), then CIELAB. Returns `[L, a, b]`.
   - `ciede2000(lab1, lab2)` — the CIEDE2000 colour difference with `kL = kC = kH = 1`.
   - `pairDistances(colors, sim)` — `colors` is an array of CSS colour strings. Each goes through `cssColorToSrgb`, then `simulate(…, sim)`, then `toLab` (one path for all three `sim` values). Returns one `{ i, j, adjacent, dE }` per pair with `i < j` (0-based); `adjacent` is true when `j - i === 1` or when `i === 0 && j === colors.length - 1` (the wrap, D-3, D-22).
2. **Published sources — transcribe, do not recall (D-21).** Put the source name beside each constant in a comment of at most 2 lines.
   - RGB→XYZ matrix: Bruce Lindbloom, "RGB/XYZ Matrices", sRGB / D65 row, `http://www.brucelindbloom.com/Eqn_RGB_XYZ_Matrix.html`. This session fetched the page and read: `0.4124564 0.3575761 0.1804375 / 0.2126729 0.7151522 0.0721750 / 0.0193339 0.1191920 0.9503041`.
   - Machado matrices: the paper above, or the authors' page `https://www.inf.ufrgs.br/~oliveira/pubs_files/CVD_Simulation/CVD_Simulation.html`. This session could **not** reach that page (connection reset, twice). The values below are a cross-check only, not the source. Transcribe from the source and compare; if they differ, or if the source cannot be reached, stop and ask the operator (P-03).
     - protanopia: `0.152286 1.052583 -0.204868 / 0.114503 0.786281 0.099216 / -0.003882 -0.048116 1.051998`
     - deuteranopia: `0.367322 0.860646 -0.227968 / 0.280085 0.672501 0.047413 / -0.011820 0.042940 0.968881`
3. The sRGB decode and encode are needed here and are not exported by `uiTheme.cjs` (`gamma` at `:245` is module-private; the decode at `:322` is inline in `relativeLuminance`; neither is in the export list at `:343-354`). Define the two one-line functions locally in `colorVision.cjs`, with the same constants as `uiTheme.cjs:245` and `:322`. Do not edit `uiTheme.cjs`: it is not in this step's **Files**.
4. In `checkThemeBundle.cjs`, change line 193 to `module.exports = { checkBundle, loadSources, main, nonSharedTokens };`. Nothing else in that file changes (D-24, O-25).

**Verification**:
1. `cd services/xstockstrat-ui && node -e 'const cv = require("./src/styles/themes/colorVision.cjs"); const b = require("./src/styles/themes/checkThemeBundle.cjs"); console.log(Object.keys(cv).sort().join(","), typeof b.nonSharedTokens, cv.pairDistances(["rgb(255 0 0)","rgb(0 255 0)","rgb(0 0 255)"], "normal").length)'` prints `MACHADO,ciede2000,pairDistances,simulate,toLab function 3`.
2. `cd services/xstockstrat-ui && pnpm run lint && pnpm exec tsc --noEmit`.
3. `cd services/xstockstrat-ui && pnpm run test:unit` is green (no existing test changes).

---

### Step 2 — test: 49 reference tests for the colour-vision helper

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/styles/themes/colorVision.test.ts` — create

**Reviewers**: Service owner — `xstockstrat-ui` — Trading UI correctness, analytics display accuracy

**Codebase Evidence**:
- `vitest.config.ts:20` — `include: ['src/**/*.test.ts']`; a `.test.cjs` would never be collected (R-7).
- `src/styles/themes/themes.test.ts:2,6-7` — the loading pattern to copy: `const req = createRequire(import.meta.url); const ui = req('./uiTheme.cjs') as { … }`.
- `globals.css:5` — `@source not "../**/*.test.ts";` so colour literals in this test file are not scanned by Tailwind; `noColorLiterals.test.ts:13` skips `.test.ts` files.

**TDD**: `red-green required`

**Covers**: `AC-5` (the distance and simulation maths the @AC-5 floors in Step 5 rest on)

**Instructions**:
Create `src/styles/themes/colorVision.test.ts`. Load `./colorVision.cjs` and `./uiTheme.cjs` through `createRequire`. It holds reference pins only and **exactly 49 tests** (D-19); the palette floors live in Step 5 (D-17).
1. **34** — `it.each` over the 34 pairs of Sharma, Wu and Dalal (2005), "The CIEDE2000 Color-Difference Formula: Implementation Notes, Supplementary Test Data, and Mathematical Observations", Table 1. Each row is `L1 a1 b1 L2 a2 b2 dE`; assert `ciede2000` matches `dE` to 4 decimals (`toBeCloseTo(dE, 4)`). Transcribe the rows from the authors' data file `https://hajim.rochester.edu/ece/sites/gsharma/ciede2000/dataNprograms/ciede2000testdata.txt`. This session fetched it: 34 rows, sha256 `44aebb39107128328add54fbef5ac8ee89909e50508f448a1580adea2058a4b8`, first row `50.0000 2.6772 -79.7751 50.0000 0.0000 -82.7485 2.0425`, last row `2.0776 0.0795 -1.1350 0.9033 -0.0636 -0.5514 0.9082`.
2. **2** — one test per CVD type: `MACHADO[type]` equals the published matrix element-wise (`toEqual`).
3. **4** — white and black fixed points: `simulate` of `rgb(255 255 255)` and of `rgb(0 0 0)` under each CVD type returns the input within 0.01 per channel.
4. **4** — sRGB→Lab pins, tolerance 0.01 per component, for `rgb(255 0 0)`, `rgb(0 255 0)`, `rgb(0 0 255)` and `rgb(128 128 128)`. Take the four Lab triples from the same named source as the matrix: Bruce Lindbloom's CIE Color Calculator (`http://www.brucelindbloom.com/index.html?ColorCalculator.html`, RGB model sRGB, reference white D65, no adaptation). This session could not operate that calculator. Cross-check values, computed here from the transcribed matrix with the row-sum white: `53.2408 80.0925 67.2032`, `87.7347 -86.1827 83.1793`, `32.2970 79.1875 -107.8602`, `53.5850 0.0000 0.0000`. If the source disagrees by more than 0.01, stop and ask the operator.
5. **4** — coloured simulation pins: `rgb(255 0 0)` and `rgb(128 0 0)` under each CVD type, tolerance 0.01 per channel. The expected value is built in the test from the published matrix **column** for red: linear red (`1` for 255, the sRGB decode of `128/255` for 128) times the first column, clamped to 0..1, encoded (D-19, R-12). Cross-check values from this session: deuteranopia `163.22 144.28 0.00` and `79.54 69.55 0.00`; protanopia `108.79 95.03 0.00` and `50.81 43.55 0.00`.
6. **1** — `pairDistances` shape pin: for 4 colours it returns 6 rows, each with `i < j`; `adjacent` is true for `(0,1)`, `(1,2)`, `(2,3)` and the wrap `(0,3)`, and false for `(0,2)` and `(1,3)`; every `dE` is a finite number greater than 0 for distinct colours.

C-12: this file uses no domain object (colours and published constants only), so the test-data inventory does not apply.

**Verification**:
1. RED (before Step 1's file exists, or with `ciede2000` stubbed to return 0): `cd services/xstockstrat-ui && pnpm exec vitest run src/styles/themes/colorVision.test.ts` fails.
2. GREEN: the same command prints `Tests  49 passed (49)`. **Any other collected count fails the step**, including 0 (D-11).
3. `cd services/xstockstrat-ui && pnpm run lint && pnpm exec tsc --noEmit`.
4. Coverage: `colorVision.cjs` is outside `src/lib/**`, so no threshold applies; these 49 tests are its only guard. `cd services/xstockstrat-ui && pnpm run test:coverage` stays ≥ 40%.

---

### Step 3 — docs: feasibility gate on the 12 candidate values

**Status**: `pending`
**Service**: `docs/roadmap/features/342-chart-series-palette/`
**Files**:
- `docs/roadmap/features/342-chart-series-palette/context.md` — modify (one appended entry)

**Reviewers**: none

**Codebase Evidence**:
- `src/styles/themes/uiTheme.cjs:202` `parseRootTokens`, `:306` `themeCssPath`, `:328` `contrastRatio`, `:334` `colorsEqual` (accepts a string or an `{r,g,b,a}` object, `:317`), all exported at `:343-354`.
- `src/styles/themes/staging.css:2,4` — `--background: oklch(0.147 0.004 49.25)`, `--card: oklch(0.216 0.006 56.043)`. `production.css:2,4` — `--background: oklch(0.16 0.022 262)`, `--card: oklch(0.22 0.026 262)`.
- `checkThemeBundle.cjs:59-73` — `nonSharedTokens`, exported by Step 1.
- **Candidate origin (O-26).** The 12 values below were chosen in the `/sdd-spec` session of 2026-11-15 by a throwaway probe: a farthest-point pick over a 15-step sRGB grid, restricted to contrast ≥ 3.3 on all four surfaces and CIELAB chroma ≥ 28, then ordered so adjacent entries are far apart under both simulations. The probe was not committed (R-16 keeps a search script out of the repo). On the probe's own maths the set gave: deuteranopia adjacent 28.51, protanopia adjacent 28.88, deuteranopia non-adjacent 11.94, protanopia non-adjacent 11.73, normal all pairs 22.96, contrast minima 3.37 / 3.80 / 3.34 / 3.74, collisions 0. Those numbers are advisory. The probe used the cross-check matrices of Step 1, not transcribed ones, so **this step's output is the authority**.

**TDD**: `N/A (docs — a recorded gate run; no code changes)`

**Covers**: —

**Instructions**:
1. From `services/xstockstrat-ui/`, run this command verbatim (D-23, D-29, O-25):

   ```bash
   cd services/xstockstrat-ui && node -e '
   const fs = require("fs");
   const ui = require("./src/styles/themes/uiTheme.cjs");
   const cv = require("./src/styles/themes/colorVision.cjs");
   const { nonSharedTokens } = require("./src/styles/themes/checkThemeBundle.cjs");
   const C = ["rgb(135 240 30)", "rgb(165 0 255)", "rgb(255 150 165)", "rgb(165 90 0)", "rgb(60 210 255)", "rgb(0 135 105)", "rgb(105 240 210)", "rgb(165 150 0)", "rgb(15 120 150)", "rgb(240 225 165)", "rgb(210 45 90)", "rgb(120 150 255)"];
   const T = {};
   for (const t of ["staging", "production"]) T[t] = ui.parseRootTokens(fs.readFileSync(ui.themeCssPath(t), "utf8"));
   const min = (xs) => Math.min(...xs);
   const dist = (sim, adjacent) => min(cv.pairDistances(C, sim).filter((p) => adjacent === null || p.adjacent === adjacent).map((p) => p.dE));
   const rows = [
     ["deuteranopia adjacent", dist("deuteranopia", true), 10],
     ["protanopia adjacent", dist("protanopia", true), 10],
     ["deuteranopia non-adjacent", dist("deuteranopia", false), 5],
     ["protanopia non-adjacent", dist("protanopia", false), 5],
     ["normal all pairs", dist("normal", null), 10],
   ];
   for (const t of ["staging", "production"]) for (const s of ["--card", "--background"]) rows.push([t + " contrast vs " + s, min(C.map((c) => ui.contrastRatio(c, T[t].get(s)))), 3]);
   const N = nonSharedTokens(T);
   const collisions = C.filter((c) => N.some((n) => ui.colorsEqual(c, n.color))).length;
   for (const [name, v, floor] of rows) console.log(name + ": " + v.toFixed(2) + " (floor " + floor + ")");
   console.log("collisions with nonSharedTokens: " + collisions + " (must be 0)");
   const pass = rows.every(([, v, floor]) => v >= floor) && collisions === 0;
   console.log(pass ? "GATE PASS" : "GATE FAIL");
   process.exit(pass ? 0 : 1);
   '
   ```

   The gate logic was dry-run in the `/sdd-spec` session against the probe's maths and printed `GATE PASS`; it has not run against the real `colorVision.cjs`, which Step 1 creates.
2. **Pass condition (D-29 plus O-25):** the five distance minima meet their floors, the four contrast minima are ≥ 3.0, and collisions are 0. The command exits 0 and prints `GATE PASS`.
3. **On pass**, append one entry to `context.md` under the heading `### Feasibility gate — series palette values (Step 3)`. It holds the command's full output and, in a fenced block, exactly the bytes of the `C` array literal as run. Step 4 copies the 12 values from that block.
4. **On fail**, reordering the same 12 values is allowed (O-26): edit only the order inside `C`, rerun, and if it passes record the reordered array. Do not change a value, lower a floor, or split the set per theme. If no order passes, stop and escalate to the operator with the printed minima (P-03, D-12). The step stays `blocked`.
5. **Re-pick path (O-25).** If Step 5 or a `pnpm build` later fails on these values after a gate pass, rerun this command with the corrected array and append a new entry headed `### Feasibility gate — series palette values (Step 3, supersedes <date>)`. `context.md` is append-only; the earlier entry stays.

**Verification**:
1. The command above exits 0 and its last line is `GATE PASS`; the collisions line reads `0`.
2. `grep -n "Feasibility gate — series palette values (Step 3)" docs/roadmap/features/342-chart-series-palette/context.md` finds the entry, and the array in its fenced block is byte-identical to the `C` literal that passed.
3. `git status --porcelain services/` is empty: this step writes no service file.

---

### Step 4 — service: `SERIES_PALETTE` and the 12 series tokens in both themes

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/seriesPalette.ts` — create
- `services/xstockstrat-ui/src/styles/themes/staging.css` — modify
- `services/xstockstrat-ui/src/styles/themes/production.css` — modify

**Reviewers**: Service owner — `xstockstrat-ui` — Trading UI correctness, analytics display accuracy

**Codebase Evidence**:
- `staging.css:21-25` and `production.css:21-25` — `--chart-1` … `--chart-5`. `staging.css:26-30` is the `--chart-grid` comment and declaration; `production.css:26` is `--chart-grid`. `--chart-grid` is the precedent for a theme-file token that is not mapped in `@theme` (`globals.css:12-40` has no `--chart-grid` line) and is still emitted.
- `checkThemeBundle.cjs:64` — `if (colorsEqual(stagingValue, productionValue)) continue;` so a token with the same value in both themes is outside check (b). `:107-109` — check (a) requires a literal declaration of every selected-theme token in the emitted CSS.
- `themes.test.ts:99-101` — both themes must declare the same token names.
- `src/components/trader/IndicatorPanels.tsx:16-17` — `SERIES_TOKENS` (5 entries) and `SERIES_FALLBACK = ['teal', 'slateblue', 'goldenrod', 'indianred', 'silver']`: the CSS-named-colour fallback convention to extend (recon.md:45).
- `src/lib/chartColors.ts:10-20` — `CHART_COLOR_TOKENS`; not touched (R-3).
- **Not found** — `grep -rn "seriesPalette\|--series-" services/xstockstrat-ui/src services/xstockstrat-ui/e2e` returns nothing; the module and the token names are new.

**Lands with**: `Step 5`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Create `src/lib/seriesPalette.ts`, data-only (D-4, D-8, D-16, D-18):
   - `export type PaletteEntry = { token: string; fallback: string };`
   - `export const SERIES_PALETTE: readonly PaletteEntry[]` with 12 entries, tokens `--series-1` … `--series-12` in order. Fallbacks are CSS named colours, pairwise distinct and with no alias pair among them: `yellowgreen`, `darkviolet`, `lightpink`, `saddlebrown`, `deepskyblue`, `seagreen`, `aquamarine`, `olive`, `teal`, `khaki`, `crimson`, `cornflowerblue`. A fallback is only the no-DOM path of `resolveChartColor` (`chartColors.ts:44-47`); it does not have to match the token's hue.
   - No `rgb(` literal and no colour value in this file (see Verification conventions). One constraint comment of at most 2 lines: the token list's single source; values live in the theme files.
2. In **both** `staging.css` and `production.css`, add `--series-1` … `--series-12` after the `--chart-grid` declaration and before `--sidebar`. The values are the 12 `rgb(r g b)` strings from the Step 3 `context.md` entry, in order, **byte-identical in the two files** (D-1). Add one comment of at most 2 lines above the block in each file: the values must stay identical in both themes (check (b) exemption, `checkThemeBundle.cjs:64`).
3. Do not touch `--chart-1` … `--chart-5`, `globals.css` (`:root` or `@theme`), or `CHART_COLOR_TOKENS` (R-1, R-3).

**Verification**: runs as one unit with Step 5; see Step 5's Verification. On its own, this step's tree fails `themes.test.ts:102-104` by design.

---

### Step 5 — test: theme pins, contrast rows and the 11 series tests

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/styles/themes/themes.test.ts` — modify
- `services/xstockstrat-ui/src/lib/seriesPalette.test.ts` — create

**Reviewers**: Service owner — `xstockstrat-ui` — Trading UI correctness, analytics display accuracy

**Codebase Evidence**:
- `themes.test.ts:7-12` — the `ui` type cast (add what is used); `:17-18` — `staging` / `production` token maps; `:22-56` — `NOCTURNE`; `:58-60` — `Pair`, `text`, `nonText`; `:62-84` — `PAIRS`, chart rows at `:80-83`; `:85-87` — `ratio`, `label`.
- `themes.test.ts:102-104` — `it('keeps the staging tokens byte-identical to Nocturne (AC-2, FR-3)', () => { expect([...staging.entries()]).toEqual(NOCTURNE); });`
- `themes.test.ts:128-130` — `it.each(PAIRS…)('%s meets the baseline (AC-14)', …)` over `production`; `:150-173` — the staging deviation test computes `PAIRS.filter((p) => ratio(staging, p) < p.min)` and compares it with the governance fence.
- `docs/patterns/ui-ux-governance.md:165-174` — the fence lists 8 pairs; none is a series pair.
- `services/xstockstrat-ui/acceptance/ui-env-themed-bundles.feature:17-22` — feature-307 `@AC-2`, PRESERVE with no wording change (D-13).
- Step 1 exports `nonSharedTokens`; Step 1's `pairDistances` returns `{ i, j, adjacent, dE }`.

**Lands with**: `Step 4`

**TDD**: `red-green required`

**Covers**: `AC-1, AC-4, AC-5`

**Instructions**:
1. In `themes.test.ts`, import `SERIES_PALETTE` from `'../../lib/seriesPalette'` (R-8: do not derive the names here), load `./colorVision.cjs` and `./checkThemeBundle.cjs` through the existing `req`, and derive `const SERIES_TOKENS = SERIES_PALETTE.map((p) => p.token)`.
2. **Split the staging pin** (D-13). Replace the test at `:102-104` with two tests in the same `describe('theme files')`:
   - `'keeps the staging Nocturne tokens byte-identical (AC-2, FR-3)'` — `[...staging.entries()].filter(([k]) => !SERIES_TOKENS.includes(k))` `toEqual(NOCTURNE)`.
   - `'declares exactly the Nocturne tokens plus the 12 series tokens in staging'` — the staging key list equals `[...NOCTURNE.map(([k]) => k), ...SERIES_TOKENS]` as a set (sort both sides).
3. **Extend `PAIRS`** (D-5): after the chart rows at `:80-83`, add `...SERIES_TOKENS.flatMap((t) => [nonText(t.slice(2), 'card'), nonText(t.slice(2), 'background')])`. `ratio` prefixes `--`, so the pair names are `series-N`. The staging deviation test (`:150-173`) must still pass unchanged: no series pair may fall below 3.0.
4. **Add `describe('series palette (feature 342)')` with exactly 11 tests** (D-30):
   - **2** — `it.each` over staging and production: `'%s defines exactly 12 series tokens (AC-1)'` — the keys starting with `--series-` equal `SERIES_TOKENS` in order, and there are 12.
   - **1** — `'keeps every series token equal across themes'` — `colorsEqual(staging.get(t), production.get(t))` for each token (D-9). One constraint comment of at most 2 lines: equal values keep the tokens outside check (b) (`checkThemeBundle.cjs:64`) and keep feature-307 @AC-2 true.
   - **2** — `it.each` over staging and production: `'%s series colours meet 3:1 on card and background (AC-4)'` — every `contrastRatio(token, --card)` and `contrastRatio(token, --background)` is ≥ 3.0 (D-25; the overlap with `PAIRS` is intended).
   - **5** — `it.each` over the five floor rows, titled with `(AC-5)`: `['deuteranopia', true, 10]`, `['protanopia', true, 10]`, `['deuteranopia', false, 5]`, `['protanopia', false, 5]`, `['normal', null, 10]` (`null` = all pairs). Each takes `pairDistances(values, sim)` over the staging values in token order, filters by `adjacent`, finds the row with the smallest `dE`, and asserts it is ≥ the floor. The `expect` message names the worst pair: its `i`, `j`, `dE` (2 decimals) and the simulation (O-27).
   - **1** — `'no series colour equals a theme-specific token'` — for `N = nonSharedTokens({ staging, production })`, no series value is `colorsEqual` to any `n.color` (D-24, R-14).
5. The `@AC-1` clause "the staging values of `--chart-1` through `--chart-5` are unchanged" is covered by the filtered `toEqual(NOCTURNE)` test of item 2 (`NOCTURNE` pins them at `:42-46`). Name `AC-1` in that test's title as well: `'keeps the staging Nocturne tokens byte-identical (AC-2, FR-3; feature 342 AC-1)'`.
6. Create `src/lib/seriesPalette.test.ts` with one test (D-26): `SERIES_PALETTE` has 12 entries, the tokens are `--series-1` … `--series-12` in order, and the 12 fallbacks are pairwise distinct (`new Set(…).size === 12`).

C-12: no domain object is used (theme tokens only), so the test-data inventory does not apply.

**Verification** (the unit: Steps 4 and 5 together, one commit):
1. RED, on the tree before Step 4's edits: `cd services/xstockstrat-ui && pnpm exec vitest run src/styles/themes/themes.test.ts src/lib/seriesPalette.test.ts` fails (the import of `seriesPalette` does not resolve). With Step 4 applied and only the old `:102-104` pin in place, that pin fails. Either is a valid RED; record which was captured.
2. GREEN: `cd services/xstockstrat-ui && pnpm exec vitest run src/styles/themes/themes.test.ts -t "series palette"` reports **11 passed**; any other count fails the step.
3. `cd services/xstockstrat-ui && pnpm run test:unit` is green, including `staging contrast deviations (AC-17)` unchanged and `src/styles/noColorLiterals.test.ts`.
4. `cd services/xstockstrat-ui && git diff feature/chart-series-palette -- src/styles/themes/staging.css | grep -c "^[-+]  --chart-"` prints `0` (the frozen values are untouched).
5. `cd services/xstockstrat-ui && diff <(grep -- "--series-" src/styles/themes/staging.css) <(grep -- "--series-" src/styles/themes/production.css)` prints nothing, and `grep -c -- "--series-" src/styles/themes/staging.css` prints `12`.
6. Both builds pass the theme gate (check (a) needs emitted CSS, `fails.md:1462`): `cd services/xstockstrat-ui && NEXT_DISABLE_STANDALONE=1 pnpm build` and `cd services/xstockstrat-ui && NEXT_DISABLE_STANDALONE=1 UI_THEME=production pnpm build`; each prints `checkThemeBundle: <theme> bundle OK`.
7. `cd services/xstockstrat-ui && grep -n "rgb(" src/lib/seriesPalette.ts` prints nothing.
8. `cd services/xstockstrat-ui && pnpm run lint && pnpm exec tsc --noEmit`, and `pnpm run test:coverage` stays ≥ 40%.
9. If item 2, 3 or 6 fails on the token values, follow Step 3's re-pick path; do not adjust a floor.

---

### Step 6 — service: `isChartable` and `seriesSlots` in `indicatorChart.ts`

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/indicatorChart.ts` — modify
- `services/xstockstrat-ui/src/components/trader/IndicatorPanels.tsx` — modify

**Reviewers**: Service owner — `xstockstrat-ui` — Trading UI correctness, analytics display accuracy

**Codebase Evidence**:
- `IndicatorPanels.tsx:19-21` — `function isChartable(c: ComponentSeries): boolean { return !c.error && c.series.length > 0; }`; its only caller is `:62` `const chartable = components.filter(isChartable);` (`grep -rn "isChartable" services/xstockstrat-ui/src` → those two lines only).
- `IndicatorPanels.tsx:7` — `import { toLineData } from '@/lib/indicatorChart';`
- `src/lib/indicatorChart.ts:7-14` — the module's convention of minimal structural shapes (`ProtoTime`, `IndicatorValueLike`) instead of importing proto types; `:27` `toLineData`, `:44` `normalizeAscendingUnique`.
- `packages/proto/analysis/v1/analysis.proto:819-827` — `ComponentSeries { ref_name, kind, repeated NamedSeries series, string error }`.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. In `src/lib/indicatorChart.ts`, import `SERIES_PALETTE` and `type PaletteEntry` from `./seriesPalette`, and add:
   - `export interface ChartableComponent { error?: string; series: readonly unknown[] }` — a structural shape, following `ProtoTime` at `:7-9`.
   - `export function isChartable(c: ChartableComponent): boolean` — the body moved unchanged from `IndicatorPanels.tsx:20`.
   - `export function seriesSlots(components: readonly ChartableComponent[]): PaletteEntry[][]` — one row per component, in input order. A non-chartable component gets `[]` and consumes no index. A chartable one gets one entry per series: `SERIES_PALETTE[n % SERIES_PALETTE.length]`, where `n` is a running count across the whole input (D-2, D-8, D-16).
2. In `IndicatorPanels.tsx`, delete the local `isChartable` (`:19-21`) and change `:7` to import `isChartable` alongside `toLineData`. Line 62 stays as it is (D-15, R-9). Nothing else in the component changes in this step; `SERIES_TOKENS` / `SERIES_FALLBACK` stay until Step 8.
3. No colour literal in either file.

**Verification**:
1. `cd services/xstockstrat-ui && grep -rn "function isChartable" src` shows exactly one definition, in `src/lib/indicatorChart.ts`.
2. `cd services/xstockstrat-ui && pnpm run lint && pnpm exec tsc --noEmit`.
3. `cd services/xstockstrat-ui && pnpm run test:unit` is green.

---

### Step 7 — test: slot assignment tests and the two indicator fixtures

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/indicatorChart.test.ts` — modify
- `services/xstockstrat-ui/e2e/fixtures/indicatorSeries.ts` — modify
- `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md` — modify

**Reviewers**: Service owner — `xstockstrat-ui` — Trading UI correctness, analytics display accuracy

**Codebase Evidence**:
- `src/lib/indicatorChart.test.ts:2` — `import { INDICATOR_SERIES_AAPL } from '../../e2e/fixtures/indicatorSeries';` (a vitest already imports this fixture module).
- `e2e/fixtures/indicatorSeries.ts:16-20` — helpers `T`, `GAP`, `V`; `:22-42` — `INDICATOR_SERIES_AAPL`: `macd` with 3 series, then `brokenformula` with `series: []` and a non-empty `error`.
- `e2e/fixtures/INVENTORY.md:57` — the `Indicator series (feature 125, FR-6)` row; `e2e/fixtures/indicatorSeries.ts:14` says to update it when the file changes.
- `grep -rn "LYFT\|dip_buyer_vol_stop\|series_palette_13" services/xstockstrat-ui/e2e services/xstockstrat-ui/src` returns nothing: no id collision (D-7).

**TDD**: `red-green required`

**Covers**: `AC-2, AC-6`

**Instructions**:
1. In `e2e/fixtures/indicatorSeries.ts`, add two exports beside `INDICATOR_SERIES_AAPL`, each an array of components in the `ComponentSeries` shape used at `:25-40` (`refName`, `kind: 1`, `error: ''`, `series`), with two real points per series (`V(…)`, no gaps), since the mock serves two bars (`e2e/mock-backend.ts:174-207`):
   - `INDICATOR_COMPONENTS_DIP_BUYER_VOL_STOP` — four components in this order: `rsi` [`value`], `px` [`value`], `sma200` [`value`], `vts` [`stop_line`, `value`] (the @AC-2 set: 5 series).
   - `INDICATOR_COMPONENTS_PALETTE_13` — 13 components `sma1` … `sma13`, each with one series `value` (the @AC-6 set).
   Extend the file's header comment by at most 2 lines naming the two sets.
2. In `e2e/fixtures/INVENTORY.md`, add one row per new fixture below `:57`, in the same five-column form: domain, symbol and what it holds, module, shape source `xstockstrat.analysis.v1.ComponentSeries`, consumers. For this step the consumer is `src/lib/indicatorChart.test.ts`; Step 9 adds the mock and the e2e.
3. In `src/lib/indicatorChart.test.ts`, add `describe('seriesSlots')` with **exactly 4 tests**, importing the fixtures and `SERIES_PALETTE`:
   - `(AC-2)` — for `INDICATOR_COMPONENTS_DIP_BUYER_VOL_STOP`, the flattened slots are `SERIES_PALETTE[0..4]` in order, the 5 tokens are distinct, and the two `vts` slots differ.
   - `(AC-6)` — for `INDICATOR_COMPONENTS_PALETTE_13`, slot 13 equals slot 1 (`SERIES_PALETTE[0]`) and slots 1-12 have 12 distinct tokens.
   - a failed component gets `[]` and consumes no index — for `INDICATOR_SERIES_AAPL.components`, the rows are `SERIES_PALETTE[0..2]` then `[]`; and with the failed component placed first, the next component still starts at `SERIES_PALETTE[0]`.
   - `isChartable` — true for a component with series and no error, false for one with an `error`, false for one with `series: []`.
4. C-12: the two fixtures are inventory fixtures with catalog rows; the reordered-components case is a `[...FIXTURE]` rearrangement (a scenario one-off, exempt).

**Verification**:
1. RED, before Step 6: `cd services/xstockstrat-ui && pnpm exec vitest run src/lib/indicatorChart.test.ts` fails on the missing `seriesSlots` export.
2. GREEN: `cd services/xstockstrat-ui && pnpm exec vitest run src/lib/indicatorChart.test.ts -t "seriesSlots"` reports **4 passed**.
3. `cd services/xstockstrat-ui && grep -n "from '../../e2e/fixtures/indicatorSeries'" src/lib/indicatorChart.test.ts` shows the fixture import, and `grep -c "INDICATOR_COMPONENTS_" e2e/fixtures/INVENTORY.md` prints at least `2`.
4. `cd services/xstockstrat-ui && pnpm run lint && pnpm exec tsc --noEmit`, and `pnpm run test:coverage` stays ≥ 40% (`src/lib/**`).

---

### Step 8 — service: whole-chart colours and the line-colour seam in `IndicatorPanels`

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/trader/IndicatorPanels.tsx` — modify

**Reviewers**: Service owner — `xstockstrat-ui` — Trading UI correctness, analytics display accuracy

**Codebase Evidence**:
- `IndicatorPanels.tsx:16-17` — `SERIES_TOKENS`, `SERIES_FALLBACK` (to delete).
- `:62` — `const chartable = components.filter(isChartable);`; `:79` — the only use that must remain: `INDICATOR_PANE_HEIGHT * chartable.length`.
- `:92-106` — the draw loop over `chartable`; `:95` is the bug: `resolveChartColor(SERIES_TOKENS[si % 5], SERIES_FALLBACK[si % 5])` with the per-component `si`; `:96-100` `chart.addSeries(LineSeries, { color, … }, paneIndex)`; `:103` `labels.set(line, \`${comp.refName}.${s.name}\`)`.
- `:135-139` — cleanup: `cancelled = true;` then `if (!chart) return;`. `:153` — effect deps `[components, times, chartRef, containerRef]`.
- `:170-201` — the legend maps over all `components`; `:183-184` `data-series-count` / `data-series`; `:192-195` the swatch `<span … style={{ background: \`var(${SERIES_TOKENS[si % 5]})\` }} />`, the second copy of the bug.
- `src/lib/chartColors.ts:43-48` — `resolveChartColor(varName, fallback)`; returns the fallback silently when the token is empty (`:46`).
- `src/app/trader/positions/[symbol]/page.tsx:1348-1353` — the only render site; `components={series!.components}` comes from query data, so its reference is stable across renders (D-14).
- `package.json:47` — `lightweight-charts` `5.2.1`; `:52` — `react` `^18.3.1`.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Delete `SERIES_TOKENS` and `SERIES_FALLBACK` (`:15-17`, with their comment).
2. Compute the slots once per `components`: `const slots = useMemo(() => seriesSlots(components), [components]);` (import `useMemo`, and `seriesSlots` from `@/lib/indicatorChart`). Add `slots` to the effect deps.
3. Add state `const [lineColors, setLineColors] = useState<Map<string, string>>(new Map());`.
4. Draw loop (`:92-106`): iterate `components` with its index `ci`; skip a component for which `isChartable` is false (it gets no pane and `paneIndex` does not advance). For each series `si`, take `const { token, fallback } = slots[ci][si];` and `const color = resolveChartColor(token, fallback);`. Every line colour still goes through `resolveChartColor` (`fails.md:1462`). After `chart.addSeries(…)`, record `line.options().color` under the key `` `${comp.refName}.${s.name}` `` in a local `Map` (D-6, R-5). After the loop, if not cancelled, call `setLineColors` with that map.
5. Cleanup: call `setLineColors(new Map())` right after `cancelled = true;` and before `if (!chart) return;` (D-14), so a stale colour cannot survive a strategy switch.
6. Legend (`:170-201`): map with the component index (`components.map((comp, ci) => …)`). The swatch background becomes `` `var(${slots[ci][si].token})` `` and the swatch gains `data-line-color={lineColors.get(`${comp.refName}.${s.name}`)}` (absent until the line is drawn), following the `data-series*` seam at `:183-184` (R-6: no hidden node).
7. Line 62 and line 79 stay (D-15). No colour literal is added. Comments state constraints only, at most 2 lines.

**Verification**:
1. `cd services/xstockstrat-ui && grep -n "SERIES_TOKENS\|SERIES_FALLBACK\|% 5" src/components/trader/IndicatorPanels.tsx` prints nothing.
2. `cd services/xstockstrat-ui && grep -n "resolveChartColor(token, fallback)\|data-line-color\|line.options().color" src/components/trader/IndicatorPanels.tsx` shows all three.
3. `cd services/xstockstrat-ui && pnpm run lint && pnpm exec tsc --noEmit && pnpm run test:unit`.
4. The existing panel e2e still passes: `python3 scripts/run-e2e.py e2e/trader/position-detail.spec.ts --grep "indicator"` (the AAPL test at `e2e/trader/position-detail.spec.ts:473`).
5. This step adds no unit test of its own. Its red-green pair is Step 9's Verification items 1-3 (Step 9 [test] covers Step 8 [service]); record that RED and GREEN against both steps.

---

### Step 9 — test: LYFT mock branch, browser e2e for lines and swatches, both theme builds

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/mock-backend.ts` — modify
- `services/xstockstrat-ui/e2e/trader/position-detail.spec.ts` — modify
- `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md` — modify

**Reviewers**: Service owner — `xstockstrat-ui` — Trading UI correctness, analytics display accuracy

**Codebase Evidence**:
- `e2e/mock-backend.ts:99` — `import { INDICATOR_SERIES_AAPL } from './fixtures/indicatorSeries';`; `:1417-1422` — `async getIndicatorSeries(req) { if (req.symbol === 'AAPL') { return INDICATOR_SERIES_AAPL; } return { times: req.times, components: [] }; }`.
- `packages/proto/analysis/v1/analysis.proto:803-811` — the request carries `strategy_id` and `symbol`, so the mock can branch on `req.strategyId`.
- `e2e/mock-backend.ts:1378-1389` — `getStrategy` returns one `sma_fast` component for any id, so the page's `hasComponents` gate (`page.tsx:1321-1323`) opens; `:229-239` — `assertStrategyOwner` only gates ids in `A_OWNED_STRATEGY_IDS` (`:132-135`), so the two new ids pass.
- `e2e/mock-backend.ts:137,174-207` — `mockDailyBars` returns two bars for any symbol other than `CAPR`, so LYFT has closes and times.
- `src/app/trader/positions/[symbol]/page.tsx:178-179` — `urlStrategy = searchParams?.get('strategy')` feeds `effectiveStrategyId`.
- `e2e/trader/position-detail.spec.ts:473-514` — the existing FR-6 panel test: `addAuthCookie(page)`, `getByTestId('indicator-panels')` with a 30 s timeout, `getByTestId('indicator-panel')`, `.tv-lightweight-charts`. `:2` imports `addAuthCookie` from `'../helpers/auth'` (C-12 auth helper).
- `IndicatorPanels.tsx:186,196` — the eyebrow renders `comp.refName`, then each series renders `{s.name}`; "sma200 value" is eyebrow plus series name (recon.md:89).

**TDD**: `red-green required`

**Covers**: `AC-2, AC-3, AC-6`

**Instructions**:
1. `e2e/mock-backend.ts`: import the two Step 7 fixtures on the `:99` import line. In `getIndicatorSeries`, add one LYFT branch beside the AAPL branch, which stays byte-identical (D-7): for `req.symbol === 'LYFT'`, return `{ times: req.times, components }` where `components` is `INDICATOR_COMPONENTS_PALETTE_13` when `req.strategyId === 'series_palette_13'` and `INDICATOR_COMPONENTS_DIP_BUYER_VOL_STOP` otherwise. `getStrategy` and the bars mock do not change.
2. `e2e/fixtures/INVENTORY.md`: add `e2e/mock-backend.ts` (`getIndicatorSeries`, LYFT branch) and `e2e/trader/position-detail.spec.ts` to the consumers of the two Step 7 rows.
3. `e2e/trader/position-detail.spec.ts`: add three tests after the FR-6 panel test (`:473-514`), each starting with `addAuthCookie(page)`. Titles carry `(feature 342 @AC-N)` so `--grep "feature 342"` selects them. Shared helpers, local to the spec:
   - a panel locator by reference name: `page.getByRole('main').getByTestId('indicator-panel').filter({ has: page.getByText(<refName>, { exact: true }) })` (exact, so `sma1` does not match `sma10`);
   - the swatch of a series: the panel's `[data-line-color]` element at the index of the series name in the panel's `data-series` list;
   - `channels(text)`: the first three integers of an `rgb(…)` / `rgba(…)` string, so colours compare by numeric channels, not by string (lightweight-charts may normalise the string).
   Each test waits for `.tv-lightweight-charts` and for every swatch to carry `data-line-color` (the attribute appears only after the draw).
   - **`@AC-2`** — `page.goto('/trader/positions/LYFT?strategy=dip_buyer_vol_stop')`. Collect the 5 swatches in set order (`rsi.value`, `px.value`, `sma200.value`, `vts.stop_line`, `vts.value`). For each, `channels(data-line-color)` equals `channels(getComputedStyle(swatch).backgroundColor)` (D-26: this fails on a silent fallback). The 5 line colours are pairwise different, and `vts.stop_line` differs from `vts.value`. Order: swatch `k`'s computed background equals the page's computed `--series-k` (read `getComputedStyle(document.documentElement).getPropertyValue('--series-' + k)` and compare channels), for `k` = 1..5.
   - **`@AC-3`** — same URL. The `sma200` panel's `value` swatch and the `vts` panel's `stop_line` swatch each have a computed background whose channels equal their own `data-line-color` (the line side comes from `line.options().color`, R-4).
   - **`@AC-6`** — `page.goto('/trader/positions/LYFT?strategy=series_palette_13')`. 13 panels render. `sma13`'s line colour equals `sma1`'s; the line colours of `sma1` … `sma12` are pairwise different; each of the 13 swatches matches its own line as in `@AC-2`.
4. C-12: domain data comes from the Step 7 fixtures through the mock; auth from `e2e/helpers/auth.ts`; the spec declares no inline domain literal. The two strategy ids in the URLs are scenario sentinels (exempt).

**Verification**:
1. RED, with Step 9's files in place and Step 8's component change taken out. Step 8 is already committed when this step runs, so restore the pre-Step-8 component into the working tree first: `git checkout <Step 7 commit> -- services/xstockstrat-ui/src/components/trader/IndicatorPanels.tsx`. Then `python3 scripts/run-e2e.py e2e/trader/position-detail.spec.ts --grep "feature 342"` fails (no `data-line-color`; five series share `--chart-1`). Put the component back with `git checkout HEAD -- services/xstockstrat-ui/src/components/trader/IndicatorPanels.tsx` and confirm `git status --porcelain services/xstockstrat-ui/src/components` is empty before the GREEN runs. Do not use `git stash` (the stash stack is shared across worktrees).
2. GREEN on the staging bundle (the runner's default `UI_THEME`, `Dockerfile.e2e:18`): the same command passes, 3 tests.
3. GREEN on the production bundle: `DOCKER_BUILDKIT=1 docker build --build-arg UI_THEME=production -f Dockerfile.e2e -t xstockstrat-e2e:prod . && docker run --rm xstockstrat-e2e:prod e2e/trader/position-detail.spec.ts --grep "feature 342"` passes, 3 tests. The trailing arguments reach Playwright: `Dockerfile.e2e:127` is `ENTRYPOINT ["pnpm", "test:e2e"]` and `package.json:15` is `"test:e2e": "playwright test"`, the same path `scripts/run-e2e.py:111` uses. `run-e2e.py` has no build-arg pass-through, which is why this item calls `docker build` directly. Behind an egress proxy, add `--secret id=proxy_ca,src=<CA bundle>` to the build, as `run-e2e.py:87-90` does (`Dockerfile.e2e:35-39`).
4. No regression in the file or the theme suite: `python3 scripts/run-e2e.py e2e/trader/position-detail.spec.ts e2e/theme/` passes.
5. Both builds pass the theme gate after the wiring (design build order 6; both stay): `cd services/xstockstrat-ui && NEXT_DISABLE_STANDALONE=1 pnpm build` and `cd services/xstockstrat-ui && NEXT_DISABLE_STANDALONE=1 UI_THEME=production pnpm build`, each printing the checker OK line.
6. `cd services/xstockstrat-ui && grep -n "from './fixtures/indicatorSeries'" e2e/mock-backend.ts` shows the fixture import and `grep -n "helpers/auth" e2e/trader/position-detail.spec.ts` shows the auth helper; `INVENTORY.md` lists the new consumers.
7. `cd services/xstockstrat-ui && pnpm run lint && pnpm exec tsc --noEmit`.
8. Coverage: e2e only; no threshold applies to it. `cd services/xstockstrat-ui && pnpm run test:coverage` stays ≥ 40%.

---

### Step 10 — docs: series palette in the governance doc and the service `CLAUDE.md`

**Status**: `pending`
**Service**: `docs/patterns/`, `services/xstockstrat-ui/`
**Files**:
- `docs/patterns/ui-ux-governance.md` — modify
- `services/xstockstrat-ui/CLAUDE.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- `docs/patterns/ui-ux-governance.md:44-46` — "**Charts** consume `--chart-1`…`--chart-5` and the dedicated gridline token `--chart-grid` … via `src/lib/chartColors.ts`. Do not hand-pick chart colors."
- `docs/patterns/ui-ux-governance.md:158-164` — §5 item 8, the contrast baseline, ending "`chart-1`…`chart-5` on `card` and `background`. The production theme meets all of them (`src/styles/themes/themes.test.ts`, AC-14)."
- `docs/patterns/ui-ux-governance.md:165-174` — the `307:staging-contrast-deviations` fence, parsed by `themes.test.ts:139-173`. It must not change.
- `services/xstockstrat-ui/CLAUDE.md:20-37` — § Styling; `:28-36` the per-environment theme bundle bullet and "The trap".
- `services/xstockstrat-ui/acceptance/ui-env-themed-bundles.feature:17` — the feature-307 `@AC-2` title "Staging build compiles exactly the Nocturne palette".

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:
1. `ui-ux-governance.md` §2 (`:44-46`): add that indicator series on the symbol page take colours from the 12 `--series-1`…`--series-12` tokens through `SERIES_PALETTE` (`src/lib/seriesPalette.ts`) and `seriesSlots` (`src/lib/indicatorChart.ts`), by position across the whole chart, wrapping after 12; `--chart-1`…`--chart-5` stay for the other charts.
2. `ui-ux-governance.md` §5 item 8 (`:158-164`): add `series-1`…`series-12` on `card` and `background` to the non-text pairs, and state that they meet 3:1 in **both** themes and carry the same values in both. State the distinguishability floors (CIEDE2000: deuteranopia and protanopia adjacent ≥ 10 including the 12→1 wrap, other pairs ≥ 5; normal vision every pair ≥ 10) and that `themes.test.ts` enforces them. Do not edit inside the fence at `:165-174`.
3. `services/xstockstrat-ui/CLAUDE.md` § Styling, under the theme-bundle bullet: one sub-bullet stating the behaviour-shaping constraints only — the `--series-N` values must be byte-identical in `staging.css` and `production.css` (that keeps them outside check (b)); a change of values reruns the feasibility gate (this spec, Step 3) and the series tests; no colour literal goes into `src/lib/seriesPalette.ts`.
4. Do not change the feature-307 `@AC-2` title or any durable `acceptance/*.feature` text: its Then-clauses still hold (D-13), and a wording change needs its own operator sign-off. Record in `context.md` that the title no longer describes the whole staging file.
5. No colour value is written into either doc.

**Verification**:
1. `npx markdownlint-cli2 --config .markdownlint.yaml "**/CLAUDE.md"` passes.
2. `cd services/xstockstrat-ui && pnpm exec vitest run src/styles/themes/themes.test.ts` is green (the AC-17 fence still parses and matches).
3. `grep -n "series-1" docs/patterns/ui-ux-governance.md services/xstockstrat-ui/CLAUDE.md` shows the new text in both files, and `git diff feature/chart-series-palette -- docs/patterns/ui-ux-governance.md | grep -c "^[-+]- [a-z0-9-]*/[a-z0-9-]*: "` prints `0` (no fence line changed).

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._

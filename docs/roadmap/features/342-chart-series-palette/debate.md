# Debate Register: chart-series-palette

**State**: in-debate
**Mode**: full
**Rounds run**: 3 (round numbers continue across runs; the mode's 2–5 / 1 bounds count this run only)

## Rounds

| Round | Date | Run by | +D | +R | O closed | +O | Petitions | Progress |
|---|---|---|---|---|---|---|---|---|
| 1 | 2026-11-15 | /sdd-batch | 5 | 4 | 0 | 8 | 0 | yes |
| 2 | 2026-11-15 | /sdd-batch | 5 | 3 | 5 | 7 | 0 | yes |
| 3 | 2026-11-15 | /sdd-batch | 7 | 2 | 7 | 8 | 0 | yes |

## Settled Decisions

<!-- Status: settled → superseded by D-m (only after a user-approved REOPEN) -->
| ID | Round | Decision | Evidence | Status |
|---|---|---|---|---|
| D-1 | 1 | The 12 `--series-N` tokens are declared in both theme files with identical `rgb()` values, not in the `globals.css` `:root` and not mapped into Tailwind `@theme`. | Proposal r1 and adversary r1 concur: AC-1 wording 'each theme defines'; `checkThemeBundle.cjs:64` skips shared-value tokens; `uiTheme.cjs:244` clamps oklch. | settled |
| D-2 | 1 | One slot array from `seriesSlots`, computed once in `IndicatorPanels`, drives both the line colors and the legend swatches, using a whole-chart running index mod 12. | Operator decision (unique across the whole chart, swatches match lines); `IndicatorPanels.tsx:62`, `:93-95`, `:170`, `:194`; adversary r1 accepts. | settled |
| D-3 | 1 | The 12->1 wrap pair counts as adjacent for the AC-5 CVD check. | Product-spec FR-5 cycling; adversary r1 agrees the stricter reading is right. | settled |
| D-4 | 1 | `SERIES_PALETTE` is the single source of the token list; the tokens are not added to `CHART_COLOR_TOKENS`. | `chartColors.ts:10-20` has no runtime reader; adversary r1 concurs. | settled |
| D-5 | 1 | AC-4 is enforced by extending `PAIRS` with series-vs-card and series-vs-background pairs, plus an explicit staging >=3.0 assertion; the deviation fence is unchanged. | `themes.test.ts:62-84`, `:128-130`, `:150-173`; adversary r1 did not contest. | settled |
| D-6 | 2 | The line-side seam is `line.options().color`, read after `addSeries`, stored per `${refName}.${name}` key and rendered as `data-line-color` on the legend swatch; AC-2, AC-3 and AC-6 e2e assert against it by numeric channels. | Proposal r2 (`IndicatorPanels.tsx:93-104`, `:192-195`); adversary r2 rates O-1 closable and prefers `options()` over recording the argument. | settled |
| D-7 | 2 | The e2e enters through `/trader/positions/LYFT?strategy=<id>` with ids `dip_buyer_vol_stop` and `series_palette_13`; the `getStrategy` and bars mocks are unchanged; one LYFT branch is added in `getIndicatorSeries` beside the byte-identical AAPL branch; two fixtures get INVENTORY rows. | Adversary r2 verified `page.tsx:178-179`, `e2e/mock-backend.ts:174-207`, `:1380-1391`, `:1417-1421`, no existing LYFT use, and no id collision (`e2e/fixtures/strategies.ts:18-69`, `mock-backend.ts:132-135`). | settled |
| D-8 | 2 | `isChartable` and `seriesSlots` live in `src/lib/indicatorChart.ts`; `src/lib/seriesPalette.ts` holds only the `SERIES_PALETTE` data; `seriesSlots` returns `{token, fallback}` palette entries per component and wraps on `SERIES_PALETTE.length`. | Proposal r2; adversary r2 rates O-5 and O-6 closable (`indicatorChart.ts:27`, `IndicatorPanels.tsx:19-21`, `:95`, `:194`). | settled |
| D-9 | 2 | `themes.test.ts` pins every `--series-N` as `colorsEqual` across staging and production, with a constraint comment naming the `checkThemeBundle.cjs:64` exemption and feature-307 @AC-2. | Proposal r2; adversary r2 rates O-4 closable and notes it underpins the @AC-2 PRESERVE argument. | settled |
| D-10 | 2 | `colorVision.cjs` lives in `src/styles/themes/`, reuses `cssColorToSrgb`, applies Machado-2009 severity-1.0 matrices in linear light, and is pinned by the 34 Sharma (2005) pairs, both matrices element-wise, and white/black fixed points. | Proposal r2 (`globals.css:6`, `uiTheme.cjs:269`, `themes.test.ts:6-7`); adversary r2 accepts the content and contests only the test file extension. | settled |
| D-11 | 3 | The CVD helper's test file is `src/styles/themes/colorVision.test.ts`, loaded via `createRequire`, holding reference pins only; its step Verification names an exact expected test count, and a collected count of 0 fails the step. | Proposal r3 (`vitest.config.ts:20`, `themes.test.ts:2,6-7`); adversary r3 rates O-9 closable. The count itself is to be restated under O-17. | settled |
| D-12 | 3 | Build order: `colorVision.cjs` and its pins first, then the candidate-set feasibility gate (escalate to the operator on failure, no per-theme fallback, no loosened floor), then tokens and `themes.test.ts`, then lib, wiring and e2e, both-theme builds, docs. | Proposal r3; adversary r3 rates O-10 closable once `seriesPalette.ts` moves into the tokens step (tracked as O-16). | settled |
| D-13 | 3 | Feature-307 @AC-2 is PRESERVE with no wording change; `themes.test.ts:102-104` splits into a filtered `toEqual(NOCTURNE)` check and a key-set check (NOCTURNE keys plus exactly the 12 `SERIES_PALETTE` tokens). | Proposal r3 (`acceptance/ui-env-themed-bundles.feature:17-22`); adversary r3 confirms the Then-clauses at `:21-22` hold and rates O-11 closable. | settled |
| D-14 | 3 | `setLineColors(new Map())` runs in the draw-effect cleanup right after `cancelled = true` and before the `if (!chart) return` at `IndicatorPanels.tsx:139`. | Proposal r3; adversary r3 finds it sound on React `^18.3.1` (`package.json:52`) with `components` stable from query data (`page.tsx:1349`). | settled |
| D-15 | 3 | `IndicatorPanels.tsx:62` stays `components.filter(isChartable)` and is used only for canvas sizing at `:79`; the draw loop and the legend both index the same `slots[ci][si]`. | Proposal r3 (`IndicatorPanels.tsx:62,79,170`, `e2e/fixtures/indicatorSeries.ts:35-40`); adversary r3 rates O-14 closable. | settled |
| D-16 | 3 | The slot type is `PaletteEntry = { token; fallback }` with no `index` field; `seriesSlots` returns `PaletteEntry[][]`. | Proposal r3; adversary r3 rates O-15 closable. | settled |
| D-17 | 3 | The palette floor assertions live in the `themes.test.ts` series describe, not in `colorVision.test.ts`. | Proposal r3 (`themes.test.ts:17-18` already parses the theme tokens); adversary r3 did not contest the placement. | settled |

## Rejected Alternatives (locked)

<!-- Status: locked → reopened @ round N (user, context.md <ISO>) -->
| ID | Round | Alternative | Why rejected | Status |
|---|---|---|---|---|
| R-1 | 1 | Declaring the series tokens once in the unlayered `globals.css` `:root`. | Breaks the AC-1 wording 'each theme defines' and rules out production-specific values later; both sides reject it. | locked |
| R-2 | 1 | Dropping the 12->1 wrap pair from the AC-5 adjacency check. | FR-5 cycling makes series 12 and 13 real neighbours. | locked |
| R-3 | 1 | Adding `--series-N` to `CHART_COLOR_TOKENS`. | The list has no runtime reader, so it would duplicate `SERIES_PALETTE`. | locked |
| R-4 | 1 | Verifying AC-3 by comparing the swatch with a canvas read-back of the same token. | It never observes the line, so it cannot fail on a line/swatch mismatch (C-15/C-08). | locked |
| R-5 | 2 | Recording the `color` variable passed to `addSeries` as the line-side evidence instead of `line.options().color`. | It observes the argument, not what the library holds; both sides keep `options()`. | locked |
| R-6 | 2 | A hidden draw-loop DOM node carrying the per-series line color. | Test-only markup, separated from the legend; the swatch attribute is leaner. | locked |
| R-7 | 2 | `colorVision.test.cjs` as the CVD helper's test file. | vitest collects only `src/**/*.test.ts` (`vitest.config.ts:20`), so it would never run. | locked |
| R-8 | 3 | Deriving the `--series-1..12` token names inside `themes.test.ts` instead of importing `SERIES_PALETTE`. | It duplicates the list D-4 makes the single source; adversary r3 raised and rejected it in favour of moving `seriesPalette.ts` into the tokens step. | locked |
| R-9 | 3 | Deriving the canvas-sizing count from `slots.filter(r => r.length).length`. | The existing `chartable` filter at `IndicatorPanels.tsx:62` already does the job unchanged; proposer r3 rejected it and adversary r3 accepted the kept line. | locked |

## Objections

<!-- Status: open → closed @ round N (<how>) | waived @ round N (user) | reopened @ round N (user) -->
| ID | Round | Objection | Blocking | Status |
|---|---|---|---|---|
| O-1 | 1 | O-1 [C-15/C-08] AC-3 and the e2e side of AC-2/AC-6 must assert against the color actually passed to `addSeries` (a line-side seam), not a token read-back or the legend's `data-series-token`. | yes | closed @ round 2 (`line.options().color` is recorded per series key and rendered as `data-line-color`; AC-2, AC-3 and AC-6 assert against it, so a line/swatch slot mismatch fails. Adversary r2 agrees.) |
| O-2 | 1 | O-2 [C-01/C-12] The LYFT e2e plumbing is underspecified: entry URLs and strategy ids, `getStrategy` mock, LYFT bars path, both fixtures with INVENTORY rows, and the AAPL branch kept byte-identical. | yes | closed @ round 2 (Proposal r2 names the entry URLs, strategy ids, unchanged `getStrategy` and bars mocks, both fixtures with INVENTORY rows and the byte-identical AAPL branch; adversary r2 verified each against the code.) |
| O-3 | 1 | O-3 Adjacent-only CVD checking is weaker than the operator's 'color-blind-safe'. Add a non-adjacent floor under simulation or get explicit operator acceptance of adjacent-only. | no | open |
| O-4 | 1 | O-4 Add a `themes.test.ts` assertion that every `--series-N` is equal across themes; it is load-bearing for the check (b) exemption and feature-307 @AC-2. | no | closed @ round 2 (A cross-theme `colorsEqual` assertion for every `--series-N` is added to `themes.test.ts` with a constraint comment.) |
| O-5 | 1 | O-5 The `seriesSlots` return shape is inconsistent (`number[][]` vs `p.token`/`p.fallback`). Return palette entries. | no | closed @ round 2 (`seriesSlots` returns palette entries per component, so no call site re-indexes. The unused `index` field is tracked separately as O-15.) |
| O-6 | 1 | O-6 [C-18] Put `isChartable` and `seriesSlots` in `src/lib/indicatorChart.ts`, not in the palette module. | no | closed @ round 2 (`isChartable` and `seriesSlots` are placed in `src/lib/indicatorChart.ts`; `seriesPalette.ts` is data-only.) |
| O-7 | 1 | O-7 [C-08] `colorVision.cjs` needs published reference tests (Sharma 2005 CIEDE2000 pairs, Machado severity-1.0 matrices, linear-light application stated). | no | open |
| O-8 | 1 | O-8 [P-03/C-16] Make candidate-set feasibility the first gate of step 1; on failure, escalate instead of falling back to per-theme values. | no | closed @ round 3 (Candidate-set feasibility is step 2, ahead of any token change, and a failure escalates to the operator with no per-theme fallback or loosened floor. Gate reproducibility is tracked separately as O-22.) |
| O-9 | 2 | O-9 [C-08] Commit to `src/styles/themes/colorVision.test.ts` (loaded via `createRequire`); a `.test.cjs` is never collected by vitest (`vitest.config.ts:20`). The step Verification must name the expected test count. | yes | closed @ round 3 (Proposal r3 commits to `src/styles/themes/colorVision.test.ts` loaded via `createRequire`, with an exact test count in the step Verification. Adversary r3 agrees.) |
| O-10 | 2 | O-10 [C-08/C-01] Fix the build order: `colorVision.cjs` and its reference pins first, then the candidate-set feasibility gate, then tokens and `themes.test.ts`. | no | closed @ round 3 (Order is now helper and pins, then the gate, then tokens and `themes.test.ts`. The remaining step-3 import of `seriesPalette.ts` is tracked as O-16.) |
| O-11 | 2 | O-11 [C-16] State the feature-307 @AC-2 classification explicitly (PRESERVE on the Then-clauses, or EXTEND with a wording change and operator sign-off); the title says 'exactly' and the pin at `themes.test.ts:102-104` is relaxed. | no | closed @ round 3 (Feature-307 @AC-2 is stated as PRESERVE with no wording change; the split pin keeps the Nocturne check and adds a key-set check. Adversary r3 confirms the Then-clauses hold.) |
| O-12 | 2 | O-12 [C-11] Add an all-pairs normal-vision CIEDE2000 floor and put both floor numbers (CVD non-adjacent and normal-vision) to the operator with O-3. | no | open |
| O-13 | 2 | O-13 [C-15] Reset `lineColors` to an empty Map in the draw-effect cleanup (`IndicatorPanels.tsx:135-152`) so a stale `data-line-color` cannot survive a strategy switch. | no | closed @ round 3 (`setLineColors(new Map())` is placed in cleanup before the `:139` early return. Adversary r3 finds it sound.) |
| O-14 | 2 | O-14 [C-01] Name how the canvas-sizing count at `IndicatorPanels.tsx:79` is derived once the draw loop iterates `components` with slot rows. | no | closed @ round 3 (`IndicatorPanels.tsx:62` keeps `components.filter(isChartable)` for sizing at `:79` only.) |
| O-15 | 2 | O-15 [C-18] Drop `SeriesSlot.index` or name its consumer. | no | closed @ round 3 (`index` is dropped; the slot type is `PaletteEntry`.) |
| O-16 | 3 | O-16 [C-01/C-08] Step 3's `themes.test.ts` key-set test imports `SERIES_PALETTE`, but `src/lib/seriesPalette.ts` is created in step 4. Move the data-only `seriesPalette.ts` into step 3. | yes | open |
| O-17 | 3 | O-17 [C-08] The reference pins leave sRGB->linear->XYZ(D65)->CIELAB and the decode->matrix->encode pipeline unchecked; white/black fixed points pass in gamma or linear space. Add sRGB->Lab pins, one non-achromatic simulation pin per CVD type from a published severity-1.0 source, a stated clamp policy, and a restated exact test count. Keeps O-7 open. | yes | open |
| O-18 | 3 | O-18 [C-15/C-11] The CVD non-adjacent >= 5 and normal-vision all-pairs >= 10 floors trace to no @AC (`acceptance.feature:30-34` states adjacent >= 10 only) and their sign-off is not recorded (`context.md:14`). Confirm with the user, record in `context.md`, extend FR-4 and @AC-5. Keeps O-3 and O-12 open. | yes | open |
| O-19 | 3 | O-19 [C-08] AC-2 and AC-6 e2e must compare each `data-line-color` with the swatch's computed `background`, not only with each other, because `resolveChartColor` falls back silently (`chartColors.ts:46`); add a vitest that the 12 fallbacks are pairwise distinct. | no | open |
| O-20 | 3 | O-20 [C-16] Add a test that no `--series-N` value is `colorsEqual` to any token whose value differs between themes (`checkThemeBundle.cjs:59-73`; `themes.test.ts:131-136` checks only `oklch`). | no | open |
| O-21 | 3 | O-21 [C-15] Series rows in `PAIRS` report under feature 307's '(AC-14)' label (`themes.test.ts:128`). Label them @AC-4 or add a production counterpart to the staging contrast test. | no | open |
| O-22 | 3 | O-22 [C-08/F-05] Give the step-2 feasibility gate a named, re-runnable command and state that the 12 candidate values go verbatim into `context.md` for step 3 to copy byte-for-byte. | no | open |
| O-23 | 3 | O-23 [C-18] Replace the five near-identical floor loops with one `pairDistances(colors, sim)` helper in `colorVision.cjs` used through `it.each`. | no | open |

## Reopen Petitions

<!-- Verdict: dropped (evidence not new — already on record at <ID>) | pending user | user reopened | user declined -->
| ID | Round | Target | New evidence | Verdict |
|---|---|---|---|---|

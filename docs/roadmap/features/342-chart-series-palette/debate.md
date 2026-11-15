# Debate Register: chart-series-palette

**State**: in-debate
**Mode**: full
**Rounds run**: 2 (round numbers continue across runs; the mode's 2–5 / 1 bounds count this run only)

## Rounds

| Round | Date | Run by | +D | +R | O closed | +O | Petitions | Progress |
|---|---|---|---|---|---|---|---|---|
| 1 | 2026-11-15 | /sdd-batch | 5 | 4 | 0 | 8 | 0 | yes |
| 2 | 2026-11-15 | /sdd-batch | 5 | 3 | 5 | 7 | 0 | yes |

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
| O-8 | 1 | O-8 [P-03/C-16] Make candidate-set feasibility the first gate of step 1; on failure, escalate instead of falling back to per-theme values. | no | open |
| O-9 | 2 | O-9 [C-08] Commit to `src/styles/themes/colorVision.test.ts` (loaded via `createRequire`); a `.test.cjs` is never collected by vitest (`vitest.config.ts:20`). The step Verification must name the expected test count. | yes | open |
| O-10 | 2 | O-10 [C-08/C-01] Fix the build order: `colorVision.cjs` and its reference pins first, then the candidate-set feasibility gate, then tokens and `themes.test.ts`. | no | open |
| O-11 | 2 | O-11 [C-16] State the feature-307 @AC-2 classification explicitly (PRESERVE on the Then-clauses, or EXTEND with a wording change and operator sign-off); the title says 'exactly' and the pin at `themes.test.ts:102-104` is relaxed. | no | open |
| O-12 | 2 | O-12 [C-11] Add an all-pairs normal-vision CIEDE2000 floor and put both floor numbers (CVD non-adjacent and normal-vision) to the operator with O-3. | no | open |
| O-13 | 2 | O-13 [C-15] Reset `lineColors` to an empty Map in the draw-effect cleanup (`IndicatorPanels.tsx:135-152`) so a stale `data-line-color` cannot survive a strategy switch. | no | open |
| O-14 | 2 | O-14 [C-01] Name how the canvas-sizing count at `IndicatorPanels.tsx:79` is derived once the draw loop iterates `components` with slot rows. | no | open |
| O-15 | 2 | O-15 [C-18] Drop `SeriesSlot.index` or name its consumer. | no | open |

## Reopen Petitions

<!-- Verdict: dropped (evidence not new — already on record at <ID>) | pending user | user reopened | user declined -->
| ID | Round | Target | New evidence | Verdict |
|---|---|---|---|---|

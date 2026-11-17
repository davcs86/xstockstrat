# Design: chart-series-palette

**Created**: 2026-11-15
**Rounds**: 5 (full; termination: approved)
**Approved by**: user @ 2026-11-15 (design gate, round 5, verbatim "Agreed"; no blocking objection open, Floor clear)
**Grounded in**: recon.md
**Debate register**: debate.md (D-1..D-30 settled, R-1..R-16 locked, O-24..O-27 open and non-blocking)

---

## Chosen Approach

Paths are relative to `services/xstockstrat-ui/` unless they start with `docs/`. Each `recon.md:N` is the
recon line that grounds the claim; the code `path:line` beside it is the one recon recorded.

**Consumer surface (C-14).** UI only: the `/trader` symbol page `/trader/positions/[symbol]`, which renders
`<IndicatorPanels>` at `src/app/trader/positions/[symbol]/page.tsx:1348` (recon.md:19). The change reaches
it through the indicator chart lines and the Indicators legend swatches. No Agent tool, no backend service,
no proto, config key or migration (recon.md:71-75).

### Thresholds (one outcome, D-27)

All distances are CIEDE2000.

| Condition | Pairs | Floor |
|---|---|---|
| Deuteranopia simulation | adjacent, including the 12->1 wrap (D-3) | >= 10 |
| Protanopia simulation | adjacent, including the 12->1 wrap | >= 10 |
| Deuteranopia simulation | every other pair | >= 5 |
| Protanopia simulation | every other pair | >= 5 |
| Normal vision | every pair | >= 10 |
| Contrast vs `--card` and `--background`, each theme | each of the 12 colors | >= 3.0 |

The same 12 values are used in both themes (D-1). There are no conditional rows (R-10).

### Tokens (D-1, D-4, D-9, D-13)

- Twelve tokens `--series-1`..`--series-12` are declared in both `src/styles/themes/staging.css` and
  `production.css`, after the chart tokens at `:21-25` (recon.md:33), with identical in-gamut `rgb(r g b)`
  values. They are not declared in the `globals.css` `:root` and not mapped into Tailwind `@theme`
  (recon.md:38, recon.md:80). `--chart-1..5` are untouched.
- Identical values keep the tokens outside build-gate check (b): `nonSharedTokens` skips a token whose
  value is the same in both themes (`checkThemeBundle.cjs:59-73`, recon.md:35, recon.md:84). In-gamut
  `rgb()` keeps the CSS swatch and the canvas line byte-equal (recon.md:87).
- `src/lib/seriesPalette.ts` is new and data-only: `SERIES_PALETTE`, 12 `{ token, fallback }` entries
  with CSS named-color fallbacks (recon.md:45). It is the single source of the token list; nothing is
  added to `CHART_COLOR_TOKENS` (`src/lib/chartColors.ts:10-20`, recon.md:32, recon.md:93). It holds no
  `rgb()` literal or utility-shaped string, because Tailwind scans it (recon.md:86).

### Color-vision helper (D-10, D-11, D-19..D-22)

- `src/styles/themes/colorVision.cjs` is new (no such tooling exists, recon.md:90). It reuses
  `cssColorToSrgb` (`uiTheme.cjs:269`, recon.md:36, recon.md:49), applies the Machado-2009 severity-1.0
  deuteranopia and protanopia matrices in linear light, clamps simulated linear channels to 0..1 before
  encoding, and feeds one `simulate(srgb) -> srgb` path (unrounded) into the same `toLab` as normal vision.
- It exports `pairDistances(colors, sim)` returning `{ i, j, adjacent, dE }` for all pairs; `adjacent`
  covers `|i-j| = 1` plus the wrap.
- `src/styles/themes/colorVision.test.ts` loads it via `createRequire` and holds exactly 49 reference
  tests: 34 Sharma (2005) pairs, 2 Machado matrix pins, 4 white/black fixed points, 4 sRGB->Lab pins,
  4 colored simulation pins, 1 `pairDistances` shape pin. Any other collected count fails the step.
- The Lab pins and the RGB->XYZ matrix come from one named published source, transcribed, not recalled.

### Theme tests (D-5, D-9, D-13, D-17, D-24, D-25, D-30)

- The byte-identical staging pin at `themes.test.ts:102-104` (recon.md:34, recon.md:79) splits into a
  filtered `toEqual(NOCTURNE)` check and a key-set check: NOCTURNE keys plus exactly the 12
  `SERIES_PALETTE` tokens.
- Series-vs-card and series-vs-background rows are added to `PAIRS` (`themes.test.ts:62-84`,
  recon.md:34, recon.md:47); the staging deviation fence (`:139-173`) is unchanged.
- `nonSharedTokens` is added to `module.exports` of `checkThemeBundle.cjs` (`:193`) and reused.
- The series describe holds exactly 11 tests; any other count fails the step:
  - 2: twelve series tokens per theme.
  - 1: every `--series-N` is `colorsEqual` across staging and production (`uiTheme.cjs:334`, recon.md:36).
  - 2: @AC-4 contrast >= 3.0 on card and background, `it.each` over staging and production.
  - 5: @AC-5 floor rows through `pairDistances` `it.each` (the five distance rows of the table above).
  - 1: no `--series-N` is `colorsEqual` to a value-differs token.

### Slot assignment and wiring (D-2, D-6, D-8, D-14, D-15, D-16, D-26)

- `isChartable` moves from `IndicatorPanels.tsx:19-21` (recon.md:22) to `src/lib/indicatorChart.ts`,
  beside a new `seriesSlots(components)` that returns `PaletteEntry[][]`: one row per component, `[]` for
  a non-chartable one, with a whole-chart running index modulo `SERIES_PALETTE.length` (recon.md:46,
  recon.md:50). Four vitest tests cover it.
- `src/components/trader/IndicatorPanels.tsx` computes the slot array once. The draw loop
  (`:93-106`, recon.md:24) and the legend (`:170-201`, recon.md:26) both index the same `slots[ci][si]`,
  which removes the per-component `si % 5` bug at `:95` and `:194` and the index drift in recon.md:88.
  `:62` stays `components.filter(isChartable)` and is used only for canvas sizing (recon.md:23).
- Line colors still go through `resolveChartColor` (`src/lib/chartColors.ts:43`, recon.md:31,
  recon.md:44, recon.md:85). After `addSeries`, `line.options().color` is stored per
  `${refName}.${name}` key (recon.md:25) and rendered as `data-line-color` on the legend swatch,
  following the `data-series*` seam (recon.md:27, recon.md:52). The draw-effect cleanup resets the map.
- `SERIES_TOKENS` and `SERIES_FALLBACK` (`IndicatorPanels.tsx:16-17`, recon.md:21) are deleted.

### e2e (D-7, D-26)

- Entry URLs `/trader/positions/LYFT?strategy=dip_buyer_vol_stop` and `...?strategy=series_palette_13`.
- Two new fixtures in `e2e/fixtures/indicatorSeries.ts`, each with an `e2e/fixtures/INVENTORY.md` row
  (recon.md:39, recon.md:51); one LYFT branch in the `getIndicatorSeries` mock beside the unchanged AAPL
  branch.
- AC-2 and AC-6 compare each `data-line-color` with its swatch's computed background by numeric channels
  and assert pairwise distinctness; AC-3 checks the `sma200 value` and `vts stop_line` swatches
  (recon.md:89). A vitest asserts the 12 fallbacks are pairwise distinct.

### Build order (D-12, D-18, D-23, D-29)

1. `colorVision.cjs` plus its 49 reference tests.
2. Feasibility gate: one verbatim `node -e` command run from `services/xstockstrat-ui/`, embedding the 12
   candidate `rgb(r g b)` literals and reading `--card`/`--background` from both theme files through
   `parseRootTokens` (`uiTheme.cjs:202`, recon.md:36). Pass condition: the five distance minima and the
   four contrast minima of the thresholds table. On pass, one `context.md` entry holds exactly the
   array's bytes. On failure, stop and escalate to the operator: no per-theme fallback, no lowered floor.
3. `seriesPalette.ts`, the tokens in both theme files (bytes copied from `context.md`), and the theme
   tests.
4. `isChartable` and `seriesSlots` in `src/lib/indicatorChart.ts`, with their tests.
5. `IndicatorPanels.tsx` wiring, fixtures, mock and e2e.
6. `pnpm build` with `UI_THEME=staging` and with `UI_THEME=production` (recon.md:81), then the browser
   e2e. Both builds stay.
7. Docs: `docs/patterns/ui-ux-governance.md` §2/§5 and the service `CLAUDE.md` § Styling (recon.md:40,
   recon.md:94).

### Spec amendments made at approval (D-27, D-28)

- `product-spec.md` FR-4, last clause, states the three distance floors.
- `acceptance.feature` @AC-5 is one scenario, "Series colors stay distinguishable for normal and
  red-green color-blind vision", covering the three floors and naming the wrap pair.

### Direction for `/sdd-spec` (open objections, not settled decisions)

Raised by the adversary in round 5 and not answered by the proposer, so they bind nothing yet:

- O-25: add "collisions with `nonSharedTokens` = 0" to the gate output and pass condition; export
  `nonSharedTokens` in step 1 so the gate can require it; if step 3 fails after a gate pass, rerun the
  gate and append a superseding `context.md` entry.
- O-26: name where the 12 candidates come from; reordering the same 12 values is allowed before a gate
  failure is declared.
- O-27: each @AC-5 floor row's failure message names the worst pair's `i`, `j`, `dE` and simulation.

## Rejected Alternatives

- `R-1` Declaring the series tokens once in the unlayered `globals.css` `:root` — rejected because it breaks the AC-1 wording "each theme defines" and rules out production-specific values later.
- `R-2` Dropping the 12->1 wrap pair from the AC-5 adjacency check — rejected because FR-5 cycling makes series 12 and 13 real neighbours.
- `R-3` Adding `--series-N` to `CHART_COLOR_TOKENS` — rejected because the list has no runtime reader, so it would duplicate `SERIES_PALETTE`.
- `R-4` Verifying AC-3 by comparing the swatch with a canvas read-back of the same token — rejected because it never observes the line, so it cannot fail on a line/swatch mismatch (C-15/C-08).
- `R-5` Recording the `color` variable passed to `addSeries` as the line-side evidence — rejected because it observes the argument, not what the library holds; `line.options().color` is kept.
- `R-6` A hidden draw-loop DOM node carrying the per-series line color — rejected because it is test-only markup separated from the legend; the swatch attribute is leaner.
- `R-7` `colorVision.test.cjs` as the helper's test file — rejected because vitest collects only `src/**/*.test.ts` (`vitest.config.ts:20`), so it would never run.
- `R-8` Deriving the `--series-1..12` names inside `themes.test.ts` instead of importing `SERIES_PALETTE` — rejected because it duplicates the list D-4 makes the single source.
- `R-9` Deriving the canvas-sizing count from `slots.filter(r => r.length).length` — rejected because the existing `chartable` filter at `IndicatorPanels.tsx:62` already does the job unchanged.
- `R-10` Carrying the extra floor rows, the gate pass condition and the @AC-5 wording as conditional into the impl-spec — rejected because it hands `/sdd-spec` two specs; the design fixes one outcome.
- `R-11` Reading the relayed "Choose the one with less friction" as adjacent-only and closing O-18 without asking — rejected because the item's subject is unclear, so it is a silent guess (C-11).
- `R-12` Pinning simulation outputs to colour-science's Machado results instead of to published matrix columns — rejected because it adds a second reference to trust; the column pins plus `rgb(128 0 0)` already cover decode, encode, clamp and matrix orientation.
- `R-13` An `ac` field on the `Pair` type to relabel series rows as @AC-4 — rejected because it is more mechanism than a two-row `it.each`.
- `R-14` Re-deriving the `nonSharedTokens` rule inside `themes.test.ts` — rejected because a copy would drift from check (b); exporting the existing function keeps one rule.
- `R-15` A second @AC scenario for the non-adjacent and normal-vision floors instead of rewriting @AC-5 — rejected because it splits FR-4's distinguishability clause across two scenarios.
- `R-16` A search script that picks and orders a passing 12-color set automatically — rejected because it is tooling the task did not ask for (C-18); a named candidate plus allowed reordering covers the need.

Not in the register (considered in round 5, no `R-n`): applying a relayed "Staging is enough" answer as a
scope cut here. It was not applied: its question was unconfirmed for this feature and it conflicts with the
operator decision "in both themes", AC-1 and D-1.

## Open Risks

- [ ] O-24: the answer-to-question mapping is taken from the batch orchestrator. The operator's "Confirmed" (floors) and "Agreed" (approval) both appear verbatim in the relayed requests, but the items are unlabeled across a multi-feature batch and the question text as sent was not available to the writing step — to be confirmed by the operator at the `/sdd-spec` gate; if either answer belonged to a peer feature, D-27/D-28 and this approval reopen.
- [ ] The feasibility gate may fail: one shared 12-value set clearing all five distance floors and 3:1 on two dark cards (`staging.css:4`, `production.css:4`) is tight — step 2; failure escalates to the operator.
- [ ] O-25: until the collision check is in the gate, a gate-passing set can still fail step 3 and both builds after its bytes are in the append-only `context.md` — `/sdd-spec` (steps 1-2).
- [ ] O-26: the origin of the 12 candidates and the reordering rule are unnamed — `/sdd-spec` (step 2).
- [ ] O-27: the five @AC-5 floor rows need a failure message naming the worst pair — `/sdd-spec` (step 3).
- [ ] Pin values (Lab triples, Machado matrices, simulation outputs) must be transcribed from one named source, not from memory (D-21); the source is not yet named — `/sdd-spec` (step 1).
- [ ] `colorVision.cjs` is outside vitest coverage scope (`src/lib/**`); its 49 reference tests are its only guard — step 1.
- [ ] `line.options().color` may be normalized by lightweight-charts v5; the e2e compares numeric channels, not strings — step 5.
- [ ] The cleanup reset relies on `components` being reference-stable across renders (`page.tsx:1349`) — step 5.
- [ ] Check (a) on emitted theme CSS needs a real `pnpm build` for both `UI_THEME` values plus the browser e2e (`fails.md:1462`) — step 6.
- [ ] `seriesPalette.ts` and `indicatorChart.ts` are Tailwind-scanned; an `rgb()` literal or utility-shaped string there could leak into emitted CSS (`fails.md:3983`) — steps 3-4.
- [ ] The feature-307 @AC-2 title ("exactly the Nocturne palette") no longer describes the staging file once the series tokens are added, though its Then-clauses hold — step 7 (docs); a wording change would need its own operator sign-off.

## Constitution Rules Touched

- `C-01` — honored by: every claim above cites `recon.md:N` with the code `path:line` recon recorded; the unnamed candidate source (O-26) is carried as an open risk for `/sdd-spec`, not invented.
- `C-08` — honored by: each code unit has paired tests with exact counts (49 reference tests, 11 series tests, 4 slot tests) where a collected count of 0 fails the step; the gate's missing collision line is open as O-25.
- `C-11` — honored by: story, review, recon and a 5-round full debate precede any code; thresholds were put to the operator rather than guessed (R-11); the mapping caveat is recorded as O-24.
- `C-12` — honored by: the two new e2e fixtures live in `e2e/fixtures/indicatorSeries.ts` with `INVENTORY.md` rows.
- `C-15` — honored by: every floor traces to @AC-4 or @AC-5; @AC-2, @AC-3 and @AC-6 assert against the line-side seam (`data-line-color`), not a token read-back.
- `C-16` — honored by: see Business Rules Touched; the only altered scenario is this feature's own @AC-5 (EXTEND, operator-confirmed).
- `C-18` — honored by: one `SERIES_PALETTE` source, one `pairDistances` helper, the exported `nonSharedTokens` instead of a copy, and no search script (R-16).
- `F-05` — honored: the gate is a re-runnable command whose output is recorded before any token is committed, and both builds plus the browser e2e run before the wiring is called done.
- `P-01` — honored by: the orchestrating skill made every write; proposer and adversary were advisory.
- `P-02` — honored by: proposer and adversary saw only the synthesized state each round.
- `P-03` — honored by: a gate failure escalates to the operator with no per-theme fallback and no lowered floor; unanswered adversary points stay open objections rather than silent decisions.

No Floor breach was raised in any round.

## Business Rules Touched (C-16)

- EXTEND `@AC-5 @feature-342` "Adjacent series colors stay distinguishable for red-green color blindness" (`docs/roadmap/features/342-chart-series-palette/acceptance.feature`) — keeps CVD adjacent >= 10; new cases added: CVD non-adjacent >= 5, normal-vision all pairs >= 10, the 12->1 wrap stated; retitled "Series colors stay distinguishable for normal and red-green color-blind vision". Operator decision: design gate round 4, 2026-11-15, verbatim "Confirmed" to the exact floors (context.md, session 2026-11-15 — sdd-design, "Operator decision — palette floors").
- PRESERVE `@AC-4 @feature-342` "Every series color meets the contrast floor in both themes" (same file) — not regressed by: the @AC-4 `it.each` over both themes and the series rows in `PAIRS`.
- PRESERVE `@AC-2 @feature-307` "Staging build compiles exactly the Nocturne palette" (`services/xstockstrat-ui/acceptance/ui-env-themed-bundles.feature:17-22`) — not regressed by: the filtered `toEqual(NOCTURNE)` check plus the key-set check; the series tokens are in both themes, so none is production-only (D-13). No wording change.
- PRESERVE `@AC-7 @feature-307` "Bundles differ only in theme tokens" (`…/ui-env-themed-bundles.feature:42-43`) — not regressed by: a token-only change with identical series values in both themes and no theme-dependent markup.
- PRESERVE `@AC-17 @feature-307` "Staging contrast shortfalls are recorded, not fixed" (`…/ui-env-themed-bundles.feature:94-99`) — not regressed by: frozen staging values untouched and every series pair >= 3.0, so the deviation fence (`themes.test.ts:139-173`) is unchanged.

No CHANGE line: no existing guarantee is altered.

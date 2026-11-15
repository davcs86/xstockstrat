# Context: chart-series-palette

**Feature**: `docs/roadmap/features/342-chart-series-palette/feature.md`
**Product Spec**: `docs/roadmap/features/342-chart-series-palette/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/342-chart-series-palette/implementation-spec.md`

---

## Session 2026-11-15 — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from an operator report (staging, homelab, with screenshots) and same-day read-only recon.
- Operator decisions (2026-11-15): add a **separate series palette** (do not unfreeze `--chart-1..5`), sized **12**; colors unique across the whole chart; contrast ≥3:1 and color-blind-safe in both themes.
- Interpretation (mine): the operator's "Yes, extend it to 12 colors" answered a question offering replace-frozen vs. separate-set with separate-set recommended; read as accepting the separate set at 12 entries.
- The CIEDE2000 ≥10 threshold in @AC-5 is my proposed measurable form of "color-blind safe"; confirm or adjust in design.
- Recon facts: `IndicatorPanels.tsx:16-17,95` (per-component `si % 5` index), `staging.css:21-25` (grayscale), `ui-ux-governance.md:44,263` (freeze).

## Session 2026-11-15 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Warnings (5):
  - Criterion 2 (FR-4 testability): FR-4 gave no color-blind threshold — **resolved**: the CIEDE2000 ≥ 10 bound from @AC-5 is now stated in FR-4.
  - Criterion 8 (@AC-2 wording): "palette entries 1 through 5" refers to the internal palette index — kept; FR-2 fixes the order, so it is checkable. Design may restate it once token names exist.
  - Criterion 8 (@AC-3 scope): only one swatch was checked — **resolved**: @AC-3 now also checks the "vts stop_line" swatch (guards the per-component index restart).
  - Criterion 8 (@AC-1): the 12 token names are not pinned — accepted, deferred to design (Open Questions).
  - Criterion 11: consumer surface is thin on what changes — accepted; FR-2 and FR-3 cover it, detail at design time.
- Overlap findings: none
- Recommended design depth: quick (single service `xstockstrat-ui`, no proto, no schema change, no overlap finding)

OPERATOR DECISIONS (binding, recorded 2026-11-15):
- Add a separate categorical series palette of 12 colors; do not change the frozen --chart-1..5 staging values.
- Colors are unique across the whole indicator chart, legend swatches match their lines.
- Each color meets at least 3:1 contrast against the chart surface and is color-blind-safe, in both themes.

## Session 2026-11-15 — sdd-batch design gate (round 2)

- `/sdd-design chart-series-palette` full debate halted at its approval gate after round 2 (gate policy: halt). `design.md` is not written and `status.md` stays `spec-ready`. Register: `debate.md` (D-1..D-10 settled, R-1..R-7 locked, O-1/O-2/O-4/O-5/O-6 closed).

### Open Threads

- **Approach (not yet approvable).** 12 `--series-N` tokens with identical `rgb()` values in both theme files (D-1); one `seriesSlots` array in `src/lib/indicatorChart.ts` drives lines and legend swatches with a whole-chart index mod 12 (D-2, D-8); `line.options().color` is surfaced as `data-line-color` on the swatch and asserted by e2e through `/trader/positions/LYFT?strategy=<id>` (D-6, D-7); a new `src/styles/themes/colorVision.cjs` (Machado-2009 matrices, CIEDE2000) backs the AC-4/AC-5 checks in `themes.test.ts` (D-5, D-9, D-10).
- **Strongest open objection — O-9 (blocking, C-08).** The proposal still allows `colorVision.test.cjs`; vitest collects only `src/**/*.test.ts` (`vitest.config.ts:20`), so the reference pins and the AC-5 check would never run with CI green. The next proposal must commit to `src/styles/themes/colorVision.test.ts` loaded via `createRequire` and name the expected test count. O-7 stays open behind it.
- **Operator questions at the gate — O-3 and O-12.** The all-66-pairs CVD floor (CIEDE2000 >= 5 under each simulation) is the proposer's number, and there is no normal-vision distinctness floor yet. Both numbers need the operator's acceptance under the "color-blind-safe" decision.
- **Other open objections (non-blocking).** O-8/O-10 build order (helper and pins before the feasibility gate; stop and escalate on failure); O-11 state the feature-307 @AC-2 classification outright; O-13 reset `lineColors` in the effect cleanup; O-14 name the canvas-sizing count at `IndicatorPanels.tsx:79`; O-15 drop `SeriesSlot.index` or name its consumer.
- **Floor status.** No Floor breaches.
- **Uncovered @AC changes.** None classified as a change: feature-307 @AC-2, feature-307 @AC-7 and @AC-17 (contrast deviation fence) are all PRESERVE, and none is covered by an explicit operator decision. Feature-307 @AC-2 is the one to watch: its title says "exactly the Nocturne palette" and the pin at `themes.test.ts:102-104` is relaxed to a filtered subset (O-11); it becomes EXTEND if the feasibility gate forces per-theme values.
- **Main risk.** A single shared 12-value set that clears 3:1 on both themes plus every CVD and normal-vision floor may not exist; failure is an operator decision (P-03/C-16), not a silent fallback.

```sdd-batch-design-state
{
  "round": 2,
  "synth": {
    "approach": "Round-2 best approach. All paths are under /home/user/xstockstrat/services/xstockstrat-ui unless noted. In this step I checked three things against the code: `vitest.config.ts:20` (`include: ['src/**/*.test.ts']`), `src/styles/themes/themes.test.ts:102-104` (the byte-identical Nocturne pin) and `acceptance/ui-env-themed-bundles.feature:17-22` (feature-307 @AC-2). Every other path:line is carried from the proposal and the adversary, who re-verified the O-2 plumbing.\n\nThe architecture is unchanged from round 1 (D-1..D-5). The items below marked \"adversary fix\" are direction for the next proposer and are not yet committed by the proposal.\n\nBUILD ORDER (adversary fix, O-8 / O-10)\n1. `src/styles/themes/colorVision.cjs` plus its reference pins.\n2. Feasibility gate: run one candidate set of 12 in-gamut `rgb(r g b)` values through the AC-4, AC-5 and O-3 assertions. On failure, stop and escalate to the operator (P-03 / C-16); no silent fallback to per-theme values. The gate still precedes any token or wiring change.\n3. Tokens and the `themes.test.ts` changes.\n4. `src/lib/seriesPalette.ts`, the `src/lib/indicatorChart.ts` additions and their vitest.\n5. `IndicatorPanels.tsx` wiring, fixtures, mock and e2e.\n6. `pnpm build` with `UI_THEME=staging` and `UI_THEME=production`, then the browser e2e.\n7. Docs: `docs/patterns/ui-ux-governance.md:44-46` and `:158-164`, and the service `CLAUDE.md` § Styling.\n\nCVD HELPER (`src/styles/themes/colorVision.cjs`)\n- Reuses `cssColorToSrgb` (`src/styles/themes/uiTheme.cjs:269`).\n- Decodes sRGB to linear light, applies the Machado-2009 severity-1.0 deuteranopia and protanopia matrices, re-encodes, converts to CIELAB (D65) and computes CIEDE2000.\n- The test file must be `src/styles/themes/colorVision.test.ts`, loading the helper through `createRequire` as `themes.test.ts:6-7` does (adversary fix, O-9). A `.test.cjs` is never collected (`vitest.config.ts:20`).\n- Reference pins: all 34 Sharma-Wu-Dalal (2005) CIEDE2000 pairs to 4 decimals; both 3x3 matrices element-wise; white and black fixed under each simulation. Spec authors transcribe the values from the papers. The step's Verification names the expected test count.\n\nGATE AND PALETTE ASSERTIONS\n- At least 3:1 against `--card` and `--background` in both themes.\n- Adjacent CIEDE2000 of 10 or more, including the 12->1 wrap (D-3), under deuteranopia and under protanopia.\n- Non-adjacent floor: all 66 pairs at 5 or more under each simulation. This number is the proposer's pick and is pending operator acceptance (O-3).\n- Normal-vision floor: an all-pairs CIEDE2000 floor (adversary fix, O-12; number to be put to the operator together with O-3). Today the only normal-vision check is `colorsEqual` false, which is a +/-1 sRGB tolerance (`uiTheme.cjs:334`).\n- Suggested starting point for the candidate search: a published CVD-safe categorical set (Okabe-Ito or Tol), lightened for the dark surfaces of both themes.\n\nTOKENS AND THEME TESTS\n- Add `--series-1..12` after `--chart-grid` in `src/styles/themes/staging.css` and `production.css`, identical `rgb()` values in both (D-1). The frozen `--chart-1..5` staging values are untouched.\n- `themes.test.ts:102-104` becomes two checks: staging entries without the `--series-*` keys `toEqual(NOCTURNE)` in order; the staging key set equals the NOCTURNE keys plus exactly the 12 `SERIES_PALETTE` tokens.\n- `PAIRS` (`:80-83`) gains series-vs-card and series-vs-background pairs; a new staging describe asserts 3.0 or more; the fence at `:139-173` is untouched (D-5).\n- New cross-theme pin: every `--series-N` is `colorsEqual` between staging and production, with a 2-line constraint comment (`checkThemeBundle.cjs:64` exemption; feature-307 @AC-2).\n\nSLOT ASSIGNMENT\n- `src/lib/seriesPalette.ts` exports only `SERIES_PALETTE: readonly {token; fallback}[]`, 12 entries with CSS named-color fallbacks, no `rgb()` literals or utility-shaped strings (D-4, `fails.md:3983`).\n- `src/lib/indicatorChart.ts` (beside `toLineData` at `:27`) gains `isChartable` (moved from `IndicatorPanels.tsx:19-21`) and `seriesSlots(components)`, which returns one row of palette entries per component, `[]` for a non-chartable one, with a running index `% SERIES_PALETTE.length`.\n- Drop `SeriesSlot.index` unless a consumer is named (adversary fix, O-15).\n- Vitest: AC-2 five-series order, AC-6 13th series wraps to entry 1, an error component consumes no slot.\n\nWIRING (`src/components/trader/IndicatorPanels.tsx`)\n- `slots = useMemo(() => seriesSlots(components))`, computed once (D-2).\n- Draw loop (`:93-104`): iterate `components` with the slot row, skip non-chartable rows, call `addSeries` with `resolveChartColor(slot.token, slot.fallback)` (`src/lib/chartColors.ts:43`). After `addSeries`, read `line.options().color` into a `Map` keyed `${refName}.${name}`; after the loop, if not cancelled, `setLineColors(map)`.\n- Canvas sizing at `:79` still needs a chartable count. Derive it from `slots` (rows that are not `[]`) or keep `components.filter(isChartable)` for sizing only; the spec names the line (adversary fix, O-14).\n- Effect cleanup (`:135-152`) resets `setLineColors(new Map())` so a stale `data-line-color` cannot survive a strategy switch (adversary fix, O-13).\n- Legend swatch (`:192-195`): `background: var(slot.token)`, `data-testid=\"series-swatch\"`, `data-series-key`, `data-line-color={lineColors.get(key)}`.\n- Delete `SERIES_TOKENS` and `SERIES_FALLBACK` (`:16-17`).\n\nE2E (`e2e/trader/position-detail.spec.ts`)\n- Entry: `/trader/positions/LYFT?strategy=dip_buyer_vol_stop` and `/trader/positions/LYFT?strategy=series_palette_13` (`src/app/trader/positions/[symbol]/page.tsx:178-179`).\n- `getStrategy` mock unchanged (`e2e/mock-backend.ts:1380-1391`); bars unchanged (`mockDailyBars` default branch, `:174-207`, `:711-712`).\n- Fixtures in `e2e/fixtures/indicatorSeries.ts`: `INDICATOR_SERIES_LYFT_DIP_BUYER` (`rsi.value`, `px.value`, `sma200.value`, `vts.stop_line`, `vts.value`) and `INDICATOR_SERIES_LYFT_SMA13` (`sma1..sma13`), reusing `T` and `V` (`:16-20`), each with an `e2e/fixtures/INVENTORY.md` row.\n- Mock: one LYFT branch in `getIndicatorSeries` after `:1418-1420` and before the fallback at `:1421`, discriminating on `req.strategyId`. The AAPL lines and the spec at `:473-514` stay byte-identical.\n- Assertions compare numeric channels, not strings, in case lightweight-charts normalizes the color:\n  - AC-2: five `data-line-color` values pairwise distinct, each equal to the computed `--series-n` for n=1..5 in listed order.\n  - AC-3: for `sma200.value` and `vts.stop_line`, the swatch's computed `backgroundColor` equals its `data-line-color`.\n  - AC-6: `sma13.value` has the line color of `sma1.value`; `sma1..sma12` form a set of 12.",
    "open_objections": [
      {
        "text": "O-9 [C-08] The proposal allows `colorVision.test.cjs` or a `.test.ts`. vitest collects only `src/**/*.test.ts` (`vitest.config.ts:20`, verified), so a `.test.cjs` would never run and the Sharma/Machado pins, the AC-5 adjacency check and the O-3 floor would be missing with CI green. The proposer must commit to `src/styles/themes/colorVision.test.ts` loaded via `createRequire`, and the step Verification must name the expected test count.",
        "blocking": true
      },
      {
        "text": "O-7 [C-08] Stays open until O-9 is answered: the reference tests (34 Sharma pairs, both Machado matrices, white/black fixed points) are adequate in content but are not guaranteed to run as written.",
        "blocking": false
      },
      {
        "text": "O-8 / O-10 [C-08/C-01] The build order contradicts itself: the Step 0 gate is the AC-4/AC-5 test, but `colorVision.cjs` and its reference pins arrive in item 2. Reorder to helper and pins first, then the candidate-set gate (stop and escalate on failure), then tokens and `themes.test.ts`.",
        "blocking": false
      },
      {
        "text": "O-3 [operator decision 'color-blind-safe' / C-11] The all-66-pairs floor of CIEDE2000 >= 5 under each simulation is the proposer's own number, not the operator's. It needs explicit operator acceptance (or a different number) at the design gate.",
        "blocking": false
      },
      {
        "text": "O-12 [C-11] There is no normal-vision distinctness floor: `colorsEqual` false is only a +/-1 sRGB tolerance (`uiTheme.cjs:334`), so two entries could look nearly identical to a trichromat and still pass. Add an all-pairs normal-vision CIEDE2000 floor and put that number to the operator together with O-3.",
        "blocking": false
      },
      {
        "text": "O-11 [C-16] Feature-307 @AC-2 classification is only implied. The design must state it: PRESERVE on the Then-clauses (which still hold, with the cross-theme pin making 'not production-only' true), or EXTEND with a scenario wording change and operator sign-off. The scenario title says 'exactly the Nocturne palette' and the pin at `themes.test.ts:102-104` is relaxed from byte-identical to a filtered subset.",
        "blocking": false
      },
      {
        "text": "O-13 [C-15] `lineColors` is not reset in the effect cleanup (`IndicatorPanels.tsx:135-152`), so after a strategy switch a legend entry with the same key can show the previous draw's `data-line-color`. Reset it to an empty Map in cleanup.",
        "blocking": false
      },
      {
        "text": "O-14 [C-01] `chartable.length` sizes the canvas at `IndicatorPanels.tsx:79`. After the draw loop iterates `components` with slot rows, the count must come from `slots` or a sizing-only filter, or the height breaks when an error component exists (the AAPL fixture, `e2e/fixtures/indicatorSeries.ts:35-40`). The spec must name the line.",
        "blocking": false
      },
      {
        "text": "O-15 [C-18] `SeriesSlot.index` has no stated consumer. Drop it or name the consumer.",
        "blocking": false
      }
    ],
    "floor_breaches": [],
    "business_rule_changes": [
      {
        "ac_id": "@AC-2 @feature-307 (acceptance/ui-env-themed-bundles.feature:17-22)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-7 @feature-307 (bundles differ only in theme tokens)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-17 (theme contrast deviation fence, themes.test.ts:139-173)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      }
    ],
    "rejected_alternatives": [
      "Record the `color` variable passed to `addSeries` instead of reading `line.options().color`. Lost because it observes the argument, not what the library holds; `options()` is the stronger line-side seam, with numeric-channel comparison covering normalization.",
      "Put the per-series line color on a hidden draw-loop DOM node instead of on the swatch. Lost because it adds test-only markup and separates the line-side evidence from the legend.",
      "A watchlist route as the e2e entry. Lost because `?strategy=` already resolves the strategy (`page.tsx:178-179`) with no extra mock.",
      "Changing the `getStrategy` or bars mocks for LYFT. Lost because the default branches already satisfy the gating (`mock-backend.ts:1380-1391`, `:174-207`).",
      "`colorVision.test.cjs` as the helper's test file. Lost because vitest collects only `src/**/*.test.ts` (`vitest.config.ts:20`), so it would never run.",
      "Running the feasibility gate before `colorVision.cjs` exists. Lost because the gate depends on a CVD helper already pinned to published data.",
      "Per-theme value sets. Still rejected; available only as an operator-approved escalation if the gate fails.",
      "Silently loosening the non-adjacent floor if the gate fails. Lost because it is an operator question (P-03/C-16)."
    ],
    "open_risks": [
      "A single shared 12-value set may not exist. It must clear 3:1 on both themes' dark surfaces, adjacent CIEDE2000 >= 10 including the wrap under deuteranopia and protanopia, the all-pairs CVD floor, and a normal-vision floor if O-12 is adopted. Failure forces an operator decision (per-theme values or a weaker floor); per-theme values would turn feature-307 @AC-2 into EXTEND.",
      "The floor numbers (CVD all-pairs >= 5, normal-vision floor not yet chosen) are not operator-set. Each added floor tightens the feasibility search.",
      "`line.options().color` may be normalized by lightweight-charts v5. The e2e must compare numeric channels, not strings.",
      "The Machado matrix and Sharma pair values in the proposal are quoted from memory. They must be transcribed from the papers, or the reference pins will pin wrong values.",
      "`colorVision.cjs` is outside vitest coverage scope (`src/lib/**`), so its reference tests are its only guard, and they only guard if the file is `.test.ts`.",
      "`data-line-color` is a production DOM attribute fed by React state. It is one render behind the draw, and stale after a strategy switch unless cleanup resets it.",
      "Check (a) on the emitted theme CSS has not been built. It needs a real `pnpm build` for both `UI_THEME` values plus the browser e2e (`fails.md:1462`).",
      "`seriesPalette.ts` and `indicatorChart.ts` are Tailwind-scanned; an `rgb()` literal or utility-shaped string there could leak into emitted CSS (`fails.md:3983`).",
      "The feature-307 @AC-2 scenario title ('exactly the Nocturne palette') no longer matches the staging file once 12 series tokens are added, even though its Then-clauses hold."
    ],
    "constitution_rules_touched": [
      "C-01",
      "C-08",
      "C-11",
      "C-12",
      "C-15",
      "C-16",
      "C-18",
      "P-02",
      "P-03"
    ],
    "rationale": "The design is not approvable this round: one blocking objection remains (O-9), and eight non-blocking ones are open.\n\n**Closed this round.** The adversary verified the proposal's answers against the code for five round-1 objections, so I closed them:\n- **O-1:** `line.options().color` is recorded as `data-line-color` and AC-2, AC-3 and AC-6 assert against it.\n- **O-2:** entry URLs, strategy ids, unchanged `getStrategy` and bars mocks, both fixtures, and the AAPL branch left byte-identical.\n- **O-4:** cross-theme `colorsEqual` pin.\n- **O-5:** `seriesSlots` returns palette entries.\n- **O-6:** `isChartable` and `seriesSlots` live in `indicatorChart.ts`.\n\n**Still open.**\n- **O-9 (blocking):** the proposal leaves the CVD test file as `.test.cjs` or `.test.ts`. I confirmed `vitest.config.ts:20` collects only `src/**/*.test.ts`, so the `.cjs` option would silently drop the AC-5 and reference checks. O-7 stays open behind it.\n- **O-8:** the gate is first in name only; it runs before the helper it needs exists. The reorder is in the approach as direction.\n- **O-3 and O-12:** the CVD floor of 5 is the proposer's number and there is no normal-vision floor. Both are operator questions under the \"color-blind-safe\" decision; I did not settle them.\n- **O-11, O-13, O-14, O-15:** new adversary points the proposal has not seen.\n\n**Business rules.** I read feature-307 @AC-2. Its two Then-clauses still hold: every Nocturne token is present, and the series values are identical across themes, so none is production-only. I classified it PRESERVE on that basis. No operator decision explicitly covers it, and the title wording and relaxed pin are flagged under O-11 for the design to state outright.\n\n**Register.** The approach honors D-1..D-5 and reintroduces none of R-1..R-4. No reopen petitions were filed and the operator reopened nothing. New decisions record only points both sides agree on; the adversary's unanswered fixes are objections, not decisions.",
    "register_delta": {
      "new_decisions": [
        {
          "text": "The line-side seam is `line.options().color`, read after `addSeries`, stored per `${refName}.${name}` key and rendered as `data-line-color` on the legend swatch; AC-2, AC-3 and AC-6 e2e assert against it by numeric channels.",
          "evidence": "Proposal r2 (`IndicatorPanels.tsx:93-104`, `:192-195`); adversary r2 rates O-1 closable and prefers `options()` over recording the argument."
        },
        {
          "text": "The e2e enters through `/trader/positions/LYFT?strategy=<id>` with ids `dip_buyer_vol_stop` and `series_palette_13`; the `getStrategy` and bars mocks are unchanged; one LYFT branch is added in `getIndicatorSeries` beside the byte-identical AAPL branch; two fixtures get INVENTORY rows.",
          "evidence": "Adversary r2 verified `page.tsx:178-179`, `e2e/mock-backend.ts:174-207`, `:1380-1391`, `:1417-1421`, no existing LYFT use, and no id collision (`e2e/fixtures/strategies.ts:18-69`, `mock-backend.ts:132-135`)."
        },
        {
          "text": "`isChartable` and `seriesSlots` live in `src/lib/indicatorChart.ts`; `src/lib/seriesPalette.ts` holds only the `SERIES_PALETTE` data; `seriesSlots` returns `{token, fallback}` palette entries per component and wraps on `SERIES_PALETTE.length`.",
          "evidence": "Proposal r2; adversary r2 rates O-5 and O-6 closable (`indicatorChart.ts:27`, `IndicatorPanels.tsx:19-21`, `:95`, `:194`)."
        },
        {
          "text": "`themes.test.ts` pins every `--series-N` as `colorsEqual` across staging and production, with a constraint comment naming the `checkThemeBundle.cjs:64` exemption and feature-307 @AC-2.",
          "evidence": "Proposal r2; adversary r2 rates O-4 closable and notes it underpins the @AC-2 PRESERVE argument."
        },
        {
          "text": "`colorVision.cjs` lives in `src/styles/themes/`, reuses `cssColorToSrgb`, applies Machado-2009 severity-1.0 matrices in linear light, and is pinned by the 34 Sharma (2005) pairs, both matrices element-wise, and white/black fixed points.",
          "evidence": "Proposal r2 (`globals.css:6`, `uiTheme.cjs:269`, `themes.test.ts:6-7`); adversary r2 accepts the content and contests only the test file extension."
        }
      ],
      "new_rejected": [
        {
          "text": "Recording the `color` variable passed to `addSeries` as the line-side evidence instead of `line.options().color`.",
          "why": "It observes the argument, not what the library holds; both sides keep `options()`."
        },
        {
          "text": "A hidden draw-loop DOM node carrying the per-series line color.",
          "why": "Test-only markup, separated from the legend; the swatch attribute is leaner."
        },
        {
          "text": "`colorVision.test.cjs` as the CVD helper's test file.",
          "why": "vitest collects only `src/**/*.test.ts` (`vitest.config.ts:20`), so it would never run."
        }
      ],
      "new_objections": [
        {
          "text": "O-9 [C-08] Commit to `src/styles/themes/colorVision.test.ts` (loaded via `createRequire`); a `.test.cjs` is never collected by vitest (`vitest.config.ts:20`). The step Verification must name the expected test count.",
          "blocking": true
        },
        {
          "text": "O-10 [C-08/C-01] Fix the build order: `colorVision.cjs` and its reference pins first, then the candidate-set feasibility gate, then tokens and `themes.test.ts`.",
          "blocking": false
        },
        {
          "text": "O-11 [C-16] State the feature-307 @AC-2 classification explicitly (PRESERVE on the Then-clauses, or EXTEND with a wording change and operator sign-off); the title says 'exactly' and the pin at `themes.test.ts:102-104` is relaxed.",
          "blocking": false
        },
        {
          "text": "O-12 [C-11] Add an all-pairs normal-vision CIEDE2000 floor and put both floor numbers (CVD non-adjacent and normal-vision) to the operator with O-3.",
          "blocking": false
        },
        {
          "text": "O-13 [C-15] Reset `lineColors` to an empty Map in the draw-effect cleanup (`IndicatorPanels.tsx:135-152`) so a stale `data-line-color` cannot survive a strategy switch.",
          "blocking": false
        },
        {
          "text": "O-14 [C-01] Name how the canvas-sizing count at `IndicatorPanels.tsx:79` is derived once the draw loop iterates `components` with slot rows.",
          "blocking": false
        },
        {
          "text": "O-15 [C-18] Drop `SeriesSlot.index` or name its consumer.",
          "blocking": false
        }
      ],
      "closed_objections": [
        {
          "id": "O-1",
          "how": "`line.options().color` is recorded per series key and rendered as `data-line-color`; AC-2, AC-3 and AC-6 assert against it, so a line/swatch slot mismatch fails. Adversary r2 agrees."
        },
        {
          "id": "O-2",
          "how": "Proposal r2 names the entry URLs, strategy ids, unchanged `getStrategy` and bars mocks, both fixtures with INVENTORY rows and the byte-identical AAPL branch; adversary r2 verified each against the code."
        },
        {
          "id": "O-4",
          "how": "A cross-theme `colorsEqual` assertion for every `--series-N` is added to `themes.test.ts` with a constraint comment."
        },
        {
          "id": "O-5",
          "how": "`seriesSlots` returns palette entries per component, so no call site re-indexes. The unused `index` field is tracked separately as O-15."
        },
        {
          "id": "O-6",
          "how": "`isChartable` and `seriesSlots` are placed in `src/lib/indicatorChart.ts`; `seriesPalette.ts` is data-only."
        }
      ],
      "reopen_petitions": [],
      "reopened": []
    }
  },
  "floor_breaches": []
}
```

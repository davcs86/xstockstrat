# Recon: chart-series-palette

**Created**: 2026-11-15
**From**: product-spec.md
**Tree**: feature/chart-series-palette@92a2c4879 (7 commits ahead of origin/main-dev@67dcfc11a, 0 behind). The discovery digests arrived unstamped; every `path:line` below was re-grepped on this tree.
**Affected services**: xstockstrat-ui

---

## Objective

Give the symbol-page indicator chart a dedicated categorical palette of 12 series color tokens, defined in both the staging and production themes and separate from the frozen `--chart-1..5`. Series take colors by their position across the whole chart, so no two of the first 12 share a color, and each legend swatch shows its line's color. Today the index restarts per indicator and the staging `--chart-1..5` are near-identical grays, so a trader cannot tell series apart.

Operator decisions (binding, 2026-11-15): a separate 12-color set, `--chart-1..5` staging values untouched; colors unique across the whole indicator chart with matching legend swatches; each color at least 3:1 against the chart surface and color-blind-safe, in both themes.

## Codebase Map

- **`xstockstrat-ui`** (Next.js; paths below are relative to `services/xstockstrat-ui/`)
  - Entry point (consumer): `src/app/trader/positions/[symbol]/page.tsx:1348` renders `<IndicatorPanels components times chartRef containerRef />`
  - Handler/servicer: n/a. The only series-color site is `src/components/trader/IndicatorPanels.tsx`
    - `:16-17` — `SERIES_TOKENS` (`--chart-1`…`--chart-5`) and `SERIES_FALLBACK` (5 CSS named colors)
    - `:19-21` — `isChartable(c)` = `!c.error && c.series.length > 0`
    - `:62` — `const chartable = components.filter(isChartable)`
    - `:93-106` — draw loop; `:95` is the bug: `resolveChartColor(SERIES_TOKENS[si % 5], SERIES_FALLBACK[si % 5])`, where `si` is the index inside one component
    - `:103` — readout label `${comp.refName}.${s.name}`
    - `:170-201` — legend, mapped over ALL `components`; `:194` swatch `style={{ background: \`var(${SERIES_TOKENS[si % 5]})\` }}`, again per-component `si`
    - `:183-184` — `data-series-count` / `data-series` attributes (the existing e2e seam)
  - Last migration: none (no schema change)
  - Config-read pattern: none (no config key)
  - Other key symbols:
    - `resolveChartColor(varName, fallback)` — `src/lib/chartColors.ts:43` (1×1-canvas read-back to `rgb()`, `:24-35`)
    - `CHART_COLOR_TOKENS` — `src/lib/chartColors.ts:10-20`. Its only consumer is its own test, `src/lib/chartColors.test.ts:16-31`, which uses `arrayContaining`, so adding entries does not break it
    - Theme files — `src/styles/themes/staging.css:21-25` and `production.css:21-25` (`--chart-1..5`), one `:root` block each (39 and 35 lines). The build picks one through the `@theme-tokens` alias, `next.config.js:14`
    - Theme pins — `src/styles/themes/themes.test.ts`: `NOCTURNE` `:22-56`, `PAIRS` `:62-84` (chart pairs `:80-83`), same-names `:99-101`, byte-identical staging `:102-104`, production baseline `:128-130`, staging deviations `:139-173`
    - Build gate — `src/styles/themes/checkThemeBundle.cjs`: check (a) `checkSelected` `:76-111`, `nonSharedTokens` `:59-73`, check (b) `checkHardcoded` `:114-137`, `SHARED_ROLES` `:17`; chained into `pnpm build` at `package.json:8`
    - Color math — `src/styles/themes/uiTheme.cjs`: `parseRootTokens` `:202`, `oklchToSrgb` `:247`, `cssColorToSrgb` `:269`, `relativeLuminance` `:319`, `contrastRatio` `:328`, `colorsEqual` `:334` (±1 sRGB, ±0.01 alpha), exports `:343`
    - Source-literal ban — `src/styles/noColorLiterals.test.ts:8` (`/hsl\(\s*\d|oklch\(|#[0-9a-fA-F]{6}\b/`)
    - Tailwind mapping — `src/app/globals.css:31-35` (`--color-chart-N`); shared cross-theme colors live in the unlayered `:root` at `src/app/globals.css:89-94`
    - Existing e2e — `e2e/trader/position-detail.spec.ts:482-530`; fixture `INDICATOR_SERIES_AAPL` at `e2e/fixtures/indicatorSeries.ts:22` (catalog row `e2e/fixtures/INVENTORY.md:57`)
    - Governance doc — `docs/patterns/ui-ux-governance.md:44-46` ("Charts consume `--chart-1`…`--chart-5`"), `:158-164` (§5 item 8 baseline), `:165-174` (staging deviations fence), `:263` (backlog row g)

## Patterns to REUSE

- Canvas line color from a token → `resolveChartColor` at `src/lib/chartColors.ts:43`. Do not hand lightweight-charts a raw `oklch(...)`.
- Fallback colors → keep the `SERIES_FALLBACK` convention at `IndicatorPanels.tsx:17` (CSS named colors, no hex), extended to 12.
- One whole-chart index for lines and swatches → derive both from the existing predicate `isChartable` (`IndicatorPanels.tsx:19-21`) so they cannot drift.
- Palette contrast test (AC-4) → the `PAIRS` / `nonText` / `ratio` structure at `themes.test.ts:58-87`; the chart rows at `:80-83` are the shape to copy.
- "Exactly 12 per theme" and "`--chart-1..5` unchanged" (AC-1) → the `parseRootTokens` maps at `themes.test.ts:17-18` and the `NOCTURNE` pin at `:22-56`.
- sRGB conversion for the color-blind test (AC-5) → `cssColorToSrgb` at `uiTheme.cjs:269`.
- Unit-testable series→token mapping (AC-2, AC-6) → a pure helper beside `src/lib/indicatorChart.ts`; vitest coverage is scoped to `src/lib/**`.
- e2e data for 5-series and 13-series sets → a new fixture in `e2e/fixtures/indicatorSeries.ts` plus an `INVENTORY.md` row (C-12), served by the mock at `e2e/mock-backend.ts:1419`.
- DOM seam for canvas colors → the `data-series*` attribute pattern at `IndicatorPanels.tsx:183-184`.

## Existing Business Rules (preserve / extend)

- **PRESERVE** `@AC-2 @FR-1 @FR-2 @FR-3 @feature-307` "Staging build compiles exactly the Nocturne palette" (`services/xstockstrat-ui/acceptance/ui-env-themed-bundles.feature:17-22`) — staging CSS has every Nocturne :root token and no production-only color. The 12 series tokens must be defined in staging as well and must not be production-only. Possible EXTEND; see Risks item 1.
- **PRESERVE** `@AC-12 @FR-11 @feature-307` "/insights charts follow the selected theme" (`…/ui-env-themed-bundles.feature:74-79`) — the insights equity curve stays on `--chart-1`, and no `hsl(`/`oklch(`/`#rrggbb` literal appears in `src/**/*.ts(x)` outside `src/components/ui` and tests. Series and swatch colors must come from tokens.
- **PRESERVE** `@AC-17 @FR-13 @feature-307` "Staging contrast shortfalls are recorded, not fixed" (`…:94-99`) — staging values stay frozen and the computed below-threshold set equals the §5 list. New tokens must not add an unrecorded below-threshold pair.
- **PRESERVE** `@AC-14 @FR-13 @feature-307` "Production palette meets the documented contrast baseline" (`…:88-92`) — existing production pairs keep their ratios.
- **PRESERVE** `@AC-8 @FR-4 @FR-9 @feature-307` "Production theme meets the contrast baseline and charts render" (`…:49-50`) — no "Failed to parse color" on the production chart.
- **PRESERVE** `@AC-11 @FR-9 @feature-307` "Staging theme charts still render" (`…:68-69`) — the same guarantee for the staging bundle.
- **PRESERVE** `@AC-1 @FR-1 @FR-2 @FR-4 @feature-307` "Production build compiles only the production palette" (`…:10-11`) — production CSS must not contain the Nocturne `--primary`.
- **PRESERVE** `@AC-7 @FR-8 @FR-11 @feature-307` "Bundles differ only in theme tokens" (`…:42-43`) — the change is token-only, with no theme-dependent markup or text.
- **PRESERVE** `@AC-5 @FR-5 @feature-307` "Order-side semantic colors are identical across themes" (`…:36-37`) — `--color-buy`/`--color-sell`/`--color-paper` stay unchanged.
- **PRESERVE** `@AC-7 @FR-4 @feature-095` "The Signal-detail chart draws target and stop overlay lines with a legend" (`services/xstockstrat-ui/acceptance/opportunity-live-market-enrichment.feature:48-49`) — the symbol-page target/stop legend must not regress if shared chart code changes.
- No CHANGE flags. No existing scenario guarantees the current single-`--chart-1` series behavior or the indicator legend.
- Coverage: the ui suite directory holds 60 files (the digest counted 57). Two suites were read; the rest and `docs/sdd/business-rules/platform.feature` were keyword-searched only. A rule whose text lacks chart/theme/color keywords could have been missed.

## Dependencies

- Proto/RPC: none
- Migration: none
- Config keys: none
- Inter-service edges: none
- New env vars / ports: none

## Risks / Not-found

1. **`NOCTURNE` pin vs new staging tokens (design fork).** `themes.test.ts:102-104` asserts `[...staging.entries()]` equals `NOCTURNE` exactly, and the test name cites feature 307 AC-2/FR-3. Adding 12 tokens to `staging.css` fails it until the pin is changed. Design must choose how: extend the list, or assert the Nocturne subset and pin the series set separately. It must also say whether feature 307 `@AC-2` is PRESERVE or EXTEND. The operator decision supports adding a separate set, but it is not a sign-off on that scenario's text (C-16).
2. **Where the tokens live.** FR-1 and feature AC-1 say each theme defines 12 tokens, which points at the two theme files. `themes.test.ts:99-101` then forces both files to declare the same names. A shared declaration in the `globals.css` `:root` (`:89-94`, the `--color-buy` pattern) would avoid risk 1 but does not match the AC-1 wording. Carry to design; do not pick silently.
3. **Build gate check (a).** `checkThemeBundle.cjs:107-109` fails the build if any token of the selected theme has no literal declaration in the emitted CSS. Theme-file tokens are emitted as plain `:root` declarations, so this should hold, but it was not built and verified here.
4. **Build gate check (b), the hardcoded-color trap.** `nonSharedTokens` (`checkThemeBundle.cjs:59-73`) adds every token whose staging and production values differ. Any other emitted literal within ±1 sRGB of one then fails every build (`:114-137`). Two consequences for choosing values:
   - A series color that differs per theme must not land on an emitted Tailwind default-palette color or on the shared literals `--color-buy` / `--color-sell` / `--color-paper` (`globals.css:90-93`).
   - A series token with the same value in both themes is skipped at `:64` and is not subject to check (b).
5. **Ledger trap, 2026-08-19 `146-unify-symbol-chart-libraries`** (`fails.md:1462`): lightweight-charts throws on `oklch(...)`; only the canvas read-back converts. All line colors must go through `resolveChartColor`. A chart change that passes only tsc/unit is unverified; run the browser e2e.
6. **Ledger trap, 2026-11-10 `ui-env-themed-bundles`** (`fails.md:3983`): Tailwind v4 scans every non-ignored file under `src/`. Tests and theme files are excluded (`globals.css:5-6`), but a color string placed in other scanned source or docs can become emitted CSS and trip the gate.
7. **Swatch vs line equality (FR-3).** The swatch paints `var(--token)` in CSS; the line uses the sRGB bytes from the canvas. They match only for in-gamut values. `uiTheme.cjs` clamps out-of-gamut channels (`:244`), so an out-of-gamut value would also skew the contrast math. Prefer values inside sRGB.
8. **Legend index drift.** The legend maps over all components (`IndicatorPanels.tsx:170`), the draw loop over `chartable` (`:93`). Error components render no swatches (`:171-177`), so a running count over rendered swatches would agree today, but only if both sides use the same predicate. Share one computed index.
9. **AC-3 labels.** The legend renders the eyebrow `comp.refName` (`:186`) then `{s.name}` (`:196`). "sma200 value" and "vts stop_line" match that text only as eyebrow plus series name. Confirm the locator shape in design.
10. **Not found — color-blind tooling.** No CIEDE2000 or deuteranopia/protanopia simulation exists in `src` or `e2e`. AC-5 needs a new helper. Open for design: its home (`uiTheme.cjs` or the test), which simulation model, and whether the pair "entry 12 / entry 1" counts as adjacent (FR-5 wraps there).
11. **Not found — tests of series color.** No unit test of `IndicatorPanels` and no e2e assertion on line or swatch color. The chart is a canvas, so AC-2 and AC-6 need the pure helper test, a data attribute, or both.
12. **Not found — token names.** No `--chart-6+` or other categorical set exists. Names are a design decision (product spec: new names, not `--chart-N`).
13. **Open — `CHART_COLOR_TOKENS`.** Nothing but its own test reads it. Whether the 12 tokens belong in it is a design call.
14. **Doc drift to fix with the change.** `docs/patterns/ui-ux-governance.md:44-46` and `:158-164` describe charts as `--chart-1..5` only. The service `CLAUDE.md` § Styling should mention the series set.
15. **Staging is the binding contrast case.** `--card` is `oklch(0.216 0.006 56.043)` and `--background` `oklch(0.147 0.004 49.25)` (`staging.css:4,2`). If any staging series pair fell below 3:1 it would have to be listed inside the fence at `ui-ux-governance.md:165-174`; FR-4 requires that none does.

## Recommended Scope

Advisory, for the grilling and `/sdd-spec`.

1. **Theme tokens and pins (lands as one unit).** Add the 12 tokens to `staging.css` and `production.css`; update the `NOCTURNE` handling; extend the contrast pairs to the 12 tokens on `card` and `background`; add the exactly-12 assertion and the color-blind distance test with its helper. Covers AC-1, AC-4, AC-5.
2. **Pure series→token helper** in `src/lib/` with a vitest test: whole-chart running index over chartable components, wrap at 12. Covers AC-2, AC-6.
3. **`IndicatorPanels` wiring.** Lines and swatches both read the helper; token and fallback arrays grow to 12; expose the assigned token per series as a data attribute. Add the 5-series and 13-series fixtures and the e2e assertions. Covers AC-3 and the e2e side of AC-2/AC-6.
4. **Docs.** `docs/patterns/ui-ux-governance.md` §2/§5 and the service `CLAUDE.md` § Styling.

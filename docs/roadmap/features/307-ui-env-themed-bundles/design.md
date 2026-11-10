# Design: ui-env-themed-bundles

**Created**: 2026-11-10
**Rounds**: 9 (quick requested; operator chose further rounds, then overrode the 5-round cap; termination: approved — round 9 adversary 0 BLOCKER / 0 FIX-IN-SPEC)
**Approved by**: user @ 2026-11-10
**Grounded in**: recon.md

---

## Chosen Approach

**Theme selection**
- `UI_THEME` takes `staging` or `production` at build time. Unset means staging. Any other value, including `''`, fails the build.
- Selection lives in `next.config.js`. Its only env switch today is `output` at `next.config.js:7`. The selection does three things (all in S3):
  - `resolveUiTheme` checks the allow-list.
  - A webpack alias maps `'@theme-tokens$'` to `src/styles/themes/<theme>.css`.
  - `env: { UI_THEME_BACKGROUND_HEX: themeBackgroundHex(theme) }` is inlined at build.

**Token split (S3)**
- The `:root` block at `globals.css:87-125` moves verbatim into an unlayered `:root{}` in `staging.css` (FR-3, byte-identical, including the inner comment at `:112-115`). `production.css` uses the same token names.
- The preset history comment at `globals.css:83-86` is deleted. That rationale already lives in UI CLAUDE.md § Styling (comment rule 5).
- After S3, `globals.css` keeps:
  - the two `@import`s and `@source not` lines;
  - `@theme inline` (`:8-80`) as the only Tailwind mapping;
  - the shared order-side literals (`:44-46`) plus the S1 `--color-warning: hsl(43 41% 64%)`;
  - `@layer base {` (`:82`) directly followed by the `*`/`body`/`html` rules (`:127-140`) and its closing brace (`:141`).
- `layout.tsx:3` becomes `import './globals.css'; import '@theme-tokens';`. The root layout covers every segment (/trader, /insights, /config-ui, /accounts). Per C-14 this is visual only.

**Tailwind scan scope (S1)**
- `globals.css:1` becomes `@import 'tailwindcss' source('..');`, which scans `src/` only.
- `globals.css:2` (`@import 'tw-animate-css';`) is unchanged. The two `@source not` lines follow it:
```css
@import 'tailwindcss' source('..');
@import 'tw-animate-css';
@source not "../**/*.test.ts";
@source not "../styles/themes";
```

**Build check**
- `package.json:8` build becomes `next build && node src/styles/themes/checkThemeBundle.cjs`. This one change covers `Dockerfile:20`, the `Dockerfile.e2e:65` builder, and the Playwright webServer `pnpm build` (`playwright.config.ts:132`).
- From S5 on, every build runs (a), (b) and (c).
- (b) does not depend on the selected theme. The staging build inside `e2e-build` runs on every UI PR, so any hardcoded colour equal to a theme-specific token of either theme fails there.

**Image provenance and deploy guards**
- `Dockerfile` gets `ARG UI_THEME=staging`, and the runner gets `LABEL io.xstockstrat.ui-theme`.
- `docker-build.yml` gets a required `ui_theme` input and a `preflight-ui-theme` job (`refuse-retheme`) that the build matrix `needs`.
- Every deploy-from-tag path runs `require-match` as a `run:` step: deploy-homelab, prod-up, staging-up, and the deploy.yml `validate` job.

**Promotions never build the same SHA for dev and prod**
- Every main→main-dev back-merge uses `--no-ff`, with a CI guard.
- The sync workflow is serialized.
- The promote gate is content-based (three-dot).

#### A — Tokens and selection
**New files**
- `src/styles/themes/staging.css` and `src/styles/themes/production.css` (S3).
- `src/styles/themes/uiTheme.cjs`, used by next.config, the checker, vitest (via createRequire) and e2e. It has no dependencies, so the CI host can run it without `pnpm install`.
  - **S1 exports:**
    - `resolveUiTheme`, `parseRootTokens`.
    - `cssDeclarations(css)` and `colorLiterals(value, valueOffset)`: the tokenizer in §1 B.
    - `cssColorToSrgb`. It accepts:
      - oklch (numeric or % L, leading dot);
      - hsl/hsla and rgb/rgba;
      - `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`;
      - `/` alpha as a number or %.

      lab, lch, oklab, hwb and `color()` throw "unsupported colour syntax at file:offset" (fail closed). Out-of-gamut results (e.g. yellow-500, linear B ≈ −0.044) are clamped per channel to [0,1] before the 8-bit conversion.
    - `relativeLuminance`, `contrastRatio`, `colorsEqual` (sRGB ±1 per channel, alpha ±0.01).
  - **S3 adds:** `themeCssPath` and `themeBackgroundHex`. They read the theme files, which only exist from S3 on.
- `src/styles/themes/checkThemeBundle.cjs` (S1): a pure `checkBundle(cssFiles, theme, sources)` plus a CLI.
  - **CLI:**
    - `--css-dir <dir>` defaults to `.next/static/css`, relative to cwd. Under `pnpm --filter xstockstrat-ui run build`, cwd is the package dir.
    - Files: `fs.readdirSync(dir, { recursive: true })` filtered to `**/*.css`. Zero files fails with "no CSS under <dir>".
    - Theme: `resolveUiTheme(process.env.UI_THEME)`.
    - On success it prints `checkThemeBundle: <theme> bundle OK (<n> css files)`.
  - **Sources, by step.** All are resolved from `__dirname`, so the result does not depend on cwd.
    - **S1:** `globals.css` only, because (c) needs only the shared literals.
    - **S5:** the loader adds `staging.css` and `production.css` via `themeCssPath` (from S3), because (a) and (b) need the token sets. S3 does not touch the checker.
- Tests: `src/styles/themes/{uiTheme,checkThemeBundle,themes,nextConfig}.test.ts` and `src/styles/noColorLiterals.test.ts`. They run under the existing `include: ['src/**/*.test.ts']` (`vitest.config.ts:20`).
- `.eslintrc.json`: a `*.cjs` override with `no-var-requires`/`no-require-imports` off.

#### B — Checker (selector-agnostic, every `**/*.css` under `--css-dir`)

**Tokenizer (S1, `uiTheme.cjs`; unit-tested in `uiTheme.test.ts`).** `cssDeclarations(css)` returns `{file, name, value, valueOffset}` records.
1. **Comments.** `/* … */` (including `/*! … */`) is removed first, with offsets preserved by blanking. This drops the colour text in the staging.css comment that came from `globals.css:112-115`, and the hex codes in the `globals.css:41` comment.
2. **Structure.** A brace-depth walk.
   - Text before `{` is a **prelude**: a selector, or an at-rule prelude such as `@supports (color: color-mix(in lab, red, red))` or `@media …`. Preludes are **never scanned**.
   - Inside a block, segments are split on `;` at paren depth 0. A segment containing `{` is a nested prelude, handled recursively (CSS nesting, `@supports`/`@media` inside rules).
   - A segment `name: value` is a declaration. A trailing `!important` is stripped.
   - Declarations inside `@property` and `@keyframes` blocks (for example `initial-value`) are declarations like any other.
   - In every context, a quoted string `'…'`/`"…"` is skipped as a unit, and `\` escapes the next character. So braces, `;` or `#` inside strings or escapes never affect structure.
   - **Consequence:** the `chart.tsx:66` arbitrary variants `[&_.recharts-cartesian-grid_line[stroke='#ccc']]` and `[stroke='#fff']` emit as escaped class selectors (`\#ccc`) and quoted attribute selectors. Both are preludes, so they are never scanned.
3. **Values: `colorLiterals(value)` walk.** It returns `{text, offset}` for each colour literal. The rules apply in order:
   - **Strings and `url(…)`** are skipped.
   - **Hex.** `#` followed by exactly 3, 4, 6 or 8 hex digits, not preceded by `\`, and followed by a non-identifier character or end of value.
   - **Colour functions:** `rgb`, `rgba`, `hsl`, `hsla`, `oklch`, `oklab`, `lab`, `lch`, `hwb`, `color`.
     - The call is a **literal** iff its argument text (up to the matching paren) contains no nested function call (no `var(`, `calc(`, `env(`, `attr(` or any other `ident(`) and no `from` keyword.
     - A literal goes to `cssColorToSrgb`. The unsupported forms throw (fail closed).
     - If the call has a nested function or `from`, it is **not a literal** and is skipped as a whole. Its arguments are not descended into.
     - So `hsl(var(--x))`, `rgb(var(--x) / .5)` and `oklch(from var(--x) l c h)` yield nothing. This covers `sidebar.tsx:455` `hsl(var(--sidebar-border))` until S6 removes it.
   - **`color-mix(…)`** is never itself a literal.
     - The first comma-separated argument is the interpolation spec (`in oklch`, `in oklab`, `in srgb`); it is skipped.
     - Each remaining depth-1 operand has its trailing `<n>%` stripped and is fed back through these same rules. Nested `color-mix` operands therefore recurse to any depth.
     - `color-mix(in oklch, var(--secondary), var(--foreground) 5%)` (`button.tsx:16`) yields nothing.
     - `color-mix(in oklab, #fff 10%, transparent)` yields `#fff`, compared at its own alpha (α1; the mix % is not folded).
     - `color-mix(in srgb, color-mix(in oklab, oklch(0.5 0.1 200) 50%, var(--x)), #000)` yields the oklch and `#000`.
   - **Any other function** (`var`, `calc`, gradients, `drop-shadow`, …) is descended into, and its arguments are scanned by these same rules.
     - `var(--tw-shadow-color, rgb(0 0 0/.1))` yields the fallback `rgb(0 0 0/.1)`.
     - `0 0 #0000` yields `#0000`.
   - **Identifiers**, including `transparent`, `currentcolor`, `inherit` and CSS named colours, are **not literals** and are skipped. Residual: Open Risk 12.
4. **Offset.** A literal's offset is its byte offset in the file: `valueOffset` plus the in-value index.

**Token set T.** T is the exact custom-property names declared in the `:root{}` of `staging.css` ∪ `production.css`, from `parseRootTokens`. `themes.test.ts` asserts the two name sets are equal. Matching is by exact name, so `--card-spacing` (`card.tsx:15`) ≠ `--card`.

**Classification (how the scanner tells a token declaration from any other literal).** The rule is by property name, under any selector or at-rule:
- **Literal token declaration.** The name is in T, and the value contains neither `var(` nor `calc(`. Only (a) checks it; (b) does not scan it.
- **Everything else**, which (b) scans:
  - every non-T declaration: palette `--color-<family>-<step>`, `--color-white/black`, `--color-buy/sell/paper/warning`, `--tw-*`, `initial-value`, ordinary properties, arbitrary values;
  - **plus** T-name declarations whose value contains `var(` or `calc(`. Their nested literals (for example a `var()` fallback) are scanned by (b).

**Alpha rule (all checks).** `colorsEqual(x, y)` holds when R, G and B (0–255, rounded) each differ by ≤1 **and** |αx − αy| ≤ 0.01, with α = 1 when absent.

**N (non-shared token values), computed from the source theme files and identical in both builds.**
- N is every colour token in T whose staging and production values are not `colorsEqual`. Each member is recorded as (theme, name, value), for both themes regardless of which is selected.
- Shared tokens are excluded: today `--secondary-foreground` `oklch(0.985 0 0)` and `--destructive` `oklch(0.704 0.191 22.216)`.
- `--radius` is not a colour.
- The `globals.css` shared literals (buy/sell/paper/warning) are in no theme file, so they are never in N.

- **(a) Selected values present and correct (literal values only).**
  - Every literal token declaration of a T colour name must colour-equal the selected theme's value. `--radius` is compared length-normalised.
  - A literal token declaration whose whole value does not parse as one colour (or as a length, for `--radius`) fails as "unparseable token value <v> at <file>:<offset>". This is fail-closed and includes named colours.
  - T-name declarations whose value contains `var(` or `calc(` are skipped by (a). This covers:
    - `sidebar.tsx:322,356` `[--radius:var(--radius-xl)]`;
    - any `var(--<same-name>)` self-map;
    - `calc()` radius forms.
  - Every selected token must have **at least one** literal declaration somewhere. Otherwise: "theme token --<name> has no literal declaration".
  - Both theme files bundled after an alias failure: the other theme's literal token declarations fail (a).
- **(b) No hardcoded theme colour, symmetric, every build.**
  - Every colour literal from a scanned declaration is tested against every n ∈ N. Fail if `colorsEqual`.
  - The scope includes:
    - pre-computed translucent fallbacks (`#ffffff1a`);
    - palette declarations;
    - `color-mix` literal operands;
    - `var()` fallbacks;
    - arbitrary values;
    - literals in T-name declarations that use `var`/`calc`.
  - One line per (literal, theme, token) match, exactly:
    `colour literal <v> at <file>:<offset> equals <theme> <token>; use the theme token`
    Here `<file>` is the path relative to `--css-dir`, and `<token>` is `--<name>`.
  - **Exclusions:**
    - shared tokens (not in N);
    - the shared order-side literals (not in N). Their declarations are still scanned, and today they match nothing (table below). (c) pins their values.
  - **Theme-independence.** N is the same set in both builds. The theme files contain only T-name `:root` declarations (asserted in `themes.test.ts`), and `@source not "../styles/themes"` keeps them out of the Tailwind scan. So the declarations (b) scans come from identical inputs in both builds, and a (b) failure in one build is a (b) failure in the other.
  - (a) is per-theme by design. The production-only part of a failure surface is caught by (a) in the production build, which runs in PR CI whenever a theme-relevant path changes (`ui-theme` filter).
- **(c) Shared colours.** `--color-buy`/`sell`/`paper`/`warning` are emitted and colour-equal the `globals.css` literals in both themes.

**R7 (d) is removed.**
- (d)'s set P (palette declarations and `color-mix` literal operands) is a subset of (b)'s scanned literals, and (d)'s N is (b)'s N. So (d) added zero coverage and would only duplicate failure lines.
- (b) also covers what (d) could not: pre-computed translucent fallbacks (`white/10` → `#ffffff1a` = staging `--border`) and arbitrary values. This was the round-7 item 4 gap.
- The palette-var label in the message is dropped for the operator-specified text. The file:offset locates the declaration.

**AC-1 Nocturne pin.** The literal is `oklch(0.432 0.095 166.913)` = emerald-800 = staging `--primary`.
- As a production token declaration, it fails (a).
- As any other literal, it fails (b) in every build.
- `themes.test.ts` asserts no production token is `colorsEqual` to it, so it stays in N and AC-1's "absent" holds in a production bundle.
- Named AC-1 fixtures live in `checkThemeBundle.test.ts` (S5).

**Today's tree vs (b) (round-7 item 4).**
- Palette utilities in use (src grep; `white` is used only opaque):
  - yellow-400: `StatTile.tsx:28`, `PerformanceDashboard.tsx:120`, `badge.tsx:25`
  - yellow-500 `/5`, `/40`, `/20`: `alert.tsx:15,17`, `badge.tsx:25`, `screener/page.tsx:568`
  - blue-400 and blue-500 `/20`: `badge.tsx:26`
  - white: `slider.tsx:49` `bg-white`, `toggle.tsx:22` and `button.tsx:27` `text-white`
  - black: `slider.tsx:49` `ring-black/10`, `sheet.tsx:34` and `alert-dialog.tsx:31` `bg-black/30`
- Arbitrary colour values (S6 removes all three):
  - `strategies/[id]/page.tsx:287,515` `text-[hsl(38_92%_50%)]`
  - `strategies/[id]/page.tsx:555` `text-[hsl(163_100%_44%)]`
- `color-mix` with only `var()` operands: `button.tsx:16`.
- `ring-foreground/5` and `ring-foreground/10` (`card.tsx:15`) mix `var(--foreground)` with `transparent`, so they yield nothing.

Non-shared N, approximate sRGB:

| | Staging | Production |
|---|---|---|
| background | 12,10,9 | 8,13,23 |
| foreground family | 250,250,249 | 244,247,251 (computed) |
| card / popover / sidebar | 28,25,23 | ≈21,28,40 |
| primary | 0,95,70 | 81,133,233 (computed) |
| primary-foreground | 236,253,245 | ≈5,12,32 |
| secondary | 39,39,42 | ≈32,38,48 |
| muted / accent / chart-5 / sidebar-accent | 41,37,36 | muted ≈31,37,46; accent ≈32,41,57; chart-5 ≈99,130,160 |
| muted-foreground | 166,160,155 | ≈157,165,177 |
| border / sidebar-border | 255,255,255 α0.10 | ≈160,173,197 α0.18 |
| input | 255,255,255 α0.15 | ≈160,173,197 α0.24 |
| ring / chart-2 / sidebar-ring | 121,113,107 | ring ≈82,133,210; chart-2 83,182,235 |
| chart-1 | 214,211,209 | 199,214,232 (computed) |
| chart-3 | 87,83,78 | ≈0,174,183 |
| chart-4 | 68,64,60 | ≈182,99,183 |
| chart-grid | ≈80,75,72 α0.55 | ≈85,94,110 α0.55 |
| sidebar-primary | 0,188,125 | ≈139,140,245 |
| sidebar-primary-foreground | 0,44,34 | ≈22,18,55 |

Every non-token literal in today's emitted CSS, against every non-shared token of both themes:

| Literal (source) | sRGB α | Nearest non-shared token (either theme) | Collides? |
|---|---|---|---|
| `#0000001a` (`ring-black/10` fallback) | 0,0,0 α0.10 | staging `--border` 255,255,255 α0.10 | No: ΔRGB 255 |
| `rgb(0 0 0/.1)` (shadow `var()` fallback) | 0,0,0 α0.10 | as above | No: ΔRGB 255 |
| `#0000004d` (`black/30` fallback) | 0,0,0 α0.30 | none with α 0.29–0.31 | No: Δα |
| `#0000` (`--tw-shadow`/ring initial) | 0,0,0 α0 | none with α ≤ 0.01 | No: Δα |
| `#f0b1000d` (yellow-500/5) | 240,177,0 α0.05 | none with α 0.04–0.06 | No |
| `#f0b10033` (yellow-500/20) | 240,177,0 α0.20 | prod `--border` α0.18 | No: Δα 0.02, ΔR 80 |
| `#f0b10066` (yellow-500/40) | 240,177,0 α0.40 | none with α 0.39–0.41 | No |
| `#2b7fff33` (blue-500/20) | 43,127,255 α0.20 | prod `--border` α0.18 | No: Δα 0.02, ΔR 117 |
| `#fff` (white decl, `--tw-ring-offset-color`) | 255,255,255 α1 | staging fg 250,250,249; prod fg 244,247,251; staging `--border` α0.10 | No: Δ5 / Δ11 / Δα 0.90 |
| `#ccc` (any value position; the `chart.tsx:66` `\#ccc` is a selector and is never scanned) | 204,204,204 | staging `--chart-1` 214,211,209; prod `--chart-1` 199,214,232 | No: Δ10 / ΔB 28 |
| `#000` (black decl, if emitted) | 0,0,0 | staging bg 12,10,9; prod `--primary-foreground` ≈5,12,32 | No: Δ≥12 |
| yellow-400 `oklch(0.852 0.199 91.936)` | 253,199,0 | no yellow token in N | No |
| yellow-500 `oklch(0.795 0.184 86.047)` | 240,177,0 | as above | No |
| blue-400 `oklch(0.707 0.165 254.624)` | 81,162,255 | prod `--chart-2` 83,182,235 | No: ΔG 20 |
| blue-500 `oklch(0.623 0.214 259.815)` | 43,127,255 | prod `--primary` 81,133,233 | No: ΔR 38 |
| `hsl(38 92% 50%)` (`:287,515`; present until S6) | 245,159,10 | none orange; prod `--chart-4` ≈182,99,183 | No: Δ≥60 |
| `hsl(163 100% 44%)` (`:555`; present until S6) | 0,224,161 | staging `--sidebar-primary` 0,188,125; prod `--chart-3` ≈0,174,183 | No: ΔG 36 / 50 |
| buy `hsl(159 52% 54%)` (shared literal) | 77,199,156 | staging `--sidebar-primary` 0,188,125 | No: ΔR 77 |
| sell `hsl(359 63% 67%)` | 224,118,120 | prod `--chart-4` ≈182,99,183 | No: ΔR 42 |
| paper / warning `hsl(43 41% 64%)` | 201,180,126 | staging `--muted-foreground` 166,160,155 | No: ΔR 35 |
| `color-mix(… var(--secondary), var(--foreground) 5%)`, `hsl(var(--sidebar-border))` (until S6), `[--radius:var(--radius-xl)]` | — | yield no literal (tokenizer) | n/a |

- The minimum margin is Δ5 (`#fff` vs staging fg), against ±2 hand error. Rows marked "computed" were computed exactly through OKLab; the others are ±several but sit far from any threshold.
- S1 records the actual emitted literal inventory with a one-off `node -e` over `cssDeclarations`/`colorLiterals`. The S5 gate proves the result exactly in both builds.

**Reconciliation of checks:**

| Check | Decision | Why |
|---|---|---|
| (a) | **Narrowed** to literal T-name declarations; `var(`/`calc(` values skipped; ≥1 literal per token | Today `sidebar.tsx:322,356` `[--radius:var(--radius-xl)]` would fail every build (R7 item 1) |
| R7 (b) asymmetric leak set | **Replaced by symmetric (b)** | It missed theme-colour literals that are also palette/fallback values in builds of the other theme (R7 item 4) |
| R7 (d) palette collision | **Removed** | Strict subset of symmetric (b); same N |
| (b′) AC-1 pin | Kept as tests only | (a) and (b) cover every occurrence |
| (c) | Unchanged | AC-5 |

**Filter.** The narrow `ui-theme` filter stays. `e2e-build` runs on any `services/xstockstrat-ui/**` change:
- the `xstockstrat-ui` filter is `['services/xstockstrat-ui/**', '.do/**']` (`ci.yml:64`);
- the `e2e-build` `if:` includes `'xstockstrat-ui'` (`ci.yml:534-538`);
- it builds `Dockerfile.e2e`, whose builder runs `pnpm --filter xstockstrat-ui run build` (`Dockerfile.e2e:65`), which is the `package.json:8` chain.

So a shadcn primitive PR under `src/components/ui/**` runs (b).

#### C — FR-11 tokenization (S6)
Recharts literals become `var(--chart-1..4)`, `var(--chart-grid)`, `var(--muted-foreground)`, `var(--color-buy|sell)`, `var(--card)`, `var(--color-value|score)`. Precedents: `ChartContainer` (`chart.tsx:97`), `PerformanceDashboard.tsx:40,213`, `FormulaRunResult.tsx:10,25`.

Sites:
- `EquityCurveChart.tsx:21-27,155,201-202,263`
- `data-explorer/page.tsx:56-57,272,291,559,568`
- `insights/page.tsx:59,181-190`
- `strategies/[id]/page.tsx:287,515` → `text-warning`, and `:555` → `text-buy`
- `sidebar.tsx:455` (`shadow-[0_0_0_1px_hsl(var(--sidebar-border))]` plus the accent variant) → `shadow-[0_0_0_1px_var(--sidebar-border)]` and the accent equivalent, marked `// app-specific`
- **`layout.tsx:20`** `themeColor: '#0a0e14'` → `themeColor: process.env.UI_THEME_BACKGROUND_HEX`. This is moved here from S7: the AC-12 regex `#[0-9a-fA-F]{6}\b` (`acceptance.feature:82`) matches `#0a0e14`, so `noColorLiterals.test.ts` would fail in S6 otherwise.

#### D — FR-12 manifest (S7)
- Delete `public/manifest.webmanifest`.
- Add `src/app/manifest.webmanifest/route.ts`:
  - `dynamic='force-dynamic'`, same fields;
  - `theme_color`/`background_color` = `process.env.UI_THEME_BACKGROUND_HEX`;
  - `Content-Type: application/manifest+json`.
- Preserved:
  - the URL;
  - the middleware exclusion (`middleware.ts:22`);
  - `metadata.manifest` (`layout.tsx:12`);
  - no-cache (`next.config.js:23`);
  - `/sw.js`;
  - `pwa.spec.ts:14-24` (display, `start_url /trader`, 192/512, maskable).
- The themeColor change is in S6 (§1 C).
- Fallback if the S2 spike fails: `next.config.js` writes a gitignored `public/manifest.webmanifest` at config load.
- Update the comment at `Dockerfile:27-28`.

#### E — Images and CI
**Images**
- `Dockerfile`: a global `ARG UI_THEME=staging`; `ARG UI_THEME` in the builder before `:20`; `ARG UI_THEME` plus `LABEL io.xstockstrat.ui-theme=$UI_THEME` in the runner; no runtime ENV.
- The runner copies static assets to `/app/services/xstockstrat-ui/.next/static` (`Dockerfile:23,26`). That is the CSS extraction path.
- `Dockerfile.e2e`: the same ARGs, plus runner `ENV UI_THEME=$UI_THEME`.
- `playwright.config.ts:163` becomes `APPLICATION_ENV: process.env.E2E_APPLICATION_ENV ?? 'development'`. The default keeps the config-ui specs green.

**`ui-theme` paths filter.** Inserted after the `sops:` block, which ends at `ci.yml:101`, and before `ledger:` (`:102`). This is outside the `config-wiring` block that `config-wiring.test.mjs:663-675` parses.
- `services/xstockstrat-ui/` paths: `src/styles/**`, `src/app/globals.css`, `src/app/layout.tsx`, `src/app/manifest.webmanifest/**`, `src/app/insights/**`, `src/components/insights/**`, `src/components/ui/sidebar.tsx`, `src/lib/chartColors.ts`, `src/hooks/useCandlestickChart.ts`, `next.config.js`, `postcss.config.js`, `package.json`, `Dockerfile`, `playwright.config.ts`, `e2e/theme/**`, `e2e/helpers/**`, `e2e/fixtures/**`, `e2e/mock-backend.ts`
- plus `Dockerfile.e2e`.

**Both new jobs copy the `e2e-build` pattern (`ci.yml:540-554`):**
- `actions/checkout@v7` (`:541`);
- `docker/setup-buildx-action@v3` (`:544`);
- `docker/build-push-action@v6` (`:547`);
- `context: .`, `load: true`;
- `type=gha` `cache-from`/`cache-to` with `mode=max` (`:549-554`).

Report extraction mirrors `frontend-e2e` (`:596-608`).

**`frontend-e2e-production` job** (inserted after `frontend-e2e`):
```yaml
  frontend-e2e-production:
    name: Frontend E2E (production theme)
    needs: changes
    if: >-
      contains(fromJson(needs.changes.outputs.matched), 'ui-theme') ||
      contains(fromJson(needs.changes.outputs.matched), 'ci')
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7

      - name: set up docker buildx
        uses: docker/setup-buildx-action@v3

      - name: build production-theme e2e image
        uses: docker/build-push-action@v6
        with:
          context: .
          file: Dockerfile.e2e
          build-args: UI_THEME=production
          tags: xstockstrat-e2e:prod
          load: true
          cache-from: |
            type=gha,scope=e2e-build
            type=gha,scope=e2e-build-production
          cache-to: type=gha,scope=e2e-build-production,mode=max

      - name: run production-theme e2e (theme specs; AC-10 excluded)
        run: |
          docker run \
            --name e2e-production \
            xstockstrat-e2e:prod \
            e2e/theme/ --grep-invert @AC-10

      - name: extract playwright report
        if: always()
        run: |
          docker cp e2e-production:/workspace/services/xstockstrat-ui/playwright-report ./playwright-report 2>/dev/null || true
          docker rm e2e-production 2>/dev/null || true

      - name: upload playwright report
        if: always()
        uses: actions/upload-artifact@v7
        with:
          name: playwright-report-production
          path: playwright-report/
          retention-days: 7
```
The arguments are appended to the image's `ENTRYPOINT ["pnpm", "test:e2e"]` (`Dockerfile.e2e:121`), the same way `frontend-e2e` passes `--shard` (`ci.yml:591-594`).

**`ui-prod-image-build` job:**
```yaml
  ui-prod-image-build:
    name: UI production image (theme label + CSS check)
    needs: changes
    if: >-
      contains(fromJson(needs.changes.outputs.matched), 'ui-theme') ||
      contains(fromJson(needs.changes.outputs.matched), 'ci')
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7

      - uses: actions/setup-node@v7
        with:
          node-version: "24"

      - name: set up docker buildx
        uses: docker/setup-buildx-action@v3

      - name: build production UI image
        uses: docker/build-push-action@v6
        with:
          context: .
          file: services/xstockstrat-ui/Dockerfile
          build-args: UI_THEME=production
          tags: xstockstrat-ui:prod-ci
          load: true
          push: false
          cache-from: |
            type=gha,scope=xstockstrat-ui
            type=gha,scope=ui-prod-image-build
          cache-to: type=gha,scope=ui-prod-image-build,mode=max

      - name: assert theme label and re-check the image's CSS
        run: |
          [ "$(docker inspect -f '{{ index .Config.Labels "io.xstockstrat.ui-theme" }}' xstockstrat-ui:prod-ci)" = production ] || { echo "::error::ui-theme label is not production"; exit 1; }
          cid=$(docker create xstockstrat-ui:prod-ci)
          docker cp "$cid:/app/services/xstockstrat-ui/.next/static/css" "$RUNNER_TEMP/ui-css"
          docker rm "$cid" >/dev/null
          UI_THEME=production node services/xstockstrat-ui/src/styles/themes/checkThemeBundle.cjs --css-dir "$RUNNER_TEMP/ui-css"
```
- `setup-node` copies `ci.yml:515-517` without the pnpm cache, because the checker is dependency-free. It pins Node 24 for `readdirSync({recursive})`.
- `scope=xstockstrat-ui` is the deploy cache (`docker-build.yml:88-89`), read-only here. It warms the theme-independent `deps` stage.
- The checker resolves its sources from `__dirname`, so they come from the same checkout SHA as the image. It runs (c) from S4 and (a)–(c) from S5.

**AC-10 loop.** A new step in `frontend-e2e` after "run e2e tests" (`ci.yml:589-594`) and before "extract playwright report" (`:596`):
```yaml
      - name: AC-10 staging theme under each APPLICATION_ENV
        if: matrix.shard == 1
        run: |
          for env in staging production; do
            echo "AC-10 run with APPLICATION_ENV=$env"
            docker run --rm -e E2E_APPLICATION_ENV="$env" xstockstrat-e2e:ci e2e/theme/theme-bundle.spec.ts --grep @AC-10 || exit 1
          done
```
- `xstockstrat-e2e:ci` is built with no build-arg, so it is staging.
- The @AC-10 test has no skip: it always asserts staging. The production job excludes it with `--grep-invert`, so a mis-themed image fails instead of skipping.

**ci-gate.** Append `- frontend-e2e-production` and `- ui-prod-image-build` to `needs` (`ci.yml:1117-1140`), and add to the echo block (`:1145-1167`):
```yaml
          echo "frontend-e2e-production: ${{ needs.frontend-e2e-production.result }}"
          echo "ui-prod-image-build: ${{ needs.ui-prod-image-build.result }}"
```
A skipped result passes (`:1169-1178`).

**Specs**: `e2e/theme/theme-bundle.spec.ts` plus 3 aria goldens:
- shell banner and navigation;
- /trader main;
- /insights/strategies/strat-history-001 with bt-hist-2 opened.

They reuse the `backtest-sizing.spec.ts:32-43` stubs, the `mock-backend.ts` fixed epochs and `page.clock.setFixedTime`. One golden serves both themes (Playwright 1.62's default snapshot path has no theme suffix).

#### F — Deploy guards
**`scripts/ui-theme-label.sh`** (bash 3.2)
- A single registry constant at line start: `UI_IMAGE_REPO=ghcr.io/davcs86/xstockstrat/xstockstrat-ui`.
- Both subcommands take a tag:
  - `refuse-retheme <tag> <theme>`
  - `require-match <tag> <target_env>`
- Each reads `docker buildx imagetools inspect "$UI_IMAGE_REPO:$tag" --format '{{json .Image}}'`. jq picks the rootfs shape or the `["linux/amd64"]` shape; anything else errors.
- `refuse-retheme` outcomes:
  - absent, equal, or no label → proceed;
  - differs → `::error::refusing to re-theme <ref>: SHA <tag> already built with UI theme <x>; was main-dev fast-forwarded to main? Back-merges must be --no-ff`, exit 1;
  - any other inspect failure → fail.
- `require-match` outcomes:
  - absent → `::error::<ref> not found; was docker-build.yml run for <tag>?` (keeps platform @AC-10);
  - equal → pass;
  - no label → silent pass on staging; on production, a `::warning::` naming the unlabelled image;
  - differs → `::error::xstockstrat-ui:<tag> carries io.xstockstrat.ui-theme=<x>; refusing to deploy to <env>`;
  - any other failure → fail.

**`scripts/ui-theme-label.test.sh`**
- Line 2 carries the file-level directive, in house style (`sops-secrets.test.sh:4`):
```bash
#!/usr/bin/env bash
# shellcheck disable=SC2015,SC2016 # `A && B || fail` is the assertion idiom (fail always exits); literal ${{ }} is matched text
set -uo pipefail
```
- Puts a fake `docker` on PATH and covers both JSON shapes, AC-15, and all 11 AC-16 rows.
- Static yq asserts:
  - the docker-build `ui_theme` input is required;
  - `.jobs.build.needs == preflight-ui-theme`;
  - preflight step order is checkout → case → login → refuse-retheme;
  - each caller passes the right `with.ui_theme`;
  - homelab-images has a required choice input.
- Registry-drift asserts (§7 S9).

**docker-build.yml**
- `inputs.ui_theme` is required, type string.
- New `preflight-ui-theme` job:
  - `permissions: {contents: read, packages: read}`;
  - steps: `actions/checkout@v7`; a `case` validation; `docker/login-action@v4` (as `:65-71`); `bash scripts/ui-theme-label.sh refuse-retheme "$TAG" "$T"` via `env:`.
- `build` gets `needs: preflight-ui-theme`.
- Build-args: `build-args: ${{ matrix.service == 'xstockstrat-ui' && format('UI_THEME={0}', inputs.ui_theme) || '' }}`. The cache scope is unchanged (`:88-89`).

**Callers**
- `deploy-dev.yml:37`: `ui_theme: staging`.
- `deploy-prod.yml:36`: `ui_theme: production`.
- `homelab-images.yml:23`: `ui_theme: ${{ inputs.ui_theme }}`, from a new required `workflow_dispatch` choice input `[staging, production]`. The summary at `:35` names it.

**Deploy-path steps.** Each is a `run:` step, not `uses:`, because of `sops-secrets.test.sh:1031-1032,1083`. Each has `id: ui-theme` and logs in with the exact `deploy-homelab.yml:123` form.

`prod-up.yml`: inserted between `check` (`:36-49`) and `db` (`:51`). Job permissions (`:27-28`) gain `packages: read`.
```yaml
      - name: The UI image's theme label must match production
        id: ui-theme
        if: steps.check.outputs.app_id == ''
        env:
          IMAGE_TAG: ${{ inputs.image_tag }}
          GH_TOKEN: ${{ github.token }}
        run: |
          printf '%s' "$GH_TOKEN" | docker login ghcr.io -u "$GITHUB_ACTOR" --password-stdin
          bash scripts/ui-theme-label.sh require-match "$IMAGE_TAG" production
```
- `staging-up.yml`: the same step between `:33-46` and `:48`, with `staging`; `packages: read` added at `:24-25`.
- `deploy.yml` `validate` job (`:22-29`):
  - add `permissions: {contents: read, packages: read}`;
  - after the existing case step, add `actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1  # v7.0.1` (the `:44` pin);
  - then the `ui-theme` step with `env: {E: ${{ inputs.environment }}, IMAGE_TAG: ${{ inputs.image_tag }}, GH_TOKEN: ${{ github.token }}}` and `require-match "$IMAGE_TAG" "$E"`;
  - `deploy` already `needs: validate` (`:32`), so this runs before secrets and before `doctl apps update` (`:101`).
- `deploy-homelab.yml`: the `ui-theme` step goes between "Validate the image tag" (`:73-86`) and setup-sops (`:88`).
  - It runs from the workflow commit, before the image-commit checkout at `:111-116`.
  - It uses `IMAGE_TAG` from `GITHUB_ENV` (`:86`), `GH_TOKEN: ${{ github.token }}`, and `require-match "$IMAGE_TAG" "$TARGET_ENV"`.
  - `packages: read` already exists at `:59`.

#### G — Promotion
- **Sync merge.** `sync-main-to-maindev.yml:52` becomes `if ! git merge --no-ff origin/main \`.
- **Sync concurrency.** Workflow-level `concurrency: { group: sync-main-to-maindev, cancel-in-progress: false }` goes between `on:` and `jobs:` (style of `deploy-homelab.yml:54-56`). The retry loop `:61-74` is unchanged.
- **Promote gate.** `promote.yml:40-47` becomes:
  `if git diff --quiet origin/main...origin/main-dev; then echo "::error::main-dev has no changes since its merge base with main. Nothing to promote."; exit 1; fi`
  It sits before "Commit and push changelog" (`:188-193`).
- **Rewording.** `promote.yml:223` is reworded.
- **promote SKILL.md.** The same gate goes in at `:64-69`, and `:223` is reworded. Prose at `:332-334` and `:341-343` explains the `--no-ff` merge commit: SHA-tagged images are themed per environment.
- **--no-ff doc sites** (all verified):
  - `.github/PULL_REQUEST_TEMPLATE/hotfix.md:49`
  - `docs/runbooks/feature-workflow.md:272`
  - `docs/runbooks/bug-triage.md:95`
  - `.claude/skills/sdd-triage/reference/backmerge.md:14`
- **CI wiring.** New `scripts/backmerge-no-ff.test.sh` (S10). The `ci.yml:705` chain appends `&& bash scripts/ui-theme-label.test.sh` in S9 and `&& bash scripts/backmerge-no-ff.test.sh` in S10.
- **Filter entries.**
  - The `scripts` filter (`ci.yml:68-70`; it already matches `scripts/**`) gains: `.github/workflows/{deploy,docker-build,deploy-dev,deploy-prod,prod-up,staging-up,homelab-images,deploy-homelab,sync-main-to-maindev,promote}.yml`, `hotfix.md`, `feature-workflow.md`, `bug-triage.md`, `backmerge.md`, `promote/SKILL.md`.
  - The `sops` filter (`ci.yml:87-101`) gains `scripts/ui-theme-label.sh`.

#### H — Docs
- **ui-ux-governance.md**
  - §1: per-theme `:root` values, dark-only.
  - §5 item 8: the WCAG baseline plus fenced `<!-- 307:staging-contrast-deviations:begin/end -->` lines of the form `- <a>/<b>: <ratio>`. The fence itself is created in S3.
  - §7: a scoped exception for the 3 aria goldens.
  - §9 row g: staging shortfalls → §5.
  - §9 row h: palette utilities (`badge.tsx:25-26`, `alert.tsx:15,17`, `PerformanceDashboard.tsx:120`, `screener/page.tsx:568`, `StatTile.tsx:28`).
  - The hardcoded-theme-colour trap, written without literal utility or palette-var names (§7 S11). It **fails every build** (check (b)).
- **UI CLAUDE.md**
  - Styling: per-theme `:root`; checks (a)–(c); `source('..')` scope; the trap; the Turbopack note; the shadcn re-apply line (§7 S11).
  - Docker: ARG/LABEL.
  - PWA: the manifest route.
- **Other docs**: `docker-build.md`, `infra-cost-reduction.md`, `ci-overview.md` (two new job rows near `:26-27`).
- **Acceptance**: `platform.feature:1164-1169` @AC-19 rewritten plus an @feature-307 note.
- **"Permanently ahead" rewording** (verified sites): root `CLAUDE.md:345`, `promote.yml:223`, `promote/SKILL.md:223`, `.github/PULL_REQUEST_TEMPLATE/promotion.md:15-16`, `docs/launch-pdfs/infra-ci.md:163`.

Round-4 and round-5 rationale (H1, M1–M3, L1–L6) carries over unchanged from R5 §1.

### Tokens and pinned literals

| Token(s) | Production value |
|---|---|
| background | `oklch(0.16 0.022 262)` = #080d17 |
| foreground family | `oklch(0.975 0.006 250)` |
| card / popover / sidebar | `oklch(0.22 0.026 262)` |
| primary | `oklch(0.63 0.16 262)` |
| primary-foreground | `oklch(0.16 0.04 264)` |
| secondary | `oklch(0.27 0.02 260)` |
| secondary-foreground (shared) | `oklch(0.985 0 0)` |
| muted | `oklch(0.265 0.02 258)` |
| muted-foreground | `oklch(0.72 0.02 255)` |
| accent / sidebar-accent | `oklch(0.285 0.03 262)` |
| destructive (shared) | `oklch(0.704 0.191 22.216)` |
| border / sidebar-border | `oklch(0.75 0.04 260 / 18%)` |
| input | `oklch(0.75 0.04 260 / 24%)` |
| ring / sidebar-ring | `oklch(0.62 0.12 262)` |
| radius | `0.45rem` |
| chart-1 | `oklch(0.87 0.03 255)` |
| chart-2 | `oklch(0.74 0.12 235)` |
| chart-3 | `oklch(0.68 0.11 200)` |
| chart-4 | `oklch(0.64 0.15 320)` |
| chart-5 | `oklch(0.58 0.06 255)` |
| chart-grid | `oklch(0.45 0.03 260 / 0.55)` (decorative, exempt under WCAG 1.4.11) |
| sidebar-primary | `oklch(0.68 0.16 285)` |
| sidebar-primary-foreground | `oklch(0.2 0.06 285)` |

Shared in `@theme inline`: buy `hsl(159 52% 54%)`, sell `hsl(359 63% 67%)`, paper `hsl(43 41% 64%)`, warning `hsl(43 41% 64%)`. Dark-only (`ui-ux-governance.md:46-49`).

**Non-shared set N for (b):** every colour token except `secondary-foreground` and `destructive`.
- Shared tokens that equal palette values are exempt: `destructive` = red-400, `secondary-foreground` = neutral-50.
- Staging values that equal palette values fail (b) in every build when emitted as any non-token literal: `--background` = stone-950, `--primary` = emerald-800, `--chart-5`/`--muted`/`--accent` = stone-800, `--sidebar-primary` = emerald-500, and others.
- A literal within ±1 of both a shared value and a non-shared value (for example ≈ neutral-50 vs staging `--foreground`) fails, citing the non-shared token.

**Contrast, text pairs (≥4.5):**
| Pair | Ratio |
|---|---|
| fg / bg | 18.07 |
| card-fg / card | 16.13 |
| primary-fg / primary | 5.46 |
| secondary pair | 14.43 |
| muted-fg / muted | 6.18 |
| accent pair | 13.37 |
| sidebar-primary-fg / sidebar-primary | 6.07 |
| primary on bg / card | 5.45 / 4.86 |
| muted-fg on bg / card | 7.84 / 6.99 |
| destructive on bg / card | 6.71 / 5.99 |
| warning on card | 8.47 |

**Contrast, non-text (≥3):**
| Pair | Ratio |
|---|---|
| ring / bg | 5.28 |
| chart-1 on card / bg | 11.71 / 13.12 |
| chart-2 on card / bg | 7.67 / 8.60 |
| chart-3 on card / bg | 6.30 / 7.06 |
| chart-4 on card / bg | 4.80 / 5.38 |
| chart-5 on card / bg | 4.05 / 4.54 |

- Minimum adjacent ΔE_ok is 0.092.
- Hand figures are ±0.02; the helper is exact. If the helper differs from an AC pin by more than 0.05, S3 stops and asks the operator to re-pin (P-03).

**Staging deviation set, AC-17 (8 pairs):**
| Pair | Ratio |
|---|---|
| primary / background | 2.6 |
| primary / card | 2.3 |
| chart-3 / background | 2.6 |
| chart-3 / card | 2.3 |
| chart-4 / background | 1.9 |
| chart-4 / card | 1.7 |
| chart-5 / background | 1.3 |
| chart-5 / card | 1.2 |

**Pinned literals:**
- AC-1: `oklch(0.63 0.16 262)`; the Nocturne `oklch(0.432 0.095 166.913)` is absent.
- AC-8: 18.07 and 5.46.
- AC-13: #080d17 production, #0c0a09 staging.
- AC-10: staging body bg #0c0a09 = rgb(12, 10, 9).

### Implementation steps (input to /sdd-spec)

Common UI verification, written **V-UI**:
`cd services/xstockstrat-ui && pnpm run lint && pnpm exec tsc --noEmit && pnpm run test:unit && cd ../.. && bash scripts/check-duplication.sh services/xstockstrat-ui/src`
The last part is the pre-commit gate (`.husky/pre-commit:12-13`).

#### S1 — RED spike: CSS emission, toolchain, scan scope, tokenizer, checker CLI
**Files:**
- `src/styles/themes/uiTheme.cjs` (S1 exports, §1 A, including `cssDeclarations`/`colorLiterals`) and `uiTheme.test.ts`.
  - **Parser cases:** % L; alpha as number and %; keyword skip; fail-closed lab/lch/oklab/hwb/`color()`; the `colorsEqual` alpha rule.
  - **Tokenizer cases (§1 B):**
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
    - `transparent`/`currentcolor`/`red` → []
  - **Structure cases for `cssDeclarations`:**
    - comments stripped, including a comment containing `oklch(1 0 0 / 10%)`;
    - a selector `.x\[stroke\=\'\#ccc\'\]` and `[stroke='#fff']` yields no literal;
    - an `@supports (color: color-mix(in lab, red, red))` prelude yields none, while its inner declarations are scanned;
    - `@property { initial-value: #fff }` is scanned;
    - `!important` is stripped;
    - offsets are correct.
- `checkThemeBundle.cjs` with check (c) and the full CLI: `--css-dir`, recursive `**/*.css`, default `.next/static/css`, zero-file failure, the OK line, and **sources = `globals.css` only**.
- `checkThemeBundle.test.ts`:
  - (c) fixtures;
  - the CLI spawned via `node` over a temp dir with a nested `chunks/x.css`, to prove the recursive listing;
  - an empty dir fails;
  - the default dir is cwd-relative.
- `src/app/globals.css`:
  - `:1` → `@import 'tailwindcss' source('..');`;
  - `:2` unchanged, then `@source not "../**/*.test.ts";` and `@source not "../styles/themes";`;
  - one 2-line constraint comment: text naming palette utilities or vars emits palette CSS that the theme check rejects in every build;
  - add `--color-warning`.
- Static pin in `checkThemeBundle.test.ts`: line 1 is exactly `@import 'tailwindcss' source('..');`, line 2 is the `tw-animate-css` import, and both `@source not` lines appear after line 2.
- `package.json:8` build chain.
- `.eslintrc.json` `*.cjs` override.

**Verify:**
1. `pnpm run test:unit -- src/styles`
2. Lint RED probe: without the override, `pnpm run lint` fails on the `.cjs` require. With it, lint passes. If `next lint` skips `.cjs`, append `eslint src/styles/themes/*.cjs` to the lint script.
3. Run `pnpm build` before and after the `source('..')` edit. Diff the `.next/static/css` selector sets: only selectors whose class strings live outside `src/`, or only in the now-excluded `src/**/*.test.ts` / `src/styles/themes/**`, may disappear. The `:root` token declarations must be byte-identical.
4. After the edit, record in context.md:
   - whether `--color-buy`/`sell`/`paper`/`warning` are emitted (Open Risk 1). If any is missing, take the unlayered `:root` fallback in this step so (c) passes.
   - candle-colour status;
   - the full non-token colour-literal inventory, from a one-off `node -e` over `cssDeclarations`/`colorLiterals`, checked against the §1 B table;
   - the `color-mix` and fallback forms; any named colour or lab/lch/oklab/`color()`.
5. `node src/styles/themes/checkThemeBundle.cjs --css-dir .next/static/css` prints the OK line.
6. CI: `e2e-build` is green. It runs the chain, and therefore (c), in the staging build.

#### S2 — RED spike: manifest route
**Files:** a throwaway route on the spike branch.
**Verify:** `pnpm build && pnpm start`. Then:
- `curl -sI localhost:3000/manifest.webmanifest` shows `Cache-Control: no-cache` and `application/manifest+json`;
- the route table shows ƒ;
- the page has exactly one `<link rel="manifest">`.

Record the result.

#### S3 — Token split and selection
**Files:**
- `src/lib/chartColors.ts:6` comment → "Defined per theme in `src/styles/themes/*.css`" (stale after the split);
- `staging.css` (the `:root` block from `globals.css:87-125`, verbatim, unlayered) and `production.css`.
- `globals.css`: remove `:83-125` (the preset comment `:83-86` plus the `:root` block `:87-125`) and the blank `:126`. `:82` `@layer base {` stays, followed by the `*` (`:127-129`), `body` (`:131-136`) and `html` (`:138-140`) rules and the closing brace (`:141`).
- `layout.tsx:3`.
- `next.config.js`: `resolveUiTheme`, the `@theme-tokens$` alias, and **`env: { UI_THEME_BACKGROUND_HEX: themeBackgroundHex(theme) }`**.
- `uiTheme.cjs` gains `themeCssPath` and `themeBackgroundHex`, with tests.
- `themes.test.ts`:
  - AC-8 pins and the AC-14 pair set;
  - AC-1 guard: no production token is `colorsEqual` to `oklch(0.432 0.095 166.913)`;
  - each theme file is exactly one `:root{}` with only custom-property declarations, and the two name sets are equal;
  - AC-17 parses the §5 fenced list.
- `docs/patterns/ui-ux-governance.md`: the §5 fence only (created here so AC-17 can parse it).
- `nextConfig.test.ts`:
  - AC-3;
  - `env.UI_THEME_BACKGROUND_HEX` equals `themeBackgroundHex(theme)` for both themes;
  - AC-4 spawn;
  - FR-10 static: `APPLICATION_ENV` absent from next.config.js, `src/styles/themes/**`, layout.tsx and the manifest route.

**Verify:**
- V-UI;
- `pnpm build` and `UI_THEME=production pnpm build`;
- `UI_THEME=prod pnpm build` exits non-zero naming "staging" and "production";
- `./scripts/check-context-map.sh`.

#### S4 — Build provenance and production CI jobs
**Files:**
- `services/xstockstrat-ui/Dockerfile`, `Dockerfile.e2e`, `playwright.config.ts:163`
- `.github/workflows/ci.yml`: the `ui-theme` filter; `frontend-e2e-production` and `ui-prod-image-build` (YAML in §1 E); the AC-10 step in `frontend-e2e`; ci-gate needs and echo
- seed `e2e/theme/theme-bundle.spec.ts`:
  - `@AC-10`: the /trader body bg, canonicalised via `cssColorToSrgb`, must `colorsEqual` `#0c0a09`, and `themeBackgroundHex('staging') === '#0c0a09'`. No skip.
  - AC-7 bg part: body bg equals `themeBackgroundHex(process.env.UI_THEME)`.
- `docs/patterns/ci-overview.md` job rows.

**Verify:**
- Hadolint on both Dockerfiles:
  - `docker run --rm -i -v "$PWD/.hadolint.yaml:/.config/hadolint.yaml" hadolint/hadolint < services/xstockstrat-ui/Dockerfile`
  - the same for `Dockerfile.e2e`.
- `docker build --build-arg UI_THEME=production -f services/xstockstrat-ui/Dockerfile -t ui:p .`, then `docker inspect -f '{{ index .Config.Labels "io.xstockstrat.ui-theme" }}' ui:p` prints `production`.
- Run the `ui-prod-image-build` script locally against `ui:p`: `docker create`/`docker cp …/.next/static/css`, then `UI_THEME=production node services/xstockstrat-ui/src/styles/themes/checkThemeBundle.cjs --css-dir <dir>` prints the OK line. That is the S1 CLI, running (c) only until S5.
- `node --test scripts/config-wiring.test.mjs` (the filter parser is intact).
- `actionlint .github/workflows/ci.yml` if available.
- CI: `frontend-e2e` (both shards plus the AC-10 step), `frontend-e2e-production`, `ui-prod-image-build`.

#### S5 — Full checker
**Files:**
- `checkThemeBundle.cjs`:
  - the source loader extended to `staging.css`/`production.css` via `themeCssPath`;
  - T, N and classification (§1 B);
  - (a) on literal values only;
  - symmetric (b) with the exact message text.
- `checkThemeBundle.test.ts`. **Fixtures**, each run through `checkBundle` for **both** `staging` and `production` unless noted:
  - **(a), arbitrary property.**
    - `.s{--radius:var(--radius-xl)}` plus a literal `:root` passes (the `sidebar.tsx:322,356` case).
    - `.s{--primary:calc(1px)}` is skipped by (a).
    - A bundle whose only `--background` declaration is `var(--x)` fails with "theme token --background has no literal declaration".
    - `.s{--primary:var(--x, oklch(0.432 0.095 166.913))}` fails via (b): the fallback is scanned.
  - **(a), wrong value.** A production build with the staging `--primary` literal as a `:root` declaration fails (a).
  - **(a), unparseable.** `--primary: red` fails "unparseable token value".
  - **(b), symmetric.**
    - A palette declaration equal to a staging non-shared token fails in both calls with exactly `colour literal <v> at <file>:<offset> equals staging --<name>; use the theme token`.
    - The same for a production token.
  - **(b), pre-computed translucent fallback.** `.x{border-color:#ffffff1a}` fails in both calls, equal to staging `--border`.
  - **(b), color-mix operand.** `color-mix(in oklab, <prod --chart-2 literal> 50%, transparent)` fails in a staging call.
  - **(b), var()-argument colour functions.** `hsl(var(--sidebar-border))` and `color-mix(in oklch, var(--secondary), var(--foreground) 5%)` pass.
  - **(b), selector-only.** `.a\[stroke\=\'\#ccc\'\]{stroke:var(--border)}` passes.
  - **Tolerance:** off by 1 channel fails; off by 2 passes; Δα 0.01 fails; Δα 0.02 passes.
  - **Alpha rule:** an opaque white declaration vs staging `--border` passes.
  - **Shared exemptions:** the `--destructive` value as a palette declaration passes; the four shared literals pass.
  - **AC-1 (named):** a production bundle containing `oklch(0.432 0.095 166.913)` as a plain declaration fails via (b); as a `--primary` declaration it fails via (a).
  - **Concatenated names (defense in depth).** Every palette class and var name in a fixture is built at runtime, e.g. `const pal = (f, n) => ['--color', f, String(n)].join('-')`. No literal palette utility or `--color-<family>-<n>` appears in source.
- `uiTheme.cjs`: unchanged API.

**Verify:**
1. V-UI.
2. Scan and symmetric RED/GREEN probe (record in context.md):
   - (i) Create `src/styles/themes/probe.test.ts` containing a literal stone-950 background utility and a literal `var()` of its palette var. `pnpm build` and `UI_THEME=production pnpm build` must both PASS, because the file is excluded.
   - (ii) Move the same content to `src/probe.ts` as `export const probe = '…';`.
     - `pnpm build` (staging) must FAIL with (b) "equals staging --background". This proves the always-run build catches it.
     - `UI_THEME=production pnpm build` must FAIL with the same line.
     - The run also answers whether bare `--color-*`/`var(--color-*)` strings emit.
   - (iii) Delete the probe.
3. **Gate:** `pnpm build` (staging) and `UI_THEME=production pnpm build` pass locally on today's tree. That tree still has `hsl(38 92% 50%)`, `hsl(163 100% 44%)` and `hsl(var(--sidebar-border))`. The run proves the §1 B table exactly.
   - On this PR, `e2e-build`/`frontend-e2e`, `frontend-e2e-production` and `ui-prod-image-build` (now running (a)–(c) on the extracted CSS) are green.
   - The `ui-theme` filter matches `src/styles/**`.

#### S6 — FR-11 tokenization and themeColor
**Files:**
- the §1 C sites, **including `layout.tsx:20`** → `process.env.UI_THEME_BACKGROUND_HEX` (introduced in S3);
- `src/styles/noColorLiterals.test.ts`:
  - a TS scanner applying the AC-12 regex verbatim from `acceptance.feature:82` to non-comment lines of `src/**/*.{ts,tsx}` outside `src/components/ui` and `*.test.ts`;
  - the `sidebar.tsx` assertion.

Must stay green: `src/lib/chartColors.test.ts`, `button.test.ts`, `badge.test.ts`.

**Verify:**
- V-UI. `noColorLiterals.test.ts` is green: the only remaining hits of the regex today are the §1 C sites plus `layout.tsx:20`, all edited here.
- `pnpm build`, then `pnpm start`, then `curl -s localhost:3000/auth/login | grep -o '<meta name="theme-color" content="[^"]*"'` shows `#0c0a09`.
- `UI_THEME=production pnpm build`, then the same curl shows `#080d17`.
- If Open Risk 1 recorded `--color-warning` as unemitted, re-check (c) now that `text-warning` exists.

#### S7 — Manifest
**Files:**
- delete `public/manifest.webmanifest`;
- `src/app/manifest.webmanifest/route.ts` (or the S2 fallback in `next.config.js` plus `.gitignore`);
- the `Dockerfile:27-28` comment;
- the spec gains an AC-13 test: manifest `theme_color`/`background_color` **and** the meta both equal `themeBackgroundHex(UI_THEME)`; no-cache; display; 192/512.

**Verify:**
- V-UI;
- `pnpm build && pnpm start` plus the S2 curl checks;
- `e2e/accounts/pwa.spec.ts` green (`pnpm test:e2e e2e/accounts/pwa.spec.ts`);
- CI `frontend-e2e` and `frontend-e2e-production`.

#### S8 — Goldens
**Files:** `e2e/theme/theme-bundle.spec.ts` and its `-snapshots/` goldens:
- AC-7 aria goldens ×3 plus visible text;
- AC-8/AC-11: no "Failed to parse color";
- AC-12: stroke equals `--chart-1` in both themes.

**Verify:** `./scripts/run-e2e.sh e2e/theme/`; CI `frontend-e2e` and `frontend-e2e-production`.

#### S9 — Deploy guards
**Files:**
- `scripts/ui-theme-label.sh` and `scripts/ui-theme-label.test.sh` (file-level directive on line 2, §1 F)
- `.github/workflows/{docker-build,deploy-dev,deploy-prod,homelab-images,deploy-homelab,prod-up,staging-up,deploy}.yml`
- `scripts/sops-secrets.test.sh`: new `group_uitheme` plus the helper below; `uitheme` appended to the default `groups` list at `:1385`
- `.github/workflows/ci.yml`: `scripts` filter entries, the `sops` filter entry, and the `:705` chain (`ui-theme-label.test.sh` only).

Registry drift in `ui-theme-label.test.sh` (bash 3.2, BRE sed). SC2015/SC2016 are covered by the line-2 file-level directive:
```bash
repo="$(sed -n 's/^UI_IMAGE_REPO=//p' scripts/ui-theme-label.sh)"
want="${repo%/xstockstrat-ui}"
[ -n "$repo" ] && [ "$want" != "$repo" ] || fail "drift: UI_IMAGE_REPO must be defined once and end in /xstockstrat-ui"
[ "$(sed -n 's|^[[:space:]]*REPO="\([^"$]*\)/\${{ matrix\.service }}"$|\1|p' .github/workflows/docker-build.yml)" = "$want" ] ||
  fail "drift: docker-build.yml REPO prefix != $want"
[ "$(sed -n 's|^  REGISTRY: ||p' .github/workflows/deploy-homelab.yml)" = "$want" ] ||
  fail "drift: deploy-homelab.yml REGISTRY != $want"
```
More than one matching line produces a multi-line string, so the comparison fails closed.

Added to `scripts/sops-secrets.test.sh`. That file's `:4` directive already covers SC2015/SC2016.
```bash
# ui_theme_step <wf> <job> <target-arg> <if|null> <label>: one hard run: step that logs in to GHCR then require-matches.
ui_theme_step() {
  local wf="$1" j="$2" sel run
  sel=".jobs.$j.steps[] | select(.id == \"ui-theme\")"
  [ "$(yq e "[$sel] | length" "$wf")" = 1 ] || fail "$5: expected exactly one ui-theme step in $wf job $j"
  [ "$(yq e "$sel | has(\"uses\") or has(\"continue-on-error\")" "$wf")" = false ] || fail "$5: ui-theme must be a hard run: step"
  [ "$(yq e "$sel | .if" "$wf")" = "$4" ] || fail "$5: $wf ui-theme if"
  [ "$(yq e "$sel | .env.GH_TOKEN" "$wf")" = '${{ github.token }}' ] || fail "$5: $wf ui-theme env.GH_TOKEN"
  run="$(yq e "$sel | .run" "$wf")"
  grep -qF 'docker login ghcr.io -u "$GITHUB_ACTOR" --password-stdin' <<<"$run" || fail "$5: $wf ui-theme GHCR login"
  grep -qF "bash scripts/ui-theme-label.sh require-match \"\$IMAGE_TAG\" $3" <<<"$run" || fail "$5: $wf ui-theme require-match"
  if grep -qF '${{' <<<"$run"; then fail "$5: $wf ui-theme run inlines an expression"; fi
  [ "$(yq e ".jobs.$j.permissions.packages" "$wf")" = read ] || fail "$5: $wf job $j needs packages: read"
}

group_uitheme() {
  need yq
  local wf e i
  for e in prod-up:production staging-up:staging; do
    wf=".github/workflows/${e%%:*}.yml"
    ui_theme_step "$wf" up "${e#*:}" "steps.check.outputs.app_id == ''" uitheme
    [ "$(yq e '.jobs.up.steps[] | select(.id == "ui-theme") | .env.IMAGE_TAG' "$wf")" = '${{ inputs.image_tag }}' ] || fail "uitheme: $wf env.IMAGE_TAG"
    i="$(step_idx "$wf" up '.value.id == "ui-theme"')"
    [ "$(step_idx "$wf" up '.value.id == "check"')" -lt "$i" ] && [ "$i" -lt "$(step_idx "$wf" up '.value.id == "db"')" ] ||
      fail "uitheme: $wf ui-theme must run after check and before db (so before setup-sops, render and doctl apps create)"
  done
  wf=.github/workflows/deploy.yml
  ui_theme_step "$wf" validate '"$E"' null uitheme
  [ "$(yq e '.jobs.validate.steps[] | select(.id == "ui-theme") | .env.E' "$wf")" = '${{ inputs.environment }}' ] &&
    [ "$(yq e '.jobs.validate.steps[] | select(.id == "ui-theme") | .env.IMAGE_TAG' "$wf")" = '${{ inputs.image_tag }}' ] ||
    fail "uitheme: deploy.yml ui-theme env"
  [ "$(step_idx "$wf" validate ".value.uses == \"$CHECKOUT_PIN\"")" -lt "$(step_idx "$wf" validate '.value.id == "ui-theme"')" ] ||
    fail "uitheme: deploy.yml validate must check out before ui-theme"
  wf=.github/workflows/deploy-homelab.yml
  ui_theme_step "$wf" deploy '"$TARGET_ENV"' null uitheme
  i="$(step_idx "$wf" deploy '.value.id == "ui-theme"')"
  [ "$(step_idx "$wf" deploy '.value.name == "Validate the image tag (production only from main)"')" -lt "$i" ] &&
    [ "$i" -lt "$(step_idx "$wf" deploy '.value.uses == "./.github/actions/setup-sops"')" ] ||
    fail "uitheme: deploy-homelab ui-theme must run after the image-tag validation and before setup-sops/resolve"
  echo "uitheme: ok"
}
```
Ordering already pinned elsewhere:
- deploy.yml ordering before doctl is pinned by `:768` (`deploy needs validate`).
- prod-up and staging-up ordering after `db` is pinned by `:1050` and `produp_lifecycle :946-951`.

**Verify:**
- `bash scripts/ui-theme-label.test.sh`
- `bash scripts/sops-secrets.test.sh deploy produp homelab uitheme` (yq only), then the full `bash scripts/sops-secrets.test.sh`
- `shellcheck scripts/*.sh && shfmt -d -i 2 scripts/*.sh`
- `bash scripts/homelab-render.test.sh` (triggered by the deploy-homelab edit; must stay green)
- RED-first: run `group_uitheme` before the workflow edits; it must fail with "expected exactly one ui-theme step".
- CI: `shell-lint`, `sops-secrets`, `homelab-render`.

#### S10 — Promotion
**Files:**
- `scripts/backmerge-no-ff.test.sh`
- `.github/workflows/sync-main-to-maindev.yml`, `promote.yml`
- `.claude/skills/promote/SKILL.md`
- the 4 doc sites
- `.github/PULL_REQUEST_TEMPLATE/promotion.md`
- `ci.yml`: the `scripts` filter and the `:705` chain (`backmerge-no-ff.test.sh`)

**Guard.** `check_backmerge_no_ff` runs, per file, `grep -nE 'git merge([[:space:]]+-[^[:space:]]+)*[[:space:]]+(origin/)?main([^-[:alnum:]_/]|$)'`.
- It fails on 0 matches, or on any whole matched line that lacks `--no-ff`.
- Verified not to match: the `--abort` at `:55`, the merge-base at `:88`, `origin/main-dev` at `:108`, and `deploy-homelab.yml:84`.

**Static asserts:**
- workflow-level `concurrency` with `cancel-in-progress: false`;
- the promote.yml three-dot gate is present;
- `AHEAD=$(git log` is absent;
- the gate sits before "Commit and push changelog".

**Fixture body:**
```bash
#!/usr/bin/env bash
# shellcheck disable=SC2015 # `A && B || fail` is the assertion idiom (fail always exits)
set -uo pipefail
cd "$(git rev-parse --show-toplevel)" || exit 1
fail() { echo "ASSERT FAIL: $*" >&2; exit 1; }
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
w="$(mktemp -d)"
trap 'rm -rf "$w"' EXIT
git_q() { git -C "$w" -c user.email=t@t -c user.name=t -c commit.gpgsign=false "$@"; }

check_fixture() {
  local m s
  git_q init -q -b main
  git_q commit -q --allow-empty -m base
  git_q checkout -q -b main-dev
  printf 'd\n' >"$w/d" && git_q add d && git_q commit -q -m D
  git_q checkout -q main
  git_q merge -q --no-ff --no-edit main-dev
  m="$(git_q rev-parse HEAD)"
  git_q checkout -q main-dev
  git_q merge -q --no-ff --no-edit main
  [ "$(git_q rev-parse HEAD)" != "$m" ] && [ "$(git_q rev-parse HEAD^2)" = "$m" ] || fail "AC-18: main-dev's tip must be a new merge commit whose second parent is M"
  git_q diff --quiet "$m" HEAD || fail "AC-18: the sync merge changed content"
  git_q diff --quiet main...main-dev || fail "AC-19: a sync-only main-dev must have nothing to promote"
  git_q checkout -q main
  printf 's\n' >"$w/s" && git_q add s && git_q commit -q -m S
  s="$(git_q rev-parse HEAD)"
  git_q checkout -q main-dev
  git_q merge -q --no-ff --no-edit main
  git_q merge-base --is-ancestor "$m" HEAD && git_q merge-base --is-ancestor "$s" HEAD || fail "AC-20: main-dev must contain M and S"
  git_q diff --quiet main...main-dev || fail "AC-19: the second sync must leave nothing to promote"
  printf 'r\n' >"$w/r" && git_q add r && git_q commit -q -m R
  ! git_q diff --quiet main...main-dev || fail "AC-19: a real change must be promotable"
  echo "fixture: ok"
}
```
The script then runs `check_backmerge_no_ff`, the static asserts and `check_fixture`, and finally prints "backmerge-no-ff.test.sh: all assertions passed". It requires git ≥2.32 (`GIT_CONFIG_GLOBAL`) and ≥2.28 (`init -b`).

**Verify:**
1. RED: on the current tree the script must fail, naming `sync:52`, `hotfix.md:49`, `feature-workflow.md:272`, `bug-triage.md:95`, `backmerge.md:14`, the missing concurrency and the two-dot gate.
2. Apply the edits.
3. GREEN: `bash scripts/backmerge-no-ff.test.sh`.
4. `shellcheck scripts/*.sh && shfmt -d -i 2 scripts/*.sh`.
5. `./scripts/check-context-map.sh` and `node --test scripts/workflow-tests/*.test.mjs` (`.claude/skills/**` edits trigger the context-map job).

#### S11 — Docs
**Files:**
- `docs/patterns/ui-ux-governance.md`: §1/§5 prose around the S3 fence; §7; §9 rows g and h; the trap.
- `services/xstockstrat-ui/CLAUDE.md`:
  - **Styling:** per-theme `:root` in `src/styles/themes/`; checks (a)–(c); `source('..')` scope; the trap; the Turbopack note. Add this line to the existing re-apply bullet:
    > *A `shadcn apply --preset` writes the preset `:root` back into `globals.css`; that fails the production build closed (check (a)), and a changed preset fails staging too. Move the values back into `src/styles/themes/staging.css` and delete the re-added block.*
    The production build runs in PR CI because `src/app/globals.css` is in the `ui-theme` filter.
  - **Docker:** ARG/LABEL.
  - **PWA:** the manifest route.
- `docs/patterns/docker-build.md`, `docs/runbooks/infra-cost-reduction.md`, `docs/patterns/ci-overview.md`
- root `CLAUDE.md:345`, `docs/launch-pdfs/infra-ci.md:163`
- `docs/sdd/business-rules/…/platform.feature` @AC-19 plus @feature-307

**Trap wording rule.** Describe the trap without literal utility or palette-var names, for example:
> any hardcoded colour in emitted CSS — a Tailwind default-palette utility (including its opacity-modifier fallback), a `var()` of a palette variable, or an arbitrary value — within ±1 sRGB / ±0.01 alpha of a theme-specific token of either theme (the stone, emerald and zinc families at the steps listed in design.md §2, the white-alpha borders, and the production blues) fails every build.

**Verify:**
- `npx markdownlint-cli2 --config .markdownlint.yaml "**/CLAUDE.md"` (the markdown-lint job, `ci.yml:878-892`)
- `./scripts/check-context-map.sh`
- `pnpm run test:unit` (AC-17 still parses the §5 fence)
- `pnpm build` and `UI_THEME=production pnpm build`

#### Sequencing audit (R8, full): every verification vs the step that introduces what it uses
| Step | Verification uses | Introduced in | OK / fix |
|---|---|---|---|
| S1 | checker CLI, recursive listing, (c), globals-only loader; `package.json:8` chain; static scan pin; parser + tokenizer | S1 | OK |
| S1 | `themeBackgroundHex`/`themeCssPath`, theme-file loader | S3 / S5 | OK (not used in S1) |
| S1 | literal inventory via `cssDeclarations`/`colorLiterals` | S1 | OK |
| S1 | CI `e2e-build` runs (c) | S1 chain + existing job (`ci.yml:531-554`) | OK |
| S2 | throwaway route | S2 | OK |
| S3 | `parseRootTokens`, `contrastRatio`, `colorsEqual` | S1 | OK |
| S3 | `themeBackgroundHex`, theme files, alias, `env.UI_THEME_BACKGROUND_HEX`, `UI_THEME=prod` failure | S3 | OK |
| S3 | checker after the token move | S1 ((c) reads only `globals.css` `@theme inline`, which S3 keeps) | OK |
| S3 | AC-17 fence | S3 | OK |
| S4 | Docker ARG/LABEL, hadolint, filter, jobs, AC-10 step, `E2E_APPLICATION_ENV` | S4 | OK |
| S4 | `ui-prod-image-build` checker `--css-dir` | S1 | OK |
| S4 | production theme in image | S3 | OK |
| S4 | seed spec `themeBackgroundHex`, `cssColorToSrgb`, `colorsEqual` | S3, S1 | OK |
| S4 | AC-9 CSS assertion is (c) only | — | Noted: complete from S5 |
| S5 | T/N from theme files, loader, (a), (b), probe (ii) failing a staging build | S5 (+ S3 files, S1 tokenizer) | OK |
| S5 | gate on a tree still holding `hsl(var(--sidebar-border))` (`sidebar.tsx:455`) and the arbitrary hsl classes | S1 tokenizer (`var()` args → not literal); §1 B table | OK (round-7 item 3) |
| S5 | gate on a tree holding `[--radius:var(--radius-xl)]` (`sidebar.tsx:322,356`) | S5 (a) literal-only | OK (round-7 item 1) |
| S5 | CI jobs as the gate | S4 | OK |
| S6 | `noColorLiterals.test`, AC-12 regex (`acceptance.feature:82`) vs `layout.tsx:20` `#0a0e14` | S6 edits `layout.tsx:20` | **Fixed (round-7 item 2):** R7 left the edit in S7 |
| S6 | `UI_THEME_BACKGROUND_HEX` in layout | S3 (next.config `env`, pinned by `nextConfig.test.ts`) | OK |
| S6 | meta theme-color curl on `/auth/login` | S3 env + S6 edit | OK |
| S6 | (b) on S6's new `text-warning`/`text-buy` | S5 | OK (shared tokens are `var()`-mapped; their literals are shared, not in N) |
| S6 | `--color-warning` (c) | S1 (+ Open Risk 1 fallback) | OK |
| S7 | `UI_THEME_BACKGROUND_HEX`, `themeBackgroundHex`, S2 curl recipe, `frontend-e2e-production` | S3, S3, S2, S4 | OK |
| S7 | AC-13 meta assertion | S6 edit | OK (S6 precedes S7) |
| S8 | seed spec, `--chart-1` stroke | S4, S6 | OK |
| S8 | production-theme goldens job | S4 | OK |
| S9 | `step_idx`, `CHECKOUT_PIN`, `need`, `fail` | existing `sops-secrets.test.sh` | OK |
| S9 | `ui-theme-label.test.sh` directive, scripts; `:705` gets only that test | S9 | OK |
| S10 | guard, fixture, context-map; `:705` gets `backmerge-no-ff.test.sh` | S10 | OK |
| S11 | AC-17 fence | S3 | OK |
| S11 | trap wording matches (b); re-apply line matches (a) | S5 | OK |

### Acceptance → test → step

| AC | Covered by | Steps |
|---|---|---|
| AC-1 | (a) production `--primary` present and every literal token declaration equals production; (b) rejects the Nocturne literal anywhere else in every build; named AC-1 fixtures; `themes.test` guard keeps it in N | S5, S3; runs in S4 jobs |
| AC-2 | (a) every staging token has a literal declaration equal to the Nocturne value; "no production-only colour": (a) rejects production values in token declarations, (b) rejects them as any other literal | S5 |
| AC-3 | nextConfig test + checker | S3, S5 |
| AC-4 | spawn test | S3 |
| AC-5 | (c) shared literals equal in both bundles; shared literals are excluded from N, so (b) never flags them; e2e | S1, S5, S8 |
| AC-6 | checker in the Dockerfile build + label + callers + label tests | S4, S9 (+ live) |
| AC-7 | 3 goldens + body bg; unit prod≠staging bg | S8, S4, S3 |
| AC-8 | themes.test 18.07/5.46 + no parse error in prod e2e | S3, S8 |
| AC-9 | see below | S4 (job), S5 (full checks) |
| AC-10 | see below | S4, S3 |
| AC-11 | staging e2e chart | S8 |
| AC-12 | e2e stroke == `--chart-1` in both + `noColorLiterals` (incl. `layout.tsx:20`) | S8, S6 |
| AC-13 | meta edit + e2e manifest and meta in both + spike | S6, S7, S2 |
| AC-14 | themes test | S3 |
| AC-15 | refuse-retheme rows + needs assertion | S9 |
| AC-16 | 11 rows + `group_uitheme` placement | S9 |
| AC-17 | parsed §5 | S3 |
| AC-18 | guard + fixture | S10 |
| AC-19 | fixture three-dot + static gate | S10 |
| AC-20 | static concurrency + sequential fixture | S10 (+ live) |

- **AC-9** (`ui-prod-image-build`):
  - (i) the `Dockerfile:20` RUN executes the `package.json:8` chain, so the image layer exists only if the checker passed;
  - (ii) the CSS extracted from the image is re-checked by the checker CLI, which is cache-proof. It runs (c) from S4 and (a)–(c) from S5;
  - (iii) `docker inspect` shows label == production.
- **AC-10**: two `docker run`s in frontend-e2e shard 1, each asserting /trader body bg ≡ #0c0a09 = rgb(12, 10, 9). There is no skip; the production job uses `--grep-invert`. Plus the FR-10 static test.

### Assumptions

- Next 15.5 uses webpack (no `--turbopack`).
- A side-effect `import '@theme-tokens'` passes tsc and eslint.
- `next.config` `env` is inlined into server bundles, so `layout.tsx` `process.env.UI_THEME_BACKGROUND_HEX` resolves.
- `themeColor` accepts `string | undefined` under this tsconfig; S6's V-UI tsc confirms it.
- Playwright 1.62.1 supports `page.clock` and the default aria snapshot path.
- Tailwind 4 palette values are oklch (`--color-black`/`--color-white` are hex). The §1 B values come from Tailwind 4's `theme.css`, unverified locally; S1 records the emitted values.
- Tailwind 4.3.3 supports `@import … source()` (v4.0) and `@source not` (v4.1), with `@source not` paths relative to `globals.css`. Unverified locally (no node_modules); proven by the S1 diff and the S5 probe.
- Tailwind treats a bare `--color-*` or `var(--color-*)` string in scanned source as a theme-variable use and emits it. S5 probe (ii) decides; the design is safe either way through scan scoping plus concatenation.
- An inlined palette or arbitrary colour reaches the emitted CSS as one of: a declaration, a `color-mix` literal operand, a `var()` fallback, or a pre-computed translucent literal. (b) scans all four in every build.
- Minifiers rewrite values but never property names, so name-based classification is stable.
- Theme tokens reach utilities as `var(--x)` through `@theme inline` (`globals.css:8-39`), so no selected-theme value appears as a literal outside T-name declarations.
- `actions/setup-node@v7` with Node 24 is available on `ubuntu-latest` (as `ci.yml:515-517`); `fs.readdirSync({recursive})` needs Node ≥20.1.
- GITHUB_TOKEN allows at least packages: read.
- "Create a merge commit" always creates a new commit.
- `APPLICATION_ENV` is read only by `src/lib/deploymentEnv.ts:8` and `src/telemetry.ts:47`, and never feeds styling.
  - `deploymentEnv.ts` provides config scope (`getNativeConfigEnv`/`nativeConfigEnvironment`/`isNativeConfigEnvironment`). Consumers: `traderBff.ts:27,169`, `insightsBff.ts:29,172,189`, `configUiBff.ts:18-19,43`, `config-ui/ConfigNamespaceView.tsx:4`.
  - `telemetry.ts:47` sets an OTel `deployment.environment` resource attribute.
- Hand contrast and sRGB figures are ±0.02 and ±2 respectively, except the rows marked "computed". S3/S5 settle them exactly (P-03 re-pin if needed).

### Dependent tests/pins

| Pin | Where | Effect of 307 | Handling (step) |
|---|---|---|---|
| prod-up `uses:` list exactly `CHECKOUT DOCTL setup-sops` | `sops-secrets.test.sh:1031-1032` | A login action would break it | `run:` login inside `ui-theme` (S9) |
| prod-up order check<db<setup-sops<render; selectors unique; `if: always()` run join | `:1044-1051`, `:946-951`, `:1038` | New step | Unique id, not `always()`, placed check<ui-theme<db (S9) |
| prod-up `permissions.contents == read` | `:1030` | `packages: read` added | Kept (S9) |
| homelab resolve<detach; no `uses:` after resolve | `:1079-1085` | New step | Before resolve, run-only (S9) |
| exactly one `P:` line; LEGACY_ lines == KEYS; no unprefixed secrets | `:745-751`, `:736-742` | New `env:` | Only `IMAGE_TAG`/`GH_TOKEN`/`E` (S9) |
| deploy.yml validate: no environment/concurrency; deploy needs validate; no workflow concurrency | `:767-774` | validate gains permissions + steps | Compliant (S9) |
| callers: no concurrency, `with.environment`, homelab uses/secrets/if | `:853-868` | `build-images.with.ui_theme` added | Untouched keys (S9) |
| ac24 file list | `:1120-1128` | none | n/a |
| ci.yml `config-wiring` filter parsed by exact indentation | `config-wiring.test.mjs:663-688` | New `ui-theme` filter | Inserted after `sops:` (`ci.yml:101`), same `- '…'` form; `node --test scripts/config-wiring.test.mjs` (S4) |
| PWA manifest shape (display, `start_url /trader`, 192/512, maskable) | `e2e/accounts/pwa.spec.ts:11-25`, `acceptance/pwa-notifications.feature:11-17` | Manifest becomes a route | Same fields; spec run (S7) |
| `APPLICATION_ENV=development` relied on | `playwright.config.ts:161-163`; `api-smoke.spec.ts:216`; `env-gate.spec.ts:6`; `env-mode-switcher.spec.ts:14-15` | Made overridable | `?? 'development'` default (S4) |
| APPLICATION_ENV unit tests | `deploymentEnv.test.ts`, `insightsBff.test.ts:102-108`, `traderBff.test.ts:22-45` | none | V-UI |
| Chart colours unit | `src/lib/chartColors.test.ts` | FR-11 sites | V-UI (S6) |
| shadcn variant guards | `button.test.ts`, `badge.test.ts` | badge.tsx untouched; its palette utilities pass (b) | V-UI |
| AC-12 regex vs `layout.tsx:20` `#0a0e14` | `acceptance.feature:82` | `noColorLiterals.test.ts` | Edit moved into S6 |
| shadcn arbitrary token redefinitions | `sidebar.tsx:322,356` (`--radius`), `card.tsx:15` (`--card-spacing`, not in T) | (a) | Literal-only (a) (S5) |
| `var()`-argument colour functions | `sidebar.tsx:455` (until S6), `button.tsx:16` | (b) tokenizer | Non-literal rule (S1) |
| Escaped selector colours | `chart.tsx:66` | (b) tokenizer | Selectors never scanned (S1) |
| Colour text in CSS comments | `globals.css:41`, `:112-115` (moves to staging.css) | (b) | Comments stripped (S1) |
| jscpd threshold 0 on UI `src`, minTokens 100 | `.husky/pre-commit:13`, `.jscpd.json:4` | staging/production.css, route | Values differ per line; `check-duplication.sh` in V-UI |
| `next lint` in pre-commit and node-lint | `.husky/pre-commit:12` | `.cjs` requires | `.eslintrc.json` override + RED probe (S1) |
| vitest include / coverage scope | `vitest.config.ts:20,25` | New tests under `src/styles` | Included; coverage unaffected |
| Tailwind auto-scan | `globals.css:1-2`, `postcss.config.js:3` | Fixture/doc text could emit palette CSS, now failing **every** build via (b) | `source('..')` + `@source not` after line 2 + concatenation (S1 pin, S5 probe) |
| Always-run staging build | `ci.yml:64` filter, `:531-554` e2e-build, `Dockerfile.e2e:65` | Now runs symmetric (b) on every UI PR | The F3 carrier; no filter change (S5) |
| Current palette utilities | `badge.tsx:25-26`, `alert.tsx:15,17`, `StatTile.tsx:28`, `PerformanceDashboard.tsx:120`, `screener/page.tsx:568`, `slider.tsx:49`, `toggle.tsx:22`, `button.tsx:27`, `sheet.tsx:34`, `alert-dialog.tsx:31` | Subject to (b) | Checked by hand (§1 B table), proven by the S5 gate |
| hadolint | `ci.yml` dockerfile-lint (`:680-683`) | ARG/LABEL | hadolint run (S4) |
| shellcheck / shfmt -i 2 | `ci.yml:698-702` | 3 new scripts | S9/S10 verification |
| shell-lint test chain | `ci.yml:705` | Two tests appended | `ui-theme-label.test.sh` in S9; `backmerge-no-ff.test.sh` in S10 |
| sops-secrets job filter | `ci.yml:87-101`, `:1006-1030` | Workflow edits retrigger it | Add `scripts/ui-theme-label.sh` (S9) |
| homelab-render test (hardcoded `ghcr.io/davcs86/xstockstrat` fixtures) | `homelab-render.test.sh:33,101,152` | Triggered by the deploy-homelab edit (homelab filter `ci.yml:86`) | Stays green; run in S9 |
| markdownlint on **/CLAUDE.md | `ci.yml:878-892` | UI and root CLAUDE.md edits | S11 verify |
| doc-ref validator + workflow-tests | `ci.yml:904-908`, `check-context-map.sh:28-45` | `.claude/skills/**` and docs edits | S3/S10/S11 verify; no refs to deleted paths |
| merge-train fixture matching the guard regex | `scripts/workflow-tests/merge-train-resolve.test.mjs:12` | Comment only | Not in the guard's file list |
| ci-gate needs/echo; skipped = pass | `ci.yml:1117-1140`, `:1145-1167`, `:1169-1178` | Two new jobs | Added (S4) |
| CI action pins | `ci.yml:541,544,547,515-517,604` | New jobs | Same pins: checkout v7, buildx v3, build-push v6, setup-node v7, upload-artifact v7 (S4) |
| CI job matrix doc | `docs/patterns/ci-overview.md:26-27` | Two new jobs | Rows added (S4) |
| "permanently ahead" prose | `CLAUDE.md:345`, `promote.yml:223`, `promote/SKILL.md:223`, `PULL_REQUEST_TEMPLATE/promotion.md:15-16`, `docs/launch-pdfs/infra-ci.md:163` | --no-ff semantics | Reworded (S10/S11) |
| Commit-count promote gate | `promote.yml:40-47`, `promote/SKILL.md:64-69` | --no-ff sync commits count as "ahead" | Three-dot gate (S10); MERGE_COUNT `:90` cosmetic, accepted |

## Rejected Alternatives

- **Carried from R5:**
  - Image and runtime: two images per build; a runtime switch; a prebuild copy (runner-up); a Tailwind @import resolver; `[data-theme]` scoping; theme-suffixed tags.
  - Checker and build: an in-leg guard; a `build/` dir; a layer-order assertion; a per-theme GHA cache.
  - Manifest: `app/manifest.ts`; a /app.webmanifest rename.
  - Promotion: skipping deploy-dev on the main SHA; splitting out a prereq feature; a two-dot gate; re-merging in the retry loop; extracting sync to a script.
  - Registry: `github.repository_owner` or a per-workflow REGISTRY env.
  - Scope: leaving the /insights literals; homelab-images taking its theme from github.ref; a second self-map fallback.
  - Testing: an aria pathTemplate override; lab/lch support up front; the full e2e suite per theme; the root lockfile in the filter.
  - **Narrowing (b) to token names.** Still rejected: (b) scans every non-token declaration and (a) covers token declarations, so together they cover every declaration.
- **Carried from R6:**
  - An enumerated `@source not` list as the only scan control (runner-up).
  - Grepping the build log for the checker success line (cache hits skip `Dockerfile:20`).
  - `test.skip` on @AC-10.
  - GHCR login via `docker/login-action` on deploy paths.
  - Placement asserts in `ui-theme-label.test.sh`.
- **Carried from R7:**
  - A production-only palette self-check.
  - Widening `ui-theme` to `services/xstockstrat-ui/**` (redundant now that (b) is symmetric in the always-run staging build).
  - Keeping (b′) as its own code path.
  - Using the checker CLI only from S5.
  - Reading Tailwind's `theme.css` to recognise palette literals.
- **Rejected in R8:**
  - **Keeping R7's (d) beside symmetric (b).** It is a strict subset with the same N, so it would only duplicate failure lines. Its palette-var label is not worth a second code path.
  - **R7's asymmetric leak set for (b).** It let a pre-computed translucent palette fallback equal to a staging token (`#ffffff1a` = staging `--border`) pass staging CI and fail deploy-prod.
  - **(a) on every T-name declaration regardless of value.** shadcn's `[--radius:var(--radius-xl)]` (`sidebar.tsx:322,356`) would fail every build.
  - **Scanning selectors and at-rule preludes.** Escaped `\#ccc` and `[stroke='#ccc']` (`chart.tsx:66`) and the `@supports (… red, red)` prelude are not colours that paint.
  - **Classifying token declarations by value instead of name.** Minifiers rewrite values (`oklch(1 0 0 / 10%)` → `#ffffff1a`); names are stable.
  - **Folding the `color-mix` percentage into alpha.** Tailwind ≥4.1 emits the pre-computed translucent fallback beside the `color-mix`, and (b) sees that fallback. Recorded trade-off: a bare `color-mix(…, #fff 10%, transparent)` with no fallback is compared at α1.
  - **Moving only the `noColorLiterals` test to S7.** S6 would then ship with AC-12 unasserted. Moving the one-line `layout.tsx:20` edit into S6 is smaller.

## Open Risks

1. **S1 spike, shared-role emission.**
   - What S1 measures: with `@theme inline`, Tailwind may not emit the custom property for a shared role that no utility or `var()` references.
     - `--color-warning` has no user until S6 (`text-warning`).
     - `--color-paper` is used through the `badge.tsx` variant.
     - `--color-buy`/`sell` are read as bare strings by `useCandlestickChart.ts:38-39`.
   - S1 measures emission **after** the `source('..')` edit, because that edit decides which `src/` strings are scanned.
   - Fallback if any role is missing: an unlayered `:root` in `globals.css` declaring the four shared literals. Then (c) passes, and candle colours resolve to the intended literals instead of the `'green'`/`'red'` fallbacks (`useCandlestickChart.ts:38-39`).
   - S1 also records the emitted literal inventory (palette values, translucent fallback forms, `color-mix` forms) and any lab/lch/oklab/`color()` (lightningcss may emit an out-of-gamut sRGB fallback as `color(srgb …)`), which fail closed. If any appear, S5 adds a parser branch before relying on them.
2. **S2 manifest route spike** (no-cache, content-type, ƒ in the route table, one link). Otherwise the fallback applies.
3. **Next16/Turbopack ignores the webpack alias.** This fails closed; the fix is `turbopack.resolveAlias` (UI CLAUDE.md, S11).
4. **TOCTOU between preflight and push** is accepted (it needs a concurrent homelab-images dispatch).
5. **Three-dot residual.** A conflict-resolved sync PR diff counts as promotable; it is real content.
6. **Concurrency and the --no-ff flow can't be exercised in PR CI.** Verify on the first promotion: two sync runs serialized, main-dev ⊇ {M, S}, deploy-dev tags X ≠ M.
7. **AC-6 end-to-end** is first proven on the first real dev and prod deploys.
8. **Container-written goldens** may need chown.
9. **Default GITHUB_TOKEN** must allow at least packages: read for called workflows. Precedent: `docker-build.yml:24-26` already gets `packages: write` from callers with no `permissions:` key.
10. **Tailwind scan directives.** `source()` (v4.0) and `@source not` (v4.1) are unverified locally: no node_modules is installed, and package.json pins 4.3.3 at `:68,80`. The S1 diff and the S5 probe prove both.
11. **(b) false positives by design.** A future token edit, palette utility, translucent modifier or arbitrary value within ±1 sRGB / ±0.01 α of a non-shared token of either theme fails every build. The fix is a theme token, or nudging the value by ≥2 per channel. The trap is documented (S11).
12. **Named-colour residual (new).** Identifiers are not literals. A minifier that rewrites a hex to a shorter named colour (for example `#f00` → `red`) would hide it from (b). No non-shared token is a fully saturated named colour; S1's inventory records any named colour in declaration values. If one appears, S5 adds a named-colour table.

**Strongest remaining risk.** - **First:** the checker depends on the CSS shape that Tailwind 4.3.3 and Next 15.5 emit: `@theme inline` pruning, `color-mix` and fallback forms, minifier rewrites. Unsupported colour functions fail closed. Pre-computed mixes are now seen by (b) in every build. The remaining blind spot is a minifier rewriting a literal to a named colour (Open Risk 12). S1's inventory measures it before S5 relies on it. The S1 fallback changes how candle colours resolve.
- **Second:** the scan-scope directives are unverified offline. If `source('..')` or `@source not` behave differently in 4.3.3, S1's selector diff and S5's probe catch it before any later step relies on them. The fallback is the enumerated `@source not` list.
- **Third:** the concurrency and --no-ff promotion flow can only be verified live.

**Accepted at convergence (round 9):** `pnpm start` after a standalone build in the S2/S6/S7 local checks only warns (prefix `NEXT_DISABLE_STANDALONE=1` in the impl-spec); `pnpm run test:unit -- src/styles` may run the full suite (a superset).

## Constitution Rules Touched

- **C-01/F-04**: cited evidence plus spikes.
- **C-02**: context read.
- **C-08**: tests per step.
- **C-10**: every instance is covered: 3 callers, 4 deploy paths, all back-merge sites, both promote gates, all doc sites, plus static guards. (b) runs in every build path: local, `Dockerfile:20`, `Dockerfile.e2e:65`, the Playwright webServer.
- **C-11**: full pipeline, 8 rounds (cap override signed 2026-11-10).
- **C-12/C-13**: fixture reuse; synthetic CSS inline, with palette names concatenated.
- **C-14**: UI, all segments.
- **C-15**: §8 map.
- **C-16**: one CHANGE, signed.
- **C-17**: FR-11 removes literals; §5 baseline; the checker enforces token use in every build; §9 row h.
- **C-18**:
  - `source('..')` beats a deny-list;
  - the cache-proof CSS re-check beats a log grep;
  - one `group_uitheme` beats edits scattered across four groups;
  - one symmetric (b) replaces the R6 self-check, (b′) and R7's (d);
  - one tokenizer serves (a), (b) and (c).
  - Recorded trade-offs: `--color-warning` duplicates the paper value for a distinct role; the Node parser differs from the browser canvas path at `chartColors.ts:24`; the alpha rule does not fold `color-mix` percentages; named colours are skipped (Open Risk 12).
- **P-03**: consequences surfaced.
- **P-06**: RED-first in S1, S2, S5 (scan and symmetric probe), S9 and S10.
- **F-02**: sync and promote pushes are pre-existing; no new direct push.
- **F-05**: verify before commit.
- **F-07**: a build arg, not config.
- **F-06**: untouched.

## Business Rules Touched (C-16)

**CHANGE**: `platform.feature:1164-1169` @AC-19 @FR-7 @feature-279 (signed 2026-11-10; S11 rewrite plus an @feature-307 note).

**PRESERVE:**
- watchlist-opportunity-signal-cues @AC-1/2/3/4/13
- fix-opportunity-composite-score @AC-1/2/3
- strategy-performance-dashboard @AC-9/10 and fix-ui-trader-feedback @AC-3/12: paper/live comes from GetTradingEnvironment, never UI_THEME (FR-10 static test).
- Charts render: @AC-7 strategy-performance-dashboard; opportunity-live-market-enrichment @AC-3/4/7/8; backfilled-data-queryable @AC-1/15/22.
- pwa-notifications @AC-1 (`acceptance/pwa-notifications.feature:11-17`, `pwa.spec.ts:11-25`)
- watchlist-readiness-list-ux @AC-6
- ui-middleware-nodejs-runtime @AC-6
- platform @AC-1/3/8/10/19*/23
- platform @AC-42

## Debate record

### Objection ledger

- **R1–R4**: as in R5 §11.
- **R5**:
  1. Scan scope via `source('..')` + `@source not`; concatenated fixture names; docs without literal names; S5 gate named.
  2. `run:` GHCR login + `require-match` at pinned-safe positions; `group_uitheme`; sops filter.
  3. Each AC-10 run asserts #0c0a09; no skip; §9 corrected.
  4. Drift asserts compare against `${UI_IMAGE_REPO%/xstockstrat-ui}` via BRE sed.
  5. `git_q` hermetic fixture written out.
  6. AC-9 rides on the in-Dockerfile checker plus an extracted-CSS re-check plus the label; log grep rejected.
- **R6**: F1 CLI in S1; F2 both jobs copy `ci.yml:540-554`; F3 symmetric palette check; F4 file-level directive; A1 `@source not` after line 2; A2 Open Risk 1.
- **R7**:
  1. (a) literal-only plus a fixture.
  2. `layout.tsx:20` moved into S6.
  3. Tokenizer: colour functions with `var()` arguments are non-literals.
  4. Symmetric (b) in every build replaces (d); today's tree re-verified.
  5. Editorial (S3 range, S1 loader).
  6. A3: shadcn re-apply line in S11.

---

### Round-8 items → resolution

| # | Item | Resolution |
|---|---|---|
| F1 | S6's `hsl(var(` ban across all of `src` would match the S1/S5 test fixtures (fails.md:3950 class) | Ban dropped (C-18 YAGNI). AC-12 (`acceptance.feature:83`) only requires the `sidebar.tsx` assertion, which S6 keeps. |
| AR2 | yellow-500 out of gamut; lightningcss may emit `color(srgb …)` | `color()` added to the S1 inventory wording; parser clamps channels to [0,1]; `color()` still fails closed (S5 adds a branch if S1 observes it). |
| AR3 | S1 Verify 3 selector-loss wording | Also allowed: selectors whose class strings lived only in now-excluded `src/**/*.test.ts` / `src/styles/themes/**`. |
| AR4 | `chartColors.ts:6` comment ("Defined in `globals.css` `:root`") stale after S3 | S3 updates it to "Defined per theme in `src/styles/themes/*.css`" (an orphan this feature creates). |
| AR1, AR5 | Table omits shared-colour translucent fallbacks and shadow α0.05/0.25 (none collide); Playwright setup-project under filters; `@theme inline` emission | Accepted; proven by the S1 inventory and the S5 gate. |

### Round-7 items → resolution

| # | Item | Resolution |
|---|---|---|
| 1 | `sidebar.tsx:322,356` `[--radius:var(--radius-xl)]` makes (a) fail every build | (a) checks only **literal** T-name declarations. Any T-name value containing `var(` or `calc(` is skipped by (a); its nested literals go to (b). ≥1 literal declaration per selected token is still required. S5 fixtures: arbitrary `[--radius:var(…)]` passes; `calc()` skipped; var-only token fails "no literal declaration"; var-fallback literal fails via (b). **Grep of `src` for `\[--<name>:`:** `sidebar.tsx:322`, `sidebar.tsx:356` (`--radius`, a T name, `var()` value → skipped), and `card.tsx:15` ×2 (`[--card-spacing:--spacing(5)]`/`(4)`; not in T by exact-name match, and it compiles to `calc(var(--spacing) * n)` with no colour literal). No others. |
| 2 | S6's `noColorLiterals.test.ts` fails on `layout.tsx:20` `#0a0e14` until S7 | The `layout.tsx:20` themeColor edit moves into S6 (§1 C; S6 files). `UI_THEME_BACKGROUND_HEX` is introduced in **S3** (`next.config.js` `env`, now named explicitly in S3 files and pinned by `nextConfig.test.ts`). S6 verify adds a meta theme-color curl on `/auth/login` for both themes. S7 keeps the manifest and the AC-13 e2e. Sequencing audit re-run (S6/S7 rows). |
| 3 | Colour functions with `var()` args must be non-literals | Tokenizer rule (§1 B step 3): a colour-function call is a literal iff its argument text has no nested function and no `from`; otherwise it is skipped whole. `color-mix` is never a literal: its interpolation spec is dropped, and each depth-1 operand (minus a trailing `%`) recurses through the same rules, so nested literal operands are still extracted. Other functions are descended into (`var()` fallbacks scanned). Strings, `url()`, selectors, at-rule preludes and comments are never scanned; `\` escapes. The cases are listed in S1 `uiTheme.test.ts`. |
| 4 | Translucent palette literal (`#ffffff1a`) passes staging, fails prod | **Symmetric (b)** in every build: any colour literal outside literal T-name declarations that `colorsEqual`s a non-shared token of either theme fails with `colour literal <v> at <file>:<offset> equals <theme> <token>; use the theme token`. Classification is by property name ∈ T, under any selector. Shared tokens are not in N; the shared order-side literals are not in N. **(d) is removed** (strict subset, same N). Today's tree is re-verified in the §1 B table: every listed literal, including alpha tokens, is non-colliding; minimum margin Δ5. Updated: §1 B, AC-1/2/5, §3. The "exactly what a production build would" sentence is replaced by a theme-independence statement scoped to (b), made true by construction (theme files hold only T-name declarations and are excluded from the scan). |
| 5 | Editorial | S3 removes `globals.css:83-125` (preset comment `:83-86` + `:root` `:87-125`) and blank `:126`. `:82` `@layer base {` stays with `:127-140` and the closing brace at **`:141`** (verified). S1 CLI sources = `globals.css` only; S5 extends the loader to the theme files via S3's `themeCssPath`. Fixed in §1 A, S1, S3, S5 and the audit. |
| A3 | shadcn re-apply writes `:root` back | One line in the S11 UI CLAUDE.md Styling re-apply bullet: fails the production build closed via (a) (the staging build too if the preset changed); move the values back to `src/styles/themes/staging.css`. |

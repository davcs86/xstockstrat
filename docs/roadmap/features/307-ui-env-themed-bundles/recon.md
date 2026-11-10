# Recon: ui-env-themed-bundles

**Created**: 2026-11-10
**From**: product-spec.md
**Tree**: feature/ui-env-themed-bundles@d2135be ≡ origin/feature/ui-env-themed-bundles
**Affected services**: xstockstrat-ui (+ CI build/deploy workflows)

---

## Objective

Compile `xstockstrat-ui` into environment-specific bundles chosen by a build-time `UI_THEME`
(`staging` | `production`, default `staging`, unknown → build failure). Staging keeps today's Nocturne
token values. Production ships a new dark palette over the same token names. Only color tokens differ;
content, routes, DOM and behavior stay identical.

## Codebase Map

- **`xstockstrat-ui`** (Next.js `^15.5.27`, Tailwind v4 CSS-first, shadcn)
  - Sole CSS entry: `src/app/layout.tsx:3` `import './globals.css'`; `<html>` at `layout.tsx:25` has no `dark`/`data-theme`.
  - `src/app/globals.css` (141 lines):
    - `@import 'tailwindcss'` and `tw-animate-css` at :1-2.
    - `@theme inline` at :8-80 maps `--color-*: var(--*)`, so the tokens can live outside Tailwind processing.
    - buy/sell/paper hsl literals at :44-46, inside `@theme inline`, not `:root`.
    - The **single `:root` token block** is at :87-125 inside `@layer base` (:82). All values are oklch, including `--chart-grid` :116 and `--radius` :106.
    - There is no `.dark` block.
  - Chart color resolution: `src/lib/chartColors.ts:24` `cssColorToRgb` (1×1-canvas round-trip → sRGB) and `:43-48` `resolveChartColor`.
    - **Format-agnostic** (oklch/hsl/hex). The lightweight-charts oklch trap is already neutralised for every token in `CHART_COLOR_TOKENS` (:7-20).
    - Consumers: `src/hooks/useCandlestickChart.ts:35-39`, `src/app/trader/positions/[symbol]/page.tsx:277-315`, `src/components/trader/IndicatorPanels.tsx:95`.
  - Hardcoded color literals that ignore tokens (~28 hits, existing C-17 deviations):
    - `src/components/insights/EquityCurveChart.tsx:21-27,155,201-202,263`
    - `src/app/insights/data-explorer/page.tsx:56-57,272,291,559,568`
    - `src/app/insights/page.tsx:59,181-190`
    - `src/app/insights/strategies/[id]/page.tsx:287,515,555`
    - `src/components/ui/sidebar.tsx:455` (`hsl(var(--sidebar-border))` — invalid against oklch, pre-existing bug)
  - PWA chrome color: `public/manifest.webmanifest:8-9` (`#0a0e14` ×2), `src/app/layout.tsx:20` `viewport.themeColor '#0a0e14'`. The manifest is a static `public/` file.
  - Build config:
    - `next.config.js:7` is the only env switch (`NEXT_DISABLE_STANDALONE`). `postcss.config.js:2-4` has `@tailwindcss/postcss` only.
    - `package.json:7-19` scripts: `dev` = `next dev` (webpack, no `--turbopack`), `build` = `next build`.
    - `playwright.config.ts:128-133` runs `pnpm build && pnpm start` in CI, and its env (:139-181) has no `UI_THEME`.
  - Dockerfile: the builder stage is :16-20 (`COPY` :19, `RUN pnpm … build` :20). An `ARG` must be declared inside `builder`. The runner stage is :22-31.

- **CI / deploy (not a service)**
  - `.github/workflows/docker-build.yml`:
    - `workflow_call` inputs (:5-18) are `image_tag`, `latest_tag`, `build_migrator`.
    - Matrix entry for xstockstrat-ui is at :53-54. Tags are computed at :73-78 as `…/<svc>:<image_tag>,…:<latest_tag>`.
    - The build-push step (:80-90) has **no `build-args`**.
  - Callers of `docker-build.yml`:
    - `deploy-dev.yml:37-40` — tags `<sha>` and `latest-dev`; the `main-dev` push builds staging.
    - `deploy-prod.yml:36-39` — tags `<sha>` and `latest`; the `main` push builds production.
    - **`homelab-images.yml:23-26`** — manual, any dispatched ref, tags `<sha>` and `homelab-manual`.
  - `deploy-homelab.yml:118-135`:
    - Resolves `xstockstrat-$svc:<image_tag>` → digest for both environments (no per-environment image selection).
    - Manual dispatch (:17-24) takes an arbitrary `image_tag`. Production is restricted to main commits (:20).
  - `.do/app.dev.yaml:606-607` and `.do/app.yaml:609-610` set `repository: xstockstrat/xstockstrat-ui`, `tag: YOUR_IMAGE_TAG` (substituted at deploy time).
  - `ci.yml` does no standalone UI `next build`. The build happens inside `Dockerfile.e2e`/Playwright webServer (`ci.yml:531-602`) and the image builds.
  - `docker-compose.yml:490-499` builds the UI from the Dockerfile with no args (→ default staging).

## Patterns to REUSE

- Chart token → color → reuse `resolveChartColor`/`cssColorToRgb` (`src/lib/chartColors.ts:24,43`) unchanged. Production chart tokens may stay oklch.
- Token names and the Tailwind mapping → reuse `@theme inline` (`globals.css:8-80`) as the single mapping. Only the `:root` **values** move per theme.
- buy/sell/paper → keep the `@theme inline` literals (`globals.css:44-46`) shared, never per-theme (FR-5). Already guarded by `src/components/ui/button.test.ts` / `badge.test.ts`.
- Build-time env validation → `next.config.js` is already the env-driven build switch (:7). Put the `UI_THEME` allow-list there so `dev`, `build` and e2e all fail fast on an unknown value.
- Image build plumbing → extend the existing reusable `docker-build.yml` (one more input), rather than a new workflow.
- Test data: `e2e/fixtures/INVENTORY.md` has no chart/theme fixtures. The existing chart e2e specs (`.tv-lightweight-charts` readiness, `e2e/trader/chart-panel.spec.ts`) are reused for the chart-render checks (C-12).

## Existing Business Rules (preserve / extend)

All PRESERVE. There are no EXTEND or CHANGE items.
- **PRESERVE** `@AC-1/@AC-2/@AC-3/@AC-4/@AC-13` (`services/xstockstrat-ui/acceptance/watchlist-opportunity-signal-cues.feature`, @feature-155) — firing = buy/green, watching = paper/amber, info icon for "in queue". Color is never the sole cue.
- **PRESERVE** `@AC-1/@AC-2/@AC-3` (`fix-opportunity-composite-score.feature`, @feature-221) — muted stays distinct from destructive, and positive/negative stay distinguishable.
- **PRESERVE** `@AC-9/@AC-10` (`strategy-performance-dashboard.feature`, @feature-031) and `@AC-3/@AC-12` (`fix-ui-trader-feedback.feature`, @feature-270) — the paper/live label comes from the runtime environment (GetTradingEnvironment) and **never** from `UI_THEME`.
- **PRESERVE** `@AC-7` (strategy-performance-dashboard, recharts zoom/pan), `@AC-3/@AC-4/@AC-7/@AC-8` (`opportunity-live-market-enrichment.feature`, @feature-095), `@AC-1/@AC-15/@AC-22` (`backfilled-data-queryable.feature`, @feature-204) — charts render.
- **PRESERVE** `@AC-1` (`pwa-notifications.feature`, @feature-165) — standalone manifest with 192/512/maskable icons and a root-scoped service worker. Color values are not asserted.
- **PRESERVE** `@AC-6` (`watchlist-readiness-list-ux.feature`, @feature-181) — C-17 skeleton plus `aria-busy`/`role=status`.
- **PRESERVE** `@AC-6` (`ui-middleware-nodejs-runtime.feature`, @feature-128) — the standalone Docker build still succeeds.
- **PRESERVE** `@AC-1/@AC-3/@AC-8/@AC-10/@AC-19/@AC-23` (`docs/sdd/business-rules/platform.feature`, @feature-279):
  - Homelab digest pins and the 13-image render are unchanged.
  - A never-built tag stops the deploy.
  - Manual redeploy of a built SHA still works.
  - Ports 3000/9000 and `HOSTNAME=0.0.0.0` are unchanged.

## Dependencies

- Proto/RPC: none.
- Migration: none.
- Config keys: none. `UI_THEME` is a Docker build arg and Next build-time env, not a WatchConfig key.
- Inter-service edges: none.
- New env vars / ports: `UI_THEME` (build-time only). It is absent from `docker-compose.yml`, `.do/app.dev.yaml` and `.do/app.yaml`, and needs no runtime entry there.

## Risks / Not-found

- **SHA-tag collision (new, from recon).** Dev and prod images share `xstockstrat-ui:<sha>`. ~~Today the SHAs are distinct, because `main` gets merge commits.~~ **Corrected in design round 3:** that is false for main-dev. `.github/workflows/sync-main-to-maindev.yml:52-54` runs `git merge origin/main` without `--no-ff`, so after a promotion it fast-forwards main-dev onto main's merge commit M. deploy-dev and deploy-prod then both build `xstockstrat-ui:<M>`. These paths break the theme-to-environment mapping:
  - `homelab-images.yml` can rebuild **any** ref under the same `<sha>` and would overwrite a production-themed image with the default (staging) theme.
  - A manual `deploy-homelab` staging run pointed at a `main` SHA pulls a production-themed image.
- **Hardcoded colors (~28 sites)** don't follow tokens. A production palette leaves those regions Nocturne-colored, so the theme is incomplete. Fixing them touches components, which is visual-only but beyond `globals.css`.
- **PWA/viewport `#0a0e14`** is static. Varying it per theme needs `app/manifest.ts` (a route) or leaving it shared.
- **Dark-only rule** (`docs/patterns/ui-ux-governance.md:46-49`): the production palette must stay dark, or it reopens feature 119.
- `ui-ux-governance.md:33-36` pins buy/sell/paper in prose, unchanged by FR-5. §1 (:22-55) needs a note that `:root` values are per-theme.
- No contrast or visual-regression gate exists (`ui-ux-governance.md` §5.7). AC-8's contrast check must be a new unit test over the token files.
- Ledger traps: lightweight-charts oklch is already handled by `cssColorToRgb`. `APPLICATION_ENV` is not in the client bundle (FR-10).
- Not verified: `src/app/**/icon*`/`apple-icon` presence, and the `Dockerfile.e2e` contents.

## Recommended Scope

1. Token split and build-time selection (UI only), plus the `next.config.js` allow-list and a unit test.
2. Production palette tokens plus a contrast unit test.
3. Dockerfile `ARG` and the `docker-build.yml` input wired through all three callers, plus a theme-mismatch guard in `deploy-homelab`.
4. Docs: the UI `CLAUDE.md` Styling and Docker sections, `docs/patterns/docker-build.md`, and `ui-ux-governance.md` §1.

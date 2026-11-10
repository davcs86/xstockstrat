# Product Spec: ui-env-themed-bundles

**Created**: 2026-11-10

---

## Problem Statement

Staging (paper) and production (live) `xstockstrat-ui` deployments look identical, so an operator can act in live trading while believing they are in staging. Each environment needs its own visually distinct bundle, with no change to content or behavior.

## User Story

As an operator, I want the xstockstrat-ui to be built as separate bundles for staging and production, each with its own visual theme, so the two environments are instantly distinguishable — without changing any content or behavior.

## Functional Requirements

FR-1. The UI build accepts a build-time theme selector `UI_THEME` with exactly two values, `staging` and `production`; the Docker image build exposes it as `ARG UI_THEME`.
FR-2. Only the selected theme's color tokens are compiled into the emitted CSS bundle — a production bundle contains no staging palette values and vice versa.
FR-3. The `staging` theme is the current Nocturne palette, byte-for-byte equivalent in its token values.
FR-4. The `production` theme is a new palette that redefines the same token set (`--background`, `--primary`, `--sidebar*`, `--chart-1..5`, …) and meets the C-17 accessibility contrast baseline.
FR-5. The semantic order-side roles (`--color-buy`, `--color-sell`, `--color-paper`) are identical in both themes.
FR-6. `deploy-dev.yml` builds the UI image with `UI_THEME=staging`; `deploy-prod.yml` builds it with `UI_THEME=production`. Image names and tags (`latest-dev`, `latest`, short-SHA) are unchanged.
FR-7. When `UI_THEME` is unset (local `pnpm dev`, Playwright e2e, docker-compose, CI), the build uses `staging`. An unrecognized value fails the build.
FR-8. Apart from color tokens, the two bundles are behaviorally identical: same routes, DOM structure, copy, and RPC calls.
FR-9. Every production token consumed by the canvas chart renderer (lightweight-charts) resolves to a color format that renderer parses; no chart throws `Failed to parse color` in either theme (ledger `fails.md`: canvas charting rejects `oklch(...)`).
FR-10. Theme selection is decided at build time only. No client or server code infers the theme from `APPLICATION_ENV` at runtime (ledger `fails.md`: `APPLICATION_ENV` is absent from the client bundle).
FR-11. The hardcoded color literals in `/insights` charts and pages (recharts series/axis/grid/marker colors, `text-[hsl(...)]` utilities) are replaced by theme tokens, so `/insights` follows the selected theme. Only color values change; DOM, copy and chart behavior stay the same. Staging `/insights` colors move to the Nocturne tokens (accepted visual change, operator 2026-11-10).
FR-12. The PWA manifest `theme_color`/`background_color` and `viewport.themeColor` are per theme, derived from the selected theme's `--background` at build time. The manifest keeps `display: standalone`, its icons and its `no-cache` header.
FR-13. The contrast baseline (WCAG 4.5:1 text, 3:1 non-text) is written into `docs/patterns/ui-ux-governance.md` §5. The production palette meets it for every `X`/`X-foreground` pair and for `primary`, `muted-foreground` and `destructive` used as text on `background`/`card`. Staging's existing shortfalls are recorded as known deviations, because staging values are frozen (FR-3).
FR-14. A UI image's theme is recorded as an image label. Re-pushing an existing `<sha>` tag with a different theme fails. Every deploy-from-tag path (homelab, DO `prod-up`, DO `staging-up`) refuses an image whose theme label differs from the target environment.

## Out of Scope

- Runtime theme switching, light mode, or a user-selectable theme.
- Changes to content, layout, copy, routes, or data behavior (component edits are limited to swapping color literals for tokens, FR-11).
- Separate image names/repositories per environment.
- Homelab-specific theming (homelab deploys reuse the image built by whichever workflow calls them; FR-14 guards the pairing).

## Affected Services

- `xstockstrat-ui` — theme token split, build-time selection, Dockerfile `ARG`.
- CI/CD (not a service): `.github/workflows/docker-build.yml`, `deploy-dev.yml`, `deploy-prod.yml` — pass the build arg.

## Consumer Surface(s)

- [x] **UI** — `xstockstrat-ui` all segments (`/trader`, `/insights`, `/config-ui`): visual theme only; no new page/route/field/control.
- [ ] **Agent**
- [ ] **None**

## Proto Contract Changes

- [x] No proto changes required

## Config Key Changes

- [x] No new config keys (`UI_THEME` is a build-time Docker build arg, not a runtime `WatchConfig` key or a runtime env var).

## Database Changes

- [x] No schema changes

## Feature Workflow Notes

Branch to create: `feature/ui-env-themed-bundles` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (`xstockstrat-ui`)
- [ ] 2 service owners + platform lead (breaking proto change) — n/a
- [ ] DBA review + service owner (schema migration) — n/a

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`) — the single source of acceptance truth (Constitution
**C-15**). Each `FR-N` above is covered by ≥1 tagged scenario there.

## Open Questions

- [x] Production palette values — **deferred to `/sdd-design`** (decision owner: operator, approves at the design gate). `acceptance.feature` AC-1/AC-8 are firmed up with the concrete values once approved.
- [x] Known trap: lightweight-charts rejects `oklch(...)` — promoted to **FR-9**.
- [x] Known trap: `APPLICATION_ENV` is not in the client bundle — promoted to **FR-10**.

# Recon: fix-config-ui-env

**Created**: 2026-08-07
**From**: product-spec.md
**Affected services**: xstockstrat-ui (config-ui segment)

---

## Objective

The Config UI's `EnvModeSwitcher` presents `ENV: dev/production` as two freely-clickable options
regardless of which environment the running deployment actually is, letting a user silently edit
config rows in a scope no real consumer can ever reach (dev and production are separate physical
databases). The fix must gate the non-native `ENV` option instead of offering it as a live choice,
mirroring the existing fixed-badge pattern already used for trading mode on the Accounts page.

## Codebase Map

- **`xstockstrat-ui`** (Next.js / TypeScript)
  - Namespace list page (Server Component, no `'use client'`): `services/xstockstrat-ui/src/app/config-ui/page.tsx:21-56`
    — `HomePage`, default redirect `?env=dev&mode=paper` (line 23-24)
  - `EnvModeSwitcher` (the component to fix): `services/xstockstrat-ui/src/app/config-ui/page.tsx:58-99`
    — both ENV options rendered as plain `<Link>`s, line 63 `{['dev', 'production'].map((e) => (`
  - Namespace detail/edit page (Client Component, `'use client'` at line 1): `services/xstockstrat-ui/src/app/config-ui/[namespace]/page.tsx`
    — `env`/`mode` search params default `'dev'`/`'paper'` (lines 59-60), flow into `useConfigKeys(namespace, env, mode)` (line 71) and `useSetConfig(namespace, env, mode)` (line 76); `envToProto`/`modeToProto` at lines 21-26
  - Hooks: `services/xstockstrat-ui/src/app/config-ui/hooks/useConfigKeys.ts:11-18` (its own separate `envToProto`/`modeToProto`, returning proto enums — a second, divergent copy of the same mapping already in `[namespace]/page.tsx:21-26`), `useSetConfig.ts` (plain mutation wrapper, no env gating)
  - Config-read pattern for `APPLICATION_ENV`: `services/xstockstrat-ui/src/telemetry.ts:20` — `process.env.APPLICATION_ENV ?? 'development'` (the only current consumer)
  - Fixed-badge precedent (the pattern to mirror): `services/xstockstrat-ui/src/components/shared/TradingModeBadge.tsx:12-22`
    — reads a `mode: EnvironmentMode | null` prop, renders via `Badge` + a plain HTML `title` attribute tooltip: `"This environment routes all orders to the ${mode} broker. The mode is fixed and cannot be switched."`
  - Source of the fixed value in that precedent: `services/xstockstrat-ui/src/context/AccountContext.tsx:46-49`
    — `const { tradingMode } = await tradingClient.getTradingEnvironment({}); setEnvironmentMode(tradingMode === TradingMode.LIVE ? 'live' : 'paper');` — note this precedent fetches the fixed value via a **backend RPC**, not a client-side env read; our fix instead reads `APPLICATION_ENV` directly since `page.tsx` is a Server Component with direct `process.env` access
  - Consumption of the precedent badge: `services/xstockstrat-ui/src/components/trader/AppShell.tsx:14,22`
  - e2e tests exercising the current (unguarded) behavior — will need updating:
    `services/xstockstrat-ui/e2e/config-ui/env-mode-switcher.spec.ts` (71 lines; every test asserts the current unguarded click-through, e.g. line 29 `page.getByRole('link', { name: 'production' }).click()`)
  - `playwright.config.ts:159-185` `webServer.env` block — does **not** currently set `APPLICATION_ENV`; a new gated-state test needs it added explicitly (or a per-test override mechanism)

## Patterns to REUSE

- **Fixed-value display when a dimension can't be switched** → reuse `TradingModeBadge`
  (`services/xstockstrat-ui/src/components/shared/TradingModeBadge.tsx:12-22`) as the shape to
  mirror for the non-native `ENV` option: a `Badge` + a `title`-attribute tooltip explaining why
  it's fixed. No shared Radix `Tooltip` primitive exists in `src/components/ui/` — the plain
  `title` attribute is the established, minimal pattern; don't introduce a new tooltip component
  for this fix.
- **Native-scope resolution** → do **not** invent a third copy of the `"development"`/`"production"`
  → `"dev"`/`"production"` normalization. Two divergent `envToProto`/`modeToProto` pairs already
  exist (`config-ui/page.tsx` has none yet; `[namespace]/page.tsx:21-26` and
  `hooks/useConfigKeys.ts:11-18` each have their own). The fix's native-scope check is a new,
  third piece of logic (`APPLICATION_ENV` → `'dev'`/`'production'`) — write it once, in one place
  reachable by both `page.tsx` (Server Component, for gating the link) and, if needed,
  `[namespace]/page.tsx` (Client Component, for gating the edit UI) rather than duplicating a
  third inline ternary. `services/xstockstrat-ui/src/lib/` (per this service's own CLAUDE.md
  layout: `basepath.ts`, `headers.ts` canonical-constant modules) is the existing home for this
  kind of small shared string-mapping helper.

## Dependencies

- Proto/RPC: none — no proto/RPC change; `APPLICATION_ENV` is read directly, not fetched via RPC
- Migration: none
- Config keys: none
- Inter-service edges: none — this is a pure UI-side gate, no new backend call
- New env vars / ports: none — `APPLICATION_ENV` already exists as a global env var on this
  service in both `.do/app.yaml:26-27` (`production`) and `.do/app.dev.yaml:26-27` (`development`);
  only newly *consumed* here, not newly introduced

## Risks / Not-found

- **String-format mismatch (already flagged in context.md, confirmed still live)**:
  `APPLICATION_ENV` is `"development"`/`"production"`; the Config UI's own `env` param/DB
  `environment` CHECK constraint is `"dev"`/`"production"` (`migrations/002_config_environment.up.sql:8`).
  A naive `APPLICATION_ENV === env` compare never matches on a dev deployment. Normalize
  `"development"` → `"dev"` (anything not `"production"` → dev), mirroring the companion Go
  hotfix's `resolveEnvironment` — not present in this checkout (lives on the unmerged
  `hotfix/fix-watchconfig-clients-omit` branch) but the same mapping direction applies here.
- **`APPLICATION_ENV` is not exposed to the client bundle**: `next.config.js` has no `env`/
  `publicRuntimeConfig` key exposing it. `EnvModeSwitcher` itself lives in the Server Component
  `page.tsx` (no `'use client'`), so it can read `process.env.APPLICATION_ENV` directly — no
  bridge needed for the gating decision on the namespace-list page. If `[namespace]/page.tsx`
  (a Client Component) also needs the native scope (e.g. to disable the Save button when viewing
  a non-native scope), that value must be passed down as a prop/server-fetched value, not read
  directly — it cannot call `process.env` client-side.
- **e2e coverage will regress if not updated in the same step**: `env-mode-switcher.spec.ts`'s
  existing tests assert the exact unguarded click-through behavior this fix removes for the
  non-native option — per **C-10**/**AC-3**, the fix step must update these tests, not just add a
  new one, or CI will fail on the very tests validating this feature.
- **DRY duplication pre-existing, not caused by this fix but adjacent**: `envToProto`/`modeToProto`
  already exist as two independent copies (`[namespace]/page.tsx:21-26` and
  `useConfigKeys.ts:11-18`). Out of scope to consolidate per product-spec's Out of Scope (only
  MODE-axis and unrelated refactoring are explicitly excluded, but this is pre-existing drift, not
  something this fix's own new code should add a third copy of, or the dry-reviewer/jscpd gate may
  flag it).
- **Not found**: no shared Radix `Tooltip` primitive in `src/components/ui/`; no `disabled`
  variant on `badgeVariants` (`src/components/ui/badge.tsx`) — the fix will use the existing plain
  `title`-attribute pattern and existing badge variants (or a disabled-link style already used
  elsewhere in `EnvModeSwitcher`'s own non-active-state styling, lines 67-71) rather than
  introducing new UI primitives.

## Recommended Scope

One implementation step is likely sufficient, given the confirmed single-service, single-file-pair
footprint:

1. **UI gate + tests** (`xstockstrat-ui`): add the native-scope helper (small, single new home —
   e.g. `src/lib/deploymentEnv.ts` or similar, normalizing `APPLICATION_ENV`), wire it into
   `EnvModeSwitcher` to render the non-native `ENV` option as a fixed/disabled badge (mirroring
   `TradingModeBadge`) instead of a `<Link>`, update `env-mode-switcher.spec.ts`'s existing
   assertions for the new gated behavior, and add one new test for the gated/non-native state
   (AC-3). `playwright.config.ts`'s `webServer.env` needs `APPLICATION_ENV` added so the e2e run
   has a deterministic native scope to assert against.

No second service is touched — `xstockstrat-config` was listed in product-spec's Affected Services
as the *data model* the toggle exposes, not as a service requiring its own code change; recon found
no `xstockstrat-config` code path this fix needs to modify.

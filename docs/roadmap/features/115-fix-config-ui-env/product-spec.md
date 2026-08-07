# Product Spec: fix-config-ui-env

**Type**: bug
**GitHub Issue**: docs/reports/2026-08-07-config-ui-cross-environment-toggle-defect.md (GitHub Issues disabled on this repo)
**Severity**: SEV-2
**Created**: 2026-08-07

---

## Problem Statement

The Config UI's `EnvModeSwitcher` (`/config-ui`) renders `ENV: dev/production` and `MODE:
paper/live` as freely clickable links regardless of which environment the running `xstockstrat-ui`
deployment actually is. Selecting the non-native `ENV` value calls `ListKeys`/`SetConfig` scoped to
that `environment` column on the single `xstockstrat-config` instance this deployment is wired to —
but dev and production are separate physical databases (`xstockstrat-staging` vs
`xstockstrat-production`, same DO cluster, different `db_name`). A row tagged
`environment='production'` inside the dev deployment's database is never read by the production
deployment. A user on the dev-deployed Config UI who switches `ENV=production` and edits a value
believes they changed a production setting; they have actually written to an inert, unreachable row
that no running service will ever consume — with no warning that the edit doesn't go anywhere real.

Expected behavior: the Config UI should not offer a live choice for a scoping dimension it cannot
actually reach. `ENV` should reflect the native environment of the deployment you're on — read from
`APPLICATION_ENV` (already available to `xstockstrat-ui` at runtime, currently only consumed by
`src/telemetry.ts:20-21`) — mirroring the pattern the Accounts page already uses for trading mode
(`GetTradingEnvironment` → fixed read-only badge, no picker) instead of presenting a switch that
silently edits data nobody will ever read.

## Reproduction Steps

1. Deploy/run `xstockstrat-ui` as the dev instance (or `pnpm dev` locally against dev config).
2. Visit `/config-ui`, click `ENV: production`.
3. Open a namespace, edit a value, save.
4. The write succeeds (`SetConfig` upserts `environment='production'` in the dev database) but the
   production deployment — a different physical database — never sees it.

## Root Cause Hypothesis

The `environment`/`trading_mode` columns were built as a genuine config-scoping mechanism within
one database, but the UI toggle was never gated to the deployment's own native scope — so it reads
as a live environment switch when it can only ever reach the single database the running instance
is bound to.

## Affected Services

- xstockstrat-ui (config-ui segment) — `EnvModeSwitcher` and its Link-based navigation
- xstockstrat-config — the `environment`/`trading_mode`-scoped data model the toggle exposes

## Fix Scope

- [x] No proto changes anticipated
- [x] No database migrations anticipated
- [x] No config key changes anticipated — this is a UI behavior change, not a config value change

(Update after investigation — remove or replace each item as needed)

## Consumer Surface(s)

- **UI segment**: `xstockstrat-ui`, `/config-ui` segment — `EnvModeSwitcher`
  (`services/xstockstrat-ui/src/app/config-ui/page.tsx:58-99`) and its Link-based `env`/`mode`
  query-param navigation, consumed by `services/xstockstrat-ui/src/app/config-ui/[namespace]/page.tsx`.
  No other UI segment or the MCP agent surface is affected.

## Acceptance Criteria

- **AC-1**: The Config UI does not present the non-native `ENV` option as a plain, silently-writable
  choice on a deployment whose `APPLICATION_ENV` fixes it to the other value — mirroring the
  Accounts page's fixed read-only mode badge instead of a picker.
- **AC-2**: No behavior change to same-scope (native `ENV`) reads/writes.
- **AC-3**: Existing config-ui e2e tests pass; a new test covers the gated/non-native state.

## Out of Scope

- The companion SEV-1 defect (`hotfix/fix-watchconfig-clients-omit` — WatchConfig clients omitting
  `environment`/`trading_mode`) is tracked and fixed separately; do not fold that fix in here.
- Any change to the `MODE` (paper/live) axis beyond what's needed for consistency with the `ENV`
  fix — `trading_mode` rows are not siloed by database the way `environment` is, and a broader
  MODE-gating change (if warranted) should be scoped in its own follow-up, not bundled here.
- Refactoring unrelated to the bug
- Performance improvements unrelated to the fix

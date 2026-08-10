# Defect: Config UI ENV toggle permits silent cross-environment/cross-database edits

**Recorded**: 2026-08-07
**Severity**: SEV-2
**Impact type**: config-propagation
**Environment**: dev (main-dev) and production — architecture-level, present in both deployments
**Affected service(s)**: xstockstrat-ui (config-ui segment), xstockstrat-config
**Config-only fix possible**: no

## Observed

The Config UI's `EnvModeSwitcher` (`/config-ui`) renders ENV as `dev`/`production` and MODE as
`paper`/`live` as freely clickable links regardless of which environment the running
`xstockstrat-ui` deployment actually is. Selecting the non-native `ENV` value calls
`ListKeys`/`SetConfig` scoped to that `environment` column on the single `xstockstrat-config`
instance this deployment is wired to — but dev and production are **separate physical databases**
(`xstockstrat-staging` vs `xstockstrat-production`, same DO cluster, different `db_name`). A row
tagged `environment='production'` inside the dev deployment's database is never read by the
production deployment. A user on the dev-deployed Config UI who switches `ENV=production` and
edits a value believes they changed a production setting; they have actually written to an inert,
unreachable row that no running service will ever consume — with no warning that the edit doesn't
go anywhere real.

This compounds with the higher-severity companion defect
(`2026-08-07-watchconfig-scope-omission-defect.md`): today no backend `WatchConfig` subscriber ever
requests a non-`dev`/`all` scope regardless of deployment, so even a correctly-targeted
`production`- or `live`-tagged edit made from the *correct* deployment's Config UI would currently
have no effect either. Fixing that companion defect makes the ENV/MODE toggle's cross-scope writes
reachable by real consumers again — which raises the stakes on this UI-honesty gap rather than
lowering them.

## Expected

The Config UI should not offer a live choice for a scoping dimension it cannot actually reach.
`ENV` (and, if the running deployment's `TRADING_MODE` is fixed, `MODE`) should reflect the native
environment/mode of the deployment you're on — read from `APPLICATION_ENV`/`TRADING_MODE`, the same
globals every service already gets (`.do/app.yaml:26-29`, `.do/app.dev.yaml:26-29`) — mirroring the
pattern the Accounts page already uses for trading mode (`GetTradingEnvironment` → fixed read-only
badge, no picker, per `xstockstrat-trading/CLAUDE.md`) instead of presenting a switch that silently
edits data nobody will ever read.

## Reproduction

1. Deploy/run `xstockstrat-ui` as the dev instance (or `pnpm dev` locally against dev config).
2. Visit `/config-ui`, click `ENV: production`.
3. Open a namespace, edit a value, save.
4. The write succeeds (`SetConfig` upserts `environment='production'` in the dev database) but the
   production deployment — a different physical database — never sees it.

## Evidence

`services/xstockstrat-ui/src/app/config-ui/page.tsx:58-77`
> `{['dev', 'production'].map((e) => (<Link key={e} href={`/config-ui?env=${e}&mode=${mode}`} ...`
(both ENV options always rendered as live links, no gating on the deployment's own environment)

`services/xstockstrat-config/src/grpc/configServiceImpl.ts:358-367`
> `WHERE namespace = $1 AND environment = $2 AND (trading_mode = $3 OR trading_mode = 'all')`
(server genuinely scopes by the `environment` column passed in the request — confirms the write
"succeeds" and is silently inert, not rejected)

`.do/app.yaml:487-493` vs `.do/app.dev.yaml:487-493`
> `cluster_name: xstockstrat` / `db_name: xstockstrat-production` (prod) vs `db_name: xstockstrat-staging` (dev)
(same cluster, physically separate databases — a `production`-tagged row in the dev DB is not the
row production reads)

`.do/app.yaml:26-29` / `.do/app.dev.yaml:26-29`
> `APPLICATION_ENV: production` / `TRADING_MODE: live` (prod) vs `APPLICATION_ENV: development` /
> `TRADING_MODE: paper` (dev) — global envs already available to `xstockstrat-ui` at runtime
> (currently only consumed by `src/telemetry.ts:20-21`), giving a ready native-scope source for the fix.

`services/xstockstrat-config/migrations/002_config_environment.up.sql:6-8`
> `ADD COLUMN IF NOT EXISTS environment TEXT NOT NULL DEFAULT 'dev' CHECK (environment IN ('dev', 'production'));`
(seeded production-scoped defaults are deliberately *more conservative* risk values — the exact
kind of value someone could believe they'd tightened on production without it taking effect)

## Root cause hypothesis

The `environment`/`trading_mode` columns were built as a genuine config-scoping mechanism within
one database, but the UI toggle was never gated to the deployment's own native scope — so it reads
as a live environment switch when it can only ever reach the single database the running instance
is bound to.

## Confidence

high

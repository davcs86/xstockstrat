# Infrastructure Cost Reduction Strategy

> Operational optimization of the DigitalOcean App Platform footprint. This
> runbook describes **what to change and why**, in terms of instance sizing and
> lifecycle. It deliberately avoids dollar figures — App Platform list prices
> drift and apps may be billed on different plan schedules, so size against the
> DO billing invoice and DO Insights metrics, not numbers in a doc.

## Current state (verified against live deployments, 2026-06)

Two always-on environments, each running all 12 components, plus one shared
managed Postgres cluster.

| Component group | Prod (`live`) slug | Staging (`paper`) slug |
|---|---|---|
| 11 app/backend services | `basic-xs` (1 vCPU / 1 GB) | `basic-xs` → mixed (see Tier 1) |
| `xstockstrat-config` | `basic-s` (1 vCPU / 2 GB) | `basic-s` |
| `db-migrator` (PRE_DEPLOY job) | `basic-xs` (per-second) | `basic-xs` |

Shared DB: single-node `db-s-1vcpu-1gb`, 10 GiB, hosts both
`xstockstrat-production` and `xstockstrat-staging` databases.

The cost driver is **24 always-on instances** (12 per environment). The
database is already at the floor and correctly shared — leave it alone.

## Key observations

1. **`professional-xs` buys nothing over `basic-xs` here.** Both are
   *1 shared vCPU / 1 GB*; the App Platform 60-second idle timeout applies to
   both tiers equally (only `*-s` and above raise it — that's why `config`
   needs `*-s`). The only delta is professional-tier features (horizontal
   autoscaling, >3 instances, zero-downtime niceties) that this
   1-instance-per-service topology doesn't use.
2. **Backend services are over-provisioned on RAM.** Go services
   (`trading`, `portfolio`, `marketdata`) idle in the tens of MB; the Node
   services (`ledger`, `identity`, `notify`) sit comfortably under 512 MB.
   Only the Python services (`indicators`, `ingest`, `analysis`, `agent`),
   the Next.js `ui`, and `config` (streaming headroom) genuinely want 1–2 GB.
   Validate against DO Insights memory graphs before shrinking.
3. **Staging is a paper/dev environment** that is up 24/7 but only exercised
   during development and CI.
4. **App Platform does not scale services to zero.** The only way to stop
   paying for an idle environment is to destroy and recreate it (the spec is
   already declarative in `.do/app.yaml` / `.do/app.dev.yaml`, so recreation is
   one CI step).

## Recommended tiers

Pick a tier by risk appetite. Each builds on the previous.

### Tier 1 — Right-size (no architecture change, low risk) — **APPLIED**

- **Prod:** moved entirely to the Basic tier — `professional-xs` → `basic-xs`
  for all 11 services, `professional-s` → `basic-s` for `config`. Functionally
  identical here (`professional-xs` is the same shared 1 vCPU/1 GB as
  `basic-xs`; `basic-s` raises the idle timeout the same way `professional-s`
  does — staging already proves this).
- **Staging:** dropped the 3 Go + 3 Node (`ledger`/`identity`/`notify`)
  services to `basic-xxs` (512 MB). Python/`ui` stay on `basic-xs`; `config`
  stays on `basic-s`.
- Validation: watch DO Insights for OOM/restart after each change; roll back
  the individual service's slug if it trips. `config` is the one to watch —
  if `WatchConfig` subscribers drop, it needs to stay on a `*-s` size.

### Tier 2 — Production down-by-default (pre-maturity) — **APPLIED**

Because production is not yet truly live (`until project maturity`), it does
not need to run 24/7. Production is kept **torn down by default** and brought
up on demand via manual workflows (see "Operating the production teardown"
below). While torn down, the stateless service instances stop billing entirely.

- The shared Postgres cluster stays up, so **no data is lost** across teardown —
  only the stateless service instances are deleted and recreated.
- **Trade-offs:** (1) the platform is fully offline while torn down — only do
  this while there is no real live-trading obligation; (2) recreating the app
  may assign a **new `*.ondigitalocean.app` URL** unless a custom domain is
  attached, so pin a domain before relying on a stable address; (3) bring-up is
  a full deploy (cold start, minutes); (4) `DO_PROD_APP_ID` changes on recreate
  and must be refreshed.
- Revert path: when the project matures, leave prod permanently up and stop
  using the teardown workflow.

### Tier 3 — Service consolidation (major refactor, highest leverage)

- The 12-service Spine topology means a minimum-billable instance *per service
  per environment*. Grouping deployables by runtime — e.g. one Go binary
  hosting `trading`+`portfolio`+`marketdata`, one Python app hosting
  `indicators`+`ingest`+`analysis`, etc. — collapses ~12 instances/env to ~5
  without losing logical service boundaries (they remain separate gRPC servers
  inside one process/image, or separate processes in one container).
- Biggest structural saving, but it touches the platform's core architecture
  and proto wiring. Treat as a roadmap feature (SDD), not a config tweak.

## Operating the production teardown (Tier 2)

Production runs in a **down-by-default** model. Two manual GitHub Actions
workflows toggle it (shared `prod-lifecycle` concurrency group so they can't
race):

| Workflow | What it does |
|---|---|
| **Prod — bring up** (`prod-up.yml`) | `doctl apps create` from `.do/app.yaml`, injecting all runtime secrets, waits for the deploy, prints the URL + new app id. Input: `image_tag` (default `latest`). |
| **Prod — tear down** (`prod-down.yml`) | Looks the app up by name and `doctl apps delete`s it. Requires typing `destroy-prod` to confirm. |

**Data safety:** teardown deletes only the App Platform app. The managed
Postgres cluster `xstockstrat` is a separate resource and is never touched, so
all data survives across down/up cycles.

**Required GitHub Secrets** (bring-up injects these because a fresh
`doctl apps create` does *not* inherit dashboard-set SECRET values the way
`doctl apps update` does):

`PROD_JWT_SECRET`, `PROD_BROKER_ACCOUNTS_ENCRYPTION_KEY`, `ALPACA_API_KEY`,
`ALPACA_API_SECRET`, `MCP_AGENT_SECRET`, plus `DIGITALOCEAN_ACCESS_TOKEN` and
(optional) `DO_PROD_PROJECT_ID`. Injection is handled by
`scripts/do-inject-prod-secrets.py`; a missing secret logs a warning and the
component comes up with an unset value.

**Caveats to know before relying on this:**

- **New app id / URL each bring-up.** Recreating assigns a fresh app id and,
  without a custom domain, a new `*.ondigitalocean.app` URL. The bring-up job
  prints both and warns you to update the `DO_PROD_APP_ID` secret. Pin a custom
  domain if you need a stable address.
- **Stale `DO_PROD_APP_ID` breaks push-to-main deploys.** While prod is down
  (or after a bring-up before you refresh the secret), `deploy-prod.yml` will
  target a non-existent/old app id and fail. That's expected pre-maturity —
  refresh `DO_PROD_APP_ID` after each bring-up, or redeploy via bring-up.
- **First bring-up needs validation.** Confirm `doctl apps create` *attaches*
  the existing `xstockstrat` cluster (via the spec `databases:` block) rather
  than provisioning a new one, and that all secrets landed (check the running
  spec / service logs).

## What NOT to change

- **Don't split the database.** One shared single-node cluster for both envs
  is already the cheapest viable managed-PG setup. Splitting prod/staging into
  separate clusters would *add* a cluster for no benefit.
- **Don't drop `config` below `*-s`.** The `WatchConfig` streaming RPC needs
  the raised idle timeout; `*-xs` will sever long-lived subscriber streams.
- **Don't shrink Python/Next.js services to 512 MB** without metrics — they
  will OOM under load.

## Execution order

1. ✅ Tier 1 prod right-size (`professional-*` → Basic tier) — `.do/app.yaml`.
2. ✅ Tier 1 staging right-size (Go/Node → `basic-xxs`) — `.do/app.dev.yaml`.
3. ✅ Tier 2 production down-by-default — `prod-up.yml` / `prod-down.yml` +
   `scripts/do-inject-prod-secrets.py`, active until project maturity.
4. (Roadmap) Tier 3 consolidation — SDD feature.

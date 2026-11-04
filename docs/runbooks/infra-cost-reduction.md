# Infrastructure Footprint & Production Lifecycle

How the DigitalOcean App Platform footprint is sized and operated. Size against
the DO billing invoice and DO Insights metrics — this runbook describes the
configuration, not price figures.

## Instance sizing

Both environments run all 12 components. One shared single-node managed Postgres
cluster (`db-s-1vcpu-1gb`, 10 GiB) hosts both the `xstockstrat-production` and
`xstockstrat-staging` databases.

| Component | Prod (`.do/app.yaml`) | Staging (`.do/app.dev.yaml`) |
|---|---|---|
| `xstockstrat-config` | `basic-s` (1 vCPU / 2 GB) | `basic-s` |
| Go services (`trading`, `portfolio`, `marketdata`) | `basic-xs` (1 vCPU / 1 GB) | `basic-xxs` (512 MB) |
| Node services (`ledger`, `identity`, `notify`) | `basic-xs` | `basic-xxs` |
| Python services (`indicators`, `ingest`, `analysis`, `agent`) | `basic-xs` | `basic-xs` |
| Next.js `ui` | `basic-xs` | `basic-xs` |
| `db-migrator` (PRE_DEPLOY job) | `basic-xs` | `basic-xs` |

Sizing rules to preserve:

- **`config` must stay `*-s` or larger.** The `WatchConfig` streaming RPC needs
  the raised idle timeout; `*-xs` severs long-lived subscriber streams.
- **Don't shrink Python or `ui` below `basic-xs`** without DO Insights metrics —
  they will OOM under load. The 512 MB `basic-xxs` tier is only safe for the Go
  and Node backends, which idle well under that.
- **Don't split the database.** One shared single-node cluster for both
  environments is the floor; separate clusters add cost for no benefit.

## Production lifecycle (down-by-default)

Production is kept **torn down by default** while the project is pre-maturity,
and brought up on demand. While torn down, the stateless service instances stop
billing; the shared Postgres cluster stays up, so no data is lost.

Two manual GitHub Actions workflows toggle it (shared `prod-lifecycle`
concurrency group so they can't race):

| Workflow | What it does |
|---|---|
| **Prod — bring up** (`prod-up.yml`) | `doctl apps create` from `.do/app.yaml`, injecting all runtime secrets, waits for the deploy, prints the URL + new app id. Input: `image_tag` (default `latest`). |
| **Prod — tear down** (`prod-down.yml`) | Looks the app up by name and `doctl apps delete`s it. Requires typing `destroy-prod` to confirm. |

**Data safety:** teardown deletes only the App Platform app. The managed
Postgres cluster `xstockstrat` is a separate resource and is never touched.

**Required secrets.** Bring-up injects the full deploy key set, because a fresh
`doctl apps create` does *not* inherit dashboard-set SECRET values the way
`doctl apps update` does. The values come from `secrets/production.enc.yaml` (`common.*`,
`digitalocean.PROJECT_ID`), with a per-key fallback to the legacy `PROD_*` / `DO_PROD_PROJECT_ID` repo secrets.
`DIGITALOCEAN_ACCESS_TOKEN` and the `production` environment's `SOPS_AGE_KEY` are also needed (see
`docs/runbooks/sops-secrets.md`). `scripts/do-render-app-spec.py` renders the spec. A required key that is in
neither store fails the run before `doctl apps create`, and the step summary lists each key's source.

**Caveats:**

- **New app id / URL each bring-up.** Recreating assigns a fresh app id and,
  without a custom domain, a new `*.ondigitalocean.app` URL. Deploys resolve the
  app by its spec name (`xstockstrat-production`), so nothing needs updating. Pin a
  custom domain if you need a stable address.
- **The `production` reviewer gate applies.** Bring-up binds the `production`
  environment, so it waits for that environment's required reviewers.
- **First bring-up needs validation.** Confirm `doctl apps create` *attaches*
  the existing `xstockstrat` cluster (via the spec `databases:` block) rather
  than provisioning a new one, and that all secrets landed (check the running
  spec / service logs).

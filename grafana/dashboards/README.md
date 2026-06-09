# grafana/dashboards/ — Dashboards as Code

Grafana dashboards for the xstockstrat platform, stored as JSON and deployed to
Grafana Cloud by CI. **This directory is the source of truth** — edit the JSON
here, not the Grafana UI. Anything changed only in the UI inside the managed
folder will be overwritten on the next sync.

## How it deploys

On every push to `main-dev` or `main` that touches `grafana/**` (or the deploy
script/workflow), the **Grafana dashboards** workflow
(`.github/workflows/grafana-dashboards.yml`) runs
`scripts/grafana-deploy-dashboards.sh`, which uploads every `*.json` file in
this directory to Grafana Cloud via the HTTP API.

- Each dashboard is keyed by its **`uid`** and uploaded with `overwrite: true`,
  so re-runs are idempotent (create-or-update in place).
- All dashboards land in a managed folder (default `xstockstrat`, configurable
  via `GRAFANA_FOLDER_UID` / `GRAFANA_FOLDER_TITLE`).
- The workflow needs two repository secrets — `GRAFANA_URL` and
  `GRAFANA_SERVICE_ACCOUNT_TOKEN` (Editor role). See
  `docs/setup/grafana-cloud.md` Step 6.

## Adding or editing a dashboard

1. Build/tweak it in the Grafana UI, then **Export → Export as JSON** (toggle
   "Export for sharing externally" **off** — keep the raw model).
2. Save the JSON into this directory, one file per dashboard.
3. Make it portable and idempotent:
   - Set a stable, descriptive **`uid`** (e.g. `xstockstrat-service-health`).
     Never change a `uid` once deployed — that creates a duplicate dashboard.
   - Use a **datasource template variable** (`${datasource}`) instead of a
     hardcoded datasource uid, so the dashboard works across stacks. Datasource
     uids differ between Grafana Cloud stacks; hardcoding one breaks the import.
   - Drop the top-level numeric `"id"` (the deploy script forces it to `null`).
4. Commit and open a PR to `main-dev`. On merge, CI deploys it.

## Local / manual deploy

```bash
export GRAFANA_URL=https://<your-stack>.grafana.net
export GRAFANA_SERVICE_ACCOUNT_TOKEN=glsa_xxxxxxxx   # Editor role
./scripts/grafana-deploy-dashboards.sh
```

## Current dashboards

| File | uid | Description |
|---|---|---|
| `service-health-overview.json` | `xstockstrat-service-health` | Request rate, error rate %, p99 latency, and services-reporting count across all services (Dashboard 1 in the setup guide). |

> The remaining dashboards described in `docs/setup/grafana-cloud.md` Step 6
> (Order Flow Traces, Market Data & Alpaca, Config Change Audit, WatchConfig
> Stream Health) can be added here the same way as they're built out.

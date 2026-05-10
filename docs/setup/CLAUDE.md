# docs/setup/ — Setup Guides

Local environment bootstrap and external service setup. Start with `getting-started.md`.

| File | What it covers |
|---|---|
| `getting-started.md` | **Start here.** Prerequisites, env file, proto gen, bootstrap script, Docker Compose, health checks. Two tracks: Quick Start (10 min) and Deep Dive (architecture + SDD workflow). |
| `alpaca.md` | Alpaca Markets — create account, generate paper and live API keys, configure data subscription tier, wire credentials into dev and prod environments, verify connectivity |
| `digitalocean.md` | DigitalOcean App Platform — create DO account, install doctl, create managed PostgreSQL with TimescaleDB, create dev and prod App Platform apps from `.do/app.dev.yaml` / `.do/app.yaml`, set secrets, configure GitHub Actions CI/CD |
| `grafana-cloud.md` | Grafana Cloud + OpenTelemetry — create Grafana Cloud account and stack, obtain OTLP endpoint and token, configure OTel Collector for local dev, set env vars for production, verify traces/metrics/logs arrive, set up dashboards and alert rules |
| `n8n.md` | n8n Cloud — create n8n account, import pre-built workflow JSONs from `packages/n8n/workflows/`, configure credentials (webhook secret, IMAP), update service URLs for dev/prod, activate workflows, add newsletter signal sources |

**Setup order for a new environment:**
1. `getting-started.md` — local environment (everyone runs this first)
2. `alpaca.md` — credentials needed by all trading services
3. `digitalocean.md` — cloud deployment
4. `grafana-cloud.md` — observability
5. `n8n.md` — automation / external integrations

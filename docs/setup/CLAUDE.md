# docs/setup/ — One-Time Setup Guides

External service setup guides. Run each once when first provisioning the platform. They are not operational runbooks — after initial setup, refer to `docs/runbooks/` for day-to-day operations.

| File | Service | What it covers |
|---|---|---|
| `alpaca.md` | Alpaca Markets | Create account, generate paper and live API keys, configure data subscription tier, wire credentials into dev and prod environments, verify connectivity |
| `digitalocean.md` | DigitalOcean App Platform | Create DO account, install doctl, create managed PostgreSQL with TimescaleDB, create dev and prod App Platform apps from `.do/app.dev.yaml` / `.do/app.yaml`, set secrets, configure GitHub Actions CI/CD |
| `grafana-cloud.md` | Grafana Cloud + OpenTelemetry | Create Grafana Cloud account and stack, obtain OTLP endpoint and token, configure OTel Collector for local dev, set env vars for production, verify traces/metrics/logs arrive, set up dashboards and alert rules |
| `n8n.md` | n8n Cloud | Create n8n account, import pre-built workflow JSONs from `packages/n8n/workflows/`, configure credentials (webhook secret, IMAP), update service URLs for dev/prod, activate workflows, add newsletter signal sources |

**Setup order for a new environment:**
1. `alpaca.md` — credentials needed by DO setup
2. `digitalocean.md` — deploys all services
3. `grafana-cloud.md` — observability
4. `n8n.md` — automation / external integrations

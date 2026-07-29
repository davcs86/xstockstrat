# Identity Operations

> On-demand detail relocated from `CLAUDE.md` (context-forge just-in-time move): user provisioning and deploy-time JWT secret wiring.

## User Management

`scripts/manage-users.sh` (repo root) creates and resets passwords for identity service users. It uses `bcrypt` from the identity service's `node_modules` and requires `psql`.

```bash
# From repo root (local dev):
./scripts/manage-users.sh create-user admin@example.com admin,trader
./scripts/manage-users.sh reset-password admin@example.com

# Inside a running container (docker exec):
docker exec -it xstockstrat-identity \
  DATABASE_URL=<url> /app/scripts/manage-users.sh create-user admin@example.com admin
```

The script is copied into the Docker image at `/app/scripts/manage-users.sh` by the `Dockerfile` runner stage. When run inside the container it auto-detects the container layout (`node_modules` at `/app` instead of the local service directory).

## JWT_SECRET

`JWT_SECRET` must be set identically in the identity service and all three frontends (trader, insights, config-ui). It is injected at deploy time from GitHub Actions secrets:

| Secret | Used by |
|---|---|
| `DEV_JWT_SECRET` | `deploy-dev.yml` → `.do/app.dev.yaml` |
| `PROD_JWT_SECRET` | `deploy-prod.yml` → `.do/app.yaml` |

Generate: `openssl rand -hex 32`

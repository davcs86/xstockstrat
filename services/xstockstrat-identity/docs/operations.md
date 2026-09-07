# Identity Operations

> On-demand detail relocated from `CLAUDE.md` (context-forge just-in-time move): user provisioning and deploy-time JWT secret wiring.

## User Management

`scripts/manage-users.py` (repo root) creates users, resets passwords, and lists users. It uses Python `bcrypt` (cost 10, matching the identity service) and `psycopg` for direct DB access — no Node.js or `psql` dependency.

```bash
# Preferred — uv auto-installs deps in an ephemeral venv:
uv run scripts/manage-users.py create-user admin@example.com admin,trader
uv run scripts/manage-users.py reset-password admin@example.com
uv run scripts/manage-users.py list-users --active-only

# Or install deps manually (once) and run directly:
pip install 'typer>=0.15' 'bcrypt>=4.2' 'psycopg[binary]>=3.2'
python scripts/manage-users.py create-user admin@example.com

# Remote DB (e.g. managed DigitalOcean):
DATABASE_URL='postgres://user:pass@host:25060/db?sslmode=require' \
  uv run scripts/manage-users.py list-users
```

The script resolves `DATABASE_URL` from the environment, or falls back to constructing a local-dev URL from `POSTGRES_PASSWORD` in `.env`. It is **not** copied into the Docker image — run it from the repo root (or any machine with Python ≥ 3.12 and network access to the database).

## JWT_SECRET

`JWT_SECRET` must be set identically in the identity service and all three frontends (trader, insights, config-ui). It is injected at deploy time from GitHub Actions secrets:

| Secret | Used by |
|---|---|
| `DEV_JWT_SECRET` | `deploy-dev.yml` → `.do/app.dev.yaml` |
| `PROD_JWT_SECRET` | `deploy-prod.yml` → `.do/app.yaml` |

Generate: `openssl rand -hex 32`

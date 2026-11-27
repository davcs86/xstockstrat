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

The script resolves `DATABASE_URL` from the environment, or falls back to constructing a local-dev URL from `POSTGRES_PASSWORD` in `.env`. It is copied into the identity Docker image at `/app/scripts/manage-users.py` (Python + deps installed in the runner stage), so it can also be run via `docker exec` against the running container.

## SSO mode and links (feature 345)

`set-auth-mode` changes `identity` / `auth.mode` for one environment's global row without a login; `unlink-sso` removes
a user's SSO links. Full lifecycle → `docs/runbooks/authelia-sso-cutover.md`.

```bash
# DATABASE_URL is required (no .env fallback); prints both environments' rows before and after
uv run scripts/manage-users.py set-auth-mode both --environment staging --reason "SSO linking window"
# Every issuer's link, or one; --force skips the confirmation
uv run scripts/manage-users.py unlink-sso user@example.com --issuer https://auth.example.com --force
```

- An invalid value exits 2 without connecting; a missing row is success for `local` and exits 1 for `both`/`oidc`
  ("seed migration not applied"). The command always re-sends the change notify.
- Check that `--environment` matches the deployment's `APPLICATION_ENV`: each database holds both environments' rows.
- **Break-glass**: `set-auth-mode local` restores password login and the built-in MCP OAuth server at once; rollback is
  the same command with the previous value.
- After `unlink-sso` the person links again with Link SSO while the mode is `both`.

## JWT_SECRET

`JWT_SECRET` must be set identically in the identity service and all three frontends (trader, insights, config-ui). It is injected at deploy time from `common.JWT_SECRET` in the SOPS files (`docs/runbooks/sops-secrets.md`), with a per-key fallback to the legacy GitHub secrets:

| Source | Used by |
|---|---|
| `secrets/staging.enc.yaml` `common.JWT_SECRET` (fallback `DEV_JWT_SECRET`) | `deploy-dev.yml` → `.do/app.dev.yaml`, homelab staging |
| `secrets/production.enc.yaml` `common.JWT_SECRET` (fallback `PROD_JWT_SECRET`) | `deploy-prod.yml` / `prod-up.yml` → `.do/app.yaml`, homelab production |

Generate: `openssl rand -hex 32`

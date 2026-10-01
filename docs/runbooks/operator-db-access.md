# Runbook: Operator Database Access (out-of-band admin SQL)

**When to use**: an operator needs to run admin/ad-hoc SQL against the managed database (schema
inspection, a one-off data fix, health/index analysis).

> **There is no SQL-over-MCP surface.** The agent's `db_*` tools and the `postgres-mcp` co-process were
> removed entirely (feature 214, closing security finding **H-5 / DT-2**). No MCP server — the
> `xstockstrat-agent` or any other — exposes any SQL-executing tool. A prompt-injected or compromised
> agent session therefore has no tool, co-process, credential, or network path to reach the database.
> Admin SQL is run **out-of-band** by a human operator, as documented below. Do **not** reintroduce a
> DB-over-MCP tool.

---

## Prerequisites

- Membership in the DigitalOcean team that owns the managed cluster, and a DO API token
  (`DIGITALOCEAN_ACCESS_TOKEN`) or console access.
- A PostgreSQL client (`psql`). Install:
  - **macOS (primary)**: `brew install libpq` then add its `bin` to `PATH`
    (`echo 'export PATH="$(brew --prefix libpq)/bin:$PATH"' >> ~/.zshrc`), or `brew install postgresql@16`
    for the full toolset.
  - **Other (Linux)**: install your distro's `postgresql-client` package.
- `doctl` for pulling connection details: `brew install doctl` (macOS) — see `docs/setup/digitalocean.md`.

## Connection details

The database is DigitalOcean Managed PostgreSQL (TimescaleDB). Two ports (root `CLAUDE.md` §
Connection Pool Budget): **`:25060`** direct and **`:25061`** PgBouncer transaction pool. For admin
SQL use the **direct** port `:25060`.

Pull the connection string as a DB owner:

```bash
# List clusters and copy the target cluster id
doctl databases list

# Print the admin connection URI (direct :25060)
doctl databases connection <cluster-id> --format URI
```

## Running admin SQL

```bash
# Interactive session (TLS is required on the managed cluster)
psql "<connection-uri-from-doctl>?sslmode=require"

# One-off statement
psql "<connection-uri>?sslmode=require" -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM marketdata.ohlcv;"
```

If direct network egress to the cluster is restricted, tunnel through a bastion / droplet on the
VPC first (SSH local port-forward), then point `psql` at the forwarded local port.

## Safety

- Prefer read-only inspection; wrap any mutation in an explicit transaction and review before `COMMIT`.
- Never paste production credentials into a shared channel, an issue, or an agent prompt.
- Destructive DDL/DML is a human decision made here — it is deliberately **not** available to any
  automated agent surface.

## Cleanup note (feature 214)

The GitHub repository secrets `DEV_POSTGRES_MCP_AGENT_PASSWORD` and `PROD_POSTGRES_MCP_AGENT_PASSWORD`
are no longer referenced by any workflow or app spec after feature 214. They are harmless if left, but
should be deleted out-of-band (GitHub → Settings → Secrets and variables → Actions) since nothing
consumes them anymore. There is no `xstockstrat_agent` DB role to drop — it was never created (its
provisioning was gated on a password env that was never set).

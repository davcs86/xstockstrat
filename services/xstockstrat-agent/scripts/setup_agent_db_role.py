#!/usr/bin/env python3
"""
One-time provisioning script for the ``xstockstrat_agent`` PostgreSQL role.

Run this **as an admin user** (``doadmin`` on DigitalOcean managed Postgres,
or a local superuser) to create the DML-only role that the postgres-mcp
co-process uses.  The script is idempotent: re-running it against an
existing role updates its password and re-asserts all grants.

Usage inside the agent container
---------------------------------
.. code-block:: console

    # interactive (prompts for DSN and password):
    docker exec -it xstockstrat-agent python scripts/setup_agent_db_role.py

    # non-interactive:
    docker exec -it xstockstrat-agent python scripts/setup_agent_db_role.py \\
        --admin-dsn "postgres://doadmin:<pw>@host:25060/xstockstrat?sslmode=require" \\
        --role-password "<strong-random-password>"

    # dry-run (prints statements without executing):
    docker exec -it xstockstrat-agent python scripts/setup_agent_db_role.py \\
        --admin-dsn "..." --role-password "..." --dry-run

After the script completes, copy the printed ``POSTGRES_MCP_DATABASE_URI``
value into your DigitalOcean App Platform secret for ``POSTGRES_MCP_DATABASE_URI``.

Privilege scope (DML + read stats, no DDL, no TRUNCATE)
--------------------------------------------------------
* CONNECT on the database
* USAGE on each schema in SCHEMAS
* SELECT / INSERT / UPDATE / DELETE on all current and future tables
* SELECT on all current and future sequences (needed by SERIAL / IDENTITY columns)
* pg_read_all_stats role (read access to pg_stat_statements — used by db_get_top_queries
  and the index-recommendation tools)

Intentionally excluded (must never be granted)
----------------------------------------------
* CREATE, ALTER, DROP, TRUNCATE — any DDL that would let the co-process destroy schema
* SUPERUSER / CREATEDB / CREATEROLE
"""

import asyncio
import sys
import urllib.parse
from typing import Annotated

import asyncpg
import typer

# ── Constants ─────────────────────────────────────────────────────────────────

ROLE_NAME = "xstockstrat_agent"
DB_NAME = "xstockstrat"

# Schemas the role needs to analyse.  Add more here if the platform ever adds
# dedicated per-service schemas (e.g. "indicators", "trading") that currently
# live in "public".
SCHEMAS: list[str] = ["public"]

# ── Helpers ───────────────────────────────────────────────────────────────────


def _pg_escape_literal(value: str) -> str:
    """Escape *value* for safe embedding in a PostgreSQL string literal.

    Doubles every single-quote and strips NUL bytes (which Postgres rejects).
    This is the same transformation PostgreSQL applies internally when using
    ``format('%L', value)`` and is safe for DDL that cannot use bind parameters.
    """
    return value.replace("'", "''").replace("\x00", "")


def _build_mcp_uri(admin_dsn: str, role_password: str) -> str:
    """Derive the ``POSTGRES_MCP_DATABASE_URI`` from the admin DSN.

    Replaces only the user/password portion; preserves the host, port, dbname,
    and any query-string parameters (e.g. ``sslmode=require``).
    """
    parsed = urllib.parse.urlparse(admin_dsn)
    safe_pw = urllib.parse.quote(role_password, safe="")
    netloc = f"{ROLE_NAME}:{safe_pw}@{parsed.hostname}"
    if parsed.port:
        netloc += f":{parsed.port}"
    return urllib.parse.urlunparse(
        parsed._replace(scheme="postgresql", netloc=netloc, path=f"/{DB_NAME}")
    )


# ── Core async logic ──────────────────────────────────────────────────────────


async def _provision(admin_dsn: str, role_password: str, *, dry_run: bool) -> str:
    """Connect as admin, create/update the role, and verify privileges.

    Returns the ``POSTGRES_MCP_DATABASE_URI`` on success.
    Raises ``SystemExit(1)`` on any verification failure.
    """
    conn = await asyncpg.connect(admin_dsn)
    try:
        admin_user = await conn.fetchval("SELECT current_user")
        typer.echo(f"  Connected as: {admin_user}")

        safe_pw = _pg_escape_literal(role_password)

        # Build the ordered list of SQL statements to execute.
        statements: list[tuple[str, str]] = []

        # 1. Create or update the role (password is always (re-)set for idempotency).
        statements.append(
            (
                "CREATE/UPDATE role",
                f"""
            DO $$
            BEGIN
              IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '{ROLE_NAME}') THEN
                CREATE ROLE {ROLE_NAME} WITH LOGIN PASSWORD '{safe_pw}';
              ELSE
                EXECUTE format('ALTER ROLE {ROLE_NAME} WITH LOGIN PASSWORD %L', '{safe_pw}');
              END IF;
            END $$;
            """,
            )
        )

        # 2. CONNECT privilege on the target database.
        statements.append(
            (
                f"GRANT CONNECT ON DATABASE {DB_NAME}",
                f"GRANT CONNECT ON DATABASE {DB_NAME} TO {ROLE_NAME};",
            )
        )

        # 3. Per-schema grants.
        for schema in SCHEMAS:
            statements += [
                (
                    f"GRANT USAGE ON SCHEMA {schema}",
                    f"GRANT USAGE ON SCHEMA {schema} TO {ROLE_NAME};",
                ),
                (
                    f"GRANT DML ON ALL TABLES IN SCHEMA {schema}",
                    f"GRANT SELECT, INSERT, UPDATE, DELETE "
                    f"ON ALL TABLES IN SCHEMA {schema} TO {ROLE_NAME};",
                ),
                (
                    f"ALTER DEFAULT PRIVILEGES: tables in {schema}",
                    f"ALTER DEFAULT PRIVILEGES IN SCHEMA {schema} "
                    f"GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO {ROLE_NAME};",
                ),
                (
                    f"GRANT SELECT ON ALL SEQUENCES IN SCHEMA {schema}",
                    f"GRANT SELECT ON ALL SEQUENCES IN SCHEMA {schema} TO {ROLE_NAME};",
                ),
                (
                    f"ALTER DEFAULT PRIVILEGES: sequences in {schema}",
                    f"ALTER DEFAULT PRIVILEGES IN SCHEMA {schema} "
                    f"GRANT SELECT ON SEQUENCES TO {ROLE_NAME};",
                ),
            ]

        # 4. pg_read_all_stats for pg_stat_statements access (used by index tools).
        statements.append(
            (
                "GRANT pg_read_all_stats",
                f"GRANT pg_read_all_stats TO {ROLE_NAME};",
            )
        )

        if dry_run:
            typer.echo("\n[dry-run] Would execute the following statements:")
            for label, sql in statements:
                typer.echo(f"\n  -- {label}")
                for line in sql.strip().splitlines():
                    typer.echo(f"  {line}")
            return _build_mcp_uri(admin_dsn, role_password)

        # Execute.
        for label, sql in statements:
            await conn.execute(sql)
            typer.echo(f"  ✓  {label}")

    finally:
        await conn.close()

    # ── Verification ──────────────────────────────────────────────────────────
    typer.echo("\nVerifying role privileges …")
    role_uri = _build_mcp_uri(admin_dsn, role_password)
    role_conn = await asyncpg.connect(role_uri)
    try:
        current = await role_conn.fetchval("SELECT current_user")
        if current != ROLE_NAME:
            typer.echo(f"  FAIL: expected current_user={ROLE_NAME!r}, got {current!r}", err=True)
            sys.exit(1)
        typer.echo(f"  ✓  current_user = {current}")

        # DDL must be rejected (CREATE TABLE blocked).
        try:
            await role_conn.execute("CREATE TABLE _xstockstrat_agent_ddl_gate_check (id int)")
            # If we get here the grant was too broad.
            await role_conn.execute("DROP TABLE IF EXISTS _xstockstrat_agent_ddl_gate_check")
            typer.echo(
                "  FAIL: CREATE TABLE succeeded — role has DDL privileges it must NOT have!",
                err=True,
            )
            sys.exit(1)
        except asyncpg.exceptions.InsufficientPrivilegeError:
            typer.echo("  ✓  DDL (CREATE TABLE) correctly blocked")

        # Sequences readable — needed by DML on SERIAL / IDENTITY columns.
        seq_count = await role_conn.fetchval(
            "SELECT count(*) FROM information_schema.sequences "
            "WHERE sequence_schema = ANY($1::text[])",
            SCHEMAS,
        )
        typer.echo(f"  ✓  sequences visible: {seq_count}")

    finally:
        await role_conn.close()

    return role_uri


# ── CLI entrypoint ─────────────────────────────────────────────────────────────

cli = typer.Typer(
    name="setup-agent-db-role",
    help="Provision the xstockstrat_agent Postgres role (one-time, admin credentials required).",
    add_completion=False,
)


@cli.command()
def main(
    admin_dsn: Annotated[
        str | None,
        typer.Option(
            "--admin-dsn",
            help=(
                "libpq URI for the admin / doadmin connection.  "
                "Example: postgres://doadmin:<pw>@host:25060/xstockstrat?sslmode=require"
            ),
            show_default=False,
        ),
    ] = None,
    role_password: Annotated[
        str | None,
        typer.Option(
            "--role-password",
            help="Password to set for the xstockstrat_agent role.  Prompted securely if omitted.",
            show_default=False,
        ),
    ] = None,
    dry_run: Annotated[
        bool,
        typer.Option("--dry-run", help="Print statements without executing anything."),
    ] = False,
) -> None:
    """Create (or update) the **xstockstrat_agent** Postgres role.

    Grants DML-only privileges (SELECT / INSERT / UPDATE / DELETE) on all
    current and future tables in the configured schemas, plus pg_read_all_stats
    for pg_stat_statements access.  DDL and TRUNCATE are intentionally excluded.
    """
    if admin_dsn is None:
        admin_dsn = typer.prompt(
            "Admin DSN",
            default="postgres://doadmin:<pw>@host:25060/xstockstrat?sslmode=require",
        )
    if role_password is None:
        role_password = typer.prompt(
            f"Password for the {ROLE_NAME!r} role",
            hide_input=True,
            confirmation_prompt=True,
        )

    typer.echo(f"\nProvisioning role: {ROLE_NAME}")
    typer.echo(f"Database:          {DB_NAME}")
    typer.echo(f"Schemas:           {', '.join(SCHEMAS)}")
    if dry_run:
        typer.echo("Mode:              DRY RUN (no changes will be made)\n")
    else:
        typer.echo("")

    mcp_uri = asyncio.run(_provision(admin_dsn, role_password, dry_run=dry_run))

    typer.echo("\n" + "─" * 72)
    typer.echo("Role provisioning complete.  Copy the URI below into your")
    typer.echo("DigitalOcean App Platform secret POSTGRES_MCP_DATABASE_URI:\n")
    typer.echo(f"  POSTGRES_MCP_DATABASE_URI={mcp_uri}")
    typer.echo("─" * 72 + "\n")


if __name__ == "__main__":
    cli()

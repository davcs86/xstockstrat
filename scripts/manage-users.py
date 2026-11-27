#!/usr/bin/env python3
# /// script
# requires-python = ">=3.12"
# dependencies = [
#     "typer>=0.15",
#     "bcrypt>=4.2",
#     "psycopg[binary]>=3.2",
#     "questionary>=2.1",
# ]
# ///
"""Manage identity service users: reset passwords, create users, update roles, delete users.

Run with uv (preferred — auto-installs deps):
    uv run scripts/manage-users.py create-user admin@example.com
    uv run scripts/manage-users.py update-roles admin@example.com
    uv run scripts/manage-users.py reset-password admin@example.com
    uv run scripts/manage-users.py delete-user old@example.com
    uv run scripts/manage-users.py set-auth-mode both --environment staging --reason "SSO pilot"
    uv run scripts/manage-users.py unlink-sso user@example.com

Non-interactive (CI/scripts) — bypass the role selector / confirmation:
    uv run scripts/manage-users.py create-user admin@example.com --roles admin,trader
    uv run scripts/manage-users.py update-roles admin@example.com --roles trader
    uv run scripts/manage-users.py delete-user old@example.com --force
    uv run scripts/manage-users.py unlink-sso user@example.com --issuer https://auth.example.com --force

DATABASE_URL must be set, or POSTGRES_PASSWORD in .env will be used to
construct a local-dev connection string (set-auth-mode requires DATABASE_URL).
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from urllib.parse import urlsplit

import bcrypt
import psycopg
import questionary
import typer
from rich.console import Console
from rich.panel import Panel
from rich.table import Table

BCRYPT_ROUNDS = 10
VALID_ROLES = ["admin", "trader"]  # ordered for display

app = typer.Typer(
    name="manage-users",
    help="Manage xstockstrat identity service users.",
    no_args_is_help=True,
    rich_markup_mode="rich",
)
err = Console(stderr=True)
out = Console()


# ── Helpers ──────────────────────────────────────────────────────────────


def _repo_root() -> Path:
    return Path(__file__).resolve().parent.parent


def _load_db_url() -> str:
    """Resolve DATABASE_URL from env or .env file."""
    url = os.environ.get("DATABASE_URL")
    if url:
        return url

    env_file = _repo_root() / ".env"
    if env_file.is_file():
        for raw_line in env_file.read_text().splitlines():
            line = raw_line.strip()
            if line.startswith("POSTGRES_PASSWORD="):
                pw = line.split("=", 1)[1].strip().strip("'\"")
                if pw:
                    return (
                        f"postgres://xstockstrat:{pw}@localhost:5432"
                        f"/xstockstrat?sslmode=disable"
                    )

    err.print(
        Panel(
            "[red bold]DATABASE_URL is not set.[/]\n\n"
            "Either export it or ensure POSTGRES_PASSWORD is in .env.\n"
            "[dim]Example:[/]\n"
            "  export DATABASE_URL="
            "postgres://xstockstrat:<pw>@localhost:5432"
            "/xstockstrat?sslmode=disable",
            title="Configuration Error",
            border_style="red",
        )
    )
    raise typer.Exit(1)


def _hash_password(password: str) -> str:
    """Bcrypt hash at cost 10, matching the identity service."""
    return bcrypt.hashpw(
        password.encode("utf-8"),
        bcrypt.gensalt(rounds=BCRYPT_ROUNDS),
    ).decode("ascii")


def _prompt_password(email: str) -> str:
    """Prompt for password with confirmation, hidden input."""
    password: str = typer.prompt(
        f"New password for {email}",
        hide_input=True,
    )
    if not password.strip():
        err.print("[red bold]Error:[/] Password cannot be empty.")
        raise typer.Exit(1)

    confirm: str = typer.prompt("Confirm password", hide_input=True)
    if password != confirm:
        err.print("[red bold]Error:[/] Passwords do not match.")
        raise typer.Exit(1)

    return password


def _validate_roles(roles_csv: str) -> list[str]:
    """Parse and validate a comma-separated role string."""
    role_list = [r.strip() for r in roles_csv.split(",") if r.strip()]
    if not role_list:
        err.print("[red bold]Error:[/] At least one role is required.")
        raise typer.Exit(1)

    invalid = set(role_list) - set(VALID_ROLES)
    if invalid:
        err.print(
            f"[red bold]Error:[/] Invalid role(s): "
            f"[bold]{', '.join(sorted(invalid))}[/]\n"
            f"  Available: {', '.join(VALID_ROLES)}"
        )
        raise typer.Exit(1)

    return role_list


def _select_roles(preselected: list[str] | None = None) -> list[str]:
    """Interactive checkbox multi-select for roles."""
    checked = set(preselected or [])
    choices = [
        questionary.Choice(role, checked=role in checked) for role in VALID_ROLES
    ]

    selected = questionary.checkbox(
        "Select roles (↑↓ navigate, space toggle, enter confirm):",
        choices=choices,
        instruction="",
    ).ask()

    if selected is None:
        raise typer.Abort()
    if not selected:
        err.print("[red bold]Error:[/] At least one role is required.")
        raise typer.Exit(1)

    return selected


# ── Commands ─────────────────────────────────────────────────────────────


@app.command("reset-password")
def reset_password(
    email: str = typer.Argument(help="Email of the user whose password to reset"),
) -> None:
    """Reset an existing user's password."""
    db_url = _load_db_url()
    password = _prompt_password(email)

    with err.status("[bold]Hashing password…"):
        hashed = _hash_password(password)

    try:
        with psycopg.connect(db_url) as conn:
            row = conn.execute(
                "UPDATE identity.users "
                "SET password_hash = %s, updated_at = NOW() "
                "WHERE email = %s "
                "RETURNING user_id",
                (hashed, email),
            ).fetchone()

            if row is None:
                err.print(
                    f"[red bold]Error:[/] No user found with email "
                    f"[bold]'{email}'[/].\n"
                    "  Use [green]create-user[/] to add a new user."
                )
                raise typer.Exit(1)

            conn.commit()
    except psycopg.OperationalError as exc:
        err.print(
            Panel(
                f"[red bold]Database connection failed[/]\n\n{exc}",
                title="Connection Error",
                border_style="red",
            )
        )
        raise typer.Exit(1) from exc

    out.print(
        Panel(
            f"Password updated for [bold]{email}[/]",
            border_style="green",
        )
    )


@app.command("create-user")
def create_user(
    email: str = typer.Argument(help="Email for the new user"),
    roles: str = typer.Option(
        None,
        "--roles",
        "-r",
        help="Comma-separated roles (bypasses interactive selector)",
    ),
) -> None:
    """Create a new user with the given email and roles."""
    role_list = (
        _validate_roles(roles) if roles else _select_roles(preselected=["trader"])
    )
    db_url = _load_db_url()
    password = _prompt_password(email)

    with err.status("[bold]Hashing password…"):
        hashed = _hash_password(password)

    try:
        with psycopg.connect(db_url) as conn:
            row = conn.execute(
                "INSERT INTO identity.users (email, password_hash, roles) "
                "VALUES (%s, %s, %s::text[]) "
                "ON CONFLICT (email) DO NOTHING "
                "RETURNING user_id",
                (email, hashed, role_list),
            ).fetchone()

            if row is None:
                err.print(
                    f"[red bold]Error:[/] User [bold]'{email}'[/] already exists.\n"
                    "  Use [green]reset-password[/] to update their password."
                )
                raise typer.Exit(1)

            conn.commit()
    except psycopg.OperationalError as exc:
        err.print(
            Panel(
                f"[red bold]Database connection failed[/]\n\n{exc}",
                title="Connection Error",
                border_style="red",
            )
        )
        raise typer.Exit(1) from exc

    out.print(
        Panel(
            f"User created: [bold]{email}[/]  (roles: {', '.join(role_list)})",
            border_style="green",
        )
    )


@app.command("list-users")
def list_users(
    active_only: bool = typer.Option(
        False,
        "--active-only",
        "-a",
        help="Show only active users",
    ),
    json_out: bool = typer.Option(
        False,
        "--json",
        help="Print a JSON array of {user_id, email_local, is_active} to stdout",
    ),
) -> None:
    """List all identity service users."""
    db_url = _load_db_url()

    if json_out:
        query = "SELECT user_id, email, is_active FROM identity.users "
    else:
        query = "SELECT email, roles, is_active, created_at FROM identity.users "
    if active_only:
        query += "WHERE is_active = TRUE "
    query += "ORDER BY created_at"

    try:
        with psycopg.connect(db_url) as conn:
            rows = conn.execute(query).fetchall()
    except psycopg.OperationalError as exc:
        err.print(
            Panel(
                f"[red bold]Database connection failed[/]\n\n{exc}",
                title="Connection Error",
                border_style="red",
            )
        )
        raise typer.Exit(1) from exc

    if json_out:
        # PII minimisation: only the email local part, never the full email or roles.
        users = [
            {
                "user_id": str(user_id),
                "email_local": email.split("@", 1)[0],
                "is_active": bool(is_active),
            }
            for user_id, email, is_active in rows
        ]
        typer.echo(json.dumps(users))
        return

    if not rows:
        err.print("[dim]No users found.[/]")
        raise typer.Exit(0)

    table = Table(title="Identity Users", show_lines=False)
    table.add_column("Email", style="bold")
    table.add_column("Roles")
    table.add_column("Active")
    table.add_column("Created", style="dim")

    for email, roles, is_active, created_at in rows:
        roles_str = ", ".join(roles) if roles else "—"
        active_str = "[green]✓[/]" if is_active else "[red]✗[/]"
        created_str = created_at.strftime("%Y-%m-%d %H:%M") if created_at else "—"
        table.add_row(email, roles_str, active_str, created_str)

    out.print(table)


@app.command("update-roles")
def update_roles(
    email: str = typer.Argument(help="Email of the user to update"),
    roles: str = typer.Option(
        None,
        "--roles",
        "-r",
        help="Comma-separated roles (bypasses interactive selector)",
    ),
) -> None:
    """Replace a user's roles with the given set."""
    db_url = _load_db_url()

    try:
        conn = psycopg.connect(db_url)
    except psycopg.OperationalError as exc:
        err.print(
            Panel(
                f"[red bold]Database connection failed[/]\n\n{exc}",
                title="Connection Error",
                border_style="red",
            )
        )
        raise typer.Exit(1) from exc

    with conn:
        if roles:
            role_list = _validate_roles(roles)
        else:
            # Fetch current roles so the selector pre-checks them
            current = conn.execute(
                "SELECT roles FROM identity.users WHERE email = %s",
                (email,),
            ).fetchone()

            if current is None:
                err.print(
                    f"[red bold]Error:[/] No user found with email "
                    f"[bold]'{email}'[/].\n"
                    "  Use [green]list-users[/] to see existing users."
                )
                raise typer.Exit(1)

            current_roles: list[str] = current[0] or []
            err.print(
                f"Current roles for [bold]{email}[/]: "
                f"{', '.join(current_roles) or '[dim]none[/]'}"
            )
            role_list = _select_roles(preselected=current_roles)

        row = conn.execute(
            "UPDATE identity.users "
            "SET roles = %s::text[], updated_at = NOW() "
            "WHERE email = %s "
            "RETURNING roles",
            (role_list, email),
        ).fetchone()

        if row is None:
            err.print(
                f"[red bold]Error:[/] No user found with email "
                f"[bold]'{email}'[/].\n"
                "  Use [green]list-users[/] to see existing users."
            )
            raise typer.Exit(1)

        conn.commit()

    out.print(
        Panel(
            f"Roles updated for [bold]{email}[/]: {', '.join(role_list)}",
            border_style="green",
        )
    )


@app.command("delete-user")
def delete_user(
    email: str = typer.Argument(help="Email of the user to delete"),
    force: bool = typer.Option(
        False,
        "--force",
        "-f",
        help="Skip confirmation prompt (for CI/scripts)",
    ),
) -> None:
    """Permanently delete a user by email.

    Deletes the user row, their refresh tokens, and any related session data.
    This is irreversible. The last active admin cannot be deleted (mirrors the
    identity service's server-side guard).
    """
    db_url = _load_db_url()

    try:
        conn = psycopg.connect(db_url)
    except psycopg.OperationalError as exc:
        err.print(
            Panel(
                f"[red bold]Database connection failed[/]\n\n{exc}",
                title="Connection Error",
                border_style="red",
            )
        )
        raise typer.Exit(1) from exc

    with conn:
        # Look up the target user
        row = conn.execute(
            "SELECT user_id, roles, is_active FROM identity.users WHERE email = %s",
            (email,),
        ).fetchone()

        if row is None:
            err.print(
                f"[red bold]Error:[/] No user found with email "
                f"[bold]'{email}'[/].\n"
                "  Use [green]list-users[/] to see existing users."
            )
            raise typer.Exit(1)

        user_id, roles, is_active = row
        roles = roles or []

        # Last-admin guard: refuse to delete the sole active admin
        if "admin" in roles and is_active:
            other_admin = conn.execute(
                "SELECT 1 FROM identity.users "
                "WHERE user_id <> %s AND is_active = TRUE AND 'admin' = ANY(roles) "
                "LIMIT 1",
                (user_id,),
            ).fetchone()
            if other_admin is None:
                err.print(
                    f"[red bold]Error:[/] [bold]{email}[/] is the last active admin.\n"
                    "  Promote another user to admin before deleting this one."
                )
                raise typer.Exit(1)

        # Confirmation prompt (skipped with --force)
        if not force:
            roles_str = ", ".join(roles) if roles else "none"
            active_str = "active" if is_active else "inactive"
            confirmed = typer.confirm(
                f"Permanently delete {email} ({active_str}, roles: {roles_str})?"
            )
            if not confirmed:
                err.print("[dim]Aborted.[/]")
                raise typer.Exit(0)

        # Delete refresh tokens first (defense-in-depth; FK CASCADE would handle it)
        conn.execute(
            "DELETE FROM identity.refresh_tokens WHERE user_id = %s",
            (user_id,),
        )
        conn.execute(
            "DELETE FROM identity.users WHERE user_id = %s",
            (user_id,),
        )
        conn.commit()

    out.print(
        Panel(
            f"User [bold]{email}[/] has been permanently deleted.",
            border_style="green",
        )
    )


# ── SSO (feature 345) ────────────────────────────────────────────────────

AUTH_MODES = ("local", "both", "oidc")

AUTH_MODE_ROWS_SQL = (
    "SELECT environment, value_data, updated_by FROM config.config_values "
    "WHERE namespace = 'identity' AND key = 'auth.mode' AND user_id IS NULL "
    "ORDER BY environment"
)

# Always notifies (D-108): every reader re-parses even when the value is unchanged.
SET_AUTH_MODE_SQL = (
    "WITH u AS (UPDATE config.config_values SET value_data = %s, "
    "updated_by = 'operator:manage-users', update_reason = %s, caller_identity = NULL, "
    "updated_at = NOW() WHERE namespace = 'identity' AND key = 'auth.mode' "
    "AND environment = %s AND user_id IS NULL RETURNING namespace, key, environment), "
    "nt AS (SELECT pg_notify('config_changed', json_build_object('namespace', 'identity', "
    "'key', 'auth.mode', 'environment', %s, 'user_id', NULL)::text) AS sent) "
    "SELECT (SELECT count(*) FROM u), (SELECT count(*) FROM nt)"
)


def _connect(db_url: str):
    try:
        return psycopg.connect(db_url)
    except psycopg.OperationalError as exc:
        err.print(
            Panel(
                f"[red bold]Database connection failed[/]\n\n{exc}",
                title="Connection Error",
                border_style="red",
            )
        )
        raise typer.Exit(1) from exc


def _print_auth_mode_rows(conn, label: str) -> None:
    table = Table(title=f"identity/auth.mode ({label})")
    for col in ("environment", "value", "updated_by"):
        table.add_column(col)
    for environment, value, updated_by in conn.execute(AUTH_MODE_ROWS_SQL).fetchall():
        table.add_row(environment, value, updated_by or "")
    out.print(table)


@app.command("set-auth-mode")
def set_auth_mode(
    value: str = typer.Argument(help="local | both | oidc"),
    environment: str = typer.Option(
        ..., "--environment", help="production | staging (the row to change)"
    ),
    reason: str = typer.Option(..., "--reason", help="Recorded as update_reason"),
) -> None:
    """Set this database's identity/auth.mode for one environment (FR-17).

    Break-glass: [bold]set-auth-mode local[/] restores password login and the built-in
    MCP OAuth server at once. Rollback is the same command with the previous value.
    Requires DATABASE_URL (no .env fallback).
    """
    if value not in AUTH_MODES:
        err.print(
            f"[red bold]Error:[/] auth.mode must be one of: {', '.join(AUTH_MODES)}"
        )
        raise typer.Exit(2)
    if environment not in ("production", "staging"):
        err.print("[red bold]Error:[/] --environment must be production or staging")
        raise typer.Exit(2)
    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        err.print("[red bold]Error:[/] DATABASE_URL must be set for set-auth-mode")
        raise typer.Exit(1)
    target = urlsplit(db_url)
    out.print(
        f"Database: host [bold]{target.hostname}[/] database [bold]{target.path.lstrip('/')}[/]"
    )

    with _connect(db_url) as conn:
        _print_auth_mode_rows(conn, "before")
        updated, _notified = conn.execute(
            SET_AUTH_MODE_SQL, (value, reason, environment, environment)
        ).fetchone()
        conn.commit()
        if updated == 0 and value != "local":
            err.print(
                f"[red bold]Error:[/] no identity/auth.mode row for {environment}: "
                "seed migration not applied"
            )
            raise typer.Exit(1)
        _print_auth_mode_rows(conn, "after")
    out.print(f"[green]auth.mode = {value} for {environment}[/] (readers notified)")


@app.command("unlink-sso")
def unlink_sso(
    email: str = typer.Argument(help="Email of the user to unlink"),
    issuer: str | None = typer.Option(None, "--issuer", help="Only this issuer's link"),
    force: bool = typer.Option(False, "--force", "-f", help="Skip confirmation prompt"),
) -> None:
    """Remove a user's SSO link(s) so they can link again (FR-12)."""
    with _connect(_load_db_url()) as conn:
        row = conn.execute(
            "SELECT user_id FROM identity.users WHERE email = %s", (email,)
        ).fetchone()
        if row is None:
            err.print(
                f"[red bold]Error:[/] No user found with email [bold]'{email}'[/]."
            )
            raise typer.Exit(1)
        (user_id,) = row
        if not force:
            scope = f"the {issuer} link" if issuer else "every SSO link"
            if not typer.confirm(f"Remove {scope} of {email}?"):
                err.print("[dim]Aborted.[/]")
                raise typer.Exit(0)
        sql = "DELETE FROM identity.external_identities WHERE user_id = %s"
        params: tuple = (user_id,)
        if issuer:
            sql += " AND issuer = %s"
            params = (user_id, issuer)
        deleted = conn.execute(sql + " RETURNING issuer", params).fetchall()
        conn.commit()
    if not deleted:
        err.print(f"[red bold]Error:[/] no SSO link found for {email}")
        raise typer.Exit(1)
    out.print(
        f"[green]Removed {len(deleted)} SSO link(s).[/] {email} can link again with "
        "Link SSO while the deployment's auth.mode is both."
    )


if __name__ == "__main__":
    app()

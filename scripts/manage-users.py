#!/usr/bin/env python3
# /// script
# requires-python = ">=3.12"
# dependencies = [
#     "typer>=0.15",
#     "bcrypt>=4.2",
#     "psycopg[binary]>=3.2",
# ]
# ///
"""Manage identity service users: reset passwords and create new users.

Run with uv (preferred — auto-installs deps):
    uv run scripts/manage-users.py create-user admin@example.com
    uv run scripts/manage-users.py reset-password admin@example.com

Or install deps manually and run directly:
    pip install 'typer[all]>=0.15' 'bcrypt>=4.2' 'psycopg[binary]>=3.2'
    python scripts/manage-users.py create-user admin@example.com

DATABASE_URL must be set, or POSTGRES_PASSWORD in .env will be used to
construct a local-dev connection string.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import bcrypt
import psycopg
import typer
from rich.console import Console
from rich.panel import Panel
from rich.table import Table

BCRYPT_ROUNDS = 10
VALID_ROLES = {"admin", "trader"}

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

    invalid = set(role_list) - VALID_ROLES
    if invalid:
        err.print(
            f"[red bold]Error:[/] Invalid role(s): "
            f"[bold]{', '.join(sorted(invalid))}[/]\n"
            f"  Available: {', '.join(sorted(VALID_ROLES))}"
        )
        raise typer.Exit(1)

    return role_list


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
    roles: str = typer.Argument(
        default="trader",
        help="Comma-separated roles, e.g. 'admin,trader'",
    ),
) -> None:
    """Create a new user with the given email and roles."""
    role_list = _validate_roles(roles)
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
            f"User created: [bold]{email}[/]  "
            f"(roles: {', '.join(role_list)})",
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
) -> None:
    """List all identity service users."""
    db_url = _load_db_url()

    query = (
        "SELECT email, roles, is_active, created_at "
        "FROM identity.users "
    )
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


if __name__ == "__main__":
    app()

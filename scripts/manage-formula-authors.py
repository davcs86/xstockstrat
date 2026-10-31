#!/usr/bin/env python3
# /// script
# requires-python = ">=3.12"
# dependencies = [
#     "typer>=0.15",
# ]
# ///
"""Repair indicators formulas whose author is a legacy username (wraps the feature-276 CLI).

Runbook: docs/runbooks/legacy-formula-authors.md. Run with uv, in this order:
    export DATABASE_URL='postgresql://<user>:<pw>@<host>:25061/staging?sslmode=require'
    uv run scripts/manage-formula-authors.py report
    uv run scripts/manage-formula-authors.py confirm
    uv run scripts/manage-formula-authors.py apply --confirm-digest <sha256 printed by confirm>

DATABASE_URL is required (no .env fallback). The work directory holds PII and must live outside
the repo; it defaults to ~/legacy-authors.
"""

from __future__ import annotations

import hashlib
import json
import os
import subprocess
from pathlib import Path
from urllib.parse import urlsplit

import typer
from rich.console import Console
from rich.table import Table

REPO = Path(__file__).resolve().parent.parent
SERVICE = REPO / "services" / "xstockstrat-indicators"
MODULE = "app.maintenance.legacy_authors"
POOLED_PORT = 25061

app = typer.Typer(
    name="manage-formula-authors",
    help="Report and repair indicators formulas authored by a legacy username.",
    no_args_is_help=True,
)
err = Console(stderr=True)
out = Console()

WorkDirOpt = typer.Option(
    None,
    "--work-dir",
    help="Directory for users/plan/result files (default ~/legacy-authors)",
)


def _fail(msg: str) -> typer.Exit:
    err.print(f"[red bold]{msg}[/]")
    return typer.Exit(1)


def _work_dir(path: Path | None) -> Path:
    work = (path or Path.home() / "legacy-authors").expanduser().resolve()
    if work == REPO or REPO in work.parents:
        raise _fail(
            f"work dir {work} is inside the repo; these files hold PII — pick another"
        )
    work.mkdir(mode=0o700, parents=True, exist_ok=True)
    return work


def _env() -> dict[str, str]:
    env = dict(os.environ)
    env.pop(
        "VIRTUAL_ENV", None
    )  # this script's uv env must not leak into the service project
    url = env.get("DATABASE_URL")
    if not url:
        raise _fail(
            "DATABASE_URL is not set (this wrapper never falls back to a local DB)"
        )
    if urlsplit(url).port == POOLED_PORT:
        env.setdefault("DB_PGBOUNCER", "true")
    return env


def _write_private(path: Path, text: str) -> None:
    path.write_text(text)
    path.chmod(0o600)


def _run_module(args: list[str], env: dict[str, str]) -> int:
    cmd = ["uv", "run", "--project", str(SERVICE), "python", "-m", MODULE, *args]
    return subprocess.run(cmd, cwd=SERVICE, env=env, check=False).returncode


def _load_plan(path: Path) -> dict:
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError) as exc:
        raise _fail(f"cannot read plan {path}: {exc} (run `report` first)") from exc


def _show_plan(plan: dict, users: dict[str, str]) -> None:
    table = Table(title=f"Plan {plan.get('run_id', '?')}  target={plan.get('target')}")
    for col in ("Formula", "Old author", "New author", "Status"):
        table.add_column(col, overflow="fold")
    for e in plan["entries"]:
        new = e.get("new_author")
        who = f"{users.get(new, '?')} ({new})" if new else "—"
        table.add_row(e["formula_id"], e["old_author"], who, e["status"])
    out.print(table)
    out.print(f"counts: {plan.get('counts')}")


def _users_by_id(path: Path) -> dict[str, str]:
    try:
        return {u["user_id"]: u["email_local"] for u in json.loads(path.read_text())}
    except (OSError, ValueError, KeyError, TypeError):
        return {}


@app.command()
def report(work_dir: Path | None = WorkDirOpt) -> None:
    """Export users, run the read-only report, and write plan.json."""
    env, work = _env(), _work_dir(work_dir)
    users_path, plan_path = work / "users.json", work / "plan.json"

    users = subprocess.run(
        [
            "uv",
            "run",
            str(REPO / "scripts" / "manage-users.py"),
            "list-users",
            "--json",
        ],
        capture_output=True,
        text=True,
        env=env,
        check=False,
    )
    if users.returncode != 0:
        err.print(users.stderr)
        raise _fail("users export failed")
    _write_private(users_path, users.stdout)

    rc = _run_module(["--users", str(users_path), "--out", str(plan_path)], env)
    if rc != 0:
        raise typer.Exit(rc)
    plan_path.chmod(0o600)
    _show_plan(_load_plan(plan_path), _users_by_id(users_path))
    out.print(f"\nNext: review, then [bold]confirm[/] (work dir: {work})")


@app.command()
def confirm(
    yes: bool = typer.Option(False, "--yes", "-y", help="Skip the confirmation prompt"),
    work_dir: Path | None = WorkDirOpt,
) -> None:
    """Mark every `suggested` row `confirmed` and print the plan's sha256 for the change record."""
    work = _work_dir(work_dir)
    plan_path = work / "plan.json"
    plan = _load_plan(plan_path)
    suggested = [e for e in plan["entries"] if e["status"] == "suggested"]
    if not suggested:
        out.print("[dim]No suggested rows to confirm.[/]")
        raise typer.Exit(0)

    _show_plan(plan, _users_by_id(work / "users.json"))
    if not yes and not typer.confirm(f"Confirm {len(suggested)} suggested rewrite(s)?"):
        raise typer.Exit(1)
    for e in suggested:
        e["status"] = "confirmed"
    _write_private(plan_path, json.dumps(plan, indent=2) + "\n")

    digest = hashlib.sha256(plan_path.read_bytes()).hexdigest()
    out.print(
        f"\nConfirmed {len(suggested)} row(s). Record this digest in the DBA change record:"
    )
    typer.echo(f"  {digest}\n\nThen: apply --confirm-digest {digest}")


@app.command()
def apply(
    confirm_digest: str = typer.Option(
        ..., "--confirm-digest", help="sha256 printed by `confirm`"
    ),
    yes: bool = typer.Option(False, "--yes", "-y", help="Skip the confirmation prompt"),
    work_dir: Path | None = WorkDirOpt,
) -> None:
    """Apply the confirmed plan (needs the DBA-recorded digest)."""
    env, work = _env(), _work_dir(work_dir)
    plan_path, users_path = work / "plan.json", work / "users.json"
    plan = _load_plan(plan_path)
    todo = sum(1 for e in plan["entries"] if e["status"] == "confirmed")
    connected = urlsplit(env["DATABASE_URL"])
    out.print(
        f"Plan target {plan.get('target')}; connecting to host={connected.hostname} "
        f"db={connected.path.lstrip('/')}; {todo} confirmed row(s)."
    )
    if not yes and not typer.confirm("Apply to this database?"):
        raise typer.Exit(1)

    rc = _run_module(
        [
            "--apply",
            "--plan",
            str(plan_path),
            "--users",
            str(users_path),
            "--confirm-digest",
            confirm_digest,
        ],
        env,
    )
    if rc != 0:
        raise typer.Exit(rc)
    result_path = plan_path.with_suffix(".result.json")
    result_path.chmod(0o600)  # the module writes it world-readable; it holds PII
    out.print(
        f"\n[green]Applied.[/] Attach {result_path} to the change record "
        "(the only undo/audit record), then restart every indicators instance and verify as the "
        "owner (runbook §7–§8). Delete the work dir files afterwards."
    )


if __name__ == "__main__":
    app()

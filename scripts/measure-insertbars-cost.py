#!/usr/bin/env python3
# /// script
# requires-python = ">=3.12"
# dependencies = [
#     "typer>=0.15",
#     "psycopg[binary]>=3.2",
# ]
# ///
"""Measure the marketdata InsertBars cost from pg_stat_statements (read-only).

Run with uv (preferred — auto-installs deps):
    uv run scripts/measure-insertbars-cost.py
    uv run scripts/measure-insertbars-cost.py --slice-bars 1000 --grace-seconds 5

DATABASE_URL must point at the cluster that holds the marketdata schema. The
role needs pg_read_all_stats (or must own the statements) to see their text.
The session is opened read-only; the script never writes.
"""

from __future__ import annotations

import os

import psycopg
import typer
from rich.console import Console
from rich.table import Table

# InsertBars (marketdata_repo.go) runs this upsert once per bar inside one transaction;
# the ingester and BackfillBars share the statement, so the stats cover all three callers.
STATS_SQL = """
SELECT query, calls, rows, mean_exec_time, max_exec_time, stddev_exec_time, total_exec_time
FROM pg_stat_statements
WHERE query ~* '^\\s*INSERT\\s+INTO\\s+marketdata\\.ohlcv\\s*\\('
ORDER BY calls DESC
"""

app = typer.Typer(add_completion=False, help=__doc__)
out = Console()
err = Console(stderr=True)


@app.command()
def main(
    slice_bars: int = typer.Option(
        1000, help="Bars in the slice to estimate a write for."
    ),
    grace_seconds: float = typer.Option(
        5.0, help="Current barsCacheWriteGrace, for comparison only."
    ),
) -> None:
    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        err.print("[red bold]DATABASE_URL is not set.[/]")
        raise typer.Exit(1)

    with psycopg.connect(dsn) as conn:
        conn.read_only = True
        with conn.cursor() as cur:
            cur.execute(
                "SELECT 1 FROM pg_extension WHERE extname = 'pg_stat_statements'"
            )
            if cur.fetchone() is None:
                err.print(
                    "[red bold]pg_stat_statements is not installed on this database.[/]"
                )
                raise typer.Exit(1)
            cur.execute(STATS_SQL)
            rows = cur.fetchall()

    if not rows:
        err.print(
            "[yellow]No marketdata.ohlcv INSERT statement found in pg_stat_statements.[/]"
        )
        raise typer.Exit(1)

    table = Table(title="marketdata.ohlcv INSERT (per bar)")
    for col in (
        "calls",
        "rows/call",
        "mean ms",
        "max ms",
        "stddev ms",
        f"est. {slice_bars}-bar ms",
        "x grace",
    ):
        table.add_column(col, justify="right")
    for query, calls, nrows, mean_ms, max_ms, stddev_ms, _total in rows:
        est_ms = mean_ms * slice_bars
        table.add_row(
            f"{calls}",
            f"{nrows / calls:.2f}" if calls else "-",
            f"{mean_ms:.3f}",
            f"{max_ms:.3f}",
            f"{stddev_ms:.3f}",
            f"{est_ms:.1f}",
            f"{est_ms / (grace_seconds * 1000):.2f}",
        )
        out.print(f"[dim]{' '.join(query.split())[:160]}[/]")
    out.print(table)
    out.print(
        "[dim]Estimate = mean server exec time x bars; it excludes per-statement network round "
        "trips, BEGIN/COMMIT and pool wait, so treat it as a lower bound.[/]"
    )


if __name__ == "__main__":
    app()

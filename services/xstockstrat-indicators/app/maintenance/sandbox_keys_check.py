"""Read-only operator check (feature 243 Step 5): the indicators.sandbox.* config rows are healed.

Runs in the indicators image (DO console) or locally with only asyncpg + the stdlib:
    python -m app.maintenance.sandbox_keys_check
Exit 0 = PASS, 1 = FAIL (escalate to the operator). One READ ONLY transaction, SELECTs only.
Run once per app (dev = staging, prod = production) and paste the output into the feature's
context.md under `G1 staging` / the production read-back.
"""

import argparse
import asyncio
import sys
import uuid

from app.maintenance import legacy_authors as la

HEALED_BY = "system:config-migration-031"
# Global-row values migration 031 forces (value_data and default_value alike).
EXPECTED = {
    "indicators.sandbox.timeout_ms": "5000",
    "indicators.sandbox.memory_bytes": "134217728",
    "indicators.sandbox.allowed_imports": "numpy,pandas,math,statistics",
}
BARE = {key.split(".", 1)[1] for key in EXPECTED}

# Secret values are never selected; the sentinel stands in for them.
ROWS_SQL = (
    "SELECT key, environment, user_id, is_secret, "
    "CASE WHEN is_secret THEN '[redacted]' ELSE value_data END AS value_data, updated_by "
    "FROM config.config_values WHERE namespace = 'indicators' AND key LIKE '%sandbox.%' "
    "ORDER BY key, environment, user_id"
)
SNAPSHOT_EXISTS_SQL = "SELECT to_regclass('config.config_values_premigration_031') IS NOT NULL"
SNAPSHOT_SQL = (
    "SELECT key, environment, user_id, is_secret, "
    "CASE WHEN is_secret THEN '[redacted]' ELSE value_data END AS value_data, updated_by "
    "FROM config.config_values_premigration_031 ORDER BY key, environment, user_id"
)
MIGRATION_TABLES_SQL = (
    "SELECT table_schema FROM information_schema.tables WHERE table_name = 'schema_migrations'"
)


def _is_global(row: dict) -> bool:
    return row["user_id"] in (None, "")


def evaluate(rows: list[dict], snapshot: list[dict] | None, versions: list[tuple]) -> tuple:
    """Pure verdict: (problems, notes). `versions` is [(schema, version, dirty)]."""
    problems: list[str] = []
    notes: list[str] = []
    if not rows:
        problems.append("no indicators sandbox rows at all")
    for env in sorted({r["environment"] for r in rows}):
        in_env = [r for r in rows if r["environment"] == env]
        globals_ = [r for r in in_env if _is_global(r)]
        problems += [
            f"[{env}] secret row {r['key']} (unexpected)" for r in in_env if r["is_secret"]
        ]
        bare = sorted(r["key"] for r in globals_ if r["key"] in BARE)
        if bare:
            problems.append(f"[{env}] bare global rows remain {bare}: 031 not applied here")
        for key, want in EXPECTED.items():
            hit = [r for r in globals_ if r["key"] == key]
            if not hit:
                problems.append(f"[{env}] missing full-dotted global row {key}")
            elif hit[0]["updated_by"] != HEALED_BY:
                # Edited after 031: a deliberate operator value is not a heal failure.
                verb = "overridden" if hit[0]["value_data"] != want else "re-saved"
                notes.append(
                    f"[{env}] {key} {verb} after 031 by {hit[0]['updated_by']!r}: "
                    f"{hit[0]['value_data']!r} (seed {want!r}), confirm intentional"
                )
            elif hit[0]["value_data"] != want:
                problems.append(f"[{env}] {key} = {hit[0]['value_data']!r}, expected {want!r}")
        notes += [
            f"[{env}] per-user row {r['key']} user_id={r['user_id']!r} (031 only renames these)"
            for r in in_env
            if not _is_global(r)
        ]
    if snapshot is None:
        notes.append("config_values_premigration_031 absent: 031 never ran on this database")
    else:
        twins = sorted((r["key"], r["environment"]) for r in snapshot if r["key"] in EXPECTED)
        if twins:
            notes.append(f"snapshot: full-dotted twins existed before 031 (twin won): {twins}")
        notes += [
            f"snapshot: bare {r['key']} [{r['environment']}] was stored as '' (overwritten by 031)"
            for r in snapshot
            if r["key"] in BARE and r["value_data"] == ""
        ]
    for schema, version, dirty in versions:
        notes.append(f"{schema}.schema_migrations: version={version} dirty={dirty}")
        if dirty:
            problems.append(f"{schema}.schema_migrations is DIRTY")
        if snapshot is None and isinstance(version, int) and version >= 32:
            problems.append(
                f"{schema}.schema_migrations at {version} >= 032 but 031 left no snapshot: SKIPPED"
            )
    return problems, notes


async def _versions(conn) -> list[tuple]:
    out = []
    for table in await conn.fetch(MIGRATION_TABLES_SQL):
        schema = table["table_schema"]
        try:
            row = await conn.fetchrow(f'SELECT version, dirty FROM "{schema}".schema_migrations')
        except Exception as exc:  # another shape of tracking table: report it, do not fail on it
            out.append((schema, f"unreadable: {exc}", None))
            continue
        if row:
            out.append((schema, row["version"], row["dirty"]))
    return out


def _show(title: str, rows: list[dict]) -> None:
    print(f"\n== {title} ({len(rows)} rows)")
    for r in rows:
        print("  " + " | ".join(str(v) for v in r.values()))


async def check(conn, *, run_id: str) -> int:
    async with conn.transaction(readonly=True):
        rows = [dict(r) for r in await conn.fetch(ROWS_SQL)]
        has_snapshot = await conn.fetchval(SNAPSHOT_EXISTS_SQL)
        snapshot = [dict(r) for r in await conn.fetch(SNAPSHOT_SQL)] if has_snapshot else None
        versions = await _versions(conn)
    _show("config.config_values (indicators sandbox)", rows)
    if snapshot is not None:
        _show("config.config_values_premigration_031 (pre-heal state)", snapshot)
    problems, notes = evaluate(rows, snapshot, versions)
    for note in notes:
        la.log(run_id, f"note: {note}")
    for problem in problems:
        la.log(run_id, f"FAIL: {problem}")
    if not problems:
        la.log(
            run_id,
            "PASS: 3 full-dotted global rows at seed values per environment, no bare/secret rows",
        )
    return 1 if problems else 0


def main(argv=None) -> int:
    argparse.ArgumentParser(
        prog="python -m app.maintenance.sandbox_keys_check", description=__doc__
    ).parse_args(argv)
    run_id = str(uuid.uuid4())

    async def run() -> int:
        conn, _target = await la.connect(run_id=run_id)
        try:
            return await check(conn, run_id=run_id)
        finally:
            await conn.close()

    return asyncio.run(run())


if __name__ == "__main__":
    sys.exit(main())

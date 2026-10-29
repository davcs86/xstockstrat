"""Operator CLI: report (and later repair) indicators formulas whose author is a legacy username.

Run: uv run python -m app.maintenance.legacy_authors --users users.json --out plan.json
"""

import argparse
import asyncio
import hashlib
import json
import os
import re
import sys
import uuid
from pathlib import Path
from urllib.parse import urlsplit

import asyncpg

from app.formulas import SYSTEM_AUTHOR

# Used both as a Python regex (re.IGNORECASE) and as the Postgres `~*`/`!~*` pattern.
UUID_RE = r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
_UUID = re.compile(UUID_RE, re.IGNORECASE)

# No deleted_at filter: get_by_id serves soft-deleted rows too.
DETECT_SQL = (
    "SELECT formula_id, author, deleted_at, updated_at FROM indicators.formulas "
    "WHERE author <> $1 AND author !~* $2 ORDER BY formula_id"
)
CLEAN_COUNT_SQL = "SELECT count(*) FROM indicators.formulas WHERE author = $1 OR author ~* $2"
# The system/UUID guard must stay in the SQL itself; never set updated_at or is_public here.
REWRITE_SQL = (
    "UPDATE indicators.formulas SET author = $1 "
    "WHERE formula_id = $2::uuid AND author = $3 AND author <> $4 AND author !~* $5 "
    "RETURNING formula_id"
)


def is_uuid(value: object) -> bool:
    return isinstance(value, str) and _UUID.fullmatch(value) is not None


def log(run_id: str, msg: str) -> None:
    print(f"[run_id={run_id}] {msg}", flush=True)


async def connect(env=os.environ, run_id: str = "-"):
    url = env.get("DATABASE_URL")
    if not url:
        raise SystemExit("DATABASE_URL is required (no .env or localhost fallback)")
    parts = urlsplit(url)
    target = (parts.hostname or "", parts.path.lstrip("/"))
    log(run_id, f"target host={target[0]} db={target[1]}")
    conn = await asyncpg.connect(
        url,
        statement_cache_size=0 if env.get("DB_PGBOUNCER") in ("true", "1") else 100,
    )
    return conn, target


def load_users(path) -> dict:
    try:
        data = json.loads(Path(path).read_text())
    except (OSError, ValueError) as exc:
        raise SystemExit(f"cannot read users file {path}: {exc}") from exc
    if not isinstance(data, list):
        raise SystemExit(f"users file {path} must be a JSON array")
    users = {}
    for entry in data:
        if (
            not isinstance(entry, dict)
            or not is_uuid(entry.get("user_id"))
            or not isinstance(entry.get("email_local"), str)
            or not isinstance(entry.get("is_active"), bool)
        ):
            raise SystemExit(f"malformed users file entry: {entry!r}")
        users[entry["user_id"]] = {
            "email_local": entry["email_local"],
            "is_active": entry["is_active"],
        }
    return users


async def detect(conn) -> list[dict]:
    rows = await conn.fetch(DETECT_SQL, SYSTEM_AUTHOR, UUID_RE)
    return [
        {
            "formula_id": str(r["formula_id"]),
            "author": r["author"],
            "deleted": r["deleted_at"] is not None,
            "updated_at": r["updated_at"].isoformat() if r["updated_at"] is not None else None,
        }
        for r in rows
    ]


def classify(rows, users, *, clean: int = 0, run_id=None, target=None) -> dict:
    matches: dict[str, list[str]] = {}
    for author in {r["author"] for r in rows}:
        matches[author] = [
            uid
            for uid, u in users.items()
            if u["is_active"] and u["email_local"].lower() == author.lower()
        ]
    counts = {"rewritable": 0, "unmappable": 0, "ambiguous": 0, "clean": clean}
    entries = []
    for r in rows:
        candidates = matches[r["author"]]
        if len(candidates) == 1:
            status, new_author, counts_key = "suggested", candidates[0], "rewritable"
        elif not candidates:
            status, new_author, counts_key = "unmappable", None, "unmappable"
        else:
            status, new_author, counts_key = "ambiguous", None, "ambiguous"
        counts[counts_key] += 1
        entries.append(
            {
                "formula_id": r["formula_id"],
                "old_author": r["author"],
                "new_author": new_author,
                "status": status,
                "source": "heuristic",
            }
        )
    return {
        "run_id": run_id or str(uuid.uuid4()),
        "target": {"host": target[0], "db": target[1]} if target else {"host": "", "db": ""},
        "counts": counts,
        "entries": entries,
    }


def plan_digest(path) -> str:
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


async def run_report(conn, users, out_path, *, run_id=None, target=None) -> dict:
    run_id = run_id or str(uuid.uuid4())
    rows = await detect(conn)
    clean = await conn.fetchval(CLEAN_COUNT_SQL, SYSTEM_AUTHOR, UUID_RE)
    plan = classify(rows, users, clean=clean, run_id=run_id, target=target)
    Path(out_path).write_text(json.dumps(plan, indent=2) + "\n")
    for e in plan["entries"]:
        if e["status"] != "suggested":
            log(run_id, f"{e['status']}: formula_id={e['formula_id']} author={e['old_author']}")
    log(run_id, f"counts {json.dumps(plan['counts'])}")
    log(run_id, f"plan {out_path} sha256={plan_digest(out_path)}")
    return plan


async def _report(args, run_id: str) -> int:
    users = load_users(args.users)
    conn, target = await connect(run_id=run_id)
    try:
        await run_report(conn, users, args.out, run_id=run_id, target=target)
    finally:
        await conn.close()
    return 0


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m app.maintenance.legacy_authors",
        description="Report (default) or apply repairs of legacy-username formula authors.",
    )
    parser.add_argument("--users", required=True, help="users JSON from list-users --json")
    parser.add_argument("--out", help="report mode: path to write the plan JSON")
    parser.add_argument("--apply", action="store_true", help="apply a confirmed plan")
    parser.add_argument("--plan", help="apply mode: path to the confirmed plan JSON")
    parser.add_argument("--confirm-digest", help="apply mode: sha256 of the plan file")
    args = parser.parse_args(argv)
    if args.apply:
        parser.error("--apply is not available in this build")
    if not args.out:
        parser.error("report mode requires --out")
    run_id = str(uuid.uuid4())
    log(run_id, "mode=report")
    return asyncio.run(_report(args, run_id))


if __name__ == "__main__":
    sys.exit(main())

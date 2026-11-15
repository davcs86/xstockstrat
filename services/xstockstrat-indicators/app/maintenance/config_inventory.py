"""Read-only operator inventory of config.config_values (feature 295 Step 2, G1).

Runs in the indicators image (DO console) or locally with only asyncpg + the stdlib:
    python -m app.maintenance.config_inventory [--reveal <request.json>] [--report]
One READ ONLY transaction, SELECTs only. Emits one JSON line per row (values as sha256 only), then
`output_sha256=` and `tool_sha256=` trailer lines. Exit 0 = ok, 1 = a reveal entry has no global
row, 2 = a reveal entry is refused (per-user, secret or secret-class) and no value is printed.
"""

import argparse
import asyncio
import hashlib
import json
import sys

from app.maintenance import legacy_authors as la

# Explicit column list: the ciphertext column is never selected, and a secret row's value_data
# is replaced in SQL so its sentinel (or a legacy plaintext) never reaches Python.
ROWS_SQL = (
    "SELECT namespace, key, environment, user_id, value_type, is_secret, "
    "CASE WHEN is_secret THEN NULL ELSE value_data END AS value_data, "
    "CASE WHEN is_secret THEN NULL ELSE default_value END AS default_value, "
    "description, consuming_service, updated_at "
    "FROM config.config_values ORDER BY namespace, key, environment, user_id"
)
REPORT_TABLE = "config.config_heal_report_041"
REPORT_EXISTS_SQL = f"SELECT to_regclass('{REPORT_TABLE}') IS NOT NULL"
REPORT_SQL = (
    "SELECT run_at, action, namespace, key, environment, user_id, stored_value, "
    f"effective_value, reason FROM {REPORT_TABLE} ORDER BY run_at, namespace, key, environment"
)

# Copied from services/xstockstrat-config/src/grpc/authz.ts SECRET_CALLER_ALLOWLIST (relative
# keys); keep in sync with it.
SECRET_KEYS = {
    ("marketdata", "alpaca.api_key"),
    ("marketdata", "alpaca.api_secret"),
    ("marketdata", "fmp.api_key"),
    ("marketdata", "finnhub.api_key"),
    ("notify", "commsgun.app_key"),
}
SECRET_KEY_PREFIXES = {("ingest", "mcp_credential.")}

# Write bounds from the feature's Config Key Contract, keyed by the namespace-relative spelling.
BOUNDS = {
    ("indicators", "sandbox.startup_grace_ms"): (1000, 10000),
    ("indicators", "sandbox.timeout_ms"): (100, 33000),
    ("analysis", "compute.max_worker_threads"): (1, 16),
}


def _sha(text) -> str | None:
    return None if text is None else hashlib.sha256(str(text).encode()).hexdigest()


def _relative(ns: str, key: str) -> str:
    return key[len(ns) + 1 :] if key.startswith(ns + ".") else key


def _partner(ns: str, key: str) -> str:
    return key[len(ns) + 1 :] if key.startswith(ns + ".") else f"{ns}.{key}"


def _user(row: dict) -> str:
    return row.get("user_id") or ""


def _scope(row: dict) -> tuple:
    return (row["namespace"], row["environment"], _user(row))


def _catalog_secret(ns: str, key: str) -> bool:
    rel = _relative(ns, key)
    if (ns, rel) in SECRET_KEYS:
        return True
    return any(ns == pns and rel.startswith(prefix) for pns, prefix in SECRET_KEY_PREFIXES)


def classify(rows: list[dict]) -> dict:
    """(scope, key) -> secret_class: the row, its k <-> ns.k partner, or the catalog is secret."""
    secret = {(_scope(r), r["key"]) for r in rows if r["is_secret"]}
    out = {}
    for r in rows:
        scope, key = _scope(r), r["key"]
        out[(scope, key)] = (
            bool(r["is_secret"])
            or (scope, _partner(r["namespace"], key)) in secret
            or _catalog_secret(r["namespace"], key)
        )
    return out


def _stamp(value) -> str | None:
    if value is None:
        return None
    return value.isoformat() if hasattr(value, "isoformat") else str(value)


def inventory_record(row: dict, secret_class: bool) -> dict:
    hidden = secret_class or row["is_secret"]
    user = _user(row)
    return {
        "namespace": row["namespace"],
        "key": row["key"],
        "environment": row["environment"],
        "user_sha256": _sha(user) if user else None,
        "value_type": row["value_type"],
        "is_secret": bool(row["is_secret"]),
        "secret_class": secret_class,
        "has_description": bool(row.get("description")),
        "has_consuming_service": bool(row.get("consuming_service")),
        "value_sha256": None if hidden else _sha(row.get("value_data")),
        "default_sha256": None if hidden else _sha(row.get("default_value")),
        "updated_at": _stamp(row.get("updated_at")),
    }


def _text(value) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


def _in_bounds(value: str, lo: int, hi: int) -> bool:
    try:
        return lo <= int(value) <= hi
    except (TypeError, ValueError):
        return False


def reveal(rows: list[dict], classes: dict, request: list) -> tuple[int, list[dict]]:
    """Refusing any entry reveals nothing for the whole request (exit 2)."""
    refused, missing, revealed = [], [], []
    for entry in request:
        ns, key, env = entry.get("namespace"), entry.get("key"), entry.get("environment")
        head = {"namespace": ns, "key": key, "environment": env}
        user = entry.get("user_id") or ""
        if not (ns and key and env):
            refused.append({**head, "refused": "entry needs namespace, key and environment"})
            continue
        if user:
            refused.append({**head, "user_sha256": _sha(user), "refused": "per-user row"})
            continue
        scope = (ns, env, "")
        hit = [r for r in rows if _scope(r) == scope and r["key"] == key]
        if not hit:
            missing.append({**head, "found": False})
            continue
        if classes[(scope, key)]:
            refused.append({**head, "refused": "secret or secret-class row"})
            continue
        value = hit[0]["value_data"]
        out = {**head, "value": value}
        bound = BOUNDS.get((ns, _relative(ns, key)))
        if bound:
            out["in_bounds"] = _in_bounds(value, *bound)
        if "default" in entry:
            out["equals_code_default"] = value == _text(entry["default"])
        revealed.append(out)
    if refused:
        return 2, refused
    return (1 if missing else 0), revealed + missing


def report_record(row: dict) -> dict:
    out = {k: _stamp(v) if k == "run_at" else v for k, v in row.items() if k != "user_id"}
    user = _user(row)
    out["user_sha256"] = _sha(user) if user else None
    if user:
        out["stored_value"] = out["effective_value"] = None
    return out


def emit(records: list[dict]) -> None:
    lines = [json.dumps(r) for r in records]
    body = "".join(line + "\n" for line in lines)
    with open(__file__, "rb") as src:
        tool = hashlib.sha256(src.read()).hexdigest()
    sys.stdout.write(body)
    sys.stdout.write(f"output_sha256={hashlib.sha256(body.encode()).hexdigest()}\n")
    sys.stdout.write(f"tool_sha256={tool}\n")
    sys.stdout.flush()


async def run(conn, *, request: list | None, report: bool) -> int:
    async with conn.transaction(readonly=True):
        if report:
            present = await conn.fetchval(REPORT_EXISTS_SQL)
            report_rows = [dict(r) for r in await conn.fetch(REPORT_SQL)] if present else None
        else:
            rows = [dict(r) for r in await conn.fetch(ROWS_SQL)]
    if report:
        if report_rows is None:
            emit([{"report": REPORT_TABLE, "present": False}])
        else:
            emit([report_record(r) for r in report_rows])
        return 0
    classes = classify(rows)
    if request is not None:
        code, records = reveal(rows, classes, request)
        emit(records)
        return code
    emit([inventory_record(r, classes[(_scope(r), r["key"])]) for r in rows])
    return 0


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m app.maintenance.config_inventory", description=__doc__
    )
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--reveal", metavar="REQUEST_JSON", help="JSON list of entries")
    mode.add_argument("--report", action="store_true", help=f"dump {REPORT_TABLE}")
    args = parser.parse_args(argv)
    request = None
    if args.reveal:
        with open(args.reveal) as fh:
            request = json.load(fh)
        if not isinstance(request, list) or not all(isinstance(e, dict) for e in request):
            print("reveal request must be a JSON list of objects", file=sys.stderr)
            return 2

    async def _main() -> int:
        conn, _target = await la.connect()
        try:
            return await run(conn, request=request, report=args.report)
        finally:
            await conn.close()

    return asyncio.run(_main())


if __name__ == "__main__":
    sys.exit(main())

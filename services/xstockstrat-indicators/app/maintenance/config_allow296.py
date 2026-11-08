"""Operator sign-off of migration R's embedded allowlist (feature 296 Step 16).

Runs in the indicators image (DO console) or locally with only asyncpg + the stdlib:
    python -m app.maintenance.config_allow296 draft --migration R.sql --expect-sha256 <hex> \
        --expect-db staging --expect-tuples N
    python -m app.maintenance.config_allow296 rehearse --migration R.sql --expect-sha256 <hex> \
        --expect-db staging --expect-block-sha256 <hex>
Both modes replay R inside one transaction that is always rolled back; nothing is committed.
`draft` runs the shipped (empty allow block) R, takes the `uncovered-twin` lines it raises as the
twin list, and signs the PREFIXED member of each twin as the loser (the relative spelling wins).
Output holds keys and sha256 only: no value, no user id. Exit 0 = ok, 1 = unexpected database
error, 2 = refused before or after the replay (wrong file, database, count or violation class),
3 = `rehearse` saw R raise.
"""

import argparse
import asyncio
import hashlib
import os
import re
import sys
from urllib.parse import urlsplit

import asyncpg

from app.maintenance import legacy_authors as la

BEGIN, END = "-- allow_296:begin", "-- allow_296:end"
MARKER = "relative_keys_v1"
SIGNABLE = "uncovered-twin"
COUNTS_SQL = (
    "SELECT action, count(*) AS n FROM config.config_keys_report_296 "
    "GROUP BY action ORDER BY action"
)
MARKER_SQL = "SELECT count(*) FROM config.config_markers WHERE name = $1"
LEFTOVER_SQL = "SELECT to_regclass('config.config_keys_report_296') IS NOT NULL"
# Hashes are computed in SQL exactly as R compares them: sha256 over the UTF-8 text.
TWIN_SQL = (
    "SELECT p.user_id IS NOT NULL AS per_user, "
    "encode(sha256(convert_to(p.user_id, 'UTF8')), 'hex') AS user_sha256, "
    "encode(sha256(convert_to(p.value_data, 'UTF8')), 'hex') AS value_sha256 "
    "FROM config.config_values p JOIN config.config_values r "
    "ON r.namespace = p.namespace AND r.environment = p.environment "
    "AND COALESCE(r.user_id, '') = COALESCE(p.user_id, '') AND r.key = $3 "
    "WHERE p.namespace = $1 AND p.environment = $2 AND p.key = $1 || '.' || $3 "
    "AND NOT p.is_secret AND NOT r.is_secret AND (p.user_id IS NOT NULL) = $4"
)


class Refused(Exception):
    exit_code = 2


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()


def tool_sha256() -> str:
    with open(__file__, "rb") as src:
        return hashlib.sha256(src.read()).hexdigest()


def load_migration(path: str, expect_sha256: str) -> str:
    with open(path, "rb") as fh:
        raw = fh.read()
    actual = hashlib.sha256(raw).hexdigest()
    if actual != expect_sha256.lower():
        raise Refused(f"{path} sha256 {actual} != --expect-sha256 (copy-paste changed the file)")
    return raw.decode()


def allow_block(sql: str) -> str:
    """The lines strictly between the markers, newline-terminated."""
    lines = sql.splitlines()
    begins = [i for i, line in enumerate(lines) if line.strip() == BEGIN]
    ends = [i for i, line in enumerate(lines) if line.strip() == END]
    if len(begins) != 1 or len(ends) != 1 or begins[0] >= ends[0]:
        raise Refused(f"the file needs exactly one {BEGIN} line followed by one {END} line")
    return "".join(f"{line}\n" for line in lines[begins[0] + 1 : ends[0]])


def violations(message: str) -> list[tuple[str, str, str, str, bool]]:
    """R's lines `<class> <ns>/<rel>/<env>[ (per-user)]` -> (class, ns, rel, env, per_user)."""
    out = []
    for line in message.splitlines()[1:]:
        per_user = line.endswith(" (per-user)")
        body = line.removesuffix(" (per-user)")
        cls, _, scope = body.partition(" ")
        ns, _, rest = scope.partition("/")
        rel, _, env = rest.rpartition("/")
        if not (cls and ns and rel and env):
            raise Refused(f"cannot parse R's violation line {line!r}")
        out.append((cls, ns, rel, env, per_user))
    return out


def _message(exc: Exception) -> str:
    return getattr(exc, "message", None) or str(exc)


async def replay(conn, sql: str) -> tuple[str, object]:
    """Run R in one transaction and roll it back: ("ok", counts) or ("raise", message)."""
    tx = conn.transaction()
    await tx.start()
    try:
        await conn.execute(sql)
        counts = [(r["action"], r["n"]) for r in await conn.fetch(COUNTS_SQL)]
        return "ok", counts
    except asyncpg.exceptions.RaiseError as exc:
        return "raise", _message(exc)
    finally:
        await tx.rollback()


async def preflight(conn, target, port, *, expect_db: str) -> str:
    if target[1] != expect_db:
        raise Refused(f"connected to db {target[1]!r}, --expect-db is {expect_db!r}")
    if await conn.fetchval(MARKER_SQL, MARKER):
        raise Refused(f"marker {MARKER} is already set: R has run here, a replay proves nothing")
    who = await conn.fetchval("SELECT current_user")
    print(f"connection host={target[0]} port={port} db={target[1]} role={who}")
    if port == 25061:
        print("note: pooled :25061; the PRE_DEPLOY db-migrator uses the direct :25060 URL")
    return who


async def postflight(conn) -> None:
    """The replay must have left nothing behind (DDL included)."""
    if await conn.fetchval(MARKER_SQL, MARKER) or await conn.fetchval(LEFTOVER_SQL):
        raise Refused("the replay left state behind: stop and inspect, do not run R")
    print("rolled back: marker absent, config_keys_report_296 absent")


def render_block(tuples: list[tuple]) -> str:
    def lit(v):
        return "NULL" if v is None else "'" + v.replace("'", "''") + "'"

    rows = [f"  ({', '.join(lit(v) for v in t)})" for t in sorted(tuples, key=str)]
    return "VALUES\n" + ",\n".join(rows) + "\n" if rows else ""


async def collect_tuples(conn, found: list) -> list[tuple]:
    tuples = []
    async with conn.transaction(readonly=True):
        for _cls, ns, rel, env, per_user in found:
            rows = await conn.fetch(TWIN_SQL, ns, env, rel, per_user)
            if not rows:
                raise Refused(f"R reports a twin {ns}/{rel}/{env} the tool cannot find")
            for row in rows:
                if row["value_sha256"] is None:
                    raise Refused(f"{ns}/{rel}/{env} has no value to sign")
                user = row["user_sha256"] if row["per_user"] else None
                tuples.append((ns, f"{ns}.{rel}", env, user, row["value_sha256"]))
    return sorted(set(tuples), key=str)


async def draft(conn, sql: str, *, expect_tuples: int) -> int:
    kind, payload = await replay(conn, sql)
    found = violations(payload) if kind == "raise" else []
    other = [v for v in found if v[0] != SIGNABLE]
    if other:
        for cls, ns, rel, env, per_user in other:
            print(f"cannot sign: {cls} {ns}/{rel}/{env}{' (per-user)' if per_user else ''}")
        raise Refused("repair the data (config-rollout.md recovery table); only twins are signed")
    tuples = await collect_tuples(conn, found)
    if len(tuples) != expect_tuples:
        raise Refused(f"found {len(tuples)} twin tuple(s), --expect-tuples is {expect_tuples}")
    await postflight(conn)
    block = render_block(tuples)
    print(f"{BEGIN}\n{block or '-- no twins: keep the shipped empty block\n'}{END}")
    print(f"tuples={len(tuples)}")
    print(f"block_sha256={sha256_text(block)}")
    print(f"tool_sha256={tool_sha256()}")
    return 0


async def rehearse(conn, sql: str, *, expect_block_sha256: str) -> int:
    block = allow_block(sql)
    if sha256_text(block) != expect_block_sha256.lower():
        raise Refused(f"the block in this file has sha256 {sha256_text(block)}, not the signed one")
    kind, payload = await replay(conn, sql)
    if kind == "raise":
        print(f"R raised (nothing changed):\n{payload}")
        await postflight(conn)
        return 3
    await postflight(conn)
    for action, n in payload:
        print(f"report {action}={n}")
    print(f"block_sha256={sha256_text(block)}")
    print(f"tool_sha256={tool_sha256()}")
    return 0


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="python -m app.maintenance.config_allow296")
    parser.add_argument("mode", choices=("draft", "rehearse"))
    parser.add_argument("--migration", required=True, help="path to R, pasted into this console")
    parser.add_argument("--expect-sha256", required=True, help="sha256 of R as on the workstation")
    parser.add_argument("--expect-db", required=True, help="database name the console must hit")
    parser.add_argument("--expect-tuples", type=int, help="draft: number of twins to sign")
    parser.add_argument("--expect-block-sha256", help="rehearse: sha256 printed by draft")
    return parser


async def _main(args) -> int:
    sql = load_migration(args.migration, args.expect_sha256)
    if re.search(r"(?im)^\s*(COMMIT|END)\s*;", sql):
        raise Refused("the file holds a COMMIT: never replay it")
    if args.mode == "draft" and args.expect_tuples is None:
        raise Refused("draft requires --expect-tuples")
    if args.mode == "rehearse" and not args.expect_block_sha256:
        raise Refused("rehearse requires --expect-block-sha256")
    conn, target = await la.connect()
    try:
        await preflight(
            conn,
            target,
            urlsplit(os.environ.get("DATABASE_URL", "")).port,
            expect_db=args.expect_db,
        )
        if args.mode == "draft":
            return await draft(conn, sql, expect_tuples=args.expect_tuples)
        return await rehearse(conn, sql, expect_block_sha256=args.expect_block_sha256)
    finally:
        await conn.close()


def main(argv=None) -> int:
    args = _parser().parse_args(argv)
    try:
        return asyncio.run(_main(args))
    except Refused as exc:
        print(f"refused: {exc}", file=sys.stderr)
        return Refused.exit_code
    except asyncpg.PostgresError as exc:
        print(f"database error {type(exc).__name__}: {_message(exc)}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())

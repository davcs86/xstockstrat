#!/usr/bin/env python3
"""Dry-run config migration 041 on a scratch database and write the heal report.

Usage: config-heal-dryrun.py --fresh | --staging <inventory.jsonl> [--reveal <reveal.jsonl>]
Needs DATABASE_URL (creates and drops a scratch DB), psql, migrate. Prints no URL and no value.
Exit 2 = usage, 1 = a content decision touched a sentinel or synthesized row (staging only).
"""

import glob
import os
import re
import sys

# Imported via a sys.path insert, so never run this entry point with python3 -I.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import scratch_db
from scratch_db import REPO_ROOT

HEAL_DIR = os.path.join(REPO_ROOT, "scripts", "config-heal")
USAGE = "usage: config-heal-dryrun.py --fresh | --staging <inventory.jsonl> [--reveal <reveal.jsonl>]"
FIXTURE_LINE = re.compile(rb"-- fixture[ \t\r\v\f]*$")
HEADER = b"action\tnamespace\tkey\tenvironment\tuser_sha256\treason\n"
LINES = "WITH (FORMAT csv, DELIMITER E'\\x02', QUOTE E'\\x01')"
CATALOG = "WITH (FORMAT csv, HEADER true, DELIMITER E'\\t', QUOTE E'\\x01')"

# Same explicit column list as ROWS_SQL in services/xstockstrat-indicators/app/maintenance/config_inventory.py.
INVENTORY_SQL = """SELECT namespace, key, environment, user_id, value_type, is_secret,
            CASE WHEN is_secret THEN NULL ELSE value_data END AS value_data,
            CASE WHEN is_secret THEN NULL ELSE default_value END AS default_value,
            description, consuming_service, updated_at
     FROM config.config_values ORDER BY namespace, key, environment, user_id"""

STAGING_SETUP_SQL = """DELETE FROM config.config_values;
          CREATE TABLE heal_dry.raw_inv (line text);
          CREATE TABLE heal_dry.raw_rev (line text);
          CREATE TABLE heal_dry.catalog (namespace text, key text, match text, value_type text,
            code_default text, description text, consuming_service text, is_secret boolean, reader text,
            readers_disagree boolean);"""

LOAD_SQL = r"""CREATE TABLE heal_dry.loaded AS
WITH inv AS (
  SELECT j->>'namespace' AS ns, j->>'key' AS k, j->>'environment' AS env, j->>'user_sha256' AS usr,
         j->>'value_type' AS vt, (j->>'is_secret')::boolean AS sec, j->>'value_sha256' AS vh
  FROM (SELECT line::jsonb AS j FROM heal_dry.raw_inv WHERE line LIKE '{%') s
), rev AS (
  SELECT j->>'namespace' AS ns, j->>'key' AS k, j->>'environment' AS env, j->>'value' AS val
  FROM (SELECT line::jsonb AS j FROM heal_dry.raw_rev WHERE line LIKE '{%') s
  WHERE j ? 'value' AND j->>'user_sha256' IS NULL
), bounds(ns, rel, lo, hi) AS (
  VALUES ('indicators', 'sandbox.startup_grace_ms', 1000, 10000),
         ('indicators', 'sandbox.timeout_ms', 100, 33000),
         ('analysis', 'compute.max_worker_threads', 1, 16)
), v AS (
  -- A string key with no code default reads as '', exactly as 041 COALESCEs it.
  SELECT i.*, r.val,
         CASE WHEN c.code_default IS NULL AND c.value_type = 'string' THEN '' ELSE c.code_default END
           AS code_default,
         c.description, c.consuming_service, b.lo,
         CASE WHEN b.lo::text = c.code_default THEN b.lo + 1 ELSE b.lo END AS synth
  FROM inv i
  LEFT JOIN rev r ON r.ns = i.ns AND r.k = i.k AND r.env = i.env AND i.usr IS NULL
  LEFT JOIN heal_dry.catalog c ON c.namespace = i.ns AND c.key = i.k AND c.match = 'exact'
  LEFT JOIN bounds b ON b.ns = i.ns AND i.k IN (b.rel, b.ns || '.' || b.rel)
)
SELECT ns, k, env, usr, vt, sec, description, consuming_service,
       CASE WHEN sec THEN NULL ELSE code_default END AS default_value,
       CASE WHEN val IS NOT NULL THEN 'revealed'
            WHEN code_default IS NOT NULL
             AND vh = encode(sha256(convert_to(code_default, 'UTF8')), 'hex') THEN 'default'
            WHEN vh IS NULL THEN 'sentinel'
            WHEN lo IS NOT NULL THEN 'synthesized'
            ELSE 'sentinel' END AS origin,
       CASE WHEN val IS NOT NULL THEN val
            WHEN code_default IS NOT NULL
             AND vh = encode(sha256(convert_to(code_default, 'UTF8')), 'hex') THEN code_default
            WHEN vh IS NULL THEN '__secret_class__'
            WHEN lo IS NOT NULL THEN synth::text
            ELSE '__sha256:' || vh END AS val
FROM v;

INSERT INTO config.config_values
  (namespace, key, value_type, value_data, is_secret, description, default_value, consuming_service,
   environment, user_id, updated_by)
SELECT ns, k, vt, val, sec, description, default_value, consuming_service, env, usr, 'config-heal-dryrun'
FROM heal_dry.loaded;
"""

# Values never leave the DB: stored/effective columns are dropped and the default-synced reason is reworded.
REPORT_SQL = r"""SELECT action, COALESCE(namespace, ''), COALESCE(key, ''), COALESCE(environment, ''),
       CASE WHEN user_id IS NULL THEN ''
            WHEN :'hashed' = 'yes' THEN user_id
            ELSE encode(sha256(convert_to(user_id, 'UTF8')), 'hex') END,
       CASE WHEN action = 'default-synced'
            THEN 'default_value synced to the reader code default; value_data unchanged'
            ELSE COALESCE(reason, '') END
FROM config.config_heal_report_041
WHERE action <> 'latch';
"""

BAD_SQL = r"""SELECT r.action, r.namespace, r.key, r.environment, l.origin
FROM config.config_heal_report_041 r
JOIN heal_dry.loaded l
  ON l.ns = r.namespace AND l.k = r.key AND l.env = r.environment
 AND COALESCE(l.usr, '') = COALESCE(r.user_id, '')
WHERE r.action IN ('twin-deleted', 'retyped', 'default-synced')
  AND l.origin IN ('sentinel', 'synthesized')
ORDER BY 1, 2, 3, 4;
"""


class Usage(Exception):
    pass


def parse_args(argv):
    """(mode, inventory, reveal); raises Usage on anything else."""
    mode = inventory = reveal = None
    args = list(argv)
    while args:
        arg = args.pop(0)
        if arg == "--fresh":
            mode = "fresh"
        elif arg in ("--staging", "--reveal") and args:
            if arg == "--staging":
                mode, inventory = "staging", args.pop(0)
            else:
                reveal = args.pop(0)
        else:
            raise Usage
    if mode is None or (mode == "fresh" and reveal):
        raise Usage
    return mode, inventory, reveal


def strip_fixture_tuples(migrations):
    """Test-only allowlist tuples (Step 32) must never sign a dry-run deletion."""
    for path in glob.glob(os.path.join(migrations, "041_*.up.sql")):
        with open(path, "rb") as f:
            kept = [
                line for line in f.read().split(b"\n") if not FIXTURE_LINE.search(line)
            ]
        with open(path, "wb") as f:
            f.write(b"\n".join(kept))


def report(rows):
    """The report file: header, then the rows in byte order."""
    lines = rows.split(b"\n")
    if lines and lines[-1] == b"":
        lines.pop()
    return HEADER + b"".join(line + b"\n" for line in sorted(lines)), len(lines)


def load_staging(db, inventory, reveal):
    db.psql("-c", STAGING_SETUP_SQL)
    for table, path in (("raw_inv", inventory), ("raw_rev", reveal)):
        if path:
            with open(path, "rb") as f:
                db.psql("-c", f"COPY heal_dry.{table} FROM STDIN {LINES}", stdin=f)
    with open(os.path.join(HEAL_DIR, "catalog.tsv"), "rb") as f:
        db.psql("-c", f"COPY heal_dry.catalog FROM STDIN {CATALOG}", stdin=f)
    db.psql(script=LOAD_SQL)
    loaded = db.query("SELECT count(*) FROM heal_dry.loaded").decode().strip()
    print(f"config-heal-dryrun: loaded {loaded} inventory rows", flush=True)


def main(argv=None):
    try:
        mode, inventory, reveal = parse_args(sys.argv[1:] if argv is None else argv)
    except Usage:
        print(USAGE, file=sys.stderr)
        return 2
    for label, path in (("inventory", inventory), ("reveal file", reveal)):
        if path and not os.path.isfile(path):
            print(f"config-heal-dryrun: {label} not found: {path}", file=sys.stderr)
            return 2
    with scratch_db.ScratchDb("cfgheal_dryrun") as db:
        strip_fixture_tuples(db.migrations)
        db.psql("-c", "CREATE SCHEMA IF NOT EXISTS config; CREATE SCHEMA heal_dry;")
        print("config-heal-dryrun: migrating config to 40", flush=True)
        db.migrate("goto", "40")
        if mode == "fresh":
            held = db.query(INVENTORY_SQL).count(b"\n")
            print(f"config-heal-dryrun: inventory at 40 holds {held} rows", flush=True)
        else:
            load_staging(db, inventory, reveal)
        print("config-heal-dryrun: applying 041", flush=True)
        db.migrate("goto", "41")
        hashed = "yes" if mode == "staging" else "no"
        content, count = report(
            db.query(REPORT_SQL, "-F", "\t", "-v", f"hashed={hashed}")
        )
        out = os.path.join(HEAL_DIR, f"dryrun-{mode}.tsv")
        with open(out, "wb") as f:
            f.write(content)
        print(
            f"config-heal-dryrun: wrote {os.path.relpath(out, REPO_ROOT)} ({count} rows)",
            flush=True,
        )
        if mode == "staging":
            bad = db.query(BAD_SQL, "-F", "\t")
            if bad:
                print(
                    "config-heal-dryrun: a content decision touched a sentinel or synthesized row:",
                    file=sys.stderr,
                )
                sys.stderr.write(bad.decode())
                return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())

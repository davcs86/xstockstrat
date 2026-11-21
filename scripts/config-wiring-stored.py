#!/usr/bin/env python3
"""Regenerate scripts/config-wiring-stored.json from the config migrations on a scratch database.

Usage: config-wiring-stored.py [out.json]
Needs DATABASE_URL (it creates and drops a scratch DB), psql, migrate.
Never prints the URL or reads value_data; secret rows have default_value nulled.
"""

import hashlib
import os
import sys

# Imported via a sys.path insert, so never run this entry point with python3 -I.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import scratch_db
from scratch_db import CONFIG_MIGRATIONS, REPO_ROOT

# The generator's own sources: a change to either forces a regeneration.
GENERATOR_FILES = ("scripts/config-wiring-stored.py", "scripts/scratch_db.py")

SETUP_SQL = """CREATE SCHEMA IF NOT EXISTS config; CREATE SCHEMA cfgwire_gen;
   CREATE TABLE cfgwire_gen.seen(id bigint PRIMARY KEY, file text NOT NULL);"""

RECORD_SQL = r"""SELECT to_regclass('config.config_values') IS NOT NULL AS has_table \gset
\if :has_table
INSERT INTO cfgwire_gen.seen (id, file)
SELECT c.id, :'file' FROM config.config_values c
ON CONFLICT (id) DO NOTHING;
\endif
"""

EXPORT_SQL = """SELECT jsonb_pretty(jsonb_build_object(
  'inputs_sha256', :'inputs',
  'rows', COALESCE(jsonb_agg(to_jsonb(r) - 'ord' ORDER BY r.namespace COLLATE "C", r.key COLLATE "C",
    r.environment COLLATE "C", r.global DESC, r.ord COLLATE "C"), '[]'::jsonb)))
FROM (
  SELECT c.namespace, c.key, c.environment, c.user_id IS NULL AS global, c.is_secret, c.value_type,
         c.description, c.consuming_service,
         CASE WHEN c.is_secret THEN NULL ELSE c.default_value END AS default_value,
         s.file, md5(COALESCE(c.user_id, '')) AS ord
  FROM config.config_values c
  LEFT JOIN cfgwire_gen.seen s USING (id)
) r;
"""


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def inputs_sha256(root=REPO_ROOT):
    """Same manifest as storedInputsSha256() in scripts/check-config-wiring.mjs."""
    files = list(GENERATOR_FILES)
    for dirpath, _, names in os.walk(os.path.join(root, CONFIG_MIGRATIONS)):
        files += [
            os.path.relpath(os.path.join(dirpath, n), root).replace(os.sep, "/")
            for n in names
        ]
    manifest = ""
    for rel in sorted(files, key=str.encode):
        with open(os.path.join(root, rel), "rb") as f:
            manifest += f"{sha256(f.read())}  {rel}\n"
    return sha256(manifest.encode())


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    out = (
        argv[0]
        if argv
        else os.path.join(REPO_ROOT, "scripts", "config-wiring-stored.json")
    )
    with scratch_db.ScratchDb("cfgwire_stored") as db:
        db.psql("-c", SETUP_SQL)
        # One migration at a time, so each row names the migration that inserted it.
        for name in sorted(
            n for n in os.listdir(db.migrations) if n.endswith(".up.sql")
        ):
            print(f"config-wiring-stored: applying {name}", flush=True)
            db.migrate("up", "1")
            db.psql("-v", f"file={name}", script=RECORD_SQL)
        exported = db.query(EXPORT_SQL, "-v", f"inputs={inputs_sha256()}")
        with open(out, "wb") as f:
            f.write(exported)
    print(f"config-wiring-stored: wrote {os.path.relpath(out, REPO_ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

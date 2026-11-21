"""scripts/db-migrate.sh up against stub psql and migrate: a dirty service is refused, never forced."""

import os
import subprocess

from conftest import SCRIPTS_DIR
from stub_tools import Stubs

DB_URL = "postgres://u:hunter2@db.invalid:5432/x?sslmode=disable"
AHEAD = "9999"


def run_up(tmp_path, versions):
    stubs = Stubs(tmp_path)
    stubs.add("psql")
    arms = "".join(
        f'    *x-migrations-table={schema}_schema_migrations*) echo "{output}" ;;\n'
        for schema, output in versions.items()
    )
    stubs.add(
        "migrate",
        f'case "$*" in *" version")\n  case "$*" in\n{arms}    *) echo {AHEAD} ;;\n  esac ;;\nesac',
    )
    proc = subprocess.run(
        ["bash", str(SCRIPTS_DIR / "db-migrate.sh"), "up"],
        env={
            "PATH": f"{stubs.bin}{os.pathsep}{os.environ['PATH']}",
            "STUB_LOG": str(stubs.log),
            "DATABASE_URL": DB_URL,
        },
        check=False,
        capture_output=True,
        text=True,
        stdin=subprocess.DEVNULL,
    )
    return proc, stubs.calls()


def test_ac1_dirty_service_is_refused_and_never_forced(tmp_path):
    proc, calls = run_up(tmp_path, {"indicators": "5 (dirty)"})
    migrate_calls = [c for c in calls if c.startswith("migrate ")]
    assert proc.returncode == 1
    assert not [c for c in migrate_calls if " force " in c]
    assert not [c for c in migrate_calls if "analysis_schema_migrations" in c]
    assert "hunter2" not in proc.stdout
    assert "hunter2" not in proc.stderr

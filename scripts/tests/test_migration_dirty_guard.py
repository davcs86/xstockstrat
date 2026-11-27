"""scripts/migration-dirty-guard.sh against throwaway migrations dirs: every dirty state is refused."""

import os
import subprocess

import pytest
from conftest import SCRIPTS_DIR

GUARD = SCRIPTS_DIR / "migration-dirty-guard.sh"
FORCE = (
    "  Recover: migrate -path services/xstockstrat-x/migrations -database "
    '"$DATABASE_URL&x-migrations-table=x_schema_migrations" force {}'
)
TRUNCATE = "  Recover: psql \"$DATABASE_URL\" -c 'TRUNCATE public.x_schema_migrations'"
CANNOT = ("cannot compute recovery",)
THEN_FAILS = "If it then fails"
FIVE = ["001", "002", "003", "005", "006"]


def run_guard(args):
    return subprocess.run(
        ["bash", str(GUARD), *args],
        env={**os.environ, "DATABASE_URL": "postgres://u:hunter2@db.invalid/x"},
        check=False,
        capture_output=True,
        text=True,
    )


def guard(tmp_path, versions, dirty, contract=None):
    mig = tmp_path / "services/xstockstrat-x/migrations"
    mig.mkdir(parents=True)
    for v in versions:
        header = ""
        if contract and contract[0] == v:
            header = f"-- contract-of: services/xstockstrat-x/migrations/{contract[1]}_f.up.sql\n"
        (mig / f"{v}_f.up.sql").write_text(f"{header}SELECT 1;\n")
    return run_guard([str(mig), "x", dirty])


# (up-files, dirty, exit, whole lines, same-line groups, absent, first-line prefix, contract)
CASES = [
    pytest.param(
        ["027"], "27 (dirty)", 3, [TRUNCATE], [], [], None, None, id="legacy-a"
    ),
    pytest.param(
        ["026", "027"],
        "27 (dirty)",
        3,
        [FORCE.format(26)],
        [],
        [THEN_FAILS],
        "db-migrate: x is dirty at version 27;",
        None,
        id="legacy-b",
    ),
    pytest.param(
        ["026", "027"],
        "26 (dirty)",
        3,
        [TRUNCATE],
        [("force 27",)],
        [],
        None,
        None,
        id="legacy-c",
    ),
    pytest.param(
        ["026", "027"], "25 (dirty)", 2, [], [CANNOT], [], None, None, id="legacy-d-25"
    ),
    pytest.param(
        ["026", "027"], "20 (dirty)", 2, [], [CANNOT], [], None, None, id="legacy-d-20"
    ),
    pytest.param(
        ["026", "027"],
        "garbage dirty",
        2,
        [],
        [("cannot parse dirty version",)],
        [],
        None,
        None,
        id="legacy-e",
    ),
    pytest.param(
        FIVE,
        "5 (dirty)",
        3,
        [FORCE.format(3)],
        [("version 6", "force 6")],
        [],
        None,
        None,
        id="ac3-gap",
    ),
    pytest.param(
        FIVE, "1 (dirty)", 3, [TRUNCATE], [], ["force -1"], None, None, id="ac4-first"
    ),
    pytest.param(FIVE, "4 (dirty)", 2, [], [CANNOT], [], None, None, id="ac5-no-file"),
    pytest.param(
        FIVE, "7 (dirty)", 2, [], [CANNOT], [], None, None, id="ac5-above-max"
    ),
    pytest.param(
        FIVE,
        "6 (dirty)",
        3,
        [FORCE.format(5)],
        [],
        [THEN_FAILS],
        None,
        None,
        id="d10-no-next",
    ),
    pytest.param([], "5 (dirty)", 2, [], [CANNOT], [], None, None, id="ac5-empty-dir"),
    pytest.param(
        ["019", "020", "026", "027"],
        "20 (dirty)",
        3,
        [FORCE.format(19)],
        [],
        [],
        None,
        ("027", "026"),
        id="durable-ac19",
    ),
    pytest.param(
        ["000", "001"], "1 (dirty)", 3, [FORCE.format(0)], [], [], None, None, id="d13"
    ),
    pytest.param(
        ["008", "009", "010"],
        "009 (dirty)",
        3,
        [FORCE.format(8)],
        [("version 10", "force 10")],
        [],
        None,
        None,
        id="ac27-decimal",
    ),
    pytest.param(
        ["abc"], "3 (dirty)", 2, [], [CANNOT], [], None, None, id="no-numeric-prefix"
    ),
]


@pytest.mark.parametrize(
    ("versions", "dirty", "code", "lines", "groups", "absent", "first", "contract"),
    CASES,
)
def test_guard_refuses_every_dirty_state(
    tmp_path, versions, dirty, code, lines, groups, absent, first, contract
):
    proc = guard(tmp_path, versions, dirty, contract)
    out = proc.stderr.splitlines()
    assert proc.returncode == code, proc.stderr
    for line in lines:
        assert line in out
    for group in groups:
        assert [o for o in out if all(g in o for g in group)], group
    for text in absent:
        assert text not in proc.stderr
    if first is not None:
        assert out[0].startswith(first)
    assert "postgres://" not in proc.stderr
    assert "hunter2" not in proc.stderr
    if code == 3:
        assert "$DATABASE_URL" in proc.stderr
    if code == 2:
        assert not [o for o in out if o.startswith("  Recover:")]


def test_wrong_argument_count_is_usage():
    proc = run_guard(["only-one"])
    assert proc.returncode == 1
    assert "usage:" in proc.stderr

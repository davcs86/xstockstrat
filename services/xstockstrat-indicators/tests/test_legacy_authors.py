"""Legacy-username formula authors (feature 276): report mode detects non-user-id authors,
classifies them against the users file and writes a plan without any write. Regression origin:
docs/reports/2026-10-22-indicators-legacy-username-formula-authors-defect.md."""

import copy
import json
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.formulas import SYSTEM_AUTHOR
from app.maintenance import legacy_authors as la
from tests.conftest import USERS, FakeFormulasTable, make_formula_row

ALICE_ID = "11111111-1111-4111-8111-111111111111"
OWNER_ID = "80880990-2b79-4d85-8761-d8d9102c2efb"


def _users(tmp_path):
    path = tmp_path / "users.json"
    path.write_text(json.dumps(USERS))
    return la.load_users(path)


def _id(n: int) -> str:
    return f"bbbbbbbb-0000-4000-8000-{n:012d}"


async def _report(rows, tmp_path):
    table = FakeFormulasTable(rows)
    out = tmp_path / "plan.json"
    plan = await la.run_report(table, _users(tmp_path), out, run_id="run-1", target=("h", "d"))
    return table, plan, out


async def test_detection_includes_soft_deleted_and_skips_system_and_uuid():
    table = FakeFormulasTable(
        [
            make_formula_row(_id(1), "alice"),
            make_formula_row(_id(2), "alice", deleted=True),
            make_formula_row(_id(3), SYSTEM_AUTHOR),
            make_formula_row(_id(4), ALICE_ID),
            make_formula_row(_id(5), OWNER_ID.upper()),
        ]
    )
    rows = await la.detect(table)
    assert [(r["formula_id"], r["author"], r["deleted"]) for r in rows] == [
        (_id(1), "alice", False),
        (_id(2), "alice", True),
    ]


async def test_unique_match_is_suggested_with_exact_old_author(tmp_path):
    _, plan, _ = await _report(
        [make_formula_row(_id(1), "Alice"), make_formula_row(_id(2), "Alice", deleted=True)],
        tmp_path,
    )
    assert plan["entries"] == [
        {
            "formula_id": fid,
            "old_author": "Alice",
            "new_author": ALICE_ID,
            "status": "suggested",
            "source": "heuristic",
        }
        for fid in (_id(1), _id(2))
    ]


async def test_no_match_is_unmappable(tmp_path, capsys):
    _, plan, _ = await _report([make_formula_row(_id(1), "ghost")], tmp_path)
    (entry,) = plan["entries"]
    assert entry["status"] == "unmappable"
    assert entry["new_author"] is None
    assert f"unmappable: formula_id={_id(1)} author=ghost" in capsys.readouterr().out


async def test_two_matches_is_ambiguous(tmp_path, capsys):
    _, plan, _ = await _report([make_formula_row(_id(1), "sam")], tmp_path)
    (entry,) = plan["entries"]
    assert entry["status"] == "ambiguous"
    assert entry["new_author"] is None
    assert plan["counts"]["ambiguous"] == 1
    assert f"ambiguous: formula_id={_id(1)} author=sam" in capsys.readouterr().out


async def test_inactive_user_is_excluded(tmp_path):
    _, plan, _ = await _report([make_formula_row(_id(1), "olduser")], tmp_path)
    (entry,) = plan["entries"]
    assert entry["status"] == "unmappable"
    assert entry["new_author"] is None


async def test_report_counts_and_zero_writes(tmp_path, capsys):
    rows = [
        make_formula_row(_id(1), "alice"),
        make_formula_row(_id(2), "davcs86", deleted=True),
        make_formula_row(_id(3), "ghost"),
        make_formula_row(_id(4), SYSTEM_AUTHOR),
        make_formula_row(_id(5), ALICE_ID),
        make_formula_row(_id(6), OWNER_ID.upper()),
    ]
    table, plan, out = await _report(rows, tmp_path)
    before = {r["formula_id"]: r for r in copy.deepcopy(rows)}

    expected = {"rewritable": 2, "unmappable": 1, "ambiguous": 0, "clean": 3}
    assert plan["counts"] == expected
    assert json.loads(out.read_text())["counts"] == expected
    assert table.update_count() == 0
    assert all(not sql.lstrip().upper().startswith("UPDATE") for sql, _ in table.execute_log)
    assert table.rows == before
    assert f"sha256={la.plan_digest(out)}" in capsys.readouterr().out


def test_sql_text_carries_both_guards():
    sql = la.REWRITE_SQL
    for guard in ("author <> $4", "author !~* $5", "author = $3", "formula_id = $2::uuid"):
        assert guard in sql
    assert "is_public" not in sql
    assert "updated_at" not in sql


def _fake_connect(monkeypatch):
    fake = AsyncMock(return_value=MagicMock())
    monkeypatch.setattr(la.asyncpg, "connect", fake)
    return fake


async def test_connect_requires_database_url_and_prints_target(monkeypatch, tmp_path, capsys):
    fake = _fake_connect(monkeypatch)
    monkeypatch.chdir(tmp_path)
    (tmp_path / ".env").write_text("DATABASE_URL=postgres://u:p@localhost:5432/xs\n")
    with pytest.raises(SystemExit) as exc:
        await la.connect(env={})
    assert exc.value.code not in (0, None)
    fake.assert_not_called()

    url = "postgres://ops:s3cret@db.example.com:25061/xstockstrat?sslmode=require"
    _, target = await la.connect(env={"DATABASE_URL": url})
    assert target == ("db.example.com", "xstockstrat")
    out = capsys.readouterr().out
    assert "host=db.example.com db=xstockstrat" in out
    assert "s3cret" not in out


@pytest.mark.parametrize(("pgbouncer", "cache"), [("true", 0), ("1", 0), (None, 100)])
async def test_pgbouncer_disables_statement_cache(monkeypatch, pgbouncer, cache):
    fake = _fake_connect(monkeypatch)
    env = {"DATABASE_URL": "postgres://u:p@db:25061/xs"}
    if pgbouncer is not None:
        env["DB_PGBOUNCER"] = pgbouncer
    await la.connect(env=env)
    assert fake.call_args.kwargs["statement_cache_size"] == cache

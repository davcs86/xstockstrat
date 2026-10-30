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


# --- apply mode: refusals, guarded rewrite, idempotence, concurrency ---

OWNER_FORMULA = "31bb8ea6-0f3e-4cf7-8844-ec8294cebf85"
CAROL_ID = "33333333-3333-4333-8333-333333333333"
INACTIVE_ID = "66666666-6666-4666-8666-666666666666"
UNKNOWN_ID = "77777777-7777-4777-8777-777777777777"


def _confirm(plan_path, extra=(), **override):
    """Hand-edit the plan as the operator does (suggested → confirmed plus overrides, extra
    entries appended); returns the sha256 of the edited file."""
    plan = json.loads(plan_path.read_text())
    for e in plan["entries"]:
        if e["status"] == "suggested":
            e.update(status="confirmed", **override)
    plan["entries"].extend(extra)
    plan_path.write_text(json.dumps(plan, indent=2) + "\n")
    return la.plan_digest(plan_path)


def _entry(formula_id, old_author, new_author=OWNER_ID):
    return {
        "formula_id": formula_id,
        "old_author": old_author,
        "new_author": new_author,
        "status": "confirmed",
        "source": "manual",
    }


async def _apply(table, plan_path, digest, tmp_path):
    return await la.run_apply(
        table, _users(tmp_path), plan_path, digest, run_id="run-2", target=("h", "d")
    )


def _authors(table):
    return {fid: (r["author"], r["updated_at"]) for fid, r in table.rows.items()}


async def test_apply_rewrites_confirmed_entries(tmp_path):
    table, _, plan_path = await _report([make_formula_row(OWNER_FORMULA, "davcs86")], tmp_path)
    digest = _confirm(plan_path)
    before = copy.deepcopy(table.rows[OWNER_FORMULA])

    result = await _apply(table, plan_path, digest, tmp_path)

    assert table.rows[OWNER_FORMULA] == {**before, "author": OWNER_ID}
    assert result["counts"]["rewritten"] == 1
    assert table.update_count() == 1
    on_disk = json.loads(plan_path.with_suffix(".result.json").read_text())
    assert on_disk["run_id"] == "run-2"
    assert on_disk["rewritten"] == [
        {"formula_id": OWNER_FORMULA, "old_author": "davcs86", "new_author": OWNER_ID}
    ]


async def test_second_run_changes_nothing(tmp_path):
    rows = [
        make_formula_row(OWNER_FORMULA, "davcs86"),
        make_formula_row(_id(3), SYSTEM_AUTHOR),
        make_formula_row(_id(4), ALICE_ID),
    ]
    table, _, first_plan = await _report(rows, tmp_path)
    first_digest = _confirm(first_plan)
    await _apply(table, first_plan, first_digest, tmp_path)
    after_first = _authors(table)
    updates = table.update_count()

    second_plan = tmp_path / "plan2.json"
    plan = await la.run_report(table, _users(tmp_path), second_plan, run_id="run-3")
    assert plan["entries"] == []
    result = await _apply(table, second_plan, _confirm(second_plan), tmp_path)
    assert result["counts"]["rewritten"] == 0
    replay = await _apply(table, first_plan, first_digest, tmp_path)
    assert replay["counts"]["rewritten"] == 0
    assert replay["counts"]["skipped_not_detected"] == 1

    assert table.update_count() == updates
    assert _authors(table) == after_first
    assert after_first == {
        OWNER_FORMULA: (OWNER_ID, rows[0]["updated_at"]),
        _id(3): (SYSTEM_AUTHOR, rows[1]["updated_at"]),
        _id(4): (ALICE_ID, rows[2]["updated_at"]),
    }


async def _assert_refused(table, plan_path, digest, tmp_path):
    before = copy.deepcopy(table.rows)
    with pytest.raises(la.ApplyRefused) as exc:
        await _apply(table, plan_path, digest, tmp_path)
    assert exc.value.exit_code == 2
    assert table.update_count() == 0
    assert table.rows == before
    return exc.value.reasons


async def _refusal_case(tmp_path, *, digest=None, extra=(), **override):
    rows = [make_formula_row(OWNER_FORMULA, "davcs86"), make_formula_row(_id(3), SYSTEM_AUTHOR)]
    table, _, plan_path = await _report(rows, tmp_path)
    good = _confirm(plan_path, extra=extra, **override)
    return await _assert_refused(table, plan_path, good if digest is None else digest, tmp_path)


async def test_apply_refused_missing_digest(tmp_path):
    reasons = await _refusal_case(tmp_path, digest="")
    assert any("--confirm-digest is required" in r for r in reasons)


async def test_apply_refused_mismatched_digest(tmp_path):
    reasons = await _refusal_case(tmp_path, digest="0" * 64)
    assert any("does not match" in r for r in reasons)


async def test_apply_refused_leftover_suggested(tmp_path):
    table, _, plan_path = await _report(
        [make_formula_row(OWNER_FORMULA, "davcs86"), make_formula_row(_id(1), "alice")], tmp_path
    )
    plan = json.loads(plan_path.read_text())
    plan["entries"][0]["status"] = "confirmed"
    plan_path.write_text(json.dumps(plan))
    reasons = await _assert_refused(table, plan_path, la.plan_digest(plan_path), tmp_path)
    assert any("'suggested'" in r for r in reasons)


async def test_apply_refused_inactive_target(tmp_path):
    reasons = await _refusal_case(tmp_path, new_author=INACTIVE_ID)
    assert any("inactive user" in r for r in reasons)


async def test_apply_refused_unknown_target(tmp_path):
    reasons = await _refusal_case(tmp_path, new_author=UNKNOWN_ID)
    assert any("not in the users file" in r for r in reasons)


async def test_apply_refuses_non_uuid_new_author(tmp_path):
    reasons = await _refusal_case(tmp_path, new_author="davcs86")
    assert any("is not a user id" in r for r in reasons)


async def test_apply_refuses_system_old_author(tmp_path):
    reasons = await _refusal_case(tmp_path, extra=[_entry(_id(3), SYSTEM_AUTHOR)])
    assert any(f"formula_id={_id(3)}: old_author" in r for r in reasons)


async def test_apply_refuses_uuid_old_author(tmp_path):
    rows = [make_formula_row(OWNER_FORMULA, "davcs86"), make_formula_row(_id(4), ALICE_ID)]
    table, _, plan_path = await _report(rows, tmp_path)
    digest = _confirm(plan_path, extra=[_entry(_id(4), ALICE_ID.upper())])
    reasons = await _assert_refused(table, plan_path, digest, tmp_path)
    assert any(f"formula_id={_id(4)}: old_author" in r for r in reasons)


async def test_hand_widened_plan_cannot_extend_write_set(tmp_path):
    rows = [make_formula_row(OWNER_FORMULA, "davcs86"), make_formula_row(_id(4), CAROL_ID)]
    table, _, plan_path = await _report(rows, tmp_path)
    digest = _confirm(plan_path, extra=[_entry(_id(4), "carol")])

    result = await _apply(table, plan_path, digest, tmp_path)

    assert result["counts"]["rewritten"] == 1
    assert result["counts"]["skipped_not_detected"] == 1
    assert table.update_count() == 1
    assert table.rows[_id(4)] == rows[1]
    # The SQL guard alone rejects the row too, even given its exact current author.
    for old in ("carol", CAROL_ID):
        args = (OWNER_ID, _id(4), old, SYSTEM_AUTHOR, la.UUID_RE)
        assert await table.fetchrow(la.REWRITE_SQL, *args) is None
    assert table.rows[_id(4)] == rows[1]


async def test_digest_is_hash_of_edited_file(tmp_path):
    table, _, plan_path = await _report([make_formula_row(OWNER_FORMULA, "davcs86")], tmp_path)
    digest = _confirm(plan_path)
    plan_path.write_text(plan_path.read_text().replace("heuristic", "manual"))
    assert la.plan_digest(plan_path) != digest
    reasons = await _assert_refused(table, plan_path, digest, tmp_path)
    assert any("does not match" in r for r in reasons)

    result = await _apply(table, plan_path, la.plan_digest(plan_path), tmp_path)
    assert result["counts"]["rewritten"] == 1


class _InterleavedTable(FakeFormulasTable):
    """Runs ``on_detect`` once, right after apply's live detection and before its rewrites."""

    on_detect = None

    async def fetch(self, sql, *args):
        rows = await super().fetch(sql, *args)
        if sql == la.DETECT_SQL and self.on_detect:
            hook, self.on_detect = self.on_detect, None
            hook(self)
        return rows


async def test_row_changed_between_plan_and_apply_is_not_lost(tmp_path):
    def owner_writes(t):
        t.mutate(_id(1), author=ALICE_ID, source="result = open")
        t.mutate(_id(2), author=CAROL_ID, source="result = high")

    table = _InterleavedTable([make_formula_row(_id(1), "alice")])
    out = tmp_path / "plan.json"
    await la.run_report(table, _users(tmp_path), out, run_id="run-1")
    digest = _confirm(out)
    table.on_detect = owner_writes

    result = await _apply(table, out, digest, tmp_path)

    assert result["counts"]["skipped_concurrent"] == 1
    assert result["counts"]["rewritten"] == 0
    assert result["rewritten"] == []
    assert (table.rows[_id(1)]["author"], table.rows[_id(1)]["source"]) == (
        ALICE_ID,
        "result = open",
    )
    assert (table.rows[_id(2)]["author"], table.rows[_id(2)]["source"]) == (
        CAROL_ID,
        "result = high",
    )


async def test_unmappable_and_ambiguous_untouched_by_apply(tmp_path):
    rows = [
        make_formula_row(OWNER_FORMULA, "davcs86"),
        make_formula_row(_id(1), "ghost"),
        make_formula_row(_id(2), "sam"),
    ]
    table, _, plan_path = await _report(rows, tmp_path)
    result = await _apply(table, plan_path, _confirm(plan_path), tmp_path)

    assert result["counts"] == {
        "rewritten": 1,
        "skipped_concurrent": 0,
        "skipped_not_detected": 0,
        "unmappable": 1,
        "ambiguous": 1,
    }
    assert table.rows[_id(1)]["author"] == "ghost"
    assert table.rows[_id(2)]["author"] == "sam"

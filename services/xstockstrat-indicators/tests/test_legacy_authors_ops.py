"""Operator workflow over the legacy-author repair (report -> confirm -> apply) for the DO console:
stdlib + asyncpg only, files at 0600, the full result echoed to stdout because a console filesystem
does not survive the post-apply restart."""

import json
import stat

import pytest

from app.maintenance import legacy_authors as la
from app.maintenance import legacy_authors_ops as ops
from tests.conftest import USERS, FakeFormulasTable, make_formula_row

OWNER_ID = "80880990-2b79-4d85-8761-d8d9102c2efb"
F1 = "aaaaaaaa-0000-4000-8000-000000000001"
F2 = "aaaaaaaa-0000-4000-8000-000000000002"
GHOST = "aaaaaaaa-0000-4000-8000-000000000003"


class _UsersAndFormulas(FakeFormulasTable):
    """FakeFormulasTable that also answers the identity.users export."""

    async def fetch(self, sql, *args):
        if sql == ops.USERS_SQL:
            return [
                {"user_id": u["user_id"], "email": f"{u['email_local']}@x.test", "is_active": True}
                for u in USERS
                if u["is_active"]
            ]
        return await super().fetch(sql, *args)


def _table():
    return _UsersAndFormulas(
        [
            make_formula_row(F1, "davcs86"),
            make_formula_row(F2, "davcs86", deleted=True),
            make_formula_row(GHOST, "ghost"),
        ]
    )


def _mode(path) -> int:
    return stat.S_IMODE(path.stat().st_mode)


async def test_export_users_keeps_email_local_part_only():
    users = await ops.export_users(_table())
    assert {"user_id": OWNER_ID, "email_local": "davcs86", "is_active": True} in users
    assert all(set(u) == {"user_id", "email_local", "is_active"} for u in users)


async def test_report_writes_private_files_and_prints_plan(tmp_path, capsys):
    plan = await ops.report(_table(), ("h", "d"), tmp_path, run_id="r1")
    assert [e["status"] for e in plan["entries"]] == ["suggested", "suggested", "unmappable"]
    assert _mode(tmp_path / "users.json") == 0o600
    assert _mode(tmp_path / "plan.json") == 0o600
    out = capsys.readouterr().out
    assert F1 in out and "ghost" in out and "suggested" in out


def test_confirm_marks_only_suggested_and_returns_digest_of_written_file(tmp_path):
    (tmp_path / "plan.json").write_text(
        json.dumps(
            {
                "entries": [
                    {
                        "formula_id": F1,
                        "old_author": "davcs86",
                        "new_author": OWNER_ID,
                        "status": "suggested",
                        "source": "heuristic",
                    },
                    {
                        "formula_id": GHOST,
                        "old_author": "ghost",
                        "new_author": None,
                        "status": "unmappable",
                        "source": "heuristic",
                    },
                ]
            }
        )
    )
    n, digest = ops.confirm(tmp_path, yes=True)
    plan = json.loads((tmp_path / "plan.json").read_text())
    assert n == 1
    assert [e["status"] for e in plan["entries"]] == ["confirmed", "unmappable"]
    assert digest == la.plan_digest(tmp_path / "plan.json")
    assert _mode(tmp_path / "plan.json") == 0o600


def test_confirm_declined_leaves_plan_untouched(tmp_path):
    body = json.dumps(
        {
            "entries": [
                {
                    "formula_id": F1,
                    "old_author": "davcs86",
                    "new_author": OWNER_ID,
                    "status": "suggested",
                }
            ]
        }
    )
    (tmp_path / "plan.json").write_text(body)
    assert ops.confirm(tmp_path, yes=False, ask=lambda _p: "n") == (0, None)
    assert (tmp_path / "plan.json").read_text() == body


async def test_apply_rewrites_and_echoes_result_before_restart(tmp_path, capsys):
    table = _table()
    await ops.report(table, ("h", "d"), tmp_path, run_id="r1")
    _, digest = ops.confirm(tmp_path, yes=True)
    capsys.readouterr()

    result = await ops.apply(table, ("h", "d"), tmp_path, digest, run_id="r2")

    assert result["counts"]["rewritten"] == 2
    assert table.rows[F1]["author"] == OWNER_ID and table.rows[GHOST]["author"] == "ghost"
    assert _mode(tmp_path / "plan.result.json") == 0o600
    out = capsys.readouterr().out
    assert "BEFORE any restart" in out and F1 in out and '"old_author": "davcs86"' in out


async def test_apply_wrong_digest_is_refused_with_zero_writes(tmp_path):
    table = _table()
    await ops.report(table, ("h", "d"), tmp_path, run_id="r1")
    ops.confirm(tmp_path, yes=True)
    with pytest.raises(la.ApplyRefused):
        await ops.apply(table, ("h", "d"), tmp_path, "deadbeef", run_id="r2")
    assert table.update_count() == 0

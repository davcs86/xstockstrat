"""Operator workflow over the legacy-author repair (report -> confirm -> apply) for the DO console:
stdlib + asyncpg only, files at 0600, the full result echoed to stdout because a console filesystem
does not survive the post-apply restart."""

import json
import re
import stat

import pytest

from app.maintenance import legacy_authors as la
from app.maintenance import legacy_authors_ops as ops
from tests.conftest import USERS, FakeFormulasTable, make_formula_row

OWNER_ID = "80880990-2b79-4d85-8761-d8d9102c2efb"
F1 = "aaaaaaaa-0000-4000-8000-000000000001"
F2 = "aaaaaaaa-0000-4000-8000-000000000002"
GHOST = "aaaaaaaa-0000-4000-8000-000000000003"
GHOST_DELETED = "aaaaaaaa-0000-4000-8000-000000000004"
SAM_FID = "aaaaaaaa-0000-4000-8000-000000000005"
ZED = "aaaaaaaa-0000-4000-8000-000000000006"
ALICE_ID = "11111111-1111-4111-8111-111111111111"
SAM_A = "44444444-4444-4444-8444-444444444444"
SAM_B = "55555555-5555-4555-8555-555555555555"
OLD_ID = "66666666-6666-4666-8666-666666666666"


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


def _users_dict(users=USERS):
    return {
        u["user_id"]: {"email_local": u["email_local"], "is_active": u["is_active"]} for u in users
    }


def _entry(formula_id, old_author, status, new_author=None):
    return {
        "formula_id": formula_id,
        "old_author": old_author,
        "new_author": new_author,
        "status": status,
        "source": "heuristic",
    }


class _Ask:
    """Injected `ask`: records each prompt before answering, raises EOFError once out of answers."""

    def __init__(self, *answers):
        self.answers = list(answers)
        self.prompts: list[str] = []

    def __call__(self, prompt):
        self.prompts.append(prompt)
        if not self.answers:
            raise EOFError
        return self.answers.pop(0)


def _listing(out):
    return [line for line in out.splitlines() if re.match(r"^\s+\d+\) ", line)]


def _unresolved():
    return [
        _entry(GHOST, "ghost", "unmappable"),
        _entry(GHOST_DELETED, "ghost", "unmappable"),
        _entry(SAM_FID, "sam", "ambiguous"),
    ]


@pytest.mark.parametrize("author", ["sam", "SAM", "davcs86", "olduser", "ghost"])
def test_candidates_match_classify_rule(author):
    users = _users_dict()
    row = [{"formula_id": GHOST, "author": author}]
    expected = [
        uid
        for uid, u in users.items()
        if la.classify(row, {uid: u})["entries"][0]["status"] == "suggested"
    ]
    assert ops._candidates(author, users) == expected


def test_parse_maps_accepts_valid_repeated_and_candidate_maps():
    users = _users_dict()
    assert ops._parse_maps([f"ghost={OWNER_ID}"], _unresolved(), users) == (
        {"ghost": OWNER_ID},
        [],
    )
    twice = [f"ghost={OWNER_ID}", f"ghost={OWNER_ID}"]
    assert ops._parse_maps(twice, _unresolved(), users) == ({"ghost": OWNER_ID}, [])
    for candidate in (SAM_A, SAM_B):
        assert ops._parse_maps([f"sam={candidate}"], _unresolved(), users) == (
            {"sam": candidate},
            [],
        )


def test_parse_maps_splits_on_the_last_equals():
    rows = [_entry(GHOST, "we=ird", "unmappable")]
    assert ops._parse_maps([f"we=ird={OWNER_ID}"], rows, _users_dict()) == (
        {"we=ird": OWNER_ID},
        [],
    )


def test_parse_maps_match_is_case_sensitive():
    mapping, reasons = ops._parse_maps([f"Ghost={OWNER_ID}"], _unresolved(), _users_dict())
    assert mapping == {}
    assert len(reasons) == 1 and 'no unresolved row has old_author "Ghost"' in reasons[0]


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        (f"ghost={OLD_ID}", f"user {OLD_ID} is inactive"),
        (f"nobody={OWNER_ID}", 'no unresolved row has old_author "nobody"'),
        (f"sam={OWNER_ID}", f'user {OWNER_ID} is not a candidate for "sam"'),
        ("ghost=99999999-9999-4999-8999-999999999999", "is not in users.json"),
        ("sam=not-a-uuid", "is not a user id (UUID)"),
        ("ghost", "expected LEGACY_AUTHOR=USER_ID"),
        (f"={OWNER_ID}", "expected LEGACY_AUTHOR=USER_ID"),
        ("ghost=", "expected LEGACY_AUTHOR=USER_ID"),
    ],
)
def test_parse_maps_rejects(raw, expected):
    mapping, reasons = ops._parse_maps([raw], _unresolved(), _users_dict())
    assert mapping == {}
    assert len(reasons) == 1 and expected in reasons[0]


def test_parse_maps_rejects_one_author_mapped_to_two_users():
    maps = [f"ghost={OWNER_ID}", f"ghost={ALICE_ID}"]
    _, reasons = ops._parse_maps(maps, _unresolved(), _users_dict())
    assert len(reasons) == 1
    assert '"ghost" is mapped to two different users' in reasons[0]


def test_parse_maps_collects_every_reason_in_order():
    maps = [f"ghost={OLD_ID}", f"nobody={OWNER_ID}"]
    _, reasons = ops._parse_maps(maps, _unresolved(), _users_dict())
    assert len(reasons) == 2
    assert "inactive" in reasons[0] and '"nobody"' in reasons[1]


def test_pick_asks_once_per_author_for_all_rows():
    rows = [_entry(GHOST, "ghost", "unmappable"), _entry(GHOST_DELETED, "ghost", "unmappable")]
    ask = _Ask("1")
    assert ops._pick(rows, {}, _users_dict(), ask) == {"ghost": OWNER_ID}
    assert len(ask.prompts) == 1


def test_pick_ambiguous_lists_only_candidates(capsys):
    assert ops._pick([_entry(SAM_FID, "sam", "ambiguous")], {}, _users_dict(), _Ask("s")) == {}
    out = capsys.readouterr().out
    listed = _listing(out)
    assert len(listed) == 2 and SAM_A in listed[0] and SAM_B in listed[1]
    assert OWNER_ID not in out and OLD_ID not in out


def test_pick_unmappable_lists_active_users_in_file_order(capsys):
    ops._pick([_entry(GHOST, "ghost", "unmappable")], {}, _users_dict(), _Ask("s"))
    out = capsys.readouterr().out
    listed = [re.search(r"\(([0-9a-f-]{36})\)", line).group(1) for line in _listing(out)]
    assert listed == [u["user_id"] for u in USERS if u["is_active"]]
    assert OLD_ID not in out


@pytest.mark.parametrize("answer", ["", "s", "S"])
def test_pick_skip_answers_resolve_nothing(answer):
    ask = _Ask(answer)
    assert ops._pick([_entry(GHOST, "ghost", "unmappable")], {}, _users_dict(), ask) == {}
    assert len(ask.prompts) == 1


def test_pick_does_not_offer_an_author_already_chosen():
    ask = _Ask()
    rows = [_entry(GHOST, "ghost", "unmappable")]
    assert ops._pick(rows, {"ghost": OWNER_ID}, _users_dict(), ask) == {}
    assert ask.prompts == []


def test_pick_invalid_answers_consume_attempts_then_skip(capsys):
    rows = [_entry(GHOST, "ghost", "unmappable")]
    ask = _Ask("0", "-1", "abc", "1")
    assert ops._pick(rows, {}, _users_dict(), ask) == {}
    assert len(ask.prompts) == ops._PICK_ATTEMPTS
    assert "3 attempts" in capsys.readouterr().out


def test_pick_rejects_out_of_range_then_accepts_a_valid_answer():
    rows = [_entry(GHOST, "ghost", "unmappable")]
    assert ops._pick(rows, {}, _users_dict(), _Ask("99", "2")) == {"ghost": ALICE_ID}


def test_pick_eof_stops_every_remaining_author(capsys):
    rows = [_entry(GHOST, "ghost", "unmappable"), _entry(ZED, "zed", "unmappable")]
    ask = _Ask()
    assert ops._pick(rows, {}, _users_dict(), ask) == {}
    assert len(ask.prompts) == 1
    assert len(_listing(capsys.readouterr().out)) == sum(u["is_active"] for u in USERS)


def test_pick_eof_keeps_picks_already_made():
    rows = [_entry(GHOST, "ghost", "unmappable"), _entry(ZED, "zed", "unmappable")]
    ask = _Ask("1")
    assert ops._pick(rows, {}, _users_dict(), ask) == {"ghost": OWNER_ID}
    assert len(ask.prompts) == 2


def test_pick_skips_author_with_no_eligible_user(capsys):
    users = {uid: u for uid, u in _users_dict().items() if u["email_local"] != "sam"}
    ask = _Ask()
    assert ops._pick([_entry(SAM_FID, "sam", "ambiguous")], {}, users, ask) == {}
    assert ask.prompts == []
    assert 'there is no eligible user for "sam"' in capsys.readouterr().out

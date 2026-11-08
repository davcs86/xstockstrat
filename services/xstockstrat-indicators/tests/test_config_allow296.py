"""Feature 296 Step 16: the allow_296 sign-off tool replays R in a rolled-back transaction.

Row literals stay inline: this suite is their only consumer (C-13).
"""

import hashlib

import asyncpg
import pytest

import app.maintenance.config_allow296 as ca
from app.maintenance import legacy_authors as la

EMPTY = "  SELECT NULL::text, NULL::text, NULL::text, NULL::text, NULL::text WHERE false\n"
R_TEMPLATE = "DO $$ BEGIN NULL; END $$;\n-- allow_296:begin\n{block}-- allow_296:end\n"
VALUE_HASH = "a" * 64
USER_HASH = "b" * 64
RAISE_HEAD = "feature 296: {n} violation(s); nothing changed"


def _r(block: str = EMPTY) -> str:
    return R_TEMPLATE.format(block=block)


def _sha(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()


class _Tx:
    def __init__(self, conn):
        self.conn = conn

    async def start(self):
        self.conn.events.append("start")

    async def rollback(self):
        self.conn.events.append("rollback")

    async def commit(self):
        self.conn.events.append("commit")

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False


class _FakeConn:
    def __init__(self, *, raises=None, counts=None, twins=None, marker=0, leftover=False):
        self.raises, self.twins = raises, twins or {}
        self.counts = counts if counts is not None else [("twin-deleted", 5)]
        self.marker, self.leftover = marker, leftover
        self.events: list[str] = []
        self.sql: list[str] = []

    def transaction(self, readonly=False):
        return _Tx(self)

    async def execute(self, sql, *args):
        self.sql.append(sql)
        self.events.append("execute")
        if self.raises:
            raise asyncpg.exceptions.RaiseError(self.raises)
        return ""

    async def fetch(self, sql, *args):
        if "config_keys_report_296 GROUP BY" in sql:
            return [{"action": a, "n": n} for a, n in self.counts]
        ns, env, rel, per_user = args
        return self.twins.get((ns, rel, env, per_user), [])

    async def fetchval(self, sql, *args):
        if "current_user" in sql:
            return "doadmin"
        if "config_markers" in sql:
            # after the rollback the marker is back to its pre-replay value
            return self.marker
        return self.leftover

    async def close(self):
        pass


def _twin(per_user=False):
    return [
        {
            "per_user": per_user,
            "user_sha256": USER_HASH if per_user else None,
            "value_sha256": VALUE_HASH,
        }
    ]


def _raise(*lines: str) -> str:
    return "\n".join([RAISE_HEAD.format(n=len(lines)), *lines])


TWIN_LINES = (
    "uncovered-twin analysis/fundsignal.enabled/staging",
    "uncovered-twin marketdata/fundamentals.history.enabled/staging",
)
TWINS = {
    ("analysis", "fundsignal.enabled", "staging", False): _twin(),
    ("marketdata", "fundamentals.history.enabled", "staging", False): _twin(),
}
TARGET = ("host", "staging")


async def _preflight(conn):
    return await ca.preflight(conn, TARGET, 25060, expect_db="staging")


async def test_draft_signs_the_prefixed_member_as_loser(capsys):
    conn = _FakeConn(raises=_raise(*TWIN_LINES), twins=TWINS)
    assert await ca.draft(conn, _r(), expect_tuples=2) == 0
    out = capsys.readouterr().out
    assert f"('analysis', 'analysis.fundsignal.enabled', 'staging', NULL, '{VALUE_HASH}')" in out
    market = "'marketdata', 'marketdata.fundamentals.history.enabled'"
    assert f"({market}, 'staging', NULL, '{VALUE_HASH}')" in out
    block = out.split(ca.BEGIN + "\n")[1].split(ca.END)[0]
    assert f"block_sha256={_sha(block)}" in out
    assert "tuples=2" in out


async def test_draft_per_user_twin_carries_the_user_hash_only(capsys):
    twins = {("analysis", "fundsignal.enabled", "staging", True): _twin(per_user=True)}
    conn = _FakeConn(
        raises=_raise("uncovered-twin analysis/fundsignal.enabled/staging (per-user)"), twins=twins
    )
    assert await ca.draft(conn, _r(), expect_tuples=1) == 0
    assert f"'staging', '{USER_HASH}', '{VALUE_HASH}')" in capsys.readouterr().out


async def test_draft_rolls_back_and_never_commits():
    conn = _FakeConn(raises=_raise(*TWIN_LINES), twins=TWINS)
    await ca.draft(conn, _r(), expect_tuples=2)
    assert "commit" not in conn.events
    assert conn.events[-1] == "rollback"


async def test_draft_refuses_a_tuple_count_mismatch(capsys):
    conn = _FakeConn(raises=_raise(*TWIN_LINES), twins=TWINS)
    with pytest.raises(ca.Refused, match="--expect-tuples"):
        await ca.draft(conn, _r(), expect_tuples=5)
    assert ca.BEGIN not in capsys.readouterr().out


@pytest.mark.parametrize(
    "cls", ["secret-class-twin", "double-prefix", "oracle-mismatch", "stale-signature"]
)
async def test_draft_refuses_violations_that_are_repaired_not_signed(cls, capsys):
    conn = _FakeConn(raises=_raise(f"{cls} marketdata/fmp.api_key/staging"))
    with pytest.raises(ca.Refused, match="repair the data"):
        await ca.draft(conn, _r(), expect_tuples=0)
    assert f"cannot sign: {cls} marketdata/fmp.api_key/staging" in capsys.readouterr().out
    assert ca.BEGIN not in capsys.readouterr().out


async def test_draft_refuses_a_twin_the_tool_cannot_find():
    conn = _FakeConn(raises=_raise(*TWIN_LINES), twins={})
    with pytest.raises(ca.Refused, match="cannot find"):
        await ca.draft(conn, _r(), expect_tuples=2)


async def test_draft_on_a_database_without_twins_keeps_the_empty_block(capsys):
    conn = _FakeConn(raises=None)
    assert await ca.draft(conn, _r(), expect_tuples=0) == 0
    assert "no twins" in capsys.readouterr().out


async def test_rehearse_passes_with_the_signed_block_and_reports_counts(capsys):
    block = f"VALUES\n  ('a', 'a.k', 'staging', NULL, '{VALUE_HASH}')\n"
    conn = _FakeConn(counts=[("twin-deleted", 5)])
    code = await ca.rehearse(conn, _r(block), expect_block_sha256=_sha(block))
    assert code == 0
    out = capsys.readouterr().out
    assert "report twin-deleted=5" in out and "rolled back" in out
    assert conn.events[-1] == "rollback" and "commit" not in conn.events


async def test_rehearse_refuses_a_block_that_is_not_the_signed_one():
    block = "VALUES\n  ('a', 'a.k', 'staging', NULL, 'x')\n"
    with pytest.raises(ca.Refused, match="not the signed one"):
        await ca.rehearse(_FakeConn(), _r(block), expect_block_sha256=_sha("VALUES\n"))


async def test_rehearse_exits_3_when_r_raises_and_still_rolls_back(capsys):
    block = "VALUES\n  ('a', 'a.k', 'staging', NULL, 'x')\n"
    conn = _FakeConn(raises=_raise("stale-signature a/k/staging"))
    assert await ca.rehearse(conn, _r(block), expect_block_sha256=_sha(block)) == 3
    assert "R raised (nothing changed)" in capsys.readouterr().out
    assert conn.events[-1] == "rollback"


async def test_postflight_refuses_when_the_replay_left_state_behind():
    with pytest.raises(ca.Refused, match="left state behind"):
        await ca.postflight(_FakeConn(leftover=True))
    with pytest.raises(ca.Refused, match="left state behind"):
        await ca.postflight(_FakeConn(marker=1))


async def test_preflight_refuses_the_wrong_database_and_an_applied_marker():
    with pytest.raises(ca.Refused, match="--expect-db"):
        await ca.preflight(_FakeConn(), ("host", "production"), 25060, expect_db="staging")
    with pytest.raises(ca.Refused, match="already set"):
        await _preflight(_FakeConn(marker=1))


async def test_preflight_names_the_pooled_port_difference(capsys):
    await ca.preflight(_FakeConn(), TARGET, 25061, expect_db="staging")
    out = capsys.readouterr().out
    assert "port=25061" in out and "role=doadmin" in out and "direct :25060" in out


def test_load_migration_refuses_a_file_whose_bytes_changed(tmp_path):
    path = tmp_path / "R.sql"
    path.write_text(_r())
    with pytest.raises(ca.Refused, match="copy-paste"):
        ca.load_migration(str(path), "0" * 64)
    assert ca.load_migration(str(path), _sha(_r())) == _r()


@pytest.mark.parametrize(
    "text", ["no markers\n", f"{ca.END}\n{ca.BEGIN}\n", f"{ca.BEGIN}\n{ca.BEGIN}\n{ca.END}\n"]
)
def test_allow_block_needs_one_ordered_marker_pair(text):
    with pytest.raises(ca.Refused):
        ca.allow_block(text)


def test_violation_lines_parse_including_per_user_and_dotted_keys():
    msg = _raise(
        "uncovered-twin analysis/fundsignal.enabled/staging (per-user)",
        "secret-class-twin marketdata/fmp.api_key/production",
    )
    assert ca.violations(msg) == [
        ("uncovered-twin", "analysis", "fundsignal.enabled", "staging", True),
        ("secret-class-twin", "marketdata", "fmp.api_key", "production", False),
    ]
    with pytest.raises(ca.Refused):
        ca.violations(_raise("garbage"))


@pytest.mark.parametrize("argv", [["draft"], ["rehearse", "--migration", "x"]])
def test_main_requires_its_expectation_flags(argv):
    with pytest.raises(SystemExit):
        ca.main(argv)


def test_main_exits_2_without_a_connection_when_the_file_hash_is_wrong(
    tmp_path, monkeypatch, capsys
):
    path = tmp_path / "R.sql"
    path.write_text(_r())

    async def _no_connect(*a, **k):
        raise AssertionError("connected before the file was verified")

    monkeypatch.setattr(la, "connect", _no_connect)
    argv = [
        "draft",
        "--migration",
        str(path),
        "--expect-sha256",
        "0" * 64,
        "--expect-db",
        "staging",
        "--expect-tuples",
        "5",
    ]
    assert ca.main(argv) == 2
    assert "refused" in capsys.readouterr().err


def test_main_refuses_a_file_that_commits(tmp_path, monkeypatch):
    text = _r() + "COMMIT;\n"
    path = tmp_path / "R.sql"
    path.write_text(text)
    monkeypatch.setattr(la, "connect", lambda *a, **k: (_ for _ in ()).throw(AssertionError))
    argv = [
        "draft",
        "--migration",
        str(path),
        "--expect-sha256",
        _sha(text),
        "--expect-db",
        "staging",
        "--expect-tuples",
        "0",
    ]
    assert ca.main(argv) == 2

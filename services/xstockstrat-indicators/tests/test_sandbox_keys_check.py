"""Feature 243 Step 5 operator check: the verdict logic and the read-only guarantee."""

from contextlib import asynccontextmanager

from app.maintenance import sandbox_keys_check as sk


def _row(key, env, value, *, user_id=None, by=sk.HEALED_BY, secret=False):
    return {
        "key": key,
        "environment": env,
        "user_id": user_id,
        "is_secret": secret,
        "value_data": value,
        "updated_by": by,
    }


def _healed(envs=("staging", "production")):
    return [_row(k, e, v) for e in envs for k, v in sk.EXPECTED.items()]


MIGRATED = [("config", 34, False)]


def test_healed_state_passes():
    problems, _ = sk.evaluate(_healed(), [], MIGRATED)
    assert problems == []


def test_bare_row_means_031_not_applied():
    rows = _healed() + [_row("sandbox.timeout_ms", "staging", "5000")]
    problems, _ = sk.evaluate(rows, [], MIGRATED)
    assert any("bare global rows remain" in p for p in problems)


def test_missing_and_wrong_value_fail():
    rows = [r for r in _healed() if r["key"] != "indicators.sandbox.timeout_ms"]
    rows[0]["value_data"] = "1"
    problems, _ = sk.evaluate(rows, [], MIGRATED)
    assert any("missing full-dotted" in p for p in problems)
    assert any("expected" in p for p in problems)


def test_secret_row_fails_and_value_edit_is_a_note():
    rows = _healed()
    rows[0]["is_secret"] = True
    rows[1]["updated_by"] = "someone"
    problems, notes = sk.evaluate(rows, [], MIGRATED)
    assert any("secret row" in p for p in problems)
    assert any("edited after 031" in n for n in notes)


def test_per_user_row_is_only_a_note():
    rows = _healed() + [_row("indicators.sandbox.timeout_ms", "staging", "9", user_id="u1")]
    problems, notes = sk.evaluate(rows, [], MIGRATED)
    assert problems == []
    assert any("per-user" in n for n in notes)


def test_missing_snapshot_at_or_past_032_means_031_skipped():
    problems, _ = sk.evaluate(_healed(), None, MIGRATED)
    assert any("SKIPPED" in p for p in problems)
    assert sk.evaluate(_healed(), None, [("config", 30, False)])[0] == []


def test_dirty_migration_table_fails():
    problems, _ = sk.evaluate(_healed(), [], [("config", 34, True)])
    assert any("DIRTY" in p for p in problems)


def test_empty_result_fails():
    assert sk.evaluate([], [], MIGRATED)[0] == ["no indicators sandbox rows at all"]


class _FakeConn:
    def __init__(self, rows, snapshot=None):
        self.rows, self.snapshot = rows, snapshot
        self.statements: list[str] = []
        self.readonly = None

    @asynccontextmanager
    async def transaction(self, readonly=False):
        self.readonly = readonly
        yield

    async def fetch(self, sql, *args):
        self.statements.append(sql)
        if sql == sk.ROWS_SQL:
            return self.rows
        if sql == sk.SNAPSHOT_SQL:
            return self.snapshot or []
        return [{"table_schema": "config"}]

    async def fetchval(self, sql, *args):
        self.statements.append(sql)
        return self.snapshot is not None

    async def fetchrow(self, sql, *args):
        self.statements.append(sql)
        return {"version": 34, "dirty": False}


async def test_check_is_one_readonly_select_only_transaction(capsys):
    conn = _FakeConn(_healed(), snapshot=[])
    assert await sk.check(conn, run_id="t") == 0
    assert conn.readonly is True
    assert conn.statements and all(s.lstrip().upper().startswith("SELECT") for s in conn.statements)
    assert "PASS" in capsys.readouterr().out


async def test_check_exit_code_is_1_on_failure(capsys):
    assert await sk.check(_FakeConn([]), run_id="t") == 1
    assert "FAIL" in capsys.readouterr().out

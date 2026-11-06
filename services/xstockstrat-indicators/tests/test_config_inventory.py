"""Feature 295 Step 1: the config inventory tool redacts secrets, hashes values, refuses reveals.

Row literals stay inline: this suite is their only consumer (C-13).
"""

import hashlib
import json
import re
from contextlib import asynccontextmanager

import app.maintenance.config_inventory as ci
import pytest

from app.maintenance import legacy_authors as la

ENV = "staging"
SECRET_PLAINTEXT = "PLAINTEXT-PROBE-alpaca-key"
SECRET_CIPHERTEXT = "CIPHERTEXT-PROBE-alpaca-key"
TWIN_PLAINTEXT = "PLAINTEXT-PROBE-fmp-twin"
USER = "u-295"


def _sha(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()


def _row(ns, key, value, *, secret=False, user_id=None, value_type="string", encrypted=None):
    return {
        "namespace": ns,
        "key": key,
        "environment": ENV,
        "user_id": user_id,
        "value_type": value_type,
        "is_secret": secret,
        "value_data": value,
        "value_encrypted": encrypted,
        "default_value": "",
        "description": "",
        "consuming_service": "",
        "updated_at": "2026-11-06T00:00:00Z",
    }


ROWS = [
    _row(
        "marketdata", "alpaca.api_key", SECRET_PLAINTEXT, secret=True, encrypted=SECRET_CIPHERTEXT
    ),
    _row("marketdata", "fmp.api_key", SECRET_PLAINTEXT, secret=True, encrypted=SECRET_CIPHERTEXT),
    _row("marketdata", "marketdata.fmp.api_key", TWIN_PLAINTEXT),
    _row("analysis", "analysis.opportunity.max_universe_size", "100", value_type="int"),
    _row("analysis", "fundsignal.enabled", "true", value_type="bool"),
    _row("analysis", "fundsignal.enabled", "false", value_type="bool", user_id=USER),
]
PROBES = [SECRET_PLAINTEXT, SECRET_CIPHERTEXT, TWIN_PLAINTEXT]


class _FakeConn:
    """Returns every canned row for each SELECT on config_values; the tool filters in Python."""

    def __init__(self, rows):
        self.rows = rows
        self.statements: list[str] = []

    @asynccontextmanager
    async def transaction(self, readonly=False):
        yield

    async def fetch(self, sql, *args):
        self.statements.append(sql)
        return [dict(r) for r in self.rows] if "config_values" in sql else []

    async def fetchval(self, sql, *args):
        self.statements.append(sql)
        return None

    async def fetchrow(self, sql, *args):
        self.statements.append(sql)
        return None

    async def execute(self, sql, *args):
        self.statements.append(sql)
        return ""

    async def close(self):
        pass


@pytest.fixture
def conn(monkeypatch):
    fake = _FakeConn(ROWS)

    async def _connect(env=None, run_id="-"):
        return fake, ("fake-host", "fake-db")

    monkeypatch.setattr(la, "connect", _connect)
    return fake


def _run(argv, capsys) -> tuple[int, str]:
    try:
        code = ci.main(argv)
    except SystemExit as exc:
        code = exc.code
    return code, capsys.readouterr().out


def _records(out: str) -> list[dict]:
    return [json.loads(line) for line in out.splitlines() if line.lstrip().startswith("{")]


def _field(record: dict, *names):
    for name in names:
        if name in record:
            return record[name]
    raise AssertionError(f"none of {names} in {sorted(record)}")


def _find(records, ns, key, *, per_user=False) -> dict:
    hits = [
        r
        for r in records
        if _field(r, "namespace", "ns") == ns
        and r["key"] == key
        and (r.get("user_sha256") is not None) == per_user
    ]
    assert len(hits) == 1, (ns, key, per_user, hits)
    return hits[0]


def _reveal(tmp_path, *entries) -> str:
    path = tmp_path / "reveal.json"
    path.write_text(json.dumps([{"environment": ENV, **e} for e in entries]))
    return str(path)


def _assert_no_secret_material(conn, out):
    assert conn.statements, "the tool issued no SQL"
    assert all("value_encrypted" not in s for s in conn.statements)
    for probe in PROBES:
        assert probe not in out
        assert _sha(probe) not in out


def test_inventory_lists_secret_row_metadata_without_secret_material(conn, capsys):  # AC-22
    code, out = _run([], capsys)
    assert code == 0
    _assert_no_secret_material(conn, out)
    line = _find(_records(out), "marketdata", "alpaca.api_key")
    assert _field(line, "environment", "env") == ENV
    assert line["value_type"] == "string"
    assert line["is_secret"] is True
    assert line["value_sha256"] is None


def test_inventory_commits_hashes_not_values(conn, capsys):  # AC-30
    _, out = _run([], capsys)
    line = _find(_records(out), "analysis", "analysis.opportunity.max_universe_size")
    assert line["value_sha256"] == _sha("100")
    assert '"100"' not in out


def test_inventory_ends_with_output_digest_and_tool_hash(conn, capsys):  # AC-30
    _, out = _run([], capsys)
    lines = out.rstrip("\n").splitlines()
    assert re.fullmatch(r"output_sha256=[0-9a-f]{64}", lines[-2])
    with open(ci.__file__, "rb") as src:
        assert lines[-1] == f"tool_sha256={hashlib.sha256(src.read()).hexdigest()}"


def test_user_id_appears_only_hashed(conn, capsys):
    _, out = _run([], capsys)
    assert USER not in out
    line = _find(_records(out), "analysis", "fundsignal.enabled", per_user=True)
    assert line["user_sha256"] == _sha(USER)


def test_plaintext_twin_of_secret_is_secret_class(conn, capsys, tmp_path):  # AC-33
    _, out = _run([], capsys)
    line = _find(_records(out), "marketdata", "marketdata.fmp.api_key")
    assert line["is_secret"] is False
    assert line["secret_class"]
    assert line["value_sha256"] is None
    _assert_no_secret_material(conn, out)

    code, out = _run(
        [
            "--reveal",
            _reveal(tmp_path, {"namespace": "marketdata", "key": "marketdata.fmp.api_key"}),
        ],
        capsys,
    )
    assert code == 2
    _assert_no_secret_material(conn, out)


def test_reveal_prints_plaintext_for_global_sign_off_row(conn, capsys, tmp_path):  # AC-30
    code, out = _run(
        ["--reveal", _reveal(tmp_path, {"namespace": "analysis", "key": "fundsignal.enabled"})],
        capsys,
    )
    assert code == 0
    hits = [r for r in _records(out) if r.get("key") == "fundsignal.enabled" and "value" in r]
    assert [r["value"] for r in hits] == ["true"]
    assert USER not in out


def test_reveal_refuses_per_user_row(conn, capsys, tmp_path):  # AC-36
    request = {"namespace": "analysis", "key": "fundsignal.enabled", "user_id": USER}
    code, out = _run(["--reveal", _reveal(tmp_path, request)], capsys)
    assert code == 2
    assert '"false"' not in out
    assert not [r for r in _records(out) if "value" in r]


def test_reveal_refuses_secret_row(conn, capsys, tmp_path):  # AC-36
    code, out = _run(
        ["--reveal", _reveal(tmp_path, {"namespace": "marketdata", "key": "alpaca.api_key"})],
        capsys,
    )
    assert code == 2
    _assert_no_secret_material(conn, out)

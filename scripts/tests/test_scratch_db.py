"""Unit tests for scripts/scratch_db.py with stub psql/migrate executables; no database."""

import os

import pytest

import scratch_db

URL = "postgres://u:pw@host:5432/main"


@pytest.fixture
def stubs(tmp_path, monkeypatch):
    """psql/migrate stubs that log their argv; `FAIL_ON` makes a call containing that text exit 3."""
    bin_dir, log = tmp_path / "bin", tmp_path / "calls.log"
    bin_dir.mkdir()
    for name in ("psql", "migrate"):
        stub = bin_dir / name
        stub.write_text(
            "#!/bin/sh\n"
            f'echo "{name} $*" >>"{log}"\n'
            'echo "connecting to $1"\n'
            'case "$*" in *"$FAIL_ON"*) [ -n "$FAIL_ON" ] && exit 3;; esac\n'
            "exit 0\n"
        )
        stub.chmod(0o755)
    monkeypatch.setenv("PATH", f"{bin_dir}{os.pathsep}{os.environ['PATH']}")
    monkeypatch.setenv("DATABASE_URL", f"{URL}?sslmode=disable")
    monkeypatch.delenv("FAIL_ON", raising=False)
    return log


def test_redact_hides_both_url_schemes():
    assert (
        scratch_db.redact("a postgres://u:p@h/db b postgresql://x c")
        == "a <url> b <url> c"
    )


def test_scratch_urls_keep_the_query_string():
    assert scratch_db.scratch_urls(f"{URL}?sslmode=disable", "tmp_1") == (
        "postgres://u:pw@host:5432/tmp_1?sslmode=disable",
        f"postgres://u:pw@host:5432/tmp_1?sslmode=disable&{scratch_db.MIGRATIONS_TABLE}",
    )


def test_scratch_urls_without_a_query_string():
    assert scratch_db.scratch_urls(URL, "tmp_1") == (
        "postgres://u:pw@host:5432/tmp_1",
        f"postgres://u:pw@host:5432/tmp_1?{scratch_db.MIGRATIONS_TABLE}",
    )


def test_database_url_is_required(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    with pytest.raises(SystemExit, match="DATABASE_URL is required"):
        scratch_db.ScratchDb("x")


def test_scratch_database_is_created_rendered_and_dropped(stubs, capfd):
    with scratch_db.ScratchDb("unit") as db:
        work = db.work
        assert os.listdir(db.migrations)
        db.psql("-c", "SELECT 1")
        db.migrate("up", "1")
        assert db.query("SELECT 2") == f"connecting to {db.url}\n".encode()
    calls = stubs.read_text().splitlines()
    assert calls[0].endswith(f"CREATE DATABASE {db.name};")
    assert calls[-1].endswith(f"DROP DATABASE IF EXISTS {db.name};")
    assert any(c.startswith("migrate -path") and c.endswith("up 1") for c in calls)
    assert not os.path.exists(work)
    out = capfd.readouterr().out
    assert "connecting to <url>" in out and "postgres://" not in out


def test_a_failing_tool_exits_with_its_status_and_still_drops_the_database(
    stubs, monkeypatch
):
    monkeypatch.setenv("FAIL_ON", "goto 41")
    with pytest.raises(SystemExit) as exc, scratch_db.ScratchDb("unit") as db:
        db.migrate("goto", "41")
    assert exc.value.code == 3
    assert (
        stubs.read_text()
        .splitlines()[-1]
        .endswith(f"DROP DATABASE IF EXISTS {db.name};")
    )

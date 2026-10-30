import hashlib
import inspect
import shutil
import subprocess
import sys
import time

import pytest

from app.catalog import from_function, lint_source, load_catalog
from app.check_api import CHECKS_API_VERSION, check
from tests.conftest import SERVICE_ROOT

BLOCKING = "import time\n\ntime.sleep(1)\n"


@pytest.fixture
def checks_pkg(tmp_path, monkeypatch):
    """A scratch top-level `checks` package holding a copy of the real example check."""
    root = tmp_path / "checks"
    shutil.copytree(SERVICE_ROOT / "checks", root)
    monkeypatch.syspath_prepend(str(tmp_path))
    for name in [m for m in sys.modules if m == "checks" or m.startswith("checks.")]:
        monkeypatch.delitem(sys.modules, name)
    yield root
    for name in [m for m in sys.modules if m == "checks" or m.startswith("checks.")]:
        del sys.modules[name]


def test_load_error_listed_not_dropped(checks_pkg):
    (checks_pkg / "broken").mkdir()
    (checks_pkg / "broken" / "__init__.py").write_text("")
    (checks_pkg / "broken" / "bad_syntax.py").write_text("def oops(:\n")
    cat = load_catalog()
    (err,) = cat.load_errors
    assert err.module == "checks.broken.bad_syntax"
    assert "SyntaxError" in err.error
    assert "example.pass_trivial" in cat.checks


def test_import_error_listed(checks_pkg):
    (checks_pkg / "boom.py").write_text("raise ValueError('nope')\n")
    cat = load_catalog()
    assert [(e.module, "ValueError" in e.error) for e in cat.load_errors] == [("checks.boom", True)]


def test_duplicate_check_id_is_load_error(checks_pkg):
    src = (checks_pkg / "example" / "pass_trivial.py").read_text()
    (checks_pkg / "example" / "zz_dup.py").write_text(src)
    cat = load_catalog()
    assert [e.module for e in cat.load_errors] == ["checks.example.zz_dup"]
    assert "duplicate check id" in cat.load_errors[0].error


def test_blocking_module_is_load_error_and_never_executed(checks_pkg):
    (checks_pkg / "sleepy.py").write_text(BLOCKING)
    t0 = time.monotonic()
    cat = load_catalog()
    assert time.monotonic() - t0 < 1
    (err,) = cat.load_errors
    assert err.module == "checks.sleepy"
    assert "time.sleep" in err.error


@pytest.mark.parametrize(
    "src,needle",
    [
        (BLOCKING, "time.sleep"),
        ("import os\n", "import os"),
        ("from subprocess import run\n", "import subprocess"),
        ("import grpc.aio\n", "import grpc"),
        ("import asyncpg\n", "import asyncpg"),
        ("import socket\n", "import socket"),
        ("async def run(ctx):\n    import time\n    time.sleep(2)\n", "time.sleep"),
    ],
)
def test_lint_source_rejects(src, needle):
    problems = lint_source(src, "checks.x")
    assert problems and all(p.startswith("checks.x:") for p in problems)
    assert any(needle in p for p in problems)


def test_lint_source_allows_a_normal_check():
    src = (SERVICE_ROOT / "checks" / "example" / "pass_trivial.py").read_text()
    assert lint_source(src, "checks.example.pass_trivial") == []


def test_ast_lint_rejects_blocking_call(tmp_path):
    (tmp_path / "sleepy.py").write_text(BLOCKING)
    proc = subprocess.run(
        [sys.executable, "-m", "tools.lint_checks", str(tmp_path)],
        cwd=SERVICE_ROOT,
        capture_output=True,
        text=True,
    )
    assert proc.returncode == 1
    assert "sleepy" in proc.stdout and "time.sleep" in proc.stdout


def test_ast_lint_passes_shipped_checks():
    proc = subprocess.run(
        [sys.executable, "-m", "tools.lint_checks", "checks"],
        cwd=SERVICE_ROOT,
        capture_output=True,
        text=True,
    )
    assert proc.returncode == 0, proc.stdout


def test_check_hash_is_sha256_of_version_and_source():
    @check("c.h", feature="f", part="p", timeout_s=5)
    async def run(ctx):
        return None

    c = from_function(run)
    expected = hashlib.sha256(
        f"{CHECKS_API_VERSION}\n".encode() + inspect.getsource(run).encode()
    ).hexdigest()
    assert c.check_hash == expected
    assert (c.id, c.feature, c.part, c.timeout_s) == ("c.h", "f", "p", 5)

"""
Structural validation of supervisord.conf (AC-1, AC-2, AC-3).
Static-file assertions — no database or runtime required.

AC-1: postgres-mcp co-process is declared in supervisord.conf.
AC-2: app-main (uvicorn agent) is declared in supervisord.conf.
AC-3: postgres-mcp does not bind to 0.0.0.0 (127.0.0.1 is the correct default).

Full runtime verification (both processes actually start) requires docker-compose
integration and is validated at deploy time, not in this unit test.
"""

import configparser
from pathlib import Path

CONF_PATH = Path(__file__).parent.parent / "supervisord.conf"


def _load() -> configparser.RawConfigParser:
    # Use RawConfigParser: supervisord's %(ENV_VAR)s syntax conflicts with
    # configparser's own interpolation engine — raw=True reads values verbatim.
    cfg = configparser.RawConfigParser()
    cfg.read(CONF_PATH)
    return cfg


def test_conf_file_exists():
    assert CONF_PATH.exists(), f"supervisord.conf not found at {CONF_PATH}"


def test_supervisord_nodaemon():
    cfg = _load()
    assert cfg.get("supervisord", "nodaemon") == "true", (
        "nodaemon must be true — supervisord runs as PID 1 in foreground"
    )


def test_app_main_declared():
    """AC-2: agent (uvicorn) process block exists."""
    assert _load().has_section("program:app-main"), "program:app-main section missing (AC-2)"


def test_app_main_autorestart():
    assert _load().get("program:app-main", "autorestart") == "true"


def test_postgres_mcp_declared():
    """AC-1: postgres-mcp co-process block exists."""
    assert _load().has_section("program:postgres-mcp"), (
        "program:postgres-mcp section missing (AC-1)"
    )


def test_postgres_mcp_autorestart():
    assert _load().get("program:postgres-mcp", "autorestart") == "true"


def test_postgres_mcp_no_external_bind():
    """AC-3: postgres-mcp must NOT explicitly bind to 0.0.0.0."""
    command = _load().get("program:postgres-mcp", "command")
    assert "0.0.0.0" not in command, (
        "postgres-mcp command must not contain 0.0.0.0; 127.0.0.1 is the correct default (AC-3)"
    )


def test_postgres_mcp_unrestricted():
    """FR-2: postgres-mcp must run in --unrestricted mode (write access required)."""
    command = _load().get("program:postgres-mcp", "command")
    assert "--unrestricted" in command, "postgres-mcp must use --unrestricted mode (FR-2)"

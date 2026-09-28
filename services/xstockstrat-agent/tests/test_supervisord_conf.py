"""
Structural validation of supervisord.conf.
Static-file assertions — no database or runtime required.

app-main (uvicorn agent) is the sole declared program. The postgres-mcp
co-process was removed with feature 214 (@AC-2): supervisord must NOT declare
any program:postgres-mcp section.
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
    """The agent (uvicorn) process block exists."""
    assert _load().has_section("program:app-main"), "program:app-main section missing"


def test_app_main_autorestart():
    assert _load().get("program:app-main", "autorestart") == "true"


def test_no_postgres_mcp_section():
    """@AC-2 @feature-214: the postgres-mcp co-process is removed — no such program block."""
    assert not _load().has_section("program:postgres-mcp"), (
        "program:postgres-mcp must not be declared — the co-process was removed (feature 214)"
    )

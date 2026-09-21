"""Smoke tests: all four new runtime dependencies are importable/available."""

import shutil


def test_supervisor_importable():
    import supervisor  # noqa: F401


def test_sqlglot_importable():
    import sqlglot  # noqa: F401


def test_httpx2_importable():
    import httpx2  # noqa: F401


def test_postgres_mcp_binary_on_path():
    assert shutil.which("postgres-mcp") is not None, (
        "postgres-mcp binary not found in PATH — "
        "ensure 'postgres-mcp' is in [project] dependencies and uv sync has run"
    )

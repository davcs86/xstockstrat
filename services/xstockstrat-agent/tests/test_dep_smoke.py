"""Smoke test: the supervisor runtime dependency is importable.

The postgres-mcp-era smoke checks were removed with feature 214: `postgres-mcp`
and `sqlglot` are gone, and `httpx2` is no longer a direct dependency (it is now
pulled only transitively by the `mcp` SDK, and no agent code imports it directly).
"""


def test_supervisor_importable():
    import supervisor  # noqa: F401

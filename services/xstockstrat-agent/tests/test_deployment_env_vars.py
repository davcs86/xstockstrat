"""
Static-file CI assertions for deployment env vars and connection budget (AC-4, AC-10, AC-11).
Primary verification is PR diff review; this suite enforces in CI.

AC-4: POSTGRES_MCP_DATABASE_URI present (wires xstockstrat_agent credentials to postgres-mcp)
AC-10: Root CLAUDE.md connection budget updated for postgres-mcp's 1 direct connection
AC-11: Both vars present in all 3 deployment files
"""

from pathlib import Path

# Depth from test file to repo root:
# tests/ -> xstockstrat-agent/ -> services/ -> (repo root)
REPO_ROOT = Path(__file__).parent.parent.parent.parent


def _read(rel: str) -> str:
    return (REPO_ROOT / rel).read_text()


def test_docker_compose_has_database_uri():
    """AC-11: docker-compose.yml has POSTGRES_MCP_DATABASE_URI."""
    assert "POSTGRES_MCP_DATABASE_URI" in _read("docker-compose.yml")


def test_docker_compose_has_port():
    """AC-11: docker-compose.yml has POSTGRES_MCP_PORT."""
    assert "POSTGRES_MCP_PORT" in _read("docker-compose.yml")


def test_app_dev_yaml_has_database_uri():
    """AC-11: .do/app.dev.yaml has POSTGRES_MCP_DATABASE_URI."""
    assert "POSTGRES_MCP_DATABASE_URI" in _read(".do/app.dev.yaml")


def test_app_dev_yaml_has_port():
    """AC-11: .do/app.dev.yaml has POSTGRES_MCP_PORT."""
    assert "POSTGRES_MCP_PORT" in _read(".do/app.dev.yaml")


def test_app_yaml_has_database_uri():
    """AC-11: .do/app.yaml has POSTGRES_MCP_DATABASE_URI."""
    assert "POSTGRES_MCP_DATABASE_URI" in _read(".do/app.yaml")


def test_app_yaml_has_port():
    """AC-11: .do/app.yaml has POSTGRES_MCP_PORT."""
    assert "POSTGRES_MCP_PORT" in _read(".do/app.yaml")


def test_claude_md_has_agent_role_in_budget():
    """AC-10: Root CLAUDE.md connection budget table mentions xstockstrat_agent role."""
    content = _read("CLAUDE.md")
    assert "xstockstrat_agent" in content, (
        "Root CLAUDE.md must contain xstockstrat_agent in the connection budget table (AC-10)"
    )


def test_claude_md_direct_total_is_nine():
    """AC-10: Root CLAUDE.md direct-backend total is updated to 9."""
    content = _read("CLAUDE.md")
    # The direct backend total row must show 9, not 8
    assert "**9**" in content, (
        "Root CLAUDE.md direct-backend total must be **9** after adding postgres-mcp (AC-10)"
    )

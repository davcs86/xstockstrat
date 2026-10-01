"""
Static-file CI assertions for the connection budget after the postgres-mcp removal (feature 214).
Primary verification is PR diff review; this suite enforces in CI.

@AC-3 @feature-214: no POSTGRES_MCP_* deploy wiring remains in any deployment file, the
xstockstrat-agent (postgres-mcp) row is gone from the root CLAUDE.md connection budget, and the
direct-backend total is re-derived to 8 (was 9 with the removed postgres-mcp connection).
"""

from pathlib import Path

# Depth from test file to repo root:
# tests/ -> xstockstrat-agent/ -> services/ -> (repo root)
REPO_ROOT = Path(__file__).parent.parent.parent.parent


def _read(rel: str) -> str:
    return (REPO_ROOT / rel).read_text()


def test_no_postgres_mcp_env_in_deploy_files():
    """@AC-3 @feature-214: POSTGRES_MCP_* wiring is absent from every deployment file."""
    for rel in ("docker-compose.yml", ".do/app.dev.yaml", ".do/app.yaml"):
        assert "POSTGRES_MCP" not in _read(rel), f"{rel} still references POSTGRES_MCP"


def test_claude_md_no_agent_postgres_mcp_budget_row():
    """@AC-3 @feature-214: postgres-mcp budget row and DB role removed from root CLAUDE.md."""
    content = _read("CLAUDE.md")
    assert "xstockstrat-agent (postgres-mcp)" not in content, (
        "the postgres-mcp budget row must be removed from the connection budget table"
    )
    assert "xstockstrat_agent" not in content, (
        "the xstockstrat_agent DB role must no longer be referenced in root CLAUDE.md"
    )


def test_claude_md_direct_total_is_eight():
    """@AC-3 @feature-214: direct-backend total re-derived to 8 after the removal."""
    content = _read("CLAUDE.md")
    assert "**Direct backend total** | | | **8**" in content, (
        "Root CLAUDE.md direct-backend total must be **8** after feature 214 removed the agent slot"
    )

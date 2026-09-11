"""
Unit tests for db_* handlers and the _is_destructive FR-11 gate.

AC-5: admin caller gets a response from db_analyze_db_health
AC-6: non-admin caller gets PERMISSION_DENIED
AC-7: SELECT via db_execute_sql forwards immediately (no dry-run)
AC-12: UPDATE without confirm=True returns dry-run, NOT forwarded to postgres-mcp
AC-13: UPDATE with confirm=True is forwarded to postgres-mcp
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from mcp.server.mcpserver import MCPServer

from app.tools import _is_destructive, register_tools
from tests.conftest import ADMIN, TRADER, _ctx


def _make_server() -> MCPServer:
    server = MCPServer("test-agent")
    register_tools(server)
    return server


def _tool_fn(server: MCPServer, name: str):
    return server._tool_manager.get_tool(name).fn


# ── _is_destructive ───────────────────────────────────────────────────────────


class TestIsDestructive:
    def test_select_not_destructive(self):
        assert _is_destructive("SELECT * FROM foo") is False

    def test_insert_not_destructive(self):
        assert _is_destructive("INSERT INTO foo VALUES (1)") is False

    def test_update_is_destructive(self):
        assert _is_destructive("UPDATE foo SET x=1 WHERE id=1") is True

    def test_delete_is_destructive(self):
        assert _is_destructive("DELETE FROM foo WHERE id=1") is True

    def test_drop_is_destructive(self):
        assert _is_destructive("DROP INDEX foo_idx") is True

    def test_truncate_is_destructive(self):
        """TRUNCATE must return True regardless of sqlglot branch (design.md §Open Risks)."""
        assert _is_destructive("TRUNCATE TABLE foo") is True

    def test_commented_update_not_destructive(self):
        """UPDATE only inside a SQL comment must not be flagged."""
        assert _is_destructive("SELECT 1 -- UPDATE foo SET x=1") is False

    def test_multistatement_with_delete_is_destructive(self):
        assert _is_destructive("SELECT 1; DELETE FROM foo;") is True


# ── Admin gate ────────────────────────────────────────────────────────────────


async def test_db_analyze_db_health_admin_succeeds():
    """AC-5: admin caller receives a non-error tool response."""
    mock_result = MagicMock()
    server = _make_server()
    with patch(
        "app.tools.postgres_mcp_client.call_tool",
        new=AsyncMock(return_value=mock_result),
    ):
        result = await _tool_fn(server, "db_analyze_db_health")(ctx=_ctx(ADMIN), health_type="all")
    assert result is not None


async def test_db_analyze_db_health_non_admin_denied():
    """AC-6: non-admin caller receives PERMISSION_DENIED RuntimeError."""
    server = _make_server()
    with pytest.raises(RuntimeError, match="PERMISSION_DENIED"):
        await _tool_fn(server, "db_analyze_db_health")(ctx=_ctx(TRADER), health_type="all")


# ── FR-11 gate ────────────────────────────────────────────────────────────────


async def test_db_execute_sql_select_forwards_immediately():
    """AC-7: SELECT bypasses FR-11 gate and forwards to postgres-mcp."""
    mock_result = MagicMock()
    server = _make_server()
    with patch(
        "app.tools.postgres_mcp_client.call_tool",
        new=AsyncMock(return_value=mock_result),
    ) as mock_call:
        result = await _tool_fn(server, "db_execute_sql")(
            ctx=_ctx(ADMIN), sql="SELECT 1", confirm=False
        )
    mock_call.assert_called_once_with("execute_sql", {"sql": "SELECT 1"})
    result_text = " ".join(c.text for c in result if hasattr(c, "text"))
    assert "DRY RUN" not in result_text


async def test_db_execute_sql_update_without_confirm_dry_run():
    """AC-12: UPDATE without confirm=True returns dry-run message; postgres-mcp NOT called."""
    server = _make_server()
    with patch("app.tools.postgres_mcp_client.call_tool", new=AsyncMock()) as mock_call:
        result = await _tool_fn(server, "db_execute_sql")(
            ctx=_ctx(ADMIN), sql="UPDATE foo SET x=1", confirm=False
        )
    mock_call.assert_not_called()
    result_text = " ".join(c.text for c in result if hasattr(c, "text"))
    assert "DRY RUN" in result_text


async def test_db_execute_sql_update_with_confirm_forwards():
    """AC-13: UPDATE with confirm=True is forwarded to postgres-mcp."""
    mock_result = MagicMock()
    server = _make_server()
    with patch(
        "app.tools.postgres_mcp_client.call_tool",
        new=AsyncMock(return_value=mock_result),
    ) as mock_call:
        await _tool_fn(server, "db_execute_sql")(
            ctx=_ctx(ADMIN), sql="UPDATE foo SET x=1", confirm=True
        )
    mock_call.assert_called_once_with("execute_sql", {"sql": "UPDATE foo SET x=1"})

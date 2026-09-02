"""Unit tests for the postgres_mcp_client per-call SSE module."""

from unittest.mock import AsyncMock, MagicMock, patch

import httpx2
import pytest

from app.postgres_mcp_client import _postgres_mcp_url, call_tool


@pytest.fixture(autouse=True)
def port_env(monkeypatch):
    monkeypatch.setenv("POSTGRES_MCP_PORT", "9001")


def test_postgres_mcp_url_uses_env_port(monkeypatch):
    monkeypatch.setenv("POSTGRES_MCP_PORT", "12345")
    url = _postgres_mcp_url()
    assert url == "http://localhost:12345/sse"


async def test_call_tool_success():
    """Happy path: sse_client connects and returns a tool result."""
    mock_result = MagicMock()
    mock_session = AsyncMock()
    mock_session.call_tool.return_value = mock_result

    with (
        patch("app.postgres_mcp_client.sse_client") as mock_sse,
        patch("app.postgres_mcp_client.ClientSession") as mock_cs,
    ):
        mock_sse.return_value.__aenter__ = AsyncMock(return_value=(AsyncMock(), AsyncMock()))
        mock_sse.return_value.__aexit__ = AsyncMock(return_value=False)
        mock_cs.return_value.__aenter__ = AsyncMock(return_value=mock_session)
        mock_cs.return_value.__aexit__ = AsyncMock(return_value=False)

        result = await call_tool("db_list_schemas", {})

    mock_session.initialize.assert_called_once()
    mock_session.call_tool.assert_called_once_with("db_list_schemas", {})
    assert result is mock_result


async def test_connect_error_raises_runtime_error():
    with patch("app.postgres_mcp_client.sse_client") as mock_sse:
        mock_sse.return_value.__aenter__ = AsyncMock(side_effect=httpx2.ConnectError("refused"))
        mock_sse.return_value.__aexit__ = AsyncMock(return_value=False)
        with pytest.raises(RuntimeError, match="postgres-mcp co-process is unavailable"):
            await call_tool("db_list_schemas", {})


async def test_connect_timeout_raises_runtime_error():
    with patch("app.postgres_mcp_client.sse_client") as mock_sse:
        mock_sse.return_value.__aenter__ = AsyncMock(side_effect=httpx2.ConnectTimeout("timed out"))
        mock_sse.return_value.__aexit__ = AsyncMock(return_value=False)
        with pytest.raises(RuntimeError, match="postgres-mcp co-process is unavailable"):
            await call_tool("db_list_schemas", {})


async def test_os_error_raises_runtime_error():
    with patch("app.postgres_mcp_client.sse_client") as mock_sse:
        mock_sse.return_value.__aenter__ = AsyncMock(side_effect=OSError("no route to host"))
        mock_sse.return_value.__aexit__ = AsyncMock(return_value=False)
        with pytest.raises(RuntimeError, match="postgres-mcp co-process is unavailable"):
            await call_tool("db_list_schemas", {})

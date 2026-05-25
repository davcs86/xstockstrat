"""Tests for app/client.py — HTTP client wrapper with x-mcp-secret header."""
import pytest
import respx
import httpx

from app import client


@pytest.mark.asyncio
async def test_post_ingest_adds_mcp_secret_header():
    """When MCP_AGENT_SECRET is set, x-mcp-secret header is sent."""
    with respx.mock(base_url="http://ingest-test:8055") as mock:
        route = mock.post("/webhooks/ingest-signal").mock(
            return_value=httpx.Response(200, json={"signal_id": 1})
        )
        result = await client.post_ingest("/webhooks/ingest-signal", {"source": "test"})
        assert result == {"signal_id": 1}
        assert route.called
        assert route.calls.last.request.headers["x-mcp-secret"] == "test-secret"


@pytest.mark.asyncio
async def test_post_notify_adds_mcp_secret_header():
    """emit_alert via notify webhook includes x-mcp-secret."""
    with respx.mock(base_url="http://notify-test:8059") as mock:
        route = mock.post("/webhooks/emit-alert").mock(
            return_value=httpx.Response(200, json={"success": True})
        )
        result = await client.post_notify("/webhooks/emit-alert", {"title": "test"})
        assert result == {"success": True}
        assert route.calls.last.request.headers["x-mcp-secret"] == "test-secret"


@pytest.mark.asyncio
async def test_post_analysis_adds_mcp_secret_header():
    """run_backtest via analysis webhook includes x-mcp-secret."""
    with respx.mock(base_url="http://analysis-test:8056") as mock:
        route = mock.post("/webhooks/run-backtest").mock(
            return_value=httpx.Response(200, json={"backtest_id": "abc"})
        )
        result = await client.post_analysis("/webhooks/run-backtest", {"strategy_id": "sma"})
        assert result == {"backtest_id": "abc"}
        assert route.calls.last.request.headers["x-mcp-secret"] == "test-secret"


@pytest.mark.asyncio
async def test_no_mcp_secret_when_env_empty(monkeypatch):
    """When MCP_AGENT_SECRET is empty, x-mcp-secret header is omitted."""
    monkeypatch.setattr(client, "MCP_AGENT_SECRET", "")
    with respx.mock(base_url="http://ingest-test:8055") as mock:
        route = mock.post("/webhooks/ingest-signal").mock(
            return_value=httpx.Response(200, json={})
        )
        await client.post_ingest("/webhooks/ingest-signal", {})
        assert "x-mcp-secret" not in route.calls.last.request.headers

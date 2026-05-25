"""Tests for x-mcp-secret middleware in xstockstrat-ingest http_server."""
from unittest.mock import MagicMock

import pytest
from starlette.testclient import TestClient

from app import http_server
from app.http_server import build_app


def _client(secret: str) -> TestClient:
    """Build a TestClient with the module-level secret patched to `secret`."""
    http_server._MCP_AGENT_SECRET = secret
    return TestClient(build_app(MagicMock()), raise_server_exceptions=False)


def test_webhook_rejected_when_header_missing():
    client = _client("test-secret")
    resp = client.post("/webhooks/ingest-signal", json={})
    assert resp.status_code == 401


def test_webhook_rejected_when_header_wrong():
    client = _client("test-secret")
    resp = client.post(
        "/webhooks/ingest-signal", json={}, headers={"x-mcp-secret": "wrong"}
    )
    assert resp.status_code == 401


def test_webhook_passes_with_correct_header():
    """With the correct secret, request reaches the handler (may fail for other reasons)."""
    client = _client("test-secret")
    resp = client.post(
        "/webhooks/ingest-signal", json={}, headers={"x-mcp-secret": "test-secret"}
    )
    assert resp.status_code != 401


def test_non_webhook_path_not_gated():
    """x-mcp-secret is only enforced on /webhooks/* paths."""
    client = _client("test-secret")
    resp = client.get("/healthz")
    assert resp.status_code != 401


def test_enforcement_skipped_when_secret_empty():
    """When MCP_AGENT_SECRET is empty string, all /webhooks/* requests pass through."""
    client = _client("")
    resp = client.post("/webhooks/ingest-signal", json={})
    assert resp.status_code != 401

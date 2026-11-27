"""Bounded `oidc` authentication at the MCP edge (feature 345, D-18), after test_auth_deadline."""

import concurrent.futures
import time
from unittest.mock import patch

import pytest
from starlette.testclient import TestClient

from app import client
from tests.conftest import HANG_GUARD_S

_RPC_S = 0.2


@pytest.fixture(autouse=True)
def _fast_budget_and_fixed_trace(monkeypatch):
    monkeypatch.setattr(client, "_RPC_TIMEOUT_S", _RPC_S)
    with patch("app.main._new_trace_id", return_value="trace-345"):
        yield


def _post_mcp(token: str):
    from app.main import build_http_app  # noqa: PLC0415

    def _run():
        with TestClient(build_http_app()) as tc:
            start = time.monotonic()
            r = tc.post(
                "/",
                json={"jsonrpc": "2.0", "id": 1, "method": "initialize"},
                headers={"Authorization": f"Bearer {token}"},
            )
            return r, time.monotonic() - start

    executor = concurrent.futures.ThreadPoolExecutor(max_workers=1)
    try:
        return executor.submit(_run).result(timeout=HANG_GUARD_S)
    finally:
        executor.shutdown(wait=False)


def test_stalled_resolve_returns_503_without_www_authenticate(oidc_mode, hung_backend):
    handle = hung_backend("IDENTITY_ENDPOINT")

    r, elapsed = _post_mcp(oidc_mode.token())

    assert r.status_code == 503
    assert "www-authenticate" not in r.headers
    assert elapsed < _RPC_S + 0.5
    assert handle.entered == 1
    assert handle.calls[0][0] == "ResolveExternalIdentity"
    assert handle.calls[0][1].get("x-trace-id") == "trace-345"
    assert "x-user-id" not in handle.calls[0][1]


def test_precheck_reject_consumes_no_budget(oidc_mode, hung_backend):
    handle = hung_backend("IDENTITY_ENDPOINT")

    r, elapsed = _post_mcp("not.a.jwt")

    assert r.status_code == 401
    assert "resource_metadata=" in r.headers["www-authenticate"]
    assert elapsed < _RPC_S
    assert handle.entered == 0
    assert oidc_mode.jwks.call_count == 0

"""Bounded ValidateToken at the MCP HTTP edge (feature 273, @AC-11)."""

import concurrent.futures
import time
from unittest.mock import patch

import grpc
import pytest
from starlette.responses import Response
from starlette.testclient import TestClient

import app.auth
from app import auth, client
from app.scopes import MCP_CLAIMS_SCOPE_KEY
from tests.conftest import HANG_GUARD_S

_RPC_S = 0.2


@pytest.fixture(autouse=True)
def _fast_budget_and_fixed_trace(monkeypatch):
    monkeypatch.setattr(client, "_RPC_TIMEOUT_S", _RPC_S)
    # create=True: before the fix main.py has no _new_trace_id, and the test must fail on its
    # status/trace assertions rather than on the patch target.
    with patch("app.main._new_trace_id", return_value="trace-273", create=True):
        yield


def _post_mcp():
    """POST the MCP root with a bearer token; return (response, seconds spent in the request)."""
    from app.main import build_http_app  # noqa: PLC0415

    def _run():
        with TestClient(build_http_app()) as tc:
            start = time.monotonic()
            r = tc.post(
                "/",
                json={"jsonrpc": "2.0", "id": 1, "method": "initialize"},
                headers={"Authorization": "Bearer some.jwt"},
            )
            return r, time.monotonic() - start

    # Never `with ThreadPoolExecutor`: its exit joins a hung worker before the server is stopped.
    executor = concurrent.futures.ThreadPoolExecutor(max_workers=1)
    try:
        return executor.submit(_run).result(timeout=HANG_GUARD_S)
    finally:
        executor.shutdown(wait=False)


def test_ac11_stalled_identity_returns_503_without_www_authenticate(hung_backend):
    handle = hung_backend("IDENTITY_ENDPOINT", module=app.auth)

    r, elapsed = _post_mcp()

    assert r.status_code == 503
    assert "www-authenticate" not in r.headers
    assert elapsed < 0.7
    assert handle.calls[0][1].get("x-trace-id") == "trace-273"


def test_ac11_valid_token_stamps_the_same_trace_id_on_claims(hung_backend):
    from gen.identity.v1 import identity_pb2  # noqa: PLC0415

    handle = hung_backend(
        "IDENTITY_ENDPOINT",
        module=app.auth,
        answers={
            "ValidateToken": (0, identity_pb2.TokenClaims(user_id="u-1", aud=auth.AGENT_PUBLIC_URL))
        },
    )
    captured: dict = {}

    async def _capture(_self, scope, receive, send):
        captured["claims"] = scope["state"][MCP_CLAIMS_SCOPE_KEY]
        await Response("ok")(scope, receive, send)

    with patch(
        "mcp.server.streamable_http_manager.StreamableHTTPSessionManager.handle_request", _capture
    ):
        r, _ = _post_mcp()

    assert r.status_code == 200
    assert captured["claims"]["user_id"] == "u-1"
    assert captured["claims"].get("trace_id") == "trace-273"
    assert captured["claims"].get("trace_id") == handle.calls[0][1].get("x-trace-id")


def test_ac11_invalid_token_still_401_with_www_authenticate(hung_backend):
    hung_backend(
        "IDENTITY_ENDPOINT",
        module=app.auth,
        answers={"ValidateToken": (0, grpc.StatusCode.UNAUTHENTICATED)},
    )

    r, _ = _post_mcp()

    assert r.status_code == 401
    assert "resource_metadata=" in r.headers["www-authenticate"]

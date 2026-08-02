"""Regression test: real caller claims flowing through the real Streamable HTTP transport
(feature 085, closing design.md's Open Risk 1).

Every existing test either calls a tool function directly or hand-builds a `ctx` fixture
(test_config_tools.py's `_ctx()`). This drives an actual JSON-RPC session through
build_http_app()'s real session_manager.handle_request, proving _claims_from_context receives
genuine claims when populated by the real transport, not a stand-in fixture.
"""

import json
from unittest.mock import AsyncMock, patch

from starlette.testclient import TestClient

from app import client

_HEADERS = {
    "Accept": "application/json, text/event-stream",
    "Content-Type": "application/json",
}


def _app():
    from app.main import build_http_app  # noqa: PLC0415

    return build_http_app()


def _sse_json(body: str) -> dict:
    """Streamable HTTP responses are SSE-framed: `event: message\\ndata: {...}\\n\\n`."""
    for line in body.splitlines():
        if line.startswith("data: "):
            return json.loads(line[len("data: ") :])
    raise AssertionError(f"no SSE data line found in: {body!r}")


def test_set_config_receives_the_real_callers_scope_over_the_real_transport():
    admin_claims = {"user_id": "u-1", "email": "a@b.c", "roles": ["admin"], "aud": "x"}
    with (
        patch("app.auth.validate_bearer_claims", AsyncMock(return_value=admin_claims)),
        patch.object(client, "list_config_keys", AsyncMock(return_value={"keys": []})),
        patch.object(
            client, "set_config", AsyncMock(return_value={"version": 3, "updated_at": "now"})
        ) as mock_set,
        TestClient(_app()) as tc,
    ):
        headers = dict(_HEADERS, Authorization="Bearer good.jwt")

        init = tc.post(
            "/",
            json={
                "jsonrpc": "2.0",
                "id": 1,
                "method": "initialize",
                "params": {
                    "protocolVersion": "2025-06-18",
                    "capabilities": {},
                    "clientInfo": {"name": "test", "version": "0"},
                },
            },
            headers=headers,
        )
        assert init.status_code == 200
        headers["mcp-session-id"] = init.headers["mcp-session-id"]

        notif = tc.post(
            "/",
            json={"jsonrpc": "2.0", "method": "notifications/initialized"},
            headers=headers,
        )
        assert notif.status_code == 202

        call = tc.post(
            "/",
            json={
                "jsonrpc": "2.0",
                "id": 2,
                "method": "tools/call",
                "params": {
                    "name": "set_config",
                    "arguments": {
                        "namespace": "marketdata",
                        "key": "marketdata.fmp.enabled",
                        "value_type": "bool",
                        "value": "true",
                        "author": "a@b.c",
                        "reason": "test",
                    },
                },
            },
            headers=headers,
        )
        assert call.status_code == 200
        body = _sse_json(call.text)
        assert body["result"]["isError"] is False

    # The proof: set_config called client.set_config with the ADMIN scope derived from the
    # REAL bearer token's claims (roles=["admin"] -> 15). Feature 092 removed the old hardcoded
    # ("x-access-scope", "7") tuple, so every management tool now forwards the caller's real scope
    # end-to-end exactly like this.
    assert mock_set.await_args.kwargs["access_scope"] == 15

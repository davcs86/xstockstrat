"""Agent routes by mode over the real ASGI app (feature 345, design § 2 "Routes by mode")."""

import json
from pathlib import Path
from unittest.mock import AsyncMock, patch

import grpc
import jwt
import pytest
from starlette.responses import Response
from starlette.testclient import TestClient

from app import client, oauth_metadata
from app.scopes import MCP_CLAIMS_SCOPE_KEY
from tests.conftest import _rpc_error

VECTORS = json.loads(
    (
        Path(__file__).resolve().parents[3] / "scripts" / "testdata" / "oidc-issuer-vectors.json"
    ).read_text(encoding="utf-8")
)
_HEADERS = {"Accept": "application/json, text/event-stream", "Content-Type": "application/json"}
_INIT = {
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
        "protocolVersion": "2025-06-18",
        "capabilities": {},
        "clientInfo": {"name": "test", "version": "0"},
    },
}
TRADER = {"user_id": "u-resolved", "roles": ["trader"], "is_active": True}


def _app():
    from app.main import build_http_app  # noqa: PLC0415

    return build_http_app()


def _sse_json(body: str) -> dict:
    for line in body.splitlines():
        if line.startswith("data: "):
            return json.loads(line[len("data: ") :])
    raise AssertionError(f"no SSE data line found in: {body!r}")


@pytest.fixture
def resolve(monkeypatch):
    mock = AsyncMock(return_value=dict(TRADER))
    monkeypatch.setattr(client, "resolve_external_identity", mock)
    return mock


@pytest.fixture
def captured():
    """Replace the MCP session manager so a request that passes the gate records its claims."""
    seen: list = []

    async def _capture(_self, scope, receive, send):
        seen.append(scope["state"][MCP_CLAIMS_SCOPE_KEY])
        await Response("ok")(scope, receive, send)

    with patch(
        "mcp.server.streamable_http_manager.StreamableHTTPSessionManager.handle_request", _capture
    ):
        yield seen


def _bearer(token):
    return dict(_HEADERS, Authorization=f"Bearer {token}")


def test_ac22_valid_token_runs_a_tool_as_the_resolved_user(oidc_mode, resolve, hung_backend):
    """@AC-22: x-user-id is the resolved id, never `sub`; scope trader & read write = 3."""
    from gen.analysis.v1 import analysis_pb2  # noqa: PLC0415

    handle = hung_backend(
        "ANALYSIS_ENDPOINT",
        answers={"ListStrategyDefinitions": (0, analysis_pb2.ListStrategyDefinitionsResponse())},
    )
    resolve_mock = AsyncMock(return_value=dict(TRADER))
    with (
        patch.object(client, "resolve_external_identity", resolve_mock),
        TestClient(_app()) as tc,
    ):
        headers = _bearer(oidc_mode.token())
        init = tc.post("/", json=_INIT, headers=headers)
        assert init.status_code == 200
        headers["mcp-session-id"] = init.headers["mcp-session-id"]
        tc.post(
            "/", json={"jsonrpc": "2.0", "method": "notifications/initialized"}, headers=headers
        )
        call = tc.post(
            "/",
            json={
                "jsonrpc": "2.0",
                "id": 2,
                "method": "tools/call",
                "params": {"name": "list_strategies", "arguments": {}},
            },
            headers=headers,
        )
    assert call.status_code == 200
    assert _sse_json(call.text)["result"]["isError"] is False
    method, md = handle.calls[-1]
    assert method == "ListStrategyDefinitions"
    assert md["x-user-id"] == "u-resolved"
    assert md["x-access-scope"] == "3"
    assert "sso-subject-1" not in md.values()


@pytest.mark.parametrize("detail", ["account inactive", "not linked"])
def test_ac21_ac30_refusals_are_403_text_plain(oidc_mode, resolve, captured, detail):
    """@AC-21 @AC-30"""
    resolve.side_effect = _rpc_error(grpc.StatusCode.FAILED_PRECONDITION, detail)
    with TestClient(_app()) as tc:
        r = tc.post("/", json=_INIT, headers=_bearer(oidc_mode.token()))
    assert r.status_code == 403
    assert r.headers["content-type"].startswith("text/plain")
    assert r.text == detail
    assert "www-authenticate" not in r.headers
    assert captured == []


def test_ac11_ac49_prm_equals_the_vector(oidc_mode, monkeypatch):
    """@AC-11 @AC-49 (agent PRM)"""
    prm = VECTORS["prm"]
    monkeypatch.setattr(oauth_metadata, "AGENT_PUBLIC_URL", prm["agent_public_url"])
    oidc_mode.install("agent", **{"oidc.issuer": prm["issuer"]})
    with TestClient(_app()) as tc:
        r = tc.get("/.well-known/oauth-protected-resource")
    assert r.status_code == 200
    assert r.json() == prm["expected"]


def test_prm_in_local_is_unchanged():
    with TestClient(_app()) as tc:
        body = tc.get("/.well-known/oauth-protected-resource").json()
    assert body == {
        "resource": oauth_metadata.AGENT_PUBLIC_URL,
        "authorization_servers": [oauth_metadata.AGENT_PUBLIC_URL],
    }


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("get", "/.well-known/oauth-authorization-server"),
        ("post", "/oauth/register"),
        ("get", "/oauth/authorize"),
        ("get", "/oauth/callback"),
        ("post", "/oauth/token"),
    ],
)
def test_ac43_legacy_oauth_routes_are_404_in_oidc(oidc_mode, method, path):
    """@AC-43"""
    with TestClient(_app()) as tc:
        r = getattr(tc, method)(path)
    assert r.status_code == 404
    assert r.headers["content-type"].startswith("text/plain")


def test_ac43_identity_hs256_token_is_401_in_oidc(oidc_mode, resolve, captured):
    """@AC-43: an identity-issued token is never accepted in oidc."""
    token = jwt.encode(oidc_mode.claims(), "identity-hs256-secret-32-bytes-long", algorithm="HS256")
    validate = AsyncMock()
    with patch("app.auth.validate_bearer_claims", validate), TestClient(_app()) as tc:
        r = tc.post("/", json=_INIT, headers=_bearer(token))
    assert r.status_code == 401
    assert "resource_metadata=" in r.headers["www-authenticate"]
    validate.assert_not_awaited()
    assert captured == []


def test_missing_bearer_is_401_in_oidc(oidc_mode, captured):
    with TestClient(_app()) as tc:
        r = tc.post("/", json=_INIT, headers=_HEADERS)
    assert r.status_code == 401
    assert "resource_metadata=" in r.headers["www-authenticate"]


def test_ac55_invalid_agent_issuer_is_503_everywhere(oidc_mode, resolve, captured):
    """@AC-55"""
    oidc_mode.install("agent", **{"oidc.issuer": "http://auth.example.test"})
    with TestClient(_app()) as tc:
        mcp = tc.post("/", json=_INIT, headers=_bearer(oidc_mode.token()))
        no_bearer = tc.post("/", json=_INIT, headers=_HEADERS)
        prm = tc.get("/.well-known/oauth-protected-resource")
    for r in (mcp, no_bearer):
        assert r.status_code == 503
        assert "www-authenticate" not in r.headers
    assert prm.status_code == 503
    assert prm.headers["cache-control"] == "no-store"
    assert prm.headers["content-type"].startswith("text/plain")
    resolve.assert_not_awaited()
    assert captured == []


def _validate_identity_only(token, trace_id):
    if token == "identity.jwt":
        return {"user_id": "u-local", "roles": ["viewer"], "aud": "x"}
    return None


def test_ac32_both_uses_identity_tokens_only(oidc_mode, resolve, captured):
    """@AC-32"""
    oidc_mode.install("identity", **{"auth.mode": "both"})
    validate = AsyncMock(side_effect=_validate_identity_only)
    with patch("app.auth.validate_bearer_claims", validate), TestClient(_app()) as tc:
        ok = tc.post("/", json=_INIT, headers=_bearer("identity.jwt"))
        sso = tc.post("/", json=_INIT, headers=_bearer(oidc_mode.token()))
    assert ok.status_code == 200
    assert sso.status_code == 401
    assert validate.await_count == 2
    resolve.assert_not_awaited()
    assert [c["user_id"] for c in captured] == ["u-local"]


def test_ac32_both_keeps_the_legacy_oauth_routes(oidc_mode):
    oidc_mode.install("identity", **{"auth.mode": "both"})
    with TestClient(_app()) as tc:
        r = tc.get("/.well-known/oauth-authorization-server")
    assert r.status_code == 200


def test_ac44_ac71_mode_change_applies_to_the_next_request(oidc_mode, resolve, captured):
    """@AC-44 @AC-71 (agent leg). (guard) the 60 s delivery is the config watch itself."""
    validate = AsyncMock(side_effect=_validate_identity_only)
    with patch("app.auth.validate_bearer_claims", validate), TestClient(_app()) as tc:
        in_oidc = tc.post("/", json=_INIT, headers=_bearer("identity.jwt"))
        oidc_mode.install("identity", **{"auth.mode": "local"})
        in_local = tc.post("/", json=_INIT, headers=_bearer("identity.jwt"))
    assert in_oidc.status_code == 401
    assert in_local.status_code == 200
    assert validate.await_count == 1
    assert [c["user_id"] for c in captured] == ["u-local"]

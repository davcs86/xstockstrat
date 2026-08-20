"""Tests for the agent OAuth 2.1 HTTP facade (feature 049 Part B).

Exercises the discovery metadata, the removed-transport 404s, the surviving Streamable HTTP
401+WWW-Authenticate, DCR, authorize validation, and the token endpoint via Starlette's TestClient
against build_http_app(). All identity gRPC calls are mocked at the app.client / app.auth boundary.
"""

from unittest.mock import AsyncMock, patch

import pytest
from starlette.testclient import TestClient

from app import client


def _app():
    from app.main import build_http_app  # noqa: PLC0415

    return build_http_app()


# ── discovery metadata (AC-B1) ──────────────────────────────────────────────


def test_protected_resource_metadata():
    with TestClient(_app()) as tc:
        r = tc.get("/.well-known/oauth-protected-resource")
    assert r.status_code == 200
    body = r.json()
    assert "resource" in body
    assert isinstance(body["authorization_servers"], list)


def test_authorization_server_metadata():
    with TestClient(_app()) as tc:
        r = tc.get("/.well-known/oauth-authorization-server")
    assert r.status_code == 200
    body = r.json()
    assert body["code_challenge_methods_supported"] == ["S256"]
    assert "authorization_code" in body["grant_types_supported"]
    assert "refresh_token" in body["grant_types_supported"]
    assert body["token_endpoint"].endswith("/oauth/token")


# ── removed HTTP+SSE transport boundary (feature 079, AC-1/AC-3) ────────────
#
# The legacy transport's two paths must 404 before the auth gate. Asserting the status code
# alone would be weak -- a misconfigured app also 404s. Each case therefore also asserts the
# body names the replacement URL, and the unauthenticated case asserts the ABSENCE of the
# www-authenticate header: a fall-through to _authorized would carry it, so its absence is what
# proves the 404 branch exists and precedes the gate.


def test_sse_path_404_names_replacement_url():
    import app.main as main_mod

    with TestClient(_app()) as tc:
        r = tc.get("/sse")
    assert r.status_code == 404
    assert main_mod.AGENT_PUBLIC_URL in r.text
    assert "removed" in r.text
    assert "www-authenticate" not in r.headers


def test_messages_path_404_even_with_credential():
    """404 with a Bearer header and no claims mock — proving the branch precedes the gate.

    If the 404 sat *after* _authorized, an unmocked validator would reject this request with a
    401 instead. Together with the case above this is AC-1's "with or without an Authorization
    header", and with AC-3 it shows no tools/call can reach a tool through a removed path.
    """
    import app.main as main_mod

    with TestClient(_app()) as tc:
        r = tc.post("/messages", headers={"Authorization": "Bearer good.jwt"})
    assert r.status_code == 404
    assert main_mod.AGENT_PUBLIC_URL in r.text
    assert r.headers["content-type"].startswith("text/plain")


def test_messages_trailing_slash_and_query_404():
    """Pins the rstrip("/") normalization and that the query string is not part of scope path."""
    import app.main as main_mod

    with TestClient(_app()) as tc:
        r = tc.post("/messages/?session_id=abc")
    assert r.status_code == 404
    assert main_mod.AGENT_PUBLIC_URL in r.text


# ── Streamable HTTP transport at root (Claude.ai remote connector) ──────────


def test_streamable_root_unauthenticated_401_with_www_authenticate():
    """Claude.ai POSTs the connector URL (→ `/`) with Streamable HTTP; unauthenticated → 401."""
    with TestClient(_app()) as tc:
        r = tc.post("/", json={"jsonrpc": "2.0", "id": 1, "method": "initialize"})
    assert r.status_code == 401
    assert "resource_metadata=" in r.headers.get("www-authenticate", "")


def test_streamable_root_accepts_valid_credential_reaching_transport():
    """A credential that passes the auth gate proceeds to the Streamable HTTP session manager."""

    class _Sentinel(Exception):
        pass

    def _boom(*_a, **_k):
        raise _Sentinel()

    with (
        patch(
            "app.auth.validate_bearer_claims",
            AsyncMock(return_value={"user_id": "u-1", "roles": ["admin"], "aud": "x"}),
        ),
        patch(
            "mcp.server.streamable_http_manager.StreamableHTTPSessionManager.handle_request",
            _boom,
        ),
    ):
        app = _app()
        with pytest.raises(_Sentinel):
            with TestClient(app) as tc:
                tc.post(
                    "/",
                    json={"jsonrpc": "2.0", "id": 1, "method": "initialize"},
                    headers={"Authorization": "Bearer good.jwt"},
                )


# ── DCR /oauth/register (AC-B3 surface) ─────────────────────────────────────


def test_register_returns_client_id():
    with (
        patch.object(client, "get_config_value", AsyncMock(return_value=None)),
        patch.object(
            client,
            "register_oauth_client",
            AsyncMock(return_value={"client_id": "oauthc_x", "redirect_uris": ["https://a/cb"]}),
        ),
    ):
        with TestClient(_app()) as tc:
            r = tc.post(
                "/oauth/register",
                json={"redirect_uris": ["https://a/cb"], "client_name": "x"},
            )
    assert r.status_code == 201
    assert r.json()["client_id"] == "oauthc_x"


def test_register_rejects_non_https():
    with patch.object(client, "get_config_value", AsyncMock(return_value=None)):
        with TestClient(_app()) as tc:
            r = tc.post("/oauth/register", json={"redirect_uris": ["http://a/cb"]})
    assert r.status_code == 400


def test_register_disabled_returns_403():
    async def _cfg(key, *, namespace, environment, user_id=""):
        # feature 093: the DCR reads are env-scoped in the agent namespace.
        assert namespace == "agent"
        assert environment in ("staging", "production")
        return "false" if key == "oauth.registration_enabled" else None

    with patch.object(client, "get_config_value", _cfg):
        with TestClient(_app()) as tc:
            r = tc.post("/oauth/register", json={"redirect_uris": ["https://a/cb"]})
    assert r.status_code == 403


def test_register_survives_config_read_failure():
    """feature 093: a config transport error must NOT 500 DCR — registration defaults to enabled
    and an empty allowlist (best-effort reads), so a valid https client still registers."""
    import grpc

    err = grpc.aio.AioRpcError(grpc.StatusCode.UNAVAILABLE, None, None, details="config down")
    with (
        patch.object(client, "get_config_value", AsyncMock(side_effect=err)),
        patch.object(
            client,
            "register_oauth_client",
            AsyncMock(return_value={"client_id": "oauthc_y", "redirect_uris": ["https://a/cb"]}),
        ),
    ):
        with TestClient(_app()) as tc:
            r = tc.post("/oauth/register", json={"redirect_uris": ["https://a/cb"]})
    assert r.status_code == 201
    assert r.json()["client_id"] == "oauthc_y"


# ── /oauth/authorize validation (AC-B3) ─────────────────────────────────────


def test_authorize_requires_s256():
    with TestClient(_app()) as tc:
        r = tc.get(
            "/oauth/authorize",
            params={
                "response_type": "code",
                "code_challenge_method": "plain",
                "client_id": "c",
                "redirect_uri": "https://a/cb",
                "code_challenge": "abc",
                "state": "s",
            },
            follow_redirects=False,
        )
    assert r.status_code == 400


def test_authorize_rejects_redirect_mismatch():
    with patch.object(
        client,
        "get_oauth_client",
        AsyncMock(return_value={"client_id": "c", "redirect_uris": ["https://a/other"]}),
    ):
        with TestClient(_app()) as tc:
            r = tc.get(
                "/oauth/authorize",
                params={
                    "response_type": "code",
                    "code_challenge_method": "S256",
                    "client_id": "c",
                    "redirect_uri": "https://a/cb",
                    "code_challenge": "abc",
                    "state": "s",
                },
                follow_redirects=False,
            )
    assert r.status_code == 400


# ── /oauth/token grants (AC-B2, AC-B5) ──────────────────────────────────────


def test_token_authorization_code_invalid_grant():
    with patch.object(client, "exchange_auth_code", AsyncMock(side_effect=Exception("bad pkce"))):
        with TestClient(_app()) as tc:
            r = tc.post(
                "/oauth/token",
                data={
                    "grant_type": "authorization_code",
                    "code": "c",
                    "code_verifier": "wrong",
                    "redirect_uri": "https://a/cb",
                    "client_id": "c",
                },
            )
    assert r.status_code == 400
    assert r.json()["error"] == "invalid_grant"


def test_token_refresh_returns_new_pair():
    returned = {
        "access_token": "new-at",
        "token_type": "Bearer",
        "expires_in": 900,
        "refresh_token": "new-rt",
    }
    with patch.object(client, "refresh_oauth_token", AsyncMock(return_value=returned)):
        with TestClient(_app()) as tc:
            r = tc.post(
                "/oauth/token",
                data={"grant_type": "refresh_token", "refresh_token": "old", "resource": "r"},
            )
    assert r.status_code == 200
    assert r.json()["access_token"] == "new-at"
    assert r.json()["refresh_token"] == "new-rt"


def test_token_unsupported_grant():
    with TestClient(_app()) as tc:
        r = tc.post("/oauth/token", data={"grant_type": "client_credentials"})
    assert r.status_code == 400
    assert r.json()["error"] == "unsupported_grant_type"


# ── Feature 147: OAuth txn signed with JWT_SECRET, MCP_AGENT_SECRET removed ──


def test_txn_roundtrips_under_jwt_secret():
    """AC-9: a txn signed with JWT_SECRET verifies back to the same payload."""
    from app.oauth_server import _sign_txn, _verify_txn

    data = {"client_id": "c-1", "redirect_uri": "https://app.example/cb", "scope": "read"}
    txn = _sign_txn(data)
    assert _verify_txn(txn) == data


def test_txn_tampered_one_byte_is_rejected():
    """AC-9: flipping a single character of the signed payload fails verification."""
    from app.oauth_server import _sign_txn, _verify_txn

    txn = _sign_txn({"client_id": "c-1"})
    payload, sig = txn.rsplit(".", 1)
    tampered_payload = ("A" if payload[0] != "A" else "B") + payload[1:]
    assert _verify_txn(f"{tampered_payload}.{sig}") is None


def test_txn_signed_with_a_different_key_is_rejected(monkeypatch):
    """AC-9: a txn signed under one key does not verify under another (shared-key requirement)."""
    from app import oauth_server

    txn = oauth_server._sign_txn({"client_id": "c-1"})
    monkeypatch.setattr(oauth_server, "JWT_SECRET", "a-different-secret")
    assert oauth_server._verify_txn(txn) is None


def test_no_operative_mcp_agent_secret_in_app_code():
    """AC-8: no app/ module reads or assigns MCP_AGENT_SECRET (a naming comment is allowed)."""
    import pathlib

    app_dir = pathlib.Path(__file__).resolve().parent.parent / "app"
    offenders = []
    for py in app_dir.rglob("*.py"):
        for i, line in enumerate(py.read_text().splitlines(), 1):
            if "MCP_AGENT_SECRET" in line and not line.lstrip().startswith("#"):
                offenders.append(f"{py.name}:{i}: {line.strip()}")
    assert offenders == [], f"MCP_AGENT_SECRET still used operatively: {offenders}"

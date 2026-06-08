"""Tests for the agent OAuth 2.1 HTTP facade (feature 049 Part B).

Exercises the discovery metadata, /sse 401+WWW-Authenticate, DCR, authorize validation, and the
token endpoint via Starlette's TestClient against build_sse_app(). All identity gRPC calls are
mocked at the app.client / app.auth boundary.
"""

from unittest.mock import AsyncMock, patch

import pytest
from starlette.testclient import TestClient

from app import client


def _app():
    from app.main import build_sse_app  # noqa: PLC0415

    return build_sse_app()


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


# ── /sse auth boundary (AC-B0, AC-B4, AC-B7) ────────────────────────────────


def test_sse_unauthenticated_401_with_www_authenticate():
    with TestClient(_app()) as tc:
        r = tc.get("/sse")
    assert r.status_code == 401
    assert "resource_metadata=" in r.headers.get("www-authenticate", "")


def test_sse_accepts_valid_credential_reaching_transport():
    """A credential that passes the auth gate proceeds to the SSE transport.

    We patch the auth validators to accept and the SSE transport to raise a sentinel, then assert
    the request reaches the transport (i.e. it was NOT rejected at the 401 gate).
    """

    class _Sentinel(Exception):
        pass

    def _boom(*_a, **_k):
        raise _Sentinel()

    with (
        patch("app.auth.validate_bearer_jwt", AsyncMock(return_value=True)),
        patch("mcp.server.sse.SseServerTransport.connect_sse", _boom),
    ):
        app = _app()
        with pytest.raises(_Sentinel):
            with TestClient(app) as tc:
                tc.get("/sse", headers={"Authorization": "Bearer good.jwt"})


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
        patch("app.auth.validate_bearer_jwt", AsyncMock(return_value=True)),
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
    async def _cfg(key):
        return "false" if key == "oauth.registration_enabled" else None

    with patch.object(client, "get_config_value", _cfg):
        with TestClient(_app()) as tc:
            r = tc.post("/oauth/register", json={"redirect_uris": ["https://a/cb"]})
    assert r.status_code == 403


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

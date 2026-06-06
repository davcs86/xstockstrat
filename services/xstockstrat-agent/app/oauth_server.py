"""
OAuth 2.1 Authorization-Server HTTP facade for the MCP agent (feature 049 Part B).

The agent is a stateless AS/RS facade: all durable OAuth state (clients, auth codes, refresh
tokens) lives in xstockstrat-identity and is reached over gRPC via app.client. Cross-request
authorization state is carried in an HMAC-signed `txn` blob in URLs (no in-memory store), so the
agent is multi-instance-safe (FR-B13).

Endpoints:
  POST /oauth/register   — RFC 7591 Dynamic Client Registration (public client, no secret)
  GET  /oauth/authorize  — start the authorization-code + PKCE flow; delegate login to the UI
  GET  /oauth/callback   — post-login callback; derive user from the session cookie, mint code
  POST /oauth/token      — authorization_code + refresh_token grants
"""

import base64
import hashlib
import hmac
import json
import logging
import os
from urllib.parse import quote

from starlette.responses import JSONResponse, RedirectResponse

from app import client

log = logging.getLogger(__name__)

UI_BASE_URL = os.environ.get("UI_BASE_URL", "http://localhost:3000")
AGENT_PUBLIC_URL = os.environ.get("AGENT_PUBLIC_URL", "http://localhost:9000")
MCP_AGENT_SECRET = os.environ.get("MCP_AGENT_SECRET", "")


def _sign_txn(data: dict) -> str:
    """Encode + HMAC-sign an authorization-request transaction blob (keeps the agent stateless).

    Format: base64url(json).hex(hmac_sha256(payload)). Signed with MCP_AGENT_SECRET.
    """
    payload = base64.urlsafe_b64encode(json.dumps(data, separators=(",", ":")).encode()).decode()
    sig = hmac.new(MCP_AGENT_SECRET.encode(), payload.encode(), hashlib.sha256).hexdigest()
    return f"{payload}.{sig}"


def _verify_txn(txn: str) -> dict | None:
    """Verify a `txn` blob's HMAC and return the decoded dict, or None if invalid."""
    try:
        payload, sig = txn.rsplit(".", 1)
    except ValueError:
        return None
    expected = hmac.new(MCP_AGENT_SECRET.encode(), payload.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(sig, expected):
        return None
    try:
        return json.loads(base64.urlsafe_b64decode(payload.encode()).decode())
    except Exception:
        return None


async def register(request):
    """POST /oauth/register — RFC 7591 DCR. Public client, returns client_id (no secret)."""
    try:
        body = await request.json()
    except Exception:
        return JSONResponse(
            {"error": "invalid_request", "error_description": "invalid JSON body"}, 400
        )

    # agent.oauth.registration_enabled (bool, default true). Disabled => 403.
    reg_enabled = await client.get_config_value("oauth.registration_enabled")
    if reg_enabled is not None and reg_enabled.strip().lower() in ("false", "0", "no"):
        return JSONResponse(
            {"error": "access_denied", "error_description": "registration disabled"}, 403
        )

    redirect_uris = body.get("redirect_uris") or []
    client_name = body.get("client_name", "")
    if not isinstance(redirect_uris, list) or not redirect_uris:
        return JSONResponse(
            {"error": "invalid_redirect_uri", "error_description": "redirect_uris required"}, 400
        )

    # agent.oauth.allowed_redirect_uris (comma-separated exact URIs). When set, require an exact
    # match; otherwise fall back to the https:// minimum (identity enforces the same).
    allowed_raw = await client.get_config_value("oauth.allowed_redirect_uris")
    allowlist = [u.strip() for u in allowed_raw.split(",")] if allowed_raw else []
    allowlist = [u for u in allowlist if u]
    for uri in redirect_uris:
        if not isinstance(uri, str):
            return JSONResponse(
                {"error": "invalid_redirect_uri", "error_description": "invalid redirect_uri"}, 400
            )
        if allowlist:
            if uri not in allowlist:
                return JSONResponse(
                    {
                        "error": "invalid_redirect_uri",
                        "error_description": "redirect_uri not in allowlist",
                    },
                    400,
                )
        elif not uri.startswith("https://"):
            return JSONResponse(
                {
                    "error": "invalid_redirect_uri",
                    "error_description": "redirect_uris must be https",
                },
                400,
            )

    try:
        result = await client.register_oauth_client(redirect_uris, client_name)
    except Exception as e:
        log.error("DCR failed: %s", e)
        return JSONResponse({"error": "server_error"}, 500)

    return JSONResponse(
        {"client_id": result["client_id"], "redirect_uris": result["redirect_uris"]}, 201
    )


async def authorize(request):
    """GET /oauth/authorize — validate the request, then delegate login to the UI.

    Enforces response_type=code, PKCE S256, a registered client, and an exact redirect-URI
    match (no wildcard). On success, 302-redirects to the unified UI login page carrying the
    agent callback URL, state, and an HMAC-signed `txn` blob so the agent stays stateless.
    Validation failures return 400 (never redirect to an unvalidated redirect_uri).
    """
    p = request.query_params
    if p.get("response_type") != "code":
        return JSONResponse({"error": "unsupported_response_type"}, 400)
    if p.get("code_challenge_method") != "S256":
        return JSONResponse({"error": "invalid_request", "error_description": "S256 required"}, 400)
    client_id = p.get("client_id", "")
    redirect_uri = p.get("redirect_uri", "")
    code_challenge = p.get("code_challenge", "")
    state = p.get("state", "")
    resource = p.get("resource", "")
    if not client_id or not redirect_uri or not code_challenge:
        return JSONResponse(
            {"error": "invalid_request", "error_description": "missing required parameter"}, 400
        )
    try:
        oauth_client = await client.get_oauth_client(client_id)
    except Exception:
        return JSONResponse({"error": "invalid_client"}, 400)
    if redirect_uri not in oauth_client["redirect_uris"]:
        return JSONResponse(
            {"error": "invalid_request", "error_description": "redirect_uri mismatch"}, 400
        )

    txn = _sign_txn(
        {
            "client_id": client_id,
            "redirect_uri": redirect_uri,
            "code_challenge": code_challenge,
            "resource": resource,
            "state": state,
        }
    )
    agent_cb = f"{AGENT_PUBLIC_URL}/oauth/callback"
    login_url = (
        f"{UI_BASE_URL}/auth/oauth-login"
        f"?agent_cb={quote(agent_cb, safe='')}"
        f"&txn={quote(txn, safe='')}"
        f"&state={quote(state, safe='')}"
    )
    return RedirectResponse(login_url, status_code=302)


async def callback(request):
    """GET /oauth/callback — derive the user from the same-origin session cookie (never a query
    param), then mint an authorization code and redirect back to the client.
    """
    txn = request.query_params.get("txn", "")
    state = request.query_params.get("state", "")
    data = _verify_txn(txn)
    if data is None or data.get("state") != state:
        return JSONResponse({"error": "invalid_request", "error_description": "bad txn"}, 400)

    # Authentication rides along as the same-origin httpOnly access_token cookie (the agent never
    # trusts a query-param user id). If absent, send the browser back to the UI to log in.
    access_token = request.cookies.get("access_token")
    login_url = (
        f"{UI_BASE_URL}/auth/oauth-login"
        f"?agent_cb={quote(AGENT_PUBLIC_URL + '/oauth/callback', safe='')}"
        f"&txn={quote(txn, safe='')}"
        f"&state={quote(state, safe='')}"
    )
    if not access_token:
        return RedirectResponse(login_url, status_code=302)
    try:
        claims = await client.validate_token(access_token)
    except Exception:
        return RedirectResponse(login_url, status_code=302)
    user_id = claims.get("user_id")
    if not user_id:
        return RedirectResponse(login_url, status_code=302)

    try:
        code = await client.issue_auth_code(
            user_id,
            data["client_id"],
            data["redirect_uri"],
            data["code_challenge"],
            data.get("resource", ""),
        )
    except Exception as e:
        log.error("issue_auth_code failed: %s", e)
        return JSONResponse({"error": "server_error"}, 500)

    sep = "&" if "?" in data["redirect_uri"] else "?"
    target = f"{data['redirect_uri']}{sep}code={quote(code, safe='')}&state={quote(state, safe='')}"
    return RedirectResponse(target, status_code=302)


async def token(request):
    """POST /oauth/token — authorization_code and refresh_token grants.

    Tokens are returned only in the JSON body (never in a query string — FR-B7).
    """
    form = await request.form()
    grant_type = form.get("grant_type", "")

    if grant_type == "authorization_code":
        try:
            result = await client.exchange_auth_code(
                form.get("code", ""),
                form.get("code_verifier", ""),
                form.get("redirect_uri", ""),
                form.get("client_id", ""),
                form.get("resource", ""),
            )
        except Exception:
            return JSONResponse({"error": "invalid_grant"}, 400)
        return JSONResponse(result)

    if grant_type == "refresh_token":
        try:
            result = await client.refresh_oauth_token(
                form.get("refresh_token", ""), form.get("resource", "")
            )
        except Exception:
            return JSONResponse({"error": "invalid_grant"}, 400)
        return JSONResponse(result)

    return JSONResponse({"error": "unsupported_grant_type"}, 400)

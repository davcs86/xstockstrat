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

import logging

from starlette.responses import JSONResponse

from app import client

log = logging.getLogger(__name__)


async def register(request):
    """POST /oauth/register — RFC 7591 DCR. Public client, returns client_id (no secret)."""
    try:
        body = await request.json()
    except Exception:
        return JSONResponse(
            {"error": "invalid_request", "error_description": "invalid JSON body"}, 400
        )

    redirect_uris = body.get("redirect_uris") or []
    client_name = body.get("client_name", "")
    if not isinstance(redirect_uris, list) or not redirect_uris:
        return JSONResponse(
            {"error": "invalid_redirect_uri", "error_description": "redirect_uris required"}, 400
        )
    # Enforce https:// at the edge too (identity enforces the same minimum / allowlist).
    for uri in redirect_uris:
        if not isinstance(uri, str) or not uri.startswith("https://"):
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

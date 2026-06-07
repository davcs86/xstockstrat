"""
OAuth 2.1 discovery metadata endpoints for the MCP agent (feature 049 Part B).

Serves the two well-known documents a spec-compliant MCP client fetches before connecting:
  - RFC 9728 OAuth 2.0 Protected Resource Metadata (/.well-known/oauth-protected-resource)
  - RFC 8414 OAuth 2.0 Authorization Server Metadata (/.well-known/oauth-authorization-server)

The agent is both the Resource Server and the Authorization-Server HTTP facade, so both
documents point at AGENT_PUBLIC_URL.
"""

import os

from starlette.responses import JSONResponse

AGENT_PUBLIC_URL = os.environ.get("AGENT_PUBLIC_URL", "http://localhost:9000")


async def protected_resource_metadata(request):
    """RFC 9728 — the protected resource (the agent /sse endpoint) and its auth server."""
    return JSONResponse(
        {
            "resource": AGENT_PUBLIC_URL,
            "authorization_servers": [AGENT_PUBLIC_URL],
        }
    )


async def authorization_server_metadata(request):
    """RFC 8414 — the agent's OAuth 2.1 authorization-server endpoints + capabilities."""
    return JSONResponse(
        {
            "issuer": AGENT_PUBLIC_URL,
            "authorization_endpoint": f"{AGENT_PUBLIC_URL}/oauth/authorize",
            "token_endpoint": f"{AGENT_PUBLIC_URL}/oauth/token",
            "registration_endpoint": f"{AGENT_PUBLIC_URL}/oauth/register",
            "code_challenge_methods_supported": ["S256"],
            "response_types_supported": ["code"],
            "grant_types_supported": ["authorization_code", "refresh_token"],
        }
    )

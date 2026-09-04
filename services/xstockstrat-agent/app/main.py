"""
xstockstrat-agent — MCP server entry point.

Transport is selected via MCP_TRANSPORT env var:
  stdio  (default) -- launched directly by a local MCP client
  http             -- Streamable HTTP for remote MCP connections on MCP_HTTP_PORT (default 9000)

`MCP_TRANSPORT=sse` is a deprecated alias for `http`: it starts the same server and logs a
warning. The legacy HTTP+SSE transport it used to name (GET /sse + POST /messages) was removed
by feature 079 -- those paths now return 404. `MCP_SSE_PORT` is likewise a deprecated fallback
for `MCP_HTTP_PORT`.

The HTTP transport requires an OAuth 2.1 audience-bound access JWT presented as
  - Authorization: Bearer <jwt>
validated against xstockstrat-identity ValidateToken gRPC RPC (aud must match AGENT_PUBLIC_URL).
Returns HTTP 401 on failure.
"""

import asyncio
import logging
import os

from mcp.server.mcpserver import MCPServer

from app.scopes import MCP_CLAIMS_SCOPE_KEY
from app.tools import register_tools

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger(__name__)

# Match these exactly, never as a prefix: handle_mcp is mounted at root, so a prefix match would
# reserve /sse* and /messages* from the Streamable HTTP fall-through.
REMOVED_TRANSPORT_PATHS = ("/sse", "/messages")


def resolve_transport() -> str:
    """Canonical MCP_TRANSPORT. `sse` is a deprecated alias for `http` (feature 079)."""
    raw = os.environ.get("MCP_TRANSPORT", "stdio")
    if raw == "sse":
        log.warning(
            "MCP_TRANSPORT=sse is deprecated and now selects the Streamable HTTP "
            "transport; set MCP_TRANSPORT=http"
        )
        return "http"
    if raw not in ("stdio", "http"):
        # The agent has no HTTP healthcheck (only a TCP probe on 9000), so an unrecognized value
        # would serve nothing with no diagnostic — hence this warning before the stdio fall-through.
        log.warning("MCP_TRANSPORT=%r is not recognized; falling back to stdio", raw)
    return raw


def resolve_http_port() -> int:
    """Port for the HTTP server. MCP_SSE_PORT is the deprecated fallback (feature 079)."""
    deprecated = os.environ.get("MCP_SSE_PORT")
    return int(os.environ.get("MCP_HTTP_PORT") or deprecated or "9000")


UI_BASE_URL = os.environ.get("UI_BASE_URL", "http://localhost:3000")
# In DO this is ${APP_URL}/agent (stripped to / by ingress); docker-compose uses localhost:9000.
AGENT_PUBLIC_URL = os.environ.get("AGENT_PUBLIC_URL", "http://localhost:9000")


def create_server() -> MCPServer:
    server = MCPServer("xstockstrat-agent")
    register_tools(server)
    return server


async def _run_stdio() -> None:
    server = create_server()
    log.info("xstockstrat-agent starting (transport=stdio)")
    await server.run_stdio_async()


def build_http_app():
    """Construct the Starlette app for the Streamable HTTP transport + OAuth 2.1 HTTP facade.

    Extracted into a factory so tests can exercise the routes via Starlette's test client
    without binding a real socket.
    """
    from contextlib import asynccontextmanager

    from mcp.server.transport_security import TransportSecuritySettings
    from starlette.applications import Starlette
    from starlette.responses import JSONResponse, Response
    from starlette.routing import Mount, Route

    from app.auth import validate_bearer_claims
    from app.oauth_metadata import (
        authorization_server_metadata,
        protected_resource_metadata,
    )
    from app.oauth_server import authorize as oauth_authorize
    from app.oauth_server import callback as oauth_callback
    from app.oauth_server import register as oauth_register
    from app.oauth_server import token as oauth_token

    server = create_server()

    async def list_tools_metadata(_request):
        """Tool catalog for the UI's "MCP Tools" page — name/description/inputSchema only.

        Unauthenticated like the .well-known discovery routes: it describes capabilities (the
        same data published in docs/runbooks/mcp-tools.md), never user data or credentials, and
        the UI's BFF has no MCP-audience-bound token to present here anyway.
        """
        tools = await server.list_tools()
        return JSONResponse(
            {
                "tools": [
                    {
                        "name": t.name,
                        "description": t.description or "",
                        "inputSchema": t.input_schema,
                    }
                    for t in tools
                ]
            }
        )

    # Prime the SDK session manager (its returned app is discarded; handle_mcp dispatches instead).
    # transport_security off: the default DNS-rebinding check 421s every non-localhost request; the
    # real gate is _authorized's aud-bound JWT, which runs before the session manager.
    server.streamable_http_app(
        streamable_http_path="/",
        transport_security=TransportSecuritySettings(enable_dns_rebinding_protection=False),
    )
    session_manager = server.session_manager

    async def _authorized(scope) -> bool:
        """OAuth 2.1 gate for the Streamable HTTP transport.

        Requires an aud-bound JWT presented as `Authorization: Bearer <jwt>` (a token whose aud is
        wrong is rejected — FR-B8).
        """
        headers = dict(scope.get("headers", []))
        auth_header = headers.get(b"authorization", b"").decode("utf-8", errors="ignore")
        token = auth_header[len("Bearer ") :] if auth_header.startswith("Bearer ") else ""
        if not token:
            return False
        claims = await validate_bearer_claims(token)
        if claims is None:
            return False
        # Stamp verified claims on the request scope (tools read them via ctx...request.scope); the
        # dict dies with the scope, so the agent stays stateless and multi-instance safe.
        scope.setdefault("state", {})[MCP_CLAIMS_SCOPE_KEY] = claims
        return True

    async def _send_unauthorized(scope, receive, send) -> None:
        response = Response(
            "Unauthorized",
            status_code=401,
            headers={
                "WWW-Authenticate": (
                    "Bearer resource_metadata="
                    f'"{AGENT_PUBLIC_URL}/.well-known/oauth-protected-resource"'
                )
            },
        )
        await response(scope, receive, send)

    async def _send_transport_removed(scope, receive, send) -> None:
        # 404 must precede the auth gate, else a client on a removed path gets a 401 that starts a
        # pointless OAuth flow. text/plain, not JSON — a JSON body risks parsing as JSON-RPC.
        response = Response(
            "This MCP transport was removed. Use the Streamable HTTP endpoint at "
            f"{AGENT_PUBLIC_URL}",
            status_code=404,
            media_type="text/plain",
        )
        await response(scope, receive, send)

    async def handle_mcp(scope, receive, send):
        """Single raw-ASGI entry for the MCP transport, mounted at the agent root.

        - `/sse` and `/messages`: the legacy HTTP+SSE transport, removed by feature 079 — these
          return 404 with a pointer to the replacement URL, before the auth gate.
        - everything else (incl. `/`): Streamable HTTP (OAuth gated) — Claude.ai's remote
          connector POSTs/GETs the connector URL (AGENT_PUBLIC_URL → `/`).

        The OAuth and well-known routes are matched earlier and never reach here.
        """
        path = (scope.get("path") or "/").rstrip("/") or "/"

        # Exact membership: the rstrip above folds `/messages/` and `//messages//` into the literal,
        # and the legacy `?session_id=…` lives in query_string, not path.
        if path in REMOVED_TRANSPORT_PATHS:
            await _send_transport_removed(scope, receive, send)
            return

        if not await _authorized(scope):
            await _send_unauthorized(scope, receive, send)
            return

        await session_manager.handle_request(scope, receive, send)

    @asynccontextmanager
    async def lifespan(_app):
        # The Streamable HTTP session manager must be running for the lifetime of the app.
        async with session_manager.run():
            yield

    routes = [
        Route(
            "/.well-known/oauth-protected-resource",
            endpoint=protected_resource_metadata,
        ),
        Route(
            "/.well-known/oauth-authorization-server",
            endpoint=authorization_server_metadata,
        ),
        Route("/oauth/register", endpoint=oauth_register, methods=["POST"]),
        Route("/oauth/authorize", endpoint=oauth_authorize, methods=["GET"]),
        Route("/oauth/callback", endpoint=oauth_callback, methods=["GET"]),
        Route("/oauth/token", endpoint=oauth_token, methods=["POST"]),
        Route("/api/tools", endpoint=list_tools_metadata, methods=["GET"]),
        # The MCP transport at the agent root. MUST be last — the specific routes above win.
        Mount("/", app=handle_mcp),
    ]
    return Starlette(routes=routes, lifespan=lifespan)


async def _run_http() -> None:
    import uvicorn

    starlette_app = build_http_app()
    port = resolve_http_port()
    log.info("xstockstrat-agent starting (transport=http, port=%d)", port)
    config = uvicorn.Config(starlette_app, host="0.0.0.0", port=port, loop="asyncio")
    srv = uvicorn.Server(config)
    await srv.serve()


def main() -> None:
    from app.telemetry import init_telemetry

    # Non-fatal: init_telemetry no-ops unless OTEL_ENABLED=true and swallows its own errors.
    init_telemetry()
    asyncio.run(_run_http() if resolve_transport() == "http" else _run_stdio())


if __name__ == "__main__":
    main()

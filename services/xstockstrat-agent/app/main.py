"""
xstockstrat-agent — MCP server entry point.

Transport is selected via MCP_TRANSPORT env var:
  stdio  (default) -- for Claude.ai desktop MCP integration
  sse              -- for remote MCP connections on MCP_SSE_PORT (default 9000)

SSE transport requires an OAuth 2.1 audience-bound access JWT presented as
  - Authorization: Bearer <jwt>
validated against xstockstrat-identity ValidateToken gRPC RPC (aud must match AGENT_PUBLIC_URL).
Returns HTTP 401 on failure.
"""

import logging
import os

from mcp.server import FastMCP
from mcp.server.stdio import stdio_server

from app.tools import register_tools

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger(__name__)

MCP_TRANSPORT = os.environ.get("MCP_TRANSPORT", "stdio")
MCP_SSE_PORT = int(os.environ.get("MCP_SSE_PORT", "9000"))
# Browser base URL for redirecting the OAuth login flow to the unified login page.
UI_BASE_URL = os.environ.get("UI_BASE_URL", "http://localhost:3000")
# Public (browser-reachable) base URL of the agent itself, used to build absolute OAuth
# discovery + endpoint URLs (RFC 8414/9728). In DO this is ${APP_URL}/agent (the agent is
# mounted under the /agent route prefix); in docker-compose it is http://localhost:9000.
AGENT_PUBLIC_URL = os.environ.get("AGENT_PUBLIC_URL", "http://localhost:9000")


def create_server() -> FastMCP:
    server = FastMCP("xstockstrat-agent")
    register_tools(server)
    return server


async def _run_stdio() -> None:
    server = create_server()
    log.info("xstockstrat-agent starting (transport=stdio)")
    async with stdio_server() as (read_stream, write_stream):
        await server._mcp_server.run(
            read_stream, write_stream, server._mcp_server.create_initialization_options()
        )


def build_sse_app():
    """Construct the Starlette app for the SSE transport + OAuth 2.1 HTTP facade.

    Extracted into a factory so tests can exercise the routes via Starlette's test client
    without binding a real socket.
    """
    from contextlib import asynccontextmanager

    from mcp.server.sse import SseServerTransport
    from mcp.server.streamable_http_manager import StreamableHTTPSessionManager
    from starlette.applications import Starlette
    from starlette.responses import Response
    from starlette.routing import Mount, Route

    from app.auth import validate_bearer_jwt
    from app.oauth_metadata import (
        authorization_server_metadata,
        protected_resource_metadata,
    )
    from app.oauth_server import authorize as oauth_authorize
    from app.oauth_server import callback as oauth_callback
    from app.oauth_server import register as oauth_register
    from app.oauth_server import token as oauth_token

    server = create_server()
    sse = SseServerTransport("/messages")

    # Streamable HTTP transport (MCP 2025-03-26). Claude.ai's remote connector speaks Streamable
    # HTTP against the connector URL itself — POST <url> for client→server JSON-RPC and GET <url>
    # for the server→client stream. The connector URL is AGENT_PUBLIC_URL (`${APP_URL}/agent`),
    # which DO ingress strips to `/`, so the Streamable HTTP transport is served at the agent root
    # (see handle_mcp). The legacy /sse + /messages paths are kept for Claude Desktop (feature 049).
    session_manager = StreamableHTTPSessionManager(app=server._mcp_server)

    async def _authorized(scope) -> bool:
        """OAuth 2.1 gate for both transports.

        Requires an aud-bound JWT presented as `Authorization: Bearer <jwt>` (a token whose aud is
        wrong is rejected — FR-B8).
        """
        headers = dict(scope.get("headers", []))
        auth_header = headers.get(b"authorization", b"").decode("utf-8", errors="ignore")
        token = auth_header[len("Bearer ") :] if auth_header.startswith("Bearer ") else ""
        return bool(token and await validate_bearer_jwt(token))

    async def _send_unauthorized(scope, receive, send) -> None:
        # 401 with a WWW-Authenticate discovery pointer so the client starts OAuth (FR-B0).
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

    async def handle_mcp(scope, receive, send):
        """Single raw-ASGI entry for both MCP transports, mounted at the agent root.

        - `/messages`: legacy HTTP+SSE message channel (auth rides the established stream session).
        - `/sse`: legacy HTTP+SSE event stream (OAuth/API-key gated).
        - everything else (incl. `/`): Streamable HTTP (OAuth/API-key gated) — Claude.ai's remote
          connector POSTs/GETs the connector URL (AGENT_PUBLIC_URL → `/`).

        Mounting at the root (not `/sse`) keeps the ASGI `root_path` empty, so the SSE transport
        advertises its message endpoint as `/messages` (matching the branch below). The OAuth and
        well-known routes are matched earlier and never reach here.
        """
        path = (scope.get("path") or "/").rstrip("/") or "/"

        if path == "/messages":
            await sse.handle_post_message(scope, receive, send)
            return

        if not await _authorized(scope):
            await _send_unauthorized(scope, receive, send)
            return

        if path == "/sse":
            async with sse.connect_sse(scope, receive, send) as streams:
                await server._mcp_server.run(
                    streams[0], streams[1], server._mcp_server.create_initialization_options()
                )
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
        # Both MCP transports at the agent root. MUST be last — the specific routes above win.
        Mount("/", app=handle_mcp),
    ]
    return Starlette(routes=routes, lifespan=lifespan)


async def _run_sse() -> None:
    import uvicorn

    starlette_app = build_sse_app()
    log.info("xstockstrat-agent starting (transport=sse, port=%d)", MCP_SSE_PORT)
    config = uvicorn.Config(starlette_app, host="0.0.0.0", port=MCP_SSE_PORT, loop="asyncio")
    srv = uvicorn.Server(config)
    await srv.serve()


if __name__ == "__main__":
    import asyncio

    from app.telemetry import init_telemetry

    # Non-fatal: init_telemetry no-ops unless OTEL_ENABLED=true and swallows its own errors.
    init_telemetry()

    if MCP_TRANSPORT == "sse":
        asyncio.run(_run_sse())
    else:
        asyncio.run(_run_stdio())

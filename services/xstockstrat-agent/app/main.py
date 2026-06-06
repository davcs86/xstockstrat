"""
xstockstrat-agent — MCP server entry point.

Transport is selected via MCP_TRANSPORT env var:
  stdio  (default) -- for Claude.ai desktop MCP integration
  sse              -- for remote MCP connections on MCP_SSE_PORT (default 9000)

SSE transport requires a valid API key, accepted via either:
  - Authorization: Bearer <api_key> header, or
  - ?api_key=<api_key> query parameter (for clients that cannot set headers, e.g. Claude Desktop)
Key is validated against xstockstrat-identity ValidateApiKey gRPC RPC. Returns HTTP 401 on failure.
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
    from mcp.server.sse import SseServerTransport
    from starlette.applications import Starlette
    from starlette.responses import Response
    from starlette.routing import Mount, Route

    from app.auth import validate_api_key
    from app.oauth_metadata import (
        authorization_server_metadata,
        protected_resource_metadata,
    )
    from app.oauth_server import register as oauth_register

    server = create_server()
    sse = SseServerTransport("/messages")

    async def handle_sse(scope, receive, send):
        from urllib.parse import parse_qs  # noqa: PLC0415

        headers = dict(scope.get("headers", []))
        auth_header = headers.get(b"authorization", b"").decode("utf-8", errors="ignore")
        # Fall back to ?api_key= query param for clients that cannot set custom headers
        # (e.g. Claude Desktop SSE, which does not support Authorization headers).
        if not auth_header:
            qs = parse_qs(scope.get("query_string", b"").decode())
            raw_key = (qs.get("api_key") or [""])[0]
            if raw_key:
                auth_header = f"Bearer {raw_key}"
        if not await validate_api_key(auth_header):
            response = Response("Unauthorized", status_code=401)
            await response(scope, receive, send)
            return
        async with sse.connect_sse(scope, receive, send) as streams:
            await server._mcp_server.run(
                streams[0], streams[1], server._mcp_server.create_initialization_options()
            )

    routes = [
        Route("/sse", endpoint=handle_sse),
        Mount("/messages", app=sse.handle_post_message),
        Route(
            "/.well-known/oauth-protected-resource",
            endpoint=protected_resource_metadata,
        ),
        Route(
            "/.well-known/oauth-authorization-server",
            endpoint=authorization_server_metadata,
        ),
        Route("/oauth/register", endpoint=oauth_register, methods=["POST"]),
    ]
    return Starlette(routes=routes)


async def _run_sse() -> None:
    import uvicorn

    starlette_app = build_sse_app()
    log.info("xstockstrat-agent starting (transport=sse, port=%d)", MCP_SSE_PORT)
    config = uvicorn.Config(starlette_app, host="0.0.0.0", port=MCP_SSE_PORT, loop="asyncio")
    srv = uvicorn.Server(config)
    await srv.serve()


if __name__ == "__main__":
    import asyncio

    if MCP_TRANSPORT == "sse":
        asyncio.run(_run_sse())
    else:
        asyncio.run(_run_stdio())

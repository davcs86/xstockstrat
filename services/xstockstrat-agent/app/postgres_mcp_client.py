"""
Per-call SSE client for the postgres-mcp co-process.

Each public call opens a fresh SSE connection to the locally-running postgres-mcp
process, creates an MCP ClientSession, runs initialize(), calls the requested tool,
and tears down cleanly.  The cost is one extra round-trip per call; the benefit is
zero shared state and no long-lived background connection to manage.

The postgres-mcp process is launched by supervisord on container start; its port is
supplied via the POSTGRES_MCP_PORT environment variable (not a config-service key,
because the value is a deployment-time binding, not a runtime-configurable policy).
"""

import logging
import os
from typing import Any

import httpx2
from mcp import ClientSession
from mcp.client.sse import sse_client

logger = logging.getLogger(__name__)


def _postgres_mcp_url() -> str:
    port = os.environ["POSTGRES_MCP_PORT"]
    return f"http://localhost:{port}/sse"


async def call_tool(name: str, arguments: dict[str, Any]) -> Any:
    """Call one postgres-mcp tool and return its result.

    Opens a fresh SSE connection for each call (per-call isolation design —
    see design.md §3 Chosen Approach).  Raises RuntimeError when the co-process
    is unreachable so callers can surface a clean MCP error instead of an httpx2
    stack trace.
    """
    url = _postgres_mcp_url()
    try:
        async with sse_client(url) as (read, write):
            async with ClientSession(read, write) as session:
                await session.initialize()
                return await session.call_tool(name, arguments)
    except (httpx2.ConnectError, httpx2.ConnectTimeout, OSError) as exc:
        logger.error("postgres-mcp unavailable at %s: %s", url, exc)
        raise RuntimeError(
            f"postgres-mcp co-process is unavailable ({type(exc).__name__}). "
            "Verify that supervisord has started the postgres-mcp program block."
        ) from exc

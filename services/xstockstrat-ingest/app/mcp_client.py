"""MCP client seam for the mcp_client signal source (feature 166).

A thin, injectable Protocol so the scheduled loop (`app/engine/mcp_client_loop.py`) can run against
a fake in tests while the real client does network I/O only. The concrete client resolves the tool
over MCP Streamable HTTP, injecting the resolved bearer via an httpx2 client header — and NO other
auth scheme (AC-3). API pinned against the installed `mcp` SDK (2.1.x):
`mcp.client.streamable_http.streamable_http_client(url, *, http_client=...)` yields a
`(read, write)` stream tuple; `mcp.client.session.ClientSession(read, write).call_tool(...)` returns
a `mcp.types.CallToolResult` carrying `structured_content` (the JSON contract list). Bearer
injection via a custom `httpx2.AsyncClient` header survives — `StreamableHTTPTransport.
_prepare_headers` never sets Authorization.
"""

from __future__ import annotations

from typing import Any, Protocol


def build_bearer_headers(bearer: str) -> dict[str, str]:
    """The ONLY outbound auth header for an mcp_client fetch — a single Bearer Authorization and
    nothing else (AC-3 'no other authentication'). Pure — unit-testable without network."""
    return {"Authorization": f"Bearer {bearer}"}


class McpClientProtocol(Protocol):
    """One-method outbound seam: call the external MCP tool and return its raw CallToolResult."""

    async def fetch(
        self,
        endpoint: str,
        tool: str,
        arguments: dict[str, Any],
        bearer: str,
        timeout_seconds: float,
    ) -> Any: ...


class StreamableHttpMcpClient:
    """Concrete McpClientProtocol over MCP Streamable HTTP. Network + bearer only — no DB, no
    parsing
    (the parser is app/extractors/mcp_client.py). Imports the SDK lazily so importing this module
    never requires the mcp/httpx2 stack (e.g. in unit tests that only use a fake)."""

    async def fetch(
        self,
        endpoint: str,
        tool: str,
        arguments: dict[str, Any],
        bearer: str,
        timeout_seconds: float,
    ) -> Any:
        import httpx2
        from mcp.client.session import ClientSession
        from mcp.client.streamable_http import streamable_http_client

        async with httpx2.AsyncClient(
            headers=build_bearer_headers(bearer),
            timeout=timeout_seconds,
        ) as http_client:
            async with streamable_http_client(endpoint, http_client=http_client) as (read, write):
                async with ClientSession(read, write) as session:
                    await session.initialize()
                    return await session.call_tool(
                        tool,
                        arguments,
                        read_timeout_seconds=float(timeout_seconds),
                    )

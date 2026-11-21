"""Internal tool catalog: AgentService.ListTools on the agent's gRPC port (feature 360).

The only caller is the UI's BFF. The verified peer certificate name is the sole authorization
check; no request header is read.
"""

import grpc
import grpc.aio

from app import mtls
from app.peer_identity import peer_san_matches

UI_PEER_SAN = "xstockstrat-ui"


class CatalogServicer:
    """Serves the registered MCP tools (name, description, input schema) to the UI peer only."""

    def __init__(self, mcp_server) -> None:
        self._server = mcp_server

    async def ListTools(self, request, context):  # noqa: N802 — gRPC method name
        from gen.agent.v1 import agent_pb2  # noqa: PLC0415

        if not peer_san_matches(context, UI_PEER_SAN):
            return await context.abort(grpc.StatusCode.PERMISSION_DENIED, "caller not allowed")
        response = agent_pb2.ListToolsResponse()
        for t in await self._server.list_tools():
            tool = response.tools.add(name=t.name, description=t.description or "")
            tool.input_schema.update(t.input_schema)
        return response


def build_catalog_server(mcp_server, address: str) -> tuple[grpc.aio.Server, int]:
    """Bind (not start) the catalog server on ``address`` over mutual TLS; returns (server, port).

    Raises RuntimeError when MTLS_* are missing (fail-closed, via mtls.server_credentials).
    """
    from gen.agent.v1 import agent_pb2_grpc  # noqa: PLC0415

    server = grpc.aio.server()
    agent_pb2_grpc.add_AgentServiceServicer_to_server(CatalogServicer(mcp_server), server)
    port = server.add_secure_port(address, mtls.server_credentials())
    return server, port

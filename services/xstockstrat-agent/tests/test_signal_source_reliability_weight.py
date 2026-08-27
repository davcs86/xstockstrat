"""Behavior tests for surfacing per-source reliability_weight through the agent tools (feature 161).

Covers:
- AC-1  list_signal_sources returns each source's reliability_weight (the tool re-projection had
        dropped it, even though the client layer carried it).
- AC-2  manage_signal_source update sets the weight AND marks it in the update_mask.
- AC-10 manage_signal_source update of another field alone OMITS reliability_weight from the mask,
        so the backend preserves the stored weight (proto3 optional-double presence trap).
- AC-3  a backend out-of-range weight rejection is surfaced as a tool error, not swallowed.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import grpc
import pytest
from mcp.server.mcpserver import MCPServer

from app import client
from app.tools import register_tools
from tests.conftest import ADMIN, _ctx


def _make_server() -> MCPServer:
    server = MCPServer("test-agent")
    register_tools(server)
    return server


def _tool_fn(server: MCPServer, name: str):
    return server._tool_manager.get_tool(name).fn


def _channel_cm():
    cm = MagicMock()
    cm.__aenter__ = AsyncMock(return_value=MagicMock())
    cm.__aexit__ = AsyncMock(return_value=False)
    return cm


async def _capture_manage_request(**tool_kwargs):
    """Invoke the manage_signal_source TOOL end-to-end (tool → client → mocked stub) and return
    (built_request_proto, tool_result_dict). Exercises the real dict→proto builder so the mask
    and source-field assertions are on the actual ManageSignalSourceRequest."""
    from gen.ingest.v1 import ingest_pb2, ingest_pb2_grpc  # type: ignore

    # Echo the request's reliability_weight back on the response so the projection can be asserted.
    def _respond(req, metadata=None):
        return ingest_pb2.ManageSignalSourceResponse(source=req.source)

    mock_stub = MagicMock()
    mock_stub.ManageSignalSource = AsyncMock(side_effect=_respond)
    server = _make_server()
    with patch("app.client.grpc") as mock_grpc:
        mock_grpc.aio.insecure_channel.return_value = _channel_cm()
        with patch.object(ingest_pb2_grpc, "IngestServiceStub", return_value=mock_stub):
            result = await _tool_fn(server, "manage_signal_source")(ctx=_ctx(ADMIN), **tool_kwargs)
    return mock_stub.ManageSignalSource.call_args[0][0], result


@pytest.mark.asyncio
async def test_list_signal_sources_returns_reliability_weight():
    # AC-1: the tool re-projection must carry reliability_weight from the client dict.
    sources = [
        {
            "slug": "sec-form4",
            "display_name": "SEC Form 4",
            "source_type": "mediated_simple_email",
            "config_json": {},
            "has_credentials": False,
            "reliability_weight": 0.8,
        }
    ]
    with patch.object(client, "list_signal_sources", AsyncMock(return_value=sources)):
        server = _make_server()
        result = await _tool_fn(server, "list_signal_sources")()
    assert result["sources"][0]["reliability_weight"] == 0.8


@pytest.mark.asyncio
async def test_manage_update_sets_weight_and_masks_it():
    # AC-2: an update carrying reliability_weight sets it on the proto AND lists it in the mask.
    req, result = await _capture_manage_request(
        operation="update", slug="sec-form4", reliability_weight=0.5
    )
    assert req.source.reliability_weight == 0.5
    assert "reliability_weight" in list(req.update_mask.paths)
    assert result["reliability_weight"] == 0.5


@pytest.mark.asyncio
async def test_manage_update_of_other_field_preserves_weight():
    # AC-10: a display_name-only update must NOT mask reliability_weight (backend preserves it).
    req, _ = await _capture_manage_request(
        operation="update", slug="sec-form4", display_name="SEC Form 4"
    )
    assert "reliability_weight" not in list(req.update_mask.paths)
    # And because it was not supplied, the builder left the optional field unset (not 0.0).
    assert not req.source.HasField("reliability_weight")


@pytest.mark.asyncio
async def test_manage_out_of_range_weight_is_surfaced_as_tool_error():
    # AC-3: the backend rejects 1.5 with INVALID_ARGUMENT; the tool surfaces it, never swallows it.
    from grpc.aio import AioRpcError, Metadata  # noqa: PLC0415

    err = AioRpcError(
        grpc.StatusCode.INVALID_ARGUMENT,
        Metadata(),
        Metadata(),
        details="reliability_weight must be in [0, 1] (got 1.5)",
    )
    with patch.object(client, "manage_signal_source", AsyncMock(side_effect=err)):
        server = _make_server()
        with pytest.raises(RuntimeError, match="reliability_weight"):
            await _tool_fn(server, "manage_signal_source")(
                ctx=_ctx(ADMIN), operation="update", slug="sec-form4", reliability_weight=1.5
            )

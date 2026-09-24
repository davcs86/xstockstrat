"""Feature 205 — list_fundamental_metrics tool (catalog shape, AC-4) + the G4 header-propagation
guard on the client function."""

from unittest.mock import AsyncMock, MagicMock, patch

from mcp.server.mcpserver import MCPServer

from app import client
from app.tools import register_tools

_CATALOG = [
    {"metric": f"FUNDAMENTAL_METRIC_{name}", "dataKey": name.lower(), "meaning": meaning}
    for name, meaning in [
        ("MARKET_CAP", "Market cap"),
        ("PE_RATIO", "P/E ratio"),
        ("PB_RATIO", "P/B ratio"),
        ("DIVIDEND_YIELD", "Dividend yield"),
        ("EPS", "EPS"),
        ("BETA", "Beta"),
        ("ROE", "ROE"),
        ("DEBT_TO_EQUITY", "Debt/equity"),
        ("PRICE", "Price"),
        ("YEAR_HIGH", "52-week high"),
        ("YEAR_LOW", "52-week low"),
    ]
]


def _tool_fn(name: str):
    server = MCPServer("test-agent")
    register_tools(server)
    return server._tool_manager.get_tool(name).fn


def _channel_cm():
    cm = MagicMock()
    cm.__aenter__ = AsyncMock(return_value=MagicMock())
    cm.__aexit__ = AsyncMock(return_value=False)
    return cm


async def test_tool_returns_the_full_catalog():
    # AC-4: the tool surfaces all 11 metrics, each with metric NAME / snake_case dataKey / meaning.
    mock = AsyncMock(return_value=_CATALOG)
    with patch.object(client, "list_fundamental_metrics", mock):
        out = await _tool_fn("list_fundamental_metrics")()
    assert len(out["metrics"]) == 11
    for m in out["metrics"]:
        assert m["metric"].startswith("FUNDAMENTAL_METRIC_")
        assert m["dataKey"] and m["meaning"]


async def test_client_propagates_metadata():
    # G4: the client function forwards the propagation metadata on its gRPC call, and MessageToDict
    # surfaces the enum as a NAME-string with a camelCase dataKey.
    from gen.indicators.v1 import indicators_pb2, indicators_pb2_grpc  # type: ignore

    mock_stub = MagicMock()
    mock_stub.ListFundamentalMetrics = AsyncMock(
        return_value=indicators_pb2.ListFundamentalMetricsResponse(
            metrics=[
                indicators_pb2.FundamentalMetricInfo(
                    metric=indicators_pb2.FUNDAMENTAL_METRIC_PE_RATIO,
                    data_key="pe_ratio",
                    meaning="P/E ratio",
                )
            ]
        )
    )
    with patch("app.client.grpc") as mock_grpc:
        mock_grpc.aio.insecure_channel.return_value = _channel_cm()
        with patch.object(indicators_pb2_grpc, "IndicatorsServiceStub", return_value=mock_stub):
            result = await client.list_fundamental_metrics()
    assert result == [
        {"metric": "FUNDAMENTAL_METRIC_PE_RATIO", "dataKey": "pe_ratio", "meaning": "P/E ratio"}
    ]
    assert "metadata" in mock_stub.ListFundamentalMetrics.call_args.kwargs

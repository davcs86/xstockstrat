"""Feature 224 — list_templates / instantiate_template agent tools (AC-25 template routing).

Each kind routes to its owning service's template RPC with the bound caller's propagation trio, and
a signal_source bearer is written secret-first to an opaque per-user config key.
"""

import inspect
import re
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from mcp.server.mcpserver import MCPServer

from app import client
from app.tools import register_tools
from tests.conftest import TRADER, _ctx

_CALLER = TRADER["user_id"]
_OPAQUE_KEY = re.compile(
    r"^mcp_credential\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
)


def _tool_fn(name: str):
    server = MCPServer("test-agent")
    register_tools(server)
    return server._tool_manager.get_tool(name).fn


def _channel_cm():
    cm = MagicMock()
    cm.__aenter__ = AsyncMock(return_value=MagicMock())
    cm.__aexit__ = AsyncMock(return_value=False)
    return cm


@pytest.fixture
def bound_caller():
    token = client.set_caller(_CALLER, 11, "trace-224")
    try:
        yield
    finally:
        client.reset_caller(token)


def _stubs():
    """Mock stubs for the three template-owning services, keyed by kind."""
    from gen.analysis.v1 import analysis_pb2, analysis_pb2_grpc  # type: ignore
    from gen.indicators.v1 import indicators_pb2, indicators_pb2_grpc  # type: ignore
    from gen.ingest.v1 import ingest_pb2, ingest_pb2_grpc  # type: ignore

    ind = MagicMock()
    ind.ListTemplates = AsyncMock(return_value=indicators_pb2.ListTemplatesResponse())
    ind.InstantiateTemplate = AsyncMock(
        return_value=indicators_pb2.InstantiateTemplateResponse(
            formula=indicators_pb2.FormulaDefinition(formula_id="f-new")
        )
    )
    ana = MagicMock()
    ana.ListTemplates = AsyncMock(return_value=analysis_pb2.ListTemplatesResponse())
    ana.InstantiateTemplate = AsyncMock(
        return_value=analysis_pb2.StrategyDefinition(strategy_id="mean_reversion_2")
    )
    ing = MagicMock()
    ing.ListTemplates = AsyncMock(return_value=ingest_pb2.ListTemplatesResponse())
    ing.InstantiateTemplate = AsyncMock(
        return_value=ingest_pb2.SignalSource(
            slug="my-mcp", source_type="mcp_client", has_credentials=True, user_id=_CALLER
        )
    )
    patches = [
        patch.object(indicators_pb2_grpc, "IndicatorsServiceStub", return_value=ind),
        patch.object(analysis_pb2_grpc, "AnalysisServiceStub", return_value=ana),
        patch.object(ingest_pb2_grpc, "IngestServiceStub", return_value=ing),
    ]
    return {"formula": ind, "strategy": ana, "signal_source": ing}, patches


async def _run(tool: str, **kw):
    fn = _tool_fn(tool)
    if "ctx" in inspect.signature(fn).parameters:
        kw["ctx"] = _ctx(TRADER)
    stubs, patches = _stubs()
    with patch("app.client.mtls") as mtls:
        mtls.secure_channel.return_value = _channel_cm()
        for p in patches:
            p.start()
        try:
            result = await fn(**kw)
        finally:
            for p in patches:
                p.stop()
    return result, stubs


def _single_user_header(call) -> None:
    md = call.kwargs["metadata"]
    assert [v for k, v in md if k == "x-user-id"] == [_CALLER]


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", ["formula", "strategy", "signal_source"])
async def test_list_templates_routes_to_owning_service(bound_caller, kind):
    result, stubs = await _run("list_templates", kind=kind)
    assert result == {"templates": []}
    stubs[kind].ListTemplates.assert_awaited_once()
    _single_user_header(stubs[kind].ListTemplates.await_args)
    for other, stub in stubs.items():
        if other != kind:
            stub.ListTemplates.assert_not_awaited()


@pytest.mark.asyncio
async def test_list_templates_rejects_unknown_kind(bound_caller):
    with pytest.raises(ValueError, match="kind"):
        await _run("list_templates", kind="widget")


@pytest.mark.asyncio
async def test_instantiate_strategy_template_routes_to_analysis(bound_caller):
    result, stubs = await _run(
        "instantiate_template", kind="strategy", template_id="t-mr", strategy_id="mean_reversion"
    )
    call = stubs["strategy"].InstantiateTemplate.await_args
    req = call.args[0]
    assert (req.template_id, req.strategy_id) == ("t-mr", "mean_reversion")
    _single_user_header(call)
    assert result["strategyId"] == "mean_reversion_2"


@pytest.mark.asyncio
async def test_instantiate_formula_template_routes_to_indicators(bound_caller):
    result, stubs = await _run("instantiate_template", kind="formula", template_id="t-rsi")
    call = stubs["formula"].InstantiateTemplate.await_args
    req = call.args[0]
    assert req.template_id == "t-rsi"
    # The saga-only fields are internal to analysis and never sent by the agent.
    assert list(req.template_ids) == [] and req.intent_id == ""
    _single_user_header(call)
    assert result["formulaId"] == "f-new"


@pytest.mark.asyncio
async def test_instantiate_signal_source_writes_per_user_secret_first(bound_caller):
    set_config = AsyncMock(return_value={"version": "1", "updated_at": "x"})
    with patch.object(client, "set_config", set_config):
        result, stubs = await _run(
            "instantiate_template",
            kind="signal_source",
            template_id="t-mcp",
            slug="my-mcp",
            bearer_token="sk-live-xyz",
        )
    set_config.assert_awaited_once()
    sc = set_config.await_args.kwargs
    assert sc["namespace"] == "ingest"
    assert _OPAQUE_KEY.match(sc["key"]), sc["key"]
    assert sc["user_id"] == _CALLER
    assert sc["is_secret"] is True and sc["create_key"] is True
    assert sc["value"] == "sk-live-xyz"

    call = stubs["signal_source"].InstantiateTemplate.await_args
    req = call.args[0]
    assert (req.template_id, req.slug) == ("t-mcp", "my-mcp")
    assert req.credentials_ref == f"ingest.{sc['key']}"
    _single_user_header(call)

    assert "credentials_ref" not in result and "bearer_token" not in result
    assert all("sk-live-xyz" not in str(v) for v in result.values())
    assert result["user_id"] == _CALLER


@pytest.mark.asyncio
async def test_instantiate_signal_source_without_bearer_writes_no_secret(bound_caller):
    set_config = AsyncMock()
    with patch.object(client, "set_config", set_config):
        _, stubs = await _run(
            "instantiate_template", kind="signal_source", template_id="t-web", slug="my-web"
        )
    set_config.assert_not_awaited()
    assert stubs["signal_source"].InstantiateTemplate.await_args.args[0].credentials_ref == ""


@pytest.mark.asyncio
async def test_manage_signal_source_mcp_client_bearer_is_per_user_opaque_key():
    set_config = AsyncMock(return_value={"version": "1", "updated_at": "x"})
    manage = AsyncMock(return_value={"slug": "acme", "has_credentials": True})
    with (
        patch.object(client, "set_config", set_config),
        patch.object(client, "manage_signal_source", manage),
    ):
        await _tool_fn("manage_signal_source")(
            _ctx(TRADER),
            operation="register",
            slug="acme",
            source_type="mcp_client",
            bearer_token="sk-live-abc",
        )
    sc = set_config.await_args.kwargs
    assert _OPAQUE_KEY.match(sc["key"]), sc["key"]
    assert sc["user_id"] == _CALLER and sc["is_secret"] is True and sc["create_key"] is True
    assert manage.await_args.kwargs["credentials_ref"] == f"ingest.{sc['key']}"

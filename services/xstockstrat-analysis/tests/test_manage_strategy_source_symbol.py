"""Feature 152 — ManageStrategy source_symbol normalization + fingerprint (Step 7).

Covers AC-6: the write path uppercases/trims source_symbol server-side (empty-after-trim →
unset), and source_symbol is scoring-relevant — changing it changes the definition fingerprint,
while an empty one leaves the fingerprint byte-identical to a strategy with no benchmark at all.
"""

import json
from unittest.mock import AsyncMock

import pytest
from gen.analysis.v1 import analysis_pb2
from google.protobuf import json_format

from app.handlers.servicer import _definition_fingerprint

from .test_analysis_servicer import _admin_ctx, _row_for, make_servicer


def _def_with_source(source_symbol: str):
    return analysis_pb2.StrategyDefinition(
        strategy_id="mkt_x",
        display_name="Mkt X",
        active=True,
        components=[
            analysis_pb2.StrategyComponent(
                ref_name="mkt",
                kind=analysis_pb2.COMPONENT_KIND_BUILTIN_INDICATOR,
                indicator="SMA",
                params={"period": 200.0},
                source_symbol=source_symbol,
            )
        ],
        entry_rule=json.dumps({"fn": ">", "lhs": "mkt", "rhs": 0}),
    )


async def _register(source_symbol: str):
    svc = make_servicer()
    definition = _def_with_source(source_symbol)
    svc._strategies_repo = AsyncMock()
    svc._strategies_repo.get_by_owner_and_id = AsyncMock(return_value=None)
    svc._strategies_repo.create = AsyncMock(return_value=_row_for(definition))
    req = analysis_pb2.ManageStrategyRequest(
        operation=analysis_pb2.STRATEGY_OPERATION_REGISTER, definition=definition
    )
    await svc.ManageStrategy(req, context=_admin_ctx())
    # create(caller_user_id, strategy_id, display_name, definition_json)
    return svc._strategies_repo.create.await_args.args[3]


@pytest.mark.asyncio
async def test_source_symbol_is_uppercased_and_trimmed_on_register():
    """AC-6: 'voo ' persists as 'VOO'."""
    definition_json = await _register("voo ")
    assert definition_json["components"][0]["source_symbol"] == "VOO"


@pytest.mark.asyncio
async def test_whitespace_source_symbol_persists_as_unset():
    """AC-6: a whitespace-only source_symbol collapses to unset (plain string omitted)."""
    definition_json = await _register("   ")
    comp = definition_json["components"][0]
    assert comp.get("source_symbol", "") == ""


def test_changing_source_symbol_changes_fingerprint():
    """AC-6: source_symbol is scoring-relevant — VOO vs SPY fingerprints differ."""
    voo = json_format.MessageToDict(_def_with_source("VOO"), preserving_proto_field_name=True)
    spy = json_format.MessageToDict(_def_with_source("SPY"), preserving_proto_field_name=True)
    assert _definition_fingerprint(voo) != _definition_fingerprint(spy)


def test_empty_source_symbol_is_fingerprint_identical_to_no_benchmark():
    """AC-1/AC-6 byte-identity: an empty source_symbol leaves the fingerprint identical to a
    definition that never had the field — a pre-existing strategy's grade is not invalidated."""
    with_empty = json_format.MessageToDict(_def_with_source(""), preserving_proto_field_name=True)
    # A definition built without ever setting source_symbol.
    without = _def_with_source("VOO")
    without.components[0].ClearField("source_symbol")
    without_json = json_format.MessageToDict(without, preserving_proto_field_name=True)
    assert "source_symbol" not in with_empty["components"][0]
    assert _definition_fingerprint(with_empty) == _definition_fingerprint(without_json)

"""Feature 224 — the fundamentals blend strategy id guard (AC-23, @feature-186 EXTEND).

DEACTIVATE of the configured blend id is refused as before; REGISTER of that id is reserved for
ADMIN callers (non-admin → ``FAILED_PRECONDITION``); a reconfigured blend id moves the guard.
"""

import json
from unittest.mock import AsyncMock, MagicMock

import grpc
import pytest
from gen.analysis.v1 import analysis_pb2
from google.protobuf import json_format

from app.handlers.servicer import AnalysisServicer
from tests.conftest import ctx_with

_BLEND_KEY = "analysis.engine.fundamentals_blend_strategy_id"
_DEFAULT_BLEND = "fundamentals_macd_blend"


def _servicer(blend_id: str | None = None) -> AnalysisServicer:
    cfg = MagicMock()

    def _get_str(key, default=""):
        if key == _BLEND_KEY and blend_id is not None:
            return blend_id
        return default

    cfg.get_str = MagicMock(side_effect=_get_str)
    cfg.get_float = MagicMock(side_effect=lambda key, default=0.0: default)
    cfg.get_int = MagicMock(side_effect=lambda key, default=0: default)
    cfg.get_bool = MagicMock(side_effect=lambda key, default=False: default)
    cfg.get_int_present = MagicMock(side_effect=lambda key, default: default)
    cfg.get_float_present = MagicMock(side_effect=lambda key, default: default)
    svc = AnalysisServicer(
        cfg,
        marketdata_channel=MagicMock(),
        indicators_channel=MagicMock(),
        ingest_channel=MagicMock(),
        ledger_channel=MagicMock(),
    )
    svc._strategies_repo = AsyncMock()
    svc._strategies_repo.get_by_owner_and_id = AsyncMock(return_value=None)
    svc._strategies_repo.create = AsyncMock(
        side_effect=lambda owner, sid, *_a: _row(owner, _definition(sid))
    )
    return svc


def _definition(strategy_id: str) -> analysis_pb2.StrategyDefinition:
    return analysis_pb2.StrategyDefinition(
        strategy_id=strategy_id,
        display_name=strategy_id,
        active=True,
        components=[
            analysis_pb2.StrategyComponent(
                ref_name="fast",
                kind=analysis_pb2.COMPONENT_KIND_BUILTIN_INDICATOR,
                indicator="SMA",
                params={"period": 10.0},
            )
        ],
        entry_rule=json.dumps({"fn": ">", "lhs": "fast", "rhs": 100}),
    )


def _row(owner: str, definition) -> dict:
    return {
        "strategy_id": definition.strategy_id,
        "user_id": owner,
        "display_name": definition.display_name,
        "active": True,
        "definition_json": json_format.MessageToDict(definition, preserving_proto_field_name=True),
    }


def _bob():
    return ctx_with([("x-user-id", "bob"), ("x-access-scope", "3"), ("x-trace-id", "t-bob")])


def _admin():
    return ctx_with([("x-user-id", "admin"), ("x-access-scope", "7"), ("x-trace-id", "t-adm")])


def _register(strategy_id: str):
    return analysis_pb2.ManageStrategyRequest(
        operation=analysis_pb2.STRATEGY_OPERATION_REGISTER, definition=_definition(strategy_id)
    )


async def _assert_refused(svc, req, ctx) -> None:
    with pytest.raises(Exception, match="aborted"):
        await svc.ManageStrategy(req, ctx)
    assert ctx.abort.await_args.args[0] == grpc.StatusCode.FAILED_PRECONDITION
    svc._strategies_repo.create.assert_not_called()
    svc._strategies_repo.deactivate.assert_not_called()


@pytest.mark.asyncio
async def test_ac23_non_admin_deactivate_of_blend_refused_as_before():
    svc = _servicer()
    req = analysis_pb2.ManageStrategyRequest(
        operation=analysis_pb2.STRATEGY_OPERATION_DEACTIVATE,
        definition=_definition(_DEFAULT_BLEND),
    )
    ctx = _bob()
    await _assert_refused(svc, req, ctx)
    assert "cannot be deactivated" in ctx.abort.await_args.args[1]


@pytest.mark.asyncio
async def test_non_admin_register_of_configured_blend_id_refused():
    svc = _servicer()
    ctx = _bob()
    await _assert_refused(svc, _register(_DEFAULT_BLEND), ctx)
    assert "reserved for admins" in ctx.abort.await_args.args[1]
    svc._strategies_repo.get_by_owner_and_id.assert_not_called()


@pytest.mark.asyncio
async def test_admin_register_of_configured_blend_id_succeeds():
    svc = _servicer()
    ctx = _admin()
    result = await svc.ManageStrategy(_register(_DEFAULT_BLEND), ctx)
    assert result.strategy_id == _DEFAULT_BLEND
    ctx.abort.assert_not_called()
    assert svc._strategies_repo.create.await_args.args[:2] == ("admin", _DEFAULT_BLEND)


@pytest.mark.asyncio
async def test_reconfigured_blend_id_moves_the_register_guard():
    svc = _servicer(blend_id="custom_blend_v2")
    ctx = _bob()
    await _assert_refused(svc, _register("custom_blend_v2"), ctx)

    # The old default id is now an ordinary strategy id a non-admin may register.
    svc2 = _servicer(blend_id="custom_blend_v2")
    ctx2 = _bob()
    result = await svc2.ManageStrategy(_register(_DEFAULT_BLEND), ctx2)
    assert result.strategy_id == _DEFAULT_BLEND
    ctx2.abort.assert_not_called()

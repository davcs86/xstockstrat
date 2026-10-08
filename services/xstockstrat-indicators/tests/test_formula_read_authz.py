"""Formula reads are owner-only (feature 224): a formula is readable/executable by its author or
as a SYSTEM_AUTHOR formula; the N-only analysis bypass needs both the x-internal-caller header
and the mTLS peer SAN xstockstrat-analysis. Regression origin:
docs/reports/2026-10-03-indicators-private-formula-cross-user-read-defect.md."""

from unittest.mock import MagicMock

import grpc
import pytest
from gen.indicators.v1 import indicators_pb2

from app.formulas import SYSTEM_AUTHOR
from app.handlers.servicer import IndicatorsServicer
from tests.conftest import ctx_with


def _cfg():
    cfg = MagicMock()
    cfg.sandbox_max_concurrent.return_value = 4
    cfg.sandbox_timeout_seconds.return_value = 5
    return cfg


def _servicer(author="user-a", is_public=False):
    svc = IndicatorsServicer(config_watcher=_cfg())
    svc._formulas["f-1"] = indicators_pb2.FormulaDefinition(
        formula_id="f-1", name="secret", source="result = close", author=author, is_public=is_public
    )
    return svc


class TestGetFormulaAuthz:
    async def test_other_user_cannot_read_private_formula(self):
        ctx = ctx_with([("x-user-id", "user-b")])
        with pytest.raises(grpc.RpcError):
            await _servicer().GetFormula(indicators_pb2.GetFormulaRequest(formula_id="f-1"), ctx)
        assert ctx.abort.await_args.args[0] == grpc.StatusCode.NOT_FOUND

    async def test_no_caller_cannot_read_private_formula(self):
        ctx = ctx_with([])
        with pytest.raises(grpc.RpcError):
            await _servicer().GetFormula(indicators_pb2.GetFormulaRequest(formula_id="f-1"), ctx)

    async def test_formerly_public_formula_is_invisible_to_another_user(self):
        """AC-1/AC-22: is_public no longer grants read."""
        ctx = ctx_with([("x-user-id", "user-b")])
        with pytest.raises(grpc.RpcError):
            await _servicer("user-a", is_public=True).GetFormula(
                indicators_pb2.GetFormulaRequest(formula_id="f-1"), ctx
            )
        assert ctx.abort.await_args.args[0] == grpc.StatusCode.NOT_FOUND

    @pytest.mark.parametrize(
        "author,metadata,peer_sans",
        [
            ("user-a", [("x-user-id", "user-a")], ()),
            (SYSTEM_AUTHOR, [("x-user-id", "user-b")], ()),
            (
                "user-a",
                [("x-user-id", "user-b"), ("x-internal-caller", "analysis")],
                ("xstockstrat-analysis",),
            ),
        ],
        ids=["owner", "system", "internal-analysis-san-bound"],
    )
    async def test_allowed_readers(self, author, metadata, peer_sans):
        resp = await _servicer(author).GetFormula(
            indicators_pb2.GetFormulaRequest(formula_id="f-1"), ctx_with(metadata, peer_sans)
        )
        assert resp.source == "result = close"

    async def test_internal_analysis_header_without_san_is_not_trusted(self):
        ctx = ctx_with([("x-user-id", "user-b"), ("x-internal-caller", "analysis")])
        with pytest.raises(grpc.RpcError):
            await _servicer().GetFormula(indicators_pb2.GetFormulaRequest(formula_id="f-1"), ctx)
        assert ctx.abort.await_args.args[0] == grpc.StatusCode.NOT_FOUND

    async def test_internal_analysis_header_with_other_san_is_not_trusted(self):
        ctx = ctx_with(
            [("x-user-id", "user-b"), ("x-internal-caller", "analysis")], ("xstockstrat-agent",)
        )
        with pytest.raises(grpc.RpcError):
            await _servicer().GetFormula(indicators_pb2.GetFormulaRequest(formula_id="f-1"), ctx)
        assert ctx.abort.await_args.args[0] == grpc.StatusCode.NOT_FOUND

    async def test_unlisted_internal_caller_is_not_trusted(self):
        ctx = ctx_with(
            [("x-user-id", "user-b"), ("x-internal-caller", "agent")], ("xstockstrat-analysis",)
        )
        with pytest.raises(grpc.RpcError):
            await _servicer().GetFormula(indicators_pb2.GetFormulaRequest(formula_id="f-1"), ctx)


class TestExecuteFormulaAuthz:
    async def test_other_user_cannot_execute_private_formula(self):
        ctx = ctx_with([("x-user-id", "user-b")])
        req = indicators_pb2.ExecuteFormulaRequest(formula_id="f-1")
        with pytest.raises(grpc.RpcError):
            await _servicer().ExecuteFormula(req, ctx)
        assert ctx.abort.await_args.args[0] == grpc.StatusCode.NOT_FOUND

    async def test_internal_analysis_header_without_san_cannot_execute(self):
        ctx = ctx_with([("x-user-id", "user-b"), ("x-internal-caller", "analysis")])
        req = indicators_pb2.ExecuteFormulaRequest(formula_id="f-1")
        with pytest.raises(grpc.RpcError):
            await _servicer().ExecuteFormula(req, ctx)
        assert ctx.abort.await_args.args[0] == grpc.StatusCode.NOT_FOUND

"""Regression for docs/reports/2026-10-03-indicators-private-formula-cross-user-read-defect.md:
a non-public formula is readable/executable only by its author, as a SYSTEM_AUTHOR formula, or by an
allow-listed internal caller; a foreign author_filter lists only that author's public formulas."""

from unittest.mock import AsyncMock, MagicMock

import grpc
import pytest
from gen.indicators.v1 import indicators_pb2

from app.formulas import SYSTEM_AUTHOR
from app.handlers.servicer import IndicatorsServicer
from app.services.formulas_repository import FormulasRepository


def _cfg():
    cfg = MagicMock()
    cfg.sandbox_max_concurrent.return_value = 4
    cfg.sandbox_timeout_seconds.return_value = 5
    return cfg


def _ctx(metadata):
    ctx = MagicMock()
    ctx.invocation_metadata = MagicMock(return_value=metadata)
    ctx.abort = AsyncMock(side_effect=grpc.RpcError("aborted"))
    return ctx


def _servicer(author="user-a", is_public=False):
    svc = IndicatorsServicer(config_watcher=_cfg())
    svc._formulas["f-1"] = indicators_pb2.FormulaDefinition(
        formula_id="f-1", name="secret", source="result = close", author=author, is_public=is_public
    )
    return svc


class TestGetFormulaAuthz:
    async def test_other_user_cannot_read_private_formula(self):
        ctx = _ctx([("x-user-id", "user-b")])
        with pytest.raises(grpc.RpcError):
            await _servicer().GetFormula(indicators_pb2.GetFormulaRequest(formula_id="f-1"), ctx)
        assert ctx.abort.await_args.args[0] == grpc.StatusCode.NOT_FOUND

    async def test_no_caller_cannot_read_private_formula(self):
        ctx = _ctx([])
        with pytest.raises(grpc.RpcError):
            await _servicer().GetFormula(indicators_pb2.GetFormulaRequest(formula_id="f-1"), ctx)

    @pytest.mark.parametrize(
        "author,is_public,metadata",
        [
            ("user-a", False, [("x-user-id", "user-a")]),
            ("user-a", True, [("x-user-id", "user-b")]),
            (SYSTEM_AUTHOR, False, [("x-user-id", "user-b")]),
            ("user-a", False, [("x-user-id", "user-b"), ("x-internal-caller", "analysis")]),
        ],
        ids=["owner", "public", "system", "internal-analysis"],
    )
    async def test_allowed_readers(self, author, is_public, metadata):
        resp = await _servicer(author, is_public).GetFormula(
            indicators_pb2.GetFormulaRequest(formula_id="f-1"), _ctx(metadata)
        )
        assert resp.source == "result = close"

    async def test_unlisted_internal_caller_is_not_trusted(self):
        ctx = _ctx([("x-user-id", "user-b"), ("x-internal-caller", "agent")])
        with pytest.raises(grpc.RpcError):
            await _servicer().GetFormula(indicators_pb2.GetFormulaRequest(formula_id="f-1"), ctx)


class TestExecuteFormulaAuthz:
    async def test_other_user_cannot_execute_private_formula(self):
        ctx = _ctx([("x-user-id", "user-b")])
        req = indicators_pb2.ExecuteFormulaRequest(formula_id="f-1")
        with pytest.raises(grpc.RpcError):
            await _servicer().ExecuteFormula(req, ctx)
        assert ctx.abort.await_args.args[0] == grpc.StatusCode.NOT_FOUND


class TestListFormulasAuthz:
    def _repo_servicer(self):
        svc = IndicatorsServicer(config_watcher=_cfg())
        repo = MagicMock(spec=FormulasRepository)
        repo.list = AsyncMock(return_value=([], 0))
        svc._repo = repo
        return svc, repo

    async def test_foreign_author_filter_is_public_only(self):
        svc, repo = self._repo_servicer()
        req = indicators_pb2.ListFormulasRequest(author_filter="user-a", include_public=False)
        await svc.ListFormulas(req, _ctx([("x-user-id", "user-b")]))
        assert repo.list.await_args.kwargs["author_public_only"] is True

    async def test_own_author_filter_includes_private(self):
        svc, repo = self._repo_servicer()
        req = indicators_pb2.ListFormulasRequest(author_filter="user-b", include_public=True)
        await svc.ListFormulas(req, _ctx([("x-user-id", "user-b")]))
        assert repo.list.await_args.kwargs["author_public_only"] is False

    async def test_repo_public_only_sql_requires_is_public_for_author_branch(self):
        pool = MagicMock()
        pool.fetchval = AsyncMock(return_value=0)
        pool.fetch = AsyncMock(return_value=[])
        await FormulasRepository(pool).list(
            author_filter="user-a",
            include_public=False,
            page_size=10,
            page_offset=0,
            author_public_only=True,
        )
        sql, *params = pool.fetch.await_args.args
        assert params[:3] == ["user-a", False, True]
        assert "NOT $3 OR is_public" in sql and "LIMIT $4 OFFSET $5" in sql

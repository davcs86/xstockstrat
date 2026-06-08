"""Unit tests for FormulasRepository and the IndicatorsServicer CRUD methods.

Repository tests mock the asyncpg pool (no real DB). Servicer tests exercise the
in-memory fallback path (``db_pool=None``). Run with: pytest tests/test_formulas.py
"""

from unittest.mock import AsyncMock, MagicMock

import grpc
import pytest

from app.handlers.servicer import IndicatorsServicer
from app.services.formulas_repository import FormulasRepository

# ---------------------------------------------------------------------------
# FormulasRepository — asyncpg pool mocked
# ---------------------------------------------------------------------------


class TestFormulasRepository:
    async def test_create_calls_pool_fetchrow(self):
        pool = MagicMock()
        pool.fetchrow = AsyncMock(
            return_value={
                "formula_id": "11111111-1111-1111-1111-111111111111",
                "name": "RSI",
                "description": "",
                "source": "x = 1",
                "author": "user-1",
                "is_public": False,
                "input_schema": "{}",
            }
        )
        repo = FormulasRepository(pool)
        result = await repo.create(
            formula_id="11111111-1111-1111-1111-111111111111",
            name="RSI",
            description="",
            source="x = 1",
            author="user-1",
            is_public=False,
            input_schema={},
        )
        pool.fetchrow.assert_awaited_once()
        assert result["formula_id"] == "11111111-1111-1111-1111-111111111111"
        # JSONB string decoded back to a dict
        assert result["input_schema"] == {}

    async def test_create_round_trips_parameters(self):
        pool = MagicMock()
        pool.fetchrow = AsyncMock(
            return_value={
                "formula_id": "11111111-1111-1111-1111-111111111111",
                "name": "RSI",
                "input_schema": "{}",
                # JSONB array stored as a string, decoded back to a list
                "parameters": '[{"name": "period", "type": "PARAMETER_TYPE_INT"}]',
            }
        )
        repo = FormulasRepository(pool)
        result = await repo.create(
            formula_id="11111111-1111-1111-1111-111111111111",
            name="RSI",
            description="",
            source="x = 1",
            author="user-1",
            is_public=False,
            input_schema={},
            parameters=[{"name": "period", "type": "PARAMETER_TYPE_INT"}],
        )
        assert result["parameters"] == [{"name": "period", "type": "PARAMETER_TYPE_INT"}]

    async def test_list_decodes_parameters(self):
        row = {"formula_id": "a", "name": "f1", "input_schema": "{}", "parameters": "[]"}
        pool = MagicMock()
        pool.fetchval = AsyncMock(return_value=1)
        pool.fetch = AsyncMock(return_value=[row])
        repo = FormulasRepository(pool)
        rows, _ = await repo.list(
            author_filter="user-1", include_public=True, page_size=0, page_offset=0
        )
        assert rows[0]["parameters"] == []

    async def test_get_by_id_returns_none_when_not_found(self):
        pool = MagicMock()
        pool.fetchrow = AsyncMock(return_value=None)
        repo = FormulasRepository(pool)
        assert await repo.get_by_id("x") is None

    async def test_list_returns_rows_and_total(self):
        row1 = {"formula_id": "a", "name": "f1", "input_schema": "{}"}
        row2 = {"formula_id": "b", "name": "f2", "input_schema": '{"k": "v"}'}
        pool = MagicMock()
        pool.fetchval = AsyncMock(return_value=2)
        pool.fetch = AsyncMock(return_value=[row1, row2])
        repo = FormulasRepository(pool)
        rows, total = await repo.list(
            author_filter="user-1", include_public=True, page_size=50, page_offset=0
        )
        assert total == 2
        assert len(rows) == 2
        assert rows[1]["input_schema"] == {"k": "v"}

    async def test_delete_returns_true_on_success(self):
        pool = MagicMock()
        pool.execute = AsyncMock(return_value="DELETE 1")
        repo = FormulasRepository(pool)
        assert await repo.delete("x") is True

    async def test_delete_returns_false_when_not_found(self):
        pool = MagicMock()
        pool.execute = AsyncMock(return_value="DELETE 0")
        repo = FormulasRepository(pool)
        assert await repo.delete("x") is False


# ---------------------------------------------------------------------------
# IndicatorsServicer CRUD — in-memory fallback (db_pool=None)
# ---------------------------------------------------------------------------


class TestIndicatorsServicerCRUD:
    def _servicer(self):
        return IndicatorsServicer(config_watcher=MagicMock())

    async def test_list_formulas_empty_when_no_repo(self):
        servicer = self._servicer()
        req = MagicMock(author_filter="", include_public=False, page_size=0, page_offset=0)
        resp = await servicer.ListFormulas(req, MagicMock())
        assert resp.total_count == 0

    async def test_update_formula_unavailable_when_no_repo(self):
        servicer = self._servicer()
        ctx = MagicMock()
        ctx.abort = AsyncMock(side_effect=Exception("aborted"))
        with pytest.raises(Exception):
            await servicer.UpdateFormula(MagicMock(), ctx)
        ctx.abort.assert_awaited_once()
        assert ctx.abort.await_args.args[0] == grpc.StatusCode.UNAVAILABLE

    async def test_delete_formula_unavailable_when_no_repo(self):
        servicer = self._servicer()
        ctx = MagicMock()
        ctx.abort = AsyncMock(side_effect=Exception("aborted"))
        with pytest.raises(Exception):
            await servicer.DeleteFormula(MagicMock(), ctx)
        ctx.abort.assert_awaited_once()
        assert ctx.abort.await_args.args[0] == grpc.StatusCode.UNAVAILABLE


# ---------------------------------------------------------------------------
# RegisterFormula author gate (feature 049 Part A, OQ-A) — close the
# silent "dev-user" default; require an authenticated author.
# ---------------------------------------------------------------------------


def _ctx(metadata: list[tuple[str, str]]):
    ctx = MagicMock()
    ctx.invocation_metadata = MagicMock(return_value=metadata)
    return ctx


class TestRegisterFormulaAuthorGate:
    def _servicer(self):
        return IndicatorsServicer(config_watcher=MagicMock())

    async def test_defaults_author_to_x_user_id(self):
        from gen.indicators.v1 import indicators_pb2

        servicer = self._servicer()  # repo is None → in-memory path
        req = indicators_pb2.RegisterFormulaRequest(name="f", source="x = 1")
        ctx = _ctx([("x-user-id", "user-42")])
        resp = await servicer.RegisterFormula(req, ctx)
        stored = servicer._formulas[resp.formula_id]
        assert stored.author == "user-42"

    async def test_explicit_author_wins(self):
        from gen.indicators.v1 import indicators_pb2

        servicer = self._servicer()
        req = indicators_pb2.RegisterFormulaRequest(name="f", source="x = 1", author="explicit")
        ctx = _ctx([("x-user-id", "user-42")])
        resp = await servicer.RegisterFormula(req, ctx)
        assert servicer._formulas[resp.formula_id].author == "explicit"

    async def test_aborts_without_author_or_user_id(self):
        from gen.indicators.v1 import indicators_pb2

        servicer = self._servicer()
        req = indicators_pb2.RegisterFormulaRequest(name="f", source="x = 1")
        ctx = _ctx([])
        ctx.abort = AsyncMock(side_effect=Exception("aborted"))
        with pytest.raises(Exception):
            await servicer.RegisterFormula(req, ctx)
        assert ctx.abort.await_args.args[0] == grpc.StatusCode.INVALID_ARGUMENT


# ---------------------------------------------------------------------------
# Update/Delete admin-scope override (feature 049 Part A, OQ-A)
# ---------------------------------------------------------------------------


def _repo_servicer(author: str):
    servicer = IndicatorsServicer(config_watcher=MagicMock())
    repo = MagicMock()
    repo.get_by_id = AsyncMock(return_value={"author": author})
    repo.update = AsyncMock(
        return_value={
            "formula_id": "f",
            "name": "n",
            "description": "",
            "source": "x = 1",
            "author": author,
            "is_public": False,
            "input_schema": {},
        }
    )
    repo.delete = AsyncMock(return_value=True)
    servicer._repo = repo
    return servicer


class TestExecuteFormulaParameterErrors:
    async def test_out_of_range_param_returns_parameter_errors(self):
        from gen.indicators.v1 import indicators_pb2

        servicer = IndicatorsServicer(config_watcher=MagicMock())
        repo = MagicMock()
        repo.get_by_id = AsyncMock(
            return_value={
                "formula_id": "f-1",
                "name": "f",
                "description": "",
                "source": "result = params['period']",
                "author": "user-1",
                "is_public": False,
                "input_schema": {},
                "parameters": [
                    {"name": "period", "type": "PARAMETER_TYPE_INT", "min": 1, "max": 200}
                ],
            }
        )
        servicer._repo = repo

        req = indicators_pb2.ExecuteFormulaRequest(formula_id="f-1")
        req.input_params.update({"period": 500})  # above max → validation fails

        resp = await servicer.ExecuteFormula(req, MagicMock())
        assert resp.success is False
        assert [e.name for e in resp.parameter_errors] == ["period"]
        assert "maximum" in resp.parameter_errors[0].reason


class TestFormulaAdminOverride:
    async def test_owner_updates_without_admin_scope(self):
        from gen.indicators.v1 import indicators_pb2

        servicer = _repo_servicer(author="user-1")
        req = indicators_pb2.UpdateFormulaRequest(formula_id="f", user_id="user-1", name="n")
        resp = await servicer.UpdateFormula(req, _ctx([]))
        assert resp.formula.formula_id == "f"

    async def test_non_owner_admin_override_updates(self):
        from gen.indicators.v1 import indicators_pb2

        servicer = _repo_servicer(author="owner")
        req = indicators_pb2.UpdateFormulaRequest(formula_id="f", user_id="someone-else", name="n")
        resp = await servicer.UpdateFormula(req, _ctx([("x-access-scope", "7")]))
        assert resp.formula.formula_id == "f"

    async def test_non_owner_no_admin_denied(self):
        from gen.indicators.v1 import indicators_pb2

        servicer = _repo_servicer(author="owner")
        req = indicators_pb2.UpdateFormulaRequest(formula_id="f", user_id="someone-else", name="n")
        ctx = _ctx([("x-access-scope", "1")])
        ctx.abort = AsyncMock(side_effect=Exception("aborted"))
        with pytest.raises(Exception):
            await servicer.UpdateFormula(req, ctx)
        assert ctx.abort.await_args.args[0] == grpc.StatusCode.PERMISSION_DENIED

    async def test_delete_non_owner_admin_override(self):
        from gen.indicators.v1 import indicators_pb2

        servicer = _repo_servicer(author="owner")
        req = indicators_pb2.DeleteFormulaRequest(formula_id="f", user_id="someone-else")
        resp = await servicer.DeleteFormula(req, _ctx([("x-access-scope", "7")]))
        assert resp.success is True

    async def test_delete_non_owner_no_admin_denied(self):
        from gen.indicators.v1 import indicators_pb2

        servicer = _repo_servicer(author="owner")
        req = indicators_pb2.DeleteFormulaRequest(formula_id="f", user_id="someone-else")
        ctx = _ctx([("x-access-scope", "0")])
        ctx.abort = AsyncMock(side_effect=Exception("aborted"))
        with pytest.raises(Exception):
            await servicer.DeleteFormula(req, ctx)
        assert ctx.abort.await_args.args[0] == grpc.StatusCode.PERMISSION_DENIED

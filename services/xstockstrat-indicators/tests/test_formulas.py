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

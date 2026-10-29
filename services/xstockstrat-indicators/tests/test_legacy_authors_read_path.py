"""After the legacy-author repair the owner reads their formula through the real servicer read path
(feature 276, AC-1), non-owners still cannot (AC-6), and a warm cache keeps the old author until the
servicer restarts. Regression origin:
docs/reports/2026-10-22-indicators-legacy-username-formula-authors-defect.md."""

import json
from unittest.mock import AsyncMock, MagicMock

import grpc
import pytest
from gen.indicators.v1 import indicators_pb2

from app.handlers.servicer import IndicatorsServicer
from app.maintenance import legacy_authors as la
from app.services import sandbox
from app.services.sandbox import SandboxResult
from tests.conftest import USERS, FakeFormulasTable, ctx_with, make_formula_row

FORMULA_ID = "31bb8ea6-0f3e-4cf7-8844-ec8294cebf85"
OWNER_ID = "80880990-2b79-4d85-8761-d8d9102c2efb"
BOB_ID = "22222222-2222-4222-8222-222222222222"
GET_BY_ID_SQL = "SELECT * FROM indicators.formulas WHERE formula_id = $1::uuid"


class _FakePool(FakeFormulasTable):
    """FakeFormulasTable plus the FormulasRepository.get_by_id read."""

    async def fetchrow(self, sql, *args):
        if sql == GET_BY_ID_SQL:
            row = self.rows.get(args[0])
            return dict(row) if row is not None else None
        return await super().fetchrow(sql, *args)


def _cfg():
    cfg = MagicMock()
    cfg.sandbox_max_concurrent.return_value = 4
    cfg.sandbox_timeout_ms = 5_000
    cfg.sandbox_memory_bytes = 128 * 1024 * 1024
    cfg.sandbox_allowed_imports = []
    return cfg


def _ctx(user_id, scope="1"):
    return ctx_with([("x-user-id", user_id), ("x-access-scope", scope), ("x-trace-id", "t-1")])


def _get(formula_id=FORMULA_ID):
    return indicators_pb2.GetFormulaRequest(formula_id=formula_id)


def _exec(formula_id=FORMULA_ID):
    return indicators_pb2.ExecuteFormulaRequest(formula_id=formula_id)


@pytest.fixture
def pool():
    return _FakePool([make_formula_row(FORMULA_ID, "davcs86")])


@pytest.fixture(autouse=True)
def _stub_sandbox(monkeypatch):
    monkeypatch.setattr(
        sandbox,
        "execute_formula",
        lambda **_: SandboxResult(
            success=True,
            output={"value": 1.0},
            stdout="",
            stderr="",
            execution_ms=1,
            memory_used_bytes=0,
            error="",
            exit_reason="success",
        ),
    )


async def _repair(pool, tmp_path):
    users_path = tmp_path / "users.json"
    users_path.write_text(json.dumps(USERS))
    users = la.load_users(users_path)
    plan_path = tmp_path / "plan.json"
    plan = await la.run_report(pool, users, plan_path, run_id="run-1", target=("h", "d"))
    for e in plan["entries"]:
        if e["status"] == "suggested":
            e["status"] = "confirmed"
    plan_path.write_text(json.dumps(plan, indent=2) + "\n")
    result = await la.run_apply(
        pool, users, plan_path, la.plan_digest(plan_path), run_id="run-2", target=("h", "d")
    )
    assert result["counts"]["rewritten"] == 1
    assert pool.rows[FORMULA_ID]["author"] == OWNER_ID


async def _assert_aborts(call, ctx, code):
    with pytest.raises(grpc.RpcError):
        await call
    assert ctx.abort.await_args.args[0] == code


async def test_owner_reads_after_repair_cold_cache(pool, tmp_path):
    ctx = _ctx(OWNER_ID)
    before = IndicatorsServicer(config_watcher=_cfg(), db_pool=pool)
    await _assert_aborts(before.GetFormula(_get(), ctx), ctx, grpc.StatusCode.NOT_FOUND)

    await _repair(pool, tmp_path)

    resp = await IndicatorsServicer(config_watcher=_cfg(), db_pool=pool).GetFormula(
        _get(), _ctx(OWNER_ID)
    )
    assert resp.author == OWNER_ID
    run = await IndicatorsServicer(config_watcher=_cfg(), db_pool=pool).ExecuteFormula(
        _exec(), _ctx(OWNER_ID)
    )
    assert run.success


async def test_non_owner_still_not_found_after_repair(pool, tmp_path):
    await _repair(pool, tmp_path)
    svc = IndicatorsServicer(config_watcher=_cfg(), db_pool=pool)

    ctx = _ctx(BOB_ID)
    await _assert_aborts(svc.ExecuteFormula(_exec(), ctx), ctx, grpc.StatusCode.NOT_FOUND)
    ctx = _ctx(BOB_ID)
    await _assert_aborts(svc.GetFormula(_get(), ctx), ctx, grpc.StatusCode.NOT_FOUND)
    ctx = _ctx(BOB_ID, scope="4")
    await _assert_aborts(svc.ExecuteFormula(_exec(), ctx), ctx, grpc.StatusCode.PERMISSION_DENIED)


async def test_stale_cache_requires_restart(pool, tmp_path):
    warm = IndicatorsServicer(config_watcher=_cfg(), db_pool=pool)
    warm._ledger = MagicMock(AppendEvent=AsyncMock())
    admin_read = await warm.GetFormula(_get(), _ctx(BOB_ID, scope="4"))
    assert admin_read.author == "davcs86"

    await _repair(pool, tmp_path)

    ctx = _ctx(OWNER_ID)
    await _assert_aborts(warm.GetFormula(_get(), ctx), ctx, grpc.StatusCode.NOT_FOUND)
    restarted = IndicatorsServicer(config_watcher=_cfg(), db_pool=pool)
    assert (await restarted.GetFormula(_get(), _ctx(OWNER_ID))).author == OWNER_ID

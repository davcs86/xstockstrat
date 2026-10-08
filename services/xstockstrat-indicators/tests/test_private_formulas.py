"""Feature 224 — private-by-default formulas: owner + system visibility, header-only identity,
audited admin read, admin mutation denied, reserved `system` identity bound to the mTLS peer SAN."""

from unittest.mock import AsyncMock, MagicMock

import grpc
import pytest
from gen.indicators.v1 import indicators_pb2

from app.formulas import SYSTEM_AUTHOR
from app.handlers.servicer import IndicatorsServicer
from app.services.formulas_repository import FormulasRepository
from tests.conftest import ctx_with

SYSTEM_ID = "d1ff5e6b-6d9c-589d-b95e-defd862c702b"
ADMIN_SCOPE = "7"
FUNDSIGNAL_GRANT = [("x-user-id", SYSTEM_AUTHOR), ("x-internal-caller", "analysis-fundsignal")]


def _cfg():
    cfg = MagicMock()
    cfg.sandbox_timeout_ms = 5000
    cfg.sandbox_memory_bytes = 256 * 1024 * 1024
    cfg.sandbox_allowed_imports = []
    cfg.sandbox_max_concurrent.return_value = 4
    return cfg


def _row(formula_id, author, pending_intent_id=None, is_public=False):
    return {
        "formula_id": formula_id,
        "name": formula_id,
        "description": "",
        "source": "result = {'value': 1}",
        "author": author,
        "is_public": is_public,
        "input_schema": {},
        "parameters": [],
        "outputs": [],
        "warmup_period": 0,
        "created_at": None,
        "updated_at": None,
        "deleted_at": None,
        "pending_intent_id": pending_intent_id,
    }


def _servicer(rows=(), audit_error=None):
    svc = IndicatorsServicer(config_watcher=_cfg())
    by_id = {r["formula_id"]: r for r in rows}
    repo = MagicMock(spec=FormulasRepository)
    repo.get_by_id = AsyncMock(side_effect=lambda fid: by_id.get(fid))
    repo.create = AsyncMock(return_value=None)
    repo.update = AsyncMock(side_effect=lambda **kw: by_id[kw["formula_id"]])
    repo.delete = AsyncMock(return_value=True)
    svc._repo = repo
    svc._ledger = MagicMock()
    svc._ledger.AppendEvent = AsyncMock(side_effect=audit_error)
    return svc, repo


def _admin(peer_sans=()):
    return ctx_with(
        [("x-user-id", "admin"), ("x-access-scope", ADMIN_SCOPE), ("x-trace-id", "t-1")],
        peer_sans,
    )


def _repo_pool(rows):
    pool = MagicMock()
    pool.fetchval = AsyncMock(return_value=len(rows))
    pool.fetch = AsyncMock(return_value=rows)
    return pool


class TestListOwnPlusSystem:
    async def test_ac2_foreign_author_filter_and_include_public_are_ignored(self):
        """AC-2: bob asking for alice's (public) formulas gets only his own + the system one."""
        pool = _repo_pool([_row("f-b1", "bob"), _row(SYSTEM_ID, SYSTEM_AUTHOR)])
        svc = IndicatorsServicer(config_watcher=_cfg(), db_pool=pool)
        svc._ledger = MagicMock(AppendEvent=AsyncMock())
        req = indicators_pb2.ListFormulasRequest(author_filter="alice", include_public=True)

        resp = await svc.ListFormulas(req, ctx_with([("x-user-id", "bob")]))

        assert [f.formula_id for f in resp.formulas] == ["f-b1", SYSTEM_ID]
        sql, *params = pool.fetch.await_args.args
        assert "deleted_at IS NULL" in sql and "pending_intent_id IS NULL" in sql
        assert "(author = $1 OR author = 'system')" in sql
        assert "is_public" not in sql
        assert params[0] == "bob"
        svc._ledger.AppendEvent.assert_not_awaited()

    async def test_repo_list_visible_pages(self):
        pool = _repo_pool([])
        rows, total = await FormulasRepository(pool).list_visible("bob", 10, 20)
        sql, *params = pool.fetch.await_args.args
        assert params == ["bob", 10, 20] and "LIMIT $2 OFFSET $3" in sql
        assert (rows, total) == ([], 0)

    async def test_admin_owner_selector_lists_that_owner_and_audits(self):
        pool = _repo_pool([_row("f-a1", "alice"), _row("f-a2", "alice")])
        svc = IndicatorsServicer(config_watcher=_cfg(), db_pool=pool)
        svc._ledger = MagicMock(AppendEvent=AsyncMock())
        req = indicators_pb2.ListFormulasRequest(author_filter="alice")

        resp = await svc.ListFormulas(req, _admin())

        assert [f.formula_id for f in resp.formulas] == ["f-a1", "f-a2"]
        sql, *params = pool.fetch.await_args.args
        assert "author = $1" in sql and "'system'" not in sql and params[0] == "alice"
        keys = sorted(c.args[0].stream_key for c in svc._ledger.AppendEvent.await_args_list)
        assert keys == ["user:admin", "user:alice"]

    async def test_admin_own_listing_is_not_audited(self):
        pool = _repo_pool([_row("f-x", "admin")])
        svc = IndicatorsServicer(config_watcher=_cfg(), db_pool=pool)
        svc._ledger = MagicMock(AppendEvent=AsyncMock())
        await svc.ListFormulas(indicators_pb2.ListFormulasRequest(author_filter="admin"), _admin())
        assert "'system'" in pool.fetch.await_args.args[0]
        svc._ledger.AppendEvent.assert_not_awaited()

    async def test_in_memory_list_is_own_plus_system(self):
        svc = IndicatorsServicer(config_watcher=_cfg())
        for fid, author in (("f-a", "alice"), ("f-b", "bob"), ("f-s", SYSTEM_AUTHOR)):
            svc._formulas[fid] = indicators_pb2.FormulaDefinition(
                formula_id=fid, author=author, is_public=True
            )
        resp = await svc.ListFormulas(
            indicators_pb2.ListFormulasRequest(include_public=True),
            ctx_with([("x-user-id", "bob")]),
        )
        assert sorted(f.formula_id for f in resp.formulas) == ["f-b", "f-s"]


class TestRegisterPrivateAndHeaderAuthor:
    async def test_ac3_is_public_true_is_stored_false_and_invisible(self):
        svc, repo = _servicer()
        req = indicators_pb2.RegisterFormulaRequest(name="f", source="x = 1", is_public=True)
        resp = await svc.RegisterFormula(req, ctx_with([("x-user-id", "alice")]))

        assert repo.create.await_args.kwargs["is_public"] is False
        assert svc._formulas[resp.formula_id].is_public is False
        ctx = ctx_with([("x-user-id", "bob")])
        with pytest.raises(grpc.RpcError):
            await svc.GetFormula(indicators_pb2.GetFormulaRequest(formula_id=resp.formula_id), ctx)
        assert ctx.abort.await_args.args[0] == grpc.StatusCode.NOT_FOUND

    async def test_ac4_body_author_is_ignored(self):
        svc, repo = _servicer()
        req = indicators_pb2.RegisterFormulaRequest(name="f", source="x = 1", author=SYSTEM_AUTHOR)
        resp = await svc.RegisterFormula(req, ctx_with([("x-user-id", "bob")]))
        assert repo.create.await_args.kwargs["author"] == "bob"
        assert svc._formulas[resp.formula_id].author == "bob"

    async def test_body_author_without_header_is_rejected(self):
        svc, repo = _servicer()
        req = indicators_pb2.RegisterFormulaRequest(name="f", source="x = 1", author="alice")
        ctx = ctx_with([])
        with pytest.raises(grpc.RpcError):
            await svc.RegisterFormula(req, ctx)
        assert ctx.abort.await_args.args[0] == grpc.StatusCode.INVALID_ARGUMENT
        repo.create.assert_not_awaited()


class TestReservedSystemIdentity:
    async def test_ac6_fundsignal_grant_with_san_executes_system_formula(self):
        svc, _ = _servicer([_row(SYSTEM_ID, SYSTEM_AUTHOR)])
        resp = await svc.ExecuteFormula(
            indicators_pb2.ExecuteFormulaRequest(formula_id=SYSTEM_ID),
            ctx_with(FUNDSIGNAL_GRANT, ("xstockstrat-analysis",)),
        )
        assert resp.success is True, resp.error

    async def test_ac6_fundsignal_grant_without_san_is_denied(self):
        svc, _ = _servicer([_row(SYSTEM_ID, SYSTEM_AUTHOR)])
        ctx = ctx_with(FUNDSIGNAL_GRANT)
        req = indicators_pb2.ExecuteFormulaRequest(formula_id=SYSTEM_ID)
        with pytest.raises(grpc.RpcError):
            await svc.ExecuteFormula(req, ctx)
        assert ctx.abort.await_args.args[0] == grpc.StatusCode.PERMISSION_DENIED

    @pytest.mark.parametrize(
        "method,request_",
        [
            ("GetFormula", indicators_pb2.GetFormulaRequest(formula_id=SYSTEM_ID)),
            ("ListFormulas", indicators_pb2.ListFormulasRequest()),
            ("RegisterFormula", indicators_pb2.RegisterFormulaRequest(name="f", source="x = 1")),
            ("UpdateFormula", indicators_pb2.UpdateFormulaRequest(formula_id="f-a", name="n")),
            ("DeleteFormula", indicators_pb2.DeleteFormulaRequest(formula_id="f-a")),
        ],
    )
    async def test_ungranted_system_identity_is_denied_everywhere(self, method, request_):
        svc, repo = _servicer([_row(SYSTEM_ID, SYSTEM_AUTHOR), _row("f-a", "alice")])
        ctx = ctx_with([("x-user-id", SYSTEM_AUTHOR)], ("xstockstrat-agent",))
        with pytest.raises(grpc.RpcError):
            await getattr(svc, method)(request_, ctx)
        assert ctx.abort.await_args.args[0] == grpc.StatusCode.PERMISSION_DENIED
        repo.create.assert_not_awaited()
        repo.update.assert_not_awaited()
        repo.delete.assert_not_awaited()


class TestAdminReadAndMutation:
    async def test_ac23_admin_update_of_system_formula_denied(self):
        svc, repo = _servicer([_row(SYSTEM_ID, SYSTEM_AUTHOR)])
        ctx = _admin()
        with pytest.raises(grpc.RpcError):
            await svc.UpdateFormula(
                indicators_pb2.UpdateFormulaRequest(formula_id=SYSTEM_ID, name="n"), ctx
            )
        assert ctx.abort.await_args.args[0] == grpc.StatusCode.PERMISSION_DENIED
        repo.update.assert_not_awaited()

    async def test_ac28_admin_get_of_foreign_formula_returns_and_audits_twice(self):
        svc, _ = _servicer([_row("f-a", "alice")])
        resp = await svc.GetFormula(indicators_pb2.GetFormulaRequest(formula_id="f-a"), _admin())

        assert resp.formula_id == "f-a" and resp.author == "alice"
        calls = svc._ledger.AppendEvent.await_args_list
        assert sorted(c.args[0].stream_key for c in calls) == ["user:admin", "user:alice"]
        assert {c.args[0].event_type for c in calls} == {"audit.admin_read"}
        assert {c.args[0].source_service for c in calls} == {"xstockstrat-indicators"}
        for c in calls:
            assert dict(c.kwargs["metadata"]) == {
                "x-user-id": "admin",
                "x-access-scope": ADMIN_SCOPE,
                "x-trace-id": "t-1",
            }

    async def test_ac28_audit_failure_fails_closed_unavailable(self):
        svc, _ = _servicer([_row("f-a", "alice")], audit_error=grpc.RpcError("ledger down"))
        ctx = _admin()
        with pytest.raises(grpc.RpcError):
            await svc.GetFormula(indicators_pb2.GetFormulaRequest(formula_id="f-a"), ctx)
        assert ctx.abort.await_args.args[0] == grpc.StatusCode.UNAVAILABLE

    async def test_admin_get_of_own_formula_is_not_audited(self):
        svc, _ = _servicer([_row("f-x", "admin")])
        await svc.GetFormula(indicators_pb2.GetFormulaRequest(formula_id="f-x"), _admin())
        svc._ledger.AppendEvent.assert_not_awaited()

    @pytest.mark.parametrize(
        "method,request_",
        [
            ("UpdateFormula", indicators_pb2.UpdateFormulaRequest(formula_id="f-a", name="n")),
            ("DeleteFormula", indicators_pb2.DeleteFormulaRequest(formula_id="f-a")),
            ("ExecuteFormula", indicators_pb2.ExecuteFormulaRequest(formula_id="f-a")),
        ],
    )
    async def test_ac28_admin_mutation_and_execute_denied(self, method, request_):
        svc, repo = _servicer([_row("f-a", "alice")])
        ctx = _admin()
        with pytest.raises(grpc.RpcError):
            await getattr(svc, method)(request_, ctx)
        assert ctx.abort.await_args.args[0] == grpc.StatusCode.PERMISSION_DENIED
        repo.update.assert_not_awaited()
        repo.delete.assert_not_awaited()
        svc._ledger.AppendEvent.assert_not_awaited()

    async def test_execute_missing_formula_is_not_found_even_for_admin(self):
        svc, _ = _servicer()
        ctx = _admin()
        with pytest.raises(grpc.RpcError):
            await svc.ExecuteFormula(indicators_pb2.ExecuteFormulaRequest(formula_id="nope"), ctx)
        assert ctx.abort.await_args.args[0] == grpc.StatusCode.NOT_FOUND

    async def test_execute_foreign_formula_non_admin_is_not_found(self):
        svc, _ = _servicer([_row("f-a", "alice")])
        ctx = ctx_with([("x-user-id", "bob"), ("x-access-scope", "1")])
        with pytest.raises(grpc.RpcError):
            await svc.ExecuteFormula(indicators_pb2.ExecuteFormulaRequest(formula_id="f-a"), ctx)
        assert ctx.abort.await_args.args[0] == grpc.StatusCode.NOT_FOUND


class TestPendingAndCache:
    @pytest.mark.parametrize("method", ["GetFormula", "ExecuteFormula"])
    async def test_pending_intent_row_is_not_found_and_never_cached(self, method):
        svc, _ = _servicer([_row("f-p", "alice", pending_intent_id="0e1c2d3f-0000-0000-0000-01")])
        req = (
            indicators_pb2.GetFormulaRequest(formula_id="f-p")
            if method == "GetFormula"
            else indicators_pb2.ExecuteFormulaRequest(formula_id="f-p")
        )
        ctx = ctx_with([("x-user-id", "alice")])
        with pytest.raises(grpc.RpcError):
            await getattr(svc, method)(req, ctx)
        assert ctx.abort.await_args.args[0] == grpc.StatusCode.NOT_FOUND
        assert "f-p" not in svc._formulas

    async def test_unauthorized_read_does_not_fill_cache(self):
        svc, _ = _servicer([_row("f-a", "alice")])
        with pytest.raises(grpc.RpcError):
            await svc.GetFormula(
                indicators_pb2.GetFormulaRequest(formula_id="f-a"),
                ctx_with([("x-user-id", "bob")]),
            )
        assert "f-a" not in svc._formulas
        await svc.GetFormula(
            indicators_pb2.GetFormulaRequest(formula_id="f-a"), ctx_with([("x-user-id", "alice")])
        )
        assert "f-a" in svc._formulas

    async def test_reads_always_report_is_public_false(self):
        svc, _ = _servicer([_row("f-a", "alice", is_public=True)])
        resp = await svc.GetFormula(
            indicators_pb2.GetFormulaRequest(formula_id="f-a"), ctx_with([("x-user-id", "alice")])
        )
        assert resp.is_public is False

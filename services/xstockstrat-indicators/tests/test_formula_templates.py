"""Feature 224 — formula template catalog: admin authoring, snapshot instantiation,
update-available origin on reads, retire, and the analysis strategy-template saga."""

import datetime
import uuid
from unittest.mock import AsyncMock, MagicMock

import grpc
import pytest
from gen.common.v1 import common_pb2
from gen.indicators.v1 import indicators_pb2
from google.protobuf.json_format import MessageToDict

from app.handlers.servicer import IndicatorsServicer
from app.services.formula_templates_repository import FormulaTemplatesRepository
from app.services.formulas_repository import FormulasRepository
from tests.conftest import ctx_with

ADMIN_SCOPE = "7"
ANALYSIS_SAN = ("xstockstrat-analysis",)
SAGA_GRANT = "analysis-template-saga"
INTENT = "6f1d3c1e-8a4b-4f43-9a55-0c2e7f1a9b10"


def _cfg():
    cfg = MagicMock()
    cfg.sandbox_timeout_ms = 5000
    cfg.sandbox_memory_bytes = 256 * 1024 * 1024
    cfg.sandbox_allowed_imports = []
    cfg.sandbox_max_concurrent.return_value = 4
    return cfg


def _payload(source="result = {'value': 1, 'z': 0}", **kw):
    return indicators_pb2.RegisterFormulaRequest(
        name="Z-Score",
        description="rolling z-score",
        source=source,
        is_public=True,
        author="mallory",
        outputs=[indicators_pb2.FormulaOutput(name="z")],
        warmup_period=20,
        **kw,
    )


def _template(template_id="tpl-zscore", payload=None):
    return indicators_pb2.FormulaTemplate(
        meta=common_pb2.TemplateMeta(template_id=template_id, name="Z-Score", description="z"),
        payload=payload or _payload(),
    )


class _FakeTemplates:
    """In-memory stand-in for FormulaTemplatesRepository (same method contract)."""

    def __init__(self):
        self.rows: dict[str, dict] = {}
        self.latest_calls = 0

    async def list_active(self):
        return [r for r in self.rows.values() if r["retired_at"] is None]

    async def get(self, template_id):
        return self.rows.get(template_id)

    async def create(self, meta, payload_json, created_by):
        now = datetime.datetime.now(datetime.UTC)
        row = {
            "template_id": meta.template_id,
            "name": meta.name,
            "description": meta.description,
            "payload": payload_json,
            "version": 1,
            "retired_at": None,
            "created_by": created_by,
            "created_at": now,
            "updated_at": now,
        }
        self.rows[meta.template_id] = row
        return row

    async def update(self, template_id, payload_json):
        row = self.rows.get(template_id)
        if row is None or row["retired_at"] is not None:
            return None
        row["payload"] = payload_json
        row["version"] += 1
        return row

    async def retire(self, template_id):
        row = self.rows.get(template_id)
        if row is None:
            return None
        row["retired_at"] = row["retired_at"] or datetime.datetime.now(datetime.UTC)
        return row

    async def latest_versions(self, ids):
        self.latest_calls += 1
        return {
            i: self.rows[i]["version"]
            for i in ids
            if i in self.rows and self.rows[i]["retired_at"] is None
        }


class _FakeFormulas:
    """In-memory stand-in for FormulasRepository (same method contract)."""

    def __init__(self):
        self.rows: dict[str, dict] = {}
        self.pending_batches = 0

    def _store(self, kw, pending_intent_id=None):
        row = {
            "formula_id": kw["formula_id"],
            "name": kw["name"],
            "description": kw.get("description") or "",
            "source": kw["source"],
            "author": kw["author"],
            "is_public": False,
            "input_schema": kw.get("input_schema") or {},
            "parameters": kw.get("parameters") or [],
            "outputs": kw.get("outputs") or [],
            "warmup_period": kw.get("warmup_period") or 0,
            "fundamental_inputs": kw.get("fundamental_inputs") or [],
            "origin_template_id": kw.get("origin_template_id"),
            "origin_template_version": kw.get("origin_template_version"),
            "pending_intent_id": pending_intent_id,
            "created_at": None,
            "updated_at": None,
            "deleted_at": None,
        }
        self.rows[row["formula_id"]] = row
        return row

    async def create(self, **kw):
        return self._store(kw)

    async def create_pending_copies(self, copies, intent_id):
        self.pending_batches += 1
        return [self._store(c, pending_intent_id=intent_id) for c in copies]

    async def get_by_id(self, formula_id):
        return self.rows.get(formula_id)

    async def list_visible(self, reader, page_size, page_offset):
        rows = [
            r
            for r in self.rows.values()
            if r["author"] in (reader, "system") and r["pending_intent_id"] is None
        ]
        return rows, len(rows)

    async def resolve_intent(self, intent_id, author, commit):
        ids = [
            fid
            for fid, r in self.rows.items()
            if r["pending_intent_id"] == intent_id and r["author"] == author
        ]
        for fid in ids:
            if commit:
                self.rows[fid]["pending_intent_id"] = None
            else:
                del self.rows[fid]
        return ids


def _servicer():
    svc = IndicatorsServicer(config_watcher=_cfg())
    svc._repo = _FakeFormulas()
    svc._templates_repo = _FakeTemplates()
    return svc


def _admin():
    return ctx_with([("x-user-id", "admin"), ("x-access-scope", ADMIN_SCOPE)])


def _user(user_id):
    return ctx_with([("x-user-id", user_id)])


def _saga(owner="bob", caller=SAGA_GRANT, peer_sans=ANALYSIS_SAN):
    return ctx_with([("x-user-id", owner), ("x-internal-caller", caller)], peer_sans)


def _code(ctx):
    return ctx.abort.call_args[0][0]


async def _manage(svc, op, tpl=None):
    return await svc.ManageTemplate(
        indicators_pb2.ManageTemplateRequest(operation=op, template=tpl or _template()),
        _admin(),
    )


async def _seed(svc, versions=1, template_id="tpl-zscore"):
    await _manage(svc, common_pb2.TEMPLATE_OPERATION_CREATE, _template(template_id))
    for _ in range(versions - 1):
        await _manage(svc, common_pb2.TEMPLATE_OPERATION_UPDATE, _template(template_id))


async def _instantiate(svc, user="bob", template_id="tpl-zscore"):
    resp = await svc.InstantiateTemplate(
        indicators_pb2.InstantiateTemplateRequest(template_id=template_id), _user(user)
    )
    return resp.formula


class TestAuthoring:
    async def test_ac13_non_admin_create_is_permission_denied(self):
        svc = _servicer()
        ctx = _user("bob")
        with pytest.raises(grpc.RpcError):
            await svc.ManageTemplate(
                indicators_pb2.ManageTemplateRequest(
                    operation=common_pb2.TEMPLATE_OPERATION_CREATE, template=_template()
                ),
                ctx,
            )
        assert _code(ctx) == grpc.StatusCode.PERMISSION_DENIED
        assert svc._templates_repo.rows == {}

    @pytest.mark.parametrize(
        "op", [common_pb2.TEMPLATE_OPERATION_UPDATE, common_pb2.TEMPLATE_OPERATION_RETIRE]
    )
    async def test_ac13_non_admin_update_and_retire_are_denied(self, op):
        svc = _servicer()
        await _seed(svc)
        ctx = _user("bob")
        with pytest.raises(grpc.RpcError):
            await svc.ManageTemplate(
                indicators_pb2.ManageTemplateRequest(operation=op, template=_template()), ctx
            )
        assert _code(ctx) == grpc.StatusCode.PERMISSION_DENIED

    async def test_ac14_admin_update_bumps_version_and_bob_lists_it(self):
        svc = _servicer()
        created = await _manage(svc, common_pb2.TEMPLATE_OPERATION_CREATE)
        assert created.meta.version == 1
        assert created.meta.kind == common_pb2.TEMPLATE_KIND_FORMULA
        updated = await _manage(svc, common_pb2.TEMPLATE_OPERATION_UPDATE)
        assert updated.meta.version == 2
        listed = await svc.ListTemplates(indicators_pb2.ListTemplatesRequest(), _user("bob"))
        assert [(t.meta.template_id, t.meta.version) for t in listed.templates] == [
            ("tpl-zscore", 2)
        ]
        assert listed.templates[0].payload.source == _payload().source

    async def test_ac15_empty_catalog_lists_zero_templates(self):
        svc = _servicer()
        listed = await svc.ListTemplates(indicators_pb2.ListTemplatesRequest(), _user("bob"))
        assert len(listed.templates) == 0

    async def test_create_validates_payload_like_register(self):
        svc = _servicer()
        bad = _payload()
        bad.outputs.append(indicators_pb2.FormulaOutput(name="value"))  # reserved
        ctx = _admin()
        with pytest.raises(grpc.RpcError):
            await svc.ManageTemplate(
                indicators_pb2.ManageTemplateRequest(
                    operation=common_pb2.TEMPLATE_OPERATION_CREATE, template=_template(payload=bad)
                ),
                ctx,
            )
        assert _code(ctx) == grpc.StatusCode.INVALID_ARGUMENT

    async def test_duplicate_create_is_already_exists(self):
        svc = _servicer()
        await _seed(svc)
        ctx = _admin()
        with pytest.raises(grpc.RpcError):
            await svc.ManageTemplate(
                indicators_pb2.ManageTemplateRequest(
                    operation=common_pb2.TEMPLATE_OPERATION_CREATE, template=_template()
                ),
                ctx,
            )
        assert _code(ctx) == grpc.StatusCode.ALREADY_EXISTS

    async def test_update_of_missing_template_is_not_found(self):
        svc = _servicer()
        ctx = _admin()
        with pytest.raises(grpc.RpcError):
            await svc.ManageTemplate(
                indicators_pb2.ManageTemplateRequest(
                    operation=common_pb2.TEMPLATE_OPERATION_UPDATE, template=_template("nope")
                ),
                ctx,
            )
        assert _code(ctx) == grpc.StatusCode.NOT_FOUND


class TestInstantiation:
    async def test_ac16_instance_is_private_to_bob_with_origin(self):
        svc = _servicer()
        await _seed(svc, versions=2)
        formula = await _instantiate(svc)
        assert formula.author == "bob"  # payload's deprecated author/is_public are ignored
        assert formula.origin.template_id == "tpl-zscore"
        assert formula.origin.template_version == 2
        row = svc._repo.rows[formula.formula_id]
        assert row["author"] == "bob" and row["is_public"] is False
        assert (row["origin_template_id"], row["origin_template_version"]) == ("tpl-zscore", 2)
        assert row["pending_intent_id"] is None

        svc._formulas.clear()
        ctx = _user("alice")
        with pytest.raises(grpc.RpcError):
            await svc.GetFormula(
                indicators_pb2.GetFormulaRequest(formula_id=formula.formula_id), ctx
            )
        assert _code(ctx) == grpc.StatusCode.NOT_FOUND

    async def test_ac17_template_update_flags_instance_without_touching_it(self):
        svc = _servicer()
        await _seed(svc, versions=2)
        formula = await _instantiate(svc)
        await _manage(
            svc,
            common_pb2.TEMPLATE_OPERATION_UPDATE,
            _template(payload=_payload(source="result = {'value': 3, 'z': 3}")),
        )
        got = await svc.GetFormula(
            indicators_pb2.GetFormulaRequest(formula_id=formula.formula_id), _user("bob")
        )
        assert got.source == _payload().source
        assert got.origin.template_version == 2
        assert got.origin.latest_version == 3
        assert got.origin.update_available is True

    async def test_list_formulas_resolves_origins_with_one_batched_lookup(self):
        svc = _servicer()
        await _seed(svc, versions=1, template_id="tpl-a")
        await _seed(svc, versions=1, template_id="tpl-b")
        await _instantiate(svc, template_id="tpl-a")
        await _instantiate(svc, template_id="tpl-b")
        await _manage(svc, common_pb2.TEMPLATE_OPERATION_UPDATE, _template("tpl-a"))
        svc._templates_repo.latest_calls = 0
        listed = await svc.ListFormulas(indicators_pb2.ListFormulasRequest(), _user("bob"))
        assert svc._templates_repo.latest_calls == 1
        by_tpl = {f.origin.template_id: f.origin for f in listed.formulas}
        assert by_tpl["tpl-a"].update_available is True and by_tpl["tpl-a"].latest_version == 2
        assert by_tpl["tpl-b"].update_available is False and by_tpl["tpl-b"].latest_version == 1

    async def test_ac31_retire_hides_template_and_instance_keeps_origin(self):
        svc = _servicer()
        await _seed(svc, versions=1)
        formula = await _instantiate(svc)
        await _manage(svc, common_pb2.TEMPLATE_OPERATION_RETIRE)
        listed = await svc.ListTemplates(indicators_pb2.ListTemplatesRequest(), _user("bob"))
        assert len(listed.templates) == 0
        got = await svc.GetFormula(
            indicators_pb2.GetFormulaRequest(formula_id=formula.formula_id), _user("bob")
        )
        assert got.source == _payload().source
        assert got.origin.template_id == "tpl-zscore"
        assert got.origin.template_version == 1
        assert got.origin.latest_version == 0
        assert got.origin.update_available is False

    @pytest.mark.parametrize("retire", [True, False])
    async def test_retired_or_missing_template_refuses_instantiation(self, retire):
        svc = _servicer()
        if retire:
            await _seed(svc)
            await _manage(svc, common_pb2.TEMPLATE_OPERATION_RETIRE)
        ctx = _user("bob")
        with pytest.raises(grpc.RpcError):
            await svc.InstantiateTemplate(
                indicators_pb2.InstantiateTemplateRequest(template_id="tpl-zscore"), ctx
            )
        assert _code(ctx) == grpc.StatusCode.NOT_FOUND
        assert svc._repo.rows == {}

    @pytest.mark.parametrize("user", ["", "system"])
    async def test_user_path_requires_a_non_system_owner(self, user):
        svc = _servicer()
        await _seed(svc)
        ctx = _user(user)
        with pytest.raises(grpc.RpcError):
            await svc.InstantiateTemplate(
                indicators_pb2.InstantiateTemplateRequest(template_id="tpl-zscore"), ctx
            )
        assert _code(ctx) == grpc.StatusCode.PERMISSION_DENIED
        assert svc._repo.rows == {}


class TestSaga:
    async def _start(self, svc, ids=("tpl-a", "tpl-b"), ctx=None):
        return await svc.InstantiateTemplate(
            indicators_pb2.InstantiateTemplateRequest(template_ids=list(ids), intent_id=INTENT),
            ctx or _saga(),
        )

    async def _seeded(self):
        svc = _servicer()
        await _seed(svc, template_id="tpl-a")
        await _seed(svc, template_id="tpl-b")
        return svc

    async def test_pending_copies_are_invisible_and_uncached(self):
        svc = await self._seeded()
        resp = await self._start(svc)
        ids = dict(resp.formula_ids_by_template)
        assert set(ids) == {"tpl-a", "tpl-b"}
        assert svc._repo.pending_batches == 1
        assert all(svc._repo.rows[f]["author"] == "bob" for f in ids.values())
        assert all(svc._repo.rows[f]["pending_intent_id"] == INTENT for f in ids.values())
        assert not any(f in svc._formulas for f in ids.values())

        listed = await svc.ListFormulas(indicators_pb2.ListFormulasRequest(), _user("bob"))
        assert len(listed.formulas) == 0
        ctx = _user("bob")
        with pytest.raises(grpc.RpcError):
            await svc.GetFormula(indicators_pb2.GetFormulaRequest(formula_id=ids["tpl-a"]), ctx)
        assert _code(ctx) == grpc.StatusCode.NOT_FOUND

    async def test_resolve_commit_unhides_copies(self):
        svc = await self._seeded()
        ids = dict((await self._start(svc)).formula_ids_by_template)
        resp = await svc.ResolveTemplateIntent(
            indicators_pb2.ResolveTemplateIntentRequest(intent_id=INTENT, commit=True), _saga()
        )
        assert resp.affected == 2
        listed = await svc.ListFormulas(indicators_pb2.ListFormulasRequest(), _user("bob"))
        assert {f.formula_id for f in listed.formulas} == set(ids.values())

    async def test_resolve_abort_deletes_copies_and_evicts_cache(self):
        svc = await self._seeded()
        ids = dict((await self._start(svc)).formula_ids_by_template)
        svc._formulas[ids["tpl-a"]] = indicators_pb2.FormulaDefinition(formula_id=ids["tpl-a"])
        resp = await svc.ResolveTemplateIntent(
            indicators_pb2.ResolveTemplateIntentRequest(intent_id=INTENT, commit=False), _saga()
        )
        assert resp.affected == 2
        assert svc._repo.rows == {}
        assert ids["tpl-a"] not in svc._formulas

    async def test_resolve_is_owner_scoped_and_idempotent(self):
        svc = await self._seeded()
        await self._start(svc)
        resp = await svc.ResolveTemplateIntent(
            indicators_pb2.ResolveTemplateIntentRequest(intent_id=INTENT, commit=False),
            _saga(owner="alice"),
        )
        assert resp.affected == 0
        assert len(svc._repo.rows) == 2

    @pytest.mark.parametrize(
        "ctx_factory",
        [
            lambda: _saga(peer_sans=()),  # header without the analysis SAN
            lambda: _saga(caller="analysis"),  # N-only formula-reader bypass id
            lambda: _saga(peer_sans=("xstockstrat-ingest",)),
            lambda: _user("bob"),
        ],
    )
    async def test_saga_and_resolve_require_the_dedicated_san_bound_grant(self, ctx_factory):
        svc = await self._seeded()
        ctx = ctx_factory()
        with pytest.raises(grpc.RpcError):
            await self._start(svc, ctx=ctx)
        assert _code(ctx) == grpc.StatusCode.PERMISSION_DENIED
        assert svc._repo.rows == {}

        ctx = ctx_factory()
        with pytest.raises(grpc.RpcError):
            await svc.ResolveTemplateIntent(
                indicators_pb2.ResolveTemplateIntentRequest(intent_id=INTENT, commit=True), ctx
            )
        assert _code(ctx) == grpc.StatusCode.PERMISSION_DENIED

    @pytest.mark.parametrize("owner", ["", "system"])
    async def test_saga_requires_a_non_system_owner(self, owner):
        svc = await self._seeded()
        ctx = _saga(owner=owner)
        with pytest.raises(grpc.RpcError):
            await self._start(svc, ctx=ctx)
        assert _code(ctx) == grpc.StatusCode.PERMISSION_DENIED

    @pytest.mark.parametrize("retire", [True, False])
    async def test_one_retired_or_missing_template_fails_whole_saga_with_zero_inserts(self, retire):
        svc = await self._seeded()
        if retire:
            await _manage(svc, common_pb2.TEMPLATE_OPERATION_RETIRE, _template("tpl-b"))
        ids = ("tpl-a", "tpl-b") if retire else ("tpl-a", "tpl-missing")
        ctx = _saga()
        with pytest.raises(grpc.RpcError):
            await self._start(svc, ids=ids, ctx=ctx)
        assert _code(ctx) == grpc.StatusCode.NOT_FOUND
        assert ids[1] in ctx.abort.call_args[0][1]
        assert svc._repo.pending_batches == 0
        assert svc._repo.rows == {}

    async def test_partial_insert_failure_rolls_back_every_copy(self):
        """A failing 2nd INSERT propagates out of conn.transaction(), so the whole batch rolls
        back (mock-transaction assertion) and the RPC errors."""
        conn = MagicMock()
        conn.fetchrow = AsyncMock(side_effect=[{"formula_id": "x"}, RuntimeError("boom")])
        txn = MagicMock()
        txn.__aenter__ = AsyncMock(return_value=None)
        txn.__aexit__ = AsyncMock(return_value=False)
        conn.transaction = MagicMock(return_value=txn)
        acquire = MagicMock()
        acquire.__aenter__ = AsyncMock(return_value=conn)
        acquire.__aexit__ = AsyncMock(return_value=False)
        pool = MagicMock()
        pool.acquire = MagicMock(return_value=acquire)

        svc = await self._seeded()
        svc._repo = FormulasRepository(pool)
        ctx = _saga()
        with pytest.raises(grpc.RpcError):
            await self._start(svc, ctx=ctx)
        assert conn.fetchrow.await_count == 2
        exc_type = txn.__aexit__.call_args[0][0]
        assert exc_type is RuntimeError  # the transaction exited on the error → ROLLBACK
        assert _code(ctx) == grpc.StatusCode.INTERNAL
        pool.fetchrow.assert_not_called()  # no INSERT bypassed the transaction


class TestRepositories:
    async def test_template_update_bumps_version_in_one_update(self):
        pool = MagicMock()
        pool.fetchrow = AsyncMock(return_value=None)
        repo = FormulaTemplatesRepository(pool)
        await repo.update("tpl-zscore", MessageToDict(_payload()))
        assert pool.fetchrow.await_count == 1
        sql = pool.fetchrow.call_args[0][0]
        assert "UPDATE indicators.formula_templates" in sql
        assert "version = version + 1" in sql and "updated_at = NOW()" in sql

    async def test_template_retire_stamps_retired_at(self):
        pool = MagicMock()
        pool.fetchrow = AsyncMock(return_value=None)
        await FormulaTemplatesRepository(pool).retire("tpl-zscore")
        assert "retired_at" in pool.fetchrow.call_args[0][0]

    async def test_latest_versions_is_one_batched_query_over_active_templates(self):
        pool = MagicMock()
        pool.fetch = AsyncMock(return_value=[{"template_id": "tpl-a", "version": 3}])
        got = await FormulaTemplatesRepository(pool).latest_versions(["tpl-a", "tpl-b"])
        assert got == {"tpl-a": 3}
        assert pool.fetch.await_count == 1
        sql, ids = pool.fetch.call_args[0]
        assert "retired_at IS NULL" in sql and ids == ["tpl-a", "tpl-b"]

    async def test_resolve_intent_is_owner_scoped(self):
        pool = MagicMock()
        fid = uuid.uuid4()
        pool.fetch = AsyncMock(return_value=[{"formula_id": fid}])
        repo = FormulasRepository(pool)
        assert await repo.resolve_intent(INTENT, "bob", commit=True) == [str(fid)]
        sql, *args = pool.fetch.call_args[0]
        assert sql.lstrip().startswith("UPDATE") and "pending_intent_id = NULL" in sql
        assert "author = $2" in sql and args == [INTENT, "bob"]
        await repo.resolve_intent(INTENT, "bob", commit=False)
        sql = pool.fetch.call_args[0][0]
        assert sql.lstrip().startswith("DELETE") and "author = $2" in sql

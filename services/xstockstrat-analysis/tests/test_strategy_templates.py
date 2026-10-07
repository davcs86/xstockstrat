"""Feature 224 — strategy template catalog, the InstantiateTemplate saga and its reconcile sweep.

Covers AC-13 (strategy kind), AC-18 (deep copy), AC-19 (atomic failure), AC-20 (_N suffix) and
AC-34 (caller-chosen id collision), plus the blend guard on the final id, the sweep, saga metadata
(D-18: the saga path of ``_assert_indicators_headers``), template-payload validation and origin on
reads. Repos are in-memory doubles; the indicators stub is a ``RecordingStub``.
"""

import inspect
import json
from datetime import UTC, datetime
from unittest.mock import AsyncMock

import grpc
import pytest
from gen.analysis.v1 import analysis_pb2
from gen.common.v1 import common_pb2
from gen.indicators.v1 import indicators_pb2
from google.protobuf import json_format

from app import main as app_main
from app.handlers import servicer as servicer_mod
from app.repositories.strategies import StrategiesRepository
from app.repositories.strategy_templates import StrategyTemplatesRepository
from app.repositories.template_intents import TemplateIntentsRepository
from tests.conftest import RecordingStub, ctx_with
from tests.test_analysis_servicer import make_servicer
from tests.test_opportunities_repo import _mock_pool
from tests.test_owner_header_guard import _assert_indicators_headers

_SAGA = "analysis-template-saga"
_BOB = [("x-user-id", "bob"), ("x-access-scope", "1"), ("x-trace-id", "t-bob")]
_ADMIN = [("x-user-id", "admin-1"), ("x-access-scope", "4"), ("x-trace-id", "t-adm")]
_T0 = datetime(2026, 10, 1, tzinfo=UTC)

_CUSTOM = analysis_pb2.COMPONENT_KIND_CUSTOM_FORMULA


def _payload(strategy_id="mean_reversion", entry="z.upper", source_symbol=""):
    """A strategy-template payload: three formula components over two formula templates."""
    return analysis_pb2.StrategyDefinition(
        strategy_id=strategy_id,
        display_name="Mean Reversion",
        components=[
            analysis_pb2.StrategyComponent(
                ref_name="z", kind=_CUSTOM, formula_id="tpl-zscore", source_symbol=source_symbol
            ),
            analysis_pb2.StrategyComponent(ref_name="er", kind=_CUSTOM, formula_id="tpl-er"),
            analysis_pb2.StrategyComponent(ref_name="z2", kind=_CUSTOM, formula_id="tpl-zscore"),
        ],
        entry_rule=json.dumps({"fn": ">", "lhs": entry, "rhs": 0}),
    )


def _tpl_row(template_id="tpl-meanrev", payload=None, version=1, retired=False):
    return {
        "template_id": template_id,
        "name": "Mean reversion",
        "description": "",
        "payload": json_format.MessageToDict(
            payload or _payload(), preserving_proto_field_name=True
        ),
        "version": version,
        "retired_at": _T0 if retired else None,
        "created_by": "admin-1",
        "created_at": _T0,
        "updated_at": _T0,
    }


def _strategy_row(user_id, strategy_id, origin=None):
    row = {
        "user_id": user_id,
        "strategy_id": strategy_id,
        "display_name": strategy_id,
        "active": True,
        "live_enabled": True,
        "definition_json": {"strategy_id": strategy_id},
        "created_at": _T0,
        "origin_template_id": None,
        "origin_template_version": None,
    }
    if origin:
        row["origin_template_id"], row["origin_template_version"] = origin
    return row


class FakeTemplates:
    def __init__(self, *rows):
        self.rows = {r["template_id"]: r for r in rows}
        self.lookups: list[list[str]] = []

    async def list_active(self):
        return [r for r in self.rows.values() if r["retired_at"] is None]

    async def get(self, template_id):
        return self.rows.get(template_id)

    async def create(self, meta, payload_json, created_by):
        row = _tpl_row(meta.template_id)
        row.update(name=meta.name, payload=payload_json, created_by=created_by)
        self.rows[meta.template_id] = row
        return row

    async def update(self, template_id, payload_json):
        row = self.rows.get(template_id)
        if row is None or row["retired_at"] is not None:
            return None
        row.update(payload=payload_json, version=row["version"] + 1)
        return row

    async def retire(self, template_id):
        row = self.rows.get(template_id)
        if row is not None:
            row["retired_at"] = _T0
        return row

    async def latest_versions(self, ids):
        self.lookups.append(list(ids))
        return {
            i: self.rows[i]["version"]
            for i in ids
            if i in self.rows and self.rows[i]["retired_at"] is None
        }


class FakeIntents:
    def __init__(self, *seed):
        self.rows = {r["intent_id"]: dict(r) for r in seed}

    async def create(self, intent):
        self.rows[intent["intent_id"]] = {**intent, "state": "PENDING", "age": 0}

    async def cas(self, intent_id, from_state, to_state, conn=None, *, user_id=None):
        row = self.rows.get(intent_id)
        if row is None or row["state"] != from_state:
            return False
        if user_id is not None and row["user_id"] != user_id:
            return False
        row["state"] = to_state
        return True

    async def stale(self, states, older_than):
        return [
            dict(r) for r in self.rows.values() if r["state"] in states and r["age"] >= older_than
        ]


class FakeStrategies:
    def __init__(self, *rows):
        self.rows = {(r["user_id"], r["strategy_id"]): r for r in rows}
        self.created: list[dict] = []

    async def get_by_owner_and_id(self, user_id, strategy_id):
        return self.rows.get((user_id, strategy_id))

    async def list(self, user_id, include_inactive=False, page_size=0, page_offset=0):
        rows = [r for (u, _s), r in self.rows.items() if u == user_id]
        return rows, len(rows)

    async def create_from_template(
        self,
        user_id,
        strategy_id,
        display_name,
        definition_json,
        origin_template_id,
        origin_template_version,
        *,
        commit_intent,
    ):
        if not await commit_intent(None):
            return None
        row = {
            "user_id": user_id,
            "strategy_id": strategy_id,
            "display_name": display_name,
            "active": False,
            "live_enabled": False,
            "definition_json": definition_json,
            "origin_template_id": origin_template_id,
            "origin_template_version": origin_template_version,
        }
        self.rows[(user_id, strategy_id)] = row
        self.created.append(row)
        return row


def _not_found():
    return grpc.aio.AioRpcError(
        grpc.StatusCode.NOT_FOUND, grpc.aio.Metadata(), grpc.aio.Metadata(), "tpl-er retired"
    )


def _copy(req):
    return indicators_pb2.InstantiateTemplateResponse(
        formula_ids_by_template={t: f"bob-{t}" for t in req.template_ids}
    )


def _indicators(**overrides):
    return RecordingStub(
        {
            "InstantiateTemplate": _copy,
            "ResolveTemplateIntent": indicators_pb2.ResolveTemplateIntentResponse(affected=2),
            **overrides,
        }
    )


def _svc(templates=None, intents=None, strategies=None, indicators=None):
    svc = make_servicer()
    svc._strategy_templates_repo = templates or FakeTemplates(_tpl_row())
    svc._template_intents_repo = intents or FakeIntents()
    svc._strategies_repo = strategies or FakeStrategies()
    svc._indicators = indicators or _indicators()
    return svc


async def _instantiate(svc, headers=_BOB, template_id="tpl-meanrev", strategy_id=""):
    ctx = ctx_with(headers)
    req = analysis_pb2.InstantiateTemplateRequest(template_id=template_id, strategy_id=strategy_id)
    try:
        return await svc.InstantiateTemplate(req, ctx), ctx
    except Exception:
        return None, ctx


def _aborted_with(ctx, code):
    ctx.abort.assert_awaited()
    assert ctx.abort.await_args.args[0] == code, ctx.abort.await_args


# ── AC-13 (strategy kind) ────────────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "op",
    [
        common_pb2.TEMPLATE_OPERATION_CREATE,
        common_pb2.TEMPLATE_OPERATION_UPDATE,
        common_pb2.TEMPLATE_OPERATION_RETIRE,
    ],
)
async def test_manage_template_requires_admin(op):
    templates = FakeTemplates(_tpl_row())
    svc = _svc(templates=templates)
    ctx = ctx_with(_BOB)
    req = analysis_pb2.ManageTemplateRequest(
        operation=op,
        template=analysis_pb2.StrategyTemplate(
            meta=common_pb2.TemplateMeta(template_id="tpl-meanrev", name="x"), payload=_payload()
        ),
    )
    with pytest.raises(Exception, match="aborted"):
        await svc.ManageTemplate(req, ctx)
    _aborted_with(ctx, grpc.StatusCode.PERMISSION_DENIED)
    assert templates.rows["tpl-meanrev"]["version"] == 1
    assert templates.rows["tpl-meanrev"]["retired_at"] is None
    assert svc._indicators.calls == []


# ── template-payload validation (named outputs via formula-template payloads) ────────────────────


def _formula_templates(*, zscore_fundamentals=False):
    zscore = indicators_pb2.RegisterFormulaRequest(
        name="zscore", outputs=[indicators_pb2.FormulaOutput(name="upper")]
    )
    if zscore_fundamentals:
        zscore.fundamental_inputs.append(indicators_pb2.FUNDAMENTAL_METRIC_PE_RATIO)
    return indicators_pb2.ListTemplatesResponse(
        templates=[
            indicators_pb2.FormulaTemplate(
                meta=common_pb2.TemplateMeta(template_id="tpl-zscore", version=1), payload=zscore
            ),
            indicators_pb2.FormulaTemplate(
                meta=common_pb2.TemplateMeta(template_id="tpl-er", version=1),
                payload=indicators_pb2.RegisterFormulaRequest(name="er"),
            ),
        ]
    )


async def _manage(svc, payload, op=common_pb2.TEMPLATE_OPERATION_CREATE, template_id="tpl-new"):
    ctx = ctx_with(_ADMIN)
    req = analysis_pb2.ManageTemplateRequest(
        operation=op,
        template=analysis_pb2.StrategyTemplate(
            meta=common_pb2.TemplateMeta(template_id=template_id, name="New"), payload=payload
        ),
    )
    try:
        return await svc.ManageTemplate(req, ctx), ctx
    except Exception:
        return None, ctx


async def test_manage_template_create_validates_declared_named_output():
    templates = FakeTemplates()
    indicators = _indicators(ListTemplates=_formula_templates())
    svc = _svc(templates=templates, indicators=indicators)
    out, ctx = await _manage(svc, _payload(entry="z.upper"))
    ctx.abort.assert_not_awaited()
    assert out.meta.template_id == "tpl-new" and out.meta.version == 1
    assert out.payload.components[0].formula_id == "tpl-zscore"
    assert "tpl-new" in templates.rows
    assert [m for m, _r, _md in indicators.calls] == ["ListTemplates"]  # never GetFormula
    _assert_indicators_headers(indicators, "admin-1")
    assert ("x-access-scope", "4") in indicators.calls[0][2]
    assert ("x-trace-id", "t-adm") in indicators.calls[0][2]


async def test_manage_template_rejects_undeclared_named_output():
    svc = _svc(
        templates=FakeTemplates(), indicators=_indicators(ListTemplates=_formula_templates())
    )
    _out, ctx = await _manage(svc, _payload(entry="z.lower"))
    _aborted_with(ctx, grpc.StatusCode.INVALID_ARGUMENT)
    assert "lower" in ctx.abort.await_args.args[1]
    assert not svc._indicators.of("GetFormula")


async def test_manage_template_rejects_unknown_formula_template():
    only_er = indicators_pb2.ListTemplatesResponse(templates=[_formula_templates().templates[1]])
    svc = _svc(templates=FakeTemplates(), indicators=_indicators(ListTemplates=only_er))
    _out, ctx = await _manage(svc, _payload())
    _aborted_with(ctx, grpc.StatusCode.INVALID_ARGUMENT)
    assert "tpl-zscore" in ctx.abort.await_args.args[1]
    assert not svc._indicators.of("GetFormula")


async def test_manage_template_rejects_fundamentals_formula_with_source_symbol():
    svc = _svc(
        templates=FakeTemplates(),
        indicators=_indicators(ListTemplates=_formula_templates(zscore_fundamentals=True)),
    )
    _out, ctx = await _manage(svc, _payload(source_symbol="SPY"))
    _aborted_with(ctx, grpc.StatusCode.INVALID_ARGUMENT)
    assert "source_symbol" in ctx.abort.await_args.args[1]
    assert not svc._indicators.of("GetFormula")


async def test_manage_template_update_bumps_version_and_retire_hides():
    templates = FakeTemplates(_tpl_row())
    svc = _svc(templates=templates, indicators=_indicators(ListTemplates=_formula_templates()))
    out, ctx = await _manage(
        svc, _payload(), op=common_pb2.TEMPLATE_OPERATION_UPDATE, template_id="tpl-meanrev"
    )
    ctx.abort.assert_not_awaited()
    assert out.meta.version == 2
    out, ctx = await _manage(
        svc, _payload(), op=common_pb2.TEMPLATE_OPERATION_RETIRE, template_id="tpl-meanrev"
    )
    ctx.abort.assert_not_awaited()
    assert out.meta.retired
    listed = await svc.ListTemplates(analysis_pb2.ListTemplatesRequest(), ctx_with(_BOB))
    assert [t.meta.template_id for t in listed.templates] == []


async def test_list_templates_returns_active_strategy_templates():
    svc = _svc(templates=FakeTemplates(_tpl_row(), _tpl_row("tpl-old", retired=True)))
    listed = await svc.ListTemplates(analysis_pb2.ListTemplatesRequest(), ctx_with(_BOB))
    assert [t.meta.template_id for t in listed.templates] == ["tpl-meanrev"]
    assert listed.templates[0].meta.kind == common_pb2.TEMPLATE_KIND_STRATEGY
    assert listed.templates[0].payload.strategy_id == "mean_reversion"


# ── AC-18: deep copy ─────────────────────────────────────────────────────────────────────────────


async def test_instantiate_deep_copies_formula_templates_and_finalizes():
    intents, strategies = FakeIntents(), FakeStrategies()
    svc = _svc(intents=intents, strategies=strategies)
    out, ctx = await _instantiate(svc)
    ctx.abort.assert_not_awaited()

    (copy_call,) = svc._indicators.of("InstantiateTemplate")
    (intent,) = intents.rows.values()
    assert sorted(copy_call[1].template_ids) == ["tpl-er", "tpl-zscore"]  # distinct: 2 copies
    assert copy_call[1].intent_id == intent["intent_id"] and not copy_call[1].template_id
    assert intent["state"] == "FINALIZED" and intent["user_id"] == "bob"
    (resolve_call,) = svc._indicators.of("ResolveTemplateIntent")
    assert resolve_call[1].intent_id == intent["intent_id"] and resolve_call[1].commit is True

    (row,) = strategies.created
    assert row["user_id"] == "bob" and row["strategy_id"] == "mean_reversion"
    assert row["active"] is False and row["live_enabled"] is False
    assert (row["origin_template_id"], row["origin_template_version"]) == ("tpl-meanrev", 1)
    assert [c["formula_id"] for c in row["definition_json"]["components"]] == [
        "bob-tpl-zscore",
        "bob-tpl-er",
        "bob-tpl-zscore",
    ]
    assert not out.active and not out.live_enabled and out.user_id == "bob"
    assert out.origin.template_id == "tpl-meanrev" and out.origin.template_version == 1


async def test_instantiate_saga_request_path_metadata():
    svc = _svc()
    await _instantiate(svc)
    _assert_indicators_headers(svc._indicators, "bob", path="template-saga")
    for method, _req, meta in svc._indicators.calls:
        assert ("x-access-scope", "1") in meta and ("x-trace-id", "t-bob") in meta, method
        assert ("x-internal-caller", "analysis") not in meta


# ── AC-19: atomic failure ────────────────────────────────────────────────────────────────────────


async def test_instantiate_copy_failure_aborts_intent_and_creates_nothing():
    intents, strategies = FakeIntents(), FakeStrategies()
    svc = _svc(
        intents=intents,
        strategies=strategies,
        indicators=_indicators(InstantiateTemplate=_not_found()),
    )
    out, ctx = await _instantiate(svc)
    assert out is None
    _aborted_with(ctx, grpc.StatusCode.NOT_FOUND)
    (intent,) = intents.rows.values()
    assert intent["state"] == "ABORTED"
    (resolve_call,) = svc._indicators.of("ResolveTemplateIntent")
    assert resolve_call[1].intent_id == intent["intent_id"] and resolve_call[1].commit is False
    assert strategies.created == []
    _assert_indicators_headers(svc._indicators, "bob", path="template-saga")


async def test_instantiate_cas_lost_to_sweep_returns_aborted():
    intents, strategies = FakeIntents(), FakeStrategies()

    def _copy_then_swept(req):
        intents.rows[req.intent_id]["state"] = "ABORTED"  # the sweep won the race
        return _copy(req)

    svc = _svc(
        intents=intents,
        strategies=strategies,
        indicators=_indicators(InstantiateTemplate=_copy_then_swept),
    )
    out, ctx = await _instantiate(svc)
    assert out is None
    _aborted_with(ctx, grpc.StatusCode.ABORTED)
    assert strategies.created == []
    assert not svc._indicators.of("ResolveTemplateIntent") or all(
        not c[1].commit for c in svc._indicators.of("ResolveTemplateIntent")
    )


async def test_instantiate_retired_template_starts_no_intent():
    intents = FakeIntents()
    svc = _svc(templates=FakeTemplates(_tpl_row(retired=True)), intents=intents)
    out, ctx = await _instantiate(svc)
    assert out is None
    _aborted_with(ctx, grpc.StatusCode.NOT_FOUND)
    assert intents.rows == {} and svc._indicators.calls == []


async def test_instantiate_requires_owner_header():
    svc = _svc()
    out, ctx = await _instantiate(svc, headers=[("x-user-id", "system")])
    assert out is None
    _aborted_with(ctx, grpc.StatusCode.PERMISSION_DENIED)
    assert svc._indicators.calls == []


# ── AC-20 / AC-34: id collisions ─────────────────────────────────────────────────────────────────


async def test_instantiate_suffixes_colliding_template_id():
    existing = _strategy_row("bob", "mean_reversion")
    strategies = FakeStrategies(existing, _strategy_row("alice", "mean_reversion_2"))
    svc = _svc(strategies=strategies)
    out, ctx = await _instantiate(svc)
    ctx.abort.assert_not_awaited()
    assert out.strategy_id == "mean_reversion_2"
    assert [r["strategy_id"] for r in strategies.created] == ["mean_reversion_2"]
    assert strategies.rows[("bob", "mean_reversion")] is existing
    assert existing["active"] is True and existing["origin_template_id"] is None


async def test_instantiate_caller_id_collision_is_already_exists_before_any_write():
    intents = FakeIntents()
    strategies = FakeStrategies(_strategy_row("bob", "mean_reversion"))
    svc = _svc(intents=intents, strategies=strategies)
    out, ctx = await _instantiate(svc, strategy_id="mean_reversion")
    assert out is None
    _aborted_with(ctx, grpc.StatusCode.ALREADY_EXISTS)
    assert intents.rows == {} and svc._indicators.calls == [] and strategies.created == []


async def test_instantiate_uses_unowned_caller_chosen_id():
    svc = _svc(strategies=FakeStrategies(_strategy_row("bob", "mean_reversion")))
    out, ctx = await _instantiate(svc, strategy_id="my_meanrev")
    ctx.abort.assert_not_awaited()
    assert out.strategy_id == "my_meanrev"


async def test_instantiate_blend_final_id_reserved_for_admin():
    blend = servicer_mod.blend_strategy_id(make_servicer()._cfg)
    templates = FakeTemplates(_tpl_row(payload=_payload(strategy_id=blend)))
    intents = FakeIntents()
    svc = _svc(templates=templates, intents=intents)
    out, ctx = await _instantiate(svc)
    assert out is None
    _aborted_with(ctx, grpc.StatusCode.FAILED_PRECONDITION)
    assert intents.rows == {} and svc._indicators.calls == []

    admin_svc = _svc(templates=templates)
    out, ctx = await _instantiate(admin_svc, headers=_ADMIN)
    ctx.abort.assert_not_awaited()
    assert out.strategy_id == blend


# ── reconcile sweep ──────────────────────────────────────────────────────────────────────────────


def _intent(intent_id, user_id, state, age):
    return {
        "intent_id": intent_id,
        "user_id": user_id,
        "template_id": "tpl-meanrev",
        "template_version": 1,
        "strategy_id": "mean_reversion",
        "state": state,
        "age": age,
    }


def _schedule():
    schedule = AsyncMock()
    schedule.next_sleep_seconds = AsyncMock(return_value=0.0)
    return schedule


async def test_sweep_aborts_stale_pending_and_finalizes_committed():
    stale = servicer_mod._INTENT_STALE_SECONDS
    intents = FakeIntents(
        _intent("i-alice", "alice", "PENDING", stale + 1),
        _intent("i-bob", "bob", "COMMITTED", 0),
        _intent("i-carol", "carol", "ABORTING", 0),
        _intent("i-fresh", "dave", "PENDING", 0),
    )
    svc = _svc(intents=intents)
    schedule = _schedule()
    await svc._template_intent_sweep_tick(schedule)

    states = {i: r["state"] for i, r in intents.rows.items()}
    assert states == {
        "i-alice": "ABORTED",
        "i-bob": "FINALIZED",
        "i-carol": "ABORTED",
        "i-fresh": "PENDING",
    }
    schedule.advance.assert_awaited_once_with(servicer_mod._INTENT_SWEEP_SECONDS)

    owners = {"i-alice": "alice", "i-bob": "bob", "i-carol": "carol"}
    calls = svc._indicators.of("ResolveTemplateIntent")
    assert {c[1].intent_id: c[1].commit for c in calls} == {
        "i-alice": False,
        "i-bob": True,
        "i-carol": False,
    }
    traces = set()
    for _m, req, meta in calls:
        assert [v for k, v in meta if k == "x-user-id"] == [owners[req.intent_id]], meta
        assert [v for k, v in meta if k == "x-internal-caller"] == [_SAGA], meta
        (trace,) = [v for k, v in meta if k == "x-trace-id"]
        assert trace and trace not in traces
        traces.add(trace)
        assert not [k for k, _v in meta if k == "x-access-scope"]
        assert ("x-internal-caller", "analysis") not in meta


async def test_sweep_leaves_aborting_when_resolve_fails():
    intents = FakeIntents(
        _intent("i-alice", "alice", "PENDING", servicer_mod._INTENT_STALE_SECONDS)
    )
    svc = _svc(
        intents=intents,
        indicators=_indicators(ResolveTemplateIntent=_not_found()),
    )
    await svc._template_intent_sweep_tick(_schedule())
    assert intents.rows["i-alice"]["state"] == "ABORTING"


async def test_sweep_constants_are_fixed():
    assert servicer_mod._INTENT_STALE_SECONDS > servicer_mod._INTENT_SWEEP_SECONDS > 0
    assert "run_template_intent_sweep_forever" in inspect.getsource(app_main)


# ── origin on reads ──────────────────────────────────────────────────────────────────────────────


def _origin_svc():
    templates = FakeTemplates(_tpl_row(version=3), _tpl_row("tpl-gone", retired=True))
    strategies = FakeStrategies(
        _strategy_row("bob", "s-a", origin=("tpl-meanrev", 1)),
        _strategy_row("bob", "s-b", origin=("tpl-gone", 2)),
        _strategy_row("bob", "s-c"),
    )
    return _svc(templates=templates, strategies=strategies), templates


async def test_get_strategy_reports_update_available():
    svc, templates = _origin_svc()
    svc._indicators = RecordingStub()
    out = await svc.GetStrategy(analysis_pb2.GetStrategyRequest(strategy_id="s-a"), ctx_with(_BOB))
    assert out.origin.template_id == "tpl-meanrev"
    assert (out.origin.template_version, out.origin.latest_version) == (1, 3)
    assert out.origin.update_available is True
    assert templates.lookups == [["tpl-meanrev"]]


async def test_list_strategy_definitions_one_batched_origin_lookup():
    svc, templates = _origin_svc()
    resp = await svc.ListStrategyDefinitions(
        analysis_pb2.ListStrategyDefinitionsRequest(), ctx_with(_BOB)
    )
    by_id = {d.strategy_id: d.origin for d in resp.definitions}
    assert by_id["s-a"].update_available and by_id["s-a"].latest_version == 3
    assert by_id["s-b"].template_id == "tpl-gone"
    assert by_id["s-b"].latest_version == 0 and not by_id["s-b"].update_available
    assert by_id["s-c"].template_id == ""
    assert len(templates.lookups) == 1 and sorted(templates.lookups[0]) == [
        "tpl-gone",
        "tpl-meanrev",
    ]


async def test_list_strategies_scores_carry_origin():
    svc, templates = _origin_svc()
    cached = analysis_pb2.StrategyScore(strategy_id="s-a", overall_score=0.5, rating="B")
    svc._strategies[("bob", "s-a")] = cached
    resp = await svc.ListStrategies(analysis_pb2.ListStrategiesRequest(), ctx_with(_BOB))
    (score,) = resp.strategies
    assert score.origin.template_id == "tpl-meanrev" and score.origin.update_available
    assert cached.origin.template_id == ""  # the in-memory cache entry is not mutated
    assert len(templates.lookups) == 1


# ── repositories (SQL shape; no live Postgres) ───────────────────────────────────────────────────


async def test_create_from_template_commits_intent_and_inserts_in_one_transaction():
    pool, conn = _mock_pool()
    conn.fetchrow = AsyncMock(return_value={"strategy_id": "s", "definition_json": "{}"})
    seen = []

    async def _commit(c):
        seen.append(c)
        return True

    row = await StrategiesRepository(pool).create_from_template(
        "bob", "s", "S", {"a": 1}, "tpl-meanrev", 1, commit_intent=_commit
    )
    assert seen == [conn] and row["strategy_id"] == "s"
    conn.transaction.assert_called_once()
    sql, *args = conn.fetchrow.await_args.args
    assert "INSERT INTO analysis.strategies" in sql and "FALSE" in sql.upper()
    assert args[:2] == ["bob", "s"] and "tpl-meanrev" in args and 1 in args


async def test_create_from_template_skips_insert_when_cas_lost():
    pool, conn = _mock_pool()
    conn.fetchrow = AsyncMock()
    row = await StrategiesRepository(pool).create_from_template(
        "bob", "s", "S", {}, "tpl", 1, commit_intent=AsyncMock(return_value=False)
    )
    assert row is None
    conn.fetchrow.assert_not_awaited()


async def test_intent_cas_is_state_and_owner_guarded_on_given_conn():
    pool, conn = _mock_pool()
    conn.execute = AsyncMock(return_value="UPDATE 1")
    repo = TemplateIntentsRepository(pool)
    assert await repo.cas("i-1", "PENDING", "COMMITTED", conn=conn, user_id="bob") is True
    sql, *args = conn.execute.await_args.args
    assert "state = $" in sql and "user_id" in sql
    assert args[:3] == ["i-1", "PENDING", "COMMITTED"] and "bob" in args
    pool.execute = AsyncMock(return_value="UPDATE 0")
    assert await repo.cas("i-1", "PENDING", "ABORTING") is False


async def test_template_update_bumps_version_in_one_statement():
    pool = AsyncMock()
    pool.fetchrow = AsyncMock(return_value=None)
    await StrategyTemplatesRepository(pool).update("tpl", {"strategy_id": "x"})
    pool.fetchrow.assert_awaited_once()
    sql = pool.fetchrow.await_args.args[0]
    assert "version = version + 1" in sql and "updated_at" in sql


async def test_template_latest_versions_is_one_batched_query():
    pool = AsyncMock()
    pool.fetch = AsyncMock(return_value=[{"template_id": "a", "version": 2}])
    assert await StrategyTemplatesRepository(pool).latest_versions(["a", "b"]) == {"a": 2}
    pool.fetch.assert_awaited_once()
    assert "retired_at IS NULL" in pool.fetch.await_args.args[0]

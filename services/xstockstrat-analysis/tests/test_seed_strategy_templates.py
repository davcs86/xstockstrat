"""Feature 335 — the seeded strategy templates validate and instantiate, and the seeded blend
strategy is a valid REGISTER-form definition.

The seeds are raw SQL, so they bypass ManageTemplate / ManageStrategy validation; these tests push
each seeded payload through the same validators and the real InstantiateTemplate handler.
"""

import json
import re
from datetime import UTC, datetime
from pathlib import Path

import pytest
from gen.analysis.v1 import analysis_pb2
from gen.common.v1 import common_pb2
from gen.indicators.v1 import indicators_pb2
from google.protobuf import json_format

from app.handlers import servicer as servicer_mod
from app.services.evaluator import _validate_definition
from tests.conftest import RecordingStub, ctx_with
from tests.test_strategy_templates import (
    _BOB,
    FakeIntents,
    FakeStrategies,
    FakeTemplates,
    _indicators,
    _instantiate,
    _svc,
)

_MIGRATIONS = Path(__file__).resolve().parent.parent / "migrations"
_INDICATORS_MIGRATIONS = (
    Path(__file__).resolve().parents[2] / "xstockstrat-indicators" / "migrations"
)
_CUSTOM = "COMPONENT_KIND_CUSTOM_FORMULA"
_SYSTEM_FORMULA_ID = "d1ff5e6b-6d9c-589d-b95e-defd862c702b"
_COMPOSITE_TPL = "tpl-fundamentals_value_quality_composite_template"
_BLEND_ID = "fundamentals_macd_blend"
_SEEDED = [
    "dip_buyer_vol_stop",
    "squeeze_breakout_trend",
    _BLEND_ID,
    "dip_buyer_vol_stop_m25",
    "dip_buyer_vol_stop_m35",
    "dip_buyer_regime_filtered",
    "dip_buyer_market_regime_voo",
    "squeeze_macd_mq",
    "squeeze_mq_confirmed",
    "zscore_trend_filtered",
    "clenow_momentum_regime",
    "range_mean_reversion_v2",
    "quality_dip_buyer",
    "golden_cross_conviction",
]
_EXCLUDED = [
    "zz_fscore_probe",
    "dbg_regime_voo_inverted",
    "diag_formula_probe",
    "jjjjjjj",
    "bbbb",
    "aaaa",
    "rsi20",
    "range_mean_reversion",
    "range_mean_reversion_v3",
]
_ABSENT_KEYS = ("user_id", "origin", "warnings", "active", "live_enabled")
_T0 = datetime(2026, 11, 12, tzinfo=UTC)


def _literals(directory: Path, pattern: str) -> list[str]:
    matches = sorted(directory.glob(pattern))
    assert len(matches) == 1, (pattern, matches)
    return re.findall(r"\$t\$(.*?)\$t\$", matches[0].read_text(), re.DOTALL)


def _template_rows(directory: Path, pattern: str) -> list[dict]:
    lits = _literals(directory, pattern)
    assert lits and len(lits) % 4 == 0, len(lits)
    return [
        {
            "template_id": lits[i],
            "name": lits[i + 1],
            "description": lits[i + 2],
            "payload": json.loads(lits[i + 3]),
            "version": 1,
            "retired_at": None,
            "created_by": "system",
            "created_at": _T0,
            "updated_at": _T0,
        }
        for i in range(0, len(lits), 4)
    ]


def _strategy_rows() -> list[dict]:
    return _template_rows(_MIGRATIONS, "*_seed_strategy_templates.up.sql")


def _formula_payloads() -> dict[str, "indicators_pb2.RegisterFormulaRequest"]:
    rows = _template_rows(_INDICATORS_MIGRATIONS, "*_seed_formula_templates.up.sql")
    return {
        r["template_id"]: json_format.ParseDict(
            r["payload"], indicators_pb2.RegisterFormulaRequest()
        )
        for r in rows
    }


def _formula_catalog() -> "indicators_pb2.ListTemplatesResponse":
    return indicators_pb2.ListTemplatesResponse(
        templates=[
            indicators_pb2.FormulaTemplate(
                meta=common_pb2.TemplateMeta(template_id=tid, version=1), payload=payload
            )
            for tid, payload in _formula_payloads().items()
        ]
    )


def _strict(payload: dict) -> "analysis_pb2.StrategyDefinition":
    return json_format.ParseDict(payload, analysis_pb2.StrategyDefinition())


def _custom_components(payload: dict) -> list[dict]:
    return [c for c in payload.get("components", []) if c.get("kind") == _CUSTOM]


def test_ac3_ac19_the_seed_holds_exactly_the_fourteen_strategy_templates():
    rows = _strategy_rows()
    assert sorted(r["template_id"] for r in rows) == sorted(f"tpl-{s}" for s in _SEEDED)
    assert not {r["template_id"] for r in rows} & {f"tpl-{s}" for s in _EXCLUDED}
    text = sorted(_MIGRATIONS.glob("*_seed_strategy_templates.up.sql"))[0].read_text()
    assert text.count("::jsonb, 'system')") == 14
    assert "requires-env" not in text and "COMMIT" not in text and _SYSTEM_FORMULA_ID not in text


async def test_ac22_catalog_lists_the_fourteen_templates_read_only():
    rows = _strategy_rows()
    assert all(servicer_mod._row_to_strategy_template(r).meta.read_only for r in rows)
    svc = _svc(templates=FakeTemplates(*rows))
    listed = await svc.ListTemplates(analysis_pb2.ListTemplatesRequest(), ctx_with(_BOB))
    assert len(listed.templates) == 14
    assert all(t.meta.read_only and t.meta.version == 1 for t in listed.templates)


def test_every_payload_parses_strictly_and_is_in_the_stored_form():
    for row in _strategy_rows():
        parsed = _strict(row["payload"])
        servicer_mod._normalize_source_symbols(parsed)
        servicer_mod._strip_dead_signal_params(parsed)
        canonical = json_format.MessageToDict(parsed, preserving_proto_field_name=True)
        assert canonical == row["payload"], row["template_id"]
        assert parsed.display_name == row["name"], row["template_id"]


def test_ac36_no_payload_carries_owner_or_state_fields():
    for row in _strategy_rows():
        assert not set(row["payload"]) & set(_ABSENT_KEYS), row["template_id"]


def test_ac4_every_formula_reference_is_a_seeded_formula_template():
    formula_ids = set(_formula_payloads())
    for row in _strategy_rows():
        for comp in _custom_components(row["payload"]):
            assert comp["formula_id"] in formula_ids, (row["template_id"], comp["ref_name"])


@pytest.mark.parametrize("strategy_id", _SEEDED)
async def test_every_seeded_template_passes_the_manage_template_validator(strategy_id):
    row = next(r for r in _strategy_rows() if r["template_id"] == f"tpl-{strategy_id}")
    svc = _svc(indicators=_indicators(ListTemplates=_formula_catalog()))
    ctx = ctx_with(_BOB)
    assert await svc._validate_template_definition(_strict(row["payload"]), ctx) is False
    ctx.abort.assert_not_awaited()


@pytest.mark.parametrize("strategy_id", _SEEDED)
async def test_ac38_every_seeded_template_instantiates_into_a_valid_definition(strategy_id):
    strategies = FakeStrategies()
    svc = _svc(
        templates=FakeTemplates(*_strategy_rows()), intents=FakeIntents(), strategies=strategies
    )
    out, ctx = await _instantiate(svc, template_id=f"tpl-{strategy_id}")
    ctx.abort.assert_not_awaited()
    assert out is not None
    created = strategies.created[-1]
    assert created["user_id"] == "bob" and not created["active"] and not created["live_enabled"]
    definition = json_format.ParseDict(
        created["definition_json"], analysis_pb2.StrategyDefinition()
    )
    assert not definition.active and not definition.live_enabled
    payloads = _formula_payloads()
    formula_outputs = {}
    for comp in definition.components:
        if comp.kind == analysis_pb2.COMPONENT_KIND_CUSTOM_FORMULA:
            assert comp.formula_id.startswith("bob-tpl-"), comp.ref_name
            source = payloads[comp.formula_id.removeprefix("bob-")]
            formula_outputs[comp.formula_id] = {"value"} | {o.name for o in source.outputs}
    _validate_definition(definition, formula_outputs)


async def test_ac5_squeeze_breakout_copies_its_two_formula_templates():
    indicators = _indicators()
    strategies = FakeStrategies()
    svc = _svc(
        templates=FakeTemplates(*_strategy_rows()), strategies=strategies, indicators=indicators
    )
    _out, ctx = await _instantiate(svc, template_id="tpl-squeeze_breakout_trend")
    ctx.abort.assert_not_awaited()
    (_method, request, _md) = indicators.of("InstantiateTemplate")[0]
    assert sorted(request.template_ids) == [
        "tpl-bollinger_squeeze_percentile",
        "tpl-volatility_trailing_stop_direction",
    ]
    by_ref = {c["ref_name"]: c for c in strategies.created[-1]["definition_json"]["components"]}
    assert by_ref["sqz"]["formula_id"] == "bob-tpl-bollinger_squeeze_percentile"
    assert by_ref["vts"]["formula_id"] == "bob-tpl-volatility_trailing_stop_direction"


async def test_ac37_non_admin_instantiates_the_blend_template_under_the_copy_id():
    strategies = FakeStrategies()
    svc = _svc(templates=FakeTemplates(*_strategy_rows()), strategies=strategies)
    out, ctx = await _instantiate(svc, template_id=f"tpl-{_BLEND_ID}")
    ctx.abort.assert_not_awaited()
    assert out.strategy_id == f"{_BLEND_ID}_copy"
    created = strategies.created[-1]
    assert created["strategy_id"] == f"{_BLEND_ID}_copy"
    assert not created["active"] and not created["live_enabled"]
    by_ref = {c["ref_name"]: c for c in created["definition_json"]["components"]}
    assert by_ref["fscore"]["formula_id"] == f"bob-{_COMPOSITE_TPL}"
    assert _SYSTEM_FORMULA_ID not in json.dumps(created["definition_json"])


def _blend_seed() -> tuple[str, dict]:
    lits = _literals(_MIGRATIONS, "*_seed_fundamentals_blend_strategy.up.sql")
    assert len(lits) == 2, len(lits)
    return lits[0], json.loads(lits[1])


async def test_ac31_the_seeded_blend_strategy_is_a_valid_register_form_definition():
    display_name, payload = _blend_seed()
    definition = _strict(payload)
    assert definition.strategy_id == _BLEND_ID and definition.display_name == display_name
    assert not set(payload) & set(_ABSENT_KEYS)
    customs = _custom_components(payload)
    assert customs and all(c["formula_id"] == _SYSTEM_FORMULA_ID for c in customs)
    assert not set(payload.get("signal_params", {})) & servicer_mod._DEAD_SIGNAL_PARAM_KEYS
    servicer_mod._normalize_source_symbols(definition)
    assert json_format.MessageToDict(definition, preserving_proto_field_name=True) == payload

    composite = _formula_payloads()[_COMPOSITE_TPL]
    system_formula = indicators_pb2.FormulaDefinition(
        formula_id=_SYSTEM_FORMULA_ID,
        name=composite.name,
        author="system",
        outputs=composite.outputs,
        fundamental_inputs=composite.fundamental_inputs,
    )
    svc = _svc(indicators=RecordingStub({"GetFormula": system_formula}))
    ctx = ctx_with(_BOB)
    await svc._validate_definition_proto(definition, ctx)
    ctx.abort.assert_not_awaited()

    text = sorted(_MIGRATIONS.glob("*_seed_fundamentals_blend_strategy.up.sql"))[0].read_text()
    assert "identity.users" in text and "'admin@localhost'" in text
    assert (
        re.search(r"TRUE,\s*FALSE", text)
        and "ON CONFLICT (user_id, strategy_id) DO NOTHING" in text
    )
    assert "tpl-" not in text and "requires-env" not in text and "config.config_values" not in text

"""Feature 335 — the seeded formula templates are valid, executable and pinned.

The seed is raw SQL, so it bypasses every ManageTemplate validator; these tests run each seeded
payload through the same checks and the sandbox.
"""

import copy
import datetime
import json
import re
from pathlib import Path

import pytest
from gen.indicators.v1 import indicators_pb2
from google.protobuf.json_format import MessageToDict, ParseDict
from google.protobuf.struct_pb2 import Struct

from app.formulas import fundamentals_value_quality as composite_module
from app.handlers.servicer import _validate_register_payload
from app.services import parameters as params_validation
from app.services.sandbox import execute_formula
from tests.test_formula_templates import _instantiate, _servicer, _user

_MIGRATIONS = Path(__file__).resolve().parent.parent / "migrations"
_COMPOSITE_ID = "tpl-fundamentals_value_quality_composite_template"
_COMPOSITE_NAME = "Fundamentals Value+Quality Composite (template)"
_NAMES = {
    "Volatility Trailing Stop Direction",
    "Bollinger Squeeze Percentile",
    _COMPOSITE_NAME,
    "SMA Trend Slope (fractional)",
    "Momentum Quality (Clenow)",
    "Kaufman Efficiency Ratio",
    "Mean-Reversion Z-Score",
    "rolling_zscore_v2",
    "kaufman_efficiency_ratio_v2",
}
_IMPORTS = ["numpy", "pandas", "math", "statistics"]
_CLOSES = [
    100.0 + 0.4 * i + (3.0 if i % 7 == 0 else -1.5 if i % 5 == 0 else 0.0) for i in range(60)
]
_FUNDAMENTALS = {
    "pe_ratio": 18,
    "pb_ratio": 2.5,
    "dividend_yield": 0.02,
    "roe": 0.15,
    "debt_to_equity": 1.0,
    "eps": 2.0,
}


def _seed_text() -> str:
    matches = sorted(_MIGRATIONS.glob("*_seed_formula_templates.up.sql"))
    assert len(matches) == 1, matches
    return matches[0].read_text()


def _rows() -> list[dict]:
    literals = re.findall(r"\$t\$(.*?)\$t\$", _seed_text(), re.DOTALL)
    assert literals and len(literals) % 4 == 0, len(literals)
    now = datetime.datetime.now(datetime.UTC)
    return [
        {
            "template_id": literals[i],
            "name": literals[i + 1],
            "description": literals[i + 2],
            "payload": json.loads(literals[i + 3]),
            "version": 1,
            "retired_at": None,
            "created_by": "system",
            "created_at": now,
            "updated_at": now,
        }
        for i in range(0, len(literals), 4)
    ]


def _seeded_servicer():
    svc = _servicer()
    svc._templates_repo.rows = {r["template_id"]: r for r in _rows()}
    return svc


def _defaults(payload: dict) -> dict:
    """Declared defaults resolved the way ExecuteFormula resolves them (INT params become ints)."""
    parsed = ParseDict(payload, indicators_pb2.RegisterFormulaRequest())
    supplied = Struct()
    supplied.update({p["name"]: p["defaultValue"] for p in payload.get("parameters", [])})
    resolved, errors = params_validation.resolve_and_validate(parsed.parameters, supplied)
    assert errors == [], errors
    return resolved


def _diff(payload: dict, module) -> list[str]:
    """Field paths at which a composite payload differs from the code module."""
    expected = {
        "source": module.SOURCE,
        "parameters": {p.name: MessageToDict(p) for p in module.PARAMETERS},
        "outputs": {o.name: MessageToDict(o) for o in module.OUTPUTS},
        "fundamentalInputs": [
            indicators_pb2.FundamentalMetric.Name(m) for m in module.FUNDAMENTAL_INPUTS
        ],
    }
    actual = {
        "source": payload.get("source"),
        "parameters": {p["name"]: p for p in payload.get("parameters", [])},
        "outputs": {o["name"]: o for o in payload.get("outputs", [])},
        "fundamentalInputs": payload.get("fundamentalInputs", []),
    }
    out = []
    for field in ("source", "fundamentalInputs"):
        if expected[field] != actual[field]:
            out.append(field)
    for field in ("parameters", "outputs"):
        for name in sorted(set(expected[field]) | set(actual[field])):
            want, got = expected[field].get(name), actual[field].get(name)
            if want is None or got is None:
                out.append(f"{field}.{name}")
                continue
            out += [
                f"{field}.{name}.{key}"
                for key in sorted(set(want) | set(got))
                if want.get(key) != got.get(key)
            ]
    return out


def test_every_payload_parses_strictly_and_passes_the_register_validators():
    for row in _rows():
        parsed = ParseDict(row["payload"], indicators_pb2.RegisterFormulaRequest())
        _validate_register_payload(parsed)
        assert parsed.name == row["name"], row["template_id"]
        assert parsed.description == row["description"], row["template_id"]
        assert not parsed.is_public and not parsed.author, row["template_id"]
        assert MessageToDict(parsed) == row["payload"], row["template_id"]


def test_ac19_seeded_rows_are_system_authored_tpl_ids():
    rows = _rows()
    assert all(re.fullmatch(r"tpl-[a-z0-9_]+", r["template_id"]) for r in rows)
    assert len({r["template_id"] for r in rows}) == len(rows)
    text = _seed_text()
    assert text.count("::jsonb, 'system')") == len(rows)
    assert "requires-env" not in text and "COMMIT" not in text


async def test_ac1_ac22_catalog_lists_the_nine_seeded_templates_read_only():
    svc = _seeded_servicer()
    listed = await svc.ListTemplates(indicators_pb2.ListTemplatesRequest(), _user("bob"))
    assert len(listed.templates) == 9
    assert {t.meta.name for t in listed.templates} == _NAMES
    assert all(t.meta.version == 1 and t.meta.read_only for t in listed.templates)
    assert all(t.meta.template_id.startswith("tpl-") for t in listed.templates)


_IDS = [
    "tpl-volatility_trailing_stop_direction",
    "tpl-bollinger_squeeze_percentile",
    _COMPOSITE_ID,
    "tpl-sma_trend_slope_fractional",
    "tpl-momentum_quality_clenow",
    "tpl-kaufman_efficiency_ratio",
    "tpl-mean_reversion_z_score",
    "tpl-rolling_zscore_v2",
    "tpl-kaufman_efficiency_ratio_v2",
]


def test_the_seed_holds_exactly_the_nine_ids():
    assert sorted(r["template_id"] for r in _rows()) == sorted(_IDS)


@pytest.mark.parametrize("template_id", _IDS)
def test_every_seeded_source_runs_in_the_sandbox(template_id):
    row = next(r for r in _rows() if r["template_id"] == template_id)
    payload = row["payload"]
    is_composite = row["template_id"] == _COMPOSITE_ID
    res = execute_formula(
        source=payload["source"],
        input_data=_FUNDAMENTALS if is_composite else {"close": _CLOSES},
        allowed_imports=_IMPORTS,
        params=_defaults(payload),
    )
    assert res.success, (row["template_id"], res.error)
    for name in ["value", *(o["name"] for o in payload.get("outputs", []))]:
        assert name in res.output, (row["template_id"], name)


async def test_ac2_volatility_stop_template_instantiates_into_a_runnable_private_formula():
    svc = _seeded_servicer()
    copy_ = await _instantiate(
        svc, user="bob", template_id="tpl-volatility_trailing_stop_direction"
    )
    assert copy_.author == "bob"
    declared = {p.name: MessageToDict(p)["defaultValue"] for p in copy_.parameters}
    assert declared == {"period": 22, "multiplier": 3.0}
    res = execute_formula(
        source=copy_.source,
        input_data={"close": _CLOSES},
        allowed_imports=_IMPORTS,
        params={"period": 22, "multiplier": 3.0},
    )
    assert res.success, res.error
    assert len(res.output["value"]) == 60 and len(res.output["stop_line"]) == 60


def _composite_payload() -> dict:
    return next(r for r in _rows() if r["template_id"] == _COMPOSITE_ID)["payload"]


def test_ac20_composite_template_matches_the_code_module():
    payload = _composite_payload()
    assert _diff(payload, composite_module) == []
    assert payload["name"] == _COMPOSITE_NAME
    assert composite_module.FORMULA_ID not in json.dumps(payload)


def test_ac21_a_drifted_composite_default_is_reported_by_field_path():
    drifted = copy.deepcopy(_composite_payload())
    for param in drifted["parameters"]:
        if param["name"] == "pe_good":
            param["defaultValue"] = 11.0
    assert _diff(drifted, composite_module) == ["parameters.pe_good.defaultValue"]

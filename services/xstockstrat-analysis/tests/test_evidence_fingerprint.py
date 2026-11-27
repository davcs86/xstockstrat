"""Feature 327 — the formula-aware evidence fingerprint helpers (pure, no servicer instance).

Covers the AC-1 parts: a behavioural formula edit moves `_formula_digest`, a display edit does not,
and `_evidence_fingerprint` is byte-identical to `_definition_fingerprint` without formula digests.
"""

import pytest
from gen.common.v1 import common_pb2
from gen.indicators.v1 import indicators_pb2
from google.protobuf import struct_pb2, timestamp_pb2

from app.handlers.servicer import (
    _FORMULA_BEHAVIOURAL_FIELDS,
    _FORMULA_DISPLAY_FIELDS,
    _FORMULA_OUTPUT_BEHAVIOURAL_FIELDS,
    _FORMULA_OUTPUT_DISPLAY_FIELDS,
    _FORMULA_PARAMETER_BEHAVIOURAL_FIELDS,
    _FORMULA_PARAMETER_DISPLAY_FIELDS,
    _UNREADABLE,
    _definition_fingerprint,
    _evidence_fingerprint,
    _formula_digest,
    _FormulaVersionUnknown,
    _GradeInputsUnknown,
)

_DEFINITION = {"strategy_id": "s1", "components": [{"kind": "CUSTOM_FORMULA", "formula_id": "f-1"}]}


def _formula() -> indicators_pb2.FormulaDefinition:
    return indicators_pb2.FormulaDefinition(
        formula_id="f-1",
        name="momentum",
        description="a momentum formula",
        source="result = close - close.shift(5)",
        author="alice",
        created_at=timestamp_pb2.Timestamp(seconds=1_700_000_000),
        updated_at=timestamp_pb2.Timestamp(seconds=1_700_000_100),
        input_schema={"close": "series"},
        parameters=[
            indicators_pb2.FormulaParameter(
                name="lookback",
                type=indicators_pb2.PARAMETER_TYPE_INT,
                default_value=struct_pb2.Value(number_value=5),
                description="bars back",
                required=True,
            )
        ],
        outputs=[indicators_pb2.FormulaOutput(name="signal", description="the signal line")],
        warmup_period=5,
        fundamental_inputs=[indicators_pb2.FUNDAMENTAL_METRIC_PE_RATIO],
    )


@pytest.mark.parametrize(
    ("message", "behavioural", "display"),
    [
        (indicators_pb2.FormulaDefinition, _FORMULA_BEHAVIOURAL_FIELDS, _FORMULA_DISPLAY_FIELDS),
        (
            indicators_pb2.FormulaParameter,
            _FORMULA_PARAMETER_BEHAVIOURAL_FIELDS,
            _FORMULA_PARAMETER_DISPLAY_FIELDS,
        ),
        (
            indicators_pb2.FormulaOutput,
            _FORMULA_OUTPUT_BEHAVIOURAL_FIELDS,
            _FORMULA_OUTPUT_DISPLAY_FIELDS,
        ),
    ],
)
def test_every_proto_field_is_classified_exactly_once(message, behavioural, display):
    assert {f.name for f in message.DESCRIPTOR.fields} == behavioural | display
    assert behavioural & display == set()


def _set_author(f):
    f.author = "bob"


def _set_name(f):
    f.name = "renamed"


def _set_description(f):
    f.description = "reworded"


def _set_updated_at(f):
    f.updated_at.seconds += 3600


def _set_created_at(f):
    f.created_at.seconds += 3600


def _set_deleted(f):
    f.deleted = True


def _set_origin(f):
    f.origin.CopyFrom(common_pb2.TemplateOrigin(template_id="t-1", template_version=2))


def _set_parameter_description(f):
    f.parameters[0].description = "a different help text"


def _set_output_description(f):
    f.outputs[0].description = "a different help text"


def _set_source(f):
    f.source = "result = close - close.shift(10)"


def _set_warmup_period(f):
    f.warmup_period = 10


def _set_fundamental_inputs(f):
    f.fundamental_inputs.append(indicators_pb2.FUNDAMENTAL_METRIC_ROE)


def _set_input_schema(f):
    f.input_schema["volume"] = "series"


def _set_parameter_default(f):
    f.parameters[0].default_value.number_value = 7


def _set_parameter_min_zero(f):
    f.parameters[0].min = 0.0


def _set_output_name(f):
    f.outputs[0].name = "trigger"


@pytest.mark.parametrize(
    "mutate",
    [
        _set_author,
        _set_name,
        _set_description,
        _set_updated_at,
        _set_created_at,
        _set_deleted,
        _set_origin,
        _set_parameter_description,
        _set_output_description,
    ],
)
def test_display_edit_leaves_digest_unchanged(mutate):
    edited = _formula()
    mutate(edited)
    assert _formula_digest(edited) == _formula_digest(_formula())


@pytest.mark.parametrize(
    "mutate",
    [
        _set_source,
        _set_warmup_period,
        _set_fundamental_inputs,
        _set_input_schema,
        _set_parameter_default,
        _set_parameter_min_zero,
        _set_output_name,
    ],
)
def test_behavioural_edit_changes_digest(mutate):
    edited = _formula()
    mutate(edited)
    assert _formula_digest(edited) != _formula_digest(_formula())


def test_no_digests_is_byte_identical_to_definition_fingerprint():
    assert _evidence_fingerprint(_DEFINITION, {}) == _definition_fingerprint(_DEFINITION)


def test_composite_fingerprint_shape():
    def_hash = _definition_fingerprint(_DEFINITION)
    fp = _evidence_fingerprint(_DEFINITION, {"f-1": "a" * 64, "f-2": "b" * 64})
    assert fp.startswith(def_hash + ".")
    assert fp.count(".") == 1


def test_composite_fingerprint_ignores_dict_insertion_order():
    forward = _evidence_fingerprint(_DEFINITION, {"f-1": "a" * 64, "f-2": "b" * 64})
    backward = _evidence_fingerprint(_DEFINITION, {"f-2": "b" * 64, "f-1": "a" * 64})
    assert forward == backward


def test_composite_fingerprint_moves_with_a_digest():
    before = _evidence_fingerprint(_DEFINITION, {"f-1": "a" * 64})
    after = _evidence_fingerprint(_DEFINITION, {"f-1": "c" * 64})
    assert before != after


@pytest.mark.parametrize("digest", [None, _UNREADABLE])
def test_unknown_or_refused_digest_is_never_stamped(digest):
    with pytest.raises(ValueError):
        _evidence_fingerprint(_DEFINITION, {"f-1": "a" * 64, "f-2": digest})


def test_formula_version_unknown_is_a_grade_inputs_unknown():
    err = _FormulaVersionUnknown("f-9")
    assert isinstance(err, _GradeInputsUnknown)
    assert err.formula_id == "f-9"

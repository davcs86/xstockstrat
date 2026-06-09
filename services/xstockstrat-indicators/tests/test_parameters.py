"""Unit tests for the parameter validation/defaulting engine (app.services.parameters).

Covers ``validate_definitions`` (register/update-time definition checks) and
``resolve_and_validate`` (execute-time value resolution). No DB, no gRPC.
Run with: pytest tests/test_parameters.py
"""

import pytest
from gen.indicators.v1 import indicators_pb2 as pb
from google.protobuf.struct_pb2 import Struct

from app.services import parameters as params_validation


def _param(
    name,
    type_,
    *,
    default=None,
    required=False,
    minimum=None,
    maximum=None,
    description="",
):
    p = pb.FormulaParameter(name=name, type=type_, required=required, description=description)
    if default is not None:
        if isinstance(default, bool):
            p.default_value.bool_value = default
        elif isinstance(default, (int, float)):
            p.default_value.number_value = default
        elif isinstance(default, str):
            p.default_value.string_value = default
    if minimum is not None:
        p.min = minimum
    if maximum is not None:
        p.max = maximum
    return p


def _struct(d: dict) -> Struct:
    s = Struct()
    s.update(d)
    return s


# ---------------------------------------------------------------------------
# validate_outputs
# ---------------------------------------------------------------------------


class TestValidateOutputs:
    def test_valid_outputs_pass(self):
        params_validation.validate_outputs(
            [
                pb.FormulaOutput(name="upper", description="upper band"),
                pb.FormulaOutput(name="lower", description="lower band"),
            ]
        )

    def test_empty_outputs_pass(self):
        params_validation.validate_outputs([])

    def test_rejects_reserved_value_name(self):
        with pytest.raises(ValueError, match="reserved"):
            params_validation.validate_outputs([pb.FormulaOutput(name="value")])

    def test_rejects_invalid_identifier(self):
        with pytest.raises(ValueError, match="valid Python identifier"):
            params_validation.validate_outputs([pb.FormulaOutput(name="upper band")])

    def test_rejects_duplicate_name(self):
        with pytest.raises(ValueError, match="duplicate output name"):
            params_validation.validate_outputs(
                [pb.FormulaOutput(name="upper"), pb.FormulaOutput(name="upper")]
            )

    def test_rejects_too_many_outputs(self):
        outs = [pb.FormulaOutput(name=f"s{i}") for i in range(params_validation.MAX_OUTPUTS + 1)]
        with pytest.raises(ValueError, match="too many outputs"):
            params_validation.validate_outputs(outs)


# ---------------------------------------------------------------------------
# validate_definitions
# ---------------------------------------------------------------------------


class TestValidateDefinitions:
    def test_valid_definitions_pass(self):
        params_validation.validate_definitions(
            [
                _param("period", pb.PARAMETER_TYPE_INT, minimum=1, maximum=200),
                _param("smoothing", pb.PARAMETER_TYPE_FLOAT),
                _param("enabled", pb.PARAMETER_TYPE_BOOL),
                _param("label", pb.PARAMETER_TYPE_STRING),
            ]
        )

    def test_rejects_non_identifier_name(self):
        with pytest.raises(ValueError, match="identifier"):
            params_validation.validate_definitions([_param("2bad", pb.PARAMETER_TYPE_INT)])

    def test_rejects_duplicate_names(self):
        with pytest.raises(ValueError, match="duplicate"):
            params_validation.validate_definitions(
                [
                    _param("period", pb.PARAMETER_TYPE_INT),
                    _param("period", pb.PARAMETER_TYPE_FLOAT),
                ]
            )

    def test_rejects_unspecified_type(self):
        with pytest.raises(ValueError, match="unspecified"):
            params_validation.validate_definitions(
                [_param("period", pb.PARAMETER_TYPE_UNSPECIFIED)]
            )

    def test_rejects_min_max_on_bool(self):
        with pytest.raises(ValueError, match="non-numeric"):
            params_validation.validate_definitions(
                [_param("flag", pb.PARAMETER_TYPE_BOOL, minimum=0)]
            )

    def test_rejects_min_max_on_string(self):
        with pytest.raises(ValueError, match="non-numeric"):
            params_validation.validate_definitions(
                [_param("label", pb.PARAMETER_TYPE_STRING, maximum=10)]
            )

    def test_rejects_min_greater_than_max(self):
        with pytest.raises(ValueError, match="min"):
            params_validation.validate_definitions(
                [_param("period", pb.PARAMETER_TYPE_INT, minimum=10, maximum=1)]
            )

    def test_rejects_too_many_parameters(self):
        many = [
            _param(f"p{i}", pb.PARAMETER_TYPE_INT)
            for i in range(params_validation.MAX_PARAMETERS + 1)
        ]
        with pytest.raises(ValueError, match="too many"):
            params_validation.validate_definitions(many)


# ---------------------------------------------------------------------------
# resolve_and_validate
# ---------------------------------------------------------------------------


class TestResolveAndValidate:
    def test_applies_default_for_omitted(self):
        params = [_param("period", pb.PARAMETER_TYPE_INT, default=14)]
        resolved, errors = params_validation.resolve_and_validate(params, _struct({}))
        assert errors == []
        assert resolved == {"period": 14}

    def test_coerces_int_from_struct_float(self):
        # Struct numbers arrive as floats; an integral float resolves to int.
        params = [_param("period", pb.PARAMETER_TYPE_INT)]
        resolved, errors = params_validation.resolve_and_validate(params, _struct({"period": 7.0}))
        assert errors == []
        assert resolved == {"period": 7}
        assert isinstance(resolved["period"], int)

    def test_coerces_float(self):
        params = [_param("alpha", pb.PARAMETER_TYPE_FLOAT)]
        resolved, errors = params_validation.resolve_and_validate(params, _struct({"alpha": 2}))
        assert errors == []
        assert resolved["alpha"] == 2.0
        assert isinstance(resolved["alpha"], float)

    def test_coerces_bool_and_string(self):
        params = [
            _param("enabled", pb.PARAMETER_TYPE_BOOL),
            _param("label", pb.PARAMETER_TYPE_STRING),
        ]
        resolved, errors = params_validation.resolve_and_validate(
            params, _struct({"enabled": True, "label": "rsi"})
        )
        assert errors == []
        assert resolved == {"enabled": True, "label": "rsi"}

    def test_rejects_non_integral_int(self):
        params = [_param("period", pb.PARAMETER_TYPE_INT)]
        resolved, errors = params_validation.resolve_and_validate(params, _struct({"period": 7.5}))
        assert ("period", "expected an integer") in errors

    def test_rejects_out_of_range(self):
        params = [_param("period", pb.PARAMETER_TYPE_INT, minimum=1, maximum=200)]
        _, low = params_validation.resolve_and_validate(params, _struct({"period": 0}))
        _, high = params_validation.resolve_and_validate(params, _struct({"period": 500}))
        assert any(n == "period" and "minimum" in r for n, r in low)
        assert any(n == "period" and "maximum" in r for n, r in high)

    def test_rejects_unknown_key(self):
        params = [_param("period", pb.PARAMETER_TYPE_INT, default=14)]
        _, errors = params_validation.resolve_and_validate(params, _struct({"bogus": 1}))
        assert ("bogus", "unknown parameter") in errors

    def test_rejects_missing_required(self):
        params = [_param("period", pb.PARAMETER_TYPE_INT, required=True)]
        _, errors = params_validation.resolve_and_validate(params, _struct({}))
        assert ("period", "missing required parameter") in errors

    def test_rejects_type_mismatch(self):
        params = [_param("enabled", pb.PARAMETER_TYPE_BOOL)]
        _, errors = params_validation.resolve_and_validate(params, _struct({"enabled": "yes"}))
        assert ("enabled", "expected a boolean") in errors

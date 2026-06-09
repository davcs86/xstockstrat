"""
Parameter validation and defaulting engine for formula parameters.

Two entry points:

- ``validate_definitions(parameters)`` — register/update-time check of a list of
  ``FormulaParameter`` definitions. Raises ``ValueError`` on any invalid definition
  (bad identifier, duplicate name, ``UNSPECIFIED`` type, ``min``/``max`` on a
  non-numeric type, ``min > max``, or more than ``MAX_PARAMETERS`` parameters).

- ``resolve_and_validate(parameters, input_params_struct)`` — execute-time
  resolution of caller-supplied parameter VALUES against the declared definitions.
  Applies declared defaults for omitted parameters, coerces/type-checks supplied
  values, and enforces ``min``/``max`` for numeric parameters. Returns the resolved
  ``params`` dict plus a list of ``(name, reason)`` errors. It does **not** raise on
  value errors — the servicer maps the returned errors to ``parameter_errors``.

Parameter VALUES travel in ``ExecuteFormulaRequest.input_params`` (a
``google.protobuf.Struct``) and are exposed to the formula as a separate ``params``
variable, never merged into ``data`` (the OHLCV/series input).
"""

import re

from gen.indicators.v1 import indicators_pb2 as pb
from google.protobuf.json_format import MessageToDict

MAX_PARAMETERS = 32
_IDENT_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")

_NUMERIC_TYPES = (pb.PARAMETER_TYPE_INT, pb.PARAMETER_TYPE_FLOAT)


def _value_to_py(value):
    """Convert a ``google.protobuf.Value`` to a native Python value."""
    kind = value.WhichOneof("kind")
    if kind is None or kind == "null_value":
        return None
    if kind == "number_value":
        return value.number_value
    if kind == "string_value":
        return value.string_value
    if kind == "bool_value":
        return value.bool_value
    if kind == "struct_value":
        return MessageToDict(value.struct_value)
    if kind == "list_value":
        return [_value_to_py(v) for v in value.list_value.values]
    return None


def validate_definitions(parameters) -> None:
    """Validate a list of FormulaParameter definitions; raise ValueError if invalid.

    Used at register/update time (called from the servicer).
    """
    if len(parameters) > MAX_PARAMETERS:
        raise ValueError(f"too many parameters: {len(parameters)} (max {MAX_PARAMETERS})")
    seen: set[str] = set()
    for p in parameters:
        if not _IDENT_RE.match(p.name or ""):
            raise ValueError(f"parameter name {p.name!r} is not a valid Python identifier")
        if p.name in seen:
            raise ValueError(f"duplicate parameter name {p.name!r}")
        seen.add(p.name)
        if p.type == pb.PARAMETER_TYPE_UNSPECIFIED:
            raise ValueError(f"parameter {p.name!r} has unspecified type")
        is_numeric = p.type in _NUMERIC_TYPES
        has_min = p.HasField("min")
        has_max = p.HasField("max")
        if (has_min or has_max) and not is_numeric:
            raise ValueError(f"parameter {p.name!r} sets min/max on a non-numeric type")
        if has_min and has_max and p.min > p.max:
            raise ValueError(f"parameter {p.name!r} has min ({p.min}) greater than max ({p.max})")


def _coerce(p, raw):
    """Coerce ``raw`` to the parameter's declared type.

    Returns ``(value, None)`` on success or ``(None, reason)`` on a type mismatch.
    Numbers arriving via a Struct are floats, so INT accepts integral floats.
    """
    if p.type == pb.PARAMETER_TYPE_BOOL:
        if isinstance(raw, bool):
            return raw, None
        return None, "expected a boolean"
    # bool is a subclass of int — reject it for numeric/string params explicitly.
    if p.type == pb.PARAMETER_TYPE_INT:
        if isinstance(raw, bool) or not isinstance(raw, (int, float)):
            return None, "expected an integer"
        if isinstance(raw, float) and not raw.is_integer():
            return None, "expected an integer"
        return int(raw), None
    if p.type == pb.PARAMETER_TYPE_FLOAT:
        if isinstance(raw, bool) or not isinstance(raw, (int, float)):
            return None, "expected a number"
        return float(raw), None
    if p.type == pb.PARAMETER_TYPE_STRING:
        if not isinstance(raw, str):
            return None, "expected a string"
        return raw, None
    return None, "unsupported parameter type"


def resolve_and_validate(parameters, input_params_struct):
    """Resolve supplied parameter VALUES against declared definitions.

    Returns ``(resolved_params, errors)`` where ``errors`` is a list of
    ``(name, reason)`` tuples. Does not raise on value errors.
    """
    supplied = MessageToDict(input_params_struct) if input_params_struct else {}
    declared = {p.name: p for p in parameters}

    resolved: dict = {}
    errors: list[tuple[str, str]] = []

    # Unknown keys (supplied but not declared).
    for key in supplied:
        if key not in declared:
            errors.append((key, "unknown parameter"))

    for name, p in declared.items():
        if name in supplied:
            value, reason = _coerce(p, supplied[name])
            if reason is not None:
                errors.append((name, reason))
                continue
            if p.type in _NUMERIC_TYPES:
                if p.HasField("min") and value < p.min:
                    errors.append((name, f"below minimum {p.min}"))
                    continue
                if p.HasField("max") and value > p.max:
                    errors.append((name, f"above maximum {p.max}"))
                    continue
            resolved[name] = value
        elif p.required:
            errors.append((name, "missing required parameter"))
        else:
            resolved[name] = _value_to_py(p.default_value)

    return resolved, errors

"""Fundamentals-scoring consumer helper (feature 063).

Thin wrapper over the existing indicators ``ExecuteFormula`` RPC: it passes a symbol's
raw fundamentals as ``input_data`` and the optional tunable overrides as ``input_params``
(never merged), then parses the ``{value, quality, composite}`` sub-scores from the
response Struct. Feature 062 calls this from its producer path with the
``analysis.fundsignal.scoring_formula_id`` it owns; 063 owns only the call mechanics and
the parse contract. This module is a pure helper — no RPC handler, config read, or migration.
"""

from gen.indicators.v1 import indicators_pb2
from google.protobuf.struct_pb2 import Struct


class FundamentalsScoringError(RuntimeError):
    """Raised when the scoring formula execution fails."""


async def score_fundamentals(
    indicators_stub,
    formula_id: str,
    fundamentals: dict,
    metadata,
    params: dict | None = None,
    timeout_ms_override: int = 0,
) -> dict:
    """Execute the value+quality formula for one symbol and return its sub-scores.

    Args:
        indicators_stub: an ``IndicatorsServiceStub``.
        formula_id: the well-known scoring formula id (062 supplies it).
        fundamentals: raw fundamental metrics (``pe_ratio``, ``pb_ratio``, ``roe``, …).
        metadata: per-call propagation metadata (``x-user-id``/``x-access-scope``/
            ``x-trace-id``) — forwarded verbatim on the outbound call.
        params: optional tunable overrides (band endpoints / weights) → ``input_params``.
        timeout_ms_override: reserved; currently advisory only.

    Returns:
        ``{"value": float, "quality": float, "composite": float}``.

    Raises:
        FundamentalsScoringError: if the formula run reports ``success=False``.
    """
    input_struct = Struct()
    # Only the raw fundamentals go in input_data — never tunables.
    input_struct.update(fundamentals)

    params_struct = Struct()
    if params:
        params_struct.update(params)

    resp = await indicators_stub.ExecuteFormula(
        indicators_pb2.ExecuteFormulaRequest(
            formula_id=formula_id,
            input_data=input_struct,
            input_params=params_struct,
        ),
        metadata=metadata,
    )

    if not resp.success:
        raise FundamentalsScoringError(
            f"fundamentals scoring failed (formula {formula_id}): "
            f"{resp.error or ''} reason={resp.exit_reason}"
        )

    out = dict(resp.output)
    return {
        "value": float(out.get("value", 0.0)),
        "quality": float(out.get("quality", 0.0)),
        "composite": float(out.get("composite", 0.0)),
    }

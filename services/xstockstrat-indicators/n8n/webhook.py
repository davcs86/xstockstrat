"""
n8n webhook handler for xstockstrat-indicators.
Translates incoming HTTP POST payloads to internal gRPC calls.
Mount at: POST /webhooks/n8n/:action
"""

import logging

import grpc
from fastapi import APIRouter, HTTPException
from gen.indicators.v1 import indicators_pb2, indicators_pb2_grpc
from pydantic import BaseModel

log = logging.getLogger(__name__)

router = APIRouter(prefix="/webhooks/n8n")


class ComputeIndicatorPayload(BaseModel):
    indicator: str
    values: list[float]
    params: dict[str, float] = {}
    symbol: str | None = None
    timeframe: str | None = None


class ExecuteFormulaPayload(BaseModel):
    formula_id: str | None = None
    formula_source: str | None = None
    input_data: dict = {}
    timeout_ms_override: int = 0
    memory_bytes_override: int = 0


_stub: indicators_pb2_grpc.IndicatorsServiceStub | None = None


def init_stub(grpc_channel: grpc.Channel):
    global _stub
    _stub = indicators_pb2_grpc.IndicatorsServiceStub(grpc_channel)


@router.post("/compute-indicator")
async def compute_indicator_webhook(payload: ComputeIndicatorPayload):
    """n8n → compute a built-in indicator."""
    if _stub is None:
        raise HTTPException(status_code=503, detail="gRPC stub not initialized")
    try:
        resp = _stub.ComputeIndicator(
            indicators_pb2.ComputeIndicatorRequest(
                indicator=payload.indicator,
                values=payload.values,
                params=payload.params,
                symbol=payload.symbol or "",
                timeframe=payload.timeframe or "",
            )
        )
        return {
            "indicator": resp.indicator,
            "result": [{"value": p.value, **dict(p.extra)} for p in resp.result],
            "params_used": dict(resp.params_used),
        }
    except grpc.RpcError as e:
        log.error("gRPC error: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/execute-formula")
async def execute_formula_webhook(payload: ExecuteFormulaPayload):
    """n8n → execute a custom sandboxed formula."""
    if _stub is None:
        raise HTTPException(status_code=503, detail="gRPC stub not initialized")
    from google.protobuf.struct_pb2 import Struct

    input_struct = Struct()
    input_struct.update(payload.input_data)
    try:
        resp = _stub.ExecuteFormula(
            indicators_pb2.ExecuteFormulaRequest(
                formula_id=payload.formula_id or "",
                formula_source=payload.formula_source or "",
                input_data=input_struct,
                timeout_ms_override=payload.timeout_ms_override,
                memory_bytes_override=payload.memory_bytes_override,
            )
        )
        return {
            "success": resp.success,
            "output": dict(resp.output),
            "execution_ms": resp.execution_ms,
            "exit_reason": indicators_pb2.SandboxExitReason.Name(resp.exit_reason),
            "error": resp.error,
        }
    except grpc.RpcError as e:
        log.error("gRPC error: %s", e)
        raise HTTPException(status_code=500, detail=str(e))

"""
IndicatorsServicer — gRPC servicer implementation.
"""

import logging

import grpc
from gen.indicators.v1 import indicators_pb2, indicators_pb2_grpc
from google.protobuf.struct_pb2 import Struct

from app.config.watcher import ConfigWatcher
from app.services import indicators_engine, sandbox

log = logging.getLogger(__name__)


class IndicatorsServicer(indicators_pb2_grpc.IndicatorsServiceServicer):
    def __init__(self, config_watcher: ConfigWatcher):
        self._cfg = config_watcher
        self._formulas: dict[str, indicators_pb2.FormulaDefinition] = {}

    async def ComputeIndicator(self, request, context):
        try:
            results = indicators_engine.compute(
                indicator=request.indicator,
                values=list(request.values),
                params=dict(request.params),
            )
        except ValueError as e:
            await context.abort(grpc.StatusCode.INVALID_ARGUMENT, str(e))
            return

        points = []
        for i, r in enumerate(results):
            if r.get("value") is None:
                continue
            extra = {k: v for k, v in r.items() if k != "value" and v is not None}
            points.append(
                indicators_pb2.IndicatorPoint(
                    value=r["value"],
                    extra=extra,
                )
            )

        return indicators_pb2.ComputeIndicatorResponse(
            result=points,
            indicator=request.indicator,
            params_used=dict(request.params),
        )

    async def ExecuteFormula(self, request, context):
        # Resolve source
        if request.formula_id:
            formula = self._formulas.get(request.formula_id)
            if formula is None:
                await context.abort(
                    grpc.StatusCode.NOT_FOUND, f"formula {request.formula_id} not found"
                )
                return
            source = formula.source
        elif request.formula_source:
            source = request.formula_source
        else:
            await context.abort(
                grpc.StatusCode.INVALID_ARGUMENT, "formula_id or formula_source required"
            )
            return

        # Resolve sandbox limits from config (override if specified in request)
        timeout_ms = request.timeout_ms_override or self._cfg.sandbox_timeout_ms
        memory_bytes = request.memory_bytes_override or self._cfg.sandbox_memory_bytes
        allowed_imports = self._cfg.sandbox_allowed_imports

        # Convert protobuf Struct to dict
        input_data = dict(request.input_data)

        log.info(
            "executing formula timeout_ms=%d memory_bytes=%d",
            timeout_ms,
            memory_bytes,
        )

        result = sandbox.execute_formula(
            source=source,
            input_data=input_data,
            allowed_imports=allowed_imports,
            timeout_ms=timeout_ms,
            memory_bytes=memory_bytes,
        )

        exit_reason_map = {
            "success": indicators_pb2.SANDBOX_EXIT_REASON_SUCCESS,
            "timeout": indicators_pb2.SANDBOX_EXIT_REASON_TIMEOUT,
            "memory_exceeded": indicators_pb2.SANDBOX_EXIT_REASON_MEMORY_EXCEEDED,
            "runtime_error": indicators_pb2.SANDBOX_EXIT_REASON_RUNTIME_ERROR,
            "import_blocked": indicators_pb2.SANDBOX_EXIT_REASON_IMPORT_BLOCKED,
        }

        output_struct = Struct()
        output_struct.update(result.output)

        return indicators_pb2.ExecuteFormulaResponse(
            success=result.success,
            output=output_struct,
            stdout=result.stdout,
            stderr=result.stderr,
            execution_ms=result.execution_ms,
            memory_used_bytes=result.memory_used_bytes,
            error=result.error,
            exit_reason=exit_reason_map.get(
                result.exit_reason, indicators_pb2.SANDBOX_EXIT_REASON_UNSPECIFIED
            ),
        )

    async def ListIndicators(self, request, context):
        metas = [
            indicators_pb2.IndicatorMeta(
                name=name,
                description=info["description"],
                required_params=info["required"],
            )
            for name, info in indicators_engine.INDICATOR_REGISTRY.items()
        ]
        return indicators_pb2.ListIndicatorsResponse(indicators=metas)

    async def RegisterFormula(self, request, context):
        import uuid

        from google.protobuf.timestamp_pb2 import Timestamp

        formula_id = str(uuid.uuid4())
        now = Timestamp()
        now.GetCurrentTime()

        formula = indicators_pb2.FormulaDefinition(
            formula_id=formula_id,
            name=request.name,
            description=request.description,
            source=request.source,
            is_public=request.is_public,
            created_at=now,
            updated_at=now,
            input_schema=dict(request.input_schema),
        )
        self._formulas[formula_id] = formula
        return indicators_pb2.RegisterFormulaResponse(formula_id=formula_id)

    async def GetFormula(self, request, context):
        formula = self._formulas.get(request.formula_id)
        if formula is None:
            await context.abort(
                grpc.StatusCode.NOT_FOUND, f"formula {request.formula_id} not found"
            )
            return
        return formula

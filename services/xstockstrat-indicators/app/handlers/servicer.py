"""
IndicatorsServicer — gRPC servicer implementation.
"""

import logging

import grpc
from gen.indicators.v1 import indicators_pb2, indicators_pb2_grpc
from google.protobuf.json_format import MessageToDict, ParseDict
from google.protobuf.struct_pb2 import Struct

from app.config.watcher import ConfigWatcher
from app.services import indicators_engine, sandbox
from app.services import parameters as params_validation
from app.services.formulas_repository import FormulasRepository

log = logging.getLogger(__name__)


class IndicatorsServicer(indicators_pb2_grpc.IndicatorsServiceServicer):
    def __init__(self, config_watcher: ConfigWatcher, db_pool=None):
        self._cfg = config_watcher
        self._formulas: dict[str, indicators_pb2.FormulaDefinition] = {}
        self._repo: FormulasRepository | None = (
            FormulasRepository(db_pool) if db_pool is not None else None
        )

    @staticmethod
    def _has_admin_scope(context) -> bool:
        """Role check on the propagated x-access-scope ADMIN bit (0x04).

        Formula management keeps author-ownership as its primary authorization model;
        this helper adds an admin-scope override (feature 049 Part A, OQ-A) for
        Update/Delete and mirrors the analysis/ingest servicers' gate.
        """
        metadata = dict(context.invocation_metadata())
        try:
            access_scope = int(metadata.get("x-access-scope", "0"))
        except (TypeError, ValueError):
            access_scope = 0
        return bool(access_scope & 0x04)

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
        formula = None
        if request.formula_id:
            formula = self._formulas.get(request.formula_id)
            if formula is None and self._repo is not None:
                row = await self._repo.get_by_id(request.formula_id)
                if row is not None:
                    formula = _row_to_formula(row)
                    self._formulas[request.formula_id] = formula
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

        # Validate parameter VALUES (input_params) against declared definitions
        # before invoking the sandbox. Inline formula_source runs have no stored
        # definition, so no declared parameters apply.
        declared_params = list(formula.parameters) if formula is not None else []
        resolved_params, param_errors = params_validation.resolve_and_validate(
            declared_params, request.input_params
        )
        if param_errors:
            return indicators_pb2.ExecuteFormulaResponse(
                success=False,
                parameter_errors=[
                    indicators_pb2.ParameterValidationError(name=n, reason=r)
                    for n, r in param_errors
                ],
            )

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
            params=resolved_params,
        )

        exit_reason_map = {
            "success": indicators_pb2.SANDBOX_EXIT_REASON_SUCCESS,
            "timeout": indicators_pb2.SANDBOX_EXIT_REASON_TIMEOUT,
            "memory_exceeded": indicators_pb2.SANDBOX_EXIT_REASON_MEMORY_EXCEEDED,
            "runtime_error": indicators_pb2.SANDBOX_EXIT_REASON_RUNTIME_ERROR,
            "import_blocked": indicators_pb2.SANDBOX_EXIT_REASON_IMPORT_BLOCKED,
        }

        # Enforce the declared output contract: a stored formula that declares output
        # series must actually emit each one (the primary "value" series is implicit
        # and checked separately by callers). Missing a declared series turns an
        # otherwise-successful run into a failure so strategies can rely on the schema.
        declared_outputs = list(formula.outputs) if formula is not None else []
        if result.success and declared_outputs:
            missing = [o.name for o in declared_outputs if o.name not in result.output]
            if missing:
                return indicators_pb2.ExecuteFormulaResponse(
                    success=False,
                    stdout=result.stdout,
                    stderr=result.stderr,
                    execution_ms=result.execution_ms,
                    memory_used_bytes=result.memory_used_bytes,
                    error=(
                        "formula did not emit declared output series: "
                        + ", ".join(sorted(missing))
                    ),
                    exit_reason=indicators_pb2.SANDBOX_EXIT_REASON_RUNTIME_ERROR,
                )

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

        # Require an authenticated author: explicit request.author wins, else fall back
        # to the propagated x-user-id. No silent default (feature 049 Part A, OQ-A).
        if request.author:
            author = request.author
        else:
            metadata = dict(context.invocation_metadata())
            x_user_id = metadata.get("x-user-id", "")
            if not x_user_id:
                await context.abort(
                    grpc.StatusCode.INVALID_ARGUMENT,
                    "authenticated user required to register a formula",
                )
                return
            author = x_user_id

        try:
            params_validation.validate_definitions(request.parameters)
            params_validation.validate_outputs(request.outputs)
        except ValueError as e:
            await context.abort(grpc.StatusCode.INVALID_ARGUMENT, str(e))
            return

        param_dicts = [MessageToDict(p) for p in request.parameters]
        output_dicts = [MessageToDict(o) for o in request.outputs]
        formula = indicators_pb2.FormulaDefinition(
            formula_id=formula_id,
            name=request.name,
            description=request.description,
            source=request.source,
            author=author,
            is_public=request.is_public,
            created_at=now,
            updated_at=now,
            input_schema=dict(request.input_schema),
            parameters=list(request.parameters),
            outputs=list(request.outputs),
        )
        self._formulas[formula_id] = formula
        if self._repo is not None:
            await self._repo.create(
                formula_id=formula_id,
                name=request.name,
                description=request.description,
                source=request.source,
                author=author,
                is_public=request.is_public,
                input_schema=dict(request.input_schema),
                parameters=param_dicts,
                outputs=output_dicts,
            )
        return indicators_pb2.RegisterFormulaResponse(formula_id=formula_id)

    async def GetFormula(self, request, context):
        formula = self._formulas.get(request.formula_id)
        if formula is None and self._repo is not None:
            row = await self._repo.get_by_id(request.formula_id)
            if row is not None:
                formula = _row_to_formula(row)
                self._formulas[request.formula_id] = formula  # cache
        if formula is None:
            await context.abort(
                grpc.StatusCode.NOT_FOUND, f"formula {request.formula_id} not found"
            )
            return
        return formula

    async def ListFormulas(self, request, context):
        if self._repo is None:
            formulas = list(self._formulas.values())
            return indicators_pb2.ListFormulasResponse(
                formulas=formulas,
                total_count=len(formulas),
            )
        rows, total = await self._repo.list(
            author_filter=request.author_filter,
            include_public=request.include_public,
            page_size=request.page_size,
            page_offset=request.page_offset,
        )
        return indicators_pb2.ListFormulasResponse(
            formulas=[_row_to_formula(r) for r in rows],
            total_count=total,
        )

    async def UpdateFormula(self, request, context):
        if self._repo is None:
            await context.abort(grpc.StatusCode.UNAVAILABLE, "DB not available")
            return
        row = await self._repo.get_by_id(request.formula_id)
        if row is None:
            await context.abort(
                grpc.StatusCode.NOT_FOUND, f"formula {request.formula_id} not found"
            )
            return
        if row["author"] != request.user_id and not self._has_admin_scope(context):
            await context.abort(
                grpc.StatusCode.PERMISSION_DENIED, "user_id does not match formula author"
            )
            return
        try:
            params_validation.validate_definitions(request.parameters)
            params_validation.validate_outputs(request.outputs)
        except ValueError as e:
            await context.abort(grpc.StatusCode.INVALID_ARGUMENT, str(e))
            return
        updated = await self._repo.update(
            formula_id=request.formula_id,
            name=request.name,
            description=request.description,
            source=request.source,
            is_public=request.is_public,
            parameters=[MessageToDict(p) for p in request.parameters],
            outputs=[MessageToDict(o) for o in request.outputs],
        )
        self._formulas.pop(request.formula_id, None)
        return indicators_pb2.UpdateFormulaResponse(formula=_row_to_formula(updated))

    async def DeleteFormula(self, request, context):
        if self._repo is None:
            await context.abort(grpc.StatusCode.UNAVAILABLE, "DB not available")
            return
        row = await self._repo.get_by_id(request.formula_id)
        if row is None:
            await context.abort(
                grpc.StatusCode.NOT_FOUND, f"formula {request.formula_id} not found"
            )
            return
        if row["author"] != request.user_id and not self._has_admin_scope(context):
            await context.abort(
                grpc.StatusCode.PERMISSION_DENIED, "user_id does not match formula author"
            )
            return
        success = await self._repo.delete(request.formula_id)
        self._formulas.pop(request.formula_id, None)
        return indicators_pb2.DeleteFormulaResponse(success=success)


def _row_to_formula(row: dict) -> "indicators_pb2.FormulaDefinition":
    """Convert a DB row dict from indicators.formulas to FormulaDefinition proto."""
    import datetime

    from google.protobuf.timestamp_pb2 import Timestamp

    def dt_to_ts(dt) -> Timestamp:
        ts = Timestamp()
        if dt is not None:
            ts.FromDatetime(dt if dt.tzinfo else dt.replace(tzinfo=datetime.UTC))
        return ts

    return indicators_pb2.FormulaDefinition(
        formula_id=str(row["formula_id"]),
        name=row["name"],
        description=row["description"] or "",
        source=row["source"],
        author=row["author"],
        is_public=row["is_public"],
        created_at=dt_to_ts(row.get("created_at")),
        updated_at=dt_to_ts(row.get("updated_at")),
        input_schema=dict(row["input_schema"]) if row.get("input_schema") else {},
        parameters=[
            ParseDict(p, indicators_pb2.FormulaParameter()) for p in (row.get("parameters") or [])
        ],
        outputs=[
            ParseDict(o, indicators_pb2.FormulaOutput()) for o in (row.get("outputs") or [])
        ],
    )

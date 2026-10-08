"""
IndicatorsServicer — gRPC servicer implementation.
"""

import asyncio
import logging
import uuid

import grpc
from gen.common.v1 import common_pb2
from gen.indicators.v1 import indicators_pb2, indicators_pb2_grpc
from gen.ledger.v1 import ledger_pb2_grpc
from google.protobuf.json_format import MessageToDict, ParseDict
from google.protobuf.struct_pb2 import Struct

from app.admin_audit import audit_admin_read
from app.config.watcher import ConfigWatcher
from app.formulas import SYSTEM_AUTHOR
from app.peer_identity import peer_san_matches
from app.services import indicators_engine, sandbox
from app.services import parameters as params_validation
from app.services.formula_templates_repository import FormulaTemplatesRepository
from app.services.formulas_repository import FormulasRepository

log = logging.getLogger(__name__)

# Internal callers that may read/execute any non-deleted formula, honored only from the peer with
# mTLS SAN _ANALYSIS_SAN. Release-N bypass for N-1 analysis; "224 enforce" removes it.
_INTERNAL_FORMULA_READERS = frozenset({"analysis"})
# The only grant under which a caller may act as the reserved `system` identity.
_SYSTEM_IDENTITY_GRANT = "analysis-fundsignal"
# Dedicated saga grant; must outlive the removal of the N-only "analysis" reader bypass.
_TEMPLATE_SAGA_GRANT = "analysis-template-saga"
_ANALYSIS_SAN = "xstockstrat-analysis"

# Fields an UpdateFormula update_mask may name; any other path is rejected INVALID_ARGUMENT.
# formula_id/user_id/author/created_at are not maskable.
_FORMULA_MASKABLE_PATHS = frozenset(
    {
        "name",
        "description",
        "source",
        "parameters",
        "outputs",
        "warmup_period",
        "fundamental_inputs",
    }
)

# feature 205 — human-readable meaning per FundamentalMetric enum value, for the authoring catalog.
# data_key is derived mechanically from the enum name; meaning is hand-authored and MUST stay
# complete (ListFundamentalMetrics fails loud on a missing entry — G2).
_FUNDAMENTAL_METRIC_MEANING: dict[int, str] = {
    indicators_pb2.FUNDAMENTAL_METRIC_MARKET_CAP: "Market cap",
    indicators_pb2.FUNDAMENTAL_METRIC_PE_RATIO: "P/E ratio",
    indicators_pb2.FUNDAMENTAL_METRIC_PB_RATIO: "P/B ratio",
    indicators_pb2.FUNDAMENTAL_METRIC_DIVIDEND_YIELD: "Dividend yield",
    indicators_pb2.FUNDAMENTAL_METRIC_EPS: "EPS",
    indicators_pb2.FUNDAMENTAL_METRIC_BETA: "Beta",
    indicators_pb2.FUNDAMENTAL_METRIC_ROE: "ROE",
    indicators_pb2.FUNDAMENTAL_METRIC_DEBT_TO_EQUITY: "Debt/equity",
    indicators_pb2.FUNDAMENTAL_METRIC_PRICE: "Price",
    indicators_pb2.FUNDAMENTAL_METRIC_YEAR_HIGH: "52-week high",
    indicators_pb2.FUNDAMENTAL_METRIC_YEAR_LOW: "52-week low",
}


class IndicatorsServicer(indicators_pb2_grpc.IndicatorsServiceServicer):
    def __init__(self, config_watcher: ConfigWatcher, db_pool=None, ledger_channel=None):
        self._cfg = config_watcher
        self._ledger = (
            ledger_pb2_grpc.LedgerServiceStub(ledger_channel)
            if ledger_channel is not None
            else None
        )
        self._formulas: dict[str, indicators_pb2.FormulaDefinition] = {}
        self._repo: FormulasRepository | None = (
            FormulasRepository(db_pool) if db_pool is not None else None
        )
        self._templates_repo: FormulaTemplatesRepository | None = (
            FormulaTemplatesRepository(db_pool) if db_pool is not None else None
        )
        self._sandbox_sem = asyncio.Semaphore(max(1, config_watcher.sandbox_max_concurrent()))

    @staticmethod
    def _has_admin_scope(context) -> bool:
        """Role check on the propagated x-access-scope ADMIN bit (0x04). It grants an audited
        read of a foreign formula only — never execute, update or delete."""
        metadata = dict(context.invocation_metadata())
        try:
            access_scope = int(metadata.get("x-access-scope", "0"))
        except (TypeError, ValueError):
            access_scope = 0
        return bool(access_scope & 0x04)

    @staticmethod
    def _caller_user_id(context, request) -> str:
        """Resolve the caller's author identity from the trusted x-user-id header,
        falling back to the deprecated request-body user_id when no header is present.
        """
        x_user_id = dict(context.invocation_metadata()).get("x-user-id", "")
        return x_user_id or request.user_id

    @staticmethod
    def _reader(context) -> str:
        """The caller identity for reads and registration: the x-user-id header only."""
        return dict(context.invocation_metadata() or ()).get("x-user-id", "")

    @staticmethod
    def _internal_grant(context, caller_id: str) -> bool:
        """x-internal-caller names ``caller_id`` AND the mTLS peer is analysis (header alone is
        spoofable by any platform peer)."""
        metadata = context.invocation_metadata() or ()
        return any(
            k == "x-internal-caller" and v == caller_id for k, v in metadata
        ) and peer_san_matches(context, _ANALYSIS_SAN)

    async def _reject_ungranted_system(self, context) -> bool:
        """Abort PERMISSION_DENIED when the caller claims `system` without the SAN-bound grant."""
        if self._reader(context) == SYSTEM_AUTHOR and not self._internal_grant(
            context, _SYSTEM_IDENTITY_GRANT
        ):
            await context.abort(
                grpc.StatusCode.PERMISSION_DENIED, "the system identity requires an internal grant"
            )
            return True
        return False

    def _can_read_formula(self, context, author: str) -> bool:
        """Owner, SYSTEM_AUTHOR, or the SAN-bound internal analysis reader."""
        if author == SYSTEM_AUTHOR:
            return True
        reader = self._reader(context)
        if reader and reader == author:
            return True
        return any(self._internal_grant(context, c) for c in _INTERNAL_FORMULA_READERS)

    async def _load_formula(self, formula_id: str):
        """The cached or stored formula, or None when missing or pending-hidden. Never fills the
        cache: callers cache only after authz succeeds."""
        formula = self._formulas.get(formula_id)
        if formula is None and self._repo is not None:
            row = await self._repo.get_by_id(formula_id)
            if row is not None and row.get("pending_intent_id") is None:
                formula = _row_to_formula(row)
        return formula

    async def _fill_origins(self, formulas) -> None:
        """Set origin.latest_version/update_available in place with ONE batched template lookup;
        a retired or missing template reports latest_version 0 and no update."""
        ids = {f.origin.template_id for f in formulas if f.origin.template_id}
        if not ids or self._templates_repo is None:
            return
        latest = await self._templates_repo.latest_versions(sorted(ids))
        for f in formulas:
            if f.origin.template_id:
                f.origin.latest_version = latest.get(f.origin.template_id, 0)
                f.origin.update_available = f.origin.latest_version > f.origin.template_version

    async def _template_owner(self, context) -> str | None:
        """The instantiating owner (x-user-id, non-empty, not `system`), else abort."""
        owner = self._reader(context)
        if not owner or owner == SYSTEM_AUTHOR:
            await context.abort(
                grpc.StatusCode.PERMISSION_DENIED, "a non-system user identity is required"
            )
            return None
        return owner

    async def _require_templates_db(self, context) -> bool:
        if self._templates_repo is None or self._repo is None:
            await context.abort(grpc.StatusCode.UNAVAILABLE, "DB not available")
            return False
        return True

    async def _audit_admin_read(self, context, ids_by_owner) -> bool:
        """Audit an admin foreign read; on failure abort UNAVAILABLE and return False."""
        try:
            await audit_admin_read(
                self._ledger,
                self._reader(context),
                "formula",
                ids_by_owner,
                context.invocation_metadata() or (),
            )
        except Exception as e:
            log.warning("admin-read audit failed: %s", e)
            await context.abort(grpc.StatusCode.UNAVAILABLE, "admin read audit unavailable")
            return False
        return True

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
        if await self._reject_ungranted_system(context):
            return
        formula = None
        if request.formula_id:
            formula = await self._load_formula(request.formula_id)
            if formula is None:
                await context.abort(
                    grpc.StatusCode.NOT_FOUND, f"formula {request.formula_id} not found"
                )
                return
            if not self._can_read_formula(context, formula.author):
                # AC-28: an admin may read a foreign formula but never run it.
                if self._has_admin_scope(context):
                    await context.abort(
                        grpc.StatusCode.PERMISSION_DENIED,
                        "admins cannot execute another user's formula",
                    )
                    return
                await context.abort(
                    grpc.StatusCode.NOT_FOUND, f"formula {request.formula_id} not found"
                )
                return
            self._formulas[request.formula_id] = formula
            source = formula.source
        elif request.formula_source:
            source = request.formula_source
        else:
            await context.abort(
                grpc.StatusCode.INVALID_ARGUMENT, "formula_id or formula_source required"
            )
            return

        # Validate input_params before the sandbox: a saved formula validates against its stored
        # definitions, an inline formula_source run against the request-supplied definitions.
        declared_params = (
            list(formula.parameters) if formula is not None else list(request.parameters)
        )
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

        timeout_ms = request.timeout_ms_override or self._cfg.sandbox_timeout_ms
        memory_bytes = request.memory_bytes_override or self._cfg.sandbox_memory_bytes
        allowed_imports = self._cfg.sandbox_allowed_imports

        # MessageToDict, not dict(): dict() leaves nested list/struct fields as protobuf objects
        # that aren't JSON-serializable and break the sandbox's json.dumps(input_data).
        input_data = MessageToDict(request.input_data)

        log.info(
            "executing formula timeout_ms=%d memory_bytes=%d",
            timeout_ms,
            memory_bytes,
        )

        # Offload the blocking subprocess.run spawn off the event loop, bounded by
        # indicators.sandbox.max_concurrent — timeout is preserved because execute_formula
        # still owns the subprocess.run(timeout=…) and still returns exit_reason="timeout".
        async with self._sandbox_sem:
            result = await asyncio.to_thread(
                sandbox.execute_formula,
                source=source,
                input_data=input_data,
                allowed_imports=allowed_imports,
                timeout_ms=timeout_ms,
                memory_bytes=memory_bytes,
                params=resolved_params,
                max_concurrent=self._cfg.sandbox_max_concurrent(),
            )

        exit_reason_map = {
            "success": indicators_pb2.SANDBOX_EXIT_REASON_SUCCESS,
            "timeout": indicators_pb2.SANDBOX_EXIT_REASON_TIMEOUT,
            "memory_exceeded": indicators_pb2.SANDBOX_EXIT_REASON_MEMORY_EXCEEDED,
            "runtime_error": indicators_pb2.SANDBOX_EXIT_REASON_RUNTIME_ERROR,
            "import_blocked": indicators_pb2.SANDBOX_EXIT_REASON_IMPORT_BLOCKED,
        }

        # A stored formula that declares output series must emit each one, else the run fails
        # (the implicit "value" series is checked by callers, not here).
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
                        "formula did not emit declared output series: " + ", ".join(sorted(missing))
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

    async def ListFundamentalMetrics(self, request, context):
        """Return the fundamental-metrics catalog for formula authoring (feature 205).

        Iterates the enum descriptor (single source of truth), skips UNSPECIFIED, derives the
        snake_case data_key mechanically, and fails loud (INTERNAL) on any enum value missing a
        registered meaning — never a silently-empty meaning (G2)."""
        metrics = []
        for value in indicators_pb2.FundamentalMetric.DESCRIPTOR.values:
            if value.number == 0:  # FUNDAMENTAL_METRIC_UNSPECIFIED
                continue
            data_key = value.name.removeprefix("FUNDAMENTAL_METRIC_").lower()
            meaning = _FUNDAMENTAL_METRIC_MEANING.get(value.number)
            if not meaning:
                await context.abort(
                    grpc.StatusCode.INTERNAL,
                    f"no meaning registered for FundamentalMetric {value.name}",
                )
            metrics.append(
                indicators_pb2.FundamentalMetricInfo(
                    metric=value.number, data_key=data_key, meaning=meaning
                )
            )
        return indicators_pb2.ListFundamentalMetricsResponse(metrics=metrics)

    async def RegisterFormula(self, request, context):
        if await self._reject_ungranted_system(context):
            return
        from google.protobuf.timestamp_pb2 import Timestamp

        formula_id = str(uuid.uuid4())
        now = Timestamp()
        now.GetCurrentTime()

        # The author is the x-user-id header only; the deprecated body author is ignored.
        author = self._reader(context)
        if not author:
            await context.abort(
                grpc.StatusCode.INVALID_ARGUMENT,
                "authenticated user required to register a formula",
            )
            return

        try:
            _validate_register_payload(request)
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
            created_at=now,
            updated_at=now,
            input_schema=dict(request.input_schema),
            parameters=list(request.parameters),
            outputs=list(request.outputs),
            warmup_period=request.warmup_period,
            fundamental_inputs=list(request.fundamental_inputs),
        )
        self._formulas[formula_id] = formula
        if self._repo is not None:
            await self._repo.create(
                formula_id=formula_id,
                name=request.name,
                description=request.description,
                source=request.source,
                author=author,
                is_public=False,
                input_schema=dict(request.input_schema),
                parameters=param_dicts,
                outputs=output_dicts,
                warmup_period=request.warmup_period,
                fundamental_inputs=[int(m) for m in request.fundamental_inputs],
            )
        return indicators_pb2.RegisterFormulaResponse(formula_id=formula_id)

    async def GetFormula(self, request, context):
        if await self._reject_ungranted_system(context):
            return
        formula = await self._load_formula(request.formula_id)
        readable = formula is not None and self._can_read_formula(context, formula.author)
        if not readable and (formula is None or not self._has_admin_scope(context)):
            await context.abort(
                grpc.StatusCode.NOT_FOUND, f"formula {request.formula_id} not found"
            )
            return
        if not readable and not await self._audit_admin_read(
            context, {formula.author: [request.formula_id]}
        ):
            return
        self._formulas[request.formula_id] = formula
        out = indicators_pb2.FormulaDefinition()
        out.CopyFrom(formula)
        await self._fill_origins([out])
        return out

    async def ListFormulas(self, request, context):
        """Own + system formulas. author_filter/include_public are ignored, except that an ADMIN
        may name another owner in author_filter to list (and audit) that owner's formulas."""
        if await self._reject_ungranted_system(context):
            return
        reader = self._reader(context)
        owner = request.author_filter
        admin_selector = bool(owner) and owner != reader and self._has_admin_scope(context)
        if self._repo is None:
            formulas = [
                f
                for f in self._formulas.values()
                if (f.author == owner if admin_selector else f.author in (reader, SYSTEM_AUTHOR))
            ]
            total = len(formulas)
        else:
            list_rows = self._repo.list_owned if admin_selector else self._repo.list_visible
            rows, total = await list_rows(
                owner if admin_selector else reader, request.page_size, request.page_offset
            )
            formulas = [_row_to_formula(r) for r in rows]
            await self._fill_origins(formulas)
        if admin_selector and not await self._audit_admin_read(
            context, {owner: [f.formula_id for f in formulas]}
        ):
            return
        return indicators_pb2.ListFormulasResponse(formulas=formulas, total_count=total)

    async def UpdateFormula(self, request, context):
        if await self._reject_ungranted_system(context):
            return
        if self._repo is None:
            await context.abort(grpc.StatusCode.UNAVAILABLE, "DB not available")
            return
        row = await self._repo.get_by_id(request.formula_id)
        if row is None:
            await context.abort(
                grpc.StatusCode.NOT_FOUND, f"formula {request.formula_id} not found"
            )
            return
        if row["author"] == SYSTEM_AUTHOR:
            await context.abort(
                grpc.StatusCode.PERMISSION_DENIED,
                "system formulas are read-only and cannot be modified",
            )
            return
        if row["author"] != self._caller_user_id(context, request):
            await context.abort(
                grpc.StatusCode.PERMISSION_DENIED, "user_id does not match formula author"
            )
            return
        # A soft-deleted formula is not updatable.
        if row.get("deleted_at") is not None:
            await context.abort(
                grpc.StatusCode.FAILED_PRECONDITION,
                "formula is deleted and cannot be updated",
            )
            return
        # Absent update_mask = full replace (the UI sends a complete payload); a present mask
        # merges only the named paths onto the stored row, preserving unlisted fields.
        has_mask = request.HasField("update_mask")
        mask = set(request.update_mask.paths) if has_mask else None
        if has_mask:
            unknown = mask - _FORMULA_MASKABLE_PATHS
            if unknown:
                await context.abort(
                    grpc.StatusCode.INVALID_ARGUMENT,
                    f"unknown update_mask path(s): {', '.join(sorted(unknown))}",
                )
                return

        def _use_req(field: str) -> bool:
            return mask is None or field in mask

        eff_name = request.name if _use_req("name") else row["name"]
        eff_description = (
            request.description if _use_req("description") else (row["description"] or "")
        )
        eff_source = request.source if _use_req("source") else row["source"]
        eff_parameters = (
            [MessageToDict(p) for p in request.parameters]
            if _use_req("parameters")
            else (row.get("parameters") or [])
        )
        eff_outputs = (
            [MessageToDict(o) for o in request.outputs]
            if _use_req("outputs")
            else (row.get("outputs") or [])
        )
        eff_warmup = (
            request.warmup_period
            if _use_req("warmup_period")
            else (row.get("warmup_period", 0) or 0)
        )
        eff_fundamental_inputs = (
            [int(m) for m in request.fundamental_inputs]
            if _use_req("fundamental_inputs")
            else (row.get("fundamental_inputs") or [])
        )
        # A masked update may not blank the required source; params/outputs/warmup can be cleared.
        if has_mask and "source" in mask and not eff_source:
            await context.abort(
                grpc.StatusCode.INVALID_ARGUMENT,
                "update_mask cannot blank the required 'source' field",
            )
            return
        try:
            # Validate only masked fields; stored unmasked values are already valid.
            if _use_req("parameters"):
                params_validation.validate_definitions(request.parameters)
            if _use_req("outputs"):
                params_validation.validate_outputs(request.outputs)
            if _use_req("fundamental_inputs"):
                params_validation.validate_fundamental_inputs(request.fundamental_inputs)
            if _use_req("warmup_period") and eff_warmup < 0:
                raise ValueError("warmup_period must be >= 0")
        except ValueError as e:
            await context.abort(grpc.StatusCode.INVALID_ARGUMENT, str(e))
            return
        updated = await self._repo.update(
            formula_id=request.formula_id,
            name=eff_name,
            description=eff_description,
            source=eff_source,
            is_public=False,
            parameters=eff_parameters,
            outputs=eff_outputs,
            warmup_period=eff_warmup,
            fundamental_inputs=eff_fundamental_inputs,
        )
        self._formulas.pop(request.formula_id, None)
        return indicators_pb2.UpdateFormulaResponse(formula=_row_to_formula(updated))

    async def DeleteFormula(self, request, context):
        if await self._reject_ungranted_system(context):
            return
        if self._repo is None:
            await context.abort(grpc.StatusCode.UNAVAILABLE, "DB not available")
            return
        row = await self._repo.get_by_id(request.formula_id)
        if row is None:
            await context.abort(
                grpc.StatusCode.NOT_FOUND, f"formula {request.formula_id} not found"
            )
            return
        if row["author"] == SYSTEM_AUTHOR:
            await context.abort(
                grpc.StatusCode.PERMISSION_DENIED,
                "system formulas are read-only and cannot be deleted",
            )
            return
        if row["author"] != self._caller_user_id(context, request):
            await context.abort(
                grpc.StatusCode.PERMISSION_DENIED, "user_id does not match formula author"
            )
            return
        success = await self._repo.delete(request.formula_id)
        self._formulas.pop(request.formula_id, None)
        return indicators_pb2.DeleteFormulaResponse(success=success)

    async def ListTemplates(self, request, context):
        """Active (non-retired) formula templates, for any authenticated caller."""
        if await self._reject_ungranted_system(context):
            return
        if not self._reader(context):
            await context.abort(grpc.StatusCode.UNAUTHENTICATED, "authenticated user required")
            return
        if not await self._require_templates_db(context):
            return
        rows = await self._templates_repo.list_active()
        return indicators_pb2.ListTemplatesResponse(templates=[_row_to_template(r) for r in rows])

    async def ManageTemplate(self, request, context):
        """ADMIN-only create / update (version + 1) / retire. Retire never touches instances."""
        if await self._reject_ungranted_system(context):
            return
        if not self._has_admin_scope(context):
            await context.abort(
                grpc.StatusCode.PERMISSION_DENIED, "managing templates requires the ADMIN scope"
            )
            return
        if not await self._require_templates_db(context):
            return
        op = request.operation
        meta = request.template.meta
        if not meta.template_id:
            await context.abort(grpc.StatusCode.INVALID_ARGUMENT, "template_id required")
            return
        if op in (common_pb2.TEMPLATE_OPERATION_CREATE, common_pb2.TEMPLATE_OPERATION_UPDATE):
            try:
                _validate_register_payload(request.template.payload)
            except ValueError as e:
                await context.abort(grpc.StatusCode.INVALID_ARGUMENT, str(e))
                return
            payload = MessageToDict(request.template.payload)
        if op == common_pb2.TEMPLATE_OPERATION_CREATE:
            if await self._templates_repo.get(meta.template_id) is not None:
                await context.abort(
                    grpc.StatusCode.ALREADY_EXISTS, f"template {meta.template_id} already exists"
                )
                return
            row = await self._templates_repo.create(meta, payload, self._reader(context))
        elif op == common_pb2.TEMPLATE_OPERATION_UPDATE:
            row = await self._templates_repo.update(meta.template_id, payload)
        elif op == common_pb2.TEMPLATE_OPERATION_RETIRE:
            row = await self._templates_repo.retire(meta.template_id)
        else:
            await context.abort(grpc.StatusCode.INVALID_ARGUMENT, "template operation required")
            return
        if row is None:
            await context.abort(grpc.StatusCode.NOT_FOUND, f"template {meta.template_id} not found")
            return
        return _row_to_template(row)

    async def InstantiateTemplate(self, request, context):
        """User path (template_id): a private snapshot copy owned by the caller. Saga path
        (template_ids + intent_id): pending-hidden copies, analysis-template-saga grant only."""
        saga = bool(request.template_ids) or bool(request.intent_id)
        if saga and not self._internal_grant(context, _TEMPLATE_SAGA_GRANT):
            await context.abort(
                grpc.StatusCode.PERMISSION_DENIED, "the template saga requires an internal grant"
            )
            return
        owner = await self._template_owner(context)
        if owner is None or not await self._require_templates_db(context):
            return
        if saga:
            return await self._instantiate_saga(request, context, owner)

        row = await self._templates_repo.get(request.template_id)
        if row is None or row.get("retired_at") is not None:
            await context.abort(
                grpc.StatusCode.NOT_FOUND, f"template {request.template_id} not found"
            )
            return
        created = await self._repo.create(**_template_copy(row, owner))
        formula = _row_to_formula(created)
        formula.origin.latest_version = formula.origin.template_version
        self._formulas[formula.formula_id] = formula
        return indicators_pb2.InstantiateTemplateResponse(formula=formula)

    async def _instantiate_saga(self, request, context, owner):
        try:
            uuid.UUID(request.intent_id)
        except ValueError:
            await context.abort(grpc.StatusCode.INVALID_ARGUMENT, "intent_id must be a UUID")
            return
        template_ids = list(dict.fromkeys(request.template_ids))
        if not template_ids:
            await context.abort(grpc.StatusCode.INVALID_ARGUMENT, "template_ids required")
            return
        # Resolve every template before any INSERT: one bad id fails the whole saga.
        rows = []
        for template_id in template_ids:
            row = await self._templates_repo.get(template_id)
            if row is None or row.get("retired_at") is not None:
                await context.abort(grpc.StatusCode.NOT_FOUND, f"template {template_id} not found")
                return
            rows.append(row)
        copies = [_template_copy(r, owner) for r in rows]
        try:
            await self._repo.create_pending_copies(copies, request.intent_id)
        except Exception as e:
            log.warning("template saga copy failed intent=%s: %s", request.intent_id, e)
            await context.abort(grpc.StatusCode.INTERNAL, f"template copy failed: {e}")
            return
        return indicators_pb2.InstantiateTemplateResponse(
            formula_ids_by_template={
                r["template_id"]: c["formula_id"] for r, c in zip(rows, copies, strict=True)
            }
        )

    async def ResolveTemplateIntent(self, request, context):
        """Commit (un-hide) or abort (hard-delete) the owner's pending copies; idempotent."""
        if not self._internal_grant(context, _TEMPLATE_SAGA_GRANT):
            await context.abort(
                grpc.StatusCode.PERMISSION_DENIED, "resolving a template intent requires a grant"
            )
            return
        owner = await self._template_owner(context)
        if owner is None or not await self._require_templates_db(context):
            return
        try:
            uuid.UUID(request.intent_id)
        except ValueError:
            await context.abort(grpc.StatusCode.INVALID_ARGUMENT, "intent_id must be a UUID")
            return
        ids = await self._repo.resolve_intent(request.intent_id, owner, request.commit)
        for formula_id in ids:
            self._formulas.pop(formula_id, None)
        return indicators_pb2.ResolveTemplateIntentResponse(affected=len(ids))


def _validate_register_payload(payload) -> None:
    """The RegisterFormula payload checks, shared by template authoring; raises ValueError."""
    params_validation.validate_definitions(payload.parameters)
    params_validation.validate_outputs(payload.outputs)
    params_validation.validate_fundamental_inputs(payload.fundamental_inputs)
    if payload.warmup_period < 0:
        raise ValueError("warmup_period must be >= 0")


def _template_copy(row: dict, owner: str) -> dict:
    """FormulasRepository.create fields for a snapshot of a template row; the payload's
    deprecated is_public/author are ignored (the copy is private to ``owner``)."""
    payload = ParseDict(row["payload"], indicators_pb2.RegisterFormulaRequest())
    return {
        "formula_id": str(uuid.uuid4()),
        "name": payload.name,
        "description": payload.description,
        "source": payload.source,
        "author": owner,
        "is_public": False,
        "input_schema": dict(payload.input_schema),
        "parameters": [MessageToDict(p) for p in payload.parameters],
        "outputs": [MessageToDict(o) for o in payload.outputs],
        "warmup_period": payload.warmup_period,
        "fundamental_inputs": [int(m) for m in payload.fundamental_inputs],
        "origin_template_id": row["template_id"],
        "origin_template_version": row["version"],
    }


def _row_to_template(row: dict) -> "indicators_pb2.FormulaTemplate":
    return indicators_pb2.FormulaTemplate(
        meta=common_pb2.TemplateMeta(
            template_id=row["template_id"],
            kind=common_pb2.TEMPLATE_KIND_FORMULA,
            name=row["name"],
            description=row["description"] or "",
            version=row["version"],
            retired=row.get("retired_at") is not None,
            created_at=_dt_to_ts(row.get("created_at")),
            updated_at=_dt_to_ts(row.get("updated_at")),
        ),
        payload=ParseDict(row["payload"], indicators_pb2.RegisterFormulaRequest()),
    )


def _dt_to_ts(dt):
    import datetime

    from google.protobuf.timestamp_pb2 import Timestamp

    ts = Timestamp()
    if dt is not None:
        ts.FromDatetime(dt if dt.tzinfo else dt.replace(tzinfo=datetime.UTC))
    return ts


def _row_to_formula(row: dict) -> "indicators_pb2.FormulaDefinition":
    """Convert a DB row dict from indicators.formulas to FormulaDefinition proto."""
    formula = indicators_pb2.FormulaDefinition(
        formula_id=str(row["formula_id"]),
        name=row["name"],
        description=row["description"] or "",
        source=row["source"],
        author=row["author"],
        created_at=_dt_to_ts(row.get("created_at")),
        updated_at=_dt_to_ts(row.get("updated_at")),
        input_schema=dict(row["input_schema"]) if row.get("input_schema") else {},
        parameters=[
            ParseDict(p, indicators_pb2.FormulaParameter()) for p in (row.get("parameters") or [])
        ],
        outputs=[ParseDict(o, indicators_pb2.FormulaOutput()) for o in (row.get("outputs") or [])],
        warmup_period=row.get("warmup_period", 0) or 0,
        deleted=row.get("deleted_at") is not None,
        fundamental_inputs=[int(m) for m in (row.get("fundamental_inputs") or [])],
    )
    if row.get("origin_template_id"):
        formula.origin.template_id = row["origin_template_id"]
        formula.origin.template_version = row.get("origin_template_version") or 0
    return formula

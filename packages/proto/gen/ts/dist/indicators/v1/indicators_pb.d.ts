import type { GenEnum, GenFile, GenMessage, GenService } from "@bufbuild/protobuf/codegenv2";
import type { Timestamp, Value } from "@bufbuild/protobuf/wkt";
import type { TimeRange } from "../../common/v1/common_pb";
import type { JsonObject, Message } from "@bufbuild/protobuf";
/**
 * Describes the file indicators/v1/indicators.proto.
 */
export declare const file_indicators_v1_indicators: GenFile;
/**
 * @generated from message xstockstrat.indicators.v1.ComputeIndicatorRequest
 */
export type ComputeIndicatorRequest = Message<"xstockstrat.indicators.v1.ComputeIndicatorRequest"> & {
    /**
     * "SMA", "EMA", "RSI", "MACD", "BB", "ATR", "VWAP"
     *
     * @generated from field: string indicator = 1;
     */
    indicator: string;
    /**
     * input time-series values
     *
     * @generated from field: repeated double values = 2;
     */
    values: number[];
    /**
     * e.g. {"period": 14}
     *
     * @generated from field: map<string, double> params = 3;
     */
    params: {
        [key: string]: number;
    };
    /**
     * @generated from field: xstockstrat.common.v1.TimeRange range = 4;
     */
    range?: TimeRange | undefined;
    /**
     * @generated from field: string symbol = 5;
     */
    symbol: string;
    /**
     * @generated from field: string timeframe = 6;
     */
    timeframe: string;
};
/**
 * Describes the message xstockstrat.indicators.v1.ComputeIndicatorRequest.
 * Use `create(ComputeIndicatorRequestSchema)` to create a new message.
 */
export declare const ComputeIndicatorRequestSchema: GenMessage<ComputeIndicatorRequest>;
/**
 * @generated from message xstockstrat.indicators.v1.ComputeIndicatorResponse
 */
export type ComputeIndicatorResponse = Message<"xstockstrat.indicators.v1.ComputeIndicatorResponse"> & {
    /**
     * @generated from field: repeated xstockstrat.indicators.v1.IndicatorPoint result = 1;
     */
    result: IndicatorPoint[];
    /**
     * @generated from field: string indicator = 2;
     */
    indicator: string;
    /**
     * @generated from field: map<string, double> params_used = 3;
     */
    paramsUsed: {
        [key: string]: number;
    };
};
/**
 * Describes the message xstockstrat.indicators.v1.ComputeIndicatorResponse.
 * Use `create(ComputeIndicatorResponseSchema)` to create a new message.
 */
export declare const ComputeIndicatorResponseSchema: GenMessage<ComputeIndicatorResponse>;
/**
 * @generated from message xstockstrat.indicators.v1.IndicatorPoint
 */
export type IndicatorPoint = Message<"xstockstrat.indicators.v1.IndicatorPoint"> & {
    /**
     * @generated from field: google.protobuf.Timestamp time = 1;
     */
    time?: Timestamp | undefined;
    /**
     * @generated from field: double value = 2;
     */
    value: number;
    /**
     * e.g. MACD has signal, histogram
     *
     * @generated from field: map<string, double> extra = 3;
     */
    extra: {
        [key: string]: number;
    };
};
/**
 * Describes the message xstockstrat.indicators.v1.IndicatorPoint.
 * Use `create(IndicatorPointSchema)` to create a new message.
 */
export declare const IndicatorPointSchema: GenMessage<IndicatorPoint>;
/**
 * @generated from message xstockstrat.indicators.v1.ExecuteFormulaRequest
 */
export type ExecuteFormulaRequest = Message<"xstockstrat.indicators.v1.ExecuteFormulaRequest"> & {
    /**
     * registered formula ID, or...
     *
     * @generated from field: string formula_id = 1;
     */
    formulaId: string;
    /**
     * ...inline Python source (one of these required)
     *
     * @generated from field: string formula_source = 2;
     */
    formulaSource: string;
    /**
     * data passed to formula as `data` variable
     *
     * @generated from field: google.protobuf.Struct input_data = 3;
     */
    inputData?: JsonObject | undefined;
    /**
     * extra env vars (non-secret)
     *
     * @generated from field: map<string, string> env = 4;
     */
    env: {
        [key: string]: string;
    };
    /**
     * 0 = use config value
     *
     * @generated from field: int32 timeout_ms_override = 5;
     */
    timeoutMsOverride: number;
    /**
     * 0 = use config value
     *
     * @generated from field: int64 memory_bytes_override = 6;
     */
    memoryBytesOverride: bigint;
    /**
     * parameter VALUES, separate from input_data
     *
     * @generated from field: google.protobuf.Struct input_params = 7;
     */
    inputParams?: JsonObject | undefined;
    /**
     * Declared parameter DEFINITIONS used to validate input_params and apply defaults
     * for inline formula_source runs (authoring "Run" with an unsaved buffer). Ignored
     * when formula_id is set — saved formulas use their stored definitions instead.
     *
     * @generated from field: repeated xstockstrat.indicators.v1.FormulaParameter parameters = 8;
     */
    parameters: FormulaParameter[];
};
/**
 * Describes the message xstockstrat.indicators.v1.ExecuteFormulaRequest.
 * Use `create(ExecuteFormulaRequestSchema)` to create a new message.
 */
export declare const ExecuteFormulaRequestSchema: GenMessage<ExecuteFormulaRequest>;
/**
 * @generated from message xstockstrat.indicators.v1.ExecuteFormulaResponse
 */
export type ExecuteFormulaResponse = Message<"xstockstrat.indicators.v1.ExecuteFormulaResponse"> & {
    /**
     * @generated from field: bool success = 1;
     */
    success: boolean;
    /**
     * @generated from field: google.protobuf.Struct output = 2;
     */
    output?: JsonObject | undefined;
    /**
     * @generated from field: string stdout = 3;
     */
    stdout: string;
    /**
     * @generated from field: string stderr = 4;
     */
    stderr: string;
    /**
     * @generated from field: int64 execution_ms = 5;
     */
    executionMs: bigint;
    /**
     * @generated from field: int64 memory_used_bytes = 6;
     */
    memoryUsedBytes: bigint;
    /**
     * @generated from field: string error = 7;
     */
    error: string;
    /**
     * @generated from field: xstockstrat.indicators.v1.SandboxExitReason exit_reason = 8;
     */
    exitReason: SandboxExitReason;
    /**
     * @generated from field: repeated xstockstrat.indicators.v1.ParameterValidationError parameter_errors = 9;
     */
    parameterErrors: ParameterValidationError[];
};
/**
 * Describes the message xstockstrat.indicators.v1.ExecuteFormulaResponse.
 * Use `create(ExecuteFormulaResponseSchema)` to create a new message.
 */
export declare const ExecuteFormulaResponseSchema: GenMessage<ExecuteFormulaResponse>;
/**
 * @generated from message xstockstrat.indicators.v1.FormulaParameter
 */
export type FormulaParameter = Message<"xstockstrat.indicators.v1.FormulaParameter"> & {
    /**
     * Python identifier; key in `params`
     *
     * @generated from field: string name = 1;
     */
    name: string;
    /**
     * @generated from field: xstockstrat.indicators.v1.ParameterType type = 2;
     */
    type: ParameterType;
    /**
     * @generated from field: google.protobuf.Value default_value = 3;
     */
    defaultValue?: Value | undefined;
    /**
     * @generated from field: string description = 4;
     */
    description: string;
    /**
     * @generated from field: bool required = 5;
     */
    required: boolean;
    /**
     * numeric params only
     *
     * @generated from field: optional double min = 6;
     */
    min?: number | undefined;
    /**
     * numeric params only
     *
     * @generated from field: optional double max = 7;
     */
    max?: number | undefined;
};
/**
 * Describes the message xstockstrat.indicators.v1.FormulaParameter.
 * Use `create(FormulaParameterSchema)` to create a new message.
 */
export declare const FormulaParameterSchema: GenMessage<FormulaParameter>;
/**
 * A declared output series a formula emits. The primary series is always "value"
 * (implicit — need not be declared). Each additional FormulaOutput names a series
 * addressable in strategy rules as "<ref_name>.<name>". Declaring outputs lets the
 * analysis service validate strategy rules and the sandbox enforce that the formula
 * actually produces every declared series.
 *
 * @generated from message xstockstrat.indicators.v1.FormulaOutput
 */
export type FormulaOutput = Message<"xstockstrat.indicators.v1.FormulaOutput"> & {
    /**
     * series key; valid Python identifier, unique per formula
     *
     * @generated from field: string name = 1;
     */
    name: string;
    /**
     * human-readable description shown in authoring UIs
     *
     * @generated from field: string description = 2;
     */
    description: string;
};
/**
 * Describes the message xstockstrat.indicators.v1.FormulaOutput.
 * Use `create(FormulaOutputSchema)` to create a new message.
 */
export declare const FormulaOutputSchema: GenMessage<FormulaOutput>;
/**
 * @generated from message xstockstrat.indicators.v1.ParameterValidationError
 */
export type ParameterValidationError = Message<"xstockstrat.indicators.v1.ParameterValidationError"> & {
    /**
     * @generated from field: string name = 1;
     */
    name: string;
    /**
     * @generated from field: string reason = 2;
     */
    reason: string;
};
/**
 * Describes the message xstockstrat.indicators.v1.ParameterValidationError.
 * Use `create(ParameterValidationErrorSchema)` to create a new message.
 */
export declare const ParameterValidationErrorSchema: GenMessage<ParameterValidationError>;
/**
 * @generated from message xstockstrat.indicators.v1.FormulaDefinition
 */
export type FormulaDefinition = Message<"xstockstrat.indicators.v1.FormulaDefinition"> & {
    /**
     * @generated from field: string formula_id = 1;
     */
    formulaId: string;
    /**
     * @generated from field: string name = 2;
     */
    name: string;
    /**
     * @generated from field: string description = 3;
     */
    description: string;
    /**
     * @generated from field: string source = 4;
     */
    source: string;
    /**
     * @generated from field: string author = 5;
     */
    author: string;
    /**
     * @generated from field: google.protobuf.Timestamp created_at = 6;
     */
    createdAt?: Timestamp | undefined;
    /**
     * @generated from field: google.protobuf.Timestamp updated_at = 7;
     */
    updatedAt?: Timestamp | undefined;
    /**
     * @generated from field: bool is_public = 8;
     */
    isPublic: boolean;
    /**
     * expected input keys and types
     *
     * @generated from field: map<string, string> input_schema = 9;
     */
    inputSchema: {
        [key: string]: string;
    };
    /**
     * @generated from field: repeated xstockstrat.indicators.v1.FormulaParameter parameters = 10;
     */
    parameters: FormulaParameter[];
    /**
     * declared output series (beyond implicit "value")
     *
     * @generated from field: repeated xstockstrat.indicators.v1.FormulaOutput outputs = 11;
     */
    outputs: FormulaOutput[];
};
/**
 * Describes the message xstockstrat.indicators.v1.FormulaDefinition.
 * Use `create(FormulaDefinitionSchema)` to create a new message.
 */
export declare const FormulaDefinitionSchema: GenMessage<FormulaDefinition>;
/**
 * @generated from message xstockstrat.indicators.v1.ListIndicatorsRequest
 */
export type ListIndicatorsRequest = Message<"xstockstrat.indicators.v1.ListIndicatorsRequest"> & {};
/**
 * Describes the message xstockstrat.indicators.v1.ListIndicatorsRequest.
 * Use `create(ListIndicatorsRequestSchema)` to create a new message.
 */
export declare const ListIndicatorsRequestSchema: GenMessage<ListIndicatorsRequest>;
/**
 * @generated from message xstockstrat.indicators.v1.ListIndicatorsResponse
 */
export type ListIndicatorsResponse = Message<"xstockstrat.indicators.v1.ListIndicatorsResponse"> & {
    /**
     * @generated from field: repeated xstockstrat.indicators.v1.IndicatorMeta indicators = 1;
     */
    indicators: IndicatorMeta[];
};
/**
 * Describes the message xstockstrat.indicators.v1.ListIndicatorsResponse.
 * Use `create(ListIndicatorsResponseSchema)` to create a new message.
 */
export declare const ListIndicatorsResponseSchema: GenMessage<ListIndicatorsResponse>;
/**
 * @generated from message xstockstrat.indicators.v1.IndicatorMeta
 */
export type IndicatorMeta = Message<"xstockstrat.indicators.v1.IndicatorMeta"> & {
    /**
     * @generated from field: string name = 1;
     */
    name: string;
    /**
     * @generated from field: string description = 2;
     */
    description: string;
    /**
     * @generated from field: repeated string required_params = 3;
     */
    requiredParams: string[];
    /**
     * @generated from field: repeated string optional_params = 4;
     */
    optionalParams: string[];
};
/**
 * Describes the message xstockstrat.indicators.v1.IndicatorMeta.
 * Use `create(IndicatorMetaSchema)` to create a new message.
 */
export declare const IndicatorMetaSchema: GenMessage<IndicatorMeta>;
/**
 * @generated from message xstockstrat.indicators.v1.RegisterFormulaRequest
 */
export type RegisterFormulaRequest = Message<"xstockstrat.indicators.v1.RegisterFormulaRequest"> & {
    /**
     * @generated from field: string name = 1;
     */
    name: string;
    /**
     * @generated from field: string description = 2;
     */
    description: string;
    /**
     * @generated from field: string source = 3;
     */
    source: string;
    /**
     * @generated from field: bool is_public = 4;
     */
    isPublic: boolean;
    /**
     * @generated from field: map<string, string> input_schema = 5;
     */
    inputSchema: {
        [key: string]: string;
    };
    /**
     * set by BFF from JWT claims; stored immutably
     *
     * @generated from field: string author = 6;
     */
    author: string;
    /**
     * @generated from field: repeated xstockstrat.indicators.v1.FormulaParameter parameters = 7;
     */
    parameters: FormulaParameter[];
    /**
     * declared output series (beyond implicit "value")
     *
     * @generated from field: repeated xstockstrat.indicators.v1.FormulaOutput outputs = 8;
     */
    outputs: FormulaOutput[];
};
/**
 * Describes the message xstockstrat.indicators.v1.RegisterFormulaRequest.
 * Use `create(RegisterFormulaRequestSchema)` to create a new message.
 */
export declare const RegisterFormulaRequestSchema: GenMessage<RegisterFormulaRequest>;
/**
 * @generated from message xstockstrat.indicators.v1.RegisterFormulaResponse
 */
export type RegisterFormulaResponse = Message<"xstockstrat.indicators.v1.RegisterFormulaResponse"> & {
    /**
     * @generated from field: string formula_id = 1;
     */
    formulaId: string;
};
/**
 * Describes the message xstockstrat.indicators.v1.RegisterFormulaResponse.
 * Use `create(RegisterFormulaResponseSchema)` to create a new message.
 */
export declare const RegisterFormulaResponseSchema: GenMessage<RegisterFormulaResponse>;
/**
 * @generated from message xstockstrat.indicators.v1.GetFormulaRequest
 */
export type GetFormulaRequest = Message<"xstockstrat.indicators.v1.GetFormulaRequest"> & {
    /**
     * @generated from field: string formula_id = 1;
     */
    formulaId: string;
};
/**
 * Describes the message xstockstrat.indicators.v1.GetFormulaRequest.
 * Use `create(GetFormulaRequestSchema)` to create a new message.
 */
export declare const GetFormulaRequestSchema: GenMessage<GetFormulaRequest>;
/**
 * @generated from message xstockstrat.indicators.v1.ListFormulasRequest
 */
export type ListFormulasRequest = Message<"xstockstrat.indicators.v1.ListFormulasRequest"> & {
    /**
     * if non-empty, return only formulas where author == author_filter
     *
     * @generated from field: string author_filter = 1;
     */
    authorFilter: string;
    /**
     * if true, include all public formulas regardless of author_filter
     *
     * @generated from field: bool include_public = 2;
     */
    includePublic: boolean;
    /**
     * default 0 = no limit
     *
     * @generated from field: int32 page_size = 3;
     */
    pageSize: number;
    /**
     * default 0
     *
     * @generated from field: int32 page_offset = 4;
     */
    pageOffset: number;
};
/**
 * Describes the message xstockstrat.indicators.v1.ListFormulasRequest.
 * Use `create(ListFormulasRequestSchema)` to create a new message.
 */
export declare const ListFormulasRequestSchema: GenMessage<ListFormulasRequest>;
/**
 * @generated from message xstockstrat.indicators.v1.ListFormulasResponse
 */
export type ListFormulasResponse = Message<"xstockstrat.indicators.v1.ListFormulasResponse"> & {
    /**
     * @generated from field: repeated xstockstrat.indicators.v1.FormulaDefinition formulas = 1;
     */
    formulas: FormulaDefinition[];
    /**
     * @generated from field: int32 total_count = 2;
     */
    totalCount: number;
};
/**
 * Describes the message xstockstrat.indicators.v1.ListFormulasResponse.
 * Use `create(ListFormulasResponseSchema)` to create a new message.
 */
export declare const ListFormulasResponseSchema: GenMessage<ListFormulasResponse>;
/**
 * @generated from message xstockstrat.indicators.v1.UpdateFormulaRequest
 */
export type UpdateFormulaRequest = Message<"xstockstrat.indicators.v1.UpdateFormulaRequest"> & {
    /**
     * @generated from field: string formula_id = 1;
     */
    formulaId: string;
    /**
     * must match formula.author; returns PERMISSION_DENIED otherwise
     *
     * @generated from field: string user_id = 2;
     */
    userId: string;
    /**
     * @generated from field: string name = 3;
     */
    name: string;
    /**
     * @generated from field: string description = 4;
     */
    description: string;
    /**
     * @generated from field: string source = 5;
     */
    source: string;
    /**
     * @generated from field: bool is_public = 6;
     */
    isPublic: boolean;
    /**
     * @generated from field: repeated xstockstrat.indicators.v1.FormulaParameter parameters = 7;
     */
    parameters: FormulaParameter[];
    /**
     * declared output series (beyond implicit "value")
     *
     * @generated from field: repeated xstockstrat.indicators.v1.FormulaOutput outputs = 8;
     */
    outputs: FormulaOutput[];
};
/**
 * Describes the message xstockstrat.indicators.v1.UpdateFormulaRequest.
 * Use `create(UpdateFormulaRequestSchema)` to create a new message.
 */
export declare const UpdateFormulaRequestSchema: GenMessage<UpdateFormulaRequest>;
/**
 * @generated from message xstockstrat.indicators.v1.UpdateFormulaResponse
 */
export type UpdateFormulaResponse = Message<"xstockstrat.indicators.v1.UpdateFormulaResponse"> & {
    /**
     * @generated from field: xstockstrat.indicators.v1.FormulaDefinition formula = 1;
     */
    formula?: FormulaDefinition | undefined;
};
/**
 * Describes the message xstockstrat.indicators.v1.UpdateFormulaResponse.
 * Use `create(UpdateFormulaResponseSchema)` to create a new message.
 */
export declare const UpdateFormulaResponseSchema: GenMessage<UpdateFormulaResponse>;
/**
 * @generated from message xstockstrat.indicators.v1.DeleteFormulaRequest
 */
export type DeleteFormulaRequest = Message<"xstockstrat.indicators.v1.DeleteFormulaRequest"> & {
    /**
     * @generated from field: string formula_id = 1;
     */
    formulaId: string;
    /**
     * must match formula.author; returns PERMISSION_DENIED otherwise
     *
     * @generated from field: string user_id = 2;
     */
    userId: string;
};
/**
 * Describes the message xstockstrat.indicators.v1.DeleteFormulaRequest.
 * Use `create(DeleteFormulaRequestSchema)` to create a new message.
 */
export declare const DeleteFormulaRequestSchema: GenMessage<DeleteFormulaRequest>;
/**
 * @generated from message xstockstrat.indicators.v1.DeleteFormulaResponse
 */
export type DeleteFormulaResponse = Message<"xstockstrat.indicators.v1.DeleteFormulaResponse"> & {
    /**
     * @generated from field: bool success = 1;
     */
    success: boolean;
};
/**
 * Describes the message xstockstrat.indicators.v1.DeleteFormulaResponse.
 * Use `create(DeleteFormulaResponseSchema)` to create a new message.
 */
export declare const DeleteFormulaResponseSchema: GenMessage<DeleteFormulaResponse>;
/**
 * @generated from enum xstockstrat.indicators.v1.SandboxExitReason
 */
export declare enum SandboxExitReason {
    /**
     * @generated from enum value: SANDBOX_EXIT_REASON_UNSPECIFIED = 0;
     */
    UNSPECIFIED = 0,
    /**
     * @generated from enum value: SANDBOX_EXIT_REASON_SUCCESS = 1;
     */
    SUCCESS = 1,
    /**
     * @generated from enum value: SANDBOX_EXIT_REASON_TIMEOUT = 2;
     */
    TIMEOUT = 2,
    /**
     * @generated from enum value: SANDBOX_EXIT_REASON_MEMORY_EXCEEDED = 3;
     */
    MEMORY_EXCEEDED = 3,
    /**
     * @generated from enum value: SANDBOX_EXIT_REASON_RUNTIME_ERROR = 4;
     */
    RUNTIME_ERROR = 4,
    /**
     * @generated from enum value: SANDBOX_EXIT_REASON_IMPORT_BLOCKED = 5;
     */
    IMPORT_BLOCKED = 5
}
/**
 * Describes the enum xstockstrat.indicators.v1.SandboxExitReason.
 */
export declare const SandboxExitReasonSchema: GenEnum<SandboxExitReason>;
/**
 * @generated from enum xstockstrat.indicators.v1.ParameterType
 */
export declare enum ParameterType {
    /**
     * @generated from enum value: PARAMETER_TYPE_UNSPECIFIED = 0;
     */
    UNSPECIFIED = 0,
    /**
     * @generated from enum value: PARAMETER_TYPE_INT = 1;
     */
    INT = 1,
    /**
     * @generated from enum value: PARAMETER_TYPE_FLOAT = 2;
     */
    FLOAT = 2,
    /**
     * @generated from enum value: PARAMETER_TYPE_BOOL = 3;
     */
    BOOL = 3,
    /**
     * @generated from enum value: PARAMETER_TYPE_STRING = 4;
     */
    STRING = 4
}
/**
 * Describes the enum xstockstrat.indicators.v1.ParameterType.
 */
export declare const ParameterTypeSchema: GenEnum<ParameterType>;
/**
 * IndicatorsService — formula engine and sandboxed Python execution.
 * Sandbox timeout and memory limits are configured via xstockstrat-config.
 *
 * @generated from service xstockstrat.indicators.v1.IndicatorsService
 */
export declare const IndicatorsService: GenService<{
    /**
     * Compute a built-in indicator (e.g. SMA, EMA, RSI, MACD, BB)
     *
     * @generated from rpc xstockstrat.indicators.v1.IndicatorsService.ComputeIndicator
     */
    computeIndicator: {
        methodKind: "unary";
        input: typeof ComputeIndicatorRequestSchema;
        output: typeof ComputeIndicatorResponseSchema;
    };
    /**
     * Execute a custom Python formula in a sandboxed environment
     * Timeout and memory cap sourced from config: indicators.sandbox.*
     *
     * @generated from rpc xstockstrat.indicators.v1.IndicatorsService.ExecuteFormula
     */
    executeFormula: {
        methodKind: "unary";
        input: typeof ExecuteFormulaRequestSchema;
        output: typeof ExecuteFormulaResponseSchema;
    };
    /**
     * List available built-in indicators
     *
     * @generated from rpc xstockstrat.indicators.v1.IndicatorsService.ListIndicators
     */
    listIndicators: {
        methodKind: "unary";
        input: typeof ListIndicatorsRequestSchema;
        output: typeof ListIndicatorsResponseSchema;
    };
    /**
     * Register a custom formula definition
     *
     * @generated from rpc xstockstrat.indicators.v1.IndicatorsService.RegisterFormula
     */
    registerFormula: {
        methodKind: "unary";
        input: typeof RegisterFormulaRequestSchema;
        output: typeof RegisterFormulaResponseSchema;
    };
    /**
     * Get a registered formula
     *
     * @generated from rpc xstockstrat.indicators.v1.IndicatorsService.GetFormula
     */
    getFormula: {
        methodKind: "unary";
        input: typeof GetFormulaRequestSchema;
        output: typeof FormulaDefinitionSchema;
    };
    /**
     * List formula definitions with optional author filter and pagination
     *
     * @generated from rpc xstockstrat.indicators.v1.IndicatorsService.ListFormulas
     */
    listFormulas: {
        methodKind: "unary";
        input: typeof ListFormulasRequestSchema;
        output: typeof ListFormulasResponseSchema;
    };
    /**
     * Update a formula's name, description, source, or is_public flag
     * Returns PERMISSION_DENIED if user_id does not match author
     *
     * @generated from rpc xstockstrat.indicators.v1.IndicatorsService.UpdateFormula
     */
    updateFormula: {
        methodKind: "unary";
        input: typeof UpdateFormulaRequestSchema;
        output: typeof UpdateFormulaResponseSchema;
    };
    /**
     * Delete a formula by ID
     * Returns PERMISSION_DENIED if user_id does not match author
     *
     * @generated from rpc xstockstrat.indicators.v1.IndicatorsService.DeleteFormula
     */
    deleteFormula: {
        methodKind: "unary";
        input: typeof DeleteFormulaRequestSchema;
        output: typeof DeleteFormulaResponseSchema;
    };
}>;

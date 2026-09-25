import { BinaryReader, BinaryWriter } from "@bufbuild/protobuf/wire";
import { type CallOptions, type ChannelCredentials, Client, type ClientOptions, type ClientUnaryCall, type handleUnaryCall, type Metadata, type ServiceError, type UntypedServiceImplementation } from "@grpc/grpc-js";
import { TimeRange } from "../../common/v1/common";
export declare const protobufPackage = "xstockstrat.indicators.v1";
export declare enum SandboxExitReason {
    SANDBOX_EXIT_REASON_UNSPECIFIED = "SANDBOX_EXIT_REASON_UNSPECIFIED",
    SANDBOX_EXIT_REASON_SUCCESS = "SANDBOX_EXIT_REASON_SUCCESS",
    SANDBOX_EXIT_REASON_TIMEOUT = "SANDBOX_EXIT_REASON_TIMEOUT",
    SANDBOX_EXIT_REASON_MEMORY_EXCEEDED = "SANDBOX_EXIT_REASON_MEMORY_EXCEEDED",
    SANDBOX_EXIT_REASON_RUNTIME_ERROR = "SANDBOX_EXIT_REASON_RUNTIME_ERROR",
    SANDBOX_EXIT_REASON_IMPORT_BLOCKED = "SANDBOX_EXIT_REASON_IMPORT_BLOCKED",
    UNRECOGNIZED = "UNRECOGNIZED"
}
export declare function sandboxExitReasonFromJSON(object: any): SandboxExitReason;
export declare function sandboxExitReasonToJSON(object: SandboxExitReason): string;
export declare function sandboxExitReasonToNumber(object: SandboxExitReason): number;
export declare enum ParameterType {
    PARAMETER_TYPE_UNSPECIFIED = "PARAMETER_TYPE_UNSPECIFIED",
    PARAMETER_TYPE_INT = "PARAMETER_TYPE_INT",
    PARAMETER_TYPE_FLOAT = "PARAMETER_TYPE_FLOAT",
    PARAMETER_TYPE_BOOL = "PARAMETER_TYPE_BOOL",
    PARAMETER_TYPE_STRING = "PARAMETER_TYPE_STRING",
    UNRECOGNIZED = "UNRECOGNIZED"
}
export declare function parameterTypeFromJSON(object: any): ParameterType;
export declare function parameterTypeToJSON(object: ParameterType): string;
export declare function parameterTypeToNumber(object: ParameterType): number;
/**
 * Closed set of the canonical fundamentals metrics a formula may declare as inputs (feature 200).
 * A non-empty FormulaDefinition.fundamental_inputs marks a formula as "fundamentals-only": the
 * analysis evaluator feeds it only these metrics (never OHLCV closes) and broadcasts its scalar
 * output. Names mirror marketdata.Fundamentals fields; the zero sentinel is invalid on write (C-04).
 */
export declare enum FundamentalMetric {
    FUNDAMENTAL_METRIC_UNSPECIFIED = "FUNDAMENTAL_METRIC_UNSPECIFIED",
    FUNDAMENTAL_METRIC_MARKET_CAP = "FUNDAMENTAL_METRIC_MARKET_CAP",
    FUNDAMENTAL_METRIC_PE_RATIO = "FUNDAMENTAL_METRIC_PE_RATIO",
    FUNDAMENTAL_METRIC_PB_RATIO = "FUNDAMENTAL_METRIC_PB_RATIO",
    FUNDAMENTAL_METRIC_DIVIDEND_YIELD = "FUNDAMENTAL_METRIC_DIVIDEND_YIELD",
    FUNDAMENTAL_METRIC_EPS = "FUNDAMENTAL_METRIC_EPS",
    FUNDAMENTAL_METRIC_BETA = "FUNDAMENTAL_METRIC_BETA",
    FUNDAMENTAL_METRIC_ROE = "FUNDAMENTAL_METRIC_ROE",
    FUNDAMENTAL_METRIC_DEBT_TO_EQUITY = "FUNDAMENTAL_METRIC_DEBT_TO_EQUITY",
    FUNDAMENTAL_METRIC_PRICE = "FUNDAMENTAL_METRIC_PRICE",
    FUNDAMENTAL_METRIC_YEAR_HIGH = "FUNDAMENTAL_METRIC_YEAR_HIGH",
    FUNDAMENTAL_METRIC_YEAR_LOW = "FUNDAMENTAL_METRIC_YEAR_LOW",
    UNRECOGNIZED = "UNRECOGNIZED"
}
export declare function fundamentalMetricFromJSON(object: any): FundamentalMetric;
export declare function fundamentalMetricToJSON(object: FundamentalMetric): string;
export declare function fundamentalMetricToNumber(object: FundamentalMetric): number;
export interface ComputeIndicatorRequest {
    /** "SMA", "EMA", "RSI", "MACD", "BB", "ATR", "VWAP" */
    indicator: string;
    /** input time-series values */
    values: number[];
    /** e.g. {"period": 14} */
    params: {
        [key: string]: number;
    };
    range?: TimeRange | undefined;
    symbol: string;
    timeframe: string;
}
export interface ComputeIndicatorRequest_ParamsEntry {
    key: string;
    value: number;
}
export interface ComputeIndicatorResponse {
    result: IndicatorPoint[];
    indicator: string;
    paramsUsed: {
        [key: string]: number;
    };
}
export interface ComputeIndicatorResponse_ParamsUsedEntry {
    key: string;
    value: number;
}
export interface IndicatorPoint {
    time?: Date | undefined;
    value: number;
    /** e.g. MACD has signal, histogram */
    extra: {
        [key: string]: number;
    };
}
export interface IndicatorPoint_ExtraEntry {
    key: string;
    value: number;
}
export interface ExecuteFormulaRequest {
    /** registered formula ID, or... */
    formulaId: string;
    /** ...inline Python source (one of these required) */
    formulaSource: string;
    /** data passed to formula as `data` variable */
    inputData?: {
        [key: string]: any;
    } | undefined;
    /** extra env vars (non-secret) */
    env: {
        [key: string]: string;
    };
    /** 0 = use config value */
    timeoutMsOverride: number;
    /** 0 = use config value */
    memoryBytesOverride: number;
    /** parameter VALUES, separate from input_data */
    inputParams?: {
        [key: string]: any;
    } | undefined;
    /**
     * Declared parameter DEFINITIONS used to validate input_params and apply defaults
     * for inline formula_source runs (authoring "Run" with an unsaved buffer). Ignored
     * when formula_id is set — saved formulas use their stored definitions instead.
     */
    parameters: FormulaParameter[];
}
export interface ExecuteFormulaRequest_EnvEntry {
    key: string;
    value: string;
}
export interface ExecuteFormulaResponse {
    success: boolean;
    output?: {
        [key: string]: any;
    } | undefined;
    stdout: string;
    stderr: string;
    executionMs: number;
    memoryUsedBytes: number;
    error: string;
    exitReason: SandboxExitReason;
    parameterErrors: ParameterValidationError[];
}
export interface FormulaParameter {
    /** Python identifier; key in `params` */
    name: string;
    type: ParameterType;
    defaultValue?: any | undefined;
    description: string;
    required: boolean;
    /** numeric params only */
    min?: number | undefined;
    /** numeric params only */
    max?: number | undefined;
}
/**
 * A declared output series a formula emits. The primary series is always "value"
 * (implicit — need not be declared). Each additional FormulaOutput names a series
 * addressable in strategy rules as "<ref_name>.<name>". Declaring outputs lets the
 * analysis service validate strategy rules and the sandbox enforce that the formula
 * actually produces every declared series.
 */
export interface FormulaOutput {
    /** series key; valid Python identifier, unique per formula */
    name: string;
    /** human-readable description shown in authoring UIs */
    description: string;
}
export interface ParameterValidationError {
    name: string;
    reason: string;
}
export interface FormulaDefinition {
    formulaId: string;
    name: string;
    description: string;
    source: string;
    author: string;
    createdAt?: Date | undefined;
    updatedAt?: Date | undefined;
    isPublic: boolean;
    /** expected input keys and types */
    inputSchema: {
        [key: string]: string;
    };
    parameters: FormulaParameter[];
    /** declared output series (beyond implicit "value") */
    outputs: FormulaOutput[];
    /** bars of warm-up before this formula's outputs are valid (feature 064) */
    warmupPeriod: number;
    /**
     * true = soft-deleted (feature 086): still evaluable for strategies that already reference it
     * (GetFormula/ExecuteFormula stay deleted-agnostic), hidden from ListFormulas, and not updatable.
     */
    deleted: boolean;
    /**
     * Non-empty = a fundamentals-only formula fed only these metrics as ExecuteFormula input_data
     * scalars, never OHLCV closes (feature 200); the category marker (no separate flag).
     */
    fundamentalInputs: FundamentalMetric[];
}
export interface FormulaDefinition_InputSchemaEntry {
    key: string;
    value: string;
}
export interface ListIndicatorsRequest {
}
export interface ListIndicatorsResponse {
    indicators: IndicatorMeta[];
}
export interface IndicatorMeta {
    name: string;
    description: string;
    requiredParams: string[];
    optionalParams: string[];
}
export interface RegisterFormulaRequest {
    name: string;
    description: string;
    source: string;
    isPublic: boolean;
    inputSchema: {
        [key: string]: string;
    };
    /** set by BFF from JWT claims; stored immutably */
    author: string;
    parameters: FormulaParameter[];
    /** declared output series (beyond implicit "value") */
    outputs: FormulaOutput[];
    /** bars of warm-up before this formula's outputs are valid (feature 064) */
    warmupPeriod: number;
    /** non-empty = fundamentals-only formula (feature 200) */
    fundamentalInputs: FundamentalMetric[];
}
export interface RegisterFormulaRequest_InputSchemaEntry {
    key: string;
    value: string;
}
export interface RegisterFormulaResponse {
    formulaId: string;
}
export interface GetFormulaRequest {
    formulaId: string;
}
export interface ListFormulasRequest {
    /** if non-empty, return only formulas where author == author_filter */
    authorFilter: string;
    /** if true, include all public formulas regardless of author_filter */
    includePublic: boolean;
    /** default 0 = no limit */
    pageSize: number;
    /** default 0 */
    pageOffset: number;
}
export interface ListFormulasResponse {
    formulas: FormulaDefinition[];
    totalCount: number;
}
export interface UpdateFormulaRequest {
    formulaId: string;
    /**
     * DEPRECATED: author identity resolved from the x-user-id header; must match formula.author, else PERMISSION_DENIED.
     *
     * @deprecated
     */
    userId: string;
    name: string;
    description: string;
    source: string;
    isPublic: boolean;
    parameters: FormulaParameter[];
    /** declared output series (beyond implicit "value") */
    outputs: FormulaOutput[];
    /** bars of warm-up before this formula's outputs are valid (feature 064) */
    warmupPeriod: number;
    /**
     * AIP-161 partial update (feature 086). Absent = full replace (back-compat: the UI sends a full
     * payload every call). Present = merge only the named paths onto the stored row; unlisted fields
     * are preserved. Reject an update whose target formula is soft-deleted (FAILED_PRECONDITION).
     */
    updateMask?: string[] | undefined;
    /** non-empty = fundamentals-only formula (feature 200) */
    fundamentalInputs: FundamentalMetric[];
}
export interface UpdateFormulaResponse {
    formula?: FormulaDefinition | undefined;
}
export interface DeleteFormulaRequest {
    formulaId: string;
    /**
     * DEPRECATED: author identity resolved from the x-user-id header; must match formula.author, else PERMISSION_DENIED.
     *
     * @deprecated
     */
    userId: string;
}
export interface DeleteFormulaResponse {
    success: boolean;
}
/** feature 205 — the fundamental-metrics catalog for formula authoring (declare + test). */
export interface ListFundamentalMetricsRequest {
}
export interface FundamentalMetricInfo {
    metric: FundamentalMetric;
    /** snake_case key the sandbox `data[...]` global exposes (e.g. "pe_ratio") */
    dataKey: string;
    /** human-readable meaning */
    meaning: string;
}
export interface ListFundamentalMetricsResponse {
    metrics: FundamentalMetricInfo[];
}
export declare const ComputeIndicatorRequest: MessageFns<ComputeIndicatorRequest>;
export declare const ComputeIndicatorRequest_ParamsEntry: MessageFns<ComputeIndicatorRequest_ParamsEntry>;
export declare const ComputeIndicatorResponse: MessageFns<ComputeIndicatorResponse>;
export declare const ComputeIndicatorResponse_ParamsUsedEntry: MessageFns<ComputeIndicatorResponse_ParamsUsedEntry>;
export declare const IndicatorPoint: MessageFns<IndicatorPoint>;
export declare const IndicatorPoint_ExtraEntry: MessageFns<IndicatorPoint_ExtraEntry>;
export declare const ExecuteFormulaRequest: MessageFns<ExecuteFormulaRequest>;
export declare const ExecuteFormulaRequest_EnvEntry: MessageFns<ExecuteFormulaRequest_EnvEntry>;
export declare const ExecuteFormulaResponse: MessageFns<ExecuteFormulaResponse>;
export declare const FormulaParameter: MessageFns<FormulaParameter>;
export declare const FormulaOutput: MessageFns<FormulaOutput>;
export declare const ParameterValidationError: MessageFns<ParameterValidationError>;
export declare const FormulaDefinition: MessageFns<FormulaDefinition>;
export declare const FormulaDefinition_InputSchemaEntry: MessageFns<FormulaDefinition_InputSchemaEntry>;
export declare const ListIndicatorsRequest: MessageFns<ListIndicatorsRequest>;
export declare const ListIndicatorsResponse: MessageFns<ListIndicatorsResponse>;
export declare const IndicatorMeta: MessageFns<IndicatorMeta>;
export declare const RegisterFormulaRequest: MessageFns<RegisterFormulaRequest>;
export declare const RegisterFormulaRequest_InputSchemaEntry: MessageFns<RegisterFormulaRequest_InputSchemaEntry>;
export declare const RegisterFormulaResponse: MessageFns<RegisterFormulaResponse>;
export declare const GetFormulaRequest: MessageFns<GetFormulaRequest>;
export declare const ListFormulasRequest: MessageFns<ListFormulasRequest>;
export declare const ListFormulasResponse: MessageFns<ListFormulasResponse>;
export declare const UpdateFormulaRequest: MessageFns<UpdateFormulaRequest>;
export declare const UpdateFormulaResponse: MessageFns<UpdateFormulaResponse>;
export declare const DeleteFormulaRequest: MessageFns<DeleteFormulaRequest>;
export declare const DeleteFormulaResponse: MessageFns<DeleteFormulaResponse>;
export declare const ListFundamentalMetricsRequest: MessageFns<ListFundamentalMetricsRequest>;
export declare const FundamentalMetricInfo: MessageFns<FundamentalMetricInfo>;
export declare const ListFundamentalMetricsResponse: MessageFns<ListFundamentalMetricsResponse>;
/**
 * IndicatorsService — formula engine and sandboxed Python execution.
 * Sandbox timeout and memory limits are configured via xstockstrat-config.
 */
export type IndicatorsServiceService = typeof IndicatorsServiceService;
export declare const IndicatorsServiceService: {
    /** Compute a built-in indicator (e.g. SMA, EMA, RSI, MACD, BB) */
    readonly computeIndicator: {
        readonly path: "/xstockstrat.indicators.v1.IndicatorsService/ComputeIndicator";
        readonly requestStream: false;
        readonly responseStream: false;
        readonly requestSerialize: (value: ComputeIndicatorRequest) => Buffer;
        readonly requestDeserialize: (value: Buffer) => ComputeIndicatorRequest;
        readonly responseSerialize: (value: ComputeIndicatorResponse) => Buffer;
        readonly responseDeserialize: (value: Buffer) => ComputeIndicatorResponse;
    };
    /**
     * Execute a custom Python formula in a sandboxed environment
     * Timeout and memory cap sourced from config: indicators.sandbox.*
     */
    readonly executeFormula: {
        readonly path: "/xstockstrat.indicators.v1.IndicatorsService/ExecuteFormula";
        readonly requestStream: false;
        readonly responseStream: false;
        readonly requestSerialize: (value: ExecuteFormulaRequest) => Buffer;
        readonly requestDeserialize: (value: Buffer) => ExecuteFormulaRequest;
        readonly responseSerialize: (value: ExecuteFormulaResponse) => Buffer;
        readonly responseDeserialize: (value: Buffer) => ExecuteFormulaResponse;
    };
    /** List available built-in indicators */
    readonly listIndicators: {
        readonly path: "/xstockstrat.indicators.v1.IndicatorsService/ListIndicators";
        readonly requestStream: false;
        readonly responseStream: false;
        readonly requestSerialize: (value: ListIndicatorsRequest) => Buffer;
        readonly requestDeserialize: (value: Buffer) => ListIndicatorsRequest;
        readonly responseSerialize: (value: ListIndicatorsResponse) => Buffer;
        readonly responseDeserialize: (value: Buffer) => ListIndicatorsResponse;
    };
    /** Register a custom formula definition */
    readonly registerFormula: {
        readonly path: "/xstockstrat.indicators.v1.IndicatorsService/RegisterFormula";
        readonly requestStream: false;
        readonly responseStream: false;
        readonly requestSerialize: (value: RegisterFormulaRequest) => Buffer;
        readonly requestDeserialize: (value: Buffer) => RegisterFormulaRequest;
        readonly responseSerialize: (value: RegisterFormulaResponse) => Buffer;
        readonly responseDeserialize: (value: Buffer) => RegisterFormulaResponse;
    };
    /** Get a registered formula */
    readonly getFormula: {
        readonly path: "/xstockstrat.indicators.v1.IndicatorsService/GetFormula";
        readonly requestStream: false;
        readonly responseStream: false;
        readonly requestSerialize: (value: GetFormulaRequest) => Buffer;
        readonly requestDeserialize: (value: Buffer) => GetFormulaRequest;
        readonly responseSerialize: (value: FormulaDefinition) => Buffer;
        readonly responseDeserialize: (value: Buffer) => FormulaDefinition;
    };
    /** List formula definitions with optional author filter and pagination */
    readonly listFormulas: {
        readonly path: "/xstockstrat.indicators.v1.IndicatorsService/ListFormulas";
        readonly requestStream: false;
        readonly responseStream: false;
        readonly requestSerialize: (value: ListFormulasRequest) => Buffer;
        readonly requestDeserialize: (value: Buffer) => ListFormulasRequest;
        readonly responseSerialize: (value: ListFormulasResponse) => Buffer;
        readonly responseDeserialize: (value: Buffer) => ListFormulasResponse;
    };
    /**
     * Update a formula's name, description, source, or is_public flag
     * Returns PERMISSION_DENIED if user_id does not match author
     */
    readonly updateFormula: {
        readonly path: "/xstockstrat.indicators.v1.IndicatorsService/UpdateFormula";
        readonly requestStream: false;
        readonly responseStream: false;
        readonly requestSerialize: (value: UpdateFormulaRequest) => Buffer;
        readonly requestDeserialize: (value: Buffer) => UpdateFormulaRequest;
        readonly responseSerialize: (value: UpdateFormulaResponse) => Buffer;
        readonly responseDeserialize: (value: Buffer) => UpdateFormulaResponse;
    };
    /**
     * Delete a formula by ID
     * Returns PERMISSION_DENIED if user_id does not match author
     */
    readonly deleteFormula: {
        readonly path: "/xstockstrat.indicators.v1.IndicatorsService/DeleteFormula";
        readonly requestStream: false;
        readonly responseStream: false;
        readonly requestSerialize: (value: DeleteFormulaRequest) => Buffer;
        readonly requestDeserialize: (value: Buffer) => DeleteFormulaRequest;
        readonly responseSerialize: (value: DeleteFormulaResponse) => Buffer;
        readonly responseDeserialize: (value: Buffer) => DeleteFormulaResponse;
    };
    /** List the available fundamental metrics for formula declarations (feature 205) */
    readonly listFundamentalMetrics: {
        readonly path: "/xstockstrat.indicators.v1.IndicatorsService/ListFundamentalMetrics";
        readonly requestStream: false;
        readonly responseStream: false;
        readonly requestSerialize: (value: ListFundamentalMetricsRequest) => Buffer;
        readonly requestDeserialize: (value: Buffer) => ListFundamentalMetricsRequest;
        readonly responseSerialize: (value: ListFundamentalMetricsResponse) => Buffer;
        readonly responseDeserialize: (value: Buffer) => ListFundamentalMetricsResponse;
    };
};
export interface IndicatorsServiceServer extends UntypedServiceImplementation {
    /** Compute a built-in indicator (e.g. SMA, EMA, RSI, MACD, BB) */
    computeIndicator: handleUnaryCall<ComputeIndicatorRequest, ComputeIndicatorResponse>;
    /**
     * Execute a custom Python formula in a sandboxed environment
     * Timeout and memory cap sourced from config: indicators.sandbox.*
     */
    executeFormula: handleUnaryCall<ExecuteFormulaRequest, ExecuteFormulaResponse>;
    /** List available built-in indicators */
    listIndicators: handleUnaryCall<ListIndicatorsRequest, ListIndicatorsResponse>;
    /** Register a custom formula definition */
    registerFormula: handleUnaryCall<RegisterFormulaRequest, RegisterFormulaResponse>;
    /** Get a registered formula */
    getFormula: handleUnaryCall<GetFormulaRequest, FormulaDefinition>;
    /** List formula definitions with optional author filter and pagination */
    listFormulas: handleUnaryCall<ListFormulasRequest, ListFormulasResponse>;
    /**
     * Update a formula's name, description, source, or is_public flag
     * Returns PERMISSION_DENIED if user_id does not match author
     */
    updateFormula: handleUnaryCall<UpdateFormulaRequest, UpdateFormulaResponse>;
    /**
     * Delete a formula by ID
     * Returns PERMISSION_DENIED if user_id does not match author
     */
    deleteFormula: handleUnaryCall<DeleteFormulaRequest, DeleteFormulaResponse>;
    /** List the available fundamental metrics for formula declarations (feature 205) */
    listFundamentalMetrics: handleUnaryCall<ListFundamentalMetricsRequest, ListFundamentalMetricsResponse>;
}
export interface IndicatorsServiceClient extends Client {
    /** Compute a built-in indicator (e.g. SMA, EMA, RSI, MACD, BB) */
    computeIndicator(request: ComputeIndicatorRequest, callback: (error: ServiceError | null, response: ComputeIndicatorResponse) => void): ClientUnaryCall;
    computeIndicator(request: ComputeIndicatorRequest, metadata: Metadata, callback: (error: ServiceError | null, response: ComputeIndicatorResponse) => void): ClientUnaryCall;
    computeIndicator(request: ComputeIndicatorRequest, metadata: Metadata, options: Partial<CallOptions>, callback: (error: ServiceError | null, response: ComputeIndicatorResponse) => void): ClientUnaryCall;
    /**
     * Execute a custom Python formula in a sandboxed environment
     * Timeout and memory cap sourced from config: indicators.sandbox.*
     */
    executeFormula(request: ExecuteFormulaRequest, callback: (error: ServiceError | null, response: ExecuteFormulaResponse) => void): ClientUnaryCall;
    executeFormula(request: ExecuteFormulaRequest, metadata: Metadata, callback: (error: ServiceError | null, response: ExecuteFormulaResponse) => void): ClientUnaryCall;
    executeFormula(request: ExecuteFormulaRequest, metadata: Metadata, options: Partial<CallOptions>, callback: (error: ServiceError | null, response: ExecuteFormulaResponse) => void): ClientUnaryCall;
    /** List available built-in indicators */
    listIndicators(request: ListIndicatorsRequest, callback: (error: ServiceError | null, response: ListIndicatorsResponse) => void): ClientUnaryCall;
    listIndicators(request: ListIndicatorsRequest, metadata: Metadata, callback: (error: ServiceError | null, response: ListIndicatorsResponse) => void): ClientUnaryCall;
    listIndicators(request: ListIndicatorsRequest, metadata: Metadata, options: Partial<CallOptions>, callback: (error: ServiceError | null, response: ListIndicatorsResponse) => void): ClientUnaryCall;
    /** Register a custom formula definition */
    registerFormula(request: RegisterFormulaRequest, callback: (error: ServiceError | null, response: RegisterFormulaResponse) => void): ClientUnaryCall;
    registerFormula(request: RegisterFormulaRequest, metadata: Metadata, callback: (error: ServiceError | null, response: RegisterFormulaResponse) => void): ClientUnaryCall;
    registerFormula(request: RegisterFormulaRequest, metadata: Metadata, options: Partial<CallOptions>, callback: (error: ServiceError | null, response: RegisterFormulaResponse) => void): ClientUnaryCall;
    /** Get a registered formula */
    getFormula(request: GetFormulaRequest, callback: (error: ServiceError | null, response: FormulaDefinition) => void): ClientUnaryCall;
    getFormula(request: GetFormulaRequest, metadata: Metadata, callback: (error: ServiceError | null, response: FormulaDefinition) => void): ClientUnaryCall;
    getFormula(request: GetFormulaRequest, metadata: Metadata, options: Partial<CallOptions>, callback: (error: ServiceError | null, response: FormulaDefinition) => void): ClientUnaryCall;
    /** List formula definitions with optional author filter and pagination */
    listFormulas(request: ListFormulasRequest, callback: (error: ServiceError | null, response: ListFormulasResponse) => void): ClientUnaryCall;
    listFormulas(request: ListFormulasRequest, metadata: Metadata, callback: (error: ServiceError | null, response: ListFormulasResponse) => void): ClientUnaryCall;
    listFormulas(request: ListFormulasRequest, metadata: Metadata, options: Partial<CallOptions>, callback: (error: ServiceError | null, response: ListFormulasResponse) => void): ClientUnaryCall;
    /**
     * Update a formula's name, description, source, or is_public flag
     * Returns PERMISSION_DENIED if user_id does not match author
     */
    updateFormula(request: UpdateFormulaRequest, callback: (error: ServiceError | null, response: UpdateFormulaResponse) => void): ClientUnaryCall;
    updateFormula(request: UpdateFormulaRequest, metadata: Metadata, callback: (error: ServiceError | null, response: UpdateFormulaResponse) => void): ClientUnaryCall;
    updateFormula(request: UpdateFormulaRequest, metadata: Metadata, options: Partial<CallOptions>, callback: (error: ServiceError | null, response: UpdateFormulaResponse) => void): ClientUnaryCall;
    /**
     * Delete a formula by ID
     * Returns PERMISSION_DENIED if user_id does not match author
     */
    deleteFormula(request: DeleteFormulaRequest, callback: (error: ServiceError | null, response: DeleteFormulaResponse) => void): ClientUnaryCall;
    deleteFormula(request: DeleteFormulaRequest, metadata: Metadata, callback: (error: ServiceError | null, response: DeleteFormulaResponse) => void): ClientUnaryCall;
    deleteFormula(request: DeleteFormulaRequest, metadata: Metadata, options: Partial<CallOptions>, callback: (error: ServiceError | null, response: DeleteFormulaResponse) => void): ClientUnaryCall;
    /** List the available fundamental metrics for formula declarations (feature 205) */
    listFundamentalMetrics(request: ListFundamentalMetricsRequest, callback: (error: ServiceError | null, response: ListFundamentalMetricsResponse) => void): ClientUnaryCall;
    listFundamentalMetrics(request: ListFundamentalMetricsRequest, metadata: Metadata, callback: (error: ServiceError | null, response: ListFundamentalMetricsResponse) => void): ClientUnaryCall;
    listFundamentalMetrics(request: ListFundamentalMetricsRequest, metadata: Metadata, options: Partial<CallOptions>, callback: (error: ServiceError | null, response: ListFundamentalMetricsResponse) => void): ClientUnaryCall;
}
export declare const IndicatorsServiceClient: {
    new (address: string, credentials: ChannelCredentials, options?: Partial<ClientOptions>): IndicatorsServiceClient;
    service: typeof IndicatorsServiceService;
    serviceName: string;
};
type Builtin = Date | Function | Uint8Array | string | number | boolean | undefined;
export type DeepPartial<T> = T extends Builtin ? T : T extends globalThis.Array<infer U> ? globalThis.Array<DeepPartial<U>> : T extends ReadonlyArray<infer U> ? ReadonlyArray<DeepPartial<U>> : T extends {} ? {
    [K in keyof T]?: DeepPartial<T[K]>;
} : Partial<T>;
type KeysOfUnion<T> = T extends T ? keyof T : never;
export type Exact<P, I extends P> = P extends Builtin ? P : P & {
    [K in keyof P]: Exact<P[K], I[K]>;
} & {
    [K in Exclude<keyof I, KeysOfUnion<P>>]: never;
};
export interface MessageFns<T> {
    encode(message: T, writer?: BinaryWriter): BinaryWriter;
    decode(input: BinaryReader | Uint8Array, length?: number): T;
    fromJSON(object: any): T;
    toJSON(message: T): unknown;
    create<I extends Exact<DeepPartial<T>, I>>(base?: I): T;
    fromPartial<I extends Exact<DeepPartial<T>, I>>(object: I): T;
}
export {};

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
    /** must match formula.author; returns PERMISSION_DENIED otherwise */
    userId: string;
    name: string;
    description: string;
    source: string;
    isPublic: boolean;
    parameters: FormulaParameter[];
}
export interface UpdateFormulaResponse {
    formula?: FormulaDefinition | undefined;
}
export interface DeleteFormulaRequest {
    formulaId: string;
    /** must match formula.author; returns PERMISSION_DENIED otherwise */
    userId: string;
}
export interface DeleteFormulaResponse {
    success: boolean;
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

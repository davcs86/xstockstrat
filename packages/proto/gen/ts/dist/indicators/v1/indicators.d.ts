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
export declare const ComputeIndicatorRequest: MessageFns<ComputeIndicatorRequest>;
export declare const ComputeIndicatorRequest_ParamsEntry: MessageFns<ComputeIndicatorRequest_ParamsEntry>;
export declare const ComputeIndicatorResponse: MessageFns<ComputeIndicatorResponse>;
export declare const ComputeIndicatorResponse_ParamsUsedEntry: MessageFns<ComputeIndicatorResponse_ParamsUsedEntry>;
export declare const IndicatorPoint: MessageFns<IndicatorPoint>;
export declare const IndicatorPoint_ExtraEntry: MessageFns<IndicatorPoint_ExtraEntry>;
export declare const ExecuteFormulaRequest: MessageFns<ExecuteFormulaRequest>;
export declare const ExecuteFormulaRequest_EnvEntry: MessageFns<ExecuteFormulaRequest_EnvEntry>;
export declare const ExecuteFormulaResponse: MessageFns<ExecuteFormulaResponse>;
export declare const FormulaDefinition: MessageFns<FormulaDefinition>;
export declare const FormulaDefinition_InputSchemaEntry: MessageFns<FormulaDefinition_InputSchemaEntry>;
export declare const ListIndicatorsRequest: MessageFns<ListIndicatorsRequest>;
export declare const ListIndicatorsResponse: MessageFns<ListIndicatorsResponse>;
export declare const IndicatorMeta: MessageFns<IndicatorMeta>;
export declare const RegisterFormulaRequest: MessageFns<RegisterFormulaRequest>;
export declare const RegisterFormulaRequest_InputSchemaEntry: MessageFns<RegisterFormulaRequest_InputSchemaEntry>;
export declare const RegisterFormulaResponse: MessageFns<RegisterFormulaResponse>;
export declare const GetFormulaRequest: MessageFns<GetFormulaRequest>;
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

import { BinaryReader, BinaryWriter } from "@bufbuild/protobuf/wire";
import { type CallOptions, type ChannelCredentials, Client, type ClientOptions, type ClientUnaryCall, type handleUnaryCall, type Metadata, type ServiceError, type UntypedServiceImplementation } from "@grpc/grpc-js";
import { PageRequest, PageResponse, Timeframe, TimeRange } from "../../common/v1/common";
export declare const protobufPackage = "xstockstrat.ingest.v1";
export declare enum BackfillStatus {
    BACKFILL_STATUS_UNSPECIFIED = "BACKFILL_STATUS_UNSPECIFIED",
    BACKFILL_STATUS_QUEUED = "BACKFILL_STATUS_QUEUED",
    BACKFILL_STATUS_RUNNING = "BACKFILL_STATUS_RUNNING",
    BACKFILL_STATUS_COMPLETED = "BACKFILL_STATUS_COMPLETED",
    BACKFILL_STATUS_FAILED = "BACKFILL_STATUS_FAILED",
    BACKFILL_STATUS_PARTIAL = "BACKFILL_STATUS_PARTIAL",
    /** BACKFILL_STATUS_CANCELED - operator-canceled (FR-4); completed-chunk bars retained */
    BACKFILL_STATUS_CANCELED = "BACKFILL_STATUS_CANCELED",
    UNRECOGNIZED = "UNRECOGNIZED"
}
export declare function backfillStatusFromJSON(object: any): BackfillStatus;
export declare function backfillStatusToJSON(object: BackfillStatus): string;
export declare function backfillStatusToNumber(object: BackfillStatus): number;
/** FillMode selects how much of the requested range a backfill fetches (feature 054, FR-4). */
export declare enum FillMode {
    /** FILL_MODE_UNSPECIFIED - treated as FILL_MODE_FULL by the server */
    FILL_MODE_UNSPECIFIED = "FILL_MODE_UNSPECIFIED",
    /** FILL_MODE_FULL - fetch the entire requested range (current behavior) */
    FILL_MODE_FULL = "FILL_MODE_FULL",
    /** FILL_MODE_GAPS_ONLY - fetch only ranges missing per GetDataCoverage */
    FILL_MODE_GAPS_ONLY = "FILL_MODE_GAPS_ONLY",
    UNRECOGNIZED = "UNRECOGNIZED"
}
export declare function fillModeFromJSON(object: any): FillMode;
export declare function fillModeToJSON(object: FillMode): string;
export declare function fillModeToNumber(object: FillMode): number;
export interface BackfillJob {
    jobId: string;
    symbols: string[];
    /**
     * DEPRECATED: use timeframe_enum. Removed in a future release once all callers migrate.
     *
     * @deprecated
     */
    timeframe: string;
    range?: TimeRange | undefined;
    status: BackfillStatus;
    barsProcessed: number;
    barsTotal: number;
    startedAt?: Date | undefined;
    completedAt?: Date | undefined;
    error: string;
    /** symbols that failed in a PARTIAL/FAILED job (FR-7) */
    failedSymbols: string[];
    timeframeEnum: Timeframe;
    /** planned chunk count (FR-5) */
    chunksTotal: number;
    /** chunks in COMPLETED state (FR-5) */
    chunksCompleted: number;
}
export interface TriggerBackfillRequest {
    symbols: string[];
    /**
     * DEPRECATED: use timeframe_enum. Removed in a future release once all callers migrate.
     *
     * @deprecated
     */
    timeframe: string;
    range?: TimeRange | undefined;
    overwrite: boolean;
    timeframeEnum: Timeframe;
    /** FR-4; UNSPECIFIED == FULL. Independent of `overwrite`. */
    fillMode: FillMode;
}
export interface TriggerBackfillResponse {
    jobId: string;
    status: BackfillStatus;
}
export interface GetBackfillStatusRequest {
    jobId: string;
}
export interface ListBackfillJobsRequest {
    statusFilter: BackfillStatus;
    page?: PageRequest | undefined;
    /** optional ticker filter (FR-3); empty = no narrowing */
    symbol: string;
}
export interface CancelBackfillRequest {
    jobId: string;
}
export interface ListBackfillJobsResponse {
    jobs: BackfillJob[];
    page?: PageResponse | undefined;
}
export interface NormalizeRawDataRequest {
    source: string;
    rawData: Buffer;
    /** "csv", "json", "alpaca_v2" */
    format: string;
}
export interface NormalizeRawDataResponse {
    rowsNormalized: number;
    errors: string[];
}
/** ExternalSignal represents a newsletter or signal-source trade recommendation. */
export interface ExternalSignal {
    /** "unusual_whales" | "marketwatch" | "dividendology" | "pure_power_picks" | "simply_wall_st" */
    source: string;
    /** ticker (e.g. "AAPL") */
    symbol: string;
    /** "buy" | "sell" | "hold" | "watchlist" */
    direction: string;
    /** 0.0 – 1.0 confidence (0.0 if not provided by source) */
    conviction: number;
    validFrom?: Date | undefined;
    /** omit for open-ended */
    validUntil?: Date | undefined;
    headline: string;
    rawUrl: string;
    tags: string[];
}
export interface IngestSignalRequest {
    signal?: ExternalSignal | undefined;
}
export interface IngestSignalResponse {
    signalId: number;
}
export interface QuerySignalsRequest {
    /** optional filter */
    source: string;
    /** optional filter */
    symbol: string;
    /** optional filter */
    direction: string;
    /** signals valid within this range */
    activeWindow?: TimeRange | undefined;
    page?: PageRequest | undefined;
}
export interface QuerySignalsResponse {
    signals: ExternalSignal[];
    page?: PageResponse | undefined;
}
/**
 * SignalSource represents a registered signal source entry.
 * credentials_ref is intentionally absent — use has_credentials on read.
 */
export interface SignalSource {
    slug: string;
    displayName: string;
    sourceType: string;
    extractorModule: string;
    active: boolean;
    hasCredentials: boolean;
    configJson?: {
        [key: string]: any;
    } | undefined;
}
export interface ListSignalSourcesRequest {
    includeInactive: boolean;
}
export interface ListSignalSourcesResponse {
    sources: SignalSource[];
}
/**
 * ManageSignalSourceRequest: operation is "register" | "update" | "deactivate".
 * credentials_ref is only processed on register/update; ignored on deactivate.
 */
export interface ManageSignalSourceRequest {
    source?: SignalSource | undefined;
    credentialsRef: string;
    operation: string;
}
export interface ManageSignalSourceResponse {
    source?: SignalSource | undefined;
}
export declare const BackfillJob: MessageFns<BackfillJob>;
export declare const TriggerBackfillRequest: MessageFns<TriggerBackfillRequest>;
export declare const TriggerBackfillResponse: MessageFns<TriggerBackfillResponse>;
export declare const GetBackfillStatusRequest: MessageFns<GetBackfillStatusRequest>;
export declare const ListBackfillJobsRequest: MessageFns<ListBackfillJobsRequest>;
export declare const CancelBackfillRequest: MessageFns<CancelBackfillRequest>;
export declare const ListBackfillJobsResponse: MessageFns<ListBackfillJobsResponse>;
export declare const NormalizeRawDataRequest: MessageFns<NormalizeRawDataRequest>;
export declare const NormalizeRawDataResponse: MessageFns<NormalizeRawDataResponse>;
export declare const ExternalSignal: MessageFns<ExternalSignal>;
export declare const IngestSignalRequest: MessageFns<IngestSignalRequest>;
export declare const IngestSignalResponse: MessageFns<IngestSignalResponse>;
export declare const QuerySignalsRequest: MessageFns<QuerySignalsRequest>;
export declare const QuerySignalsResponse: MessageFns<QuerySignalsResponse>;
export declare const SignalSource: MessageFns<SignalSource>;
export declare const ListSignalSourcesRequest: MessageFns<ListSignalSourcesRequest>;
export declare const ListSignalSourcesResponse: MessageFns<ListSignalSourcesResponse>;
export declare const ManageSignalSourceRequest: MessageFns<ManageSignalSourceRequest>;
export declare const ManageSignalSourceResponse: MessageFns<ManageSignalSourceResponse>;
export type IngestServiceService = typeof IngestServiceService;
export declare const IngestServiceService: {
    readonly triggerBackfill: {
        readonly path: "/xstockstrat.ingest.v1.IngestService/TriggerBackfill";
        readonly requestStream: false;
        readonly responseStream: false;
        readonly requestSerialize: (value: TriggerBackfillRequest) => Buffer;
        readonly requestDeserialize: (value: Buffer) => TriggerBackfillRequest;
        readonly responseSerialize: (value: TriggerBackfillResponse) => Buffer;
        readonly responseDeserialize: (value: Buffer) => TriggerBackfillResponse;
    };
    readonly getBackfillStatus: {
        readonly path: "/xstockstrat.ingest.v1.IngestService/GetBackfillStatus";
        readonly requestStream: false;
        readonly responseStream: false;
        readonly requestSerialize: (value: GetBackfillStatusRequest) => Buffer;
        readonly requestDeserialize: (value: Buffer) => GetBackfillStatusRequest;
        readonly responseSerialize: (value: BackfillJob) => Buffer;
        readonly responseDeserialize: (value: Buffer) => BackfillJob;
    };
    readonly listBackfillJobs: {
        readonly path: "/xstockstrat.ingest.v1.IngestService/ListBackfillJobs";
        readonly requestStream: false;
        readonly responseStream: false;
        readonly requestSerialize: (value: ListBackfillJobsRequest) => Buffer;
        readonly requestDeserialize: (value: Buffer) => ListBackfillJobsRequest;
        readonly responseSerialize: (value: ListBackfillJobsResponse) => Buffer;
        readonly responseDeserialize: (value: Buffer) => ListBackfillJobsResponse;
    };
    /** Cancel a QUEUED/RUNNING backfill job; returns the updated job (CANCELED). Completed-chunk bars are retained (FR-4). */
    readonly cancelBackfill: {
        readonly path: "/xstockstrat.ingest.v1.IngestService/CancelBackfill";
        readonly requestStream: false;
        readonly responseStream: false;
        readonly requestSerialize: (value: CancelBackfillRequest) => Buffer;
        readonly requestDeserialize: (value: Buffer) => CancelBackfillRequest;
        readonly responseSerialize: (value: BackfillJob) => Buffer;
        readonly responseDeserialize: (value: Buffer) => BackfillJob;
    };
    readonly normalizeRawData: {
        readonly path: "/xstockstrat.ingest.v1.IngestService/NormalizeRawData";
        readonly requestStream: false;
        readonly responseStream: false;
        readonly requestSerialize: (value: NormalizeRawDataRequest) => Buffer;
        readonly requestDeserialize: (value: Buffer) => NormalizeRawDataRequest;
        readonly responseSerialize: (value: NormalizeRawDataResponse) => Buffer;
        readonly responseDeserialize: (value: Buffer) => NormalizeRawDataResponse;
    };
    /** Signal ingestion — persists newsletter/external signals to ingest.newsletter_signals hypertable */
    readonly ingestSignal: {
        readonly path: "/xstockstrat.ingest.v1.IngestService/IngestSignal";
        readonly requestStream: false;
        readonly responseStream: false;
        readonly requestSerialize: (value: IngestSignalRequest) => Buffer;
        readonly requestDeserialize: (value: Buffer) => IngestSignalRequest;
        readonly responseSerialize: (value: IngestSignalResponse) => Buffer;
        readonly responseDeserialize: (value: Buffer) => IngestSignalResponse;
    };
    /** Signal query — returns active signals filtered by source/symbol/direction and time window */
    readonly querySignals: {
        readonly path: "/xstockstrat.ingest.v1.IngestService/QuerySignals";
        readonly requestStream: false;
        readonly responseStream: false;
        readonly requestSerialize: (value: QuerySignalsRequest) => Buffer;
        readonly requestDeserialize: (value: Buffer) => QuerySignalsRequest;
        readonly responseSerialize: (value: QuerySignalsResponse) => Buffer;
        readonly responseDeserialize: (value: Buffer) => QuerySignalsResponse;
    };
    readonly listSignalSources: {
        readonly path: "/xstockstrat.ingest.v1.IngestService/ListSignalSources";
        readonly requestStream: false;
        readonly responseStream: false;
        readonly requestSerialize: (value: ListSignalSourcesRequest) => Buffer;
        readonly requestDeserialize: (value: Buffer) => ListSignalSourcesRequest;
        readonly responseSerialize: (value: ListSignalSourcesResponse) => Buffer;
        readonly responseDeserialize: (value: Buffer) => ListSignalSourcesResponse;
    };
    readonly manageSignalSource: {
        readonly path: "/xstockstrat.ingest.v1.IngestService/ManageSignalSource";
        readonly requestStream: false;
        readonly responseStream: false;
        readonly requestSerialize: (value: ManageSignalSourceRequest) => Buffer;
        readonly requestDeserialize: (value: Buffer) => ManageSignalSourceRequest;
        readonly responseSerialize: (value: ManageSignalSourceResponse) => Buffer;
        readonly responseDeserialize: (value: Buffer) => ManageSignalSourceResponse;
    };
};
export interface IngestServiceServer extends UntypedServiceImplementation {
    triggerBackfill: handleUnaryCall<TriggerBackfillRequest, TriggerBackfillResponse>;
    getBackfillStatus: handleUnaryCall<GetBackfillStatusRequest, BackfillJob>;
    listBackfillJobs: handleUnaryCall<ListBackfillJobsRequest, ListBackfillJobsResponse>;
    /** Cancel a QUEUED/RUNNING backfill job; returns the updated job (CANCELED). Completed-chunk bars are retained (FR-4). */
    cancelBackfill: handleUnaryCall<CancelBackfillRequest, BackfillJob>;
    normalizeRawData: handleUnaryCall<NormalizeRawDataRequest, NormalizeRawDataResponse>;
    /** Signal ingestion — persists newsletter/external signals to ingest.newsletter_signals hypertable */
    ingestSignal: handleUnaryCall<IngestSignalRequest, IngestSignalResponse>;
    /** Signal query — returns active signals filtered by source/symbol/direction and time window */
    querySignals: handleUnaryCall<QuerySignalsRequest, QuerySignalsResponse>;
    listSignalSources: handleUnaryCall<ListSignalSourcesRequest, ListSignalSourcesResponse>;
    manageSignalSource: handleUnaryCall<ManageSignalSourceRequest, ManageSignalSourceResponse>;
}
export interface IngestServiceClient extends Client {
    triggerBackfill(request: TriggerBackfillRequest, callback: (error: ServiceError | null, response: TriggerBackfillResponse) => void): ClientUnaryCall;
    triggerBackfill(request: TriggerBackfillRequest, metadata: Metadata, callback: (error: ServiceError | null, response: TriggerBackfillResponse) => void): ClientUnaryCall;
    triggerBackfill(request: TriggerBackfillRequest, metadata: Metadata, options: Partial<CallOptions>, callback: (error: ServiceError | null, response: TriggerBackfillResponse) => void): ClientUnaryCall;
    getBackfillStatus(request: GetBackfillStatusRequest, callback: (error: ServiceError | null, response: BackfillJob) => void): ClientUnaryCall;
    getBackfillStatus(request: GetBackfillStatusRequest, metadata: Metadata, callback: (error: ServiceError | null, response: BackfillJob) => void): ClientUnaryCall;
    getBackfillStatus(request: GetBackfillStatusRequest, metadata: Metadata, options: Partial<CallOptions>, callback: (error: ServiceError | null, response: BackfillJob) => void): ClientUnaryCall;
    listBackfillJobs(request: ListBackfillJobsRequest, callback: (error: ServiceError | null, response: ListBackfillJobsResponse) => void): ClientUnaryCall;
    listBackfillJobs(request: ListBackfillJobsRequest, metadata: Metadata, callback: (error: ServiceError | null, response: ListBackfillJobsResponse) => void): ClientUnaryCall;
    listBackfillJobs(request: ListBackfillJobsRequest, metadata: Metadata, options: Partial<CallOptions>, callback: (error: ServiceError | null, response: ListBackfillJobsResponse) => void): ClientUnaryCall;
    /** Cancel a QUEUED/RUNNING backfill job; returns the updated job (CANCELED). Completed-chunk bars are retained (FR-4). */
    cancelBackfill(request: CancelBackfillRequest, callback: (error: ServiceError | null, response: BackfillJob) => void): ClientUnaryCall;
    cancelBackfill(request: CancelBackfillRequest, metadata: Metadata, callback: (error: ServiceError | null, response: BackfillJob) => void): ClientUnaryCall;
    cancelBackfill(request: CancelBackfillRequest, metadata: Metadata, options: Partial<CallOptions>, callback: (error: ServiceError | null, response: BackfillJob) => void): ClientUnaryCall;
    normalizeRawData(request: NormalizeRawDataRequest, callback: (error: ServiceError | null, response: NormalizeRawDataResponse) => void): ClientUnaryCall;
    normalizeRawData(request: NormalizeRawDataRequest, metadata: Metadata, callback: (error: ServiceError | null, response: NormalizeRawDataResponse) => void): ClientUnaryCall;
    normalizeRawData(request: NormalizeRawDataRequest, metadata: Metadata, options: Partial<CallOptions>, callback: (error: ServiceError | null, response: NormalizeRawDataResponse) => void): ClientUnaryCall;
    /** Signal ingestion — persists newsletter/external signals to ingest.newsletter_signals hypertable */
    ingestSignal(request: IngestSignalRequest, callback: (error: ServiceError | null, response: IngestSignalResponse) => void): ClientUnaryCall;
    ingestSignal(request: IngestSignalRequest, metadata: Metadata, callback: (error: ServiceError | null, response: IngestSignalResponse) => void): ClientUnaryCall;
    ingestSignal(request: IngestSignalRequest, metadata: Metadata, options: Partial<CallOptions>, callback: (error: ServiceError | null, response: IngestSignalResponse) => void): ClientUnaryCall;
    /** Signal query — returns active signals filtered by source/symbol/direction and time window */
    querySignals(request: QuerySignalsRequest, callback: (error: ServiceError | null, response: QuerySignalsResponse) => void): ClientUnaryCall;
    querySignals(request: QuerySignalsRequest, metadata: Metadata, callback: (error: ServiceError | null, response: QuerySignalsResponse) => void): ClientUnaryCall;
    querySignals(request: QuerySignalsRequest, metadata: Metadata, options: Partial<CallOptions>, callback: (error: ServiceError | null, response: QuerySignalsResponse) => void): ClientUnaryCall;
    listSignalSources(request: ListSignalSourcesRequest, callback: (error: ServiceError | null, response: ListSignalSourcesResponse) => void): ClientUnaryCall;
    listSignalSources(request: ListSignalSourcesRequest, metadata: Metadata, callback: (error: ServiceError | null, response: ListSignalSourcesResponse) => void): ClientUnaryCall;
    listSignalSources(request: ListSignalSourcesRequest, metadata: Metadata, options: Partial<CallOptions>, callback: (error: ServiceError | null, response: ListSignalSourcesResponse) => void): ClientUnaryCall;
    manageSignalSource(request: ManageSignalSourceRequest, callback: (error: ServiceError | null, response: ManageSignalSourceResponse) => void): ClientUnaryCall;
    manageSignalSource(request: ManageSignalSourceRequest, metadata: Metadata, callback: (error: ServiceError | null, response: ManageSignalSourceResponse) => void): ClientUnaryCall;
    manageSignalSource(request: ManageSignalSourceRequest, metadata: Metadata, options: Partial<CallOptions>, callback: (error: ServiceError | null, response: ManageSignalSourceResponse) => void): ClientUnaryCall;
}
export declare const IngestServiceClient: {
    new (address: string, credentials: ChannelCredentials, options?: Partial<ClientOptions>): IngestServiceClient;
    service: typeof IngestServiceService;
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

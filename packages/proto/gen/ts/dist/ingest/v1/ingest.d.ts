import { BinaryReader, BinaryWriter } from "@bufbuild/protobuf/wire";
import { type CallOptions, type ChannelCredentials, Client, type ClientOptions, type ClientUnaryCall, type handleUnaryCall, type Metadata, type ServiceError, type UntypedServiceImplementation } from "@grpc/grpc-js";
import { PageRequest, PageResponse, TimeRange } from "../../common/v1/common";
export declare const protobufPackage = "xstockstrat.ingest.v1";
export declare enum BackfillStatus {
    BACKFILL_STATUS_UNSPECIFIED = "BACKFILL_STATUS_UNSPECIFIED",
    BACKFILL_STATUS_QUEUED = "BACKFILL_STATUS_QUEUED",
    BACKFILL_STATUS_RUNNING = "BACKFILL_STATUS_RUNNING",
    BACKFILL_STATUS_COMPLETED = "BACKFILL_STATUS_COMPLETED",
    BACKFILL_STATUS_FAILED = "BACKFILL_STATUS_FAILED",
    BACKFILL_STATUS_PARTIAL = "BACKFILL_STATUS_PARTIAL",
    UNRECOGNIZED = "UNRECOGNIZED"
}
export declare function backfillStatusFromJSON(object: any): BackfillStatus;
export declare function backfillStatusToJSON(object: BackfillStatus): string;
export declare function backfillStatusToNumber(object: BackfillStatus): number;
export interface BackfillJob {
    jobId: string;
    symbols: string[];
    timeframe: string;
    range?: TimeRange | undefined;
    status: BackfillStatus;
    barsProcessed: number;
    barsTotal: number;
    startedAt?: Date | undefined;
    completedAt?: Date | undefined;
    error: string;
}
export interface TriggerBackfillRequest {
    symbols: string[];
    timeframe: string;
    range?: TimeRange | undefined;
    overwrite: boolean;
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
export declare const BackfillJob: MessageFns<BackfillJob>;
export declare const TriggerBackfillRequest: MessageFns<TriggerBackfillRequest>;
export declare const TriggerBackfillResponse: MessageFns<TriggerBackfillResponse>;
export declare const GetBackfillStatusRequest: MessageFns<GetBackfillStatusRequest>;
export declare const ListBackfillJobsRequest: MessageFns<ListBackfillJobsRequest>;
export declare const ListBackfillJobsResponse: MessageFns<ListBackfillJobsResponse>;
export declare const NormalizeRawDataRequest: MessageFns<NormalizeRawDataRequest>;
export declare const NormalizeRawDataResponse: MessageFns<NormalizeRawDataResponse>;
export declare const ExternalSignal: MessageFns<ExternalSignal>;
export declare const IngestSignalRequest: MessageFns<IngestSignalRequest>;
export declare const IngestSignalResponse: MessageFns<IngestSignalResponse>;
export declare const QuerySignalsRequest: MessageFns<QuerySignalsRequest>;
export declare const QuerySignalsResponse: MessageFns<QuerySignalsResponse>;
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
};
export interface IngestServiceServer extends UntypedServiceImplementation {
    triggerBackfill: handleUnaryCall<TriggerBackfillRequest, TriggerBackfillResponse>;
    getBackfillStatus: handleUnaryCall<GetBackfillStatusRequest, BackfillJob>;
    listBackfillJobs: handleUnaryCall<ListBackfillJobsRequest, ListBackfillJobsResponse>;
    normalizeRawData: handleUnaryCall<NormalizeRawDataRequest, NormalizeRawDataResponse>;
    /** Signal ingestion — persists newsletter/external signals to ingest.newsletter_signals hypertable */
    ingestSignal: handleUnaryCall<IngestSignalRequest, IngestSignalResponse>;
    /** Signal query — returns active signals filtered by source/symbol/direction and time window */
    querySignals: handleUnaryCall<QuerySignalsRequest, QuerySignalsResponse>;
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

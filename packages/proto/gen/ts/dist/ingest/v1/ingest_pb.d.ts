import type { GenEnum, GenFile, GenMessage, GenService } from "@bufbuild/protobuf/codegenv2";
import type { Timestamp } from "@bufbuild/protobuf/wkt";
import type { PageRequest, PageResponse, Timeframe, TimeRange } from "../../common/v1/common_pb";
import type { JsonObject, Message } from "@bufbuild/protobuf";
/**
 * Describes the file ingest/v1/ingest.proto.
 */
export declare const file_ingest_v1_ingest: GenFile;
/**
 * @generated from message xstockstrat.ingest.v1.BackfillJob
 */
export type BackfillJob = Message<"xstockstrat.ingest.v1.BackfillJob"> & {
    /**
     * @generated from field: string job_id = 1;
     */
    jobId: string;
    /**
     * @generated from field: repeated string symbols = 2;
     */
    symbols: string[];
    /**
     * DEPRECATED: use timeframe_enum. Removed in a future release once all callers migrate.
     *
     * @generated from field: string timeframe = 3 [deprecated = true];
     * @deprecated
     */
    timeframe: string;
    /**
     * @generated from field: xstockstrat.common.v1.TimeRange range = 4;
     */
    range?: TimeRange | undefined;
    /**
     * @generated from field: xstockstrat.ingest.v1.BackfillStatus status = 5;
     */
    status: BackfillStatus;
    /**
     * @generated from field: int64 bars_processed = 6;
     */
    barsProcessed: bigint;
    /**
     * @generated from field: int64 bars_total = 7;
     */
    barsTotal: bigint;
    /**
     * @generated from field: google.protobuf.Timestamp started_at = 8;
     */
    startedAt?: Timestamp | undefined;
    /**
     * @generated from field: google.protobuf.Timestamp completed_at = 9;
     */
    completedAt?: Timestamp | undefined;
    /**
     * @generated from field: string error = 10;
     */
    error: string;
    /**
     * symbols that failed in a PARTIAL/FAILED job (FR-7)
     *
     * @generated from field: repeated string failed_symbols = 11;
     */
    failedSymbols: string[];
    /**
     * @generated from field: xstockstrat.common.v1.Timeframe timeframe_enum = 12;
     */
    timeframeEnum: Timeframe;
};
/**
 * Describes the message xstockstrat.ingest.v1.BackfillJob.
 * Use `create(BackfillJobSchema)` to create a new message.
 */
export declare const BackfillJobSchema: GenMessage<BackfillJob>;
/**
 * @generated from message xstockstrat.ingest.v1.TriggerBackfillRequest
 */
export type TriggerBackfillRequest = Message<"xstockstrat.ingest.v1.TriggerBackfillRequest"> & {
    /**
     * @generated from field: repeated string symbols = 1;
     */
    symbols: string[];
    /**
     * DEPRECATED: use timeframe_enum. Removed in a future release once all callers migrate.
     *
     * @generated from field: string timeframe = 2 [deprecated = true];
     * @deprecated
     */
    timeframe: string;
    /**
     * @generated from field: xstockstrat.common.v1.TimeRange range = 3;
     */
    range?: TimeRange | undefined;
    /**
     * @generated from field: bool overwrite = 4;
     */
    overwrite: boolean;
    /**
     * @generated from field: xstockstrat.common.v1.Timeframe timeframe_enum = 5;
     */
    timeframeEnum: Timeframe;
};
/**
 * Describes the message xstockstrat.ingest.v1.TriggerBackfillRequest.
 * Use `create(TriggerBackfillRequestSchema)` to create a new message.
 */
export declare const TriggerBackfillRequestSchema: GenMessage<TriggerBackfillRequest>;
/**
 * @generated from message xstockstrat.ingest.v1.TriggerBackfillResponse
 */
export type TriggerBackfillResponse = Message<"xstockstrat.ingest.v1.TriggerBackfillResponse"> & {
    /**
     * @generated from field: string job_id = 1;
     */
    jobId: string;
    /**
     * @generated from field: xstockstrat.ingest.v1.BackfillStatus status = 2;
     */
    status: BackfillStatus;
};
/**
 * Describes the message xstockstrat.ingest.v1.TriggerBackfillResponse.
 * Use `create(TriggerBackfillResponseSchema)` to create a new message.
 */
export declare const TriggerBackfillResponseSchema: GenMessage<TriggerBackfillResponse>;
/**
 * @generated from message xstockstrat.ingest.v1.GetBackfillStatusRequest
 */
export type GetBackfillStatusRequest = Message<"xstockstrat.ingest.v1.GetBackfillStatusRequest"> & {
    /**
     * @generated from field: string job_id = 1;
     */
    jobId: string;
};
/**
 * Describes the message xstockstrat.ingest.v1.GetBackfillStatusRequest.
 * Use `create(GetBackfillStatusRequestSchema)` to create a new message.
 */
export declare const GetBackfillStatusRequestSchema: GenMessage<GetBackfillStatusRequest>;
/**
 * @generated from message xstockstrat.ingest.v1.ListBackfillJobsRequest
 */
export type ListBackfillJobsRequest = Message<"xstockstrat.ingest.v1.ListBackfillJobsRequest"> & {
    /**
     * @generated from field: xstockstrat.ingest.v1.BackfillStatus status_filter = 1;
     */
    statusFilter: BackfillStatus;
    /**
     * @generated from field: xstockstrat.common.v1.PageRequest page = 2;
     */
    page?: PageRequest | undefined;
};
/**
 * Describes the message xstockstrat.ingest.v1.ListBackfillJobsRequest.
 * Use `create(ListBackfillJobsRequestSchema)` to create a new message.
 */
export declare const ListBackfillJobsRequestSchema: GenMessage<ListBackfillJobsRequest>;
/**
 * @generated from message xstockstrat.ingest.v1.ListBackfillJobsResponse
 */
export type ListBackfillJobsResponse = Message<"xstockstrat.ingest.v1.ListBackfillJobsResponse"> & {
    /**
     * @generated from field: repeated xstockstrat.ingest.v1.BackfillJob jobs = 1;
     */
    jobs: BackfillJob[];
    /**
     * @generated from field: xstockstrat.common.v1.PageResponse page = 2;
     */
    page?: PageResponse | undefined;
};
/**
 * Describes the message xstockstrat.ingest.v1.ListBackfillJobsResponse.
 * Use `create(ListBackfillJobsResponseSchema)` to create a new message.
 */
export declare const ListBackfillJobsResponseSchema: GenMessage<ListBackfillJobsResponse>;
/**
 * @generated from message xstockstrat.ingest.v1.NormalizeRawDataRequest
 */
export type NormalizeRawDataRequest = Message<"xstockstrat.ingest.v1.NormalizeRawDataRequest"> & {
    /**
     * @generated from field: string source = 1;
     */
    source: string;
    /**
     * @generated from field: bytes raw_data = 2;
     */
    rawData: Uint8Array;
    /**
     * "csv", "json", "alpaca_v2"
     *
     * @generated from field: string format = 3;
     */
    format: string;
};
/**
 * Describes the message xstockstrat.ingest.v1.NormalizeRawDataRequest.
 * Use `create(NormalizeRawDataRequestSchema)` to create a new message.
 */
export declare const NormalizeRawDataRequestSchema: GenMessage<NormalizeRawDataRequest>;
/**
 * @generated from message xstockstrat.ingest.v1.NormalizeRawDataResponse
 */
export type NormalizeRawDataResponse = Message<"xstockstrat.ingest.v1.NormalizeRawDataResponse"> & {
    /**
     * @generated from field: int64 rows_normalized = 1;
     */
    rowsNormalized: bigint;
    /**
     * @generated from field: repeated string errors = 2;
     */
    errors: string[];
};
/**
 * Describes the message xstockstrat.ingest.v1.NormalizeRawDataResponse.
 * Use `create(NormalizeRawDataResponseSchema)` to create a new message.
 */
export declare const NormalizeRawDataResponseSchema: GenMessage<NormalizeRawDataResponse>;
/**
 * ExternalSignal represents a newsletter or signal-source trade recommendation.
 *
 * @generated from message xstockstrat.ingest.v1.ExternalSignal
 */
export type ExternalSignal = Message<"xstockstrat.ingest.v1.ExternalSignal"> & {
    /**
     * "unusual_whales" | "marketwatch" | "dividendology" | "pure_power_picks" | "simply_wall_st"
     *
     * @generated from field: string source = 1;
     */
    source: string;
    /**
     * ticker (e.g. "AAPL")
     *
     * @generated from field: string symbol = 2;
     */
    symbol: string;
    /**
     * "buy" | "sell" | "hold" | "watchlist"
     *
     * @generated from field: string direction = 3;
     */
    direction: string;
    /**
     * 0.0 – 1.0 confidence (0.0 if not provided by source)
     *
     * @generated from field: double conviction = 4;
     */
    conviction: number;
    /**
     * @generated from field: google.protobuf.Timestamp valid_from = 5;
     */
    validFrom?: Timestamp | undefined;
    /**
     * omit for open-ended
     *
     * @generated from field: google.protobuf.Timestamp valid_until = 6;
     */
    validUntil?: Timestamp | undefined;
    /**
     * @generated from field: string headline = 7;
     */
    headline: string;
    /**
     * @generated from field: string raw_url = 8;
     */
    rawUrl: string;
    /**
     * @generated from field: repeated string tags = 9;
     */
    tags: string[];
};
/**
 * Describes the message xstockstrat.ingest.v1.ExternalSignal.
 * Use `create(ExternalSignalSchema)` to create a new message.
 */
export declare const ExternalSignalSchema: GenMessage<ExternalSignal>;
/**
 * @generated from message xstockstrat.ingest.v1.IngestSignalRequest
 */
export type IngestSignalRequest = Message<"xstockstrat.ingest.v1.IngestSignalRequest"> & {
    /**
     * @generated from field: xstockstrat.ingest.v1.ExternalSignal signal = 1;
     */
    signal?: ExternalSignal | undefined;
};
/**
 * Describes the message xstockstrat.ingest.v1.IngestSignalRequest.
 * Use `create(IngestSignalRequestSchema)` to create a new message.
 */
export declare const IngestSignalRequestSchema: GenMessage<IngestSignalRequest>;
/**
 * @generated from message xstockstrat.ingest.v1.IngestSignalResponse
 */
export type IngestSignalResponse = Message<"xstockstrat.ingest.v1.IngestSignalResponse"> & {
    /**
     * @generated from field: int64 signal_id = 1;
     */
    signalId: bigint;
};
/**
 * Describes the message xstockstrat.ingest.v1.IngestSignalResponse.
 * Use `create(IngestSignalResponseSchema)` to create a new message.
 */
export declare const IngestSignalResponseSchema: GenMessage<IngestSignalResponse>;
/**
 * @generated from message xstockstrat.ingest.v1.QuerySignalsRequest
 */
export type QuerySignalsRequest = Message<"xstockstrat.ingest.v1.QuerySignalsRequest"> & {
    /**
     * optional filter
     *
     * @generated from field: string source = 1;
     */
    source: string;
    /**
     * optional filter
     *
     * @generated from field: string symbol = 2;
     */
    symbol: string;
    /**
     * optional filter
     *
     * @generated from field: string direction = 3;
     */
    direction: string;
    /**
     * signals valid within this range
     *
     * @generated from field: xstockstrat.common.v1.TimeRange active_window = 4;
     */
    activeWindow?: TimeRange | undefined;
    /**
     * @generated from field: xstockstrat.common.v1.PageRequest page = 5;
     */
    page?: PageRequest | undefined;
};
/**
 * Describes the message xstockstrat.ingest.v1.QuerySignalsRequest.
 * Use `create(QuerySignalsRequestSchema)` to create a new message.
 */
export declare const QuerySignalsRequestSchema: GenMessage<QuerySignalsRequest>;
/**
 * @generated from message xstockstrat.ingest.v1.QuerySignalsResponse
 */
export type QuerySignalsResponse = Message<"xstockstrat.ingest.v1.QuerySignalsResponse"> & {
    /**
     * @generated from field: repeated xstockstrat.ingest.v1.ExternalSignal signals = 1;
     */
    signals: ExternalSignal[];
    /**
     * @generated from field: xstockstrat.common.v1.PageResponse page = 2;
     */
    page?: PageResponse | undefined;
};
/**
 * Describes the message xstockstrat.ingest.v1.QuerySignalsResponse.
 * Use `create(QuerySignalsResponseSchema)` to create a new message.
 */
export declare const QuerySignalsResponseSchema: GenMessage<QuerySignalsResponse>;
/**
 * SignalSource represents a registered signal source entry.
 * credentials_ref is intentionally absent — use has_credentials on read.
 *
 * @generated from message xstockstrat.ingest.v1.SignalSource
 */
export type SignalSource = Message<"xstockstrat.ingest.v1.SignalSource"> & {
    /**
     * @generated from field: string slug = 1;
     */
    slug: string;
    /**
     * @generated from field: string display_name = 2;
     */
    displayName: string;
    /**
     * @generated from field: string source_type = 3;
     */
    sourceType: string;
    /**
     * @generated from field: string extractor_module = 4;
     */
    extractorModule: string;
    /**
     * @generated from field: bool active = 5;
     */
    active: boolean;
    /**
     * @generated from field: bool has_credentials = 6;
     */
    hasCredentials: boolean;
    /**
     * @generated from field: google.protobuf.Struct config_json = 7;
     */
    configJson?: JsonObject | undefined;
};
/**
 * Describes the message xstockstrat.ingest.v1.SignalSource.
 * Use `create(SignalSourceSchema)` to create a new message.
 */
export declare const SignalSourceSchema: GenMessage<SignalSource>;
/**
 * @generated from message xstockstrat.ingest.v1.ListSignalSourcesRequest
 */
export type ListSignalSourcesRequest = Message<"xstockstrat.ingest.v1.ListSignalSourcesRequest"> & {
    /**
     * @generated from field: bool include_inactive = 1;
     */
    includeInactive: boolean;
};
/**
 * Describes the message xstockstrat.ingest.v1.ListSignalSourcesRequest.
 * Use `create(ListSignalSourcesRequestSchema)` to create a new message.
 */
export declare const ListSignalSourcesRequestSchema: GenMessage<ListSignalSourcesRequest>;
/**
 * @generated from message xstockstrat.ingest.v1.ListSignalSourcesResponse
 */
export type ListSignalSourcesResponse = Message<"xstockstrat.ingest.v1.ListSignalSourcesResponse"> & {
    /**
     * @generated from field: repeated xstockstrat.ingest.v1.SignalSource sources = 1;
     */
    sources: SignalSource[];
};
/**
 * Describes the message xstockstrat.ingest.v1.ListSignalSourcesResponse.
 * Use `create(ListSignalSourcesResponseSchema)` to create a new message.
 */
export declare const ListSignalSourcesResponseSchema: GenMessage<ListSignalSourcesResponse>;
/**
 * ManageSignalSourceRequest: operation is "register" | "update" | "deactivate".
 * credentials_ref is only processed on register/update; ignored on deactivate.
 *
 * @generated from message xstockstrat.ingest.v1.ManageSignalSourceRequest
 */
export type ManageSignalSourceRequest = Message<"xstockstrat.ingest.v1.ManageSignalSourceRequest"> & {
    /**
     * @generated from field: xstockstrat.ingest.v1.SignalSource source = 1;
     */
    source?: SignalSource | undefined;
    /**
     * @generated from field: string credentials_ref = 2;
     */
    credentialsRef: string;
    /**
     * @generated from field: string operation = 3;
     */
    operation: string;
};
/**
 * Describes the message xstockstrat.ingest.v1.ManageSignalSourceRequest.
 * Use `create(ManageSignalSourceRequestSchema)` to create a new message.
 */
export declare const ManageSignalSourceRequestSchema: GenMessage<ManageSignalSourceRequest>;
/**
 * @generated from message xstockstrat.ingest.v1.ManageSignalSourceResponse
 */
export type ManageSignalSourceResponse = Message<"xstockstrat.ingest.v1.ManageSignalSourceResponse"> & {
    /**
     * @generated from field: xstockstrat.ingest.v1.SignalSource source = 1;
     */
    source?: SignalSource | undefined;
};
/**
 * Describes the message xstockstrat.ingest.v1.ManageSignalSourceResponse.
 * Use `create(ManageSignalSourceResponseSchema)` to create a new message.
 */
export declare const ManageSignalSourceResponseSchema: GenMessage<ManageSignalSourceResponse>;
/**
 * @generated from enum xstockstrat.ingest.v1.BackfillStatus
 */
export declare enum BackfillStatus {
    /**
     * @generated from enum value: BACKFILL_STATUS_UNSPECIFIED = 0;
     */
    UNSPECIFIED = 0,
    /**
     * @generated from enum value: BACKFILL_STATUS_QUEUED = 1;
     */
    QUEUED = 1,
    /**
     * @generated from enum value: BACKFILL_STATUS_RUNNING = 2;
     */
    RUNNING = 2,
    /**
     * @generated from enum value: BACKFILL_STATUS_COMPLETED = 3;
     */
    COMPLETED = 3,
    /**
     * @generated from enum value: BACKFILL_STATUS_FAILED = 4;
     */
    FAILED = 4,
    /**
     * @generated from enum value: BACKFILL_STATUS_PARTIAL = 5;
     */
    PARTIAL = 5
}
/**
 * Describes the enum xstockstrat.ingest.v1.BackfillStatus.
 */
export declare const BackfillStatusSchema: GenEnum<BackfillStatus>;
/**
 * @generated from service xstockstrat.ingest.v1.IngestService
 */
export declare const IngestService: GenService<{
    /**
     * @generated from rpc xstockstrat.ingest.v1.IngestService.TriggerBackfill
     */
    triggerBackfill: {
        methodKind: "unary";
        input: typeof TriggerBackfillRequestSchema;
        output: typeof TriggerBackfillResponseSchema;
    };
    /**
     * @generated from rpc xstockstrat.ingest.v1.IngestService.GetBackfillStatus
     */
    getBackfillStatus: {
        methodKind: "unary";
        input: typeof GetBackfillStatusRequestSchema;
        output: typeof BackfillJobSchema;
    };
    /**
     * @generated from rpc xstockstrat.ingest.v1.IngestService.ListBackfillJobs
     */
    listBackfillJobs: {
        methodKind: "unary";
        input: typeof ListBackfillJobsRequestSchema;
        output: typeof ListBackfillJobsResponseSchema;
    };
    /**
     * @generated from rpc xstockstrat.ingest.v1.IngestService.NormalizeRawData
     */
    normalizeRawData: {
        methodKind: "unary";
        input: typeof NormalizeRawDataRequestSchema;
        output: typeof NormalizeRawDataResponseSchema;
    };
    /**
     * Signal ingestion — persists newsletter/external signals to ingest.newsletter_signals hypertable
     *
     * @generated from rpc xstockstrat.ingest.v1.IngestService.IngestSignal
     */
    ingestSignal: {
        methodKind: "unary";
        input: typeof IngestSignalRequestSchema;
        output: typeof IngestSignalResponseSchema;
    };
    /**
     * Signal query — returns active signals filtered by source/symbol/direction and time window
     *
     * @generated from rpc xstockstrat.ingest.v1.IngestService.QuerySignals
     */
    querySignals: {
        methodKind: "unary";
        input: typeof QuerySignalsRequestSchema;
        output: typeof QuerySignalsResponseSchema;
    };
    /**
     * @generated from rpc xstockstrat.ingest.v1.IngestService.ListSignalSources
     */
    listSignalSources: {
        methodKind: "unary";
        input: typeof ListSignalSourcesRequestSchema;
        output: typeof ListSignalSourcesResponseSchema;
    };
    /**
     * @generated from rpc xstockstrat.ingest.v1.IngestService.ManageSignalSource
     */
    manageSignalSource: {
        methodKind: "unary";
        input: typeof ManageSignalSourceRequestSchema;
        output: typeof ManageSignalSourceResponseSchema;
    };
}>;

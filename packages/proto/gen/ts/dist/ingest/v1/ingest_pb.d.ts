import type { GenEnum, GenFile, GenMessage, GenService } from "@bufbuild/protobuf/codegenv2";
import type { FieldMask, Timestamp } from "@bufbuild/protobuf/wkt";
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
    /**
     * planned chunk count (FR-5)
     *
     * @generated from field: int32 chunks_total = 13;
     */
    chunksTotal: number;
    /**
     * chunks in COMPLETED state (FR-5)
     *
     * @generated from field: int32 chunks_completed = 14;
     */
    chunksCompleted: number;
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
    /**
     * FR-4; UNSPECIFIED == FULL. Independent of `overwrite`.
     *
     * @generated from field: xstockstrat.ingest.v1.FillMode fill_mode = 6;
     */
    fillMode: FillMode;
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
    /**
     * optional ticker filter (FR-3); empty = no narrowing
     *
     * @generated from field: string symbol = 3;
     */
    symbol: string;
};
/**
 * Describes the message xstockstrat.ingest.v1.ListBackfillJobsRequest.
 * Use `create(ListBackfillJobsRequestSchema)` to create a new message.
 */
export declare const ListBackfillJobsRequestSchema: GenMessage<ListBackfillJobsRequest>;
/**
 * @generated from message xstockstrat.ingest.v1.CancelBackfillRequest
 */
export type CancelBackfillRequest = Message<"xstockstrat.ingest.v1.CancelBackfillRequest"> & {
    /**
     * @generated from field: string job_id = 1;
     */
    jobId: string;
};
/**
 * Describes the message xstockstrat.ingest.v1.CancelBackfillRequest.
 * Use `create(CancelBackfillRequestSchema)` to create a new message.
 */
export declare const CancelBackfillRequestSchema: GenMessage<CancelBackfillRequest>;
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
    /**
     * platform ingestion time (server-set, immune to source timestamp manipulation) — feature 022
     *
     * @generated from field: google.protobuf.Timestamp ingested_at = 10;
     */
    ingestedAt?: Timestamp | undefined;
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
    /**
     * True when this submission matched an existing signal within the dedup window
     * (ingest.signals.dedup_window_hours) on (source, symbol, direction, conviction,
     * valid_until); signal_id is then the EXISTING signal's id, not a newly-inserted one.
     *
     * @generated from field: bool deduplicated = 2;
     */
    deduplicated: boolean;
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
    /**
     * ── Source-health fields (feature 083 — Engine → Signal sources) ─────────────
     * health is derived from last_seen_at freshness vs a staleness threshold.
     *
     * @generated from field: xstockstrat.ingest.v1.SourceHealthStatus health = 8;
     */
    health: SourceHealthStatus;
    /**
     * @generated from field: google.protobuf.Timestamp last_seen_at = 9;
     */
    lastSeenAt?: Timestamp | undefined;
    /**
     * @generated from field: string last_error = 10;
     */
    lastError: string;
    /**
     * @generated from field: int64 signals_fed = 11;
     */
    signalsFed: bigint;
    /**
     * reliability_weight ∈ [0.0, 1.0] — per-source ranking multiplier applied to signal
     * conviction (feature 134). optional (explicit presence) so an omitted create-form field is
     * distinguishable from an explicit 0.0. DB default 1.0 (neutral).
     *
     * @generated from field: optional double reliability_weight = 12;
     */
    reliabilityWeight?: number | undefined;
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
 * ManageSignalSourceRequest verbs (feature 088): prefer operation_enum; the string operation is kept
 * for back-compat and read only when operation_enum is UNSPECIFIED.
 * credentials_ref is processed on register/update; ignored on reactivate/deactivate. On a masked
 * update it is a virtual mask path: listed → apply (empty clears); unlisted → the stored ref is kept.
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
     * use operation_enum (feature 088)
     *
     * @generated from field: string operation = 3 [deprecated = true];
     * @deprecated
     */
    operation: string;
    /**
     * AIP-161 partial update (feature 088). Applies to UPDATE only; absent = full replace (back-compat).
     *
     * @generated from field: google.protobuf.FieldMask update_mask = 4;
     */
    updateMask?: FieldMask | undefined;
    /**
     * Preferred verb selector (feature 088); when set (!= UNSPECIFIED) it wins over the string operation.
     *
     * @generated from field: xstockstrat.ingest.v1.SignalSourceOperation operation_enum = 5;
     */
    operationEnum: SignalSourceOperation;
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
    PARTIAL = 5,
    /**
     * operator-canceled (FR-4); completed-chunk bars retained
     *
     * @generated from enum value: BACKFILL_STATUS_CANCELED = 6;
     */
    CANCELED = 6
}
/**
 * Describes the enum xstockstrat.ingest.v1.BackfillStatus.
 */
export declare const BackfillStatusSchema: GenEnum<BackfillStatus>;
/**
 * FillMode selects how much of the requested range a backfill fetches (feature 054, FR-4).
 *
 * @generated from enum xstockstrat.ingest.v1.FillMode
 */
export declare enum FillMode {
    /**
     * treated as FILL_MODE_FULL by the server
     *
     * @generated from enum value: FILL_MODE_UNSPECIFIED = 0;
     */
    UNSPECIFIED = 0,
    /**
     * fetch the entire requested range (current behavior)
     *
     * @generated from enum value: FILL_MODE_FULL = 1;
     */
    FULL = 1,
    /**
     * fetch only ranges missing per GetDataCoverage
     *
     * @generated from enum value: FILL_MODE_GAPS_ONLY = 2;
     */
    GAPS_ONLY = 2
}
/**
 * Describes the enum xstockstrat.ingest.v1.FillMode.
 */
export declare const FillModeSchema: GenEnum<FillMode>;
/**
 * Health of a registered signal source (feature 083). Closed set → enum (C-04).
 *
 * @generated from enum xstockstrat.ingest.v1.SourceHealthStatus
 */
export declare enum SourceHealthStatus {
    /**
     * @generated from enum value: SOURCE_HEALTH_STATUS_UNSPECIFIED = 0;
     */
    UNSPECIFIED = 0,
    /**
     * fed within the freshness window
     *
     * @generated from enum value: SOURCE_HEALTH_STATUS_LIVE = 1;
     */
    LIVE = 1,
    /**
     * last-seen beyond freshness, within the down threshold
     *
     * @generated from enum value: SOURCE_HEALTH_STATUS_STALE = 2;
     */
    STALE = 2,
    /**
     * no signal beyond the down threshold, or last op errored
     *
     * @generated from enum value: SOURCE_HEALTH_STATUS_DOWN = 3;
     */
    DOWN = 3
}
/**
 * Describes the enum xstockstrat.ingest.v1.SourceHealthStatus.
 */
export declare const SourceHealthStatusSchema: GenEnum<SourceHealthStatus>;
/**
 * Closed verb set for ManageSignalSource (feature 088). Closed set → enum (C-04).
 *
 * @generated from enum xstockstrat.ingest.v1.SignalSourceOperation
 */
export declare enum SignalSourceOperation {
    /**
     * @generated from enum value: SIGNAL_SOURCE_OPERATION_UNSPECIFIED = 0;
     */
    UNSPECIFIED = 0,
    /**
     * strict create: ALREADY_EXISTS on an existing slug
     *
     * @generated from enum value: SIGNAL_SOURCE_OPERATION_REGISTER = 1;
     */
    REGISTER = 1,
    /**
     * NOT_FOUND if missing; AIP-161 partial merge via update_mask
     *
     * @generated from enum value: SIGNAL_SOURCE_OPERATION_UPDATE = 2;
     */
    UPDATE = 2,
    /**
     * set active=TRUE; decoupled from update (RC-6)
     *
     * @generated from enum value: SIGNAL_SOURCE_OPERATION_REACTIVATE = 3;
     */
    REACTIVATE = 3,
    /**
     * set active=FALSE
     *
     * @generated from enum value: SIGNAL_SOURCE_OPERATION_DEACTIVATE = 4;
     */
    DEACTIVATE = 4
}
/**
 * Describes the enum xstockstrat.ingest.v1.SignalSourceOperation.
 */
export declare const SignalSourceOperationSchema: GenEnum<SignalSourceOperation>;
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
     * Cancel a QUEUED/RUNNING backfill job; returns the updated job (CANCELED). Completed-chunk bars are retained (FR-4).
     *
     * @generated from rpc xstockstrat.ingest.v1.IngestService.CancelBackfill
     */
    cancelBackfill: {
        methodKind: "unary";
        input: typeof CancelBackfillRequestSchema;
        output: typeof BackfillJobSchema;
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

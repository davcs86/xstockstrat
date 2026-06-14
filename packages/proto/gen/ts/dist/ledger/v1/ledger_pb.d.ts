import type { GenFile, GenMessage, GenService } from "@bufbuild/protobuf/codegenv2";
import type { Timestamp } from "@bufbuild/protobuf/wkt";
import type { PageRequest, PageResponse, TimeRange } from "../../common/v1/common_pb";
import type { JsonObject, Message } from "@bufbuild/protobuf";
/**
 * Describes the file ledger/v1/ledger.proto.
 */
export declare const file_ledger_v1_ledger: GenFile;
/**
 * @generated from message xstockstrat.ledger.v1.LedgerEvent
 */
export type LedgerEvent = Message<"xstockstrat.ledger.v1.LedgerEvent"> & {
    /**
     * UUID, server-assigned
     *
     * @generated from field: string event_id = 1;
     */
    eventId: string;
    /**
     * e.g. "order.created", "trade.filled"
     *
     * @generated from field: string event_type = 2;
     */
    eventType: string;
    /**
     * originating service name
     *
     * @generated from field: string source_service = 3;
     */
    sourceService: string;
    /**
     * trace/request correlation
     *
     * @generated from field: string correlation_id = 4;
     */
    correlationId: string;
    /**
     * @generated from field: google.protobuf.Timestamp occurred_at = 5;
     */
    occurredAt?: Timestamp | undefined;
    /**
     * server write time
     *
     * @generated from field: google.protobuf.Timestamp recorded_at = 6;
     */
    recordedAt?: Timestamp | undefined;
    /**
     * event body (JSON-like)
     *
     * @generated from field: google.protobuf.Struct payload = 7;
     */
    payload?: JsonObject | undefined;
    /**
     * @generated from field: map<string, string> metadata = 8;
     */
    metadata: {
        [key: string]: string;
    };
    /**
     * monotonically increasing per stream_key
     *
     * @generated from field: int64 sequence = 9;
     */
    sequence: bigint;
    /**
     * partition key (e.g. "order:uuid")
     *
     * @generated from field: string stream_key = 10;
     */
    streamKey: string;
};
/**
 * Describes the message xstockstrat.ledger.v1.LedgerEvent.
 * Use `create(LedgerEventSchema)` to create a new message.
 */
export declare const LedgerEventSchema: GenMessage<LedgerEvent>;
/**
 * @generated from message xstockstrat.ledger.v1.AppendEventRequest
 */
export type AppendEventRequest = Message<"xstockstrat.ledger.v1.AppendEventRequest"> & {
    /**
     * @generated from field: string event_type = 1;
     */
    eventType: string;
    /**
     * @generated from field: string source_service = 2;
     */
    sourceService: string;
    /**
     * @generated from field: string correlation_id = 3;
     */
    correlationId: string;
    /**
     * @generated from field: string stream_key = 4;
     */
    streamKey: string;
    /**
     * @generated from field: google.protobuf.Struct payload = 5;
     */
    payload?: JsonObject | undefined;
    /**
     * @generated from field: map<string, string> metadata = 6;
     */
    metadata: {
        [key: string]: string;
    };
    /**
     * @generated from field: google.protobuf.Timestamp occurred_at = 7;
     */
    occurredAt?: Timestamp | undefined;
    /**
     * Optional caller-supplied dedup key. When set, the ledger appends the event at most
     * once for this key: a retried AppendEvent (e.g. after a transient transport failure)
     * returns the originally-stored event instead of inserting a duplicate. Empty = no
     * dedup (every call inserts), preserving the prior behavior.
     *
     * @generated from field: string idempotency_key = 8;
     */
    idempotencyKey: string;
};
/**
 * Describes the message xstockstrat.ledger.v1.AppendEventRequest.
 * Use `create(AppendEventRequestSchema)` to create a new message.
 */
export declare const AppendEventRequestSchema: GenMessage<AppendEventRequest>;
/**
 * @generated from message xstockstrat.ledger.v1.AppendEventResponse
 */
export type AppendEventResponse = Message<"xstockstrat.ledger.v1.AppendEventResponse"> & {
    /**
     * @generated from field: string event_id = 1;
     */
    eventId: string;
    /**
     * @generated from field: int64 sequence = 2;
     */
    sequence: bigint;
    /**
     * @generated from field: google.protobuf.Timestamp recorded_at = 3;
     */
    recordedAt?: Timestamp | undefined;
};
/**
 * Describes the message xstockstrat.ledger.v1.AppendEventResponse.
 * Use `create(AppendEventResponseSchema)` to create a new message.
 */
export declare const AppendEventResponseSchema: GenMessage<AppendEventResponse>;
/**
 * @generated from message xstockstrat.ledger.v1.QueryEventsRequest
 */
export type QueryEventsRequest = Message<"xstockstrat.ledger.v1.QueryEventsRequest"> & {
    /**
     * optional filter
     *
     * @generated from field: string stream_key = 1;
     */
    streamKey: string;
    /**
     * optional filter
     *
     * @generated from field: string event_type = 2;
     */
    eventType: string;
    /**
     * optional filter
     *
     * @generated from field: string source_service = 3;
     */
    sourceService: string;
    /**
     * @generated from field: xstockstrat.common.v1.TimeRange time_range = 4;
     */
    timeRange?: TimeRange | undefined;
    /**
     * @generated from field: xstockstrat.common.v1.PageRequest page = 5;
     */
    page?: PageRequest | undefined;
    /**
     * replay from sequence
     *
     * @generated from field: int64 from_sequence = 6;
     */
    fromSequence: bigint;
};
/**
 * Describes the message xstockstrat.ledger.v1.QueryEventsRequest.
 * Use `create(QueryEventsRequestSchema)` to create a new message.
 */
export declare const QueryEventsRequestSchema: GenMessage<QueryEventsRequest>;
/**
 * @generated from message xstockstrat.ledger.v1.QueryEventsResponse
 */
export type QueryEventsResponse = Message<"xstockstrat.ledger.v1.QueryEventsResponse"> & {
    /**
     * @generated from field: repeated xstockstrat.ledger.v1.LedgerEvent events = 1;
     */
    events: LedgerEvent[];
    /**
     * @generated from field: xstockstrat.common.v1.PageResponse page = 2;
     */
    page?: PageResponse | undefined;
};
/**
 * Describes the message xstockstrat.ledger.v1.QueryEventsResponse.
 * Use `create(QueryEventsResponseSchema)` to create a new message.
 */
export declare const QueryEventsResponseSchema: GenMessage<QueryEventsResponse>;
/**
 * @generated from message xstockstrat.ledger.v1.StreamEventsRequest
 */
export type StreamEventsRequest = Message<"xstockstrat.ledger.v1.StreamEventsRequest"> & {
    /**
     * @generated from field: string stream_key = 1;
     */
    streamKey: string;
    /**
     * @generated from field: string event_type = 2;
     */
    eventType: string;
    /**
     * 0 = live tail, >0 = replay then tail
     *
     * @generated from field: int64 from_sequence = 3;
     */
    fromSequence: bigint;
};
/**
 * Describes the message xstockstrat.ledger.v1.StreamEventsRequest.
 * Use `create(StreamEventsRequestSchema)` to create a new message.
 */
export declare const StreamEventsRequestSchema: GenMessage<StreamEventsRequest>;
/**
 * @generated from message xstockstrat.ledger.v1.GetEventRequest
 */
export type GetEventRequest = Message<"xstockstrat.ledger.v1.GetEventRequest"> & {
    /**
     * @generated from field: string event_id = 1;
     */
    eventId: string;
};
/**
 * Describes the message xstockstrat.ledger.v1.GetEventRequest.
 * Use `create(GetEventRequestSchema)` to create a new message.
 */
export declare const GetEventRequestSchema: GenMessage<GetEventRequest>;
/**
 * LedgerService — append-only event store.
 * All services write events here. Events are immutable once written.
 *
 * @generated from service xstockstrat.ledger.v1.LedgerService
 */
export declare const LedgerService: GenService<{
    /**
     * @generated from rpc xstockstrat.ledger.v1.LedgerService.AppendEvent
     */
    appendEvent: {
        methodKind: "unary";
        input: typeof AppendEventRequestSchema;
        output: typeof AppendEventResponseSchema;
    };
    /**
     * @generated from rpc xstockstrat.ledger.v1.LedgerService.QueryEvents
     */
    queryEvents: {
        methodKind: "unary";
        input: typeof QueryEventsRequestSchema;
        output: typeof QueryEventsResponseSchema;
    };
    /**
     * @generated from rpc xstockstrat.ledger.v1.LedgerService.StreamEvents
     */
    streamEvents: {
        methodKind: "server_streaming";
        input: typeof StreamEventsRequestSchema;
        output: typeof LedgerEventSchema;
    };
    /**
     * @generated from rpc xstockstrat.ledger.v1.LedgerService.GetEvent
     */
    getEvent: {
        methodKind: "unary";
        input: typeof GetEventRequestSchema;
        output: typeof LedgerEventSchema;
    };
}>;

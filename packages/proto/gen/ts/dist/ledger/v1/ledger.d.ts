import { BinaryReader, BinaryWriter } from "@bufbuild/protobuf/wire";
import { type CallOptions, type ChannelCredentials, Client, type ClientOptions, type ClientReadableStream, type ClientUnaryCall, type handleServerStreamingCall, type handleUnaryCall, type Metadata, type ServiceError, type UntypedServiceImplementation } from "@grpc/grpc-js";
import { PageRequest, PageResponse, TimeRange } from "../../common/v1/common";
export declare const protobufPackage = "xstockstrat.ledger.v1";
export interface LedgerEvent {
    /** UUID, server-assigned */
    eventId: string;
    /** e.g. "order.created", "trade.filled" */
    eventType: string;
    /** originating service name */
    sourceService: string;
    /** trace/request correlation */
    correlationId: string;
    occurredAt?: Date | undefined;
    /** server write time */
    recordedAt?: Date | undefined;
    /** event body (JSON-like) */
    payload?: {
        [key: string]: any;
    } | undefined;
    metadata: {
        [key: string]: string;
    };
    /** monotonically increasing per stream_key */
    sequence: number;
    /** partition key (e.g. "order:uuid") */
    streamKey: string;
}
export interface LedgerEvent_MetadataEntry {
    key: string;
    value: string;
}
export interface AppendEventRequest {
    eventType: string;
    sourceService: string;
    correlationId: string;
    streamKey: string;
    payload?: {
        [key: string]: any;
    } | undefined;
    metadata: {
        [key: string]: string;
    };
    occurredAt?: Date | undefined;
}
export interface AppendEventRequest_MetadataEntry {
    key: string;
    value: string;
}
export interface AppendEventResponse {
    eventId: string;
    sequence: number;
    recordedAt?: Date | undefined;
}
export interface QueryEventsRequest {
    /** optional filter */
    streamKey: string;
    /** optional filter */
    eventType: string;
    /** optional filter */
    sourceService: string;
    timeRange?: TimeRange | undefined;
    page?: PageRequest | undefined;
    /** replay from sequence */
    fromSequence: number;
}
export interface QueryEventsResponse {
    events: LedgerEvent[];
    page?: PageResponse | undefined;
}
export interface StreamEventsRequest {
    streamKey: string;
    eventType: string;
    /** 0 = live tail, >0 = replay then tail */
    fromSequence: number;
}
export interface GetEventRequest {
    eventId: string;
}
export declare const LedgerEvent: MessageFns<LedgerEvent>;
export declare const LedgerEvent_MetadataEntry: MessageFns<LedgerEvent_MetadataEntry>;
export declare const AppendEventRequest: MessageFns<AppendEventRequest>;
export declare const AppendEventRequest_MetadataEntry: MessageFns<AppendEventRequest_MetadataEntry>;
export declare const AppendEventResponse: MessageFns<AppendEventResponse>;
export declare const QueryEventsRequest: MessageFns<QueryEventsRequest>;
export declare const QueryEventsResponse: MessageFns<QueryEventsResponse>;
export declare const StreamEventsRequest: MessageFns<StreamEventsRequest>;
export declare const GetEventRequest: MessageFns<GetEventRequest>;
/**
 * LedgerService — append-only event store.
 * All services write events here. Events are immutable once written.
 */
export type LedgerServiceService = typeof LedgerServiceService;
export declare const LedgerServiceService: {
    readonly appendEvent: {
        readonly path: "/xstockstrat.ledger.v1.LedgerService/AppendEvent";
        readonly requestStream: false;
        readonly responseStream: false;
        readonly requestSerialize: (value: AppendEventRequest) => Buffer;
        readonly requestDeserialize: (value: Buffer) => AppendEventRequest;
        readonly responseSerialize: (value: AppendEventResponse) => Buffer;
        readonly responseDeserialize: (value: Buffer) => AppendEventResponse;
    };
    readonly queryEvents: {
        readonly path: "/xstockstrat.ledger.v1.LedgerService/QueryEvents";
        readonly requestStream: false;
        readonly responseStream: false;
        readonly requestSerialize: (value: QueryEventsRequest) => Buffer;
        readonly requestDeserialize: (value: Buffer) => QueryEventsRequest;
        readonly responseSerialize: (value: QueryEventsResponse) => Buffer;
        readonly responseDeserialize: (value: Buffer) => QueryEventsResponse;
    };
    readonly streamEvents: {
        readonly path: "/xstockstrat.ledger.v1.LedgerService/StreamEvents";
        readonly requestStream: false;
        readonly responseStream: true;
        readonly requestSerialize: (value: StreamEventsRequest) => Buffer;
        readonly requestDeserialize: (value: Buffer) => StreamEventsRequest;
        readonly responseSerialize: (value: LedgerEvent) => Buffer;
        readonly responseDeserialize: (value: Buffer) => LedgerEvent;
    };
    readonly getEvent: {
        readonly path: "/xstockstrat.ledger.v1.LedgerService/GetEvent";
        readonly requestStream: false;
        readonly responseStream: false;
        readonly requestSerialize: (value: GetEventRequest) => Buffer;
        readonly requestDeserialize: (value: Buffer) => GetEventRequest;
        readonly responseSerialize: (value: LedgerEvent) => Buffer;
        readonly responseDeserialize: (value: Buffer) => LedgerEvent;
    };
};
export interface LedgerServiceServer extends UntypedServiceImplementation {
    appendEvent: handleUnaryCall<AppendEventRequest, AppendEventResponse>;
    queryEvents: handleUnaryCall<QueryEventsRequest, QueryEventsResponse>;
    streamEvents: handleServerStreamingCall<StreamEventsRequest, LedgerEvent>;
    getEvent: handleUnaryCall<GetEventRequest, LedgerEvent>;
}
export interface LedgerServiceClient extends Client {
    appendEvent(request: AppendEventRequest, callback: (error: ServiceError | null, response: AppendEventResponse) => void): ClientUnaryCall;
    appendEvent(request: AppendEventRequest, metadata: Metadata, callback: (error: ServiceError | null, response: AppendEventResponse) => void): ClientUnaryCall;
    appendEvent(request: AppendEventRequest, metadata: Metadata, options: Partial<CallOptions>, callback: (error: ServiceError | null, response: AppendEventResponse) => void): ClientUnaryCall;
    queryEvents(request: QueryEventsRequest, callback: (error: ServiceError | null, response: QueryEventsResponse) => void): ClientUnaryCall;
    queryEvents(request: QueryEventsRequest, metadata: Metadata, callback: (error: ServiceError | null, response: QueryEventsResponse) => void): ClientUnaryCall;
    queryEvents(request: QueryEventsRequest, metadata: Metadata, options: Partial<CallOptions>, callback: (error: ServiceError | null, response: QueryEventsResponse) => void): ClientUnaryCall;
    streamEvents(request: StreamEventsRequest, options?: Partial<CallOptions>): ClientReadableStream<LedgerEvent>;
    streamEvents(request: StreamEventsRequest, metadata?: Metadata, options?: Partial<CallOptions>): ClientReadableStream<LedgerEvent>;
    getEvent(request: GetEventRequest, callback: (error: ServiceError | null, response: LedgerEvent) => void): ClientUnaryCall;
    getEvent(request: GetEventRequest, metadata: Metadata, callback: (error: ServiceError | null, response: LedgerEvent) => void): ClientUnaryCall;
    getEvent(request: GetEventRequest, metadata: Metadata, options: Partial<CallOptions>, callback: (error: ServiceError | null, response: LedgerEvent) => void): ClientUnaryCall;
}
export declare const LedgerServiceClient: {
    new (address: string, credentials: ChannelCredentials, options?: Partial<ClientOptions>): LedgerServiceClient;
    service: typeof LedgerServiceService;
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

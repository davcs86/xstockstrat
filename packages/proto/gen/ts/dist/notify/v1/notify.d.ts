import { BinaryReader, BinaryWriter } from "@bufbuild/protobuf/wire";
import { type CallOptions, type ChannelCredentials, Client, type ClientOptions, type ClientReadableStream, type ClientUnaryCall, type handleServerStreamingCall, type handleUnaryCall, type Metadata, type ServiceError, type UntypedServiceImplementation } from "@grpc/grpc-js";
export declare const protobufPackage = "xstockstrat.notify.v1";
export declare enum AlertSeverity {
    ALERT_SEVERITY_UNSPECIFIED = "ALERT_SEVERITY_UNSPECIFIED",
    ALERT_SEVERITY_INFO = "ALERT_SEVERITY_INFO",
    ALERT_SEVERITY_WARNING = "ALERT_SEVERITY_WARNING",
    ALERT_SEVERITY_ERROR = "ALERT_SEVERITY_ERROR",
    ALERT_SEVERITY_CRITICAL = "ALERT_SEVERITY_CRITICAL",
    UNRECOGNIZED = "UNRECOGNIZED"
}
export declare function alertSeverityFromJSON(object: any): AlertSeverity;
export declare function alertSeverityToJSON(object: AlertSeverity): string;
export declare function alertSeverityToNumber(object: AlertSeverity): number;
export interface Alert {
    alertId: string;
    severity: AlertSeverity;
    /** e.g. "trade", "risk", "system", "indicator" */
    category: string;
    title: string;
    body: string;
    sourceService: string;
    /** empty = broadcast */
    targetUserId: string;
    createdAt?: Date | undefined;
    /** arbitrary structured context */
    context?: {
        [key: string]: any;
    } | undefined;
    tags: string[];
    acknowledged: boolean;
    correlationId: string;
}
export interface EmitAlertRequest {
    severity: AlertSeverity;
    category: string;
    title: string;
    body: string;
    sourceService: string;
    targetUserId: string;
    context?: {
        [key: string]: any;
    } | undefined;
    tags: string[];
    correlationId: string;
}
export interface EmitAlertResponse {
    alertId: string;
    createdAt?: Date | undefined;
}
export interface StreamAlertsRequest {
    /** filter by user; empty = all */
    userId: string;
    /** filter by category; empty = all */
    categories: string[];
    /** filter by severity; empty = all */
    severities: AlertSeverity[];
    includeAcknowledged: boolean;
}
export interface AcknowledgeAlertRequest {
    alertId: string;
    userId: string;
}
export interface AcknowledgeAlertResponse {
    success: boolean;
}
export interface ListAlertsRequest {
    userId: string;
    categories: string[];
    limit: number;
    pageToken: string;
}
export interface ListAlertsResponse {
    alerts: Alert[];
    nextPageToken: string;
}
export declare const Alert: MessageFns<Alert>;
export declare const EmitAlertRequest: MessageFns<EmitAlertRequest>;
export declare const EmitAlertResponse: MessageFns<EmitAlertResponse>;
export declare const StreamAlertsRequest: MessageFns<StreamAlertsRequest>;
export declare const AcknowledgeAlertRequest: MessageFns<AcknowledgeAlertRequest>;
export declare const AcknowledgeAlertResponse: MessageFns<AcknowledgeAlertResponse>;
export declare const ListAlertsRequest: MessageFns<ListAlertsRequest>;
export declare const ListAlertsResponse: MessageFns<ListAlertsResponse>;
/**
 * NotifyService — gRPC server-streaming alert delivery.
 * Services emit alerts via EmitAlert; subscribers receive via StreamAlerts.
 */
export type NotifyServiceService = typeof NotifyServiceService;
export declare const NotifyServiceService: {
    /** Emit an alert from any service */
    readonly emitAlert: {
        readonly path: "/xstockstrat.notify.v1.NotifyService/EmitAlert";
        readonly requestStream: false;
        readonly responseStream: false;
        readonly requestSerialize: (value: EmitAlertRequest) => Buffer;
        readonly requestDeserialize: (value: Buffer) => EmitAlertRequest;
        readonly responseSerialize: (value: EmitAlertResponse) => Buffer;
        readonly responseDeserialize: (value: Buffer) => EmitAlertResponse;
    };
    /**
     * Server-streaming: subscribe to alerts matching filters
     * Server pushes alerts as they arrive — connection is long-lived
     */
    readonly streamAlerts: {
        readonly path: "/xstockstrat.notify.v1.NotifyService/StreamAlerts";
        readonly requestStream: false;
        readonly responseStream: true;
        readonly requestSerialize: (value: StreamAlertsRequest) => Buffer;
        readonly requestDeserialize: (value: Buffer) => StreamAlertsRequest;
        readonly responseSerialize: (value: Alert) => Buffer;
        readonly responseDeserialize: (value: Buffer) => Alert;
    };
    /** Acknowledge receipt of alert */
    readonly acknowledgeAlert: {
        readonly path: "/xstockstrat.notify.v1.NotifyService/AcknowledgeAlert";
        readonly requestStream: false;
        readonly responseStream: false;
        readonly requestSerialize: (value: AcknowledgeAlertRequest) => Buffer;
        readonly requestDeserialize: (value: Buffer) => AcknowledgeAlertRequest;
        readonly responseSerialize: (value: AcknowledgeAlertResponse) => Buffer;
        readonly responseDeserialize: (value: Buffer) => AcknowledgeAlertResponse;
    };
    /** List historical alerts */
    readonly listAlerts: {
        readonly path: "/xstockstrat.notify.v1.NotifyService/ListAlerts";
        readonly requestStream: false;
        readonly responseStream: false;
        readonly requestSerialize: (value: ListAlertsRequest) => Buffer;
        readonly requestDeserialize: (value: Buffer) => ListAlertsRequest;
        readonly responseSerialize: (value: ListAlertsResponse) => Buffer;
        readonly responseDeserialize: (value: Buffer) => ListAlertsResponse;
    };
};
export interface NotifyServiceServer extends UntypedServiceImplementation {
    /** Emit an alert from any service */
    emitAlert: handleUnaryCall<EmitAlertRequest, EmitAlertResponse>;
    /**
     * Server-streaming: subscribe to alerts matching filters
     * Server pushes alerts as they arrive — connection is long-lived
     */
    streamAlerts: handleServerStreamingCall<StreamAlertsRequest, Alert>;
    /** Acknowledge receipt of alert */
    acknowledgeAlert: handleUnaryCall<AcknowledgeAlertRequest, AcknowledgeAlertResponse>;
    /** List historical alerts */
    listAlerts: handleUnaryCall<ListAlertsRequest, ListAlertsResponse>;
}
export interface NotifyServiceClient extends Client {
    /** Emit an alert from any service */
    emitAlert(request: EmitAlertRequest, callback: (error: ServiceError | null, response: EmitAlertResponse) => void): ClientUnaryCall;
    emitAlert(request: EmitAlertRequest, metadata: Metadata, callback: (error: ServiceError | null, response: EmitAlertResponse) => void): ClientUnaryCall;
    emitAlert(request: EmitAlertRequest, metadata: Metadata, options: Partial<CallOptions>, callback: (error: ServiceError | null, response: EmitAlertResponse) => void): ClientUnaryCall;
    /**
     * Server-streaming: subscribe to alerts matching filters
     * Server pushes alerts as they arrive — connection is long-lived
     */
    streamAlerts(request: StreamAlertsRequest, options?: Partial<CallOptions>): ClientReadableStream<Alert>;
    streamAlerts(request: StreamAlertsRequest, metadata?: Metadata, options?: Partial<CallOptions>): ClientReadableStream<Alert>;
    /** Acknowledge receipt of alert */
    acknowledgeAlert(request: AcknowledgeAlertRequest, callback: (error: ServiceError | null, response: AcknowledgeAlertResponse) => void): ClientUnaryCall;
    acknowledgeAlert(request: AcknowledgeAlertRequest, metadata: Metadata, callback: (error: ServiceError | null, response: AcknowledgeAlertResponse) => void): ClientUnaryCall;
    acknowledgeAlert(request: AcknowledgeAlertRequest, metadata: Metadata, options: Partial<CallOptions>, callback: (error: ServiceError | null, response: AcknowledgeAlertResponse) => void): ClientUnaryCall;
    /** List historical alerts */
    listAlerts(request: ListAlertsRequest, callback: (error: ServiceError | null, response: ListAlertsResponse) => void): ClientUnaryCall;
    listAlerts(request: ListAlertsRequest, metadata: Metadata, callback: (error: ServiceError | null, response: ListAlertsResponse) => void): ClientUnaryCall;
    listAlerts(request: ListAlertsRequest, metadata: Metadata, options: Partial<CallOptions>, callback: (error: ServiceError | null, response: ListAlertsResponse) => void): ClientUnaryCall;
}
export declare const NotifyServiceClient: {
    new (address: string, credentials: ChannelCredentials, options?: Partial<ClientOptions>): NotifyServiceClient;
    service: typeof NotifyServiceService;
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

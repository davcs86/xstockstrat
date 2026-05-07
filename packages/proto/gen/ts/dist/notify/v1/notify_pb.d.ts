import type { GenEnum, GenFile, GenMessage, GenService } from "@bufbuild/protobuf/codegenv2";
import type { Timestamp } from "@bufbuild/protobuf/wkt";
import type { JsonObject, Message } from "@bufbuild/protobuf";
/**
 * Describes the file notify/v1/notify.proto.
 */
export declare const file_notify_v1_notify: GenFile;
/**
 * @generated from message xstockstrat.notify.v1.Alert
 */
export type Alert = Message<"xstockstrat.notify.v1.Alert"> & {
    /**
     * @generated from field: string alert_id = 1;
     */
    alertId: string;
    /**
     * @generated from field: xstockstrat.notify.v1.AlertSeverity severity = 2;
     */
    severity: AlertSeverity;
    /**
     * e.g. "trade", "risk", "system", "indicator"
     *
     * @generated from field: string category = 3;
     */
    category: string;
    /**
     * @generated from field: string title = 4;
     */
    title: string;
    /**
     * @generated from field: string body = 5;
     */
    body: string;
    /**
     * @generated from field: string source_service = 6;
     */
    sourceService: string;
    /**
     * empty = broadcast
     *
     * @generated from field: string target_user_id = 7;
     */
    targetUserId: string;
    /**
     * @generated from field: google.protobuf.Timestamp created_at = 8;
     */
    createdAt?: Timestamp | undefined;
    /**
     * arbitrary structured context
     *
     * @generated from field: google.protobuf.Struct context = 9;
     */
    context?: JsonObject | undefined;
    /**
     * @generated from field: repeated string tags = 10;
     */
    tags: string[];
    /**
     * @generated from field: bool acknowledged = 11;
     */
    acknowledged: boolean;
    /**
     * @generated from field: string correlation_id = 12;
     */
    correlationId: string;
};
/**
 * Describes the message xstockstrat.notify.v1.Alert.
 * Use `create(AlertSchema)` to create a new message.
 */
export declare const AlertSchema: GenMessage<Alert>;
/**
 * @generated from message xstockstrat.notify.v1.EmitAlertRequest
 */
export type EmitAlertRequest = Message<"xstockstrat.notify.v1.EmitAlertRequest"> & {
    /**
     * @generated from field: xstockstrat.notify.v1.AlertSeverity severity = 1;
     */
    severity: AlertSeverity;
    /**
     * @generated from field: string category = 2;
     */
    category: string;
    /**
     * @generated from field: string title = 3;
     */
    title: string;
    /**
     * @generated from field: string body = 4;
     */
    body: string;
    /**
     * @generated from field: string source_service = 5;
     */
    sourceService: string;
    /**
     * @generated from field: string target_user_id = 6;
     */
    targetUserId: string;
    /**
     * @generated from field: google.protobuf.Struct context = 7;
     */
    context?: JsonObject | undefined;
    /**
     * @generated from field: repeated string tags = 8;
     */
    tags: string[];
    /**
     * @generated from field: string correlation_id = 9;
     */
    correlationId: string;
};
/**
 * Describes the message xstockstrat.notify.v1.EmitAlertRequest.
 * Use `create(EmitAlertRequestSchema)` to create a new message.
 */
export declare const EmitAlertRequestSchema: GenMessage<EmitAlertRequest>;
/**
 * @generated from message xstockstrat.notify.v1.EmitAlertResponse
 */
export type EmitAlertResponse = Message<"xstockstrat.notify.v1.EmitAlertResponse"> & {
    /**
     * @generated from field: string alert_id = 1;
     */
    alertId: string;
    /**
     * @generated from field: google.protobuf.Timestamp created_at = 2;
     */
    createdAt?: Timestamp | undefined;
};
/**
 * Describes the message xstockstrat.notify.v1.EmitAlertResponse.
 * Use `create(EmitAlertResponseSchema)` to create a new message.
 */
export declare const EmitAlertResponseSchema: GenMessage<EmitAlertResponse>;
/**
 * @generated from message xstockstrat.notify.v1.StreamAlertsRequest
 */
export type StreamAlertsRequest = Message<"xstockstrat.notify.v1.StreamAlertsRequest"> & {
    /**
     * filter by user; empty = all
     *
     * @generated from field: string user_id = 1;
     */
    userId: string;
    /**
     * filter by category; empty = all
     *
     * @generated from field: repeated string categories = 2;
     */
    categories: string[];
    /**
     * filter by severity; empty = all
     *
     * @generated from field: repeated xstockstrat.notify.v1.AlertSeverity severities = 3;
     */
    severities: AlertSeverity[];
    /**
     * @generated from field: bool include_acknowledged = 4;
     */
    includeAcknowledged: boolean;
};
/**
 * Describes the message xstockstrat.notify.v1.StreamAlertsRequest.
 * Use `create(StreamAlertsRequestSchema)` to create a new message.
 */
export declare const StreamAlertsRequestSchema: GenMessage<StreamAlertsRequest>;
/**
 * @generated from message xstockstrat.notify.v1.AcknowledgeAlertRequest
 */
export type AcknowledgeAlertRequest = Message<"xstockstrat.notify.v1.AcknowledgeAlertRequest"> & {
    /**
     * @generated from field: string alert_id = 1;
     */
    alertId: string;
    /**
     * @generated from field: string user_id = 2;
     */
    userId: string;
};
/**
 * Describes the message xstockstrat.notify.v1.AcknowledgeAlertRequest.
 * Use `create(AcknowledgeAlertRequestSchema)` to create a new message.
 */
export declare const AcknowledgeAlertRequestSchema: GenMessage<AcknowledgeAlertRequest>;
/**
 * @generated from message xstockstrat.notify.v1.AcknowledgeAlertResponse
 */
export type AcknowledgeAlertResponse = Message<"xstockstrat.notify.v1.AcknowledgeAlertResponse"> & {
    /**
     * @generated from field: bool success = 1;
     */
    success: boolean;
};
/**
 * Describes the message xstockstrat.notify.v1.AcknowledgeAlertResponse.
 * Use `create(AcknowledgeAlertResponseSchema)` to create a new message.
 */
export declare const AcknowledgeAlertResponseSchema: GenMessage<AcknowledgeAlertResponse>;
/**
 * @generated from message xstockstrat.notify.v1.ListAlertsRequest
 */
export type ListAlertsRequest = Message<"xstockstrat.notify.v1.ListAlertsRequest"> & {
    /**
     * @generated from field: string user_id = 1;
     */
    userId: string;
    /**
     * @generated from field: repeated string categories = 2;
     */
    categories: string[];
    /**
     * @generated from field: int32 limit = 3;
     */
    limit: number;
    /**
     * @generated from field: string page_token = 4;
     */
    pageToken: string;
};
/**
 * Describes the message xstockstrat.notify.v1.ListAlertsRequest.
 * Use `create(ListAlertsRequestSchema)` to create a new message.
 */
export declare const ListAlertsRequestSchema: GenMessage<ListAlertsRequest>;
/**
 * @generated from message xstockstrat.notify.v1.ListAlertsResponse
 */
export type ListAlertsResponse = Message<"xstockstrat.notify.v1.ListAlertsResponse"> & {
    /**
     * @generated from field: repeated xstockstrat.notify.v1.Alert alerts = 1;
     */
    alerts: Alert[];
    /**
     * @generated from field: string next_page_token = 2;
     */
    nextPageToken: string;
};
/**
 * Describes the message xstockstrat.notify.v1.ListAlertsResponse.
 * Use `create(ListAlertsResponseSchema)` to create a new message.
 */
export declare const ListAlertsResponseSchema: GenMessage<ListAlertsResponse>;
/**
 * @generated from enum xstockstrat.notify.v1.AlertSeverity
 */
export declare enum AlertSeverity {
    /**
     * @generated from enum value: ALERT_SEVERITY_UNSPECIFIED = 0;
     */
    UNSPECIFIED = 0,
    /**
     * @generated from enum value: ALERT_SEVERITY_INFO = 1;
     */
    INFO = 1,
    /**
     * @generated from enum value: ALERT_SEVERITY_WARNING = 2;
     */
    WARNING = 2,
    /**
     * @generated from enum value: ALERT_SEVERITY_ERROR = 3;
     */
    ERROR = 3,
    /**
     * @generated from enum value: ALERT_SEVERITY_CRITICAL = 4;
     */
    CRITICAL = 4
}
/**
 * Describes the enum xstockstrat.notify.v1.AlertSeverity.
 */
export declare const AlertSeveritySchema: GenEnum<AlertSeverity>;
/**
 * NotifyService — gRPC server-streaming alert delivery.
 * Services emit alerts via EmitAlert; subscribers receive via StreamAlerts.
 *
 * @generated from service xstockstrat.notify.v1.NotifyService
 */
export declare const NotifyService: GenService<{
    /**
     * Emit an alert from any service
     *
     * @generated from rpc xstockstrat.notify.v1.NotifyService.EmitAlert
     */
    emitAlert: {
        methodKind: "unary";
        input: typeof EmitAlertRequestSchema;
        output: typeof EmitAlertResponseSchema;
    };
    /**
     * Server-streaming: subscribe to alerts matching filters
     * Server pushes alerts as they arrive — connection is long-lived
     *
     * @generated from rpc xstockstrat.notify.v1.NotifyService.StreamAlerts
     */
    streamAlerts: {
        methodKind: "server_streaming";
        input: typeof StreamAlertsRequestSchema;
        output: typeof AlertSchema;
    };
    /**
     * Acknowledge receipt of alert
     *
     * @generated from rpc xstockstrat.notify.v1.NotifyService.AcknowledgeAlert
     */
    acknowledgeAlert: {
        methodKind: "unary";
        input: typeof AcknowledgeAlertRequestSchema;
        output: typeof AcknowledgeAlertResponseSchema;
    };
    /**
     * List historical alerts
     *
     * @generated from rpc xstockstrat.notify.v1.NotifyService.ListAlerts
     */
    listAlerts: {
        methodKind: "unary";
        input: typeof ListAlertsRequestSchema;
        output: typeof ListAlertsResponseSchema;
    };
}>;

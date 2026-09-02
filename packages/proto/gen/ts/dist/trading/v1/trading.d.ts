import { BinaryReader, BinaryWriter } from "@bufbuild/protobuf/wire";
import { type CallOptions, type ChannelCredentials, Client, type ClientOptions, type ClientReadableStream, type ClientUnaryCall, type handleServerStreamingCall, type handleUnaryCall, type Metadata, type ServiceError, type UntypedServiceImplementation } from "@grpc/grpc-js";
import { BrokerType, PageRequest, PageResponse, TimeRange, TradingMode } from "../../common/v1/common";
export declare const protobufPackage = "xstockstrat.trading.v1";
export declare enum OrderSide {
    ORDER_SIDE_UNSPECIFIED = "ORDER_SIDE_UNSPECIFIED",
    ORDER_SIDE_BUY = "ORDER_SIDE_BUY",
    ORDER_SIDE_SELL = "ORDER_SIDE_SELL",
    UNRECOGNIZED = "UNRECOGNIZED"
}
export declare function orderSideFromJSON(object: any): OrderSide;
export declare function orderSideToJSON(object: OrderSide): string;
export declare function orderSideToNumber(object: OrderSide): number;
export declare enum OrderType {
    ORDER_TYPE_UNSPECIFIED = "ORDER_TYPE_UNSPECIFIED",
    ORDER_TYPE_MARKET = "ORDER_TYPE_MARKET",
    ORDER_TYPE_LIMIT = "ORDER_TYPE_LIMIT",
    ORDER_TYPE_STOP = "ORDER_TYPE_STOP",
    ORDER_TYPE_STOP_LIMIT = "ORDER_TYPE_STOP_LIMIT",
    ORDER_TYPE_TRAILING_STOP = "ORDER_TYPE_TRAILING_STOP",
    UNRECOGNIZED = "UNRECOGNIZED"
}
export declare function orderTypeFromJSON(object: any): OrderType;
export declare function orderTypeToJSON(object: OrderType): string;
export declare function orderTypeToNumber(object: OrderType): number;
export declare enum OrderStatus {
    ORDER_STATUS_UNSPECIFIED = "ORDER_STATUS_UNSPECIFIED",
    ORDER_STATUS_NEW = "ORDER_STATUS_NEW",
    ORDER_STATUS_PARTIALLY_FILLED = "ORDER_STATUS_PARTIALLY_FILLED",
    ORDER_STATUS_FILLED = "ORDER_STATUS_FILLED",
    ORDER_STATUS_CANCELED = "ORDER_STATUS_CANCELED",
    ORDER_STATUS_EXPIRED = "ORDER_STATUS_EXPIRED",
    ORDER_STATUS_REJECTED = "ORDER_STATUS_REJECTED",
    ORDER_STATUS_PENDING_APPROVAL = "ORDER_STATUS_PENDING_APPROVAL",
    UNRECOGNIZED = "UNRECOGNIZED"
}
export declare function orderStatusFromJSON(object: any): OrderStatus;
export declare function orderStatusToJSON(object: OrderStatus): string;
export declare function orderStatusToNumber(object: OrderStatus): number;
/**
 * CredentialStatus reflects the last known health of a broker account's stored
 * API credentials, so the UI can surface accounts whose secrets stopped working.
 */
export declare enum CredentialStatus {
    /** CREDENTIAL_STATUS_UNSPECIFIED - never validated yet */
    CREDENTIAL_STATUS_UNSPECIFIED = "CREDENTIAL_STATUS_UNSPECIFIED",
    /** CREDENTIAL_STATUS_OK - last validation succeeded */
    CREDENTIAL_STATUS_OK = "CREDENTIAL_STATUS_OK",
    /** CREDENTIAL_STATUS_INVALID - broker rejected the credentials (auth failure) */
    CREDENTIAL_STATUS_INVALID = "CREDENTIAL_STATUS_INVALID",
    /** CREDENTIAL_STATUS_UNKNOWN - validation could not complete (transient/network error) */
    CREDENTIAL_STATUS_UNKNOWN = "CREDENTIAL_STATUS_UNKNOWN",
    UNRECOGNIZED = "UNRECOGNIZED"
}
export declare function credentialStatusFromJSON(object: any): CredentialStatus;
export declare function credentialStatusToJSON(object: CredentialStatus): string;
export declare function credentialStatusToNumber(object: CredentialStatus): number;
/**
 * IntentState is the platform's own knowledge of whether a PlaceOrder/ReplaceOrder/
 * CancelOrder command actually reached the broker — orthogonal to OrderStatus (an order
 * can be NEW and also UNKNOWN simultaneously). See docs/roadmap/features/101-exactly-once-order-intent/design.md.
 */
export declare enum IntentState {
    INTENT_STATE_UNSPECIFIED = "INTENT_STATE_UNSPECIFIED",
    /** INTENT_STATE_PENDING - intent recorded, broker call not yet resolved */
    INTENT_STATE_PENDING = "INTENT_STATE_PENDING",
    /** INTENT_STATE_COMPLETED - broker call resolved (accepted or a definite rejection) */
    INTENT_STATE_COMPLETED = "INTENT_STATE_COMPLETED",
    /** INTENT_STATE_REJECTED - definite, synchronous broker rejection (not a timeout) */
    INTENT_STATE_REJECTED = "INTENT_STATE_REJECTED",
    /** INTENT_STATE_UNKNOWN - broker outcome unknown — never retried automatically (FR-5) */
    INTENT_STATE_UNKNOWN = "INTENT_STATE_UNKNOWN",
    UNRECOGNIZED = "UNRECOGNIZED"
}
export declare function intentStateFromJSON(object: any): IntentState;
export declare function intentStateToJSON(object: IntentState): string;
export declare function intentStateToNumber(object: IntentState): number;
/**
 * HaltSource distinguishes which automated mechanism halted an account — 030's
 * bracket-protection flatten failure vs. 102's broker-state-reconciliation mismatch — so an
 * operator (and the /trader UI) can tell which one fired without guessing from halt_reason's
 * free text alone.
 */
export declare enum HaltSource {
    HALT_SOURCE_UNSPECIFIED = "HALT_SOURCE_UNSPECIFIED",
    /** HALT_SOURCE_BRACKET_PROTECTION - 030 */
    HALT_SOURCE_BRACKET_PROTECTION = "HALT_SOURCE_BRACKET_PROTECTION",
    /** HALT_SOURCE_RECONCILIATION - 102 */
    HALT_SOURCE_RECONCILIATION = "HALT_SOURCE_RECONCILIATION",
    UNRECOGNIZED = "UNRECOGNIZED"
}
export declare function haltSourceFromJSON(object: any): HaltSource;
export declare function haltSourceToJSON(object: HaltSource): string;
export declare function haltSourceToNumber(object: HaltSource): number;
export interface Order {
    orderId: string;
    clientOrderId: string;
    symbol: string;
    side: OrderSide;
    orderType: OrderType;
    status: OrderStatus;
    qty: number;
    filledQty: number;
    limitPrice: number;
    stopPrice: number;
    filledAvgPrice: number;
    timeInForce: string;
    createdAt?: Date | undefined;
    updatedAt?: Date | undefined;
    strategyId: string;
    userId: string;
    tradingMode: TradingMode;
    /** Alpaca-assigned order ID, populated after broker submission */
    brokerOrderId: string;
    accountId: string;
    brokerType: BrokerType;
    /** intent_state is set by every write path and read via a cross-intent LATERAL join on other reads; see design.md. */
    intentState: IntentState;
    /**
     * filled_at is the confirmed/observed fill time: broker fills use the broker's timestamp;
     * offline confirmations (feature 157) use the operator-supplied time (server-defaulted to now
     * when unset). NULL for a NEW/unconfirmed order and every historical order.
     */
    filledAt?: Date | undefined;
}
export interface PlaceOrderRequest {
    symbol: string;
    side: OrderSide;
    orderType: OrderType;
    qty: number;
    limitPrice: number;
    stopPrice: number;
    timeInForce: string;
    strategyId: string;
    /**
     * DEPRECATED: order owner resolved from the x-user-id header; body value ignored.
     *
     * @deprecated
     */
    userId: string;
    /**
     * client_order_id is required: a stable client-generated nonce reused across retries of
     * the same logical place-order action (see the /trader Place Order form's nonce generator).
     * Empty is rejected with InvalidArgument. Used as the order-intent dedup key (feature 101).
     */
    clientOrderId: string;
    requiresApproval: boolean;
    /** If UNSPECIFIED, the service uses trading.broker.paper config key to determine mode. */
    tradingMode: TradingMode;
    /**
     * account_id routes the order to a specific broker account.
     * Required when multiple accounts are registered; optional when only one exists.
     */
    accountId: string;
    /**
     * Trailing-stop parameters. Exactly one of trail_price (dollar offset) or
     * trail_percent (percent offset) is required when order_type is
     * ORDER_TYPE_TRAILING_STOP; both must be zero for any other order type.
     */
    trailPrice: number;
    trailPercent: number;
    /**
     * Signal confidence 0.0-1.0 for automatic position sizing (see ComputePositionSize). Unset →
     * confidence=1.0 (full size); explicit 0.0 → size to zero; out-of-range → InvalidArgument.
     */
    confidence?: number | undefined;
}
export interface CancelOrderRequest {
    orderId: string;
    /**
     * DEPRECATED: caller identity resolved from the x-user-id header; body value ignored.
     *
     * @deprecated
     */
    userId: string;
}
export interface CancelOrderResponse {
    success: boolean;
    order?: Order | undefined;
}
export interface GetOrderRequest {
    orderId: string;
}
/**
 * ConfirmOrder writes the fill a broker would otherwise report onto an OFFLINE order.
 * status is server-derived from filled_qty vs qty (never client-supplied). Rejected with
 * FailedPrecondition for broker (Alpaca/IBKR) accounts (FR-8/@AC-9).
 */
export interface ConfirmOrderRequest {
    orderId: string;
    filledQty: number;
    filledAvgPrice: number;
    /** optional; server defaults to now when unset */
    filledAt?: Date | undefined;
    /**
     * DEPRECATED: caller identity (ownership guard) resolved from the x-user-id header; body value ignored.
     *
     * @deprecated
     */
    userId: string;
}
export interface ListOrdersRequest {
    userId: string;
    strategyId: string;
    status: OrderStatus;
    range?: TimeRange | undefined;
    page?: PageRequest | undefined;
    /** Filter by trading mode; UNSPECIFIED returns orders for all modes. */
    tradingMode: TradingMode;
    /**
     * Additive filters: an UNSPECIFIED enum value or empty string means
     * "no filter on this dimension" (matches the status/trading_mode semantics above).
     */
    symbol: string;
    side: OrderSide;
    orderType: OrderType;
    accountId: string;
}
export interface ListOrdersResponse {
    orders: Order[];
    page?: PageResponse | undefined;
}
export interface StreamOrderUpdatesRequest {
    userId: string;
    statusFilter: OrderStatus[];
}
export interface ReplaceOrderRequest {
    orderId: string;
    /** Optional replacement fields; a zero/empty value means "leave unchanged". */
    qty: number;
    limitPrice: number;
    stopPrice: number;
    timeInForce: string;
    /**
     * DEPRECATED: caller identity resolved from the x-user-id header; body value ignored.
     *
     * @deprecated
     */
    userId: string;
    /**
     * New trail offset for a working trailing_stop order (Alpaca's replace body
     * uses a single `trail` value); zero means "leave unchanged".
     */
    trail: number;
}
/** BrokerAccount is a registered broker account (credentials never returned). */
export interface BrokerAccount {
    id: string;
    displayName: string;
    brokerType: BrokerType;
    /** is_paper is derived from the deployment environment, not chosen per account. */
    isPaper: boolean;
    userId: string;
    isActive: boolean;
    /** credential_status is the result of the most recent credential validation. */
    credentialStatus: CredentialStatus;
    /** credential_checked_at is when credential_status was last refreshed. */
    credentialCheckedAt?: Date | undefined;
    /**
     * halted / halted_at / halt_reason / halt_source (feature 030 + 102): whether this account is
     * currently halted by an automated safety mechanism, when, why, and which mechanism. False/unset
     * means no automated halt is in effect; an operator may still have separately deactivated the
     * account (is_active).
     */
    halted: boolean;
    haltedAt?: Date | undefined;
    haltReason: string;
    haltSource: HaltSource;
}
export interface RegisterBrokerAccountRequest {
    displayName: string;
    brokerType: BrokerType;
    /**
     * Deprecated: paper/live is owned by the deployment environment
     * (trading.broker.paper config key / TRADING_MODE env). The server derives
     * is_paper from the environment and ignores this field.
     *
     * @deprecated
     */
    isPaper: boolean;
    /**
     * credentials_json: broker-type-specific JSON blob.
     * Alpaca: {"api_key":"...","api_secret":"..."}
     * IBKR:   {"consumer_key":"...","access_token":"...","access_token_secret":"...","ibkr_account_id":"..."}
     */
    credentialsJson: string;
}
export interface RegisterBrokerAccountResponse {
    account?: BrokerAccount | undefined;
}
export interface UpdateBrokerAccountCredentialsRequest {
    accountId: string;
    /**
     * credentials_json uses the same broker-type-specific shape as
     * RegisterBrokerAccountRequest.credentials_json.
     */
    credentialsJson: string;
}
export interface UpdateBrokerAccountCredentialsResponse {
    account?: BrokerAccount | undefined;
}
export interface GetTradingEnvironmentRequest {
}
export interface GetTradingEnvironmentResponse {
    /** trading_mode is the mode every order in this deployment routes to. */
    tradingMode: TradingMode;
    /** application_env: "development" | "production". */
    applicationEnv: string;
}
export interface ListBrokerAccountsRequest {
}
export interface ListBrokerAccountsResponse {
    accounts: BrokerAccount[];
}
export interface DeregisterBrokerAccountRequest {
    accountId: string;
}
export interface DeregisterBrokerAccountResponse {
}
export interface ResumeAccountRequest {
    accountId: string;
    reason: string;
}
export interface ResumeAccountResponse {
    account?: BrokerAccount | undefined;
}
/** A single position row from a brokerage statement to be used as a baseline. */
export interface PositionBaseline {
    symbol: string;
    /** signed: long +, short − */
    qty: number;
    avgCostPerShare: number;
}
/**
 * Seeds (or replaces) the effective-dated opening baseline for an OFFLINE account.
 * client_snapshot_id is the replace/idempotency key: re-submitting the same ID
 * replaces the prior snapshot's rows atomically.
 */
export interface SnapshotOfflinePositionsRequest {
    accountId: string;
    /** caller identity (ownership + reconciliation payload) */
    userId: string;
    /** T0 */
    asOf?: Date | undefined;
    /** idempotency / replace key (UUID) */
    clientSnapshotId: string;
    positions: PositionBaseline[];
}
/** A row that failed validation and was not committed. */
export interface RejectedBaselineRow {
    rowIndex: number;
    reason: string;
}
export interface SnapshotOfflinePositionsResponse {
    accountId: string;
    committedCount: number;
    rejected: RejectedBaselineRow[];
    /** e.g. unconfirmed NEW-order advisory (design.md § Snapshot-over-NEW) */
    warnings: string[];
}
export declare const Order: MessageFns<Order>;
export declare const PlaceOrderRequest: MessageFns<PlaceOrderRequest>;
export declare const CancelOrderRequest: MessageFns<CancelOrderRequest>;
export declare const CancelOrderResponse: MessageFns<CancelOrderResponse>;
export declare const GetOrderRequest: MessageFns<GetOrderRequest>;
export declare const ConfirmOrderRequest: MessageFns<ConfirmOrderRequest>;
export declare const ListOrdersRequest: MessageFns<ListOrdersRequest>;
export declare const ListOrdersResponse: MessageFns<ListOrdersResponse>;
export declare const StreamOrderUpdatesRequest: MessageFns<StreamOrderUpdatesRequest>;
export declare const ReplaceOrderRequest: MessageFns<ReplaceOrderRequest>;
export declare const BrokerAccount: MessageFns<BrokerAccount>;
export declare const RegisterBrokerAccountRequest: MessageFns<RegisterBrokerAccountRequest>;
export declare const RegisterBrokerAccountResponse: MessageFns<RegisterBrokerAccountResponse>;
export declare const UpdateBrokerAccountCredentialsRequest: MessageFns<UpdateBrokerAccountCredentialsRequest>;
export declare const UpdateBrokerAccountCredentialsResponse: MessageFns<UpdateBrokerAccountCredentialsResponse>;
export declare const GetTradingEnvironmentRequest: MessageFns<GetTradingEnvironmentRequest>;
export declare const GetTradingEnvironmentResponse: MessageFns<GetTradingEnvironmentResponse>;
export declare const ListBrokerAccountsRequest: MessageFns<ListBrokerAccountsRequest>;
export declare const ListBrokerAccountsResponse: MessageFns<ListBrokerAccountsResponse>;
export declare const DeregisterBrokerAccountRequest: MessageFns<DeregisterBrokerAccountRequest>;
export declare const DeregisterBrokerAccountResponse: MessageFns<DeregisterBrokerAccountResponse>;
export declare const ResumeAccountRequest: MessageFns<ResumeAccountRequest>;
export declare const ResumeAccountResponse: MessageFns<ResumeAccountResponse>;
export declare const PositionBaseline: MessageFns<PositionBaseline>;
export declare const SnapshotOfflinePositionsRequest: MessageFns<SnapshotOfflinePositionsRequest>;
export declare const RejectedBaselineRow: MessageFns<RejectedBaselineRow>;
export declare const SnapshotOfflinePositionsResponse: MessageFns<SnapshotOfflinePositionsResponse>;
export type TradingServiceService = typeof TradingServiceService;
export declare const TradingServiceService: {
    readonly placeOrder: {
        readonly path: "/xstockstrat.trading.v1.TradingService/PlaceOrder";
        readonly requestStream: false;
        readonly responseStream: false;
        readonly requestSerialize: (value: PlaceOrderRequest) => Buffer;
        readonly requestDeserialize: (value: Buffer) => PlaceOrderRequest;
        readonly responseSerialize: (value: Order) => Buffer;
        readonly responseDeserialize: (value: Buffer) => Order;
    };
    readonly cancelOrder: {
        readonly path: "/xstockstrat.trading.v1.TradingService/CancelOrder";
        readonly requestStream: false;
        readonly responseStream: false;
        readonly requestSerialize: (value: CancelOrderRequest) => Buffer;
        readonly requestDeserialize: (value: Buffer) => CancelOrderRequest;
        readonly responseSerialize: (value: CancelOrderResponse) => Buffer;
        readonly responseDeserialize: (value: Buffer) => CancelOrderResponse;
    };
    readonly getOrder: {
        readonly path: "/xstockstrat.trading.v1.TradingService/GetOrder";
        readonly requestStream: false;
        readonly responseStream: false;
        readonly requestSerialize: (value: GetOrderRequest) => Buffer;
        readonly requestDeserialize: (value: Buffer) => GetOrderRequest;
        readonly responseSerialize: (value: Order) => Buffer;
        readonly responseDeserialize: (value: Buffer) => Order;
    };
    readonly listOrders: {
        readonly path: "/xstockstrat.trading.v1.TradingService/ListOrders";
        readonly requestStream: false;
        readonly responseStream: false;
        readonly requestSerialize: (value: ListOrdersRequest) => Buffer;
        readonly requestDeserialize: (value: Buffer) => ListOrdersRequest;
        readonly responseSerialize: (value: ListOrdersResponse) => Buffer;
        readonly responseDeserialize: (value: Buffer) => ListOrdersResponse;
    };
    readonly streamOrderUpdates: {
        readonly path: "/xstockstrat.trading.v1.TradingService/StreamOrderUpdates";
        readonly requestStream: false;
        readonly responseStream: true;
        readonly requestSerialize: (value: StreamOrderUpdatesRequest) => Buffer;
        readonly requestDeserialize: (value: Buffer) => StreamOrderUpdatesRequest;
        readonly responseSerialize: (value: Order) => Buffer;
        readonly responseDeserialize: (value: Buffer) => Order;
    };
    /**
     * ReplaceOrder modifies a working order's qty/price/TIF. It is broker-agnostic at
     * this surface and routes by the persisted order's broker_type
     * (Alpaca → PATCH /v2/orders/{id}; IBKR → adapter-specific modify). Allowed only
     * while the order is NEW or PARTIALLY_FILLED.
     */
    readonly replaceOrder: {
        readonly path: "/xstockstrat.trading.v1.TradingService/ReplaceOrder";
        readonly requestStream: false;
        readonly responseStream: false;
        readonly requestSerialize: (value: ReplaceOrderRequest) => Buffer;
        readonly requestDeserialize: (value: Buffer) => ReplaceOrderRequest;
        readonly responseSerialize: (value: Order) => Buffer;
        readonly responseDeserialize: (value: Buffer) => Order;
    };
    /**
     * ConfirmOrder is OFFLINE-only (feature 157): it writes the fill fields a broker would
     * otherwise report (filled_qty/filled_avg_price/filled_at, and a server-derived status)
     * onto an order belonging to an offline account, then recomputes the account's positions.
     * It never contacts a broker and is rejected with FailedPrecondition for broker accounts.
     */
    readonly confirmOrder: {
        readonly path: "/xstockstrat.trading.v1.TradingService/ConfirmOrder";
        readonly requestStream: false;
        readonly responseStream: false;
        readonly requestSerialize: (value: ConfirmOrderRequest) => Buffer;
        readonly requestDeserialize: (value: Buffer) => ConfirmOrderRequest;
        readonly responseSerialize: (value: Order) => Buffer;
        readonly responseDeserialize: (value: Buffer) => Order;
    };
    readonly registerBrokerAccount: {
        readonly path: "/xstockstrat.trading.v1.TradingService/RegisterBrokerAccount";
        readonly requestStream: false;
        readonly responseStream: false;
        readonly requestSerialize: (value: RegisterBrokerAccountRequest) => Buffer;
        readonly requestDeserialize: (value: Buffer) => RegisterBrokerAccountRequest;
        readonly responseSerialize: (value: RegisterBrokerAccountResponse) => Buffer;
        readonly responseDeserialize: (value: Buffer) => RegisterBrokerAccountResponse;
    };
    readonly listBrokerAccounts: {
        readonly path: "/xstockstrat.trading.v1.TradingService/ListBrokerAccounts";
        readonly requestStream: false;
        readonly responseStream: false;
        readonly requestSerialize: (value: ListBrokerAccountsRequest) => Buffer;
        readonly requestDeserialize: (value: Buffer) => ListBrokerAccountsRequest;
        readonly responseSerialize: (value: ListBrokerAccountsResponse) => Buffer;
        readonly responseDeserialize: (value: Buffer) => ListBrokerAccountsResponse;
    };
    readonly deregisterBrokerAccount: {
        readonly path: "/xstockstrat.trading.v1.TradingService/DeregisterBrokerAccount";
        readonly requestStream: false;
        readonly responseStream: false;
        readonly requestSerialize: (value: DeregisterBrokerAccountRequest) => Buffer;
        readonly requestDeserialize: (value: Buffer) => DeregisterBrokerAccountRequest;
        readonly responseSerialize: (value: DeregisterBrokerAccountResponse) => Buffer;
        readonly responseDeserialize: (value: Buffer) => DeregisterBrokerAccountResponse;
    };
    /**
     * UpdateBrokerAccountCredentials replaces the stored API secrets for an existing
     * account, re-validates them against the broker, and refreshes credential_status.
     */
    readonly updateBrokerAccountCredentials: {
        readonly path: "/xstockstrat.trading.v1.TradingService/UpdateBrokerAccountCredentials";
        readonly requestStream: false;
        readonly responseStream: false;
        readonly requestSerialize: (value: UpdateBrokerAccountCredentialsRequest) => Buffer;
        readonly requestDeserialize: (value: Buffer) => UpdateBrokerAccountCredentialsRequest;
        readonly responseSerialize: (value: UpdateBrokerAccountCredentialsResponse) => Buffer;
        readonly responseDeserialize: (value: Buffer) => UpdateBrokerAccountCredentialsResponse;
    };
    /**
     * GetTradingEnvironment reports the deployment-fixed trading mode. Users cannot
     * switch between paper and live — the environment owns this decision.
     */
    readonly getTradingEnvironment: {
        readonly path: "/xstockstrat.trading.v1.TradingService/GetTradingEnvironment";
        readonly requestStream: false;
        readonly responseStream: false;
        readonly requestSerialize: (value: GetTradingEnvironmentRequest) => Buffer;
        readonly requestDeserialize: (value: Buffer) => GetTradingEnvironmentRequest;
        readonly responseSerialize: (value: GetTradingEnvironmentResponse) => Buffer;
        readonly responseDeserialize: (value: Buffer) => GetTradingEnvironmentResponse;
    };
    /**
     * SnapshotOfflinePositions records brokerage-statement period-end holdings as an
     * effective-dated opening baseline for an OFFLINE account (feature 163). Rejected
     * with FailedPrecondition for broker (Alpaca/IBKR) accounts.
     */
    readonly snapshotOfflinePositions: {
        readonly path: "/xstockstrat.trading.v1.TradingService/SnapshotOfflinePositions";
        readonly requestStream: false;
        readonly responseStream: false;
        readonly requestSerialize: (value: SnapshotOfflinePositionsRequest) => Buffer;
        readonly requestDeserialize: (value: Buffer) => SnapshotOfflinePositionsRequest;
        readonly responseSerialize: (value: SnapshotOfflinePositionsResponse) => Buffer;
        readonly responseDeserialize: (value: Buffer) => SnapshotOfflinePositionsResponse;
    };
    /**
     * ResumeAccount clears the persistent and in-memory halt on a broker account
     * (feature 169). Admin-scope callers only. Idempotent: a non-halted account
     * returns success with no state change. Emits a ledger event and INFO alert.
     */
    readonly resumeAccount: {
        readonly path: "/xstockstrat.trading.v1.TradingService/ResumeAccount";
        readonly requestStream: false;
        readonly responseStream: false;
        readonly requestSerialize: (value: ResumeAccountRequest) => Buffer;
        readonly requestDeserialize: (value: Buffer) => ResumeAccountRequest;
        readonly responseSerialize: (value: ResumeAccountResponse) => Buffer;
        readonly responseDeserialize: (value: Buffer) => ResumeAccountResponse;
    };
};
export interface TradingServiceServer extends UntypedServiceImplementation {
    placeOrder: handleUnaryCall<PlaceOrderRequest, Order>;
    cancelOrder: handleUnaryCall<CancelOrderRequest, CancelOrderResponse>;
    getOrder: handleUnaryCall<GetOrderRequest, Order>;
    listOrders: handleUnaryCall<ListOrdersRequest, ListOrdersResponse>;
    streamOrderUpdates: handleServerStreamingCall<StreamOrderUpdatesRequest, Order>;
    /**
     * ReplaceOrder modifies a working order's qty/price/TIF. It is broker-agnostic at
     * this surface and routes by the persisted order's broker_type
     * (Alpaca → PATCH /v2/orders/{id}; IBKR → adapter-specific modify). Allowed only
     * while the order is NEW or PARTIALLY_FILLED.
     */
    replaceOrder: handleUnaryCall<ReplaceOrderRequest, Order>;
    /**
     * ConfirmOrder is OFFLINE-only (feature 157): it writes the fill fields a broker would
     * otherwise report (filled_qty/filled_avg_price/filled_at, and a server-derived status)
     * onto an order belonging to an offline account, then recomputes the account's positions.
     * It never contacts a broker and is rejected with FailedPrecondition for broker accounts.
     */
    confirmOrder: handleUnaryCall<ConfirmOrderRequest, Order>;
    registerBrokerAccount: handleUnaryCall<RegisterBrokerAccountRequest, RegisterBrokerAccountResponse>;
    listBrokerAccounts: handleUnaryCall<ListBrokerAccountsRequest, ListBrokerAccountsResponse>;
    deregisterBrokerAccount: handleUnaryCall<DeregisterBrokerAccountRequest, DeregisterBrokerAccountResponse>;
    /**
     * UpdateBrokerAccountCredentials replaces the stored API secrets for an existing
     * account, re-validates them against the broker, and refreshes credential_status.
     */
    updateBrokerAccountCredentials: handleUnaryCall<UpdateBrokerAccountCredentialsRequest, UpdateBrokerAccountCredentialsResponse>;
    /**
     * GetTradingEnvironment reports the deployment-fixed trading mode. Users cannot
     * switch between paper and live — the environment owns this decision.
     */
    getTradingEnvironment: handleUnaryCall<GetTradingEnvironmentRequest, GetTradingEnvironmentResponse>;
    /**
     * SnapshotOfflinePositions records brokerage-statement period-end holdings as an
     * effective-dated opening baseline for an OFFLINE account (feature 163). Rejected
     * with FailedPrecondition for broker (Alpaca/IBKR) accounts.
     */
    snapshotOfflinePositions: handleUnaryCall<SnapshotOfflinePositionsRequest, SnapshotOfflinePositionsResponse>;
    /**
     * ResumeAccount clears the persistent and in-memory halt on a broker account
     * (feature 169). Admin-scope callers only. Idempotent: a non-halted account
     * returns success with no state change. Emits a ledger event and INFO alert.
     */
    resumeAccount: handleUnaryCall<ResumeAccountRequest, ResumeAccountResponse>;
}
export interface TradingServiceClient extends Client {
    placeOrder(request: PlaceOrderRequest, callback: (error: ServiceError | null, response: Order) => void): ClientUnaryCall;
    placeOrder(request: PlaceOrderRequest, metadata: Metadata, callback: (error: ServiceError | null, response: Order) => void): ClientUnaryCall;
    placeOrder(request: PlaceOrderRequest, metadata: Metadata, options: Partial<CallOptions>, callback: (error: ServiceError | null, response: Order) => void): ClientUnaryCall;
    cancelOrder(request: CancelOrderRequest, callback: (error: ServiceError | null, response: CancelOrderResponse) => void): ClientUnaryCall;
    cancelOrder(request: CancelOrderRequest, metadata: Metadata, callback: (error: ServiceError | null, response: CancelOrderResponse) => void): ClientUnaryCall;
    cancelOrder(request: CancelOrderRequest, metadata: Metadata, options: Partial<CallOptions>, callback: (error: ServiceError | null, response: CancelOrderResponse) => void): ClientUnaryCall;
    getOrder(request: GetOrderRequest, callback: (error: ServiceError | null, response: Order) => void): ClientUnaryCall;
    getOrder(request: GetOrderRequest, metadata: Metadata, callback: (error: ServiceError | null, response: Order) => void): ClientUnaryCall;
    getOrder(request: GetOrderRequest, metadata: Metadata, options: Partial<CallOptions>, callback: (error: ServiceError | null, response: Order) => void): ClientUnaryCall;
    listOrders(request: ListOrdersRequest, callback: (error: ServiceError | null, response: ListOrdersResponse) => void): ClientUnaryCall;
    listOrders(request: ListOrdersRequest, metadata: Metadata, callback: (error: ServiceError | null, response: ListOrdersResponse) => void): ClientUnaryCall;
    listOrders(request: ListOrdersRequest, metadata: Metadata, options: Partial<CallOptions>, callback: (error: ServiceError | null, response: ListOrdersResponse) => void): ClientUnaryCall;
    streamOrderUpdates(request: StreamOrderUpdatesRequest, options?: Partial<CallOptions>): ClientReadableStream<Order>;
    streamOrderUpdates(request: StreamOrderUpdatesRequest, metadata?: Metadata, options?: Partial<CallOptions>): ClientReadableStream<Order>;
    /**
     * ReplaceOrder modifies a working order's qty/price/TIF. It is broker-agnostic at
     * this surface and routes by the persisted order's broker_type
     * (Alpaca → PATCH /v2/orders/{id}; IBKR → adapter-specific modify). Allowed only
     * while the order is NEW or PARTIALLY_FILLED.
     */
    replaceOrder(request: ReplaceOrderRequest, callback: (error: ServiceError | null, response: Order) => void): ClientUnaryCall;
    replaceOrder(request: ReplaceOrderRequest, metadata: Metadata, callback: (error: ServiceError | null, response: Order) => void): ClientUnaryCall;
    replaceOrder(request: ReplaceOrderRequest, metadata: Metadata, options: Partial<CallOptions>, callback: (error: ServiceError | null, response: Order) => void): ClientUnaryCall;
    /**
     * ConfirmOrder is OFFLINE-only (feature 157): it writes the fill fields a broker would
     * otherwise report (filled_qty/filled_avg_price/filled_at, and a server-derived status)
     * onto an order belonging to an offline account, then recomputes the account's positions.
     * It never contacts a broker and is rejected with FailedPrecondition for broker accounts.
     */
    confirmOrder(request: ConfirmOrderRequest, callback: (error: ServiceError | null, response: Order) => void): ClientUnaryCall;
    confirmOrder(request: ConfirmOrderRequest, metadata: Metadata, callback: (error: ServiceError | null, response: Order) => void): ClientUnaryCall;
    confirmOrder(request: ConfirmOrderRequest, metadata: Metadata, options: Partial<CallOptions>, callback: (error: ServiceError | null, response: Order) => void): ClientUnaryCall;
    registerBrokerAccount(request: RegisterBrokerAccountRequest, callback: (error: ServiceError | null, response: RegisterBrokerAccountResponse) => void): ClientUnaryCall;
    registerBrokerAccount(request: RegisterBrokerAccountRequest, metadata: Metadata, callback: (error: ServiceError | null, response: RegisterBrokerAccountResponse) => void): ClientUnaryCall;
    registerBrokerAccount(request: RegisterBrokerAccountRequest, metadata: Metadata, options: Partial<CallOptions>, callback: (error: ServiceError | null, response: RegisterBrokerAccountResponse) => void): ClientUnaryCall;
    listBrokerAccounts(request: ListBrokerAccountsRequest, callback: (error: ServiceError | null, response: ListBrokerAccountsResponse) => void): ClientUnaryCall;
    listBrokerAccounts(request: ListBrokerAccountsRequest, metadata: Metadata, callback: (error: ServiceError | null, response: ListBrokerAccountsResponse) => void): ClientUnaryCall;
    listBrokerAccounts(request: ListBrokerAccountsRequest, metadata: Metadata, options: Partial<CallOptions>, callback: (error: ServiceError | null, response: ListBrokerAccountsResponse) => void): ClientUnaryCall;
    deregisterBrokerAccount(request: DeregisterBrokerAccountRequest, callback: (error: ServiceError | null, response: DeregisterBrokerAccountResponse) => void): ClientUnaryCall;
    deregisterBrokerAccount(request: DeregisterBrokerAccountRequest, metadata: Metadata, callback: (error: ServiceError | null, response: DeregisterBrokerAccountResponse) => void): ClientUnaryCall;
    deregisterBrokerAccount(request: DeregisterBrokerAccountRequest, metadata: Metadata, options: Partial<CallOptions>, callback: (error: ServiceError | null, response: DeregisterBrokerAccountResponse) => void): ClientUnaryCall;
    /**
     * UpdateBrokerAccountCredentials replaces the stored API secrets for an existing
     * account, re-validates them against the broker, and refreshes credential_status.
     */
    updateBrokerAccountCredentials(request: UpdateBrokerAccountCredentialsRequest, callback: (error: ServiceError | null, response: UpdateBrokerAccountCredentialsResponse) => void): ClientUnaryCall;
    updateBrokerAccountCredentials(request: UpdateBrokerAccountCredentialsRequest, metadata: Metadata, callback: (error: ServiceError | null, response: UpdateBrokerAccountCredentialsResponse) => void): ClientUnaryCall;
    updateBrokerAccountCredentials(request: UpdateBrokerAccountCredentialsRequest, metadata: Metadata, options: Partial<CallOptions>, callback: (error: ServiceError | null, response: UpdateBrokerAccountCredentialsResponse) => void): ClientUnaryCall;
    /**
     * GetTradingEnvironment reports the deployment-fixed trading mode. Users cannot
     * switch between paper and live — the environment owns this decision.
     */
    getTradingEnvironment(request: GetTradingEnvironmentRequest, callback: (error: ServiceError | null, response: GetTradingEnvironmentResponse) => void): ClientUnaryCall;
    getTradingEnvironment(request: GetTradingEnvironmentRequest, metadata: Metadata, callback: (error: ServiceError | null, response: GetTradingEnvironmentResponse) => void): ClientUnaryCall;
    getTradingEnvironment(request: GetTradingEnvironmentRequest, metadata: Metadata, options: Partial<CallOptions>, callback: (error: ServiceError | null, response: GetTradingEnvironmentResponse) => void): ClientUnaryCall;
    /**
     * SnapshotOfflinePositions records brokerage-statement period-end holdings as an
     * effective-dated opening baseline for an OFFLINE account (feature 163). Rejected
     * with FailedPrecondition for broker (Alpaca/IBKR) accounts.
     */
    snapshotOfflinePositions(request: SnapshotOfflinePositionsRequest, callback: (error: ServiceError | null, response: SnapshotOfflinePositionsResponse) => void): ClientUnaryCall;
    snapshotOfflinePositions(request: SnapshotOfflinePositionsRequest, metadata: Metadata, callback: (error: ServiceError | null, response: SnapshotOfflinePositionsResponse) => void): ClientUnaryCall;
    snapshotOfflinePositions(request: SnapshotOfflinePositionsRequest, metadata: Metadata, options: Partial<CallOptions>, callback: (error: ServiceError | null, response: SnapshotOfflinePositionsResponse) => void): ClientUnaryCall;
    /**
     * ResumeAccount clears the persistent and in-memory halt on a broker account
     * (feature 169). Admin-scope callers only. Idempotent: a non-halted account
     * returns success with no state change. Emits a ledger event and INFO alert.
     */
    resumeAccount(request: ResumeAccountRequest, callback: (error: ServiceError | null, response: ResumeAccountResponse) => void): ClientUnaryCall;
    resumeAccount(request: ResumeAccountRequest, metadata: Metadata, callback: (error: ServiceError | null, response: ResumeAccountResponse) => void): ClientUnaryCall;
    resumeAccount(request: ResumeAccountRequest, metadata: Metadata, options: Partial<CallOptions>, callback: (error: ServiceError | null, response: ResumeAccountResponse) => void): ClientUnaryCall;
}
export declare const TradingServiceClient: {
    new (address: string, credentials: ChannelCredentials, options?: Partial<ClientOptions>): TradingServiceClient;
    service: typeof TradingServiceService;
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

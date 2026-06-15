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
    userId: string;
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
}
export interface CancelOrderRequest {
    orderId: string;
    userId: string;
}
export interface CancelOrderResponse {
    success: boolean;
    order?: Order | undefined;
}
export interface GetOrderRequest {
    orderId: string;
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
export declare const Order: MessageFns<Order>;
export declare const PlaceOrderRequest: MessageFns<PlaceOrderRequest>;
export declare const CancelOrderRequest: MessageFns<CancelOrderRequest>;
export declare const CancelOrderResponse: MessageFns<CancelOrderResponse>;
export declare const GetOrderRequest: MessageFns<GetOrderRequest>;
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

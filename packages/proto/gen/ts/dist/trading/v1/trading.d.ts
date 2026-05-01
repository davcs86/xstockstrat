import { BinaryReader, BinaryWriter } from "@bufbuild/protobuf/wire";
import { type CallOptions, type ChannelCredentials, Client, type ClientOptions, type ClientReadableStream, type ClientUnaryCall, type handleServerStreamingCall, type handleUnaryCall, type Metadata, type ServiceError, type UntypedServiceImplementation } from "@grpc/grpc-js";
import { PageRequest, PageResponse, TimeRange, TradingMode } from "../../common/v1/common";
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
}
export interface ListOrdersResponse {
    orders: Order[];
    page?: PageResponse | undefined;
}
export interface StreamOrderUpdatesRequest {
    userId: string;
    statusFilter: OrderStatus[];
}
export declare const Order: MessageFns<Order>;
export declare const PlaceOrderRequest: MessageFns<PlaceOrderRequest>;
export declare const CancelOrderRequest: MessageFns<CancelOrderRequest>;
export declare const CancelOrderResponse: MessageFns<CancelOrderResponse>;
export declare const GetOrderRequest: MessageFns<GetOrderRequest>;
export declare const ListOrdersRequest: MessageFns<ListOrdersRequest>;
export declare const ListOrdersResponse: MessageFns<ListOrdersResponse>;
export declare const StreamOrderUpdatesRequest: MessageFns<StreamOrderUpdatesRequest>;
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
};
export interface TradingServiceServer extends UntypedServiceImplementation {
    placeOrder: handleUnaryCall<PlaceOrderRequest, Order>;
    cancelOrder: handleUnaryCall<CancelOrderRequest, CancelOrderResponse>;
    getOrder: handleUnaryCall<GetOrderRequest, Order>;
    listOrders: handleUnaryCall<ListOrdersRequest, ListOrdersResponse>;
    streamOrderUpdates: handleServerStreamingCall<StreamOrderUpdatesRequest, Order>;
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

import type { GenEnum, GenFile, GenMessage, GenService } from "@bufbuild/protobuf/codegenv2";
import type { Timestamp } from "@bufbuild/protobuf/wkt";
import type { BrokerType, PageRequest, PageResponse, TimeRange, TradingMode } from "../../common/v1/common_pb";
import type { Message } from "@bufbuild/protobuf";
/**
 * Describes the file trading/v1/trading.proto.
 */
export declare const file_trading_v1_trading: GenFile;
/**
 * @generated from message xstockstrat.trading.v1.Order
 */
export type Order = Message<"xstockstrat.trading.v1.Order"> & {
    /**
     * @generated from field: string order_id = 1;
     */
    orderId: string;
    /**
     * @generated from field: string client_order_id = 2;
     */
    clientOrderId: string;
    /**
     * @generated from field: string symbol = 3;
     */
    symbol: string;
    /**
     * @generated from field: xstockstrat.trading.v1.OrderSide side = 4;
     */
    side: OrderSide;
    /**
     * @generated from field: xstockstrat.trading.v1.OrderType order_type = 5;
     */
    orderType: OrderType;
    /**
     * @generated from field: xstockstrat.trading.v1.OrderStatus status = 6;
     */
    status: OrderStatus;
    /**
     * @generated from field: double qty = 7;
     */
    qty: number;
    /**
     * @generated from field: double filled_qty = 8;
     */
    filledQty: number;
    /**
     * @generated from field: double limit_price = 9;
     */
    limitPrice: number;
    /**
     * @generated from field: double stop_price = 10;
     */
    stopPrice: number;
    /**
     * @generated from field: double filled_avg_price = 11;
     */
    filledAvgPrice: number;
    /**
     * @generated from field: string time_in_force = 12;
     */
    timeInForce: string;
    /**
     * @generated from field: google.protobuf.Timestamp created_at = 13;
     */
    createdAt?: Timestamp | undefined;
    /**
     * @generated from field: google.protobuf.Timestamp updated_at = 14;
     */
    updatedAt?: Timestamp | undefined;
    /**
     * @generated from field: string strategy_id = 15;
     */
    strategyId: string;
    /**
     * @generated from field: string user_id = 16;
     */
    userId: string;
    /**
     * @generated from field: xstockstrat.common.v1.TradingMode trading_mode = 17;
     */
    tradingMode: TradingMode;
    /**
     * Alpaca-assigned order ID, populated after broker submission
     *
     * @generated from field: string broker_order_id = 18;
     */
    brokerOrderId: string;
    /**
     * @generated from field: string account_id = 19;
     */
    accountId: string;
    /**
     * @generated from field: xstockstrat.common.v1.BrokerType broker_type = 20;
     */
    brokerType: BrokerType;
};
/**
 * Describes the message xstockstrat.trading.v1.Order.
 * Use `create(OrderSchema)` to create a new message.
 */
export declare const OrderSchema: GenMessage<Order>;
/**
 * @generated from message xstockstrat.trading.v1.PlaceOrderRequest
 */
export type PlaceOrderRequest = Message<"xstockstrat.trading.v1.PlaceOrderRequest"> & {
    /**
     * @generated from field: string symbol = 1;
     */
    symbol: string;
    /**
     * @generated from field: xstockstrat.trading.v1.OrderSide side = 2;
     */
    side: OrderSide;
    /**
     * @generated from field: xstockstrat.trading.v1.OrderType order_type = 3;
     */
    orderType: OrderType;
    /**
     * @generated from field: double qty = 4;
     */
    qty: number;
    /**
     * @generated from field: double limit_price = 5;
     */
    limitPrice: number;
    /**
     * @generated from field: double stop_price = 6;
     */
    stopPrice: number;
    /**
     * @generated from field: string time_in_force = 7;
     */
    timeInForce: string;
    /**
     * @generated from field: string strategy_id = 8;
     */
    strategyId: string;
    /**
     * @generated from field: string user_id = 9;
     */
    userId: string;
    /**
     * @generated from field: string client_order_id = 10;
     */
    clientOrderId: string;
    /**
     * @generated from field: bool requires_approval = 11;
     */
    requiresApproval: boolean;
    /**
     * If UNSPECIFIED, the service uses trading.broker.paper config key to determine mode.
     *
     * @generated from field: xstockstrat.common.v1.TradingMode trading_mode = 12;
     */
    tradingMode: TradingMode;
    /**
     * account_id routes the order to a specific broker account.
     * Required when multiple accounts are registered; optional when only one exists.
     *
     * @generated from field: string account_id = 13;
     */
    accountId: string;
};
/**
 * Describes the message xstockstrat.trading.v1.PlaceOrderRequest.
 * Use `create(PlaceOrderRequestSchema)` to create a new message.
 */
export declare const PlaceOrderRequestSchema: GenMessage<PlaceOrderRequest>;
/**
 * @generated from message xstockstrat.trading.v1.CancelOrderRequest
 */
export type CancelOrderRequest = Message<"xstockstrat.trading.v1.CancelOrderRequest"> & {
    /**
     * @generated from field: string order_id = 1;
     */
    orderId: string;
    /**
     * @generated from field: string user_id = 2;
     */
    userId: string;
};
/**
 * Describes the message xstockstrat.trading.v1.CancelOrderRequest.
 * Use `create(CancelOrderRequestSchema)` to create a new message.
 */
export declare const CancelOrderRequestSchema: GenMessage<CancelOrderRequest>;
/**
 * @generated from message xstockstrat.trading.v1.CancelOrderResponse
 */
export type CancelOrderResponse = Message<"xstockstrat.trading.v1.CancelOrderResponse"> & {
    /**
     * @generated from field: bool success = 1;
     */
    success: boolean;
    /**
     * @generated from field: xstockstrat.trading.v1.Order order = 2;
     */
    order?: Order | undefined;
};
/**
 * Describes the message xstockstrat.trading.v1.CancelOrderResponse.
 * Use `create(CancelOrderResponseSchema)` to create a new message.
 */
export declare const CancelOrderResponseSchema: GenMessage<CancelOrderResponse>;
/**
 * @generated from message xstockstrat.trading.v1.GetOrderRequest
 */
export type GetOrderRequest = Message<"xstockstrat.trading.v1.GetOrderRequest"> & {
    /**
     * @generated from field: string order_id = 1;
     */
    orderId: string;
};
/**
 * Describes the message xstockstrat.trading.v1.GetOrderRequest.
 * Use `create(GetOrderRequestSchema)` to create a new message.
 */
export declare const GetOrderRequestSchema: GenMessage<GetOrderRequest>;
/**
 * @generated from message xstockstrat.trading.v1.ListOrdersRequest
 */
export type ListOrdersRequest = Message<"xstockstrat.trading.v1.ListOrdersRequest"> & {
    /**
     * @generated from field: string user_id = 1;
     */
    userId: string;
    /**
     * @generated from field: string strategy_id = 2;
     */
    strategyId: string;
    /**
     * @generated from field: xstockstrat.trading.v1.OrderStatus status = 3;
     */
    status: OrderStatus;
    /**
     * @generated from field: xstockstrat.common.v1.TimeRange range = 4;
     */
    range?: TimeRange | undefined;
    /**
     * @generated from field: xstockstrat.common.v1.PageRequest page = 5;
     */
    page?: PageRequest | undefined;
    /**
     * Filter by trading mode; UNSPECIFIED returns orders for all modes.
     *
     * @generated from field: xstockstrat.common.v1.TradingMode trading_mode = 6;
     */
    tradingMode: TradingMode;
};
/**
 * Describes the message xstockstrat.trading.v1.ListOrdersRequest.
 * Use `create(ListOrdersRequestSchema)` to create a new message.
 */
export declare const ListOrdersRequestSchema: GenMessage<ListOrdersRequest>;
/**
 * @generated from message xstockstrat.trading.v1.ListOrdersResponse
 */
export type ListOrdersResponse = Message<"xstockstrat.trading.v1.ListOrdersResponse"> & {
    /**
     * @generated from field: repeated xstockstrat.trading.v1.Order orders = 1;
     */
    orders: Order[];
    /**
     * @generated from field: xstockstrat.common.v1.PageResponse page = 2;
     */
    page?: PageResponse | undefined;
};
/**
 * Describes the message xstockstrat.trading.v1.ListOrdersResponse.
 * Use `create(ListOrdersResponseSchema)` to create a new message.
 */
export declare const ListOrdersResponseSchema: GenMessage<ListOrdersResponse>;
/**
 * @generated from message xstockstrat.trading.v1.StreamOrderUpdatesRequest
 */
export type StreamOrderUpdatesRequest = Message<"xstockstrat.trading.v1.StreamOrderUpdatesRequest"> & {
    /**
     * @generated from field: string user_id = 1;
     */
    userId: string;
    /**
     * @generated from field: repeated xstockstrat.trading.v1.OrderStatus status_filter = 2;
     */
    statusFilter: OrderStatus[];
};
/**
 * Describes the message xstockstrat.trading.v1.StreamOrderUpdatesRequest.
 * Use `create(StreamOrderUpdatesRequestSchema)` to create a new message.
 */
export declare const StreamOrderUpdatesRequestSchema: GenMessage<StreamOrderUpdatesRequest>;
/**
 * BrokerAccount is a registered broker account (credentials never returned).
 *
 * @generated from message xstockstrat.trading.v1.BrokerAccount
 */
export type BrokerAccount = Message<"xstockstrat.trading.v1.BrokerAccount"> & {
    /**
     * @generated from field: string id = 1;
     */
    id: string;
    /**
     * @generated from field: string display_name = 2;
     */
    displayName: string;
    /**
     * @generated from field: xstockstrat.common.v1.BrokerType broker_type = 3;
     */
    brokerType: BrokerType;
    /**
     * @generated from field: bool is_paper = 4;
     */
    isPaper: boolean;
    /**
     * @generated from field: string user_id = 5;
     */
    userId: string;
    /**
     * @generated from field: bool is_active = 6;
     */
    isActive: boolean;
};
/**
 * Describes the message xstockstrat.trading.v1.BrokerAccount.
 * Use `create(BrokerAccountSchema)` to create a new message.
 */
export declare const BrokerAccountSchema: GenMessage<BrokerAccount>;
/**
 * @generated from message xstockstrat.trading.v1.RegisterBrokerAccountRequest
 */
export type RegisterBrokerAccountRequest = Message<"xstockstrat.trading.v1.RegisterBrokerAccountRequest"> & {
    /**
     * @generated from field: string display_name = 1;
     */
    displayName: string;
    /**
     * @generated from field: xstockstrat.common.v1.BrokerType broker_type = 2;
     */
    brokerType: BrokerType;
    /**
     * @generated from field: bool is_paper = 3;
     */
    isPaper: boolean;
    /**
     * credentials_json: broker-type-specific JSON blob.
     * Alpaca: {"api_key":"...","api_secret":"..."}
     * IBKR:   {"consumer_key":"...","access_token":"...","access_token_secret":"...","ibkr_account_id":"..."}
     *
     * @generated from field: string credentials_json = 4;
     */
    credentialsJson: string;
};
/**
 * Describes the message xstockstrat.trading.v1.RegisterBrokerAccountRequest.
 * Use `create(RegisterBrokerAccountRequestSchema)` to create a new message.
 */
export declare const RegisterBrokerAccountRequestSchema: GenMessage<RegisterBrokerAccountRequest>;
/**
 * @generated from message xstockstrat.trading.v1.RegisterBrokerAccountResponse
 */
export type RegisterBrokerAccountResponse = Message<"xstockstrat.trading.v1.RegisterBrokerAccountResponse"> & {
    /**
     * @generated from field: xstockstrat.trading.v1.BrokerAccount account = 1;
     */
    account?: BrokerAccount | undefined;
};
/**
 * Describes the message xstockstrat.trading.v1.RegisterBrokerAccountResponse.
 * Use `create(RegisterBrokerAccountResponseSchema)` to create a new message.
 */
export declare const RegisterBrokerAccountResponseSchema: GenMessage<RegisterBrokerAccountResponse>;
/**
 * @generated from message xstockstrat.trading.v1.ListBrokerAccountsRequest
 */
export type ListBrokerAccountsRequest = Message<"xstockstrat.trading.v1.ListBrokerAccountsRequest"> & {};
/**
 * Describes the message xstockstrat.trading.v1.ListBrokerAccountsRequest.
 * Use `create(ListBrokerAccountsRequestSchema)` to create a new message.
 */
export declare const ListBrokerAccountsRequestSchema: GenMessage<ListBrokerAccountsRequest>;
/**
 * @generated from message xstockstrat.trading.v1.ListBrokerAccountsResponse
 */
export type ListBrokerAccountsResponse = Message<"xstockstrat.trading.v1.ListBrokerAccountsResponse"> & {
    /**
     * @generated from field: repeated xstockstrat.trading.v1.BrokerAccount accounts = 1;
     */
    accounts: BrokerAccount[];
};
/**
 * Describes the message xstockstrat.trading.v1.ListBrokerAccountsResponse.
 * Use `create(ListBrokerAccountsResponseSchema)` to create a new message.
 */
export declare const ListBrokerAccountsResponseSchema: GenMessage<ListBrokerAccountsResponse>;
/**
 * @generated from message xstockstrat.trading.v1.DeregisterBrokerAccountRequest
 */
export type DeregisterBrokerAccountRequest = Message<"xstockstrat.trading.v1.DeregisterBrokerAccountRequest"> & {
    /**
     * @generated from field: string account_id = 1;
     */
    accountId: string;
};
/**
 * Describes the message xstockstrat.trading.v1.DeregisterBrokerAccountRequest.
 * Use `create(DeregisterBrokerAccountRequestSchema)` to create a new message.
 */
export declare const DeregisterBrokerAccountRequestSchema: GenMessage<DeregisterBrokerAccountRequest>;
/**
 * @generated from message xstockstrat.trading.v1.DeregisterBrokerAccountResponse
 */
export type DeregisterBrokerAccountResponse = Message<"xstockstrat.trading.v1.DeregisterBrokerAccountResponse"> & {};
/**
 * Describes the message xstockstrat.trading.v1.DeregisterBrokerAccountResponse.
 * Use `create(DeregisterBrokerAccountResponseSchema)` to create a new message.
 */
export declare const DeregisterBrokerAccountResponseSchema: GenMessage<DeregisterBrokerAccountResponse>;
/**
 * @generated from enum xstockstrat.trading.v1.OrderSide
 */
export declare enum OrderSide {
    /**
     * @generated from enum value: ORDER_SIDE_UNSPECIFIED = 0;
     */
    UNSPECIFIED = 0,
    /**
     * @generated from enum value: ORDER_SIDE_BUY = 1;
     */
    BUY = 1,
    /**
     * @generated from enum value: ORDER_SIDE_SELL = 2;
     */
    SELL = 2
}
/**
 * Describes the enum xstockstrat.trading.v1.OrderSide.
 */
export declare const OrderSideSchema: GenEnum<OrderSide>;
/**
 * @generated from enum xstockstrat.trading.v1.OrderType
 */
export declare enum OrderType {
    /**
     * @generated from enum value: ORDER_TYPE_UNSPECIFIED = 0;
     */
    UNSPECIFIED = 0,
    /**
     * @generated from enum value: ORDER_TYPE_MARKET = 1;
     */
    MARKET = 1,
    /**
     * @generated from enum value: ORDER_TYPE_LIMIT = 2;
     */
    LIMIT = 2,
    /**
     * @generated from enum value: ORDER_TYPE_STOP = 3;
     */
    STOP = 3,
    /**
     * @generated from enum value: ORDER_TYPE_STOP_LIMIT = 4;
     */
    STOP_LIMIT = 4,
    /**
     * @generated from enum value: ORDER_TYPE_TRAILING_STOP = 5;
     */
    TRAILING_STOP = 5
}
/**
 * Describes the enum xstockstrat.trading.v1.OrderType.
 */
export declare const OrderTypeSchema: GenEnum<OrderType>;
/**
 * @generated from enum xstockstrat.trading.v1.OrderStatus
 */
export declare enum OrderStatus {
    /**
     * @generated from enum value: ORDER_STATUS_UNSPECIFIED = 0;
     */
    UNSPECIFIED = 0,
    /**
     * @generated from enum value: ORDER_STATUS_NEW = 1;
     */
    NEW = 1,
    /**
     * @generated from enum value: ORDER_STATUS_PARTIALLY_FILLED = 2;
     */
    PARTIALLY_FILLED = 2,
    /**
     * @generated from enum value: ORDER_STATUS_FILLED = 3;
     */
    FILLED = 3,
    /**
     * @generated from enum value: ORDER_STATUS_CANCELED = 4;
     */
    CANCELED = 4,
    /**
     * @generated from enum value: ORDER_STATUS_EXPIRED = 5;
     */
    EXPIRED = 5,
    /**
     * @generated from enum value: ORDER_STATUS_REJECTED = 6;
     */
    REJECTED = 6,
    /**
     * @generated from enum value: ORDER_STATUS_PENDING_APPROVAL = 7;
     */
    PENDING_APPROVAL = 7
}
/**
 * Describes the enum xstockstrat.trading.v1.OrderStatus.
 */
export declare const OrderStatusSchema: GenEnum<OrderStatus>;
/**
 * @generated from service xstockstrat.trading.v1.TradingService
 */
export declare const TradingService: GenService<{
    /**
     * @generated from rpc xstockstrat.trading.v1.TradingService.PlaceOrder
     */
    placeOrder: {
        methodKind: "unary";
        input: typeof PlaceOrderRequestSchema;
        output: typeof OrderSchema;
    };
    /**
     * @generated from rpc xstockstrat.trading.v1.TradingService.CancelOrder
     */
    cancelOrder: {
        methodKind: "unary";
        input: typeof CancelOrderRequestSchema;
        output: typeof CancelOrderResponseSchema;
    };
    /**
     * @generated from rpc xstockstrat.trading.v1.TradingService.GetOrder
     */
    getOrder: {
        methodKind: "unary";
        input: typeof GetOrderRequestSchema;
        output: typeof OrderSchema;
    };
    /**
     * @generated from rpc xstockstrat.trading.v1.TradingService.ListOrders
     */
    listOrders: {
        methodKind: "unary";
        input: typeof ListOrdersRequestSchema;
        output: typeof ListOrdersResponseSchema;
    };
    /**
     * @generated from rpc xstockstrat.trading.v1.TradingService.StreamOrderUpdates
     */
    streamOrderUpdates: {
        methodKind: "server_streaming";
        input: typeof StreamOrderUpdatesRequestSchema;
        output: typeof OrderSchema;
    };
    /**
     * @generated from rpc xstockstrat.trading.v1.TradingService.RegisterBrokerAccount
     */
    registerBrokerAccount: {
        methodKind: "unary";
        input: typeof RegisterBrokerAccountRequestSchema;
        output: typeof RegisterBrokerAccountResponseSchema;
    };
    /**
     * @generated from rpc xstockstrat.trading.v1.TradingService.ListBrokerAccounts
     */
    listBrokerAccounts: {
        methodKind: "unary";
        input: typeof ListBrokerAccountsRequestSchema;
        output: typeof ListBrokerAccountsResponseSchema;
    };
    /**
     * @generated from rpc xstockstrat.trading.v1.TradingService.DeregisterBrokerAccount
     */
    deregisterBrokerAccount: {
        methodKind: "unary";
        input: typeof DeregisterBrokerAccountRequestSchema;
        output: typeof DeregisterBrokerAccountResponseSchema;
    };
}>;

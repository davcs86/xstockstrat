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
    /**
     * intent_state is set by every write path and read via a cross-intent LATERAL join on other reads; see design.md.
     *
     * @generated from field: xstockstrat.trading.v1.IntentState intent_state = 21;
     */
    intentState: IntentState;
    /**
     * filled_at is the confirmed/observed fill time: broker fills use the broker's timestamp;
     * offline confirmations (feature 157) use the operator-supplied time (server-defaulted to now
     * when unset). NULL for a NEW/unconfirmed order and every historical order.
     *
     * @generated from field: google.protobuf.Timestamp filled_at = 22;
     */
    filledAt?: Timestamp | undefined;
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
     * DEPRECATED: order owner resolved from the x-user-id header; body value ignored.
     *
     * @generated from field: string user_id = 9 [deprecated = true];
     * @deprecated
     */
    userId: string;
    /**
     * client_order_id is required: a stable client-generated nonce reused across retries of
     * the same logical place-order action (see the /trader Place Order form's nonce generator).
     * Empty is rejected with InvalidArgument. Used as the order-intent dedup key (feature 101).
     *
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
    /**
     * Trailing-stop parameters. Exactly one of trail_price (dollar offset) or
     * trail_percent (percent offset) is required when order_type is
     * ORDER_TYPE_TRAILING_STOP; both must be zero for any other order type.
     *
     * @generated from field: double trail_price = 14;
     */
    trailPrice: number;
    /**
     * @generated from field: double trail_percent = 15;
     */
    trailPercent: number;
    /**
     * Signal confidence 0.0-1.0 for automatic position sizing (see ComputePositionSize). Unset →
     * confidence=1.0 (full size); explicit 0.0 → size to zero; out-of-range → InvalidArgument.
     *
     * @generated from field: optional double confidence = 16;
     */
    confidence?: number | undefined;
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
     * DEPRECATED: caller identity resolved from the x-user-id header; body value ignored.
     *
     * @generated from field: string user_id = 2 [deprecated = true];
     * @deprecated
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
 * ConfirmOrder writes the fill a broker would otherwise report onto an OFFLINE order.
 * status is server-derived from filled_qty vs qty (never client-supplied). Rejected with
 * FailedPrecondition for broker (Alpaca/IBKR) accounts (FR-8/@AC-9).
 *
 * @generated from message xstockstrat.trading.v1.ConfirmOrderRequest
 */
export type ConfirmOrderRequest = Message<"xstockstrat.trading.v1.ConfirmOrderRequest"> & {
    /**
     * @generated from field: string order_id = 1;
     */
    orderId: string;
    /**
     * @generated from field: double filled_qty = 2;
     */
    filledQty: number;
    /**
     * @generated from field: double filled_avg_price = 3;
     */
    filledAvgPrice: number;
    /**
     * optional; server defaults to now when unset
     *
     * @generated from field: google.protobuf.Timestamp filled_at = 4;
     */
    filledAt?: Timestamp | undefined;
    /**
     * DEPRECATED: caller identity (ownership guard) resolved from the x-user-id header; body value ignored.
     *
     * @generated from field: string user_id = 5 [deprecated = true];
     * @deprecated
     */
    userId: string;
};
/**
 * Describes the message xstockstrat.trading.v1.ConfirmOrderRequest.
 * Use `create(ConfirmOrderRequestSchema)` to create a new message.
 */
export declare const ConfirmOrderRequestSchema: GenMessage<ConfirmOrderRequest>;
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
    /**
     * Additive filters: an UNSPECIFIED enum value or empty string means
     * "no filter on this dimension" (matches the status/trading_mode semantics above).
     *
     * @generated from field: string symbol = 7;
     */
    symbol: string;
    /**
     * @generated from field: xstockstrat.trading.v1.OrderSide side = 8;
     */
    side: OrderSide;
    /**
     * @generated from field: xstockstrat.trading.v1.OrderType order_type = 9;
     */
    orderType: OrderType;
    /**
     * @generated from field: string account_id = 10;
     */
    accountId: string;
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
 * @generated from message xstockstrat.trading.v1.ReplaceOrderRequest
 */
export type ReplaceOrderRequest = Message<"xstockstrat.trading.v1.ReplaceOrderRequest"> & {
    /**
     * @generated from field: string order_id = 1;
     */
    orderId: string;
    /**
     * Optional replacement fields; a zero/empty value means "leave unchanged".
     *
     * @generated from field: double qty = 2;
     */
    qty: number;
    /**
     * @generated from field: double limit_price = 3;
     */
    limitPrice: number;
    /**
     * @generated from field: double stop_price = 4;
     */
    stopPrice: number;
    /**
     * @generated from field: string time_in_force = 5;
     */
    timeInForce: string;
    /**
     * DEPRECATED: caller identity resolved from the x-user-id header; body value ignored.
     *
     * @generated from field: string user_id = 6 [deprecated = true];
     * @deprecated
     */
    userId: string;
    /**
     * New trail offset for a working trailing_stop order (Alpaca's replace body
     * uses a single `trail` value); zero means "leave unchanged".
     *
     * @generated from field: double trail = 7;
     */
    trail: number;
};
/**
 * Describes the message xstockstrat.trading.v1.ReplaceOrderRequest.
 * Use `create(ReplaceOrderRequestSchema)` to create a new message.
 */
export declare const ReplaceOrderRequestSchema: GenMessage<ReplaceOrderRequest>;
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
     * is_paper is derived from the deployment environment, not chosen per account.
     *
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
    /**
     * credential_status is the result of the most recent credential validation.
     *
     * @generated from field: xstockstrat.trading.v1.CredentialStatus credential_status = 7;
     */
    credentialStatus: CredentialStatus;
    /**
     * credential_checked_at is when credential_status was last refreshed.
     *
     * @generated from field: google.protobuf.Timestamp credential_checked_at = 8;
     */
    credentialCheckedAt?: Timestamp | undefined;
    /**
     * halted / halted_at / halt_reason / halt_source (feature 030 + 102): whether this account is
     * currently halted by an automated safety mechanism, when, why, and which mechanism. False/unset
     * means no automated halt is in effect; an operator may still have separately deactivated the
     * account (is_active).
     *
     * @generated from field: bool halted = 9;
     */
    halted: boolean;
    /**
     * @generated from field: google.protobuf.Timestamp halted_at = 10;
     */
    haltedAt?: Timestamp | undefined;
    /**
     * @generated from field: string halt_reason = 11;
     */
    haltReason: string;
    /**
     * @generated from field: xstockstrat.trading.v1.HaltSource halt_source = 12;
     */
    haltSource: HaltSource;
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
     * Deprecated: paper/live is owned by the deployment environment
     * (trading.broker.paper config key / TRADING_MODE env). The server derives
     * is_paper from the environment and ignores this field.
     *
     * @generated from field: bool is_paper = 3 [deprecated = true];
     * @deprecated
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
 * @generated from message xstockstrat.trading.v1.UpdateBrokerAccountCredentialsRequest
 */
export type UpdateBrokerAccountCredentialsRequest = Message<"xstockstrat.trading.v1.UpdateBrokerAccountCredentialsRequest"> & {
    /**
     * @generated from field: string account_id = 1;
     */
    accountId: string;
    /**
     * credentials_json uses the same broker-type-specific shape as
     * RegisterBrokerAccountRequest.credentials_json.
     *
     * @generated from field: string credentials_json = 2;
     */
    credentialsJson: string;
};
/**
 * Describes the message xstockstrat.trading.v1.UpdateBrokerAccountCredentialsRequest.
 * Use `create(UpdateBrokerAccountCredentialsRequestSchema)` to create a new message.
 */
export declare const UpdateBrokerAccountCredentialsRequestSchema: GenMessage<UpdateBrokerAccountCredentialsRequest>;
/**
 * @generated from message xstockstrat.trading.v1.UpdateBrokerAccountCredentialsResponse
 */
export type UpdateBrokerAccountCredentialsResponse = Message<"xstockstrat.trading.v1.UpdateBrokerAccountCredentialsResponse"> & {
    /**
     * @generated from field: xstockstrat.trading.v1.BrokerAccount account = 1;
     */
    account?: BrokerAccount | undefined;
};
/**
 * Describes the message xstockstrat.trading.v1.UpdateBrokerAccountCredentialsResponse.
 * Use `create(UpdateBrokerAccountCredentialsResponseSchema)` to create a new message.
 */
export declare const UpdateBrokerAccountCredentialsResponseSchema: GenMessage<UpdateBrokerAccountCredentialsResponse>;
/**
 * @generated from message xstockstrat.trading.v1.GetTradingEnvironmentRequest
 */
export type GetTradingEnvironmentRequest = Message<"xstockstrat.trading.v1.GetTradingEnvironmentRequest"> & {};
/**
 * Describes the message xstockstrat.trading.v1.GetTradingEnvironmentRequest.
 * Use `create(GetTradingEnvironmentRequestSchema)` to create a new message.
 */
export declare const GetTradingEnvironmentRequestSchema: GenMessage<GetTradingEnvironmentRequest>;
/**
 * @generated from message xstockstrat.trading.v1.GetTradingEnvironmentResponse
 */
export type GetTradingEnvironmentResponse = Message<"xstockstrat.trading.v1.GetTradingEnvironmentResponse"> & {
    /**
     * trading_mode is the mode every order in this deployment routes to.
     *
     * @generated from field: xstockstrat.common.v1.TradingMode trading_mode = 1;
     */
    tradingMode: TradingMode;
    /**
     * application_env: "development" | "production".
     *
     * @generated from field: string application_env = 2;
     */
    applicationEnv: string;
};
/**
 * Describes the message xstockstrat.trading.v1.GetTradingEnvironmentResponse.
 * Use `create(GetTradingEnvironmentResponseSchema)` to create a new message.
 */
export declare const GetTradingEnvironmentResponseSchema: GenMessage<GetTradingEnvironmentResponse>;
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
 * A single position row from a brokerage statement to be used as a baseline.
 *
 * @generated from message xstockstrat.trading.v1.PositionBaseline
 */
export type PositionBaseline = Message<"xstockstrat.trading.v1.PositionBaseline"> & {
    /**
     * @generated from field: string symbol = 1;
     */
    symbol: string;
    /**
     * signed: long +, short −
     *
     * @generated from field: double qty = 2;
     */
    qty: number;
    /**
     * @generated from field: double avg_cost_per_share = 3;
     */
    avgCostPerShare: number;
};
/**
 * Describes the message xstockstrat.trading.v1.PositionBaseline.
 * Use `create(PositionBaselineSchema)` to create a new message.
 */
export declare const PositionBaselineSchema: GenMessage<PositionBaseline>;
/**
 * Seeds (or replaces) the effective-dated opening baseline for an OFFLINE account.
 * client_snapshot_id is the replace/idempotency key: re-submitting the same ID
 * replaces the prior snapshot's rows atomically.
 *
 * @generated from message xstockstrat.trading.v1.SnapshotOfflinePositionsRequest
 */
export type SnapshotOfflinePositionsRequest = Message<"xstockstrat.trading.v1.SnapshotOfflinePositionsRequest"> & {
    /**
     * @generated from field: string account_id = 1;
     */
    accountId: string;
    /**
     * caller identity (ownership + reconciliation payload)
     *
     * @generated from field: string user_id = 2;
     */
    userId: string;
    /**
     * T0
     *
     * @generated from field: google.protobuf.Timestamp as_of = 3;
     */
    asOf?: Timestamp | undefined;
    /**
     * idempotency / replace key (UUID)
     *
     * @generated from field: string client_snapshot_id = 4;
     */
    clientSnapshotId: string;
    /**
     * @generated from field: repeated xstockstrat.trading.v1.PositionBaseline positions = 5;
     */
    positions: PositionBaseline[];
};
/**
 * Describes the message xstockstrat.trading.v1.SnapshotOfflinePositionsRequest.
 * Use `create(SnapshotOfflinePositionsRequestSchema)` to create a new message.
 */
export declare const SnapshotOfflinePositionsRequestSchema: GenMessage<SnapshotOfflinePositionsRequest>;
/**
 * A row that failed validation and was not committed.
 *
 * @generated from message xstockstrat.trading.v1.RejectedBaselineRow
 */
export type RejectedBaselineRow = Message<"xstockstrat.trading.v1.RejectedBaselineRow"> & {
    /**
     * @generated from field: int32 row_index = 1;
     */
    rowIndex: number;
    /**
     * @generated from field: string reason = 2;
     */
    reason: string;
};
/**
 * Describes the message xstockstrat.trading.v1.RejectedBaselineRow.
 * Use `create(RejectedBaselineRowSchema)` to create a new message.
 */
export declare const RejectedBaselineRowSchema: GenMessage<RejectedBaselineRow>;
/**
 * @generated from message xstockstrat.trading.v1.SnapshotOfflinePositionsResponse
 */
export type SnapshotOfflinePositionsResponse = Message<"xstockstrat.trading.v1.SnapshotOfflinePositionsResponse"> & {
    /**
     * @generated from field: string account_id = 1;
     */
    accountId: string;
    /**
     * @generated from field: int32 committed_count = 2;
     */
    committedCount: number;
    /**
     * @generated from field: repeated xstockstrat.trading.v1.RejectedBaselineRow rejected = 3;
     */
    rejected: RejectedBaselineRow[];
    /**
     * e.g. unconfirmed NEW-order advisory (design.md § Snapshot-over-NEW)
     *
     * @generated from field: repeated string warnings = 4;
     */
    warnings: string[];
};
/**
 * Describes the message xstockstrat.trading.v1.SnapshotOfflinePositionsResponse.
 * Use `create(SnapshotOfflinePositionsResponseSchema)` to create a new message.
 */
export declare const SnapshotOfflinePositionsResponseSchema: GenMessage<SnapshotOfflinePositionsResponse>;
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
 * CredentialStatus reflects the last known health of a broker account's stored
 * API credentials, so the UI can surface accounts whose secrets stopped working.
 *
 * @generated from enum xstockstrat.trading.v1.CredentialStatus
 */
export declare enum CredentialStatus {
    /**
     * never validated yet
     *
     * @generated from enum value: CREDENTIAL_STATUS_UNSPECIFIED = 0;
     */
    UNSPECIFIED = 0,
    /**
     * last validation succeeded
     *
     * @generated from enum value: CREDENTIAL_STATUS_OK = 1;
     */
    OK = 1,
    /**
     * broker rejected the credentials (auth failure)
     *
     * @generated from enum value: CREDENTIAL_STATUS_INVALID = 2;
     */
    INVALID = 2,
    /**
     * validation could not complete (transient/network error)
     *
     * @generated from enum value: CREDENTIAL_STATUS_UNKNOWN = 3;
     */
    UNKNOWN = 3
}
/**
 * Describes the enum xstockstrat.trading.v1.CredentialStatus.
 */
export declare const CredentialStatusSchema: GenEnum<CredentialStatus>;
/**
 * IntentState is the platform's own knowledge of whether a PlaceOrder/ReplaceOrder/
 * CancelOrder command actually reached the broker — orthogonal to OrderStatus (an order
 * can be NEW and also UNKNOWN simultaneously). See docs/roadmap/features/101-exactly-once-order-intent/design.md.
 *
 * @generated from enum xstockstrat.trading.v1.IntentState
 */
export declare enum IntentState {
    /**
     * @generated from enum value: INTENT_STATE_UNSPECIFIED = 0;
     */
    UNSPECIFIED = 0,
    /**
     * intent recorded, broker call not yet resolved
     *
     * @generated from enum value: INTENT_STATE_PENDING = 1;
     */
    PENDING = 1,
    /**
     * broker call resolved (accepted or a definite rejection)
     *
     * @generated from enum value: INTENT_STATE_COMPLETED = 2;
     */
    COMPLETED = 2,
    /**
     * definite, synchronous broker rejection (not a timeout)
     *
     * @generated from enum value: INTENT_STATE_REJECTED = 3;
     */
    REJECTED = 3,
    /**
     * broker outcome unknown — never retried automatically (FR-5)
     *
     * @generated from enum value: INTENT_STATE_UNKNOWN = 4;
     */
    UNKNOWN = 4
}
/**
 * Describes the enum xstockstrat.trading.v1.IntentState.
 */
export declare const IntentStateSchema: GenEnum<IntentState>;
/**
 * HaltSource distinguishes which automated mechanism halted an account — 030's
 * bracket-protection flatten failure vs. 102's broker-state-reconciliation mismatch — so an
 * operator (and the /trader UI) can tell which one fired without guessing from halt_reason's
 * free text alone.
 *
 * @generated from enum xstockstrat.trading.v1.HaltSource
 */
export declare enum HaltSource {
    /**
     * @generated from enum value: HALT_SOURCE_UNSPECIFIED = 0;
     */
    UNSPECIFIED = 0,
    /**
     * 030
     *
     * @generated from enum value: HALT_SOURCE_BRACKET_PROTECTION = 1;
     */
    BRACKET_PROTECTION = 1,
    /**
     * 102
     *
     * @generated from enum value: HALT_SOURCE_RECONCILIATION = 2;
     */
    RECONCILIATION = 2
}
/**
 * Describes the enum xstockstrat.trading.v1.HaltSource.
 */
export declare const HaltSourceSchema: GenEnum<HaltSource>;
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
     * ReplaceOrder modifies a working order's qty/price/TIF. It is broker-agnostic at
     * this surface and routes by the persisted order's broker_type
     * (Alpaca → PATCH /v2/orders/{id}; IBKR → adapter-specific modify). Allowed only
     * while the order is NEW or PARTIALLY_FILLED.
     *
     * @generated from rpc xstockstrat.trading.v1.TradingService.ReplaceOrder
     */
    replaceOrder: {
        methodKind: "unary";
        input: typeof ReplaceOrderRequestSchema;
        output: typeof OrderSchema;
    };
    /**
     * ConfirmOrder is OFFLINE-only (feature 157): it writes the fill fields a broker would
     * otherwise report (filled_qty/filled_avg_price/filled_at, and a server-derived status)
     * onto an order belonging to an offline account, then recomputes the account's positions.
     * It never contacts a broker and is rejected with FailedPrecondition for broker accounts.
     *
     * @generated from rpc xstockstrat.trading.v1.TradingService.ConfirmOrder
     */
    confirmOrder: {
        methodKind: "unary";
        input: typeof ConfirmOrderRequestSchema;
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
    /**
     * UpdateBrokerAccountCredentials replaces the stored API secrets for an existing
     * account, re-validates them against the broker, and refreshes credential_status.
     *
     * @generated from rpc xstockstrat.trading.v1.TradingService.UpdateBrokerAccountCredentials
     */
    updateBrokerAccountCredentials: {
        methodKind: "unary";
        input: typeof UpdateBrokerAccountCredentialsRequestSchema;
        output: typeof UpdateBrokerAccountCredentialsResponseSchema;
    };
    /**
     * GetTradingEnvironment reports the deployment-fixed trading mode. Users cannot
     * switch between paper and live — the environment owns this decision.
     *
     * @generated from rpc xstockstrat.trading.v1.TradingService.GetTradingEnvironment
     */
    getTradingEnvironment: {
        methodKind: "unary";
        input: typeof GetTradingEnvironmentRequestSchema;
        output: typeof GetTradingEnvironmentResponseSchema;
    };
    /**
     * SnapshotOfflinePositions records brokerage-statement period-end holdings as an
     * effective-dated opening baseline for an OFFLINE account (feature 163). Rejected
     * with FailedPrecondition for broker (Alpaca/IBKR) accounts.
     *
     * @generated from rpc xstockstrat.trading.v1.TradingService.SnapshotOfflinePositions
     */
    snapshotOfflinePositions: {
        methodKind: "unary";
        input: typeof SnapshotOfflinePositionsRequestSchema;
        output: typeof SnapshotOfflinePositionsResponseSchema;
    };
}>;

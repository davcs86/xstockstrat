import type { GenEnum, GenFile, GenMessage, GenService } from "@bufbuild/protobuf/codegenv2";
import type { Timestamp } from "@bufbuild/protobuf/wkt";
import type { PageRequest, PageResponse, TimeRange, TradingMode } from "../../common/v1/common_pb";
import type { Message } from "@bufbuild/protobuf";
/**
 * Describes the file portfolio/v1/portfolio.proto.
 */
export declare const file_portfolio_v1_portfolio: GenFile;
/**
 * @generated from message xstockstrat.portfolio.v1.Portfolio
 */
export type Portfolio = Message<"xstockstrat.portfolio.v1.Portfolio"> & {
    /**
     * @generated from field: string portfolio_id = 1;
     */
    portfolioId: string;
    /**
     * @generated from field: string user_id = 2;
     */
    userId: string;
    /**
     * @generated from field: double equity = 3;
     */
    equity: number;
    /**
     * @generated from field: double cash = 4;
     */
    cash: number;
    /**
     * @generated from field: double buying_power = 5;
     */
    buyingPower: number;
    /**
     * @generated from field: double day_pnl = 6;
     */
    dayPnl: number;
    /**
     * @generated from field: double day_pnl_pct = 7;
     */
    dayPnlPct: number;
    /**
     * @generated from field: double total_pnl = 8;
     */
    totalPnl: number;
    /**
     * @generated from field: google.protobuf.Timestamp updated_at = 9;
     */
    updatedAt?: Timestamp | undefined;
    /**
     * @generated from field: repeated xstockstrat.portfolio.v1.Position positions = 10;
     */
    positions: Position[];
    /**
     * @generated from field: string account_id = 11;
     */
    accountId: string;
};
/**
 * Describes the message xstockstrat.portfolio.v1.Portfolio.
 * Use `create(PortfolioSchema)` to create a new message.
 */
export declare const PortfolioSchema: GenMessage<Portfolio>;
/**
 * @generated from message xstockstrat.portfolio.v1.Position
 */
export type Position = Message<"xstockstrat.portfolio.v1.Position"> & {
    /**
     * @generated from field: string symbol = 1;
     */
    symbol: string;
    /**
     * @generated from field: double qty = 2;
     */
    qty: number;
    /**
     * @generated from field: double avg_entry_price = 3;
     */
    avgEntryPrice: number;
    /**
     * @generated from field: double current_price = 4;
     */
    currentPrice: number;
    /**
     * @generated from field: double market_value = 5;
     */
    marketValue: number;
    /**
     * @generated from field: double unrealized_pnl = 6;
     */
    unrealizedPnl: number;
    /**
     * @generated from field: double unrealized_pnl_pct = 7;
     */
    unrealizedPnlPct: number;
    /**
     * @generated from field: double cost_basis = 8;
     */
    costBasis: number;
    /**
     * @generated from field: google.protobuf.Timestamp opened_at = 9;
     */
    openedAt?: Timestamp | undefined;
    /**
     * @generated from field: xstockstrat.common.v1.TradingMode trading_mode = 10;
     */
    tradingMode: TradingMode;
    /**
     * @generated from field: string account_id = 11;
     */
    accountId: string;
    /**
     * Today's (intraday) P&L — change since the previous trading day's close.
     * Sourced from the broker's per-position intraday valuation (Alpaca
     * unrealized_intraday_pl / unrealized_intraday_plpc) on account.positions.synced.
     * Zero when the broker does not report an intraday figure (e.g. order-fill-only
     * positions enriched from marketdata mid-quotes); distinct from unrealized_pnl,
     * which is total P&L since entry.
     *
     * dollars
     *
     * @generated from field: double day_pnl = 12;
     */
    dayPnl: number;
    /**
     * fraction (e.g. 0.0125 = +1.25%)
     *
     * @generated from field: double day_pnl_pct = 13;
     */
    dayPnlPct: number;
};
/**
 * Describes the message xstockstrat.portfolio.v1.Position.
 * Use `create(PositionSchema)` to create a new message.
 */
export declare const PositionSchema: GenMessage<Position>;
/**
 * @generated from message xstockstrat.portfolio.v1.PortfolioSnapshot
 */
export type PortfolioSnapshot = Message<"xstockstrat.portfolio.v1.PortfolioSnapshot"> & {
    /**
     * @generated from field: string portfolio_id = 1;
     */
    portfolioId: string;
    /**
     * @generated from field: google.protobuf.Timestamp snapshot_time = 2;
     */
    snapshotTime?: Timestamp | undefined;
    /**
     * @generated from field: double equity = 3;
     */
    equity: number;
    /**
     * @generated from field: double cash = 4;
     */
    cash: number;
    /**
     * @generated from field: double day_pnl = 5;
     */
    dayPnl: number;
    /**
     * @generated from field: int32 open_positions = 6;
     */
    openPositions: number;
    /**
     * @generated from field: xstockstrat.common.v1.TradingMode trading_mode = 7;
     */
    tradingMode: TradingMode;
    /**
     * @generated from field: string account_id = 8;
     */
    accountId: string;
};
/**
 * Describes the message xstockstrat.portfolio.v1.PortfolioSnapshot.
 * Use `create(PortfolioSnapshotSchema)` to create a new message.
 */
export declare const PortfolioSnapshotSchema: GenMessage<PortfolioSnapshot>;
/**
 * @generated from message xstockstrat.portfolio.v1.PnLResponse
 */
export type PnLResponse = Message<"xstockstrat.portfolio.v1.PnLResponse"> & {
    /**
     * @generated from field: double realized_pnl = 1;
     */
    realizedPnl: number;
    /**
     * @generated from field: double unrealized_pnl = 2;
     */
    unrealizedPnl: number;
    /**
     * @generated from field: double total_pnl = 3;
     */
    totalPnl: number;
    /**
     * @generated from field: double day_pnl = 4;
     */
    dayPnl: number;
    /**
     * @generated from field: xstockstrat.common.v1.TimeRange range = 5;
     */
    range?: TimeRange | undefined;
};
/**
 * Describes the message xstockstrat.portfolio.v1.PnLResponse.
 * Use `create(PnLResponseSchema)` to create a new message.
 */
export declare const PnLResponseSchema: GenMessage<PnLResponse>;
/**
 * If trading_mode is UNSPECIFIED, returns positions for all modes.
 *
 * @generated from message xstockstrat.portfolio.v1.GetPortfolioRequest
 */
export type GetPortfolioRequest = Message<"xstockstrat.portfolio.v1.GetPortfolioRequest"> & {
    /**
     * @generated from field: string user_id = 1;
     */
    userId: string;
    /**
     * @generated from field: xstockstrat.common.v1.TradingMode trading_mode = 2;
     */
    tradingMode: TradingMode;
    /**
     * @generated from field: optional string account_id = 3;
     */
    accountId?: string | undefined;
};
/**
 * Describes the message xstockstrat.portfolio.v1.GetPortfolioRequest.
 * Use `create(GetPortfolioRequestSchema)` to create a new message.
 */
export declare const GetPortfolioRequestSchema: GenMessage<GetPortfolioRequest>;
/**
 * @generated from message xstockstrat.portfolio.v1.GetPositionRequest
 */
export type GetPositionRequest = Message<"xstockstrat.portfolio.v1.GetPositionRequest"> & {
    /**
     * @generated from field: string user_id = 1;
     */
    userId: string;
    /**
     * @generated from field: string symbol = 2;
     */
    symbol: string;
    /**
     * @generated from field: xstockstrat.common.v1.TradingMode trading_mode = 3;
     */
    tradingMode: TradingMode;
    /**
     * @generated from field: optional string account_id = 4;
     */
    accountId?: string | undefined;
};
/**
 * Describes the message xstockstrat.portfolio.v1.GetPositionRequest.
 * Use `create(GetPositionRequestSchema)` to create a new message.
 */
export declare const GetPositionRequestSchema: GenMessage<GetPositionRequest>;
/**
 * @generated from message xstockstrat.portfolio.v1.ListPositionsRequest
 */
export type ListPositionsRequest = Message<"xstockstrat.portfolio.v1.ListPositionsRequest"> & {
    /**
     * @generated from field: string user_id = 1;
     */
    userId: string;
    /**
     * @generated from field: xstockstrat.common.v1.PageRequest page = 2;
     */
    page?: PageRequest | undefined;
    /**
     * Filter by trading mode; UNSPECIFIED returns all positions.
     *
     * @generated from field: xstockstrat.common.v1.TradingMode trading_mode = 3;
     */
    tradingMode: TradingMode;
    /**
     * @generated from field: optional string account_id = 4;
     */
    accountId?: string | undefined;
    /**
     * Additive filters (feature 056). Empty symbol / UNSPECIFIED side = no narrowing.
     *
     * exact-match symbol filter; "" = all symbols
     *
     * @generated from field: string symbol = 5;
     */
    symbol: string;
    /**
     * long/short filter derived from qty sign
     *
     * @generated from field: xstockstrat.portfolio.v1.PositionSide side = 6;
     */
    side: PositionSide;
};
/**
 * Describes the message xstockstrat.portfolio.v1.ListPositionsRequest.
 * Use `create(ListPositionsRequestSchema)` to create a new message.
 */
export declare const ListPositionsRequestSchema: GenMessage<ListPositionsRequest>;
/**
 * @generated from message xstockstrat.portfolio.v1.ListPositionsResponse
 */
export type ListPositionsResponse = Message<"xstockstrat.portfolio.v1.ListPositionsResponse"> & {
    /**
     * @generated from field: repeated xstockstrat.portfolio.v1.Position positions = 1;
     */
    positions: Position[];
    /**
     * @generated from field: xstockstrat.common.v1.PageResponse page = 2;
     */
    page?: PageResponse | undefined;
};
/**
 * Describes the message xstockstrat.portfolio.v1.ListPositionsResponse.
 * Use `create(ListPositionsResponseSchema)` to create a new message.
 */
export declare const ListPositionsResponseSchema: GenMessage<ListPositionsResponse>;
/**
 * @generated from message xstockstrat.portfolio.v1.GetPnLRequest
 */
export type GetPnLRequest = Message<"xstockstrat.portfolio.v1.GetPnLRequest"> & {
    /**
     * @generated from field: string user_id = 1;
     */
    userId: string;
    /**
     * @generated from field: xstockstrat.common.v1.TimeRange range = 2;
     */
    range?: TimeRange | undefined;
    /**
     * Filter by trading mode; UNSPECIFIED returns combined P&L.
     *
     * @generated from field: xstockstrat.common.v1.TradingMode trading_mode = 3;
     */
    tradingMode: TradingMode;
    /**
     * @generated from field: optional string account_id = 4;
     */
    accountId?: string | undefined;
};
/**
 * Describes the message xstockstrat.portfolio.v1.GetPnLRequest.
 * Use `create(GetPnLRequestSchema)` to create a new message.
 */
export declare const GetPnLRequestSchema: GenMessage<GetPnLRequest>;
/**
 * @generated from message xstockstrat.portfolio.v1.GetSnapshotRequest
 */
export type GetSnapshotRequest = Message<"xstockstrat.portfolio.v1.GetSnapshotRequest"> & {
    /**
     * @generated from field: string portfolio_id = 1;
     */
    portfolioId: string;
    /**
     * @generated from field: google.protobuf.Timestamp at_time = 2;
     */
    atTime?: Timestamp | undefined;
    /**
     * @generated from field: optional string account_id = 3;
     */
    accountId?: string | undefined;
};
/**
 * Describes the message xstockstrat.portfolio.v1.GetSnapshotRequest.
 * Use `create(GetSnapshotRequestSchema)` to create a new message.
 */
export declare const GetSnapshotRequestSchema: GenMessage<GetSnapshotRequest>;
/**
 * @generated from message xstockstrat.portfolio.v1.StreamPortfolioUpdatesRequest
 */
export type StreamPortfolioUpdatesRequest = Message<"xstockstrat.portfolio.v1.StreamPortfolioUpdatesRequest"> & {
    /**
     * @generated from field: string user_id = 1;
     */
    userId: string;
    /**
     * Filter by trading mode; UNSPECIFIED streams all modes.
     *
     * @generated from field: xstockstrat.common.v1.TradingMode trading_mode = 2;
     */
    tradingMode: TradingMode;
    /**
     * @generated from field: optional string account_id = 3;
     */
    accountId?: string | undefined;
};
/**
 * Describes the message xstockstrat.portfolio.v1.StreamPortfolioUpdatesRequest.
 * Use `create(StreamPortfolioUpdatesRequestSchema)` to create a new message.
 */
export declare const StreamPortfolioUpdatesRequestSchema: GenMessage<StreamPortfolioUpdatesRequest>;
/**
 * @generated from message xstockstrat.portfolio.v1.ListPortfoliosRequest
 */
export type ListPortfoliosRequest = Message<"xstockstrat.portfolio.v1.ListPortfoliosRequest"> & {
    /**
     * @generated from field: optional string account_id = 1;
     */
    accountId?: string | undefined;
};
/**
 * Describes the message xstockstrat.portfolio.v1.ListPortfoliosRequest.
 * Use `create(ListPortfoliosRequestSchema)` to create a new message.
 */
export declare const ListPortfoliosRequestSchema: GenMessage<ListPortfoliosRequest>;
/**
 * @generated from message xstockstrat.portfolio.v1.ListPortfoliosResponse
 */
export type ListPortfoliosResponse = Message<"xstockstrat.portfolio.v1.ListPortfoliosResponse"> & {
    /**
     * @generated from field: repeated xstockstrat.portfolio.v1.Portfolio portfolios = 1;
     */
    portfolios: Portfolio[];
};
/**
 * Describes the message xstockstrat.portfolio.v1.ListPortfoliosResponse.
 * Use `create(ListPortfoliosResponseSchema)` to create a new message.
 */
export declare const ListPortfoliosResponseSchema: GenMessage<ListPortfoliosResponse>;
/**
 * Watchlist (feature 058) — a mode-agnostic, user-owned named set of symbols.
 *
 * @generated from message xstockstrat.portfolio.v1.Watchlist
 */
export type Watchlist = Message<"xstockstrat.portfolio.v1.Watchlist"> & {
    /**
     * @generated from field: string watchlist_id = 1;
     */
    watchlistId: string;
    /**
     * @generated from field: string user_id = 2;
     */
    userId: string;
    /**
     * @generated from field: string name = 3;
     */
    name: string;
    /**
     * @generated from field: string description = 4;
     */
    description: string;
    /**
     * @generated from field: repeated string symbols = 5;
     */
    symbols: string[];
    /**
     * @generated from field: google.protobuf.Timestamp created_at = 6;
     */
    createdAt?: Timestamp | undefined;
    /**
     * @generated from field: google.protobuf.Timestamp updated_at = 7;
     */
    updatedAt?: Timestamp | undefined;
};
/**
 * Describes the message xstockstrat.portfolio.v1.Watchlist.
 * Use `create(WatchlistSchema)` to create a new message.
 */
export declare const WatchlistSchema: GenMessage<Watchlist>;
/**
 * user_id is intentionally absent from all request messages — ownership is taken
 * from the propagated x-user-id header server-side (FR-2), never from the wire.
 *
 * @generated from message xstockstrat.portfolio.v1.CreateWatchlistRequest
 */
export type CreateWatchlistRequest = Message<"xstockstrat.portfolio.v1.CreateWatchlistRequest"> & {
    /**
     * @generated from field: string name = 1;
     */
    name: string;
    /**
     * @generated from field: string description = 2;
     */
    description: string;
    /**
     * @generated from field: repeated string symbols = 3;
     */
    symbols: string[];
};
/**
 * Describes the message xstockstrat.portfolio.v1.CreateWatchlistRequest.
 * Use `create(CreateWatchlistRequestSchema)` to create a new message.
 */
export declare const CreateWatchlistRequestSchema: GenMessage<CreateWatchlistRequest>;
/**
 * @generated from message xstockstrat.portfolio.v1.CreateWatchlistResponse
 */
export type CreateWatchlistResponse = Message<"xstockstrat.portfolio.v1.CreateWatchlistResponse"> & {
    /**
     * @generated from field: xstockstrat.portfolio.v1.Watchlist watchlist = 1;
     */
    watchlist?: Watchlist | undefined;
};
/**
 * Describes the message xstockstrat.portfolio.v1.CreateWatchlistResponse.
 * Use `create(CreateWatchlistResponseSchema)` to create a new message.
 */
export declare const CreateWatchlistResponseSchema: GenMessage<CreateWatchlistResponse>;
/**
 * @generated from message xstockstrat.portfolio.v1.GetWatchlistRequest
 */
export type GetWatchlistRequest = Message<"xstockstrat.portfolio.v1.GetWatchlistRequest"> & {
    /**
     * @generated from field: string watchlist_id = 1;
     */
    watchlistId: string;
};
/**
 * Describes the message xstockstrat.portfolio.v1.GetWatchlistRequest.
 * Use `create(GetWatchlistRequestSchema)` to create a new message.
 */
export declare const GetWatchlistRequestSchema: GenMessage<GetWatchlistRequest>;
/**
 * @generated from message xstockstrat.portfolio.v1.GetWatchlistResponse
 */
export type GetWatchlistResponse = Message<"xstockstrat.portfolio.v1.GetWatchlistResponse"> & {
    /**
     * @generated from field: xstockstrat.portfolio.v1.Watchlist watchlist = 1;
     */
    watchlist?: Watchlist | undefined;
};
/**
 * Describes the message xstockstrat.portfolio.v1.GetWatchlistResponse.
 * Use `create(GetWatchlistResponseSchema)` to create a new message.
 */
export declare const GetWatchlistResponseSchema: GenMessage<GetWatchlistResponse>;
/**
 * @generated from message xstockstrat.portfolio.v1.ListWatchlistsRequest
 */
export type ListWatchlistsRequest = Message<"xstockstrat.portfolio.v1.ListWatchlistsRequest"> & {
    /**
     * @generated from field: xstockstrat.common.v1.PageRequest page = 1;
     */
    page?: PageRequest | undefined;
};
/**
 * Describes the message xstockstrat.portfolio.v1.ListWatchlistsRequest.
 * Use `create(ListWatchlistsRequestSchema)` to create a new message.
 */
export declare const ListWatchlistsRequestSchema: GenMessage<ListWatchlistsRequest>;
/**
 * @generated from message xstockstrat.portfolio.v1.ListWatchlistsResponse
 */
export type ListWatchlistsResponse = Message<"xstockstrat.portfolio.v1.ListWatchlistsResponse"> & {
    /**
     * @generated from field: repeated xstockstrat.portfolio.v1.Watchlist watchlists = 1;
     */
    watchlists: Watchlist[];
    /**
     * @generated from field: xstockstrat.common.v1.PageResponse page = 2;
     */
    page?: PageResponse | undefined;
};
/**
 * Describes the message xstockstrat.portfolio.v1.ListWatchlistsResponse.
 * Use `create(ListWatchlistsResponseSchema)` to create a new message.
 */
export declare const ListWatchlistsResponseSchema: GenMessage<ListWatchlistsResponse>;
/**
 * Replace semantics for name/description/symbols per FR-1.
 *
 * @generated from message xstockstrat.portfolio.v1.UpdateWatchlistRequest
 */
export type UpdateWatchlistRequest = Message<"xstockstrat.portfolio.v1.UpdateWatchlistRequest"> & {
    /**
     * @generated from field: string watchlist_id = 1;
     */
    watchlistId: string;
    /**
     * @generated from field: string name = 2;
     */
    name: string;
    /**
     * @generated from field: string description = 3;
     */
    description: string;
    /**
     * @generated from field: repeated string symbols = 4;
     */
    symbols: string[];
};
/**
 * Describes the message xstockstrat.portfolio.v1.UpdateWatchlistRequest.
 * Use `create(UpdateWatchlistRequestSchema)` to create a new message.
 */
export declare const UpdateWatchlistRequestSchema: GenMessage<UpdateWatchlistRequest>;
/**
 * @generated from message xstockstrat.portfolio.v1.UpdateWatchlistResponse
 */
export type UpdateWatchlistResponse = Message<"xstockstrat.portfolio.v1.UpdateWatchlistResponse"> & {
    /**
     * @generated from field: xstockstrat.portfolio.v1.Watchlist watchlist = 1;
     */
    watchlist?: Watchlist | undefined;
};
/**
 * Describes the message xstockstrat.portfolio.v1.UpdateWatchlistResponse.
 * Use `create(UpdateWatchlistResponseSchema)` to create a new message.
 */
export declare const UpdateWatchlistResponseSchema: GenMessage<UpdateWatchlistResponse>;
/**
 * @generated from message xstockstrat.portfolio.v1.DeleteWatchlistRequest
 */
export type DeleteWatchlistRequest = Message<"xstockstrat.portfolio.v1.DeleteWatchlistRequest"> & {
    /**
     * @generated from field: string watchlist_id = 1;
     */
    watchlistId: string;
};
/**
 * Describes the message xstockstrat.portfolio.v1.DeleteWatchlistRequest.
 * Use `create(DeleteWatchlistRequestSchema)` to create a new message.
 */
export declare const DeleteWatchlistRequestSchema: GenMessage<DeleteWatchlistRequest>;
/**
 * @generated from message xstockstrat.portfolio.v1.DeleteWatchlistResponse
 */
export type DeleteWatchlistResponse = Message<"xstockstrat.portfolio.v1.DeleteWatchlistResponse"> & {};
/**
 * Describes the message xstockstrat.portfolio.v1.DeleteWatchlistResponse.
 * Use `create(DeleteWatchlistResponseSchema)` to create a new message.
 */
export declare const DeleteWatchlistResponseSchema: GenMessage<DeleteWatchlistResponse>;
/**
 * @generated from message xstockstrat.portfolio.v1.AddWatchlistSymbolsRequest
 */
export type AddWatchlistSymbolsRequest = Message<"xstockstrat.portfolio.v1.AddWatchlistSymbolsRequest"> & {
    /**
     * @generated from field: string watchlist_id = 1;
     */
    watchlistId: string;
    /**
     * @generated from field: repeated string symbols = 2;
     */
    symbols: string[];
};
/**
 * Describes the message xstockstrat.portfolio.v1.AddWatchlistSymbolsRequest.
 * Use `create(AddWatchlistSymbolsRequestSchema)` to create a new message.
 */
export declare const AddWatchlistSymbolsRequestSchema: GenMessage<AddWatchlistSymbolsRequest>;
/**
 * @generated from message xstockstrat.portfolio.v1.AddWatchlistSymbolsResponse
 */
export type AddWatchlistSymbolsResponse = Message<"xstockstrat.portfolio.v1.AddWatchlistSymbolsResponse"> & {
    /**
     * @generated from field: xstockstrat.portfolio.v1.Watchlist watchlist = 1;
     */
    watchlist?: Watchlist | undefined;
};
/**
 * Describes the message xstockstrat.portfolio.v1.AddWatchlistSymbolsResponse.
 * Use `create(AddWatchlistSymbolsResponseSchema)` to create a new message.
 */
export declare const AddWatchlistSymbolsResponseSchema: GenMessage<AddWatchlistSymbolsResponse>;
/**
 * @generated from message xstockstrat.portfolio.v1.RemoveWatchlistSymbolsRequest
 */
export type RemoveWatchlistSymbolsRequest = Message<"xstockstrat.portfolio.v1.RemoveWatchlistSymbolsRequest"> & {
    /**
     * @generated from field: string watchlist_id = 1;
     */
    watchlistId: string;
    /**
     * @generated from field: repeated string symbols = 2;
     */
    symbols: string[];
};
/**
 * Describes the message xstockstrat.portfolio.v1.RemoveWatchlistSymbolsRequest.
 * Use `create(RemoveWatchlistSymbolsRequestSchema)` to create a new message.
 */
export declare const RemoveWatchlistSymbolsRequestSchema: GenMessage<RemoveWatchlistSymbolsRequest>;
/**
 * @generated from message xstockstrat.portfolio.v1.RemoveWatchlistSymbolsResponse
 */
export type RemoveWatchlistSymbolsResponse = Message<"xstockstrat.portfolio.v1.RemoveWatchlistSymbolsResponse"> & {
    /**
     * @generated from field: xstockstrat.portfolio.v1.Watchlist watchlist = 1;
     */
    watchlist?: Watchlist | undefined;
};
/**
 * Describes the message xstockstrat.portfolio.v1.RemoveWatchlistSymbolsResponse.
 * Use `create(RemoveWatchlistSymbolsResponseSchema)` to create a new message.
 */
export declare const RemoveWatchlistSymbolsResponseSchema: GenMessage<RemoveWatchlistSymbolsResponse>;
/**
 * PositionSide distinguishes a long (qty > 0) from a short (qty < 0) position.
 * Used only as an additive filter on ListPositionsRequest; the Position message itself
 * continues to carry signed qty.
 *
 * @generated from enum xstockstrat.portfolio.v1.PositionSide
 */
export declare enum PositionSide {
    /**
     * no side filter — return both long and short
     *
     * @generated from enum value: POSITION_SIDE_UNSPECIFIED = 0;
     */
    UNSPECIFIED = 0,
    /**
     * qty > 0
     *
     * @generated from enum value: POSITION_SIDE_LONG = 1;
     */
    LONG = 1,
    /**
     * qty < 0
     *
     * @generated from enum value: POSITION_SIDE_SHORT = 2;
     */
    SHORT = 2
}
/**
 * Describes the enum xstockstrat.portfolio.v1.PositionSide.
 */
export declare const PositionSideSchema: GenEnum<PositionSide>;
/**
 * @generated from service xstockstrat.portfolio.v1.PortfolioService
 */
export declare const PortfolioService: GenService<{
    /**
     * @generated from rpc xstockstrat.portfolio.v1.PortfolioService.GetPortfolio
     */
    getPortfolio: {
        methodKind: "unary";
        input: typeof GetPortfolioRequestSchema;
        output: typeof PortfolioSchema;
    };
    /**
     * @generated from rpc xstockstrat.portfolio.v1.PortfolioService.GetPosition
     */
    getPosition: {
        methodKind: "unary";
        input: typeof GetPositionRequestSchema;
        output: typeof PositionSchema;
    };
    /**
     * @generated from rpc xstockstrat.portfolio.v1.PortfolioService.ListPositions
     */
    listPositions: {
        methodKind: "unary";
        input: typeof ListPositionsRequestSchema;
        output: typeof ListPositionsResponseSchema;
    };
    /**
     * @generated from rpc xstockstrat.portfolio.v1.PortfolioService.GetPnL
     */
    getPnL: {
        methodKind: "unary";
        input: typeof GetPnLRequestSchema;
        output: typeof PnLResponseSchema;
    };
    /**
     * @generated from rpc xstockstrat.portfolio.v1.PortfolioService.GetSnapshot
     */
    getSnapshot: {
        methodKind: "unary";
        input: typeof GetSnapshotRequestSchema;
        output: typeof PortfolioSnapshotSchema;
    };
    /**
     * @generated from rpc xstockstrat.portfolio.v1.PortfolioService.StreamPortfolioUpdates
     */
    streamPortfolioUpdates: {
        methodKind: "server_streaming";
        input: typeof StreamPortfolioUpdatesRequestSchema;
        output: typeof PortfolioSnapshotSchema;
    };
    /**
     * @generated from rpc xstockstrat.portfolio.v1.PortfolioService.ListPortfolios
     */
    listPortfolios: {
        methodKind: "unary";
        input: typeof ListPortfoliosRequestSchema;
        output: typeof ListPortfoliosResponseSchema;
    };
    /**
     * Watchlist management (feature 058). Additive — ownership is taken from the
     * propagated x-user-id header server-side, never from request fields.
     *
     * @generated from rpc xstockstrat.portfolio.v1.PortfolioService.CreateWatchlist
     */
    createWatchlist: {
        methodKind: "unary";
        input: typeof CreateWatchlistRequestSchema;
        output: typeof CreateWatchlistResponseSchema;
    };
    /**
     * @generated from rpc xstockstrat.portfolio.v1.PortfolioService.GetWatchlist
     */
    getWatchlist: {
        methodKind: "unary";
        input: typeof GetWatchlistRequestSchema;
        output: typeof GetWatchlistResponseSchema;
    };
    /**
     * @generated from rpc xstockstrat.portfolio.v1.PortfolioService.ListWatchlists
     */
    listWatchlists: {
        methodKind: "unary";
        input: typeof ListWatchlistsRequestSchema;
        output: typeof ListWatchlistsResponseSchema;
    };
    /**
     * @generated from rpc xstockstrat.portfolio.v1.PortfolioService.UpdateWatchlist
     */
    updateWatchlist: {
        methodKind: "unary";
        input: typeof UpdateWatchlistRequestSchema;
        output: typeof UpdateWatchlistResponseSchema;
    };
    /**
     * @generated from rpc xstockstrat.portfolio.v1.PortfolioService.DeleteWatchlist
     */
    deleteWatchlist: {
        methodKind: "unary";
        input: typeof DeleteWatchlistRequestSchema;
        output: typeof DeleteWatchlistResponseSchema;
    };
    /**
     * @generated from rpc xstockstrat.portfolio.v1.PortfolioService.AddWatchlistSymbols
     */
    addWatchlistSymbols: {
        methodKind: "unary";
        input: typeof AddWatchlistSymbolsRequestSchema;
        output: typeof AddWatchlistSymbolsResponseSchema;
    };
    /**
     * @generated from rpc xstockstrat.portfolio.v1.PortfolioService.RemoveWatchlistSymbols
     */
    removeWatchlistSymbols: {
        methodKind: "unary";
        input: typeof RemoveWatchlistSymbolsRequestSchema;
        output: typeof RemoveWatchlistSymbolsResponseSchema;
    };
}>;

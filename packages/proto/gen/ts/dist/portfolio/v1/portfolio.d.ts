import { BinaryReader, BinaryWriter } from "@bufbuild/protobuf/wire";
import { type CallOptions, type ChannelCredentials, Client, type ClientOptions, type ClientReadableStream, type ClientUnaryCall, type handleServerStreamingCall, type handleUnaryCall, type Metadata, type ServiceError, type UntypedServiceImplementation } from "@grpc/grpc-js";
import { PageRequest, PageResponse, TimeRange, TradingMode } from "../../common/v1/common";
export declare const protobufPackage = "xstockstrat.portfolio.v1";
/** A risk cue surfaced on the Exposure surface (feature 083). Closed set → enum (C-04). */
export declare enum PositionRiskFlag {
    POSITION_RISK_FLAG_UNSPECIFIED = "POSITION_RISK_FLAG_UNSPECIFIED",
    /** POSITION_RISK_FLAG_ADD_SIGNAL - a buy signal is live for this held symbol */
    POSITION_RISK_FLAG_ADD_SIGNAL = "POSITION_RISK_FLAG_ADD_SIGNAL",
    /** POSITION_RISK_FLAG_REDUCE_SIGNAL - a sell signal is live for this held symbol */
    POSITION_RISK_FLAG_REDUCE_SIGNAL = "POSITION_RISK_FLAG_REDUCE_SIGNAL",
    /** POSITION_RISK_FLAG_STOP_NEAR - stop-distance within the near threshold */
    POSITION_RISK_FLAG_STOP_NEAR = "POSITION_RISK_FLAG_STOP_NEAR",
    UNRECOGNIZED = "UNRECOGNIZED"
}
export declare function positionRiskFlagFromJSON(object: any): PositionRiskFlag;
export declare function positionRiskFlagToJSON(object: PositionRiskFlag): string;
export declare function positionRiskFlagToNumber(object: PositionRiskFlag): number;
/**
 * PositionSource indicates how a position was seeded (feature 163 — snapshot-offline-positions).
 * Per-symbol: ORDERS = built purely from confirmed fills; BASELINE = snapshot-seeded with no
 * post-T0 fills; MIXED = baseline-seeded with ≥1 post-T0 fill folded in.
 */
export declare enum PositionSource {
    POSITION_SOURCE_UNSPECIFIED = "POSITION_SOURCE_UNSPECIFIED",
    POSITION_SOURCE_ORDERS = "POSITION_SOURCE_ORDERS",
    POSITION_SOURCE_BASELINE = "POSITION_SOURCE_BASELINE",
    POSITION_SOURCE_MIXED = "POSITION_SOURCE_MIXED",
    UNRECOGNIZED = "UNRECOGNIZED"
}
export declare function positionSourceFromJSON(object: any): PositionSource;
export declare function positionSourceToJSON(object: PositionSource): string;
export declare function positionSourceToNumber(object: PositionSource): number;
/**
 * PositionSide distinguishes a long (qty > 0) from a short (qty < 0) position.
 * Used only as an additive filter on ListPositionsRequest; the Position message itself
 * continues to carry signed qty.
 */
export declare enum PositionSide {
    /** POSITION_SIDE_UNSPECIFIED - no side filter — return both long and short */
    POSITION_SIDE_UNSPECIFIED = "POSITION_SIDE_UNSPECIFIED",
    /** POSITION_SIDE_LONG - qty > 0 */
    POSITION_SIDE_LONG = "POSITION_SIDE_LONG",
    /** POSITION_SIDE_SHORT - qty < 0 */
    POSITION_SIDE_SHORT = "POSITION_SIDE_SHORT",
    UNRECOGNIZED = "UNRECOGNIZED"
}
export declare function positionSideFromJSON(object: any): PositionSide;
export declare function positionSideToJSON(object: PositionSide): string;
export declare function positionSideToNumber(object: PositionSide): number;
/** Provenance of a watchlist entry (feature 127). Consumers default UNSPECIFIED→MANUAL. */
export declare enum WatchlistEntrySource {
    WATCHLIST_ENTRY_SOURCE_UNSPECIFIED = "WATCHLIST_ENTRY_SOURCE_UNSPECIFIED",
    WATCHLIST_ENTRY_SOURCE_MANUAL = "WATCHLIST_ENTRY_SOURCE_MANUAL",
    WATCHLIST_ENTRY_SOURCE_SIGNAL = "WATCHLIST_ENTRY_SOURCE_SIGNAL",
    UNRECOGNIZED = "UNRECOGNIZED"
}
export declare function watchlistEntrySourceFromJSON(object: any): WatchlistEntrySource;
export declare function watchlistEntrySourceToJSON(object: WatchlistEntrySource): string;
export declare function watchlistEntrySourceToNumber(object: WatchlistEntrySource): number;
export interface Portfolio {
    portfolioId: string;
    userId: string;
    equity: number;
    cash: number;
    buyingPower: number;
    dayPnl: number;
    dayPnlPct: number;
    totalPnl: number;
    updatedAt?: Date | undefined;
    positions: Position[];
    accountId: string;
    /**
     * realized_pnl is the account-grain cumulative realized P&L. Set only for OFFLINE accounts
     * (feature 157); `optional` for proto3 explicit presence so an offline account's genuine $0
     * is distinguishable from a broker account's unset. Broker cards leave it unset.
     */
    realizedPnl?: number | undefined;
}
export interface Position {
    symbol: string;
    qty: number;
    avgEntryPrice: number;
    currentPrice: number;
    marketValue: number;
    unrealizedPnl: number;
    unrealizedPnlPct: number;
    costBasis: number;
    openedAt?: Date | undefined;
    tradingMode: TradingMode;
    accountId: string;
    /**
     * Today's (intraday) P&L — change since the previous trading day's close.
     * Sourced from the broker's per-position intraday valuation (Alpaca
     * unrealized_intraday_pl / unrealized_intraday_plpc) on account.positions.synced.
     * Zero when the broker does not report an intraday figure (e.g. order-fill-only
     * positions enriched from marketdata mid-quotes); distinct from unrealized_pnl,
     * which is total P&L since entry.
     */
    dayPnl: number;
    /** fraction (e.g. 0.0125 = +1.25%) */
    dayPnlPct: number;
    /**
     * ── Risk / factor fields (feature 083 — Book → Exposure) ─────────────────────
     * Resting-stop price learned from trading's order events via the ledger (no
     * portfolio→trading synchronous edge; held in-memory, rebuilt on boot-replay).
     * risk_at_stop / stop_distance_pct are computed on read off the broker-authoritative
     * current_price: stop_distance_pct = (current_price − stop_price) / current_price.
     */
    stopPrice: number;
    riskAtStop: number;
    stopDistancePct: number;
    /**
     * factor grouping from the portfolio.exposure.factor_map config key (marketdata
     * exposes no sector); "" → UI groups as "Unclassified".
     */
    factor: string;
    flag: PositionRiskFlag;
    exitRule: string;
    /**
     * Broker order IDs for the resting protective bracket legs (feature 030 —
     * stop-loss-bracket-orders), sourced from trading's order.bracket_updated ledger
     * events. "" when the position has no active bracket (manual entry, bracket
     * disabled, or bracket not yet confirmed ACTIVE).
     */
    stopOrderId: string;
    takeProfitOrderId: string;
    /**
     * ── Provenance (feature 163 — snapshot-offline-positions) ──────────────────
     * as_of is the effective date of the baseline snapshot that seeded this position
     * (T0); unset for pure-order positions.
     */
    asOf?: Date | undefined;
    /**
     * source indicates how the position was constructed: ORDERS (fill-only),
     * BASELINE (snapshot-only), or MIXED (baseline + post-T0 fills).
     */
    source: PositionSource;
}
export interface PortfolioSnapshot {
    portfolioId: string;
    snapshotTime?: Date | undefined;
    equity: number;
    cash: number;
    dayPnl: number;
    openPositions: number;
    tradingMode: TradingMode;
    accountId: string;
}
export interface PnLResponse {
    realizedPnl: number;
    unrealizedPnl: number;
    totalPnl: number;
    dayPnl: number;
    range?: TimeRange | undefined;
}
/** If trading_mode is UNSPECIFIED, returns positions for all modes. */
export interface GetPortfolioRequest {
    /**
     * DEPRECATED: caller identity resolved from the x-user-id header; body value ignored.
     *
     * @deprecated
     */
    userId: string;
    tradingMode: TradingMode;
    accountId?: string | undefined;
}
export interface GetPositionRequest {
    /**
     * DEPRECATED: caller identity resolved from the x-user-id header; body value ignored.
     *
     * @deprecated
     */
    userId: string;
    symbol: string;
    tradingMode: TradingMode;
    accountId?: string | undefined;
}
export interface ListPositionsRequest {
    /**
     * DEPRECATED: caller identity resolved from the x-user-id header; body value ignored.
     *
     * @deprecated
     */
    userId: string;
    page?: PageRequest | undefined;
    /** Filter by trading mode; UNSPECIFIED returns all positions. */
    tradingMode: TradingMode;
    accountId?: string | undefined;
    /** Additive filters (feature 056). Empty symbol / UNSPECIFIED side = no narrowing. */
    symbol: string;
    /** long/short filter derived from qty sign */
    side: PositionSide;
}
export interface ListPositionsResponse {
    positions: Position[];
    page?: PageResponse | undefined;
}
export interface GetPnLRequest {
    /**
     * DEPRECATED: caller identity resolved from the x-user-id header; body value ignored.
     *
     * @deprecated
     */
    userId: string;
    range?: TimeRange | undefined;
    /** Filter by trading mode; UNSPECIFIED returns combined P&L. */
    tradingMode: TradingMode;
    accountId?: string | undefined;
}
export interface GetSnapshotRequest {
    portfolioId: string;
    atTime?: Date | undefined;
    accountId?: string | undefined;
}
export interface StreamPortfolioUpdatesRequest {
    /**
     * DEPRECATED: caller identity resolved from the x-user-id header; body value ignored.
     *
     * @deprecated
     */
    userId: string;
    /** Filter by trading mode; UNSPECIFIED streams all modes. */
    tradingMode: TradingMode;
    accountId?: string | undefined;
}
export interface ListPortfoliosRequest {
    accountId?: string | undefined;
}
export interface ListPortfoliosResponse {
    portfolios: Portfolio[];
}
/** A (symbol, strategy) binding — a ready-made Universe candidate (feature 097). */
export interface WatchlistBinding {
    symbol: string;
    /** "" = unbound (kept as a bare watched symbol) */
    strategyId: string;
    /**
     * Entry provenance (feature 127); first-writer-wins under ON CONFLICT DO NOTHING.
     * Unspecified on read → treat as MANUAL.
     */
    source: WatchlistEntrySource;
}
/** Watchlist (feature 058) — a mode-agnostic, user-owned named set of symbols. */
export interface Watchlist {
    watchlistId: string;
    userId: string;
    name: string;
    description: string;
    /**
     * DEPRECATED (feature 097): the flat mirror of `bindings`, kept readable for old clients (FR-6).
     *
     * @deprecated
     */
    symbols: string[];
    createdAt?: Date | undefined;
    updatedAt?: Date | undefined;
    /** Authoritative (symbol, strategy) shape (feature 097); when present it supersedes `symbols`. */
    bindings: WatchlistBinding[];
    /**
     * System-managed signals watchlist (feature 127), identified by this flag (not by name).
     * Delete-protected (FR-7/FR-8); one per user.
     */
    systemManaged: boolean;
    /**
     * Watchlist-level default strategy (feature 170): stamped onto newly-added, otherwise-unbound
     * MANUAL symbols at add time only — no retroactive rebind, no read-time fallback. "" = none.
     */
    defaultStrategyId: string;
}
/**
 * user_id is intentionally absent from all request messages — ownership is taken
 * from the propagated x-user-id header server-side (FR-2), never from the wire.
 */
export interface CreateWatchlistRequest {
    name: string;
    description: string;
    symbols: string[];
    /** When present, authoritative (feature 097); legacy `symbols` remains accepted (unbound). */
    bindings: WatchlistBinding[];
    /**
     * Watchlist-level default strategy (feature 170) applied to initial bare/MANUAL symbols at
     * creation. "" = none.
     */
    defaultStrategyId: string;
}
export interface CreateWatchlistResponse {
    watchlist?: Watchlist | undefined;
}
export interface GetWatchlistRequest {
    watchlistId: string;
}
export interface GetWatchlistResponse {
    watchlist?: Watchlist | undefined;
}
export interface ListWatchlistsRequest {
    page?: PageRequest | undefined;
}
export interface ListWatchlistsResponse {
    watchlists: Watchlist[];
    page?: PageResponse | undefined;
}
/**
 * Replace semantics for name/description/symbols per FR-1 when `update_mask` is UNSET. When
 * `update_mask` IS set (feature 170), this is a PARTIAL update: only masked paths of
 * {name, description, default_strategy_id} are written; bindings are left untouched.
 */
export interface UpdateWatchlistRequest {
    watchlistId: string;
    name: string;
    description: string;
    symbols: string[];
    /** When present, authoritative (feature 097); legacy `symbols` remains accepted (unbound). */
    bindings: WatchlistBinding[];
    /**
     * Watchlist-level default strategy (feature 170). Only written on the masked path (requires
     * `update_mask` to name "default_strategy_id"); a no-mask request carrying this → InvalidArgument.
     */
    defaultStrategyId: string;
    /**
     * Partial-update mask (feature 170). Unset/absent = legacy replace-all of name/description/bindings.
     * Present = write only the masked paths; allowed paths: {name, description, default_strategy_id}.
     */
    updateMask?: string[] | undefined;
}
export interface UpdateWatchlistResponse {
    watchlist?: Watchlist | undefined;
}
export interface DeleteWatchlistRequest {
    watchlistId: string;
}
export interface DeleteWatchlistResponse {
}
export interface AddWatchlistSymbolsRequest {
    watchlistId: string;
    symbols: string[];
    /** When present, authoritative (feature 097); legacy `symbols` remains accepted (unbound). */
    bindings: WatchlistBinding[];
}
export interface AddWatchlistSymbolsResponse {
    watchlist?: Watchlist | undefined;
}
export interface RemoveWatchlistSymbolsRequest {
    watchlistId: string;
    symbols: string[];
}
export interface RemoveWatchlistSymbolsResponse {
    watchlist?: Watchlist | undefined;
}
/** user_id intentionally absent — ownership from the x-user-id header (feature 127, FR-2). */
export interface EnsureSignalWatchlistRequest {
}
export interface EnsureSignalWatchlistResponse {
    watchlist?: Watchlist | undefined;
}
/** Empty — the enumeration spans all users; ownership/scoping does not apply (feature 154). */
export interface ListAllWatchlistSymbolsRequest {
}
export interface ListAllWatchlistSymbolsResponse {
    /** Distinct, sorted bare symbols across all users' watchlists (bindings collapsed). */
    symbols: string[];
}
/** user_id intentionally absent — ownership from the x-user-id header (feature 167). */
export interface UpdateWatchlistBindingRequest {
    watchlistId: string;
    symbol: string;
    /** "" = unbind this one row (matches WatchlistBinding.strategy_id) */
    strategyId: string;
}
export interface UpdateWatchlistBindingResponse {
    /** the updated binding (symbol/strategy_id/source) */
    binding?: WatchlistBinding | undefined;
    /** list-level watchlists.updated_at, bumped in-tx */
    updatedAt?: Date | undefined;
}
/** user_id intentionally absent — ownership from the x-user-id header (feature 170). */
export interface UpdateWatchlistBindingsRequest {
    watchlistId: string;
    /** deduped/normalized server-side; empty → InvalidArgument */
    symbols: string[];
    /** "" = unbind the whole set (matches WatchlistBinding.strategy_id) */
    strategyId: string;
}
export interface UpdateWatchlistBindingsResponse {
    /** changed rows only (symbol/strategy_id/source) */
    bindings: WatchlistBinding[];
    /** list-level watchlists.updated_at, bumped in-tx */
    updatedAt?: Date | undefined;
}
export declare const Portfolio: MessageFns<Portfolio>;
export declare const Position: MessageFns<Position>;
export declare const PortfolioSnapshot: MessageFns<PortfolioSnapshot>;
export declare const PnLResponse: MessageFns<PnLResponse>;
export declare const GetPortfolioRequest: MessageFns<GetPortfolioRequest>;
export declare const GetPositionRequest: MessageFns<GetPositionRequest>;
export declare const ListPositionsRequest: MessageFns<ListPositionsRequest>;
export declare const ListPositionsResponse: MessageFns<ListPositionsResponse>;
export declare const GetPnLRequest: MessageFns<GetPnLRequest>;
export declare const GetSnapshotRequest: MessageFns<GetSnapshotRequest>;
export declare const StreamPortfolioUpdatesRequest: MessageFns<StreamPortfolioUpdatesRequest>;
export declare const ListPortfoliosRequest: MessageFns<ListPortfoliosRequest>;
export declare const ListPortfoliosResponse: MessageFns<ListPortfoliosResponse>;
export declare const WatchlistBinding: MessageFns<WatchlistBinding>;
export declare const Watchlist: MessageFns<Watchlist>;
export declare const CreateWatchlistRequest: MessageFns<CreateWatchlistRequest>;
export declare const CreateWatchlistResponse: MessageFns<CreateWatchlistResponse>;
export declare const GetWatchlistRequest: MessageFns<GetWatchlistRequest>;
export declare const GetWatchlistResponse: MessageFns<GetWatchlistResponse>;
export declare const ListWatchlistsRequest: MessageFns<ListWatchlistsRequest>;
export declare const ListWatchlistsResponse: MessageFns<ListWatchlistsResponse>;
export declare const UpdateWatchlistRequest: MessageFns<UpdateWatchlistRequest>;
export declare const UpdateWatchlistResponse: MessageFns<UpdateWatchlistResponse>;
export declare const DeleteWatchlistRequest: MessageFns<DeleteWatchlistRequest>;
export declare const DeleteWatchlistResponse: MessageFns<DeleteWatchlistResponse>;
export declare const AddWatchlistSymbolsRequest: MessageFns<AddWatchlistSymbolsRequest>;
export declare const AddWatchlistSymbolsResponse: MessageFns<AddWatchlistSymbolsResponse>;
export declare const RemoveWatchlistSymbolsRequest: MessageFns<RemoveWatchlistSymbolsRequest>;
export declare const RemoveWatchlistSymbolsResponse: MessageFns<RemoveWatchlistSymbolsResponse>;
export declare const EnsureSignalWatchlistRequest: MessageFns<EnsureSignalWatchlistRequest>;
export declare const EnsureSignalWatchlistResponse: MessageFns<EnsureSignalWatchlistResponse>;
export declare const ListAllWatchlistSymbolsRequest: MessageFns<ListAllWatchlistSymbolsRequest>;
export declare const ListAllWatchlistSymbolsResponse: MessageFns<ListAllWatchlistSymbolsResponse>;
export declare const UpdateWatchlistBindingRequest: MessageFns<UpdateWatchlistBindingRequest>;
export declare const UpdateWatchlistBindingResponse: MessageFns<UpdateWatchlistBindingResponse>;
export declare const UpdateWatchlistBindingsRequest: MessageFns<UpdateWatchlistBindingsRequest>;
export declare const UpdateWatchlistBindingsResponse: MessageFns<UpdateWatchlistBindingsResponse>;
export type PortfolioServiceService = typeof PortfolioServiceService;
export declare const PortfolioServiceService: {
    readonly getPortfolio: {
        readonly path: "/xstockstrat.portfolio.v1.PortfolioService/GetPortfolio";
        readonly requestStream: false;
        readonly responseStream: false;
        readonly requestSerialize: (value: GetPortfolioRequest) => Buffer;
        readonly requestDeserialize: (value: Buffer) => GetPortfolioRequest;
        readonly responseSerialize: (value: Portfolio) => Buffer;
        readonly responseDeserialize: (value: Buffer) => Portfolio;
    };
    readonly getPosition: {
        readonly path: "/xstockstrat.portfolio.v1.PortfolioService/GetPosition";
        readonly requestStream: false;
        readonly responseStream: false;
        readonly requestSerialize: (value: GetPositionRequest) => Buffer;
        readonly requestDeserialize: (value: Buffer) => GetPositionRequest;
        readonly responseSerialize: (value: Position) => Buffer;
        readonly responseDeserialize: (value: Buffer) => Position;
    };
    readonly listPositions: {
        readonly path: "/xstockstrat.portfolio.v1.PortfolioService/ListPositions";
        readonly requestStream: false;
        readonly responseStream: false;
        readonly requestSerialize: (value: ListPositionsRequest) => Buffer;
        readonly requestDeserialize: (value: Buffer) => ListPositionsRequest;
        readonly responseSerialize: (value: ListPositionsResponse) => Buffer;
        readonly responseDeserialize: (value: Buffer) => ListPositionsResponse;
    };
    readonly getPnL: {
        readonly path: "/xstockstrat.portfolio.v1.PortfolioService/GetPnL";
        readonly requestStream: false;
        readonly responseStream: false;
        readonly requestSerialize: (value: GetPnLRequest) => Buffer;
        readonly requestDeserialize: (value: Buffer) => GetPnLRequest;
        readonly responseSerialize: (value: PnLResponse) => Buffer;
        readonly responseDeserialize: (value: Buffer) => PnLResponse;
    };
    readonly getSnapshot: {
        readonly path: "/xstockstrat.portfolio.v1.PortfolioService/GetSnapshot";
        readonly requestStream: false;
        readonly responseStream: false;
        readonly requestSerialize: (value: GetSnapshotRequest) => Buffer;
        readonly requestDeserialize: (value: Buffer) => GetSnapshotRequest;
        readonly responseSerialize: (value: PortfolioSnapshot) => Buffer;
        readonly responseDeserialize: (value: Buffer) => PortfolioSnapshot;
    };
    readonly streamPortfolioUpdates: {
        readonly path: "/xstockstrat.portfolio.v1.PortfolioService/StreamPortfolioUpdates";
        readonly requestStream: false;
        readonly responseStream: true;
        readonly requestSerialize: (value: StreamPortfolioUpdatesRequest) => Buffer;
        readonly requestDeserialize: (value: Buffer) => StreamPortfolioUpdatesRequest;
        readonly responseSerialize: (value: PortfolioSnapshot) => Buffer;
        readonly responseDeserialize: (value: Buffer) => PortfolioSnapshot;
    };
    readonly listPortfolios: {
        readonly path: "/xstockstrat.portfolio.v1.PortfolioService/ListPortfolios";
        readonly requestStream: false;
        readonly responseStream: false;
        readonly requestSerialize: (value: ListPortfoliosRequest) => Buffer;
        readonly requestDeserialize: (value: Buffer) => ListPortfoliosRequest;
        readonly responseSerialize: (value: ListPortfoliosResponse) => Buffer;
        readonly responseDeserialize: (value: Buffer) => ListPortfoliosResponse;
    };
    /**
     * Watchlist management (feature 058). Additive — ownership is taken from the
     * propagated x-user-id header server-side, never from request fields.
     */
    readonly createWatchlist: {
        readonly path: "/xstockstrat.portfolio.v1.PortfolioService/CreateWatchlist";
        readonly requestStream: false;
        readonly responseStream: false;
        readonly requestSerialize: (value: CreateWatchlistRequest) => Buffer;
        readonly requestDeserialize: (value: Buffer) => CreateWatchlistRequest;
        readonly responseSerialize: (value: CreateWatchlistResponse) => Buffer;
        readonly responseDeserialize: (value: Buffer) => CreateWatchlistResponse;
    };
    readonly getWatchlist: {
        readonly path: "/xstockstrat.portfolio.v1.PortfolioService/GetWatchlist";
        readonly requestStream: false;
        readonly responseStream: false;
        readonly requestSerialize: (value: GetWatchlistRequest) => Buffer;
        readonly requestDeserialize: (value: Buffer) => GetWatchlistRequest;
        readonly responseSerialize: (value: GetWatchlistResponse) => Buffer;
        readonly responseDeserialize: (value: Buffer) => GetWatchlistResponse;
    };
    readonly listWatchlists: {
        readonly path: "/xstockstrat.portfolio.v1.PortfolioService/ListWatchlists";
        readonly requestStream: false;
        readonly responseStream: false;
        readonly requestSerialize: (value: ListWatchlistsRequest) => Buffer;
        readonly requestDeserialize: (value: Buffer) => ListWatchlistsRequest;
        readonly responseSerialize: (value: ListWatchlistsResponse) => Buffer;
        readonly responseDeserialize: (value: Buffer) => ListWatchlistsResponse;
    };
    readonly updateWatchlist: {
        readonly path: "/xstockstrat.portfolio.v1.PortfolioService/UpdateWatchlist";
        readonly requestStream: false;
        readonly responseStream: false;
        readonly requestSerialize: (value: UpdateWatchlistRequest) => Buffer;
        readonly requestDeserialize: (value: Buffer) => UpdateWatchlistRequest;
        readonly responseSerialize: (value: UpdateWatchlistResponse) => Buffer;
        readonly responseDeserialize: (value: Buffer) => UpdateWatchlistResponse;
    };
    readonly deleteWatchlist: {
        readonly path: "/xstockstrat.portfolio.v1.PortfolioService/DeleteWatchlist";
        readonly requestStream: false;
        readonly responseStream: false;
        readonly requestSerialize: (value: DeleteWatchlistRequest) => Buffer;
        readonly requestDeserialize: (value: Buffer) => DeleteWatchlistRequest;
        readonly responseSerialize: (value: DeleteWatchlistResponse) => Buffer;
        readonly responseDeserialize: (value: Buffer) => DeleteWatchlistResponse;
    };
    readonly addWatchlistSymbols: {
        readonly path: "/xstockstrat.portfolio.v1.PortfolioService/AddWatchlistSymbols";
        readonly requestStream: false;
        readonly responseStream: false;
        readonly requestSerialize: (value: AddWatchlistSymbolsRequest) => Buffer;
        readonly requestDeserialize: (value: Buffer) => AddWatchlistSymbolsRequest;
        readonly responseSerialize: (value: AddWatchlistSymbolsResponse) => Buffer;
        readonly responseDeserialize: (value: Buffer) => AddWatchlistSymbolsResponse;
    };
    readonly removeWatchlistSymbols: {
        readonly path: "/xstockstrat.portfolio.v1.PortfolioService/RemoveWatchlistSymbols";
        readonly requestStream: false;
        readonly responseStream: false;
        readonly requestSerialize: (value: RemoveWatchlistSymbolsRequest) => Buffer;
        readonly requestDeserialize: (value: Buffer) => RemoveWatchlistSymbolsRequest;
        readonly responseSerialize: (value: RemoveWatchlistSymbolsResponse) => Buffer;
        readonly responseDeserialize: (value: Buffer) => RemoveWatchlistSymbolsResponse;
    };
    /**
     * Find-or-create the caller's system_managed=true watchlist (feature 127).
     * Ownership is taken from the propagated x-user-id header; the request has no body (FR-2).
     */
    readonly ensureSignalWatchlist: {
        readonly path: "/xstockstrat.portfolio.v1.PortfolioService/EnsureSignalWatchlist";
        readonly requestStream: false;
        readonly responseStream: false;
        readonly requestSerialize: (value: EnsureSignalWatchlistRequest) => Buffer;
        readonly requestDeserialize: (value: Buffer) => EnsureSignalWatchlistRequest;
        readonly responseSerialize: (value: EnsureSignalWatchlistResponse) => Buffer;
        readonly responseDeserialize: (value: Buffer) => EnsureSignalWatchlistResponse;
    };
    /**
     * Cross-user enumeration (feature 154): the distinct union of watchlist symbols across
     * ALL users' watchlists — NOT scoped to the caller's x-user-id. Privileged: gated by the
     * x-internal-caller allow-list (grant `analysis-fundsignal`), not the admin x-access-scope
     * bit (PR #994) — a non-allow-listed caller gets PERMISSION_DENIED. Read-only; intended for
     * the fundamentals-signal producer's universe resolution.
     */
    readonly listAllWatchlistSymbols: {
        readonly path: "/xstockstrat.portfolio.v1.PortfolioService/ListAllWatchlistSymbols";
        readonly requestStream: false;
        readonly responseStream: false;
        readonly requestSerialize: (value: ListAllWatchlistSymbolsRequest) => Buffer;
        readonly requestDeserialize: (value: Buffer) => ListAllWatchlistSymbolsRequest;
        readonly responseSerialize: (value: ListAllWatchlistSymbolsResponse) => Buffer;
        readonly responseDeserialize: (value: Buffer) => ListAllWatchlistSymbolsResponse;
    };
    /**
     * Targeted single-symbol rebind (feature 167): change one binding's strategy_id via a single-row
     * UPDATE — no replace-all. Ownership from the propagated x-user-id header (server-side), never
     * from the request body. NOT_FOUND if the symbol is not in the watchlist.
     */
    readonly updateWatchlistBinding: {
        readonly path: "/xstockstrat.portfolio.v1.PortfolioService/UpdateWatchlistBinding";
        readonly requestStream: false;
        readonly responseStream: false;
        readonly requestSerialize: (value: UpdateWatchlistBindingRequest) => Buffer;
        readonly requestDeserialize: (value: Buffer) => UpdateWatchlistBindingRequest;
        readonly responseSerialize: (value: UpdateWatchlistBindingResponse) => Buffer;
        readonly responseDeserialize: (value: Buffer) => UpdateWatchlistBindingResponse;
    };
    /**
     * Atomic set-based rebind (feature 170): assign ONE strategy_id across a symbol set in a single
     * UPDATE ... WHERE symbol = ANY(...). All-or-nothing — an absent symbol → NOT_FOUND with zero
     * partial writes. Ownership from the x-user-id header; empty strategy_id unbinds the whole set.
     */
    readonly updateWatchlistBindings: {
        readonly path: "/xstockstrat.portfolio.v1.PortfolioService/UpdateWatchlistBindings";
        readonly requestStream: false;
        readonly responseStream: false;
        readonly requestSerialize: (value: UpdateWatchlistBindingsRequest) => Buffer;
        readonly requestDeserialize: (value: Buffer) => UpdateWatchlistBindingsRequest;
        readonly responseSerialize: (value: UpdateWatchlistBindingsResponse) => Buffer;
        readonly responseDeserialize: (value: Buffer) => UpdateWatchlistBindingsResponse;
    };
};
export interface PortfolioServiceServer extends UntypedServiceImplementation {
    getPortfolio: handleUnaryCall<GetPortfolioRequest, Portfolio>;
    getPosition: handleUnaryCall<GetPositionRequest, Position>;
    listPositions: handleUnaryCall<ListPositionsRequest, ListPositionsResponse>;
    getPnL: handleUnaryCall<GetPnLRequest, PnLResponse>;
    getSnapshot: handleUnaryCall<GetSnapshotRequest, PortfolioSnapshot>;
    streamPortfolioUpdates: handleServerStreamingCall<StreamPortfolioUpdatesRequest, PortfolioSnapshot>;
    listPortfolios: handleUnaryCall<ListPortfoliosRequest, ListPortfoliosResponse>;
    /**
     * Watchlist management (feature 058). Additive — ownership is taken from the
     * propagated x-user-id header server-side, never from request fields.
     */
    createWatchlist: handleUnaryCall<CreateWatchlistRequest, CreateWatchlistResponse>;
    getWatchlist: handleUnaryCall<GetWatchlistRequest, GetWatchlistResponse>;
    listWatchlists: handleUnaryCall<ListWatchlistsRequest, ListWatchlistsResponse>;
    updateWatchlist: handleUnaryCall<UpdateWatchlistRequest, UpdateWatchlistResponse>;
    deleteWatchlist: handleUnaryCall<DeleteWatchlistRequest, DeleteWatchlistResponse>;
    addWatchlistSymbols: handleUnaryCall<AddWatchlistSymbolsRequest, AddWatchlistSymbolsResponse>;
    removeWatchlistSymbols: handleUnaryCall<RemoveWatchlistSymbolsRequest, RemoveWatchlistSymbolsResponse>;
    /**
     * Find-or-create the caller's system_managed=true watchlist (feature 127).
     * Ownership is taken from the propagated x-user-id header; the request has no body (FR-2).
     */
    ensureSignalWatchlist: handleUnaryCall<EnsureSignalWatchlistRequest, EnsureSignalWatchlistResponse>;
    /**
     * Cross-user enumeration (feature 154): the distinct union of watchlist symbols across
     * ALL users' watchlists — NOT scoped to the caller's x-user-id. Privileged: gated by the
     * x-internal-caller allow-list (grant `analysis-fundsignal`), not the admin x-access-scope
     * bit (PR #994) — a non-allow-listed caller gets PERMISSION_DENIED. Read-only; intended for
     * the fundamentals-signal producer's universe resolution.
     */
    listAllWatchlistSymbols: handleUnaryCall<ListAllWatchlistSymbolsRequest, ListAllWatchlistSymbolsResponse>;
    /**
     * Targeted single-symbol rebind (feature 167): change one binding's strategy_id via a single-row
     * UPDATE — no replace-all. Ownership from the propagated x-user-id header (server-side), never
     * from the request body. NOT_FOUND if the symbol is not in the watchlist.
     */
    updateWatchlistBinding: handleUnaryCall<UpdateWatchlistBindingRequest, UpdateWatchlistBindingResponse>;
    /**
     * Atomic set-based rebind (feature 170): assign ONE strategy_id across a symbol set in a single
     * UPDATE ... WHERE symbol = ANY(...). All-or-nothing — an absent symbol → NOT_FOUND with zero
     * partial writes. Ownership from the x-user-id header; empty strategy_id unbinds the whole set.
     */
    updateWatchlistBindings: handleUnaryCall<UpdateWatchlistBindingsRequest, UpdateWatchlistBindingsResponse>;
}
export interface PortfolioServiceClient extends Client {
    getPortfolio(request: GetPortfolioRequest, callback: (error: ServiceError | null, response: Portfolio) => void): ClientUnaryCall;
    getPortfolio(request: GetPortfolioRequest, metadata: Metadata, callback: (error: ServiceError | null, response: Portfolio) => void): ClientUnaryCall;
    getPortfolio(request: GetPortfolioRequest, metadata: Metadata, options: Partial<CallOptions>, callback: (error: ServiceError | null, response: Portfolio) => void): ClientUnaryCall;
    getPosition(request: GetPositionRequest, callback: (error: ServiceError | null, response: Position) => void): ClientUnaryCall;
    getPosition(request: GetPositionRequest, metadata: Metadata, callback: (error: ServiceError | null, response: Position) => void): ClientUnaryCall;
    getPosition(request: GetPositionRequest, metadata: Metadata, options: Partial<CallOptions>, callback: (error: ServiceError | null, response: Position) => void): ClientUnaryCall;
    listPositions(request: ListPositionsRequest, callback: (error: ServiceError | null, response: ListPositionsResponse) => void): ClientUnaryCall;
    listPositions(request: ListPositionsRequest, metadata: Metadata, callback: (error: ServiceError | null, response: ListPositionsResponse) => void): ClientUnaryCall;
    listPositions(request: ListPositionsRequest, metadata: Metadata, options: Partial<CallOptions>, callback: (error: ServiceError | null, response: ListPositionsResponse) => void): ClientUnaryCall;
    getPnL(request: GetPnLRequest, callback: (error: ServiceError | null, response: PnLResponse) => void): ClientUnaryCall;
    getPnL(request: GetPnLRequest, metadata: Metadata, callback: (error: ServiceError | null, response: PnLResponse) => void): ClientUnaryCall;
    getPnL(request: GetPnLRequest, metadata: Metadata, options: Partial<CallOptions>, callback: (error: ServiceError | null, response: PnLResponse) => void): ClientUnaryCall;
    getSnapshot(request: GetSnapshotRequest, callback: (error: ServiceError | null, response: PortfolioSnapshot) => void): ClientUnaryCall;
    getSnapshot(request: GetSnapshotRequest, metadata: Metadata, callback: (error: ServiceError | null, response: PortfolioSnapshot) => void): ClientUnaryCall;
    getSnapshot(request: GetSnapshotRequest, metadata: Metadata, options: Partial<CallOptions>, callback: (error: ServiceError | null, response: PortfolioSnapshot) => void): ClientUnaryCall;
    streamPortfolioUpdates(request: StreamPortfolioUpdatesRequest, options?: Partial<CallOptions>): ClientReadableStream<PortfolioSnapshot>;
    streamPortfolioUpdates(request: StreamPortfolioUpdatesRequest, metadata?: Metadata, options?: Partial<CallOptions>): ClientReadableStream<PortfolioSnapshot>;
    listPortfolios(request: ListPortfoliosRequest, callback: (error: ServiceError | null, response: ListPortfoliosResponse) => void): ClientUnaryCall;
    listPortfolios(request: ListPortfoliosRequest, metadata: Metadata, callback: (error: ServiceError | null, response: ListPortfoliosResponse) => void): ClientUnaryCall;
    listPortfolios(request: ListPortfoliosRequest, metadata: Metadata, options: Partial<CallOptions>, callback: (error: ServiceError | null, response: ListPortfoliosResponse) => void): ClientUnaryCall;
    /**
     * Watchlist management (feature 058). Additive — ownership is taken from the
     * propagated x-user-id header server-side, never from request fields.
     */
    createWatchlist(request: CreateWatchlistRequest, callback: (error: ServiceError | null, response: CreateWatchlistResponse) => void): ClientUnaryCall;
    createWatchlist(request: CreateWatchlistRequest, metadata: Metadata, callback: (error: ServiceError | null, response: CreateWatchlistResponse) => void): ClientUnaryCall;
    createWatchlist(request: CreateWatchlistRequest, metadata: Metadata, options: Partial<CallOptions>, callback: (error: ServiceError | null, response: CreateWatchlistResponse) => void): ClientUnaryCall;
    getWatchlist(request: GetWatchlistRequest, callback: (error: ServiceError | null, response: GetWatchlistResponse) => void): ClientUnaryCall;
    getWatchlist(request: GetWatchlistRequest, metadata: Metadata, callback: (error: ServiceError | null, response: GetWatchlistResponse) => void): ClientUnaryCall;
    getWatchlist(request: GetWatchlistRequest, metadata: Metadata, options: Partial<CallOptions>, callback: (error: ServiceError | null, response: GetWatchlistResponse) => void): ClientUnaryCall;
    listWatchlists(request: ListWatchlistsRequest, callback: (error: ServiceError | null, response: ListWatchlistsResponse) => void): ClientUnaryCall;
    listWatchlists(request: ListWatchlistsRequest, metadata: Metadata, callback: (error: ServiceError | null, response: ListWatchlistsResponse) => void): ClientUnaryCall;
    listWatchlists(request: ListWatchlistsRequest, metadata: Metadata, options: Partial<CallOptions>, callback: (error: ServiceError | null, response: ListWatchlistsResponse) => void): ClientUnaryCall;
    updateWatchlist(request: UpdateWatchlistRequest, callback: (error: ServiceError | null, response: UpdateWatchlistResponse) => void): ClientUnaryCall;
    updateWatchlist(request: UpdateWatchlistRequest, metadata: Metadata, callback: (error: ServiceError | null, response: UpdateWatchlistResponse) => void): ClientUnaryCall;
    updateWatchlist(request: UpdateWatchlistRequest, metadata: Metadata, options: Partial<CallOptions>, callback: (error: ServiceError | null, response: UpdateWatchlistResponse) => void): ClientUnaryCall;
    deleteWatchlist(request: DeleteWatchlistRequest, callback: (error: ServiceError | null, response: DeleteWatchlistResponse) => void): ClientUnaryCall;
    deleteWatchlist(request: DeleteWatchlistRequest, metadata: Metadata, callback: (error: ServiceError | null, response: DeleteWatchlistResponse) => void): ClientUnaryCall;
    deleteWatchlist(request: DeleteWatchlistRequest, metadata: Metadata, options: Partial<CallOptions>, callback: (error: ServiceError | null, response: DeleteWatchlistResponse) => void): ClientUnaryCall;
    addWatchlistSymbols(request: AddWatchlistSymbolsRequest, callback: (error: ServiceError | null, response: AddWatchlistSymbolsResponse) => void): ClientUnaryCall;
    addWatchlistSymbols(request: AddWatchlistSymbolsRequest, metadata: Metadata, callback: (error: ServiceError | null, response: AddWatchlistSymbolsResponse) => void): ClientUnaryCall;
    addWatchlistSymbols(request: AddWatchlistSymbolsRequest, metadata: Metadata, options: Partial<CallOptions>, callback: (error: ServiceError | null, response: AddWatchlistSymbolsResponse) => void): ClientUnaryCall;
    removeWatchlistSymbols(request: RemoveWatchlistSymbolsRequest, callback: (error: ServiceError | null, response: RemoveWatchlistSymbolsResponse) => void): ClientUnaryCall;
    removeWatchlistSymbols(request: RemoveWatchlistSymbolsRequest, metadata: Metadata, callback: (error: ServiceError | null, response: RemoveWatchlistSymbolsResponse) => void): ClientUnaryCall;
    removeWatchlistSymbols(request: RemoveWatchlistSymbolsRequest, metadata: Metadata, options: Partial<CallOptions>, callback: (error: ServiceError | null, response: RemoveWatchlistSymbolsResponse) => void): ClientUnaryCall;
    /**
     * Find-or-create the caller's system_managed=true watchlist (feature 127).
     * Ownership is taken from the propagated x-user-id header; the request has no body (FR-2).
     */
    ensureSignalWatchlist(request: EnsureSignalWatchlistRequest, callback: (error: ServiceError | null, response: EnsureSignalWatchlistResponse) => void): ClientUnaryCall;
    ensureSignalWatchlist(request: EnsureSignalWatchlistRequest, metadata: Metadata, callback: (error: ServiceError | null, response: EnsureSignalWatchlistResponse) => void): ClientUnaryCall;
    ensureSignalWatchlist(request: EnsureSignalWatchlistRequest, metadata: Metadata, options: Partial<CallOptions>, callback: (error: ServiceError | null, response: EnsureSignalWatchlistResponse) => void): ClientUnaryCall;
    /**
     * Cross-user enumeration (feature 154): the distinct union of watchlist symbols across
     * ALL users' watchlists — NOT scoped to the caller's x-user-id. Privileged: gated by the
     * x-internal-caller allow-list (grant `analysis-fundsignal`), not the admin x-access-scope
     * bit (PR #994) — a non-allow-listed caller gets PERMISSION_DENIED. Read-only; intended for
     * the fundamentals-signal producer's universe resolution.
     */
    listAllWatchlistSymbols(request: ListAllWatchlistSymbolsRequest, callback: (error: ServiceError | null, response: ListAllWatchlistSymbolsResponse) => void): ClientUnaryCall;
    listAllWatchlistSymbols(request: ListAllWatchlistSymbolsRequest, metadata: Metadata, callback: (error: ServiceError | null, response: ListAllWatchlistSymbolsResponse) => void): ClientUnaryCall;
    listAllWatchlistSymbols(request: ListAllWatchlistSymbolsRequest, metadata: Metadata, options: Partial<CallOptions>, callback: (error: ServiceError | null, response: ListAllWatchlistSymbolsResponse) => void): ClientUnaryCall;
    /**
     * Targeted single-symbol rebind (feature 167): change one binding's strategy_id via a single-row
     * UPDATE — no replace-all. Ownership from the propagated x-user-id header (server-side), never
     * from the request body. NOT_FOUND if the symbol is not in the watchlist.
     */
    updateWatchlistBinding(request: UpdateWatchlistBindingRequest, callback: (error: ServiceError | null, response: UpdateWatchlistBindingResponse) => void): ClientUnaryCall;
    updateWatchlistBinding(request: UpdateWatchlistBindingRequest, metadata: Metadata, callback: (error: ServiceError | null, response: UpdateWatchlistBindingResponse) => void): ClientUnaryCall;
    updateWatchlistBinding(request: UpdateWatchlistBindingRequest, metadata: Metadata, options: Partial<CallOptions>, callback: (error: ServiceError | null, response: UpdateWatchlistBindingResponse) => void): ClientUnaryCall;
    /**
     * Atomic set-based rebind (feature 170): assign ONE strategy_id across a symbol set in a single
     * UPDATE ... WHERE symbol = ANY(...). All-or-nothing — an absent symbol → NOT_FOUND with zero
     * partial writes. Ownership from the x-user-id header; empty strategy_id unbinds the whole set.
     */
    updateWatchlistBindings(request: UpdateWatchlistBindingsRequest, callback: (error: ServiceError | null, response: UpdateWatchlistBindingsResponse) => void): ClientUnaryCall;
    updateWatchlistBindings(request: UpdateWatchlistBindingsRequest, metadata: Metadata, callback: (error: ServiceError | null, response: UpdateWatchlistBindingsResponse) => void): ClientUnaryCall;
    updateWatchlistBindings(request: UpdateWatchlistBindingsRequest, metadata: Metadata, options: Partial<CallOptions>, callback: (error: ServiceError | null, response: UpdateWatchlistBindingsResponse) => void): ClientUnaryCall;
}
export declare const PortfolioServiceClient: {
    new (address: string, credentials: ChannelCredentials, options?: Partial<ClientOptions>): PortfolioServiceClient;
    service: typeof PortfolioServiceService;
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

import { BinaryReader, BinaryWriter } from "@bufbuild/protobuf/wire";
import { type CallOptions, type ChannelCredentials, Client, type ClientOptions, type ClientReadableStream, type ClientUnaryCall, type handleServerStreamingCall, type handleUnaryCall, type Metadata, type ServiceError, type UntypedServiceImplementation } from "@grpc/grpc-js";
import { PageRequest, PageResponse, TimeRange, TradingMode } from "../../common/v1/common";
export declare const protobufPackage = "xstockstrat.portfolio.v1";
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
    userId: string;
    tradingMode: TradingMode;
    accountId?: string | undefined;
}
export interface GetPositionRequest {
    userId: string;
    symbol: string;
    tradingMode: TradingMode;
    accountId?: string | undefined;
}
export interface ListPositionsRequest {
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
};
export interface PortfolioServiceServer extends UntypedServiceImplementation {
    getPortfolio: handleUnaryCall<GetPortfolioRequest, Portfolio>;
    getPosition: handleUnaryCall<GetPositionRequest, Position>;
    listPositions: handleUnaryCall<ListPositionsRequest, ListPositionsResponse>;
    getPnL: handleUnaryCall<GetPnLRequest, PnLResponse>;
    getSnapshot: handleUnaryCall<GetSnapshotRequest, PortfolioSnapshot>;
    streamPortfolioUpdates: handleServerStreamingCall<StreamPortfolioUpdatesRequest, PortfolioSnapshot>;
    listPortfolios: handleUnaryCall<ListPortfoliosRequest, ListPortfoliosResponse>;
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

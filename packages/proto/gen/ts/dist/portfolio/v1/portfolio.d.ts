import { BinaryReader, BinaryWriter } from "@bufbuild/protobuf/wire";
import { type CallOptions, type ChannelCredentials, Client, type ClientOptions, type ClientReadableStream, type ClientUnaryCall, type handleServerStreamingCall, type handleUnaryCall, type Metadata, type ServiceError, type UntypedServiceImplementation } from "@grpc/grpc-js";
import { PageRequest, PageResponse, TimeRange, TradingMode } from "../../common/v1/common";
export declare const protobufPackage = "xstockstrat.portfolio.v1";
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
}
export interface PortfolioSnapshot {
    portfolioId: string;
    snapshotTime?: Date | undefined;
    equity: number;
    cash: number;
    dayPnl: number;
    openPositions: number;
    tradingMode: TradingMode;
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
}
export interface GetPositionRequest {
    userId: string;
    symbol: string;
    tradingMode: TradingMode;
}
export interface ListPositionsRequest {
    userId: string;
    page?: PageRequest | undefined;
    /** Filter by trading mode; UNSPECIFIED returns all positions. */
    tradingMode: TradingMode;
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
}
export interface GetSnapshotRequest {
    portfolioId: string;
    atTime?: Date | undefined;
}
export interface StreamPortfolioUpdatesRequest {
    userId: string;
    /** Filter by trading mode; UNSPECIFIED streams all modes. */
    tradingMode: TradingMode;
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
};
export interface PortfolioServiceServer extends UntypedServiceImplementation {
    getPortfolio: handleUnaryCall<GetPortfolioRequest, Portfolio>;
    getPosition: handleUnaryCall<GetPositionRequest, Position>;
    listPositions: handleUnaryCall<ListPositionsRequest, ListPositionsResponse>;
    getPnL: handleUnaryCall<GetPnLRequest, PnLResponse>;
    getSnapshot: handleUnaryCall<GetSnapshotRequest, PortfolioSnapshot>;
    streamPortfolioUpdates: handleServerStreamingCall<StreamPortfolioUpdatesRequest, PortfolioSnapshot>;
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

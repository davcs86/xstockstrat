import { BinaryReader, BinaryWriter } from "@bufbuild/protobuf/wire";
import { type CallOptions, type ChannelCredentials, Client, type ClientOptions, type ClientReadableStream, type ClientUnaryCall, type handleServerStreamingCall, type handleUnaryCall, type Metadata, type ServiceError, type UntypedServiceImplementation } from "@grpc/grpc-js";
import { Asset, PageRequest, PageResponse, Timeframe, TimeRange } from "../../common/v1/common";
export declare const protobufPackage = "xstockstrat.marketdata.v1";
export interface Bar {
    symbol: string;
    time?: Date | undefined;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    vwap: number;
    tradeCount: number;
    /**
     * DEPRECATED: use timeframe_enum. Removed in a future release once all callers migrate.
     *
     * @deprecated
     */
    timeframe: string;
    /** always "alpaca" for this service */
    source: string;
    timeframeEnum: Timeframe;
}
export interface Quote {
    symbol: string;
    time?: Date | undefined;
    askPrice: number;
    askSize: number;
    bidPrice: number;
    bidSize: number;
    source: string;
}
export interface StreamBarsRequest {
    symbols: string[];
    /**
     * DEPRECATED: use timeframe_enum. Removed in a future release once all callers migrate.
     *
     * @deprecated
     */
    timeframe: string;
    includePremarket: boolean;
    includeAfterhours: boolean;
    timeframeEnum: Timeframe;
}
export interface StreamQuotesRequest {
    symbols: string[];
}
export interface GetBarsRequest {
    symbol: string;
    /**
     * DEPRECATED: use timeframe_enum. Removed in a future release once all callers migrate.
     *
     * @deprecated
     */
    timeframe: string;
    range?: TimeRange | undefined;
    page?: PageRequest | undefined;
    timeframeEnum: Timeframe;
}
export interface GetBarsResponse {
    bars: Bar[];
    page?: PageResponse | undefined;
}
export interface GetLatestQuoteRequest {
    symbol: string;
}
export interface BackfillBarsRequest {
    symbols: string[];
    /**
     * DEPRECATED: use timeframe_enum. Removed in a future release once all callers migrate.
     *
     * @deprecated
     */
    timeframe: string;
    range?: TimeRange | undefined;
    overwriteExisting: boolean;
    timeframeEnum: Timeframe;
}
export interface BackfillBarsResponse {
    barsWritten: number;
    failedSymbols: string[];
    /** estimated total bars across requested symbols/range (FR-6) */
    expectedBars: number;
}
export interface GetDataCoverageRequest {
    symbol: string;
    timeframe: Timeframe;
    /** Optional: restrict the coverage scan to this window. Empty = full history. */
    range?: TimeRange | undefined;
}
export interface CoverageRange {
    start?: Date | undefined;
    end?: Date | undefined;
    barCount: number;
}
export interface GetDataCoverageResponse {
    symbol: string;
    timeframe: Timeframe;
    barsTotal: number;
    /**
     * Covered earliest/latest with total bar count; covered_ranges holds contiguous segments,
     * gaps holds the missing segments within the requested range (if range was supplied).
     */
    earliest?: Date | undefined;
    latest?: Date | undefined;
    coveredRanges: CoverageRange[];
    gaps: TimeRange[];
}
export interface ListAssetsRequest {
    /** optional: "us_equity", "crypto" */
    assetClass: string;
    tradableOnly: boolean;
}
export interface ListAssetsResponse {
    assets: Asset[];
}
export interface DeleteBackfilledDataRequest {
    /** REQUIRED — server rejects empty (FR-5) */
    symbol: string;
    /** optional; empty = whole symbol */
    range?: TimeRange | undefined;
    /** optional; UNSPECIFIED = all timeframes */
    timeframe: Timeframe;
}
export interface DeleteBackfilledDataResponse {
    rowsDeleted: number;
}
export declare const Bar: MessageFns<Bar>;
export declare const Quote: MessageFns<Quote>;
export declare const StreamBarsRequest: MessageFns<StreamBarsRequest>;
export declare const StreamQuotesRequest: MessageFns<StreamQuotesRequest>;
export declare const GetBarsRequest: MessageFns<GetBarsRequest>;
export declare const GetBarsResponse: MessageFns<GetBarsResponse>;
export declare const GetLatestQuoteRequest: MessageFns<GetLatestQuoteRequest>;
export declare const BackfillBarsRequest: MessageFns<BackfillBarsRequest>;
export declare const BackfillBarsResponse: MessageFns<BackfillBarsResponse>;
export declare const GetDataCoverageRequest: MessageFns<GetDataCoverageRequest>;
export declare const CoverageRange: MessageFns<CoverageRange>;
export declare const GetDataCoverageResponse: MessageFns<GetDataCoverageResponse>;
export declare const ListAssetsRequest: MessageFns<ListAssetsRequest>;
export declare const ListAssetsResponse: MessageFns<ListAssetsResponse>;
export declare const DeleteBackfilledDataRequest: MessageFns<DeleteBackfilledDataRequest>;
export declare const DeleteBackfilledDataResponse: MessageFns<DeleteBackfilledDataResponse>;
/**
 * MarketDataService — sole Alpaca integration point.
 * Stores OHLCV and quote data in TimescaleDB hypertables.
 */
export type MarketDataServiceService = typeof MarketDataServiceService;
export declare const MarketDataServiceService: {
    /** Stream live bar data for symbols */
    readonly streamBars: {
        readonly path: "/xstockstrat.marketdata.v1.MarketDataService/StreamBars";
        readonly requestStream: false;
        readonly responseStream: true;
        readonly requestSerialize: (value: StreamBarsRequest) => Buffer;
        readonly requestDeserialize: (value: Buffer) => StreamBarsRequest;
        readonly responseSerialize: (value: Bar) => Buffer;
        readonly responseDeserialize: (value: Buffer) => Bar;
    };
    /** Stream live quotes */
    readonly streamQuotes: {
        readonly path: "/xstockstrat.marketdata.v1.MarketDataService/StreamQuotes";
        readonly requestStream: false;
        readonly responseStream: true;
        readonly requestSerialize: (value: StreamQuotesRequest) => Buffer;
        readonly requestDeserialize: (value: Buffer) => StreamQuotesRequest;
        readonly responseSerialize: (value: Quote) => Buffer;
        readonly responseDeserialize: (value: Buffer) => Quote;
    };
    /** Historical OHLCV query */
    readonly getBars: {
        readonly path: "/xstockstrat.marketdata.v1.MarketDataService/GetBars";
        readonly requestStream: false;
        readonly responseStream: false;
        readonly requestSerialize: (value: GetBarsRequest) => Buffer;
        readonly requestDeserialize: (value: Buffer) => GetBarsRequest;
        readonly responseSerialize: (value: GetBarsResponse) => Buffer;
        readonly responseDeserialize: (value: Buffer) => GetBarsResponse;
    };
    /** Latest quote snapshot */
    readonly getLatestQuote: {
        readonly path: "/xstockstrat.marketdata.v1.MarketDataService/GetLatestQuote";
        readonly requestStream: false;
        readonly responseStream: false;
        readonly requestSerialize: (value: GetLatestQuoteRequest) => Buffer;
        readonly requestDeserialize: (value: Buffer) => GetLatestQuoteRequest;
        readonly responseSerialize: (value: Quote) => Buffer;
        readonly responseDeserialize: (value: Buffer) => Quote;
    };
    /** Trigger historical backfill (used by xstockstrat-ingest) */
    readonly backfillBars: {
        readonly path: "/xstockstrat.marketdata.v1.MarketDataService/BackfillBars";
        readonly requestStream: false;
        readonly responseStream: false;
        readonly requestSerialize: (value: BackfillBarsRequest) => Buffer;
        readonly requestDeserialize: (value: Buffer) => BackfillBarsRequest;
        readonly responseSerialize: (value: BackfillBarsResponse) => Buffer;
        readonly responseDeserialize: (value: Buffer) => BackfillBarsResponse;
    };
    /** Report stored OHLCV coverage (earliest/latest/count + gaps) for a symbol+timeframe */
    readonly getDataCoverage: {
        readonly path: "/xstockstrat.marketdata.v1.MarketDataService/GetDataCoverage";
        readonly requestStream: false;
        readonly responseStream: false;
        readonly requestSerialize: (value: GetDataCoverageRequest) => Buffer;
        readonly requestDeserialize: (value: Buffer) => GetDataCoverageRequest;
        readonly responseSerialize: (value: GetDataCoverageResponse) => Buffer;
        readonly responseDeserialize: (value: Buffer) => GetDataCoverageResponse;
    };
    /** Scoped delete of backfilled OHLCV bars (admin-only, symbol-bounded — FR-5) */
    readonly deleteBackfilledData: {
        readonly path: "/xstockstrat.marketdata.v1.MarketDataService/DeleteBackfilledData";
        readonly requestStream: false;
        readonly responseStream: false;
        readonly requestSerialize: (value: DeleteBackfilledDataRequest) => Buffer;
        readonly requestDeserialize: (value: Buffer) => DeleteBackfilledDataRequest;
        readonly responseSerialize: (value: DeleteBackfilledDataResponse) => Buffer;
        readonly responseDeserialize: (value: Buffer) => DeleteBackfilledDataResponse;
    };
    /** Get available symbols */
    readonly listAssets: {
        readonly path: "/xstockstrat.marketdata.v1.MarketDataService/ListAssets";
        readonly requestStream: false;
        readonly responseStream: false;
        readonly requestSerialize: (value: ListAssetsRequest) => Buffer;
        readonly requestDeserialize: (value: Buffer) => ListAssetsRequest;
        readonly responseSerialize: (value: ListAssetsResponse) => Buffer;
        readonly responseDeserialize: (value: Buffer) => ListAssetsResponse;
    };
};
export interface MarketDataServiceServer extends UntypedServiceImplementation {
    /** Stream live bar data for symbols */
    streamBars: handleServerStreamingCall<StreamBarsRequest, Bar>;
    /** Stream live quotes */
    streamQuotes: handleServerStreamingCall<StreamQuotesRequest, Quote>;
    /** Historical OHLCV query */
    getBars: handleUnaryCall<GetBarsRequest, GetBarsResponse>;
    /** Latest quote snapshot */
    getLatestQuote: handleUnaryCall<GetLatestQuoteRequest, Quote>;
    /** Trigger historical backfill (used by xstockstrat-ingest) */
    backfillBars: handleUnaryCall<BackfillBarsRequest, BackfillBarsResponse>;
    /** Report stored OHLCV coverage (earliest/latest/count + gaps) for a symbol+timeframe */
    getDataCoverage: handleUnaryCall<GetDataCoverageRequest, GetDataCoverageResponse>;
    /** Scoped delete of backfilled OHLCV bars (admin-only, symbol-bounded — FR-5) */
    deleteBackfilledData: handleUnaryCall<DeleteBackfilledDataRequest, DeleteBackfilledDataResponse>;
    /** Get available symbols */
    listAssets: handleUnaryCall<ListAssetsRequest, ListAssetsResponse>;
}
export interface MarketDataServiceClient extends Client {
    /** Stream live bar data for symbols */
    streamBars(request: StreamBarsRequest, options?: Partial<CallOptions>): ClientReadableStream<Bar>;
    streamBars(request: StreamBarsRequest, metadata?: Metadata, options?: Partial<CallOptions>): ClientReadableStream<Bar>;
    /** Stream live quotes */
    streamQuotes(request: StreamQuotesRequest, options?: Partial<CallOptions>): ClientReadableStream<Quote>;
    streamQuotes(request: StreamQuotesRequest, metadata?: Metadata, options?: Partial<CallOptions>): ClientReadableStream<Quote>;
    /** Historical OHLCV query */
    getBars(request: GetBarsRequest, callback: (error: ServiceError | null, response: GetBarsResponse) => void): ClientUnaryCall;
    getBars(request: GetBarsRequest, metadata: Metadata, callback: (error: ServiceError | null, response: GetBarsResponse) => void): ClientUnaryCall;
    getBars(request: GetBarsRequest, metadata: Metadata, options: Partial<CallOptions>, callback: (error: ServiceError | null, response: GetBarsResponse) => void): ClientUnaryCall;
    /** Latest quote snapshot */
    getLatestQuote(request: GetLatestQuoteRequest, callback: (error: ServiceError | null, response: Quote) => void): ClientUnaryCall;
    getLatestQuote(request: GetLatestQuoteRequest, metadata: Metadata, callback: (error: ServiceError | null, response: Quote) => void): ClientUnaryCall;
    getLatestQuote(request: GetLatestQuoteRequest, metadata: Metadata, options: Partial<CallOptions>, callback: (error: ServiceError | null, response: Quote) => void): ClientUnaryCall;
    /** Trigger historical backfill (used by xstockstrat-ingest) */
    backfillBars(request: BackfillBarsRequest, callback: (error: ServiceError | null, response: BackfillBarsResponse) => void): ClientUnaryCall;
    backfillBars(request: BackfillBarsRequest, metadata: Metadata, callback: (error: ServiceError | null, response: BackfillBarsResponse) => void): ClientUnaryCall;
    backfillBars(request: BackfillBarsRequest, metadata: Metadata, options: Partial<CallOptions>, callback: (error: ServiceError | null, response: BackfillBarsResponse) => void): ClientUnaryCall;
    /** Report stored OHLCV coverage (earliest/latest/count + gaps) for a symbol+timeframe */
    getDataCoverage(request: GetDataCoverageRequest, callback: (error: ServiceError | null, response: GetDataCoverageResponse) => void): ClientUnaryCall;
    getDataCoverage(request: GetDataCoverageRequest, metadata: Metadata, callback: (error: ServiceError | null, response: GetDataCoverageResponse) => void): ClientUnaryCall;
    getDataCoverage(request: GetDataCoverageRequest, metadata: Metadata, options: Partial<CallOptions>, callback: (error: ServiceError | null, response: GetDataCoverageResponse) => void): ClientUnaryCall;
    /** Scoped delete of backfilled OHLCV bars (admin-only, symbol-bounded — FR-5) */
    deleteBackfilledData(request: DeleteBackfilledDataRequest, callback: (error: ServiceError | null, response: DeleteBackfilledDataResponse) => void): ClientUnaryCall;
    deleteBackfilledData(request: DeleteBackfilledDataRequest, metadata: Metadata, callback: (error: ServiceError | null, response: DeleteBackfilledDataResponse) => void): ClientUnaryCall;
    deleteBackfilledData(request: DeleteBackfilledDataRequest, metadata: Metadata, options: Partial<CallOptions>, callback: (error: ServiceError | null, response: DeleteBackfilledDataResponse) => void): ClientUnaryCall;
    /** Get available symbols */
    listAssets(request: ListAssetsRequest, callback: (error: ServiceError | null, response: ListAssetsResponse) => void): ClientUnaryCall;
    listAssets(request: ListAssetsRequest, metadata: Metadata, callback: (error: ServiceError | null, response: ListAssetsResponse) => void): ClientUnaryCall;
    listAssets(request: ListAssetsRequest, metadata: Metadata, options: Partial<CallOptions>, callback: (error: ServiceError | null, response: ListAssetsResponse) => void): ClientUnaryCall;
}
export declare const MarketDataServiceClient: {
    new (address: string, credentials: ChannelCredentials, options?: Partial<ClientOptions>): MarketDataServiceClient;
    service: typeof MarketDataServiceService;
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

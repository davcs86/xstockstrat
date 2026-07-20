import type { GenFile, GenMessage, GenService } from "@bufbuild/protobuf/codegenv2";
import type { Timestamp } from "@bufbuild/protobuf/wkt";
import type { Asset, PageRequest, PageResponse, Timeframe, TimeRange } from "../../common/v1/common_pb";
import type { Message } from "@bufbuild/protobuf";
/**
 * Describes the file marketdata/v1/marketdata.proto.
 */
export declare const file_marketdata_v1_marketdata: GenFile;
/**
 * @generated from message xstockstrat.marketdata.v1.Bar
 */
export type Bar = Message<"xstockstrat.marketdata.v1.Bar"> & {
    /**
     * @generated from field: string symbol = 1;
     */
    symbol: string;
    /**
     * @generated from field: google.protobuf.Timestamp time = 2;
     */
    time?: Timestamp | undefined;
    /**
     * @generated from field: double open = 3;
     */
    open: number;
    /**
     * @generated from field: double high = 4;
     */
    high: number;
    /**
     * @generated from field: double low = 5;
     */
    low: number;
    /**
     * @generated from field: double close = 6;
     */
    close: number;
    /**
     * @generated from field: int64 volume = 7;
     */
    volume: bigint;
    /**
     * @generated from field: double vwap = 8;
     */
    vwap: number;
    /**
     * @generated from field: int32 trade_count = 9;
     */
    tradeCount: number;
    /**
     * DEPRECATED: use timeframe_enum. Removed in a future release once all callers migrate.
     *
     * "15m", "1h", "1d"
     *
     * @generated from field: string timeframe = 10 [deprecated = true];
     * @deprecated
     */
    timeframe: string;
    /**
     * always "alpaca" for this service
     *
     * @generated from field: string source = 11;
     */
    source: string;
    /**
     * @generated from field: xstockstrat.common.v1.Timeframe timeframe_enum = 12;
     */
    timeframeEnum: Timeframe;
};
/**
 * Describes the message xstockstrat.marketdata.v1.Bar.
 * Use `create(BarSchema)` to create a new message.
 */
export declare const BarSchema: GenMessage<Bar>;
/**
 * @generated from message xstockstrat.marketdata.v1.Quote
 */
export type Quote = Message<"xstockstrat.marketdata.v1.Quote"> & {
    /**
     * @generated from field: string symbol = 1;
     */
    symbol: string;
    /**
     * @generated from field: google.protobuf.Timestamp time = 2;
     */
    time?: Timestamp | undefined;
    /**
     * @generated from field: double ask_price = 3;
     */
    askPrice: number;
    /**
     * @generated from field: int32 ask_size = 4;
     */
    askSize: number;
    /**
     * @generated from field: double bid_price = 5;
     */
    bidPrice: number;
    /**
     * @generated from field: int32 bid_size = 6;
     */
    bidSize: number;
    /**
     * @generated from field: string source = 7;
     */
    source: string;
};
/**
 * Describes the message xstockstrat.marketdata.v1.Quote.
 * Use `create(QuoteSchema)` to create a new message.
 */
export declare const QuoteSchema: GenMessage<Quote>;
/**
 * @generated from message xstockstrat.marketdata.v1.StreamBarsRequest
 */
export type StreamBarsRequest = Message<"xstockstrat.marketdata.v1.StreamBarsRequest"> & {
    /**
     * @generated from field: repeated string symbols = 1;
     */
    symbols: string[];
    /**
     * DEPRECATED: use timeframe_enum. Removed in a future release once all callers migrate.
     *
     * "15m", "1h", "1d"
     *
     * @generated from field: string timeframe = 2 [deprecated = true];
     * @deprecated
     */
    timeframe: string;
    /**
     * @generated from field: bool include_premarket = 3;
     */
    includePremarket: boolean;
    /**
     * @generated from field: bool include_afterhours = 4;
     */
    includeAfterhours: boolean;
    /**
     * @generated from field: xstockstrat.common.v1.Timeframe timeframe_enum = 5;
     */
    timeframeEnum: Timeframe;
};
/**
 * Describes the message xstockstrat.marketdata.v1.StreamBarsRequest.
 * Use `create(StreamBarsRequestSchema)` to create a new message.
 */
export declare const StreamBarsRequestSchema: GenMessage<StreamBarsRequest>;
/**
 * @generated from message xstockstrat.marketdata.v1.StreamQuotesRequest
 */
export type StreamQuotesRequest = Message<"xstockstrat.marketdata.v1.StreamQuotesRequest"> & {
    /**
     * @generated from field: repeated string symbols = 1;
     */
    symbols: string[];
};
/**
 * Describes the message xstockstrat.marketdata.v1.StreamQuotesRequest.
 * Use `create(StreamQuotesRequestSchema)` to create a new message.
 */
export declare const StreamQuotesRequestSchema: GenMessage<StreamQuotesRequest>;
/**
 * @generated from message xstockstrat.marketdata.v1.GetBarsRequest
 */
export type GetBarsRequest = Message<"xstockstrat.marketdata.v1.GetBarsRequest"> & {
    /**
     * @generated from field: string symbol = 1;
     */
    symbol: string;
    /**
     * DEPRECATED: use timeframe_enum. Removed in a future release once all callers migrate.
     *
     * @generated from field: string timeframe = 2 [deprecated = true];
     * @deprecated
     */
    timeframe: string;
    /**
     * @generated from field: xstockstrat.common.v1.TimeRange range = 3;
     */
    range?: TimeRange | undefined;
    /**
     * @generated from field: xstockstrat.common.v1.PageRequest page = 4;
     */
    page?: PageRequest | undefined;
    /**
     * @generated from field: xstockstrat.common.v1.Timeframe timeframe_enum = 5;
     */
    timeframeEnum: Timeframe;
};
/**
 * Describes the message xstockstrat.marketdata.v1.GetBarsRequest.
 * Use `create(GetBarsRequestSchema)` to create a new message.
 */
export declare const GetBarsRequestSchema: GenMessage<GetBarsRequest>;
/**
 * @generated from message xstockstrat.marketdata.v1.GetBarsResponse
 */
export type GetBarsResponse = Message<"xstockstrat.marketdata.v1.GetBarsResponse"> & {
    /**
     * @generated from field: repeated xstockstrat.marketdata.v1.Bar bars = 1;
     */
    bars: Bar[];
    /**
     * @generated from field: xstockstrat.common.v1.PageResponse page = 2;
     */
    page?: PageResponse | undefined;
};
/**
 * Describes the message xstockstrat.marketdata.v1.GetBarsResponse.
 * Use `create(GetBarsResponseSchema)` to create a new message.
 */
export declare const GetBarsResponseSchema: GenMessage<GetBarsResponse>;
/**
 * @generated from message xstockstrat.marketdata.v1.GetLatestQuoteRequest
 */
export type GetLatestQuoteRequest = Message<"xstockstrat.marketdata.v1.GetLatestQuoteRequest"> & {
    /**
     * @generated from field: string symbol = 1;
     */
    symbol: string;
};
/**
 * Describes the message xstockstrat.marketdata.v1.GetLatestQuoteRequest.
 * Use `create(GetLatestQuoteRequestSchema)` to create a new message.
 */
export declare const GetLatestQuoteRequestSchema: GenMessage<GetLatestQuoteRequest>;
/**
 * @generated from message xstockstrat.marketdata.v1.BackfillBarsRequest
 */
export type BackfillBarsRequest = Message<"xstockstrat.marketdata.v1.BackfillBarsRequest"> & {
    /**
     * @generated from field: repeated string symbols = 1;
     */
    symbols: string[];
    /**
     * DEPRECATED: use timeframe_enum. Removed in a future release once all callers migrate.
     *
     * @generated from field: string timeframe = 2 [deprecated = true];
     * @deprecated
     */
    timeframe: string;
    /**
     * @generated from field: xstockstrat.common.v1.TimeRange range = 3;
     */
    range?: TimeRange | undefined;
    /**
     * @generated from field: bool overwrite_existing = 4;
     */
    overwriteExisting: boolean;
    /**
     * @generated from field: xstockstrat.common.v1.Timeframe timeframe_enum = 5;
     */
    timeframeEnum: Timeframe;
};
/**
 * Describes the message xstockstrat.marketdata.v1.BackfillBarsRequest.
 * Use `create(BackfillBarsRequestSchema)` to create a new message.
 */
export declare const BackfillBarsRequestSchema: GenMessage<BackfillBarsRequest>;
/**
 * @generated from message xstockstrat.marketdata.v1.BackfillBarsResponse
 */
export type BackfillBarsResponse = Message<"xstockstrat.marketdata.v1.BackfillBarsResponse"> & {
    /**
     * @generated from field: int64 bars_written = 1;
     */
    barsWritten: bigint;
    /**
     * @generated from field: repeated string failed_symbols = 2;
     */
    failedSymbols: string[];
    /**
     * estimated total bars across requested symbols/range (FR-6)
     *
     * @generated from field: int64 expected_bars = 3;
     */
    expectedBars: bigint;
};
/**
 * Describes the message xstockstrat.marketdata.v1.BackfillBarsResponse.
 * Use `create(BackfillBarsResponseSchema)` to create a new message.
 */
export declare const BackfillBarsResponseSchema: GenMessage<BackfillBarsResponse>;
/**
 * @generated from message xstockstrat.marketdata.v1.GetDataCoverageRequest
 */
export type GetDataCoverageRequest = Message<"xstockstrat.marketdata.v1.GetDataCoverageRequest"> & {
    /**
     * @generated from field: string symbol = 1;
     */
    symbol: string;
    /**
     * @generated from field: xstockstrat.common.v1.Timeframe timeframe = 2;
     */
    timeframe: Timeframe;
    /**
     * Optional: restrict the coverage scan to this window. Empty = full history.
     *
     * @generated from field: xstockstrat.common.v1.TimeRange range = 3;
     */
    range?: TimeRange | undefined;
};
/**
 * Describes the message xstockstrat.marketdata.v1.GetDataCoverageRequest.
 * Use `create(GetDataCoverageRequestSchema)` to create a new message.
 */
export declare const GetDataCoverageRequestSchema: GenMessage<GetDataCoverageRequest>;
/**
 * @generated from message xstockstrat.marketdata.v1.CoverageRange
 */
export type CoverageRange = Message<"xstockstrat.marketdata.v1.CoverageRange"> & {
    /**
     * @generated from field: google.protobuf.Timestamp start = 1;
     */
    start?: Timestamp | undefined;
    /**
     * @generated from field: google.protobuf.Timestamp end = 2;
     */
    end?: Timestamp | undefined;
    /**
     * @generated from field: int64 bar_count = 3;
     */
    barCount: bigint;
};
/**
 * Describes the message xstockstrat.marketdata.v1.CoverageRange.
 * Use `create(CoverageRangeSchema)` to create a new message.
 */
export declare const CoverageRangeSchema: GenMessage<CoverageRange>;
/**
 * @generated from message xstockstrat.marketdata.v1.GetDataCoverageResponse
 */
export type GetDataCoverageResponse = Message<"xstockstrat.marketdata.v1.GetDataCoverageResponse"> & {
    /**
     * @generated from field: string symbol = 1;
     */
    symbol: string;
    /**
     * @generated from field: xstockstrat.common.v1.Timeframe timeframe = 2;
     */
    timeframe: Timeframe;
    /**
     * @generated from field: int64 bars_total = 3;
     */
    barsTotal: bigint;
    /**
     * Covered earliest/latest with total bar count; covered_ranges holds contiguous segments,
     * gaps holds the missing segments within the requested range (if range was supplied).
     *
     * @generated from field: google.protobuf.Timestamp earliest = 4;
     */
    earliest?: Timestamp | undefined;
    /**
     * @generated from field: google.protobuf.Timestamp latest = 5;
     */
    latest?: Timestamp | undefined;
    /**
     * @generated from field: repeated xstockstrat.marketdata.v1.CoverageRange covered_ranges = 6;
     */
    coveredRanges: CoverageRange[];
    /**
     * @generated from field: repeated xstockstrat.common.v1.TimeRange gaps = 7;
     */
    gaps: TimeRange[];
};
/**
 * Describes the message xstockstrat.marketdata.v1.GetDataCoverageResponse.
 * Use `create(GetDataCoverageResponseSchema)` to create a new message.
 */
export declare const GetDataCoverageResponseSchema: GenMessage<GetDataCoverageResponse>;
/**
 * @generated from message xstockstrat.marketdata.v1.ListAssetsRequest
 */
export type ListAssetsRequest = Message<"xstockstrat.marketdata.v1.ListAssetsRequest"> & {
    /**
     * optional: "us_equity", "crypto"
     *
     * @generated from field: string asset_class = 1;
     */
    assetClass: string;
    /**
     * @generated from field: bool tradable_only = 2;
     */
    tradableOnly: boolean;
};
/**
 * Describes the message xstockstrat.marketdata.v1.ListAssetsRequest.
 * Use `create(ListAssetsRequestSchema)` to create a new message.
 */
export declare const ListAssetsRequestSchema: GenMessage<ListAssetsRequest>;
/**
 * @generated from message xstockstrat.marketdata.v1.ListAssetsResponse
 */
export type ListAssetsResponse = Message<"xstockstrat.marketdata.v1.ListAssetsResponse"> & {
    /**
     * @generated from field: repeated xstockstrat.common.v1.Asset assets = 1;
     */
    assets: Asset[];
};
/**
 * Describes the message xstockstrat.marketdata.v1.ListAssetsResponse.
 * Use `create(ListAssetsResponseSchema)` to create a new message.
 */
export declare const ListAssetsResponseSchema: GenMessage<ListAssetsResponse>;
/**
 * @generated from message xstockstrat.marketdata.v1.DeleteBackfilledDataRequest
 */
export type DeleteBackfilledDataRequest = Message<"xstockstrat.marketdata.v1.DeleteBackfilledDataRequest"> & {
    /**
     * REQUIRED — server rejects empty (FR-5)
     *
     * @generated from field: string symbol = 1;
     */
    symbol: string;
    /**
     * optional; empty = whole symbol
     *
     * @generated from field: xstockstrat.common.v1.TimeRange range = 2;
     */
    range?: TimeRange | undefined;
    /**
     * optional; UNSPECIFIED = all timeframes
     *
     * @generated from field: xstockstrat.common.v1.Timeframe timeframe = 3;
     */
    timeframe: Timeframe;
};
/**
 * Describes the message xstockstrat.marketdata.v1.DeleteBackfilledDataRequest.
 * Use `create(DeleteBackfilledDataRequestSchema)` to create a new message.
 */
export declare const DeleteBackfilledDataRequestSchema: GenMessage<DeleteBackfilledDataRequest>;
/**
 * @generated from message xstockstrat.marketdata.v1.DeleteBackfilledDataResponse
 */
export type DeleteBackfilledDataResponse = Message<"xstockstrat.marketdata.v1.DeleteBackfilledDataResponse"> & {
    /**
     * @generated from field: int64 rows_deleted = 1;
     */
    rowsDeleted: bigint;
};
/**
 * Describes the message xstockstrat.marketdata.v1.DeleteBackfilledDataResponse.
 * Use `create(DeleteBackfilledDataResponseSchema)` to create a new message.
 */
export declare const DeleteBackfilledDataResponseSchema: GenMessage<DeleteBackfilledDataResponse>;
/**
 * Fundamentals (feature 059) — cached fundamental metrics for a symbol, FMP-backed.
 *
 * @generated from message xstockstrat.marketdata.v1.Fundamentals
 */
export type Fundamentals = Message<"xstockstrat.marketdata.v1.Fundamentals"> & {
    /**
     * @generated from field: string symbol = 1;
     */
    symbol: string;
    /**
     * @generated from field: double market_cap = 2;
     */
    marketCap: number;
    /**
     * @generated from field: double pe_ratio = 3;
     */
    peRatio: number;
    /**
     * @generated from field: double pb_ratio = 4;
     */
    pbRatio: number;
    /**
     * @generated from field: double dividend_yield = 5;
     */
    dividendYield: number;
    /**
     * @generated from field: double eps = 6;
     */
    eps: number;
    /**
     * @generated from field: double beta = 7;
     */
    beta: number;
    /**
     * @generated from field: double roe = 8;
     */
    roe: number;
    /**
     * @generated from field: double debt_to_equity = 9;
     */
    debtToEquity: number;
    /**
     * @generated from field: double price = 10;
     */
    price: number;
    /**
     * @generated from field: double year_high = 11;
     */
    yearHigh: number;
    /**
     * @generated from field: double year_low = 12;
     */
    yearLow: number;
    /**
     * FMP's open-ended metric set (keys are FMP field names)
     *
     * @generated from field: map<string, double> extra_metrics = 13;
     */
    extraMetrics: {
        [key: string]: number;
    };
    /**
     * @generated from field: google.protobuf.Timestamp as_of = 14;
     */
    asOf?: Timestamp | undefined;
    /**
     * @generated from field: string currency = 15;
     */
    currency: string;
    /**
     * "fmp"
     *
     * @generated from field: string source = 16;
     */
    source: string;
    /**
     * true when served past TTL under quota exhaustion (FR-4)
     *
     * @generated from field: bool stale = 17;
     */
    stale: boolean;
};
/**
 * Describes the message xstockstrat.marketdata.v1.Fundamentals.
 * Use `create(FundamentalsSchema)` to create a new message.
 */
export declare const FundamentalsSchema: GenMessage<Fundamentals>;
/**
 * @generated from message xstockstrat.marketdata.v1.GetFundamentalsRequest
 */
export type GetFundamentalsRequest = Message<"xstockstrat.marketdata.v1.GetFundamentalsRequest"> & {
    /**
     * @generated from field: string symbol = 1;
     */
    symbol: string;
};
/**
 * Describes the message xstockstrat.marketdata.v1.GetFundamentalsRequest.
 * Use `create(GetFundamentalsRequestSchema)` to create a new message.
 */
export declare const GetFundamentalsRequestSchema: GenMessage<GetFundamentalsRequest>;
/**
 * @generated from message xstockstrat.marketdata.v1.GetFundamentalsResponse
 */
export type GetFundamentalsResponse = Message<"xstockstrat.marketdata.v1.GetFundamentalsResponse"> & {
    /**
     * @generated from field: xstockstrat.marketdata.v1.Fundamentals fundamentals = 1;
     */
    fundamentals?: Fundamentals | undefined;
};
/**
 * Describes the message xstockstrat.marketdata.v1.GetFundamentalsResponse.
 * Use `create(GetFundamentalsResponseSchema)` to create a new message.
 */
export declare const GetFundamentalsResponseSchema: GenMessage<GetFundamentalsResponse>;
/**
 * @generated from message xstockstrat.marketdata.v1.GetFundamentalsMultiRequest
 */
export type GetFundamentalsMultiRequest = Message<"xstockstrat.marketdata.v1.GetFundamentalsMultiRequest"> & {
    /**
     * @generated from field: repeated string symbols = 1;
     */
    symbols: string[];
};
/**
 * Describes the message xstockstrat.marketdata.v1.GetFundamentalsMultiRequest.
 * Use `create(GetFundamentalsMultiRequestSchema)` to create a new message.
 */
export declare const GetFundamentalsMultiRequestSchema: GenMessage<GetFundamentalsMultiRequest>;
/**
 * @generated from message xstockstrat.marketdata.v1.GetFundamentalsMultiResponse
 */
export type GetFundamentalsMultiResponse = Message<"xstockstrat.marketdata.v1.GetFundamentalsMultiResponse"> & {
    /**
     * @generated from field: repeated xstockstrat.marketdata.v1.Fundamentals fundamentals = 1;
     */
    fundamentals: Fundamentals[];
};
/**
 * Describes the message xstockstrat.marketdata.v1.GetFundamentalsMultiResponse.
 * Use `create(GetFundamentalsMultiResponseSchema)` to create a new message.
 */
export declare const GetFundamentalsMultiResponseSchema: GenMessage<GetFundamentalsMultiResponse>;
/**
 * MarketDataService — sole Alpaca integration point.
 * Stores OHLCV and quote data in TimescaleDB hypertables.
 *
 * @generated from service xstockstrat.marketdata.v1.MarketDataService
 */
export declare const MarketDataService: GenService<{
    /**
     * Stream live bar data for symbols
     *
     * @generated from rpc xstockstrat.marketdata.v1.MarketDataService.StreamBars
     */
    streamBars: {
        methodKind: "server_streaming";
        input: typeof StreamBarsRequestSchema;
        output: typeof BarSchema;
    };
    /**
     * Stream live quotes
     *
     * @generated from rpc xstockstrat.marketdata.v1.MarketDataService.StreamQuotes
     */
    streamQuotes: {
        methodKind: "server_streaming";
        input: typeof StreamQuotesRequestSchema;
        output: typeof QuoteSchema;
    };
    /**
     * Historical OHLCV query
     *
     * @generated from rpc xstockstrat.marketdata.v1.MarketDataService.GetBars
     */
    getBars: {
        methodKind: "unary";
        input: typeof GetBarsRequestSchema;
        output: typeof GetBarsResponseSchema;
    };
    /**
     * Latest quote snapshot
     *
     * @generated from rpc xstockstrat.marketdata.v1.MarketDataService.GetLatestQuote
     */
    getLatestQuote: {
        methodKind: "unary";
        input: typeof GetLatestQuoteRequestSchema;
        output: typeof QuoteSchema;
    };
    /**
     * Trigger historical backfill (used by xstockstrat-ingest)
     *
     * @generated from rpc xstockstrat.marketdata.v1.MarketDataService.BackfillBars
     */
    backfillBars: {
        methodKind: "unary";
        input: typeof BackfillBarsRequestSchema;
        output: typeof BackfillBarsResponseSchema;
    };
    /**
     * Report stored OHLCV coverage (earliest/latest/count + gaps) for a symbol+timeframe
     *
     * @generated from rpc xstockstrat.marketdata.v1.MarketDataService.GetDataCoverage
     */
    getDataCoverage: {
        methodKind: "unary";
        input: typeof GetDataCoverageRequestSchema;
        output: typeof GetDataCoverageResponseSchema;
    };
    /**
     * Scoped delete of backfilled OHLCV bars (admin-only, symbol-bounded — FR-5)
     *
     * @generated from rpc xstockstrat.marketdata.v1.MarketDataService.DeleteBackfilledData
     */
    deleteBackfilledData: {
        methodKind: "unary";
        input: typeof DeleteBackfilledDataRequestSchema;
        output: typeof DeleteBackfilledDataResponseSchema;
    };
    /**
     * Get available symbols
     *
     * @generated from rpc xstockstrat.marketdata.v1.MarketDataService.ListAssets
     */
    listAssets: {
        methodKind: "unary";
        input: typeof ListAssetsRequestSchema;
        output: typeof ListAssetsResponseSchema;
    };
    /**
     * Cached fundamental metrics for one symbol (FMP-backed, read-through DB cache)
     *
     * @generated from rpc xstockstrat.marketdata.v1.MarketDataService.GetFundamentals
     */
    getFundamentals: {
        methodKind: "unary";
        input: typeof GetFundamentalsRequestSchema;
        output: typeof GetFundamentalsResponseSchema;
    };
    /**
     * Batched fundamentals for a watchlist scan (core metrics via one FMP quote call)
     *
     * @generated from rpc xstockstrat.marketdata.v1.MarketDataService.GetFundamentalsMulti
     */
    getFundamentalsMulti: {
        methodKind: "unary";
        input: typeof GetFundamentalsMultiRequestSchema;
        output: typeof GetFundamentalsMultiResponseSchema;
    };
}>;

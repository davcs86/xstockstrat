import type { GenFile, GenMessage, GenService } from "@bufbuild/protobuf/codegenv2";
import type { Timestamp } from "@bufbuild/protobuf/wkt";
import type { Asset, PageRequest, PageResponse, TimeRange } from "../../common/v1/common_pb";
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
     * "1m", "5m", "1h", "1d"
     *
     * @generated from field: string timeframe = 10;
     */
    timeframe: string;
    /**
     * always "alpaca" for this service
     *
     * @generated from field: string source = 11;
     */
    source: string;
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
     * "1m", "5m", "1h", "1d"
     *
     * @generated from field: string timeframe = 2;
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
     * @generated from field: string timeframe = 2;
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
     * @generated from field: string timeframe = 2;
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
};
/**
 * Describes the message xstockstrat.marketdata.v1.BackfillBarsResponse.
 * Use `create(BackfillBarsResponseSchema)` to create a new message.
 */
export declare const BackfillBarsResponseSchema: GenMessage<BackfillBarsResponse>;
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
     * Get available symbols
     *
     * @generated from rpc xstockstrat.marketdata.v1.MarketDataService.ListAssets
     */
    listAssets: {
        methodKind: "unary";
        input: typeof ListAssetsRequestSchema;
        output: typeof ListAssetsResponseSchema;
    };
}>;

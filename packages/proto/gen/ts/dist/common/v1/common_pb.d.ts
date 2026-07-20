import type { GenEnum, GenFile, GenMessage } from "@bufbuild/protobuf/codegenv2";
import type { Timestamp } from "@bufbuild/protobuf/wkt";
import type { Message } from "@bufbuild/protobuf";
/**
 * Describes the file common/v1/common.proto.
 */
export declare const file_common_v1_common: GenFile;
/**
 * Pagination
 *
 * @generated from message xstockstrat.common.v1.PageRequest
 */
export type PageRequest = Message<"xstockstrat.common.v1.PageRequest"> & {
    /**
     * @generated from field: int32 page_size = 1;
     */
    pageSize: number;
    /**
     * @generated from field: string page_token = 2;
     */
    pageToken: string;
};
/**
 * Describes the message xstockstrat.common.v1.PageRequest.
 * Use `create(PageRequestSchema)` to create a new message.
 */
export declare const PageRequestSchema: GenMessage<PageRequest>;
/**
 * @generated from message xstockstrat.common.v1.PageResponse
 */
export type PageResponse = Message<"xstockstrat.common.v1.PageResponse"> & {
    /**
     * @generated from field: string next_page_token = 1;
     */
    nextPageToken: string;
    /**
     * @generated from field: int32 total_count = 2;
     */
    totalCount: number;
};
/**
 * Describes the message xstockstrat.common.v1.PageResponse.
 * Use `create(PageResponseSchema)` to create a new message.
 */
export declare const PageResponseSchema: GenMessage<PageResponse>;
/**
 * Standard error envelope
 *
 * @generated from message xstockstrat.common.v1.Error
 */
export type Error = Message<"xstockstrat.common.v1.Error"> & {
    /**
     * @generated from field: string code = 1;
     */
    code: string;
    /**
     * @generated from field: string message = 2;
     */
    message: string;
    /**
     * @generated from field: map<string, string> details = 3;
     */
    details: {
        [key: string]: string;
    };
};
/**
 * Describes the message xstockstrat.common.v1.Error.
 * Use `create(ErrorSchema)` to create a new message.
 */
export declare const ErrorSchema: GenMessage<Error>;
/**
 * Money / decimal representation
 *
 * @generated from message xstockstrat.common.v1.Decimal
 */
export type Decimal = Message<"xstockstrat.common.v1.Decimal"> & {
    /**
     * integer part
     *
     * @generated from field: int64 units = 1;
     */
    units: bigint;
    /**
     * fractional part (0..999_999_999)
     *
     * @generated from field: int32 nanos = 2;
     */
    nanos: number;
    /**
     * ISO 4217
     *
     * @generated from field: string currency = 3;
     */
    currency: string;
};
/**
 * Describes the message xstockstrat.common.v1.Decimal.
 * Use `create(DecimalSchema)` to create a new message.
 */
export declare const DecimalSchema: GenMessage<Decimal>;
/**
 * Asset identifier
 *
 * @generated from message xstockstrat.common.v1.Asset
 */
export type Asset = Message<"xstockstrat.common.v1.Asset"> & {
    /**
     * @generated from field: string symbol = 1;
     */
    symbol: string;
    /**
     * @generated from field: string exchange = 2;
     */
    exchange: string;
    /**
     * equity, crypto, option
     *
     * @generated from field: string asset_class = 3;
     */
    assetClass: string;
};
/**
 * Describes the message xstockstrat.common.v1.Asset.
 * Use `create(AssetSchema)` to create a new message.
 */
export declare const AssetSchema: GenMessage<Asset>;
/**
 * Time range
 *
 * @generated from message xstockstrat.common.v1.TimeRange
 */
export type TimeRange = Message<"xstockstrat.common.v1.TimeRange"> & {
    /**
     * @generated from field: google.protobuf.Timestamp start = 1;
     */
    start?: Timestamp | undefined;
    /**
     * @generated from field: google.protobuf.Timestamp end = 2;
     */
    end?: Timestamp | undefined;
};
/**
 * Describes the message xstockstrat.common.v1.TimeRange.
 * Use `create(TimeRangeSchema)` to create a new message.
 */
export declare const TimeRangeSchema: GenMessage<TimeRange>;
/**
 * TradingMode distinguishes paper (simulated) from live (real-money) order routing.
 * Used by both xstockstrat-trading and xstockstrat-portfolio.
 *
 * @generated from enum xstockstrat.common.v1.TradingMode
 */
export declare enum TradingMode {
    /**
     * @generated from enum value: TRADING_MODE_UNSPECIFIED = 0;
     */
    UNSPECIFIED = 0,
    /**
     * @generated from enum value: TRADING_MODE_PAPER = 1;
     */
    PAPER = 1,
    /**
     * @generated from enum value: TRADING_MODE_LIVE = 2;
     */
    LIVE = 2
}
/**
 * Describes the enum xstockstrat.common.v1.TradingMode.
 */
export declare const TradingModeSchema: GenEnum<TradingMode>;
/**
 * Environment distinguishes dev from production deployments.
 * Used by xstockstrat-config to scope config values per deployment environment.
 *
 * @generated from enum xstockstrat.common.v1.Environment
 */
export declare enum Environment {
    /**
     * @generated from enum value: ENVIRONMENT_UNSPECIFIED = 0;
     */
    UNSPECIFIED = 0,
    /**
     * @generated from enum value: ENVIRONMENT_DEV = 1;
     */
    DEV = 1,
    /**
     * @generated from enum value: ENVIRONMENT_PRODUCTION = 2;
     */
    PRODUCTION = 2
}
/**
 * Describes the enum xstockstrat.common.v1.Environment.
 */
export declare const EnvironmentSchema: GenEnum<Environment>;
/**
 * BrokerType identifies the broker for a registered account.
 *
 * @generated from enum xstockstrat.common.v1.BrokerType
 */
export declare enum BrokerType {
    /**
     * @generated from enum value: BROKER_TYPE_UNSPECIFIED = 0;
     */
    UNSPECIFIED = 0,
    /**
     * @generated from enum value: BROKER_TYPE_ALPACA = 1;
     */
    ALPACA = 1,
    /**
     * @generated from enum value: BROKER_TYPE_IBKR = 2;
     */
    IBKR = 2
}
/**
 * Describes the enum xstockstrat.common.v1.BrokerType.
 */
export declare const BrokerTypeSchema: GenEnum<BrokerType>;
/**
 * Timeframe is the canonical OHLCV bar interval, shared by marketdata + analysis + ingest.
 * Replaces the free-text "1d"/"1Day"/"1m" strings that previously mismatched across services.
 *
 * 15 minutes is the smallest supported interval: the free Alpaca market-data plan serves
 * 15-minute-delayed data, and the platform is not a real-time trader. TIMEFRAME_1MIN and
 * TIMEFRAME_5MIN are deprecated — no longer ingested or selectable — but retained (not
 * deleted) so the change stays wire- and source-compatible.
 *
 * @generated from enum xstockstrat.common.v1.Timeframe
 */
export declare enum Timeframe {
    /**
     * @generated from enum value: TIMEFRAME_UNSPECIFIED = 0;
     */
    TIMEFRAME_UNSPECIFIED = 0,
    /**
     * smallest supported interval
     *
     * @generated from enum value: TIMEFRAME_15MIN = 5;
     */
    TIMEFRAME_15MIN = 5,
    /**
     * @generated from enum value: TIMEFRAME_1HOUR = 3;
     */
    TIMEFRAME_1HOUR = 3,
    /**
     * @generated from enum value: TIMEFRAME_1DAY = 4;
     */
    TIMEFRAME_1DAY = 4,
    /**
     * deprecated: sub-15m intervals removed from the product
     *
     * @generated from enum value: TIMEFRAME_1MIN = 1 [deprecated = true];
     * @deprecated
     */
    TIMEFRAME_1MIN = 1,
    /**
     * deprecated: sub-15m intervals removed from the product
     *
     * @generated from enum value: TIMEFRAME_5MIN = 2 [deprecated = true];
     * @deprecated
     */
    TIMEFRAME_5MIN = 2
}
/**
 * Describes the enum xstockstrat.common.v1.Timeframe.
 */
export declare const TimeframeSchema: GenEnum<Timeframe>;

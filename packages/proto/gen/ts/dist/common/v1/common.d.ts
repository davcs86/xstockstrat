import { BinaryReader, BinaryWriter } from "@bufbuild/protobuf/wire";
export declare const protobufPackage = "xstockstrat.common.v1";
/**
 * TradingMode distinguishes paper (simulated) from live (real-money) order routing.
 * Used by both xstockstrat-trading and xstockstrat-portfolio.
 */
export declare enum TradingMode {
    TRADING_MODE_UNSPECIFIED = "TRADING_MODE_UNSPECIFIED",
    TRADING_MODE_PAPER = "TRADING_MODE_PAPER",
    TRADING_MODE_LIVE = "TRADING_MODE_LIVE",
    UNRECOGNIZED = "UNRECOGNIZED"
}
export declare function tradingModeFromJSON(object: any): TradingMode;
export declare function tradingModeToJSON(object: TradingMode): string;
export declare function tradingModeToNumber(object: TradingMode): number;
/**
 * Environment distinguishes deployment environments; used by xstockstrat-config to scope config
 * values. The platform's two environments are STAGING and PRODUCTION (feature 147). paper/live
 * trading mode is DERIVED from the environment (production=live, staging=paper), not a separate
 * config dimension. ENVIRONMENT_DEV is deprecated in favor of ENVIRONMENT_STAGING but retained for
 * wire compatibility; the config server treats DEV and STAGING as the same 'staging' scope.
 */
export declare enum Environment {
    ENVIRONMENT_UNSPECIFIED = "ENVIRONMENT_UNSPECIFIED",
    /**
     * ENVIRONMENT_DEV - deprecated: use ENVIRONMENT_STAGING (feature 147)
     *
     * @deprecated
     */
    ENVIRONMENT_DEV = "ENVIRONMENT_DEV",
    ENVIRONMENT_PRODUCTION = "ENVIRONMENT_PRODUCTION",
    ENVIRONMENT_STAGING = "ENVIRONMENT_STAGING",
    UNRECOGNIZED = "UNRECOGNIZED"
}
export declare function environmentFromJSON(object: any): Environment;
export declare function environmentToJSON(object: Environment): string;
export declare function environmentToNumber(object: Environment): number;
/** BrokerType identifies the broker for a registered account. */
export declare enum BrokerType {
    BROKER_TYPE_UNSPECIFIED = "BROKER_TYPE_UNSPECIFIED",
    BROKER_TYPE_ALPACA = "BROKER_TYPE_ALPACA",
    BROKER_TYPE_IBKR = "BROKER_TYPE_IBKR",
    UNRECOGNIZED = "UNRECOGNIZED"
}
export declare function brokerTypeFromJSON(object: any): BrokerType;
export declare function brokerTypeToJSON(object: BrokerType): string;
export declare function brokerTypeToNumber(object: BrokerType): number;
/**
 * Timeframe is the canonical OHLCV bar interval, shared by marketdata + analysis + ingest.
 * Replaces the free-text "1d"/"1Day"/"1m" strings that previously mismatched across services.
 *
 * Only TIMEFRAME_1DAY is requestable (feature 143) — GetBars/BackfillBars reject anything
 * else. TIMEFRAME_15MIN/TIMEFRAME_1HOUR are deprecated but retained (not deleted, not
 * renumbered) for wire compatibility with historically-stored 15m/1h rows, mirroring how
 * TIMEFRAME_1MIN/TIMEFRAME_5MIN were already handled when sub-15m intervals stopped being
 * selectable.
 */
export declare enum Timeframe {
    TIMEFRAME_UNSPECIFIED = "TIMEFRAME_UNSPECIFIED",
    /**
     * TIMEFRAME_15MIN - deprecated: only 1d is requestable (feature 143)
     *
     * @deprecated
     */
    TIMEFRAME_15MIN = "TIMEFRAME_15MIN",
    /**
     * TIMEFRAME_1HOUR - deprecated: only 1d is requestable (feature 143)
     *
     * @deprecated
     */
    TIMEFRAME_1HOUR = "TIMEFRAME_1HOUR",
    TIMEFRAME_1DAY = "TIMEFRAME_1DAY",
    /**
     * TIMEFRAME_1MIN - deprecated: sub-15m intervals removed from the product
     *
     * @deprecated
     */
    TIMEFRAME_1MIN = "TIMEFRAME_1MIN",
    /**
     * TIMEFRAME_5MIN - deprecated: sub-15m intervals removed from the product
     *
     * @deprecated
     */
    TIMEFRAME_5MIN = "TIMEFRAME_5MIN",
    UNRECOGNIZED = "UNRECOGNIZED"
}
export declare function timeframeFromJSON(object: any): Timeframe;
export declare function timeframeToJSON(object: Timeframe): string;
export declare function timeframeToNumber(object: Timeframe): number;
/** Pagination */
export interface PageRequest {
    pageSize: number;
    pageToken: string;
}
export interface PageResponse {
    nextPageToken: string;
    totalCount: number;
}
/** Standard error envelope */
export interface Error {
    code: string;
    message: string;
    details: {
        [key: string]: string;
    };
}
export interface Error_DetailsEntry {
    key: string;
    value: string;
}
/** Money / decimal representation */
export interface Decimal {
    /** integer part */
    units: number;
    /** fractional part (0..999_999_999) */
    nanos: number;
    /** ISO 4217 */
    currency: string;
}
/** Asset identifier */
export interface Asset {
    symbol: string;
    exchange: string;
    /** equity, crypto, option */
    assetClass: string;
}
/** Time range */
export interface TimeRange {
    start?: Date | undefined;
    end?: Date | undefined;
}
export declare const PageRequest: MessageFns<PageRequest>;
export declare const PageResponse: MessageFns<PageResponse>;
export declare const Error: MessageFns<Error>;
export declare const Error_DetailsEntry: MessageFns<Error_DetailsEntry>;
export declare const Decimal: MessageFns<Decimal>;
export declare const Asset: MessageFns<Asset>;
export declare const TimeRange: MessageFns<TimeRange>;
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

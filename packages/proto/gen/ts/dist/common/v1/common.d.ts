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
 * Environment distinguishes dev from production deployments.
 * Used by xstockstrat-config to scope config values per deployment environment.
 */
export declare enum Environment {
    ENVIRONMENT_UNSPECIFIED = "ENVIRONMENT_UNSPECIFIED",
    ENVIRONMENT_DEV = "ENVIRONMENT_DEV",
    ENVIRONMENT_PRODUCTION = "ENVIRONMENT_PRODUCTION",
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

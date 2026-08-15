import { BinaryReader, BinaryWriter } from "@bufbuild/protobuf/wire";
export declare const protobufPackage = "google.protobuf";
/**
 * Wrapper message for `double`.
 *
 * The JSON representation for `DoubleValue` is JSON number.
 *
 * Not recommended for use in new APIs, but still useful for legacy APIs and
 * has no plan to be removed.
 */
export interface DoubleValue {
    /** The double value. */
    value: number;
}
/**
 * Wrapper message for `float`.
 *
 * The JSON representation for `FloatValue` is JSON number.
 *
 * Not recommended for use in new APIs, but still useful for legacy APIs and
 * has no plan to be removed.
 */
export interface FloatValue {
    /** The float value. */
    value: number;
}
/**
 * Wrapper message for `int64`.
 *
 * The JSON representation for `Int64Value` is JSON string.
 *
 * Not recommended for use in new APIs, but still useful for legacy APIs and
 * has no plan to be removed.
 */
export interface Int64Value {
    /** The int64 value. */
    value: number;
}
/**
 * Wrapper message for `uint64`.
 *
 * The JSON representation for `UInt64Value` is JSON string.
 *
 * Not recommended for use in new APIs, but still useful for legacy APIs and
 * has no plan to be removed.
 */
export interface UInt64Value {
    /** The uint64 value. */
    value: number;
}
/**
 * Wrapper message for `int32`.
 *
 * The JSON representation for `Int32Value` is JSON number.
 *
 * Not recommended for use in new APIs, but still useful for legacy APIs and
 * has no plan to be removed.
 */
export interface Int32Value {
    /** The int32 value. */
    value: number;
}
/**
 * Wrapper message for `uint32`.
 *
 * The JSON representation for `UInt32Value` is JSON number.
 *
 * Not recommended for use in new APIs, but still useful for legacy APIs and
 * has no plan to be removed.
 */
export interface UInt32Value {
    /** The uint32 value. */
    value: number;
}
/**
 * Wrapper message for `bool`.
 *
 * The JSON representation for `BoolValue` is JSON `true` and `false`.
 *
 * Not recommended for use in new APIs, but still useful for legacy APIs and
 * has no plan to be removed.
 */
export interface BoolValue {
    /** The bool value. */
    value: boolean;
}
/**
 * Wrapper message for `string`.
 *
 * The JSON representation for `StringValue` is JSON string.
 *
 * Not recommended for use in new APIs, but still useful for legacy APIs and
 * has no plan to be removed.
 */
export interface StringValue {
    /** The string value. */
    value: string;
}
/**
 * Wrapper message for `bytes`.
 *
 * The JSON representation for `BytesValue` is JSON string.
 *
 * Not recommended for use in new APIs, but still useful for legacy APIs and
 * has no plan to be removed.
 */
export interface BytesValue {
    /** The bytes value. */
    value: Buffer;
}
export declare const DoubleValue: MessageFns<DoubleValue>;
export declare const FloatValue: MessageFns<FloatValue>;
export declare const Int64Value: MessageFns<Int64Value>;
export declare const UInt64Value: MessageFns<UInt64Value>;
export declare const Int32Value: MessageFns<Int32Value>;
export declare const UInt32Value: MessageFns<UInt32Value>;
export declare const BoolValue: MessageFns<BoolValue>;
export declare const StringValue: MessageFns<StringValue>;
export declare const BytesValue: MessageFns<BytesValue>;
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

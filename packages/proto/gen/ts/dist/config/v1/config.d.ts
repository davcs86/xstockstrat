import { BinaryReader, BinaryWriter } from "@bufbuild/protobuf/wire";
import { type CallOptions, type ChannelCredentials, Client, type ClientOptions, type ClientReadableStream, type ClientUnaryCall, type handleServerStreamingCall, type handleUnaryCall, type Metadata, type ServiceError, type UntypedServiceImplementation } from "@grpc/grpc-js";
import { Environment, TradingMode } from "../../common/v1/common";
export declare const protobufPackage = "xstockstrat.config.v1";
export declare enum ConfigUpdateType {
    CONFIG_UPDATE_TYPE_UNSPECIFIED = "CONFIG_UPDATE_TYPE_UNSPECIFIED",
    /** CONFIG_UPDATE_TYPE_SNAPSHOT - full config dump */
    CONFIG_UPDATE_TYPE_SNAPSHOT = "CONFIG_UPDATE_TYPE_SNAPSHOT",
    /** CONFIG_UPDATE_TYPE_DELTA - only changed_keys changed */
    CONFIG_UPDATE_TYPE_DELTA = "CONFIG_UPDATE_TYPE_DELTA",
    /** CONFIG_UPDATE_TYPE_RELOAD - force full reload signal */
    CONFIG_UPDATE_TYPE_RELOAD = "CONFIG_UPDATE_TYPE_RELOAD",
    UNRECOGNIZED = "UNRECOGNIZED"
}
export declare function configUpdateTypeFromJSON(object: any): ConfigUpdateType;
export declare function configUpdateTypeToJSON(object: ConfigUpdateType): string;
export declare function configUpdateTypeToNumber(object: ConfigUpdateType): number;
export declare enum ValueType {
    VALUE_TYPE_UNSPECIFIED = "VALUE_TYPE_UNSPECIFIED",
    VALUE_TYPE_FLOAT_MAP = "VALUE_TYPE_FLOAT_MAP",
    UNRECOGNIZED = "UNRECOGNIZED"
}
export declare function valueTypeFromJSON(object: any): ValueType;
export declare function valueTypeToJSON(object: ValueType): string;
export declare function valueTypeToNumber(object: ValueType): number;
export interface WatchConfigRequest {
    /** e.g. "indicators", "trading", "platform" */
    namespace: string;
    /** service instance identifier */
    clientId: string;
    /** last known version (for delta updates) */
    version: string;
    /** dev or production; defaults to dev */
    environment: Environment;
    /** paper or live; 'all' rows included always */
    tradingMode: TradingMode;
}
export interface ConfigSnapshot {
    namespace: string;
    version: string;
    updatedAt?: Date | undefined;
    values: {
        [key: string]: ConfigValue;
    };
    updateType: ConfigUpdateType;
    /** populated for DELTA updates */
    changedKeys: string[];
    environment: Environment;
    tradingMode: TradingMode;
}
export interface ConfigSnapshot_ValuesEntry {
    key: string;
    value?: ConfigValue | undefined;
}
export interface ConfigValue {
    stringVal?: string | undefined;
    intVal?: number | undefined;
    floatVal?: number | undefined;
    boolVal?: boolean | undefined;
    jsonVal?: {
        [key: string]: any;
    } | undefined;
    /** true = value is redacted; resolved at runtime */
    isSecret: boolean;
    description: string;
    defaultValue: string;
}
/**
 * Validation constraints declared by the config service for a key.
 * When value_type == VALUE_TYPE_FLOAT_MAP, every numeric leaf in the JSON value
 * must satisfy [min_value, max_value]. Absent or VALUE_TYPE_UNSPECIFIED = no validation.
 */
export interface ValidationRule {
    valueType: ValueType;
    minValue: number;
    maxValue: number;
}
export interface GetConfigRequest {
    namespace: string;
    environment: Environment;
    tradingMode: TradingMode;
}
export interface SetConfigRequest {
    namespace: string;
    key: string;
    value?: ConfigValue | undefined;
    author: string;
    reason: string;
    environment: Environment;
    tradingMode: TradingMode;
}
export interface SetConfigResponse {
    version: string;
    updatedAt?: Date | undefined;
}
export interface ListKeysRequest {
    namespace: string;
    environment: Environment;
    tradingMode: TradingMode;
}
export interface ListKeysResponse {
    keys: ConfigKeyMeta[];
}
export interface ConfigKeyMeta {
    key: string;
    description: string;
    defaultValue: string;
    isSecret: boolean;
    consumingService: string;
    environment: Environment;
    tradingMode: TradingMode;
    /** optional; absent = no validation */
    validation?: ValidationRule | undefined;
}
export declare const WatchConfigRequest: MessageFns<WatchConfigRequest>;
export declare const ConfigSnapshot: MessageFns<ConfigSnapshot>;
export declare const ConfigSnapshot_ValuesEntry: MessageFns<ConfigSnapshot_ValuesEntry>;
export declare const ConfigValue: MessageFns<ConfigValue>;
export declare const ValidationRule: MessageFns<ValidationRule>;
export declare const GetConfigRequest: MessageFns<GetConfigRequest>;
export declare const SetConfigRequest: MessageFns<SetConfigRequest>;
export declare const SetConfigResponse: MessageFns<SetConfigResponse>;
export declare const ListKeysRequest: MessageFns<ListKeysRequest>;
export declare const ListKeysResponse: MessageFns<ListKeysResponse>;
export declare const ConfigKeyMeta: MessageFns<ConfigKeyMeta>;
/**
 * ConfigService — live configuration via server-streaming WatchConfig.
 * All services call WatchConfig at startup and stream config updates.
 * Config values are scoped by environment (dev/production) and trading_mode (paper/live/all).
 */
export type ConfigServiceService = typeof ConfigServiceService;
export declare const ConfigServiceService: {
    /**
     * Subscribe to config updates for a given namespace/service.
     * Server streams updates as config changes; initial snapshot is the first message.
     */
    readonly watchConfig: {
        readonly path: "/xstockstrat.config.v1.ConfigService/WatchConfig";
        readonly requestStream: false;
        readonly responseStream: true;
        readonly requestSerialize: (value: WatchConfigRequest) => Buffer;
        readonly requestDeserialize: (value: Buffer) => WatchConfigRequest;
        readonly responseSerialize: (value: ConfigSnapshot) => Buffer;
        readonly responseDeserialize: (value: Buffer) => ConfigSnapshot;
    };
    /** One-shot config fetch (startup fast-path before stream establishes) */
    readonly getConfig: {
        readonly path: "/xstockstrat.config.v1.ConfigService/GetConfig";
        readonly requestStream: false;
        readonly responseStream: false;
        readonly requestSerialize: (value: GetConfigRequest) => Buffer;
        readonly requestDeserialize: (value: Buffer) => GetConfigRequest;
        readonly responseSerialize: (value: ConfigSnapshot) => Buffer;
        readonly responseDeserialize: (value: Buffer) => ConfigSnapshot;
    };
    /** Admin: set or update a config value */
    readonly setConfig: {
        readonly path: "/xstockstrat.config.v1.ConfigService/SetConfig";
        readonly requestStream: false;
        readonly responseStream: false;
        readonly requestSerialize: (value: SetConfigRequest) => Buffer;
        readonly requestDeserialize: (value: Buffer) => SetConfigRequest;
        readonly responseSerialize: (value: SetConfigResponse) => Buffer;
        readonly responseDeserialize: (value: Buffer) => SetConfigResponse;
    };
    /** Admin: list all keys for a namespace */
    readonly listKeys: {
        readonly path: "/xstockstrat.config.v1.ConfigService/ListKeys";
        readonly requestStream: false;
        readonly responseStream: false;
        readonly requestSerialize: (value: ListKeysRequest) => Buffer;
        readonly requestDeserialize: (value: Buffer) => ListKeysRequest;
        readonly responseSerialize: (value: ListKeysResponse) => Buffer;
        readonly responseDeserialize: (value: Buffer) => ListKeysResponse;
    };
};
export interface ConfigServiceServer extends UntypedServiceImplementation {
    /**
     * Subscribe to config updates for a given namespace/service.
     * Server streams updates as config changes; initial snapshot is the first message.
     */
    watchConfig: handleServerStreamingCall<WatchConfigRequest, ConfigSnapshot>;
    /** One-shot config fetch (startup fast-path before stream establishes) */
    getConfig: handleUnaryCall<GetConfigRequest, ConfigSnapshot>;
    /** Admin: set or update a config value */
    setConfig: handleUnaryCall<SetConfigRequest, SetConfigResponse>;
    /** Admin: list all keys for a namespace */
    listKeys: handleUnaryCall<ListKeysRequest, ListKeysResponse>;
}
export interface ConfigServiceClient extends Client {
    /**
     * Subscribe to config updates for a given namespace/service.
     * Server streams updates as config changes; initial snapshot is the first message.
     */
    watchConfig(request: WatchConfigRequest, options?: Partial<CallOptions>): ClientReadableStream<ConfigSnapshot>;
    watchConfig(request: WatchConfigRequest, metadata?: Metadata, options?: Partial<CallOptions>): ClientReadableStream<ConfigSnapshot>;
    /** One-shot config fetch (startup fast-path before stream establishes) */
    getConfig(request: GetConfigRequest, callback: (error: ServiceError | null, response: ConfigSnapshot) => void): ClientUnaryCall;
    getConfig(request: GetConfigRequest, metadata: Metadata, callback: (error: ServiceError | null, response: ConfigSnapshot) => void): ClientUnaryCall;
    getConfig(request: GetConfigRequest, metadata: Metadata, options: Partial<CallOptions>, callback: (error: ServiceError | null, response: ConfigSnapshot) => void): ClientUnaryCall;
    /** Admin: set or update a config value */
    setConfig(request: SetConfigRequest, callback: (error: ServiceError | null, response: SetConfigResponse) => void): ClientUnaryCall;
    setConfig(request: SetConfigRequest, metadata: Metadata, callback: (error: ServiceError | null, response: SetConfigResponse) => void): ClientUnaryCall;
    setConfig(request: SetConfigRequest, metadata: Metadata, options: Partial<CallOptions>, callback: (error: ServiceError | null, response: SetConfigResponse) => void): ClientUnaryCall;
    /** Admin: list all keys for a namespace */
    listKeys(request: ListKeysRequest, callback: (error: ServiceError | null, response: ListKeysResponse) => void): ClientUnaryCall;
    listKeys(request: ListKeysRequest, metadata: Metadata, callback: (error: ServiceError | null, response: ListKeysResponse) => void): ClientUnaryCall;
    listKeys(request: ListKeysRequest, metadata: Metadata, options: Partial<CallOptions>, callback: (error: ServiceError | null, response: ListKeysResponse) => void): ClientUnaryCall;
}
export declare const ConfigServiceClient: {
    new (address: string, credentials: ChannelCredentials, options?: Partial<ClientOptions>): ConfigServiceClient;
    service: typeof ConfigServiceService;
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

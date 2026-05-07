import type { GenEnum, GenFile, GenMessage, GenService } from "@bufbuild/protobuf/codegenv2";
import type { Timestamp } from "@bufbuild/protobuf/wkt";
import type { Environment, TradingMode } from "../../common/v1/common_pb";
import type { JsonObject, Message } from "@bufbuild/protobuf";
/**
 * Describes the file config/v1/config.proto.
 */
export declare const file_config_v1_config: GenFile;
/**
 * @generated from message xstockstrat.config.v1.WatchConfigRequest
 */
export type WatchConfigRequest = Message<"xstockstrat.config.v1.WatchConfigRequest"> & {
    /**
     * e.g. "indicators", "trading", "platform"
     *
     * @generated from field: string namespace = 1;
     */
    namespace: string;
    /**
     * service instance identifier
     *
     * @generated from field: string client_id = 2;
     */
    clientId: string;
    /**
     * last known version (for delta updates)
     *
     * @generated from field: string version = 3;
     */
    version: string;
    /**
     * dev or production; defaults to dev
     *
     * @generated from field: xstockstrat.common.v1.Environment environment = 4;
     */
    environment: Environment;
    /**
     * paper or live; 'all' rows included always
     *
     * @generated from field: xstockstrat.common.v1.TradingMode trading_mode = 5;
     */
    tradingMode: TradingMode;
};
/**
 * Describes the message xstockstrat.config.v1.WatchConfigRequest.
 * Use `create(WatchConfigRequestSchema)` to create a new message.
 */
export declare const WatchConfigRequestSchema: GenMessage<WatchConfigRequest>;
/**
 * @generated from message xstockstrat.config.v1.ConfigSnapshot
 */
export type ConfigSnapshot = Message<"xstockstrat.config.v1.ConfigSnapshot"> & {
    /**
     * @generated from field: string namespace = 1;
     */
    namespace: string;
    /**
     * @generated from field: string version = 2;
     */
    version: string;
    /**
     * @generated from field: google.protobuf.Timestamp updated_at = 3;
     */
    updatedAt?: Timestamp | undefined;
    /**
     * @generated from field: map<string, xstockstrat.config.v1.ConfigValue> values = 4;
     */
    values: {
        [key: string]: ConfigValue;
    };
    /**
     * @generated from field: xstockstrat.config.v1.ConfigUpdateType update_type = 5;
     */
    updateType: ConfigUpdateType;
    /**
     * populated for DELTA updates
     *
     * @generated from field: repeated string changed_keys = 6;
     */
    changedKeys: string[];
    /**
     * @generated from field: xstockstrat.common.v1.Environment environment = 7;
     */
    environment: Environment;
    /**
     * @generated from field: xstockstrat.common.v1.TradingMode trading_mode = 8;
     */
    tradingMode: TradingMode;
};
/**
 * Describes the message xstockstrat.config.v1.ConfigSnapshot.
 * Use `create(ConfigSnapshotSchema)` to create a new message.
 */
export declare const ConfigSnapshotSchema: GenMessage<ConfigSnapshot>;
/**
 * @generated from message xstockstrat.config.v1.ConfigValue
 */
export type ConfigValue = Message<"xstockstrat.config.v1.ConfigValue"> & {
    /**
     * @generated from oneof xstockstrat.config.v1.ConfigValue.value
     */
    value: {
        /**
         * @generated from field: string string_val = 1;
         */
        value: string;
        case: "stringVal";
    } | {
        /**
         * @generated from field: int64 int_val = 2;
         */
        value: bigint;
        case: "intVal";
    } | {
        /**
         * @generated from field: double float_val = 3;
         */
        value: number;
        case: "floatVal";
    } | {
        /**
         * @generated from field: bool bool_val = 4;
         */
        value: boolean;
        case: "boolVal";
    } | {
        /**
         * @generated from field: google.protobuf.Struct json_val = 5;
         */
        value: JsonObject;
        case: "jsonVal";
    } | {
        case: undefined;
        value?: undefined;
    };
    /**
     * true = value is redacted; resolved at runtime
     *
     * @generated from field: bool is_secret = 6;
     */
    isSecret: boolean;
    /**
     * @generated from field: string description = 7;
     */
    description: string;
    /**
     * @generated from field: string default_value = 8;
     */
    defaultValue: string;
};
/**
 * Describes the message xstockstrat.config.v1.ConfigValue.
 * Use `create(ConfigValueSchema)` to create a new message.
 */
export declare const ConfigValueSchema: GenMessage<ConfigValue>;
/**
 * @generated from message xstockstrat.config.v1.GetConfigRequest
 */
export type GetConfigRequest = Message<"xstockstrat.config.v1.GetConfigRequest"> & {
    /**
     * @generated from field: string namespace = 1;
     */
    namespace: string;
    /**
     * @generated from field: xstockstrat.common.v1.Environment environment = 2;
     */
    environment: Environment;
    /**
     * @generated from field: xstockstrat.common.v1.TradingMode trading_mode = 3;
     */
    tradingMode: TradingMode;
};
/**
 * Describes the message xstockstrat.config.v1.GetConfigRequest.
 * Use `create(GetConfigRequestSchema)` to create a new message.
 */
export declare const GetConfigRequestSchema: GenMessage<GetConfigRequest>;
/**
 * @generated from message xstockstrat.config.v1.SetConfigRequest
 */
export type SetConfigRequest = Message<"xstockstrat.config.v1.SetConfigRequest"> & {
    /**
     * @generated from field: string namespace = 1;
     */
    namespace: string;
    /**
     * @generated from field: string key = 2;
     */
    key: string;
    /**
     * @generated from field: xstockstrat.config.v1.ConfigValue value = 3;
     */
    value?: ConfigValue | undefined;
    /**
     * @generated from field: string author = 4;
     */
    author: string;
    /**
     * @generated from field: string reason = 5;
     */
    reason: string;
    /**
     * @generated from field: xstockstrat.common.v1.Environment environment = 6;
     */
    environment: Environment;
    /**
     * @generated from field: xstockstrat.common.v1.TradingMode trading_mode = 7;
     */
    tradingMode: TradingMode;
};
/**
 * Describes the message xstockstrat.config.v1.SetConfigRequest.
 * Use `create(SetConfigRequestSchema)` to create a new message.
 */
export declare const SetConfigRequestSchema: GenMessage<SetConfigRequest>;
/**
 * @generated from message xstockstrat.config.v1.SetConfigResponse
 */
export type SetConfigResponse = Message<"xstockstrat.config.v1.SetConfigResponse"> & {
    /**
     * @generated from field: string version = 1;
     */
    version: string;
    /**
     * @generated from field: google.protobuf.Timestamp updated_at = 2;
     */
    updatedAt?: Timestamp | undefined;
};
/**
 * Describes the message xstockstrat.config.v1.SetConfigResponse.
 * Use `create(SetConfigResponseSchema)` to create a new message.
 */
export declare const SetConfigResponseSchema: GenMessage<SetConfigResponse>;
/**
 * @generated from message xstockstrat.config.v1.ListKeysRequest
 */
export type ListKeysRequest = Message<"xstockstrat.config.v1.ListKeysRequest"> & {
    /**
     * @generated from field: string namespace = 1;
     */
    namespace: string;
    /**
     * @generated from field: xstockstrat.common.v1.Environment environment = 2;
     */
    environment: Environment;
    /**
     * @generated from field: xstockstrat.common.v1.TradingMode trading_mode = 3;
     */
    tradingMode: TradingMode;
};
/**
 * Describes the message xstockstrat.config.v1.ListKeysRequest.
 * Use `create(ListKeysRequestSchema)` to create a new message.
 */
export declare const ListKeysRequestSchema: GenMessage<ListKeysRequest>;
/**
 * @generated from message xstockstrat.config.v1.ListKeysResponse
 */
export type ListKeysResponse = Message<"xstockstrat.config.v1.ListKeysResponse"> & {
    /**
     * @generated from field: repeated xstockstrat.config.v1.ConfigKeyMeta keys = 1;
     */
    keys: ConfigKeyMeta[];
};
/**
 * Describes the message xstockstrat.config.v1.ListKeysResponse.
 * Use `create(ListKeysResponseSchema)` to create a new message.
 */
export declare const ListKeysResponseSchema: GenMessage<ListKeysResponse>;
/**
 * @generated from message xstockstrat.config.v1.ConfigKeyMeta
 */
export type ConfigKeyMeta = Message<"xstockstrat.config.v1.ConfigKeyMeta"> & {
    /**
     * @generated from field: string key = 1;
     */
    key: string;
    /**
     * @generated from field: string description = 2;
     */
    description: string;
    /**
     * @generated from field: string default_value = 3;
     */
    defaultValue: string;
    /**
     * @generated from field: bool is_secret = 4;
     */
    isSecret: boolean;
    /**
     * @generated from field: string consuming_service = 5;
     */
    consumingService: string;
    /**
     * @generated from field: xstockstrat.common.v1.Environment environment = 6;
     */
    environment: Environment;
    /**
     * @generated from field: xstockstrat.common.v1.TradingMode trading_mode = 7;
     */
    tradingMode: TradingMode;
};
/**
 * Describes the message xstockstrat.config.v1.ConfigKeyMeta.
 * Use `create(ConfigKeyMetaSchema)` to create a new message.
 */
export declare const ConfigKeyMetaSchema: GenMessage<ConfigKeyMeta>;
/**
 * @generated from enum xstockstrat.config.v1.ConfigUpdateType
 */
export declare enum ConfigUpdateType {
    /**
     * @generated from enum value: CONFIG_UPDATE_TYPE_UNSPECIFIED = 0;
     */
    UNSPECIFIED = 0,
    /**
     * full config dump
     *
     * @generated from enum value: CONFIG_UPDATE_TYPE_SNAPSHOT = 1;
     */
    SNAPSHOT = 1,
    /**
     * only changed_keys changed
     *
     * @generated from enum value: CONFIG_UPDATE_TYPE_DELTA = 2;
     */
    DELTA = 2,
    /**
     * force full reload signal
     *
     * @generated from enum value: CONFIG_UPDATE_TYPE_RELOAD = 3;
     */
    RELOAD = 3
}
/**
 * Describes the enum xstockstrat.config.v1.ConfigUpdateType.
 */
export declare const ConfigUpdateTypeSchema: GenEnum<ConfigUpdateType>;
/**
 * ConfigService — live configuration via server-streaming WatchConfig.
 * All services call WatchConfig at startup and stream config updates.
 * Config values are scoped by environment (dev/production) and trading_mode (paper/live/all).
 *
 * @generated from service xstockstrat.config.v1.ConfigService
 */
export declare const ConfigService: GenService<{
    /**
     * Subscribe to config updates for a given namespace/service.
     * Server streams updates as config changes; initial snapshot is the first message.
     *
     * @generated from rpc xstockstrat.config.v1.ConfigService.WatchConfig
     */
    watchConfig: {
        methodKind: "server_streaming";
        input: typeof WatchConfigRequestSchema;
        output: typeof ConfigSnapshotSchema;
    };
    /**
     * One-shot config fetch (startup fast-path before stream establishes)
     *
     * @generated from rpc xstockstrat.config.v1.ConfigService.GetConfig
     */
    getConfig: {
        methodKind: "unary";
        input: typeof GetConfigRequestSchema;
        output: typeof ConfigSnapshotSchema;
    };
    /**
     * Admin: set or update a config value
     *
     * @generated from rpc xstockstrat.config.v1.ConfigService.SetConfig
     */
    setConfig: {
        methodKind: "unary";
        input: typeof SetConfigRequestSchema;
        output: typeof SetConfigResponseSchema;
    };
    /**
     * Admin: list all keys for a namespace
     *
     * @generated from rpc xstockstrat.config.v1.ConfigService.ListKeys
     */
    listKeys: {
        methodKind: "unary";
        input: typeof ListKeysRequestSchema;
        output: typeof ListKeysResponseSchema;
    };
}>;

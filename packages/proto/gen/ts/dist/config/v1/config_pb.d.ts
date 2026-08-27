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
     * production or staging; defaults to staging
     *
     * @generated from field: xstockstrat.common.v1.Environment environment = 4;
     */
    environment: Environment;
    /**
     * deprecated (feature 147): ignored by the server; paper/live derives from environment
     *
     * @generated from field: xstockstrat.common.v1.TradingMode trading_mode = 5 [deprecated = true];
     * @deprecated
     */
    tradingMode: TradingMode;
    /**
     * Optional per-user scope. When set, the server overlays this user's per-user values on top of
     * the global (user-unset) values for the resolved (namespace, environment). Empty = global.
     *
     * @generated from field: string user_id = 6;
     */
    userId: string;
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
     * deprecated (feature 147): always UNSPECIFIED
     *
     * @generated from field: xstockstrat.common.v1.TradingMode trading_mode = 8 [deprecated = true];
     * @deprecated
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
 * Validation constraints declared by the config service for a key.
 * When value_type == VALUE_TYPE_FLOAT_SCALAR, the scalar float_val (ConfigValue oneof) must satisfy
 * [min_value, max_value]; a write outside the bound is rejected INVALID_ARGUMENT at the config
 * service's SetConfig write path (feature 161).
 * (Deprecated) When value_type == VALUE_TYPE_FLOAT_MAP, every numeric leaf in the JSON value must
 * satisfy [min_value, max_value] — no longer emitted; see the ValueType note above.
 * Absent or VALUE_TYPE_UNSPECIFIED = no validation.
 *
 * @generated from message xstockstrat.config.v1.ValidationRule
 */
export type ValidationRule = Message<"xstockstrat.config.v1.ValidationRule"> & {
    /**
     * @generated from field: xstockstrat.config.v1.ValueType value_type = 1;
     */
    valueType: ValueType;
    /**
     * @generated from field: float min_value = 2;
     */
    minValue: number;
    /**
     * @generated from field: float max_value = 3;
     */
    maxValue: number;
};
/**
 * Describes the message xstockstrat.config.v1.ValidationRule.
 * Use `create(ValidationRuleSchema)` to create a new message.
 */
export declare const ValidationRuleSchema: GenMessage<ValidationRule>;
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
     * deprecated (feature 147): ignored
     *
     * @generated from field: xstockstrat.common.v1.TradingMode trading_mode = 3 [deprecated = true];
     * @deprecated
     */
    tradingMode: TradingMode;
    /**
     * optional per-user scope; empty = global
     *
     * @generated from field: string user_id = 4;
     */
    userId: string;
};
/**
 * Describes the message xstockstrat.config.v1.GetConfigRequest.
 * Use `create(GetConfigRequestSchema)` to create a new message.
 */
export declare const GetConfigRequestSchema: GenMessage<GetConfigRequest>;
/**
 * @generated from message xstockstrat.config.v1.GetSecretRequest
 */
export type GetSecretRequest = Message<"xstockstrat.config.v1.GetSecretRequest"> & {
    /**
     * @generated from field: string namespace = 1;
     */
    namespace: string;
    /**
     * @generated from field: string key = 2;
     */
    key: string;
    /**
     * production or staging
     *
     * @generated from field: xstockstrat.common.v1.Environment environment = 3;
     */
    environment: Environment;
};
/**
 * Describes the message xstockstrat.config.v1.GetSecretRequest.
 * Use `create(GetSecretRequestSchema)` to create a new message.
 */
export declare const GetSecretRequestSchema: GenMessage<GetSecretRequest>;
/**
 * @generated from message xstockstrat.config.v1.GetSecretResponse
 */
export type GetSecretResponse = Message<"xstockstrat.config.v1.GetSecretResponse"> & {
    /**
     * decrypted plaintext; empty when found=false
     *
     * @generated from field: string value = 1;
     */
    value: string;
    /**
     * false when the secret is unset (row absent or ciphertext NULL)
     *
     * @generated from field: bool found = 2;
     */
    found: boolean;
};
/**
 * Describes the message xstockstrat.config.v1.GetSecretResponse.
 * Use `create(GetSecretResponseSchema)` to create a new message.
 */
export declare const GetSecretResponseSchema: GenMessage<GetSecretResponse>;
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
     * deprecated (feature 147): ignored
     *
     * @generated from field: xstockstrat.common.v1.TradingMode trading_mode = 7 [deprecated = true];
     * @deprecated
     */
    tradingMode: TradingMode;
    /**
     * When true, allow this write to CREATE a not-yet-registered key at the exact
     * (namespace,key,environment,user_id) scope. Default false: a write to an
     * unregistered scope is refused with NOT_FOUND, so a typo cannot mint an orphan key.
     *
     * @generated from field: bool create_key = 8;
     */
    createKey: boolean;
    /**
     * Optional per-user scope. Empty = the global value; a non-empty user_id writes/updates that
     * user's per-user override. Secret keys (is_secret) are global-scope only (feature 147).
     *
     * @generated from field: string user_id = 9;
     */
    userId: string;
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
     * deprecated (feature 147): ignored
     *
     * @generated from field: xstockstrat.common.v1.TradingMode trading_mode = 3 [deprecated = true];
     * @deprecated
     */
    tradingMode: TradingMode;
    /**
     * optional per-user scope; empty = global
     *
     * @generated from field: string user_id = 4;
     */
    userId: string;
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
     * The declared/seed default for this key — metadata only (CONFIG-2: runtime resolution
     * never reads this column). Does NOT track live edits; use current_value for that.
     *
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
     * deprecated (feature 147): always UNSPECIFIED
     *
     * @generated from field: xstockstrat.common.v1.TradingMode trading_mode = 7 [deprecated = true];
     * @deprecated
     */
    tradingMode: TradingMode;
    /**
     * optional; absent = no validation
     *
     * @generated from field: xstockstrat.config.v1.ValidationRule validation = 8;
     */
    validation?: ValidationRule | undefined;
    /**
     * The row's live value_data — what SetConfig writes and WatchConfig/GetConfig serve.
     * This is what a config-ui "Value" column must display and prefill for editing.
     *
     * @generated from field: string current_value = 9;
     */
    currentValue: string;
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
 * @generated from enum xstockstrat.config.v1.ValueType
 */
export declare enum ValueType {
    /**
     * @generated from enum value: VALUE_TYPE_UNSPECIFIED = 0;
     */
    UNSPECIFIED = 0,
    /**
     * Deprecated (feature 161): the config service no longer emits or enforces FLOAT_MAP validation
     * — its sole key (analysis.signals.source_weights) was removed. The member is retained for enum
     * stability (removing it would be a breaking change and old wire values must still decode).
     *
     * @generated from enum value: VALUE_TYPE_FLOAT_MAP = 1 [deprecated = true];
     * @deprecated
     */
    FLOAT_MAP = 1,
    /**
     * Scalar float key: the value's scalar float_val must satisfy [min_value, max_value] (feature 161).
     *
     * @generated from enum value: VALUE_TYPE_FLOAT_SCALAR = 2;
     */
    FLOAT_SCALAR = 2
}
/**
 * Describes the enum xstockstrat.config.v1.ValueType.
 */
export declare const ValueTypeSchema: GenEnum<ValueType>;
/**
 * ConfigService — live configuration via server-streaming WatchConfig.
 * All services call WatchConfig at startup and stream config updates.
 * Config values are scoped by environment (production/staging) and global/per-user (user_id),
 * feature 147. paper/live is derived from environment; the trading_mode fields below are
 * deprecated and ignored by the server. Secrets are stored encrypted at rest, redacted at every
 * broadcast/read edge, and resolved only via GetSecret by allow-listed internal callers.
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
    /**
     * Resolve a secret's decrypted plaintext. Gated to allow-listed internal service callers
     * (x-internal-caller); the value is decrypted server-side and never appears on WatchConfig,
     * GetConfig, or ListKeys. Returns found=false for an absent/unset (NULL-ciphertext) secret;
     * a decrypt failure is an INTERNAL error, never a partial/empty value (feature 147).
     *
     * @generated from rpc xstockstrat.config.v1.ConfigService.GetSecret
     */
    getSecret: {
        methodKind: "unary";
        input: typeof GetSecretRequestSchema;
        output: typeof GetSecretResponseSchema;
    };
}>;

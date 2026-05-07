import type { GenFile, GenMessage, GenService } from "@bufbuild/protobuf/codegenv2";
import type { Timestamp } from "@bufbuild/protobuf/wkt";
import type { Message } from "@bufbuild/protobuf";
/**
 * Describes the file identity/v1/identity.proto.
 */
export declare const file_identity_v1_identity: GenFile;
/**
 * @generated from message xstockstrat.identity.v1.AuthenticateUserRequest
 */
export type AuthenticateUserRequest = Message<"xstockstrat.identity.v1.AuthenticateUserRequest"> & {
    /**
     * @generated from field: string email = 1;
     */
    email: string;
    /**
     * @generated from field: string password = 2;
     */
    password: string;
};
/**
 * Describes the message xstockstrat.identity.v1.AuthenticateUserRequest.
 * Use `create(AuthenticateUserRequestSchema)` to create a new message.
 */
export declare const AuthenticateUserRequestSchema: GenMessage<AuthenticateUserRequest>;
/**
 * @generated from message xstockstrat.identity.v1.AuthTokenResponse
 */
export type AuthTokenResponse = Message<"xstockstrat.identity.v1.AuthTokenResponse"> & {
    /**
     * @generated from field: string access_token = 1;
     */
    accessToken: string;
    /**
     * @generated from field: string refresh_token = 2;
     */
    refreshToken: string;
    /**
     * @generated from field: google.protobuf.Timestamp expires_at = 3;
     */
    expiresAt?: Timestamp | undefined;
    /**
     * @generated from field: xstockstrat.identity.v1.TokenClaims claims = 4;
     */
    claims?: TokenClaims | undefined;
};
/**
 * Describes the message xstockstrat.identity.v1.AuthTokenResponse.
 * Use `create(AuthTokenResponseSchema)` to create a new message.
 */
export declare const AuthTokenResponseSchema: GenMessage<AuthTokenResponse>;
/**
 * @generated from message xstockstrat.identity.v1.TokenClaims
 */
export type TokenClaims = Message<"xstockstrat.identity.v1.TokenClaims"> & {
    /**
     * @generated from field: string user_id = 1;
     */
    userId: string;
    /**
     * @generated from field: string email = 2;
     */
    email: string;
    /**
     * @generated from field: repeated string roles = 3;
     */
    roles: string[];
    /**
     * @generated from field: google.protobuf.Timestamp issued_at = 4;
     */
    issuedAt?: Timestamp | undefined;
    /**
     * @generated from field: google.protobuf.Timestamp expires_at = 5;
     */
    expiresAt?: Timestamp | undefined;
};
/**
 * Describes the message xstockstrat.identity.v1.TokenClaims.
 * Use `create(TokenClaimsSchema)` to create a new message.
 */
export declare const TokenClaimsSchema: GenMessage<TokenClaims>;
/**
 * @generated from message xstockstrat.identity.v1.ValidateTokenRequest
 */
export type ValidateTokenRequest = Message<"xstockstrat.identity.v1.ValidateTokenRequest"> & {
    /**
     * @generated from field: string token = 1;
     */
    token: string;
};
/**
 * Describes the message xstockstrat.identity.v1.ValidateTokenRequest.
 * Use `create(ValidateTokenRequestSchema)` to create a new message.
 */
export declare const ValidateTokenRequestSchema: GenMessage<ValidateTokenRequest>;
/**
 * @generated from message xstockstrat.identity.v1.RefreshTokenRequest
 */
export type RefreshTokenRequest = Message<"xstockstrat.identity.v1.RefreshTokenRequest"> & {
    /**
     * @generated from field: string refresh_token = 1;
     */
    refreshToken: string;
};
/**
 * Describes the message xstockstrat.identity.v1.RefreshTokenRequest.
 * Use `create(RefreshTokenRequestSchema)` to create a new message.
 */
export declare const RefreshTokenRequestSchema: GenMessage<RefreshTokenRequest>;
/**
 * @generated from message xstockstrat.identity.v1.RevokeTokenRequest
 */
export type RevokeTokenRequest = Message<"xstockstrat.identity.v1.RevokeTokenRequest"> & {
    /**
     * @generated from field: string token = 1;
     */
    token: string;
};
/**
 * Describes the message xstockstrat.identity.v1.RevokeTokenRequest.
 * Use `create(RevokeTokenRequestSchema)` to create a new message.
 */
export declare const RevokeTokenRequestSchema: GenMessage<RevokeTokenRequest>;
/**
 * @generated from message xstockstrat.identity.v1.RevokeTokenResponse
 */
export type RevokeTokenResponse = Message<"xstockstrat.identity.v1.RevokeTokenResponse"> & {
    /**
     * @generated from field: bool success = 1;
     */
    success: boolean;
};
/**
 * Describes the message xstockstrat.identity.v1.RevokeTokenResponse.
 * Use `create(RevokeTokenResponseSchema)` to create a new message.
 */
export declare const RevokeTokenResponseSchema: GenMessage<RevokeTokenResponse>;
/**
 * @generated from message xstockstrat.identity.v1.ApiKey
 */
export type ApiKey = Message<"xstockstrat.identity.v1.ApiKey"> & {
    /**
     * @generated from field: string key_id = 1;
     */
    keyId: string;
    /**
     * first 8 chars only (rest is hashed)
     *
     * @generated from field: string key_prefix = 2;
     */
    keyPrefix: string;
    /**
     * @generated from field: string user_id = 3;
     */
    userId: string;
    /**
     * @generated from field: string name = 4;
     */
    name: string;
    /**
     * @generated from field: repeated string scopes = 5;
     */
    scopes: string[];
    /**
     * @generated from field: google.protobuf.Timestamp created_at = 6;
     */
    createdAt?: Timestamp | undefined;
    /**
     * @generated from field: google.protobuf.Timestamp expires_at = 7;
     */
    expiresAt?: Timestamp | undefined;
};
/**
 * Describes the message xstockstrat.identity.v1.ApiKey.
 * Use `create(ApiKeySchema)` to create a new message.
 */
export declare const ApiKeySchema: GenMessage<ApiKey>;
/**
 * @generated from message xstockstrat.identity.v1.CreateApiKeyRequest
 */
export type CreateApiKeyRequest = Message<"xstockstrat.identity.v1.CreateApiKeyRequest"> & {
    /**
     * @generated from field: string user_id = 1;
     */
    userId: string;
    /**
     * @generated from field: string name = 2;
     */
    name: string;
    /**
     * @generated from field: repeated string scopes = 3;
     */
    scopes: string[];
    /**
     * @generated from field: google.protobuf.Timestamp expires_at = 4;
     */
    expiresAt?: Timestamp | undefined;
};
/**
 * Describes the message xstockstrat.identity.v1.CreateApiKeyRequest.
 * Use `create(CreateApiKeyRequestSchema)` to create a new message.
 */
export declare const CreateApiKeyRequestSchema: GenMessage<CreateApiKeyRequest>;
/**
 * @generated from message xstockstrat.identity.v1.ValidateApiKeyRequest
 */
export type ValidateApiKeyRequest = Message<"xstockstrat.identity.v1.ValidateApiKeyRequest"> & {
    /**
     * @generated from field: string api_key = 1;
     */
    apiKey: string;
};
/**
 * Describes the message xstockstrat.identity.v1.ValidateApiKeyRequest.
 * Use `create(ValidateApiKeyRequestSchema)` to create a new message.
 */
export declare const ValidateApiKeyRequestSchema: GenMessage<ValidateApiKeyRequest>;
/**
 * @generated from message xstockstrat.identity.v1.ListApiKeysRequest
 */
export type ListApiKeysRequest = Message<"xstockstrat.identity.v1.ListApiKeysRequest"> & {
    /**
     * @generated from field: string user_id = 1;
     */
    userId: string;
};
/**
 * Describes the message xstockstrat.identity.v1.ListApiKeysRequest.
 * Use `create(ListApiKeysRequestSchema)` to create a new message.
 */
export declare const ListApiKeysRequestSchema: GenMessage<ListApiKeysRequest>;
/**
 * @generated from message xstockstrat.identity.v1.ListApiKeysResponse
 */
export type ListApiKeysResponse = Message<"xstockstrat.identity.v1.ListApiKeysResponse"> & {
    /**
     * @generated from field: repeated xstockstrat.identity.v1.ApiKey keys = 1;
     */
    keys: ApiKey[];
};
/**
 * Describes the message xstockstrat.identity.v1.ListApiKeysResponse.
 * Use `create(ListApiKeysResponseSchema)` to create a new message.
 */
export declare const ListApiKeysResponseSchema: GenMessage<ListApiKeysResponse>;
/**
 * @generated from message xstockstrat.identity.v1.RevokeApiKeyRequest
 */
export type RevokeApiKeyRequest = Message<"xstockstrat.identity.v1.RevokeApiKeyRequest"> & {
    /**
     * @generated from field: string key_id = 1;
     */
    keyId: string;
    /**
     * @generated from field: string user_id = 2;
     */
    userId: string;
};
/**
 * Describes the message xstockstrat.identity.v1.RevokeApiKeyRequest.
 * Use `create(RevokeApiKeyRequestSchema)` to create a new message.
 */
export declare const RevokeApiKeyRequestSchema: GenMessage<RevokeApiKeyRequest>;
/**
 * @generated from message xstockstrat.identity.v1.RevokeApiKeyResponse
 */
export type RevokeApiKeyResponse = Message<"xstockstrat.identity.v1.RevokeApiKeyResponse"> & {
    /**
     * @generated from field: bool success = 1;
     */
    success: boolean;
};
/**
 * Describes the message xstockstrat.identity.v1.RevokeApiKeyResponse.
 * Use `create(RevokeApiKeyResponseSchema)` to create a new message.
 */
export declare const RevokeApiKeyResponseSchema: GenMessage<RevokeApiKeyResponse>;
/**
 * @generated from service xstockstrat.identity.v1.IdentityService
 */
export declare const IdentityService: GenService<{
    /**
     * @generated from rpc xstockstrat.identity.v1.IdentityService.AuthenticateUser
     */
    authenticateUser: {
        methodKind: "unary";
        input: typeof AuthenticateUserRequestSchema;
        output: typeof AuthTokenResponseSchema;
    };
    /**
     * @generated from rpc xstockstrat.identity.v1.IdentityService.ValidateToken
     */
    validateToken: {
        methodKind: "unary";
        input: typeof ValidateTokenRequestSchema;
        output: typeof TokenClaimsSchema;
    };
    /**
     * @generated from rpc xstockstrat.identity.v1.IdentityService.RefreshToken
     */
    refreshToken: {
        methodKind: "unary";
        input: typeof RefreshTokenRequestSchema;
        output: typeof AuthTokenResponseSchema;
    };
    /**
     * @generated from rpc xstockstrat.identity.v1.IdentityService.RevokeToken
     */
    revokeToken: {
        methodKind: "unary";
        input: typeof RevokeTokenRequestSchema;
        output: typeof RevokeTokenResponseSchema;
    };
    /**
     * @generated from rpc xstockstrat.identity.v1.IdentityService.CreateApiKey
     */
    createApiKey: {
        methodKind: "unary";
        input: typeof CreateApiKeyRequestSchema;
        output: typeof ApiKeySchema;
    };
    /**
     * @generated from rpc xstockstrat.identity.v1.IdentityService.ValidateApiKey
     */
    validateApiKey: {
        methodKind: "unary";
        input: typeof ValidateApiKeyRequestSchema;
        output: typeof TokenClaimsSchema;
    };
    /**
     * @generated from rpc xstockstrat.identity.v1.IdentityService.ListApiKeys
     */
    listApiKeys: {
        methodKind: "unary";
        input: typeof ListApiKeysRequestSchema;
        output: typeof ListApiKeysResponseSchema;
    };
    /**
     * @generated from rpc xstockstrat.identity.v1.IdentityService.RevokeApiKey
     */
    revokeApiKey: {
        methodKind: "unary";
        input: typeof RevokeApiKeyRequestSchema;
        output: typeof RevokeApiKeyResponseSchema;
    };
}>;

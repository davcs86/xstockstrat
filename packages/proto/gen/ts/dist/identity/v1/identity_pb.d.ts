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
    /**
     * audience / resource URI (OAuth audience-bound JWT, RFC 8707)
     *
     * @generated from field: string aud = 6;
     */
    aud: string;
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
 * ── OAuth 2.1 messages (feature 049 Part B) ──────────────────────────────────
 *
 * @generated from message xstockstrat.identity.v1.OAuthClient
 */
export type OAuthClient = Message<"xstockstrat.identity.v1.OAuthClient"> & {
    /**
     * @generated from field: string client_id = 1;
     */
    clientId: string;
    /**
     * @generated from field: repeated string redirect_uris = 2;
     */
    redirectUris: string[];
    /**
     * @generated from field: string client_name = 3;
     */
    clientName: string;
    /**
     * @generated from field: google.protobuf.Timestamp created_at = 4;
     */
    createdAt?: Timestamp | undefined;
};
/**
 * Describes the message xstockstrat.identity.v1.OAuthClient.
 * Use `create(OAuthClientSchema)` to create a new message.
 */
export declare const OAuthClientSchema: GenMessage<OAuthClient>;
/**
 * @generated from message xstockstrat.identity.v1.RegisterOAuthClientRequest
 */
export type RegisterOAuthClientRequest = Message<"xstockstrat.identity.v1.RegisterOAuthClientRequest"> & {
    /**
     * @generated from field: repeated string redirect_uris = 1;
     */
    redirectUris: string[];
    /**
     * @generated from field: string client_name = 2;
     */
    clientName: string;
};
/**
 * Describes the message xstockstrat.identity.v1.RegisterOAuthClientRequest.
 * Use `create(RegisterOAuthClientRequestSchema)` to create a new message.
 */
export declare const RegisterOAuthClientRequestSchema: GenMessage<RegisterOAuthClientRequest>;
/**
 * @generated from message xstockstrat.identity.v1.GetOAuthClientRequest
 */
export type GetOAuthClientRequest = Message<"xstockstrat.identity.v1.GetOAuthClientRequest"> & {
    /**
     * @generated from field: string client_id = 1;
     */
    clientId: string;
};
/**
 * Describes the message xstockstrat.identity.v1.GetOAuthClientRequest.
 * Use `create(GetOAuthClientRequestSchema)` to create a new message.
 */
export declare const GetOAuthClientRequestSchema: GenMessage<GetOAuthClientRequest>;
/**
 * @generated from message xstockstrat.identity.v1.IssueAuthCodeRequest
 */
export type IssueAuthCodeRequest = Message<"xstockstrat.identity.v1.IssueAuthCodeRequest"> & {
    /**
     * @generated from field: string user_id = 1;
     */
    userId: string;
    /**
     * @generated from field: string client_id = 2;
     */
    clientId: string;
    /**
     * @generated from field: string redirect_uri = 3;
     */
    redirectUri: string;
    /**
     * @generated from field: string code_challenge = 4;
     */
    codeChallenge: string;
    /**
     * @generated from field: string resource = 5;
     */
    resource: string;
};
/**
 * Describes the message xstockstrat.identity.v1.IssueAuthCodeRequest.
 * Use `create(IssueAuthCodeRequestSchema)` to create a new message.
 */
export declare const IssueAuthCodeRequestSchema: GenMessage<IssueAuthCodeRequest>;
/**
 * @generated from message xstockstrat.identity.v1.IssueAuthCodeResponse
 */
export type IssueAuthCodeResponse = Message<"xstockstrat.identity.v1.IssueAuthCodeResponse"> & {
    /**
     * @generated from field: string code = 1;
     */
    code: string;
};
/**
 * Describes the message xstockstrat.identity.v1.IssueAuthCodeResponse.
 * Use `create(IssueAuthCodeResponseSchema)` to create a new message.
 */
export declare const IssueAuthCodeResponseSchema: GenMessage<IssueAuthCodeResponse>;
/**
 * @generated from message xstockstrat.identity.v1.ExchangeAuthCodeRequest
 */
export type ExchangeAuthCodeRequest = Message<"xstockstrat.identity.v1.ExchangeAuthCodeRequest"> & {
    /**
     * @generated from field: string code = 1;
     */
    code: string;
    /**
     * @generated from field: string code_verifier = 2;
     */
    codeVerifier: string;
    /**
     * @generated from field: string redirect_uri = 3;
     */
    redirectUri: string;
    /**
     * @generated from field: string client_id = 4;
     */
    clientId: string;
    /**
     * @generated from field: string resource = 5;
     */
    resource: string;
};
/**
 * Describes the message xstockstrat.identity.v1.ExchangeAuthCodeRequest.
 * Use `create(ExchangeAuthCodeRequestSchema)` to create a new message.
 */
export declare const ExchangeAuthCodeRequestSchema: GenMessage<ExchangeAuthCodeRequest>;
/**
 * @generated from message xstockstrat.identity.v1.OAuthTokenResponse
 */
export type OAuthTokenResponse = Message<"xstockstrat.identity.v1.OAuthTokenResponse"> & {
    /**
     * @generated from field: string access_token = 1;
     */
    accessToken: string;
    /**
     * @generated from field: string token_type = 2;
     */
    tokenType: string;
    /**
     * @generated from field: int64 expires_in = 3;
     */
    expiresIn: bigint;
    /**
     * @generated from field: string refresh_token = 4;
     */
    refreshToken: string;
};
/**
 * Describes the message xstockstrat.identity.v1.OAuthTokenResponse.
 * Use `create(OAuthTokenResponseSchema)` to create a new message.
 */
export declare const OAuthTokenResponseSchema: GenMessage<OAuthTokenResponse>;
/**
 * @generated from message xstockstrat.identity.v1.RefreshOAuthTokenRequest
 */
export type RefreshOAuthTokenRequest = Message<"xstockstrat.identity.v1.RefreshOAuthTokenRequest"> & {
    /**
     * @generated from field: string refresh_token = 1;
     */
    refreshToken: string;
    /**
     * @generated from field: string resource = 2;
     */
    resource: string;
};
/**
 * Describes the message xstockstrat.identity.v1.RefreshOAuthTokenRequest.
 * Use `create(RefreshOAuthTokenRequestSchema)` to create a new message.
 */
export declare const RefreshOAuthTokenRequestSchema: GenMessage<RefreshOAuthTokenRequest>;
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
    /**
     * OAuth 2.1 authorization-server backend (feature 049 Part B). The MCP agent is the
     * OAuth AS/RS HTTP facade; identity is the durable client/code store + token mint.
     *
     * @generated from rpc xstockstrat.identity.v1.IdentityService.RegisterOAuthClient
     */
    registerOAuthClient: {
        methodKind: "unary";
        input: typeof RegisterOAuthClientRequestSchema;
        output: typeof OAuthClientSchema;
    };
    /**
     * @generated from rpc xstockstrat.identity.v1.IdentityService.GetOAuthClient
     */
    getOAuthClient: {
        methodKind: "unary";
        input: typeof GetOAuthClientRequestSchema;
        output: typeof OAuthClientSchema;
    };
    /**
     * @generated from rpc xstockstrat.identity.v1.IdentityService.IssueAuthCode
     */
    issueAuthCode: {
        methodKind: "unary";
        input: typeof IssueAuthCodeRequestSchema;
        output: typeof IssueAuthCodeResponseSchema;
    };
    /**
     * @generated from rpc xstockstrat.identity.v1.IdentityService.ExchangeAuthCode
     */
    exchangeAuthCode: {
        methodKind: "unary";
        input: typeof ExchangeAuthCodeRequestSchema;
        output: typeof OAuthTokenResponseSchema;
    };
    /**
     * @generated from rpc xstockstrat.identity.v1.IdentityService.RefreshOAuthToken
     */
    refreshOAuthToken: {
        methodKind: "unary";
        input: typeof RefreshOAuthTokenRequestSchema;
        output: typeof OAuthTokenResponseSchema;
    };
}>;

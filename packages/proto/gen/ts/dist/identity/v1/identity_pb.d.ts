import type { GenEnum, GenFile, GenMessage, GenService } from "@bufbuild/protobuf/codegenv2";
import type { Timestamp } from "@bufbuild/protobuf/wkt";
import type { JsonObject, Message } from "@bufbuild/protobuf";
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
 * ── Authorized-apps management (feature 051) ─────────────────────────────────
 *
 * @generated from message xstockstrat.identity.v1.AuthorizedApp
 */
export type AuthorizedApp = Message<"xstockstrat.identity.v1.AuthorizedApp"> & {
    /**
     * @generated from field: string client_id = 1;
     */
    clientId: string;
    /**
     * @generated from field: string client_name = 2;
     */
    clientName: string;
    /**
     * @generated from field: google.protobuf.Timestamp authorized_at = 3;
     */
    authorizedAt?: Timestamp | undefined;
    /**
     * Best-effort "last refreshed" time (bumped on refresh-token rotation), NOT per-request
     * access. May be unset. The UI labels this "Last refreshed", not "Last used".
     *
     * @generated from field: google.protobuf.Timestamp last_used_at = 4;
     */
    lastUsedAt?: Timestamp | undefined;
    /**
     * @generated from field: repeated string redirect_uris = 5;
     */
    redirectUris: string[];
};
/**
 * Describes the message xstockstrat.identity.v1.AuthorizedApp.
 * Use `create(AuthorizedAppSchema)` to create a new message.
 */
export declare const AuthorizedAppSchema: GenMessage<AuthorizedApp>;
/**
 * @generated from message xstockstrat.identity.v1.ListAuthorizedAppsRequest
 */
export type ListAuthorizedAppsRequest = Message<"xstockstrat.identity.v1.ListAuthorizedAppsRequest"> & {
    /**
     * @generated from field: string user_id = 1;
     */
    userId: string;
};
/**
 * Describes the message xstockstrat.identity.v1.ListAuthorizedAppsRequest.
 * Use `create(ListAuthorizedAppsRequestSchema)` to create a new message.
 */
export declare const ListAuthorizedAppsRequestSchema: GenMessage<ListAuthorizedAppsRequest>;
/**
 * @generated from message xstockstrat.identity.v1.ListAuthorizedAppsResponse
 */
export type ListAuthorizedAppsResponse = Message<"xstockstrat.identity.v1.ListAuthorizedAppsResponse"> & {
    /**
     * @generated from field: repeated xstockstrat.identity.v1.AuthorizedApp apps = 1;
     */
    apps: AuthorizedApp[];
};
/**
 * Describes the message xstockstrat.identity.v1.ListAuthorizedAppsResponse.
 * Use `create(ListAuthorizedAppsResponseSchema)` to create a new message.
 */
export declare const ListAuthorizedAppsResponseSchema: GenMessage<ListAuthorizedAppsResponse>;
/**
 * @generated from message xstockstrat.identity.v1.RevokeAuthorizedAppRequest
 */
export type RevokeAuthorizedAppRequest = Message<"xstockstrat.identity.v1.RevokeAuthorizedAppRequest"> & {
    /**
     * @generated from field: string user_id = 1;
     */
    userId: string;
    /**
     * @generated from field: string client_id = 2;
     */
    clientId: string;
};
/**
 * Describes the message xstockstrat.identity.v1.RevokeAuthorizedAppRequest.
 * Use `create(RevokeAuthorizedAppRequestSchema)` to create a new message.
 */
export declare const RevokeAuthorizedAppRequestSchema: GenMessage<RevokeAuthorizedAppRequest>;
/**
 * @generated from message xstockstrat.identity.v1.RevokeAuthorizedAppResponse
 */
export type RevokeAuthorizedAppResponse = Message<"xstockstrat.identity.v1.RevokeAuthorizedAppResponse"> & {
    /**
     * @generated from field: bool success = 1;
     */
    success: boolean;
};
/**
 * Describes the message xstockstrat.identity.v1.RevokeAuthorizedAppResponse.
 * Use `create(RevokeAuthorizedAppResponseSchema)` to create a new message.
 */
export declare const RevokeAuthorizedAppResponseSchema: GenMessage<RevokeAuthorizedAppResponse>;
/**
 * ── User profile metadata (feature 130) ──────────────────────────────────
 *
 * @generated from message xstockstrat.identity.v1.UserMetadata
 */
export type UserMetadata = Message<"xstockstrat.identity.v1.UserMetadata"> & {
    /**
     * @generated from field: string user_id = 1;
     */
    userId: string;
    /**
     * @generated from field: string email = 2;
     */
    email: string;
    /**
     * @generated from field: optional string phone = 3;
     */
    phone?: string | undefined;
    /**
     * @generated from field: optional string display_name = 4;
     */
    displayName?: string | undefined;
    /**
     * @generated from field: google.protobuf.Struct metadata = 5;
     */
    metadata?: JsonObject | undefined;
    /**
     * @generated from field: google.protobuf.Timestamp metadata_updated_at = 6;
     */
    metadataUpdatedAt?: Timestamp | undefined;
};
/**
 * Describes the message xstockstrat.identity.v1.UserMetadata.
 * Use `create(UserMetadataSchema)` to create a new message.
 */
export declare const UserMetadataSchema: GenMessage<UserMetadata>;
/**
 * @generated from message xstockstrat.identity.v1.GetUserMetadataRequest
 */
export type GetUserMetadataRequest = Message<"xstockstrat.identity.v1.GetUserMetadataRequest"> & {};
/**
 * Describes the message xstockstrat.identity.v1.GetUserMetadataRequest.
 * Use `create(GetUserMetadataRequestSchema)` to create a new message.
 */
export declare const GetUserMetadataRequestSchema: GenMessage<GetUserMetadataRequest>;
/**
 * @generated from message xstockstrat.identity.v1.GetUserMetadataResponse
 */
export type GetUserMetadataResponse = Message<"xstockstrat.identity.v1.GetUserMetadataResponse"> & {
    /**
     * @generated from field: xstockstrat.identity.v1.UserMetadata user_metadata = 1;
     */
    userMetadata?: UserMetadata | undefined;
};
/**
 * Describes the message xstockstrat.identity.v1.GetUserMetadataResponse.
 * Use `create(GetUserMetadataResponseSchema)` to create a new message.
 */
export declare const GetUserMetadataResponseSchema: GenMessage<GetUserMetadataResponse>;
/**
 * @generated from message xstockstrat.identity.v1.UpdateUserMetadataRequest
 */
export type UpdateUserMetadataRequest = Message<"xstockstrat.identity.v1.UpdateUserMetadataRequest"> & {
    /**
     * @generated from field: optional string phone = 1;
     */
    phone?: string | undefined;
    /**
     * @generated from field: optional string display_name = 2;
     */
    displayName?: string | undefined;
    /**
     * @generated from field: optional google.protobuf.Struct metadata = 3;
     */
    metadata?: JsonObject | undefined;
};
/**
 * Describes the message xstockstrat.identity.v1.UpdateUserMetadataRequest.
 * Use `create(UpdateUserMetadataRequestSchema)` to create a new message.
 */
export declare const UpdateUserMetadataRequestSchema: GenMessage<UpdateUserMetadataRequest>;
/**
 * @generated from message xstockstrat.identity.v1.UpdateUserMetadataResponse
 */
export type UpdateUserMetadataResponse = Message<"xstockstrat.identity.v1.UpdateUserMetadataResponse"> & {
    /**
     * @generated from field: xstockstrat.identity.v1.UserMetadata user_metadata = 1;
     */
    userMetadata?: UserMetadata | undefined;
};
/**
 * Describes the message xstockstrat.identity.v1.UpdateUserMetadataResponse.
 * Use `create(UpdateUserMetadataResponseSchema)` to create a new message.
 */
export declare const UpdateUserMetadataResponseSchema: GenMessage<UpdateUserMetadataResponse>;
/**
 * Password-free admin view of a user (no password / password_hash — FR-10/AC-10).
 *
 * @generated from message xstockstrat.identity.v1.User
 */
export type User = Message<"xstockstrat.identity.v1.User"> & {
    /**
     * @generated from field: string user_id = 1;
     */
    userId: string;
    /**
     * @generated from field: string email = 2;
     */
    email: string;
    /**
     * @generated from field: repeated xstockstrat.identity.v1.Role roles = 3;
     */
    roles: Role[];
    /**
     * @generated from field: bool is_active = 4;
     */
    isActive: boolean;
    /**
     * @generated from field: google.protobuf.Timestamp created_at = 5;
     */
    createdAt?: Timestamp | undefined;
};
/**
 * Describes the message xstockstrat.identity.v1.User.
 * Use `create(UserSchema)` to create a new message.
 */
export declare const UserSchema: GenMessage<User>;
/**
 * @generated from message xstockstrat.identity.v1.CreateUserRequest
 */
export type CreateUserRequest = Message<"xstockstrat.identity.v1.CreateUserRequest"> & {
    /**
     * @generated from field: string email = 1;
     */
    email: string;
    /**
     * write-only; never echoed back
     *
     * @generated from field: string password = 2;
     */
    password: string;
    /**
     * @generated from field: repeated xstockstrat.identity.v1.Role roles = 3;
     */
    roles: Role[];
};
/**
 * Describes the message xstockstrat.identity.v1.CreateUserRequest.
 * Use `create(CreateUserRequestSchema)` to create a new message.
 */
export declare const CreateUserRequestSchema: GenMessage<CreateUserRequest>;
/**
 * @generated from message xstockstrat.identity.v1.CreateUserResponse
 */
export type CreateUserResponse = Message<"xstockstrat.identity.v1.CreateUserResponse"> & {
    /**
     * @generated from field: xstockstrat.identity.v1.User user = 1;
     */
    user?: User | undefined;
};
/**
 * Describes the message xstockstrat.identity.v1.CreateUserResponse.
 * Use `create(CreateUserResponseSchema)` to create a new message.
 */
export declare const CreateUserResponseSchema: GenMessage<CreateUserResponse>;
/**
 * @generated from message xstockstrat.identity.v1.ListUsersRequest
 */
export type ListUsersRequest = Message<"xstockstrat.identity.v1.ListUsersRequest"> & {};
/**
 * Describes the message xstockstrat.identity.v1.ListUsersRequest.
 * Use `create(ListUsersRequestSchema)` to create a new message.
 */
export declare const ListUsersRequestSchema: GenMessage<ListUsersRequest>;
/**
 * @generated from message xstockstrat.identity.v1.ListUsersResponse
 */
export type ListUsersResponse = Message<"xstockstrat.identity.v1.ListUsersResponse"> & {
    /**
     * @generated from field: repeated xstockstrat.identity.v1.User users = 1;
     */
    users: User[];
};
/**
 * Describes the message xstockstrat.identity.v1.ListUsersResponse.
 * Use `create(ListUsersResponseSchema)` to create a new message.
 */
export declare const ListUsersResponseSchema: GenMessage<ListUsersResponse>;
/**
 * @generated from message xstockstrat.identity.v1.GetUserRequest
 */
export type GetUserRequest = Message<"xstockstrat.identity.v1.GetUserRequest"> & {
    /**
     * @generated from field: string user_id = 1;
     */
    userId: string;
};
/**
 * Describes the message xstockstrat.identity.v1.GetUserRequest.
 * Use `create(GetUserRequestSchema)` to create a new message.
 */
export declare const GetUserRequestSchema: GenMessage<GetUserRequest>;
/**
 * @generated from message xstockstrat.identity.v1.GetUserResponse
 */
export type GetUserResponse = Message<"xstockstrat.identity.v1.GetUserResponse"> & {
    /**
     * @generated from field: xstockstrat.identity.v1.User user = 1;
     */
    user?: User | undefined;
};
/**
 * Describes the message xstockstrat.identity.v1.GetUserResponse.
 * Use `create(GetUserResponseSchema)` to create a new message.
 */
export declare const GetUserResponseSchema: GenMessage<GetUserResponse>;
/**
 * @generated from message xstockstrat.identity.v1.UpdatePasswordRequest
 */
export type UpdatePasswordRequest = Message<"xstockstrat.identity.v1.UpdatePasswordRequest"> & {
    /**
     * @generated from field: string user_id = 1;
     */
    userId: string;
    /**
     * write-only; never echoed back
     *
     * @generated from field: string new_password = 2;
     */
    newPassword: string;
};
/**
 * Describes the message xstockstrat.identity.v1.UpdatePasswordRequest.
 * Use `create(UpdatePasswordRequestSchema)` to create a new message.
 */
export declare const UpdatePasswordRequestSchema: GenMessage<UpdatePasswordRequest>;
/**
 * @generated from message xstockstrat.identity.v1.UpdatePasswordResponse
 */
export type UpdatePasswordResponse = Message<"xstockstrat.identity.v1.UpdatePasswordResponse"> & {};
/**
 * Describes the message xstockstrat.identity.v1.UpdatePasswordResponse.
 * Use `create(UpdatePasswordResponseSchema)` to create a new message.
 */
export declare const UpdatePasswordResponseSchema: GenMessage<UpdatePasswordResponse>;
/**
 * @generated from message xstockstrat.identity.v1.SetUserRolesRequest
 */
export type SetUserRolesRequest = Message<"xstockstrat.identity.v1.SetUserRolesRequest"> & {
    /**
     * @generated from field: string user_id = 1;
     */
    userId: string;
    /**
     * @generated from field: repeated xstockstrat.identity.v1.Role roles = 2;
     */
    roles: Role[];
};
/**
 * Describes the message xstockstrat.identity.v1.SetUserRolesRequest.
 * Use `create(SetUserRolesRequestSchema)` to create a new message.
 */
export declare const SetUserRolesRequestSchema: GenMessage<SetUserRolesRequest>;
/**
 * @generated from message xstockstrat.identity.v1.SetUserRolesResponse
 */
export type SetUserRolesResponse = Message<"xstockstrat.identity.v1.SetUserRolesResponse"> & {
    /**
     * @generated from field: xstockstrat.identity.v1.User user = 1;
     */
    user?: User | undefined;
};
/**
 * Describes the message xstockstrat.identity.v1.SetUserRolesResponse.
 * Use `create(SetUserRolesResponseSchema)` to create a new message.
 */
export declare const SetUserRolesResponseSchema: GenMessage<SetUserRolesResponse>;
/**
 * @generated from message xstockstrat.identity.v1.SetUserActiveRequest
 */
export type SetUserActiveRequest = Message<"xstockstrat.identity.v1.SetUserActiveRequest"> & {
    /**
     * @generated from field: string user_id = 1;
     */
    userId: string;
    /**
     * @generated from field: bool active = 2;
     */
    active: boolean;
};
/**
 * Describes the message xstockstrat.identity.v1.SetUserActiveRequest.
 * Use `create(SetUserActiveRequestSchema)` to create a new message.
 */
export declare const SetUserActiveRequestSchema: GenMessage<SetUserActiveRequest>;
/**
 * @generated from message xstockstrat.identity.v1.SetUserActiveResponse
 */
export type SetUserActiveResponse = Message<"xstockstrat.identity.v1.SetUserActiveResponse"> & {
    /**
     * @generated from field: xstockstrat.identity.v1.User user = 1;
     */
    user?: User | undefined;
};
/**
 * Describes the message xstockstrat.identity.v1.SetUserActiveResponse.
 * Use `create(SetUserActiveResponseSchema)` to create a new message.
 */
export declare const SetUserActiveResponseSchema: GenMessage<SetUserActiveResponse>;
/**
 * ── User management (admin-gated, feature 043) ───────────────────────────────
 * Closed role set (C-04). Mirrors the viewer/trader/admin roles the platform already uses;
 * TokenClaims.roles stays a free-string list (JWT claim shape, unchanged).
 *
 * @generated from enum xstockstrat.identity.v1.Role
 */
export declare enum Role {
    /**
     * @generated from enum value: ROLE_UNSPECIFIED = 0;
     */
    UNSPECIFIED = 0,
    /**
     * @generated from enum value: ROLE_ADMIN = 1;
     */
    ADMIN = 1,
    /**
     * @generated from enum value: ROLE_TRADER = 2;
     */
    TRADER = 2,
    /**
     * @generated from enum value: ROLE_VIEWER = 3;
     */
    VIEWER = 3
}
/**
 * Describes the enum xstockstrat.identity.v1.Role.
 */
export declare const RoleSchema: GenEnum<Role>;
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
    /**
     * Per-user authorized-app management (feature 051) — list/revoke OAuth clients the
     * calling user has granted access to the MCP agent. Additive over 049's OAuth backend.
     *
     * @generated from rpc xstockstrat.identity.v1.IdentityService.ListAuthorizedApps
     */
    listAuthorizedApps: {
        methodKind: "unary";
        input: typeof ListAuthorizedAppsRequestSchema;
        output: typeof ListAuthorizedAppsResponseSchema;
    };
    /**
     * @generated from rpc xstockstrat.identity.v1.IdentityService.RevokeAuthorizedApp
     */
    revokeAuthorizedApp: {
        methodKind: "unary";
        input: typeof RevokeAuthorizedAppRequestSchema;
        output: typeof RevokeAuthorizedAppResponseSchema;
    };
    /**
     * User profile metadata self-management (feature 130)
     *
     * @generated from rpc xstockstrat.identity.v1.IdentityService.GetUserMetadata
     */
    getUserMetadata: {
        methodKind: "unary";
        input: typeof GetUserMetadataRequestSchema;
        output: typeof GetUserMetadataResponseSchema;
    };
    /**
     * @generated from rpc xstockstrat.identity.v1.IdentityService.UpdateUserMetadata
     */
    updateUserMetadata: {
        methodKind: "unary";
        input: typeof UpdateUserMetadataRequestSchema;
        output: typeof UpdateUserMetadataResponseSchema;
    };
    /**
     * User management (admin-gated, feature 043). Every RPC requires the admin access-scope bit;
     * passwords are write-only (never returned). Additive over the existing service.
     *
     * @generated from rpc xstockstrat.identity.v1.IdentityService.CreateUser
     */
    createUser: {
        methodKind: "unary";
        input: typeof CreateUserRequestSchema;
        output: typeof CreateUserResponseSchema;
    };
    /**
     * @generated from rpc xstockstrat.identity.v1.IdentityService.ListUsers
     */
    listUsers: {
        methodKind: "unary";
        input: typeof ListUsersRequestSchema;
        output: typeof ListUsersResponseSchema;
    };
    /**
     * @generated from rpc xstockstrat.identity.v1.IdentityService.GetUser
     */
    getUser: {
        methodKind: "unary";
        input: typeof GetUserRequestSchema;
        output: typeof GetUserResponseSchema;
    };
    /**
     * @generated from rpc xstockstrat.identity.v1.IdentityService.UpdatePassword
     */
    updatePassword: {
        methodKind: "unary";
        input: typeof UpdatePasswordRequestSchema;
        output: typeof UpdatePasswordResponseSchema;
    };
    /**
     * @generated from rpc xstockstrat.identity.v1.IdentityService.SetUserRoles
     */
    setUserRoles: {
        methodKind: "unary";
        input: typeof SetUserRolesRequestSchema;
        output: typeof SetUserRolesResponseSchema;
    };
    /**
     * @generated from rpc xstockstrat.identity.v1.IdentityService.SetUserActive
     */
    setUserActive: {
        methodKind: "unary";
        input: typeof SetUserActiveRequestSchema;
        output: typeof SetUserActiveResponseSchema;
    };
}>;

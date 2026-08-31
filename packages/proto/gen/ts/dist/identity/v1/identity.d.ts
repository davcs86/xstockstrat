import { BinaryReader, BinaryWriter } from "@bufbuild/protobuf/wire";
import { type CallOptions, type ChannelCredentials, Client, type ClientOptions, type ClientUnaryCall, type handleUnaryCall, type Metadata, type ServiceError, type UntypedServiceImplementation } from "@grpc/grpc-js";
export declare const protobufPackage = "xstockstrat.identity.v1";
/**
 * ── User management (admin-gated, feature 043) ───────────────────────────────
 * Closed role set (C-04). Mirrors the viewer/trader/admin roles the platform already uses;
 * TokenClaims.roles stays a free-string list (JWT claim shape, unchanged).
 */
export declare enum Role {
    ROLE_UNSPECIFIED = "ROLE_UNSPECIFIED",
    ROLE_ADMIN = "ROLE_ADMIN",
    ROLE_TRADER = "ROLE_TRADER",
    ROLE_VIEWER = "ROLE_VIEWER",
    UNRECOGNIZED = "UNRECOGNIZED"
}
export declare function roleFromJSON(object: any): Role;
export declare function roleToJSON(object: Role): string;
export declare function roleToNumber(object: Role): number;
export interface AuthenticateUserRequest {
    email: string;
    password: string;
}
export interface AuthTokenResponse {
    accessToken: string;
    refreshToken: string;
    expiresAt?: Date | undefined;
    claims?: TokenClaims | undefined;
}
export interface TokenClaims {
    userId: string;
    email: string;
    roles: string[];
    issuedAt?: Date | undefined;
    expiresAt?: Date | undefined;
    /** audience / resource URI (OAuth audience-bound JWT, RFC 8707) */
    aud: string;
}
export interface ValidateTokenRequest {
    token: string;
}
export interface RefreshTokenRequest {
    refreshToken: string;
}
export interface RevokeTokenRequest {
    token: string;
}
export interface RevokeTokenResponse {
    success: boolean;
}
/** ── OAuth 2.1 messages (feature 049 Part B) ────────────────────────────────── */
export interface OAuthClient {
    clientId: string;
    redirectUris: string[];
    clientName: string;
    createdAt?: Date | undefined;
}
export interface RegisterOAuthClientRequest {
    redirectUris: string[];
    clientName: string;
}
export interface GetOAuthClientRequest {
    clientId: string;
}
export interface IssueAuthCodeRequest {
    userId: string;
    clientId: string;
    redirectUri: string;
    codeChallenge: string;
    resource: string;
}
export interface IssueAuthCodeResponse {
    code: string;
}
export interface ExchangeAuthCodeRequest {
    code: string;
    codeVerifier: string;
    redirectUri: string;
    clientId: string;
    resource: string;
}
export interface OAuthTokenResponse {
    accessToken: string;
    tokenType: string;
    expiresIn: number;
    refreshToken: string;
}
export interface RefreshOAuthTokenRequest {
    refreshToken: string;
    resource: string;
}
/** ── Authorized-apps management (feature 051) ───────────────────────────────── */
export interface AuthorizedApp {
    clientId: string;
    clientName: string;
    authorizedAt?: Date | undefined;
    /**
     * Best-effort "last refreshed" time (bumped on refresh-token rotation), NOT per-request
     * access. May be unset. The UI labels this "Last refreshed", not "Last used".
     */
    lastUsedAt?: Date | undefined;
    redirectUris: string[];
}
export interface ListAuthorizedAppsRequest {
    userId: string;
}
export interface ListAuthorizedAppsResponse {
    apps: AuthorizedApp[];
}
export interface RevokeAuthorizedAppRequest {
    userId: string;
    clientId: string;
}
export interface RevokeAuthorizedAppResponse {
    success: boolean;
}
/** ── User profile metadata (feature 130) ────────────────────────────────── */
export interface UserMetadata {
    userId: string;
    email: string;
    phone?: string | undefined;
    displayName?: string | undefined;
    metadata?: {
        [key: string]: any;
    } | undefined;
    metadataUpdatedAt?: Date | undefined;
}
export interface GetUserMetadataRequest {
}
export interface GetUserMetadataResponse {
    userMetadata?: UserMetadata | undefined;
}
export interface UpdateUserMetadataRequest {
    phone?: string | undefined;
    displayName?: string | undefined;
    metadata?: {
        [key: string]: any;
    } | undefined;
}
export interface UpdateUserMetadataResponse {
    userMetadata?: UserMetadata | undefined;
}
/** Password-free admin view of a user (no password / password_hash — FR-10/AC-10). */
export interface User {
    userId: string;
    email: string;
    roles: Role[];
    isActive: boolean;
    createdAt?: Date | undefined;
}
export interface CreateUserRequest {
    email: string;
    /** write-only; never echoed back */
    password: string;
    roles: Role[];
}
export interface CreateUserResponse {
    user?: User | undefined;
}
export interface ListUsersRequest {
}
export interface ListUsersResponse {
    users: User[];
}
export interface GetUserRequest {
    userId: string;
}
export interface GetUserResponse {
    user?: User | undefined;
}
export interface UpdatePasswordRequest {
    userId: string;
    /** write-only; never echoed back */
    newPassword: string;
}
export interface UpdatePasswordResponse {
}
export interface SetUserRolesRequest {
    userId: string;
    roles: Role[];
}
export interface SetUserRolesResponse {
    user?: User | undefined;
}
export interface SetUserActiveRequest {
    userId: string;
    active: boolean;
}
export interface SetUserActiveResponse {
    user?: User | undefined;
}
export declare const AuthenticateUserRequest: MessageFns<AuthenticateUserRequest>;
export declare const AuthTokenResponse: MessageFns<AuthTokenResponse>;
export declare const TokenClaims: MessageFns<TokenClaims>;
export declare const ValidateTokenRequest: MessageFns<ValidateTokenRequest>;
export declare const RefreshTokenRequest: MessageFns<RefreshTokenRequest>;
export declare const RevokeTokenRequest: MessageFns<RevokeTokenRequest>;
export declare const RevokeTokenResponse: MessageFns<RevokeTokenResponse>;
export declare const OAuthClient: MessageFns<OAuthClient>;
export declare const RegisterOAuthClientRequest: MessageFns<RegisterOAuthClientRequest>;
export declare const GetOAuthClientRequest: MessageFns<GetOAuthClientRequest>;
export declare const IssueAuthCodeRequest: MessageFns<IssueAuthCodeRequest>;
export declare const IssueAuthCodeResponse: MessageFns<IssueAuthCodeResponse>;
export declare const ExchangeAuthCodeRequest: MessageFns<ExchangeAuthCodeRequest>;
export declare const OAuthTokenResponse: MessageFns<OAuthTokenResponse>;
export declare const RefreshOAuthTokenRequest: MessageFns<RefreshOAuthTokenRequest>;
export declare const AuthorizedApp: MessageFns<AuthorizedApp>;
export declare const ListAuthorizedAppsRequest: MessageFns<ListAuthorizedAppsRequest>;
export declare const ListAuthorizedAppsResponse: MessageFns<ListAuthorizedAppsResponse>;
export declare const RevokeAuthorizedAppRequest: MessageFns<RevokeAuthorizedAppRequest>;
export declare const RevokeAuthorizedAppResponse: MessageFns<RevokeAuthorizedAppResponse>;
export declare const UserMetadata: MessageFns<UserMetadata>;
export declare const GetUserMetadataRequest: MessageFns<GetUserMetadataRequest>;
export declare const GetUserMetadataResponse: MessageFns<GetUserMetadataResponse>;
export declare const UpdateUserMetadataRequest: MessageFns<UpdateUserMetadataRequest>;
export declare const UpdateUserMetadataResponse: MessageFns<UpdateUserMetadataResponse>;
export declare const User: MessageFns<User>;
export declare const CreateUserRequest: MessageFns<CreateUserRequest>;
export declare const CreateUserResponse: MessageFns<CreateUserResponse>;
export declare const ListUsersRequest: MessageFns<ListUsersRequest>;
export declare const ListUsersResponse: MessageFns<ListUsersResponse>;
export declare const GetUserRequest: MessageFns<GetUserRequest>;
export declare const GetUserResponse: MessageFns<GetUserResponse>;
export declare const UpdatePasswordRequest: MessageFns<UpdatePasswordRequest>;
export declare const UpdatePasswordResponse: MessageFns<UpdatePasswordResponse>;
export declare const SetUserRolesRequest: MessageFns<SetUserRolesRequest>;
export declare const SetUserRolesResponse: MessageFns<SetUserRolesResponse>;
export declare const SetUserActiveRequest: MessageFns<SetUserActiveRequest>;
export declare const SetUserActiveResponse: MessageFns<SetUserActiveResponse>;
export type IdentityServiceService = typeof IdentityServiceService;
export declare const IdentityServiceService: {
    readonly authenticateUser: {
        readonly path: "/xstockstrat.identity.v1.IdentityService/AuthenticateUser";
        readonly requestStream: false;
        readonly responseStream: false;
        readonly requestSerialize: (value: AuthenticateUserRequest) => Buffer;
        readonly requestDeserialize: (value: Buffer) => AuthenticateUserRequest;
        readonly responseSerialize: (value: AuthTokenResponse) => Buffer;
        readonly responseDeserialize: (value: Buffer) => AuthTokenResponse;
    };
    readonly validateToken: {
        readonly path: "/xstockstrat.identity.v1.IdentityService/ValidateToken";
        readonly requestStream: false;
        readonly responseStream: false;
        readonly requestSerialize: (value: ValidateTokenRequest) => Buffer;
        readonly requestDeserialize: (value: Buffer) => ValidateTokenRequest;
        readonly responseSerialize: (value: TokenClaims) => Buffer;
        readonly responseDeserialize: (value: Buffer) => TokenClaims;
    };
    readonly refreshToken: {
        readonly path: "/xstockstrat.identity.v1.IdentityService/RefreshToken";
        readonly requestStream: false;
        readonly responseStream: false;
        readonly requestSerialize: (value: RefreshTokenRequest) => Buffer;
        readonly requestDeserialize: (value: Buffer) => RefreshTokenRequest;
        readonly responseSerialize: (value: AuthTokenResponse) => Buffer;
        readonly responseDeserialize: (value: Buffer) => AuthTokenResponse;
    };
    readonly revokeToken: {
        readonly path: "/xstockstrat.identity.v1.IdentityService/RevokeToken";
        readonly requestStream: false;
        readonly responseStream: false;
        readonly requestSerialize: (value: RevokeTokenRequest) => Buffer;
        readonly requestDeserialize: (value: Buffer) => RevokeTokenRequest;
        readonly responseSerialize: (value: RevokeTokenResponse) => Buffer;
        readonly responseDeserialize: (value: Buffer) => RevokeTokenResponse;
    };
    /**
     * OAuth 2.1 authorization-server backend (feature 049 Part B). The MCP agent is the
     * OAuth AS/RS HTTP facade; identity is the durable client/code store + token mint.
     */
    readonly registerOAuthClient: {
        readonly path: "/xstockstrat.identity.v1.IdentityService/RegisterOAuthClient";
        readonly requestStream: false;
        readonly responseStream: false;
        readonly requestSerialize: (value: RegisterOAuthClientRequest) => Buffer;
        readonly requestDeserialize: (value: Buffer) => RegisterOAuthClientRequest;
        readonly responseSerialize: (value: OAuthClient) => Buffer;
        readonly responseDeserialize: (value: Buffer) => OAuthClient;
    };
    readonly getOAuthClient: {
        readonly path: "/xstockstrat.identity.v1.IdentityService/GetOAuthClient";
        readonly requestStream: false;
        readonly responseStream: false;
        readonly requestSerialize: (value: GetOAuthClientRequest) => Buffer;
        readonly requestDeserialize: (value: Buffer) => GetOAuthClientRequest;
        readonly responseSerialize: (value: OAuthClient) => Buffer;
        readonly responseDeserialize: (value: Buffer) => OAuthClient;
    };
    readonly issueAuthCode: {
        readonly path: "/xstockstrat.identity.v1.IdentityService/IssueAuthCode";
        readonly requestStream: false;
        readonly responseStream: false;
        readonly requestSerialize: (value: IssueAuthCodeRequest) => Buffer;
        readonly requestDeserialize: (value: Buffer) => IssueAuthCodeRequest;
        readonly responseSerialize: (value: IssueAuthCodeResponse) => Buffer;
        readonly responseDeserialize: (value: Buffer) => IssueAuthCodeResponse;
    };
    readonly exchangeAuthCode: {
        readonly path: "/xstockstrat.identity.v1.IdentityService/ExchangeAuthCode";
        readonly requestStream: false;
        readonly responseStream: false;
        readonly requestSerialize: (value: ExchangeAuthCodeRequest) => Buffer;
        readonly requestDeserialize: (value: Buffer) => ExchangeAuthCodeRequest;
        readonly responseSerialize: (value: OAuthTokenResponse) => Buffer;
        readonly responseDeserialize: (value: Buffer) => OAuthTokenResponse;
    };
    readonly refreshOAuthToken: {
        readonly path: "/xstockstrat.identity.v1.IdentityService/RefreshOAuthToken";
        readonly requestStream: false;
        readonly responseStream: false;
        readonly requestSerialize: (value: RefreshOAuthTokenRequest) => Buffer;
        readonly requestDeserialize: (value: Buffer) => RefreshOAuthTokenRequest;
        readonly responseSerialize: (value: OAuthTokenResponse) => Buffer;
        readonly responseDeserialize: (value: Buffer) => OAuthTokenResponse;
    };
    /**
     * Per-user authorized-app management (feature 051) — list/revoke OAuth clients the
     * calling user has granted access to the MCP agent. Additive over 049's OAuth backend.
     */
    readonly listAuthorizedApps: {
        readonly path: "/xstockstrat.identity.v1.IdentityService/ListAuthorizedApps";
        readonly requestStream: false;
        readonly responseStream: false;
        readonly requestSerialize: (value: ListAuthorizedAppsRequest) => Buffer;
        readonly requestDeserialize: (value: Buffer) => ListAuthorizedAppsRequest;
        readonly responseSerialize: (value: ListAuthorizedAppsResponse) => Buffer;
        readonly responseDeserialize: (value: Buffer) => ListAuthorizedAppsResponse;
    };
    readonly revokeAuthorizedApp: {
        readonly path: "/xstockstrat.identity.v1.IdentityService/RevokeAuthorizedApp";
        readonly requestStream: false;
        readonly responseStream: false;
        readonly requestSerialize: (value: RevokeAuthorizedAppRequest) => Buffer;
        readonly requestDeserialize: (value: Buffer) => RevokeAuthorizedAppRequest;
        readonly responseSerialize: (value: RevokeAuthorizedAppResponse) => Buffer;
        readonly responseDeserialize: (value: Buffer) => RevokeAuthorizedAppResponse;
    };
    /** User profile metadata self-management (feature 130) */
    readonly getUserMetadata: {
        readonly path: "/xstockstrat.identity.v1.IdentityService/GetUserMetadata";
        readonly requestStream: false;
        readonly responseStream: false;
        readonly requestSerialize: (value: GetUserMetadataRequest) => Buffer;
        readonly requestDeserialize: (value: Buffer) => GetUserMetadataRequest;
        readonly responseSerialize: (value: GetUserMetadataResponse) => Buffer;
        readonly responseDeserialize: (value: Buffer) => GetUserMetadataResponse;
    };
    readonly updateUserMetadata: {
        readonly path: "/xstockstrat.identity.v1.IdentityService/UpdateUserMetadata";
        readonly requestStream: false;
        readonly responseStream: false;
        readonly requestSerialize: (value: UpdateUserMetadataRequest) => Buffer;
        readonly requestDeserialize: (value: Buffer) => UpdateUserMetadataRequest;
        readonly responseSerialize: (value: UpdateUserMetadataResponse) => Buffer;
        readonly responseDeserialize: (value: Buffer) => UpdateUserMetadataResponse;
    };
    /**
     * User management (admin-gated, feature 043). Every RPC requires the admin access-scope bit;
     * passwords are write-only (never returned). Additive over the existing service.
     */
    readonly createUser: {
        readonly path: "/xstockstrat.identity.v1.IdentityService/CreateUser";
        readonly requestStream: false;
        readonly responseStream: false;
        readonly requestSerialize: (value: CreateUserRequest) => Buffer;
        readonly requestDeserialize: (value: Buffer) => CreateUserRequest;
        readonly responseSerialize: (value: CreateUserResponse) => Buffer;
        readonly responseDeserialize: (value: Buffer) => CreateUserResponse;
    };
    readonly listUsers: {
        readonly path: "/xstockstrat.identity.v1.IdentityService/ListUsers";
        readonly requestStream: false;
        readonly responseStream: false;
        readonly requestSerialize: (value: ListUsersRequest) => Buffer;
        readonly requestDeserialize: (value: Buffer) => ListUsersRequest;
        readonly responseSerialize: (value: ListUsersResponse) => Buffer;
        readonly responseDeserialize: (value: Buffer) => ListUsersResponse;
    };
    readonly getUser: {
        readonly path: "/xstockstrat.identity.v1.IdentityService/GetUser";
        readonly requestStream: false;
        readonly responseStream: false;
        readonly requestSerialize: (value: GetUserRequest) => Buffer;
        readonly requestDeserialize: (value: Buffer) => GetUserRequest;
        readonly responseSerialize: (value: GetUserResponse) => Buffer;
        readonly responseDeserialize: (value: Buffer) => GetUserResponse;
    };
    readonly updatePassword: {
        readonly path: "/xstockstrat.identity.v1.IdentityService/UpdatePassword";
        readonly requestStream: false;
        readonly responseStream: false;
        readonly requestSerialize: (value: UpdatePasswordRequest) => Buffer;
        readonly requestDeserialize: (value: Buffer) => UpdatePasswordRequest;
        readonly responseSerialize: (value: UpdatePasswordResponse) => Buffer;
        readonly responseDeserialize: (value: Buffer) => UpdatePasswordResponse;
    };
    readonly setUserRoles: {
        readonly path: "/xstockstrat.identity.v1.IdentityService/SetUserRoles";
        readonly requestStream: false;
        readonly responseStream: false;
        readonly requestSerialize: (value: SetUserRolesRequest) => Buffer;
        readonly requestDeserialize: (value: Buffer) => SetUserRolesRequest;
        readonly responseSerialize: (value: SetUserRolesResponse) => Buffer;
        readonly responseDeserialize: (value: Buffer) => SetUserRolesResponse;
    };
    readonly setUserActive: {
        readonly path: "/xstockstrat.identity.v1.IdentityService/SetUserActive";
        readonly requestStream: false;
        readonly responseStream: false;
        readonly requestSerialize: (value: SetUserActiveRequest) => Buffer;
        readonly requestDeserialize: (value: Buffer) => SetUserActiveRequest;
        readonly responseSerialize: (value: SetUserActiveResponse) => Buffer;
        readonly responseDeserialize: (value: Buffer) => SetUserActiveResponse;
    };
};
export interface IdentityServiceServer extends UntypedServiceImplementation {
    authenticateUser: handleUnaryCall<AuthenticateUserRequest, AuthTokenResponse>;
    validateToken: handleUnaryCall<ValidateTokenRequest, TokenClaims>;
    refreshToken: handleUnaryCall<RefreshTokenRequest, AuthTokenResponse>;
    revokeToken: handleUnaryCall<RevokeTokenRequest, RevokeTokenResponse>;
    /**
     * OAuth 2.1 authorization-server backend (feature 049 Part B). The MCP agent is the
     * OAuth AS/RS HTTP facade; identity is the durable client/code store + token mint.
     */
    registerOAuthClient: handleUnaryCall<RegisterOAuthClientRequest, OAuthClient>;
    getOAuthClient: handleUnaryCall<GetOAuthClientRequest, OAuthClient>;
    issueAuthCode: handleUnaryCall<IssueAuthCodeRequest, IssueAuthCodeResponse>;
    exchangeAuthCode: handleUnaryCall<ExchangeAuthCodeRequest, OAuthTokenResponse>;
    refreshOAuthToken: handleUnaryCall<RefreshOAuthTokenRequest, OAuthTokenResponse>;
    /**
     * Per-user authorized-app management (feature 051) — list/revoke OAuth clients the
     * calling user has granted access to the MCP agent. Additive over 049's OAuth backend.
     */
    listAuthorizedApps: handleUnaryCall<ListAuthorizedAppsRequest, ListAuthorizedAppsResponse>;
    revokeAuthorizedApp: handleUnaryCall<RevokeAuthorizedAppRequest, RevokeAuthorizedAppResponse>;
    /** User profile metadata self-management (feature 130) */
    getUserMetadata: handleUnaryCall<GetUserMetadataRequest, GetUserMetadataResponse>;
    updateUserMetadata: handleUnaryCall<UpdateUserMetadataRequest, UpdateUserMetadataResponse>;
    /**
     * User management (admin-gated, feature 043). Every RPC requires the admin access-scope bit;
     * passwords are write-only (never returned). Additive over the existing service.
     */
    createUser: handleUnaryCall<CreateUserRequest, CreateUserResponse>;
    listUsers: handleUnaryCall<ListUsersRequest, ListUsersResponse>;
    getUser: handleUnaryCall<GetUserRequest, GetUserResponse>;
    updatePassword: handleUnaryCall<UpdatePasswordRequest, UpdatePasswordResponse>;
    setUserRoles: handleUnaryCall<SetUserRolesRequest, SetUserRolesResponse>;
    setUserActive: handleUnaryCall<SetUserActiveRequest, SetUserActiveResponse>;
}
export interface IdentityServiceClient extends Client {
    authenticateUser(request: AuthenticateUserRequest, callback: (error: ServiceError | null, response: AuthTokenResponse) => void): ClientUnaryCall;
    authenticateUser(request: AuthenticateUserRequest, metadata: Metadata, callback: (error: ServiceError | null, response: AuthTokenResponse) => void): ClientUnaryCall;
    authenticateUser(request: AuthenticateUserRequest, metadata: Metadata, options: Partial<CallOptions>, callback: (error: ServiceError | null, response: AuthTokenResponse) => void): ClientUnaryCall;
    validateToken(request: ValidateTokenRequest, callback: (error: ServiceError | null, response: TokenClaims) => void): ClientUnaryCall;
    validateToken(request: ValidateTokenRequest, metadata: Metadata, callback: (error: ServiceError | null, response: TokenClaims) => void): ClientUnaryCall;
    validateToken(request: ValidateTokenRequest, metadata: Metadata, options: Partial<CallOptions>, callback: (error: ServiceError | null, response: TokenClaims) => void): ClientUnaryCall;
    refreshToken(request: RefreshTokenRequest, callback: (error: ServiceError | null, response: AuthTokenResponse) => void): ClientUnaryCall;
    refreshToken(request: RefreshTokenRequest, metadata: Metadata, callback: (error: ServiceError | null, response: AuthTokenResponse) => void): ClientUnaryCall;
    refreshToken(request: RefreshTokenRequest, metadata: Metadata, options: Partial<CallOptions>, callback: (error: ServiceError | null, response: AuthTokenResponse) => void): ClientUnaryCall;
    revokeToken(request: RevokeTokenRequest, callback: (error: ServiceError | null, response: RevokeTokenResponse) => void): ClientUnaryCall;
    revokeToken(request: RevokeTokenRequest, metadata: Metadata, callback: (error: ServiceError | null, response: RevokeTokenResponse) => void): ClientUnaryCall;
    revokeToken(request: RevokeTokenRequest, metadata: Metadata, options: Partial<CallOptions>, callback: (error: ServiceError | null, response: RevokeTokenResponse) => void): ClientUnaryCall;
    /**
     * OAuth 2.1 authorization-server backend (feature 049 Part B). The MCP agent is the
     * OAuth AS/RS HTTP facade; identity is the durable client/code store + token mint.
     */
    registerOAuthClient(request: RegisterOAuthClientRequest, callback: (error: ServiceError | null, response: OAuthClient) => void): ClientUnaryCall;
    registerOAuthClient(request: RegisterOAuthClientRequest, metadata: Metadata, callback: (error: ServiceError | null, response: OAuthClient) => void): ClientUnaryCall;
    registerOAuthClient(request: RegisterOAuthClientRequest, metadata: Metadata, options: Partial<CallOptions>, callback: (error: ServiceError | null, response: OAuthClient) => void): ClientUnaryCall;
    getOAuthClient(request: GetOAuthClientRequest, callback: (error: ServiceError | null, response: OAuthClient) => void): ClientUnaryCall;
    getOAuthClient(request: GetOAuthClientRequest, metadata: Metadata, callback: (error: ServiceError | null, response: OAuthClient) => void): ClientUnaryCall;
    getOAuthClient(request: GetOAuthClientRequest, metadata: Metadata, options: Partial<CallOptions>, callback: (error: ServiceError | null, response: OAuthClient) => void): ClientUnaryCall;
    issueAuthCode(request: IssueAuthCodeRequest, callback: (error: ServiceError | null, response: IssueAuthCodeResponse) => void): ClientUnaryCall;
    issueAuthCode(request: IssueAuthCodeRequest, metadata: Metadata, callback: (error: ServiceError | null, response: IssueAuthCodeResponse) => void): ClientUnaryCall;
    issueAuthCode(request: IssueAuthCodeRequest, metadata: Metadata, options: Partial<CallOptions>, callback: (error: ServiceError | null, response: IssueAuthCodeResponse) => void): ClientUnaryCall;
    exchangeAuthCode(request: ExchangeAuthCodeRequest, callback: (error: ServiceError | null, response: OAuthTokenResponse) => void): ClientUnaryCall;
    exchangeAuthCode(request: ExchangeAuthCodeRequest, metadata: Metadata, callback: (error: ServiceError | null, response: OAuthTokenResponse) => void): ClientUnaryCall;
    exchangeAuthCode(request: ExchangeAuthCodeRequest, metadata: Metadata, options: Partial<CallOptions>, callback: (error: ServiceError | null, response: OAuthTokenResponse) => void): ClientUnaryCall;
    refreshOAuthToken(request: RefreshOAuthTokenRequest, callback: (error: ServiceError | null, response: OAuthTokenResponse) => void): ClientUnaryCall;
    refreshOAuthToken(request: RefreshOAuthTokenRequest, metadata: Metadata, callback: (error: ServiceError | null, response: OAuthTokenResponse) => void): ClientUnaryCall;
    refreshOAuthToken(request: RefreshOAuthTokenRequest, metadata: Metadata, options: Partial<CallOptions>, callback: (error: ServiceError | null, response: OAuthTokenResponse) => void): ClientUnaryCall;
    /**
     * Per-user authorized-app management (feature 051) — list/revoke OAuth clients the
     * calling user has granted access to the MCP agent. Additive over 049's OAuth backend.
     */
    listAuthorizedApps(request: ListAuthorizedAppsRequest, callback: (error: ServiceError | null, response: ListAuthorizedAppsResponse) => void): ClientUnaryCall;
    listAuthorizedApps(request: ListAuthorizedAppsRequest, metadata: Metadata, callback: (error: ServiceError | null, response: ListAuthorizedAppsResponse) => void): ClientUnaryCall;
    listAuthorizedApps(request: ListAuthorizedAppsRequest, metadata: Metadata, options: Partial<CallOptions>, callback: (error: ServiceError | null, response: ListAuthorizedAppsResponse) => void): ClientUnaryCall;
    revokeAuthorizedApp(request: RevokeAuthorizedAppRequest, callback: (error: ServiceError | null, response: RevokeAuthorizedAppResponse) => void): ClientUnaryCall;
    revokeAuthorizedApp(request: RevokeAuthorizedAppRequest, metadata: Metadata, callback: (error: ServiceError | null, response: RevokeAuthorizedAppResponse) => void): ClientUnaryCall;
    revokeAuthorizedApp(request: RevokeAuthorizedAppRequest, metadata: Metadata, options: Partial<CallOptions>, callback: (error: ServiceError | null, response: RevokeAuthorizedAppResponse) => void): ClientUnaryCall;
    /** User profile metadata self-management (feature 130) */
    getUserMetadata(request: GetUserMetadataRequest, callback: (error: ServiceError | null, response: GetUserMetadataResponse) => void): ClientUnaryCall;
    getUserMetadata(request: GetUserMetadataRequest, metadata: Metadata, callback: (error: ServiceError | null, response: GetUserMetadataResponse) => void): ClientUnaryCall;
    getUserMetadata(request: GetUserMetadataRequest, metadata: Metadata, options: Partial<CallOptions>, callback: (error: ServiceError | null, response: GetUserMetadataResponse) => void): ClientUnaryCall;
    updateUserMetadata(request: UpdateUserMetadataRequest, callback: (error: ServiceError | null, response: UpdateUserMetadataResponse) => void): ClientUnaryCall;
    updateUserMetadata(request: UpdateUserMetadataRequest, metadata: Metadata, callback: (error: ServiceError | null, response: UpdateUserMetadataResponse) => void): ClientUnaryCall;
    updateUserMetadata(request: UpdateUserMetadataRequest, metadata: Metadata, options: Partial<CallOptions>, callback: (error: ServiceError | null, response: UpdateUserMetadataResponse) => void): ClientUnaryCall;
    /**
     * User management (admin-gated, feature 043). Every RPC requires the admin access-scope bit;
     * passwords are write-only (never returned). Additive over the existing service.
     */
    createUser(request: CreateUserRequest, callback: (error: ServiceError | null, response: CreateUserResponse) => void): ClientUnaryCall;
    createUser(request: CreateUserRequest, metadata: Metadata, callback: (error: ServiceError | null, response: CreateUserResponse) => void): ClientUnaryCall;
    createUser(request: CreateUserRequest, metadata: Metadata, options: Partial<CallOptions>, callback: (error: ServiceError | null, response: CreateUserResponse) => void): ClientUnaryCall;
    listUsers(request: ListUsersRequest, callback: (error: ServiceError | null, response: ListUsersResponse) => void): ClientUnaryCall;
    listUsers(request: ListUsersRequest, metadata: Metadata, callback: (error: ServiceError | null, response: ListUsersResponse) => void): ClientUnaryCall;
    listUsers(request: ListUsersRequest, metadata: Metadata, options: Partial<CallOptions>, callback: (error: ServiceError | null, response: ListUsersResponse) => void): ClientUnaryCall;
    getUser(request: GetUserRequest, callback: (error: ServiceError | null, response: GetUserResponse) => void): ClientUnaryCall;
    getUser(request: GetUserRequest, metadata: Metadata, callback: (error: ServiceError | null, response: GetUserResponse) => void): ClientUnaryCall;
    getUser(request: GetUserRequest, metadata: Metadata, options: Partial<CallOptions>, callback: (error: ServiceError | null, response: GetUserResponse) => void): ClientUnaryCall;
    updatePassword(request: UpdatePasswordRequest, callback: (error: ServiceError | null, response: UpdatePasswordResponse) => void): ClientUnaryCall;
    updatePassword(request: UpdatePasswordRequest, metadata: Metadata, callback: (error: ServiceError | null, response: UpdatePasswordResponse) => void): ClientUnaryCall;
    updatePassword(request: UpdatePasswordRequest, metadata: Metadata, options: Partial<CallOptions>, callback: (error: ServiceError | null, response: UpdatePasswordResponse) => void): ClientUnaryCall;
    setUserRoles(request: SetUserRolesRequest, callback: (error: ServiceError | null, response: SetUserRolesResponse) => void): ClientUnaryCall;
    setUserRoles(request: SetUserRolesRequest, metadata: Metadata, callback: (error: ServiceError | null, response: SetUserRolesResponse) => void): ClientUnaryCall;
    setUserRoles(request: SetUserRolesRequest, metadata: Metadata, options: Partial<CallOptions>, callback: (error: ServiceError | null, response: SetUserRolesResponse) => void): ClientUnaryCall;
    setUserActive(request: SetUserActiveRequest, callback: (error: ServiceError | null, response: SetUserActiveResponse) => void): ClientUnaryCall;
    setUserActive(request: SetUserActiveRequest, metadata: Metadata, callback: (error: ServiceError | null, response: SetUserActiveResponse) => void): ClientUnaryCall;
    setUserActive(request: SetUserActiveRequest, metadata: Metadata, options: Partial<CallOptions>, callback: (error: ServiceError | null, response: SetUserActiveResponse) => void): ClientUnaryCall;
}
export declare const IdentityServiceClient: {
    new (address: string, credentials: ChannelCredentials, options?: Partial<ClientOptions>): IdentityServiceClient;
    service: typeof IdentityServiceService;
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

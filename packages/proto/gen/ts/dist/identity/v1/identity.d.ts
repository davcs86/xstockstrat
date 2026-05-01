import { BinaryReader, BinaryWriter } from "@bufbuild/protobuf/wire";
import { type CallOptions, type ChannelCredentials, Client, type ClientOptions, type ClientUnaryCall, type handleUnaryCall, type Metadata, type ServiceError, type UntypedServiceImplementation } from "@grpc/grpc-js";
export declare const protobufPackage = "xstockstrat.identity.v1";
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
export interface ApiKey {
    keyId: string;
    /** first 8 chars only (rest is hashed) */
    keyPrefix: string;
    userId: string;
    name: string;
    scopes: string[];
    createdAt?: Date | undefined;
    expiresAt?: Date | undefined;
}
export interface CreateApiKeyRequest {
    userId: string;
    name: string;
    scopes: string[];
    expiresAt?: Date | undefined;
}
export interface ValidateApiKeyRequest {
    apiKey: string;
}
export interface ListApiKeysRequest {
    userId: string;
}
export interface ListApiKeysResponse {
    keys: ApiKey[];
}
export interface RevokeApiKeyRequest {
    keyId: string;
    userId: string;
}
export interface RevokeApiKeyResponse {
    success: boolean;
}
export declare const AuthenticateUserRequest: MessageFns<AuthenticateUserRequest>;
export declare const AuthTokenResponse: MessageFns<AuthTokenResponse>;
export declare const TokenClaims: MessageFns<TokenClaims>;
export declare const ValidateTokenRequest: MessageFns<ValidateTokenRequest>;
export declare const RefreshTokenRequest: MessageFns<RefreshTokenRequest>;
export declare const RevokeTokenRequest: MessageFns<RevokeTokenRequest>;
export declare const RevokeTokenResponse: MessageFns<RevokeTokenResponse>;
export declare const ApiKey: MessageFns<ApiKey>;
export declare const CreateApiKeyRequest: MessageFns<CreateApiKeyRequest>;
export declare const ValidateApiKeyRequest: MessageFns<ValidateApiKeyRequest>;
export declare const ListApiKeysRequest: MessageFns<ListApiKeysRequest>;
export declare const ListApiKeysResponse: MessageFns<ListApiKeysResponse>;
export declare const RevokeApiKeyRequest: MessageFns<RevokeApiKeyRequest>;
export declare const RevokeApiKeyResponse: MessageFns<RevokeApiKeyResponse>;
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
    readonly createApiKey: {
        readonly path: "/xstockstrat.identity.v1.IdentityService/CreateApiKey";
        readonly requestStream: false;
        readonly responseStream: false;
        readonly requestSerialize: (value: CreateApiKeyRequest) => Buffer;
        readonly requestDeserialize: (value: Buffer) => CreateApiKeyRequest;
        readonly responseSerialize: (value: ApiKey) => Buffer;
        readonly responseDeserialize: (value: Buffer) => ApiKey;
    };
    readonly validateApiKey: {
        readonly path: "/xstockstrat.identity.v1.IdentityService/ValidateApiKey";
        readonly requestStream: false;
        readonly responseStream: false;
        readonly requestSerialize: (value: ValidateApiKeyRequest) => Buffer;
        readonly requestDeserialize: (value: Buffer) => ValidateApiKeyRequest;
        readonly responseSerialize: (value: TokenClaims) => Buffer;
        readonly responseDeserialize: (value: Buffer) => TokenClaims;
    };
    readonly listApiKeys: {
        readonly path: "/xstockstrat.identity.v1.IdentityService/ListApiKeys";
        readonly requestStream: false;
        readonly responseStream: false;
        readonly requestSerialize: (value: ListApiKeysRequest) => Buffer;
        readonly requestDeserialize: (value: Buffer) => ListApiKeysRequest;
        readonly responseSerialize: (value: ListApiKeysResponse) => Buffer;
        readonly responseDeserialize: (value: Buffer) => ListApiKeysResponse;
    };
    readonly revokeApiKey: {
        readonly path: "/xstockstrat.identity.v1.IdentityService/RevokeApiKey";
        readonly requestStream: false;
        readonly responseStream: false;
        readonly requestSerialize: (value: RevokeApiKeyRequest) => Buffer;
        readonly requestDeserialize: (value: Buffer) => RevokeApiKeyRequest;
        readonly responseSerialize: (value: RevokeApiKeyResponse) => Buffer;
        readonly responseDeserialize: (value: Buffer) => RevokeApiKeyResponse;
    };
};
export interface IdentityServiceServer extends UntypedServiceImplementation {
    authenticateUser: handleUnaryCall<AuthenticateUserRequest, AuthTokenResponse>;
    validateToken: handleUnaryCall<ValidateTokenRequest, TokenClaims>;
    refreshToken: handleUnaryCall<RefreshTokenRequest, AuthTokenResponse>;
    revokeToken: handleUnaryCall<RevokeTokenRequest, RevokeTokenResponse>;
    createApiKey: handleUnaryCall<CreateApiKeyRequest, ApiKey>;
    validateApiKey: handleUnaryCall<ValidateApiKeyRequest, TokenClaims>;
    listApiKeys: handleUnaryCall<ListApiKeysRequest, ListApiKeysResponse>;
    revokeApiKey: handleUnaryCall<RevokeApiKeyRequest, RevokeApiKeyResponse>;
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
    createApiKey(request: CreateApiKeyRequest, callback: (error: ServiceError | null, response: ApiKey) => void): ClientUnaryCall;
    createApiKey(request: CreateApiKeyRequest, metadata: Metadata, callback: (error: ServiceError | null, response: ApiKey) => void): ClientUnaryCall;
    createApiKey(request: CreateApiKeyRequest, metadata: Metadata, options: Partial<CallOptions>, callback: (error: ServiceError | null, response: ApiKey) => void): ClientUnaryCall;
    validateApiKey(request: ValidateApiKeyRequest, callback: (error: ServiceError | null, response: TokenClaims) => void): ClientUnaryCall;
    validateApiKey(request: ValidateApiKeyRequest, metadata: Metadata, callback: (error: ServiceError | null, response: TokenClaims) => void): ClientUnaryCall;
    validateApiKey(request: ValidateApiKeyRequest, metadata: Metadata, options: Partial<CallOptions>, callback: (error: ServiceError | null, response: TokenClaims) => void): ClientUnaryCall;
    listApiKeys(request: ListApiKeysRequest, callback: (error: ServiceError | null, response: ListApiKeysResponse) => void): ClientUnaryCall;
    listApiKeys(request: ListApiKeysRequest, metadata: Metadata, callback: (error: ServiceError | null, response: ListApiKeysResponse) => void): ClientUnaryCall;
    listApiKeys(request: ListApiKeysRequest, metadata: Metadata, options: Partial<CallOptions>, callback: (error: ServiceError | null, response: ListApiKeysResponse) => void): ClientUnaryCall;
    revokeApiKey(request: RevokeApiKeyRequest, callback: (error: ServiceError | null, response: RevokeApiKeyResponse) => void): ClientUnaryCall;
    revokeApiKey(request: RevokeApiKeyRequest, metadata: Metadata, callback: (error: ServiceError | null, response: RevokeApiKeyResponse) => void): ClientUnaryCall;
    revokeApiKey(request: RevokeApiKeyRequest, metadata: Metadata, options: Partial<CallOptions>, callback: (error: ServiceError | null, response: RevokeApiKeyResponse) => void): ClientUnaryCall;
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

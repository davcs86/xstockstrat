import { BinaryReader, BinaryWriter } from "@bufbuild/protobuf/wire";
import { type CallOptions, type ChannelCredentials, Client, type ClientOptions, type ClientUnaryCall, type handleUnaryCall, type Metadata, type ServiceError, type UntypedServiceImplementation } from "@grpc/grpc-js";
export declare const protobufPackage = "xstockstrat.agent.v1";
export interface ListToolsRequest {
}
export interface ListToolsResponse {
    tools: McpTool[];
}
export interface McpTool {
    name: string;
    description: string;
    /** the tool's JSON Schema */
    inputSchema?: {
        [key: string]: any;
    } | undefined;
}
export declare const ListToolsRequest: MessageFns<ListToolsRequest>;
export declare const ListToolsResponse: MessageFns<ListToolsResponse>;
export declare const McpTool: MessageFns<McpTool>;
/**
 * AgentService — the MCP agent's internal tool catalog.
 * Internal only: served over mutual TLS, and only the xstockstrat-ui peer certificate may call it.
 */
export type AgentServiceService = typeof AgentServiceService;
export declare const AgentServiceService: {
    readonly listTools: {
        readonly path: "/xstockstrat.agent.v1.AgentService/ListTools";
        readonly requestStream: false;
        readonly responseStream: false;
        readonly requestSerialize: (value: ListToolsRequest) => Buffer;
        readonly requestDeserialize: (value: Buffer) => ListToolsRequest;
        readonly responseSerialize: (value: ListToolsResponse) => Buffer;
        readonly responseDeserialize: (value: Buffer) => ListToolsResponse;
    };
};
export interface AgentServiceServer extends UntypedServiceImplementation {
    listTools: handleUnaryCall<ListToolsRequest, ListToolsResponse>;
}
export interface AgentServiceClient extends Client {
    listTools(request: ListToolsRequest, callback: (error: ServiceError | null, response: ListToolsResponse) => void): ClientUnaryCall;
    listTools(request: ListToolsRequest, metadata: Metadata, callback: (error: ServiceError | null, response: ListToolsResponse) => void): ClientUnaryCall;
    listTools(request: ListToolsRequest, metadata: Metadata, options: Partial<CallOptions>, callback: (error: ServiceError | null, response: ListToolsResponse) => void): ClientUnaryCall;
}
export declare const AgentServiceClient: {
    new (address: string, credentials: ChannelCredentials, options?: Partial<ClientOptions>): AgentServiceClient;
    service: typeof AgentServiceService;
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

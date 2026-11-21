import type { GenFile, GenMessage, GenService } from "@bufbuild/protobuf/codegenv2";
import type { JsonObject, Message } from "@bufbuild/protobuf";
/**
 * Describes the file agent/v1/agent.proto.
 */
export declare const file_agent_v1_agent: GenFile;
/**
 * @generated from message xstockstrat.agent.v1.ListToolsRequest
 */
export type ListToolsRequest = Message<"xstockstrat.agent.v1.ListToolsRequest"> & {};
/**
 * Describes the message xstockstrat.agent.v1.ListToolsRequest.
 * Use `create(ListToolsRequestSchema)` to create a new message.
 */
export declare const ListToolsRequestSchema: GenMessage<ListToolsRequest>;
/**
 * @generated from message xstockstrat.agent.v1.ListToolsResponse
 */
export type ListToolsResponse = Message<"xstockstrat.agent.v1.ListToolsResponse"> & {
    /**
     * @generated from field: repeated xstockstrat.agent.v1.McpTool tools = 1;
     */
    tools: McpTool[];
};
/**
 * Describes the message xstockstrat.agent.v1.ListToolsResponse.
 * Use `create(ListToolsResponseSchema)` to create a new message.
 */
export declare const ListToolsResponseSchema: GenMessage<ListToolsResponse>;
/**
 * @generated from message xstockstrat.agent.v1.McpTool
 */
export type McpTool = Message<"xstockstrat.agent.v1.McpTool"> & {
    /**
     * @generated from field: string name = 1;
     */
    name: string;
    /**
     * @generated from field: string description = 2;
     */
    description: string;
    /**
     * the tool's JSON Schema
     *
     * @generated from field: google.protobuf.Struct input_schema = 3;
     */
    inputSchema?: JsonObject | undefined;
};
/**
 * Describes the message xstockstrat.agent.v1.McpTool.
 * Use `create(McpToolSchema)` to create a new message.
 */
export declare const McpToolSchema: GenMessage<McpTool>;
/**
 * AgentService — the MCP agent's internal tool catalog.
 * Internal only: served over mutual TLS, and only the xstockstrat-ui peer certificate may call it.
 *
 * @generated from service xstockstrat.agent.v1.AgentService
 */
export declare const AgentService: GenService<{
    /**
     * @generated from rpc xstockstrat.agent.v1.AgentService.ListTools
     */
    listTools: {
        methodKind: "unary";
        input: typeof ListToolsRequestSchema;
        output: typeof ListToolsResponseSchema;
    };
}>;

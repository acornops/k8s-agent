import pino from 'pino';
import { config } from '../config.js';
import {
  JsonRpcRequest,
  JsonRpcResponse,
  createResponse,
  createErrorResponse,
  RPC_ERRORS
} from './protocol.js';
import { toolRegistry } from '../tools/registry.js';
import { zodToJsonSchema } from '../tools/json-schema.js';

const logger = pino({ level: config.ACORNOPS_AGENT_LOG_LEVEL }).child({ module: 'mcp-router' });

/**
 * Routes incoming JSON-RPC requests to the appropriate tool or service handler.
 */
export class McpRouter {
  /**
   * Processes a JSON-RPC request and returns the corresponding response.
   * @param request The incoming JSON-RPC request.
   * @returns A promise that resolves to a JSON-RPC response.
   */
  public async handleRequest(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    logger.debug({ method: request.method, id: request.id }, 'Handling JSON-RPC request');

    if (request.method === 'tools/call') {
      return this.handleToolCall(request);
    }

    if (request.method === 'tools/list') {
        return createResponse(request.id, {
            tools: toolRegistry.getAll().map(t => ({
                name: t.name,
                description: t.description,
                capability: t.capability,
                input_schema: zodToJsonSchema(t.schema),
                timeout_ms: t.timeoutMs,
                version: t.version,
                deprecated: Boolean(t.deprecated),
            }))
        });
    }

    return createErrorResponse(
      request.id,
      RPC_ERRORS.METHOD_NOT_FOUND,
      `Method not found: ${request.method}`
    );
  }

  private async handleToolCall(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    const { name, arguments: args } = request.params || {};

    if (!name) {
      return createErrorResponse(request.id, RPC_ERRORS.INVALID_PARAMS, 'Missing tool name');
    }

    const tool = toolRegistry.get(name);
    if (!tool) {
      return createErrorResponse(request.id, RPC_ERRORS.METHOD_NOT_FOUND, `Tool not found: ${name}`);
    }

    try {
      // Validate arguments
      const validatedArgs = tool.schema.safeParse(args);
      if (!validatedArgs.success) {
        return createErrorResponse(
          request.id,
          RPC_ERRORS.INVALID_PARAMS,
          'Invalid tool arguments',
          validatedArgs.error.flatten()
        );
      }

      logger.info({ tool: name }, 'Executing tool');
      const result = await tool.handler(validatedArgs.data);
      return createResponse(request.id, result);
    } catch (err: any) {
      logger.error({ err, tool: name }, 'Tool execution failed');
      return createErrorResponse(
        request.id,
        RPC_ERRORS.INTERNAL_ERROR,
        err.message || 'Internal error during tool execution'
      );
    }
  }
}

export const mcpRouter = new McpRouter();

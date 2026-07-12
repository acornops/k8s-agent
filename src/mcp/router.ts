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
import { ToolExecutionError } from '../tools/errors.js';
import { ToolSessionPolicy, toolExecutor } from '../tools/executor.js';

const logger = pino({ level: config.ACORNOPS_AGENT_LOG_LEVEL }).child({ module: 'mcp-router' });

/**
 * Routes incoming JSON-RPC requests to the appropriate tool or service handler.
 */
export class McpRouter {
  private sessionPolicy: ToolSessionPolicy | null = null;

  /** Install the authenticated policy for the active WebSocket generation. */
  public setSessionPolicy(policy: ToolSessionPolicy): void {
    this.sessionPolicy = {
      ...policy,
      allowedTools: new Set(policy.allowedTools),
    };
    toolExecutor.setActiveGeneration(policy.generation);
  }

  /** Clear policy when the active WebSocket generation ends. */
  public clearSessionPolicy(): void {
    this.sessionPolicy = null;
    toolExecutor.clearActiveGeneration();
  }
  /**
   * Processes a JSON-RPC request and returns the corresponding response.
   * @param request The incoming JSON-RPC request.
   * @returns A promise that resolves to a JSON-RPC response.
   */
  public async handleRequest(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    logger.debug({ method: request.method, id: request.id }, 'Handling JSON-RPC request');

    if (request.method === 'tools/call') {
      if (!this.sessionPolicy) {
        return createErrorResponse(request.id, -32001, 'Tool session is not ready', { code: 'TOOL_NOT_ALLOWED' });
      }
      return this.handleToolCall(request);
    }

    if (request.method === 'tools/list') {
      if (!this.sessionPolicy) {
        return createErrorResponse(request.id, -32001, 'Tool session is not ready', { code: 'TOOL_NOT_ALLOWED' });
      }
      return createResponse(request.id, {
        tools: toolRegistry.getAll().filter(t => this.sessionPolicy!.allowedTools.has(t.name)).map(t => ({
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

    if (typeof name !== 'string' || name.length === 0 || name.length > 128) {
      return createErrorResponse(request.id, RPC_ERRORS.INVALID_PARAMS, 'Invalid tool name');
    }

    const tool = toolRegistry.get(name);
    if (!tool) {
      return createErrorResponse(request.id, RPC_ERRORS.METHOD_NOT_FOUND, `Tool not found: ${name}`);
    }

    try {
      logger.info({ tool: name }, 'Executing tool');
      const result = await toolExecutor.execute({
        name,
        arguments: args,
        requestId: request.id,
        policy: this.sessionPolicy!,
      });
      return createResponse(request.id, result);
    } catch (err: any) {
      logger.error({ tool: name, code: err instanceof ToolExecutionError ? err.toolCode : 'INTERNAL_ERROR' }, 'Tool execution failed');
      if (err instanceof ToolExecutionError) {
        return createErrorResponse(request.id, err.rpcCode, err.message, {
          code: err.toolCode,
          ...err.data,
        });
      }
      return createErrorResponse(
        request.id,
        RPC_ERRORS.INTERNAL_ERROR,
        'Internal error during tool execution'
      );
    }
  }
}

export const mcpRouter = new McpRouter();

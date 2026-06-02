import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mcpRouter } from './router.js';
import { toolRegistry } from '../tools/registry.js';
import { z } from 'zod';
import { createRequest } from './protocol.js';

describe('MCP Router', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should list tools', async () => {
    const req = createRequest('tools/list', {}, 1);
    const res = await mcpRouter.handleRequest(req);
    expect(res.result.tools).toBeDefined();
    expect(Array.isArray(res.result.tools)).toBe(true);
  });

  it('should call a registered tool', async () => {
    const mockHandler = vi.fn().mockResolvedValue({ success: true });
    toolRegistry.register({
      name: 'test_tool',
      description: 'A test tool',
      capability: 'read',
      timeoutMs: 1000,
      version: 'v1',
      schema: z.object({ arg1: z.string() }),
      handler: mockHandler,
    });

    const req = createRequest('tools/call', { name: 'test_tool', arguments: { arg1: 'hello' } }, 1);
    const res = await mcpRouter.handleRequest(req);

    expect(res.result).toEqual({ success: true });
    expect(mockHandler).toHaveBeenCalledWith({ arg1: 'hello' });
  });

  it('should return error for unknown tool', async () => {
    const req = createRequest('tools/call', { name: 'non_existent', arguments: {} }, 1);
    const res = await mcpRouter.handleRequest(req);

    expect(res.error).toBeDefined();
    expect(res.error?.code).toBe(-32601); // Method not found
  });

  it('includes tool metadata when listing tools', async () => {
    toolRegistry.register({
      name: 'metadata_tool',
      description: 'Exposes metadata',
      capability: 'write',
      timeoutMs: 2500,
      version: 'v2',
      deprecated: true,
      schema: z.object({
        name: z.string(),
        enabled: z.boolean().optional(),
      }),
      handler: vi.fn(),
    });

    const res = await mcpRouter.handleRequest(createRequest('tools/list', {}, 7));
    const tool = res.result.tools.find((entry: { name: string }) => entry.name === 'metadata_tool');

    expect(tool).toEqual({
      name: 'metadata_tool',
      description: 'Exposes metadata',
      capability: 'write',
      input_schema: {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        type: 'object',
        properties: {
          name: { type: 'string' },
          enabled: { type: 'boolean' },
        },
        required: ['name'],
        additionalProperties: false,
      },
      timeout_ms: 2500,
      version: 'v2',
      deprecated: true,
    });
  });

  it('returns invalid params when tool name is missing', async () => {
    const res = await mcpRouter.handleRequest(createRequest('tools/call', {}, 2));

    expect(res.error).toEqual({
      code: -32602,
      message: 'Missing tool name',
      data: undefined,
    });
  });

  it('returns invalid params details when tool arguments fail validation', async () => {
    toolRegistry.register({
      name: 'validated_tool',
      description: 'Requires a string argument',
      capability: 'read',
      timeoutMs: 1000,
      version: 'v1',
      schema: z.object({ arg1: z.string() }),
      handler: vi.fn(),
    });

    const res = await mcpRouter.handleRequest(
      createRequest('tools/call', { name: 'validated_tool', arguments: {} }, 3)
    );

    expect(res.error?.code).toBe(-32602);
    expect(res.error?.message).toBe('Invalid tool arguments');
    expect(res.error?.data.fieldErrors.arg1).toBeDefined();
  });

  it('returns internal errors when a tool throws', async () => {
    toolRegistry.register({
      name: 'failing_tool',
      description: 'Throws',
      capability: 'read',
      timeoutMs: 1000,
      version: 'v1',
      schema: z.object({}),
      handler: vi.fn().mockRejectedValue(new Error('tool exploded')),
    });

    const res = await mcpRouter.handleRequest(
      createRequest('tools/call', { name: 'failing_tool', arguments: {} }, 4)
    );

    expect(res.error).toEqual({
      code: -32603,
      message: 'tool exploded',
      data: undefined,
    });
  });

  it('returns method not found for unsupported rpc methods', async () => {
    const res = await mcpRouter.handleRequest(createRequest('unknown/method', {}, 5));

    expect(res.error).toEqual({
      code: -32601,
      message: 'Method not found: unknown/method',
      data: undefined,
    });
  });
});

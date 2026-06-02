import { describe, it, expect } from 'vitest';
import {
    createRequest,
    createResponse,
    JsonRpcRequestSchema,
    JsonRpcResponseSchema
} from './protocol.js';

describe('MCP Protocol', () => {
  it('should create a valid JSON-RPC request', () => {
    const req = createRequest('test/method', { foo: 'bar' }, 1);
    const result = JsonRpcRequestSchema.safeParse(req);
    expect(result.success).toBe(true);
    expect(req.method).toBe('test/method');
  });

  it('should create a valid JSON-RPC response', () => {
    const res = createResponse(1, { ok: true });
    const result = JsonRpcResponseSchema.safeParse(res);
    expect(result.success).toBe(true);
    expect(res.result.ok).toBe(true);
  });
});

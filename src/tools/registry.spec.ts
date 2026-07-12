import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { toolRegistry } from './registry.js';

describe('ToolRegistry', () => {
  it('rejects duplicate names without replacing the original handler', () => {
    toolRegistry.resetForTests();
    const original = vi.fn();
    toolRegistry.register({
      name: 'duplicate_tool',
      description: 'original',
      capability: 'read',
      timeoutMs: 1000,
      version: 'v1',
      schema: z.object({}).strict(),
      scopeResolver: () => ({ type: 'namespace-collection' }),
      handler: original,
    });

    expect(() => toolRegistry.register({
      name: 'duplicate_tool',
      description: 'replacement',
      capability: 'read',
      timeoutMs: 1000,
      version: 'v1',
      schema: z.object({}).strict(),
      scopeResolver: () => ({ type: 'namespace-collection' }),
      handler: vi.fn(),
    })).toThrow('Duplicate tool name: duplicate_tool');
    expect(toolRegistry.get('duplicate_tool')?.handler).toBe(original);
  });
});

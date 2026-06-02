import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('../../k8s/client.js', () => ({
  k8sClient: {
    core: {
      readNamespacedPod: vi.fn(),
      readNamespacedService: vi.fn(),
    },
    apps: {
      readNamespacedDeployment: vi.fn(),
    },
  },
}));

import { applyRemediationTool } from './apply_remediation.js';
import { toolRegistry } from '../registry.js';
import { z } from 'zod';
import { k8sClient } from '../../k8s/client.js';

describe('Remediation Orchestrator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Register a mock tool
    toolRegistry.register({
        name: 'mock_tool',
        description: 'mock',
        capability: 'read',
        timeoutMs: 1000,
        version: 'v1',
        schema: z.object({ foo: z.string() }),
        handler: vi.fn().mockResolvedValue({ ok: true })
    });
  });

  it('should execute multiple steps', async () => {
    const result = await applyRemediationTool.handler({
      steps: [
        { tool: 'mock_tool', arguments: { foo: 'bar' } },
        { tool: 'wait', arguments: { seconds: 0.1 } },
        { tool: 'mock_tool', arguments: { foo: 'baz' } },
      ]
    });

    expect(result.results).toHaveLength(3);
    expect(result.results[0].success).toBe(true);
    expect(result.results[2].success).toBe(true);
  });

  it('should stop on error if continueOnError is false', async () => {
    toolRegistry.register({
        name: 'failing_tool',
        description: 'fails',
        capability: 'read',
        timeoutMs: 1000,
        version: 'v1',
        schema: z.object({}),
        handler: vi.fn().mockRejectedValue(new Error('boom'))
    });

    const result = await applyRemediationTool.handler({
      steps: [
        { tool: 'failing_tool', arguments: {}, continueOnError: false },
        { tool: 'mock_tool', arguments: { foo: 'after' } },
      ]
    });

    expect(result.results).toHaveLength(1);
    expect(result.results[0].success).toBe(false);
  });

  it('skips a step when its pre-condition does not match the current resource', async () => {
    const mockHandler = vi.fn().mockResolvedValue({ ok: true });
    toolRegistry.register({
      name: 'guarded_tool',
      description: 'guarded',
      capability: 'read',
      timeoutMs: 1000,
      version: 'v1',
      schema: z.object({ foo: z.string(), kind: z.string(), name: z.string(), namespace: z.string() }),
      handler: mockHandler,
    });
    vi.mocked(k8sClient.apps.readNamespacedDeployment).mockResolvedValue({
      metadata: { uid: 'dep-uid' },
      spec: { replicas: 1 },
    } as never);

    const result = await applyRemediationTool.handler({
      steps: [
        {
          tool: 'guarded_tool',
          arguments: { foo: 'bar', kind: 'Deployment', name: 'api', namespace: 'default' },
          preCondition: { path: '$.spec.replicas', equals: 3 },
        },
      ],
    });

    expect(result.results).toEqual([
      { step: 0, tool: 'guarded_tool', skipped: true, reason: 'Pre-condition failed' },
    ]);
    expect(mockHandler).not.toHaveBeenCalled();
  });

  it('continues remediation after a failure when continueOnError is true', async () => {
    toolRegistry.register({
      name: 'failing_but_continued_tool',
      description: 'fails then continues',
      capability: 'read',
      timeoutMs: 1000,
      version: 'v1',
      schema: z.object({}),
      handler: vi.fn().mockRejectedValue(new Error('boom')),
    });

    const result = await applyRemediationTool.handler({
      steps: [
        { tool: 'failing_but_continued_tool', arguments: {}, continueOnError: true },
        { tool: 'mock_tool', arguments: { foo: 'after' } },
      ],
    });

    expect(result.results).toHaveLength(2);
    expect(result.results[0]).toMatchObject({ success: false, error: 'boom' });
    expect(result.results[1]).toMatchObject({ success: true });
  });

  it('fails fast when the target resource uid no longer matches', async () => {
    const mockHandler = vi.fn().mockResolvedValue({ ok: true });
    toolRegistry.register({
      name: 'uid_guarded_tool',
      description: 'uid guarded',
      capability: 'read',
      timeoutMs: 1000,
      version: 'v1',
      schema: z.object({ foo: z.string(), kind: z.string(), name: z.string(), namespace: z.string() }),
      handler: mockHandler,
    });
    vi.mocked(k8sClient.apps.readNamespacedDeployment).mockResolvedValue({
      metadata: { uid: 'new-uid' },
    } as never);

    const result = await applyRemediationTool.handler({
      targetResourceUID: 'expected-uid',
      steps: [
        {
          tool: 'uid_guarded_tool',
          arguments: { foo: 'bar', kind: 'Deployment', name: 'api', namespace: 'default' },
        },
      ],
    });

    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toMatchObject({
      step: 0,
      tool: 'uid_guarded_tool',
      success: false,
      error: 'Target resource UID mismatch. Expected expected-uid, got new-uid',
    });
    expect(mockHandler).not.toHaveBeenCalled();
  });
});

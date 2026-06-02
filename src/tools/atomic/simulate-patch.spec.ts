import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../k8s/client.js', () => ({
  k8sClient: {
    core: {
      readNamespacedPod: vi.fn(),
      readNamespacedService: vi.fn(),
    },
    apps: {
      readNamespacedDeployment: vi.fn(),
    },
    autoscaling: {
      readNamespacedHorizontalPodAutoscaler: vi.fn(),
    },
  },
}));

import { k8sClient } from '../../k8s/client.js';
import { simulatePatchTool } from './simulate-patch.js';

describe('simulatePatchTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects yaml that does not contain a kubernetes resource shape', async () => {
    await expect(
      simulatePatchTool.handler({
        resourceYaml: 'metadata:\n  name: missing-kind',
      })
    ).rejects.toThrow('Invalid resource YAML');
  });

  it('returns a create diff when the resource does not exist yet', async () => {
    vi.mocked(k8sClient.apps.readNamespacedDeployment).mockRejectedValue(new Error('not found'));

    await expect(
      simulatePatchTool.handler({
        resourceYaml: [
          'apiVersion: apps/v1',
          'kind: Deployment',
          'metadata:',
          '  name: api',
          '  namespace: default',
          'spec:',
          '  replicas: 2',
        ].join('\n'),
      })
    ).resolves.toEqual({
      op: 'create',
      diff: [
        {
          op: 'add',
          path: '/',
          value: {
            apiVersion: 'apps/v1',
            kind: 'Deployment',
            metadata: { name: 'api', namespace: 'default' },
            spec: { replicas: 2 },
          },
        },
      ],
    });
  });

  it('returns a patch diff and current uid for an existing resource', async () => {
    vi.mocked(k8sClient.core.readNamespacedService).mockResolvedValue({
      metadata: { uid: 'svc-uid', name: 'api', namespace: 'default' },
      spec: { type: 'ClusterIP' },
    } as never);

    const result = await simulatePatchTool.handler({
      resourceYaml: [
        'apiVersion: v1',
        'kind: Service',
        'metadata:',
        '  name: api',
        '  namespace: default',
        'spec:',
        '  type: NodePort',
      ].join('\n'),
    });

    expect(result.op).toBe('patch');
    expect(result.currentUid).toBe('svc-uid');
    expect(result.diff).toContainEqual({
      op: 'replace',
      path: '/spec/type',
      value: 'NodePort',
    });
  });
});

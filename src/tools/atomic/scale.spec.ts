import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../k8s/client.js', () => ({
  k8sClient: {
    apps: {
      patchNamespacedDeploymentScale: vi.fn(),
      readNamespacedDeployment: vi.fn(),
      patchNamespacedDeployment: vi.fn(),
      patchNamespacedStatefulSetScale: vi.fn(),
      readNamespacedStatefulSet: vi.fn(),
      patchNamespacedStatefulSet: vi.fn(),
    },
  },
}));

import { config } from '../../config.js';
import { k8sClient } from '../../k8s/client.js';
import { scaleWorkloadTool } from './scale.js';

describe('scaleWorkloadTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    config.ACORNOPS_AGENT_WRITE_ENABLED = false;
  });

  it('fails when write operations are disabled', async () => {
    await expect(
      scaleWorkloadTool.handler({
        kind: 'Deployment',
        name: 'api',
        namespace: 'default',
        replicas: 3,
        reason: 'manual scale',
      })
    ).rejects.toThrow('Write operations are disabled');
  });

  it('scales deployments and records merge-safe annotations', async () => {
    config.ACORNOPS_AGENT_WRITE_ENABLED = true;
    vi.mocked(k8sClient.apps.readNamespacedDeployment).mockResolvedValue({
      metadata: { annotations: { existing: 'annotation' } },
    } as never);
    vi.mocked(k8sClient.apps.patchNamespacedDeployment).mockResolvedValue({
      metadata: { name: 'api' },
    } as never);

    await expect(
      scaleWorkloadTool.handler({
        kind: 'Deployment',
        name: 'api',
        namespace: 'default',
        replicas: 5,
        reason: 'manual scale',
      })
    ).resolves.toEqual({
      success: true,
      resource: { metadata: { name: 'api' } },
    });

    expect(k8sClient.apps.patchNamespacedDeploymentScale).toHaveBeenCalledWith({
      name: 'api',
      namespace: 'default',
      body: [{ op: 'add', path: '/spec/replicas', value: 5 }],
    });
    expect(k8sClient.apps.patchNamespacedDeployment).toHaveBeenCalledWith({
      name: 'api',
      namespace: 'default',
      body: [
        {
          op: 'add',
          path: '/metadata/annotations',
          value: expect.objectContaining({
            existing: 'annotation',
            'acornops.dev/reason': 'manual scale',
            'acornops.dev/applied-by': 'cluster-cluster-1',
          }),
        },
      ],
    });
  });

  it('scales statefulsets through the statefulset scale endpoint', async () => {
    config.ACORNOPS_AGENT_WRITE_ENABLED = true;
    vi.mocked(k8sClient.apps.readNamespacedStatefulSet).mockResolvedValue({
      metadata: { annotations: {} },
    } as never);
    vi.mocked(k8sClient.apps.patchNamespacedStatefulSet).mockResolvedValue({
      metadata: { name: 'db' },
    } as never);

    await scaleWorkloadTool.handler({
      kind: 'StatefulSet',
      name: 'db',
      namespace: 'data',
      replicas: 2,
      reason: 'right size',
    });

    expect(k8sClient.apps.patchNamespacedStatefulSetScale).toHaveBeenCalledWith({
      name: 'db',
      namespace: 'data',
      body: [{ op: 'add', path: '/spec/replicas', value: 2 }],
    });
    expect(k8sClient.apps.patchNamespacedStatefulSet).toHaveBeenCalledWith({
      name: 'db',
      namespace: 'data',
      body: [
        {
          op: 'add',
          path: '/metadata/annotations',
          value: expect.objectContaining({
            'acornops.dev/reason': 'right size',
          }),
        },
      ],
    });
  });
});

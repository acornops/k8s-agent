import { beforeEach, describe, expect, it, vi } from 'vitest';
import { restartWorkloadTool } from './restart-workload.js';
import { k8sClient } from '../../k8s/client.js';
import { config } from '../../config.js';

vi.mock('../../k8s/client.js', () => ({
  k8sClient: {
    apps: {
      readNamespacedDeployment: vi.fn(),
      readNamespacedStatefulSet: vi.fn(),
      readNamespacedDaemonSet: vi.fn(),
      patchNamespacedDeployment: vi.fn(),
      patchNamespacedStatefulSet: vi.fn(),
      patchNamespacedDaemonSet: vi.fn(),
    }
  }
}));

describe('Restart Workload Tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    config.ACORNOPS_AGENT_WRITE_ENABLED = false;
  });

  it('should fail if write is not enabled', async () => {
    config.ACORNOPS_AGENT_WRITE_ENABLED = false;
    await expect(
      restartWorkloadTool.handler({
        kind: 'Deployment',
        name: 'test',
        namespace: 'default',
        reason: 'testing'
      })
    ).rejects.toThrow('Write operations are disabled');
  });

  it('should call deployment patch if write is enabled', async () => {
    config.ACORNOPS_AGENT_WRITE_ENABLED = true;
    (k8sClient.apps.readNamespacedDeployment as any).mockResolvedValue({
      spec: { template: { metadata: { annotations: { existing: 'annotation' } } } }
    });
    (k8sClient.apps.patchNamespacedDeployment as any).mockResolvedValue({ metadata: { name: 'test' } });

    const result = await restartWorkloadTool.handler({
      kind: 'Deployment',
      name: 'test',
      namespace: 'default',
      reason: 'testing'
    });

    expect(result.success).toBe(true);
    expect(k8sClient.apps.patchNamespacedDeployment).toHaveBeenCalledWith({
      name: 'test',
      namespace: 'default',
      body: [
        {
          op: 'add',
          path: '/spec/template/metadata/annotations',
          value: expect.objectContaining({
            existing: 'annotation',
            'acornops.dev/reason': 'testing',
            'acornops.dev/applied-by': 'cluster-cluster-1',
            'kubectl.kubernetes.io/restartedAt': expect.any(String),
          }),
        },
      ],
    });
  });

  it.each([
    [
    'StatefulSet',
    'readNamespacedStatefulSet',
    'patchNamespacedStatefulSet',
    'db',
    ],
    [
    'DaemonSet',
    'readNamespacedDaemonSet',
    'patchNamespacedDaemonSet',
    'agent',
    ],
  ])('creates template metadata when restarting a %s without annotations', async (kind, readMethod, patchMethod, name) => {
    config.ACORNOPS_AGENT_WRITE_ENABLED = true;
    (k8sClient.apps[readMethod as 'readNamespacedStatefulSet'] as any).mockResolvedValue({
    spec: { template: {} },
    });
    (k8sClient.apps[patchMethod as 'patchNamespacedStatefulSet'] as any).mockResolvedValue({ metadata: { name } });

    const result = await restartWorkloadTool.handler({
    kind: kind as 'StatefulSet',
    name,
    namespace: 'default',
    reason: 'testing',
    });

    expect(result).toEqual({ success: true, resource: { metadata: { name } } });
    expect(k8sClient.apps[patchMethod as 'patchNamespacedStatefulSet']).toHaveBeenCalledWith({
    name,
    namespace: 'default',
    body: [
      {
        op: 'add',
        path: '/spec/template/metadata',
        value: {
          annotations: expect.objectContaining({
            'acornops.dev/reason': 'testing',
            'acornops.dev/applied-by': 'cluster-cluster-1',
            'kubectl.kubernetes.io/restartedAt': expect.any(String),
          }),
        },
      },
    ],
    });
  });
});

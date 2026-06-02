import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../k8s/client.js', () => ({
  k8sClient: {
    core: {
      listNamespacedPod: vi.fn(),
      listPodForAllNamespaces: vi.fn(),
      listNamespacedService: vi.fn(),
      listServiceForAllNamespaces: vi.fn(),
      listNamespace: vi.fn(),
      listNode: vi.fn(),
      listNamespacedEvent: vi.fn(),
      listEventForAllNamespaces: vi.fn(),
    },
    apps: {
      listNamespacedDeployment: vi.fn(),
      listDeploymentForAllNamespaces: vi.fn(),
      listNamespacedStatefulSet: vi.fn(),
      listStatefulSetForAllNamespaces: vi.fn(),
      listNamespacedDaemonSet: vi.fn(),
      listDaemonSetForAllNamespaces: vi.fn(),
    },
    batch: {
      listNamespacedCronJob: vi.fn(),
      listCronJobForAllNamespaces: vi.fn(),
      listNamespacedJob: vi.fn(),
      listJobForAllNamespaces: vi.fn(),
    },
  },
}));

import { k8sClient } from '../../k8s/client.js';
import { listResourcesTool } from './list-resources.js';

describe('listResourcesTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists namespaced pods and returns summarized pod data', async () => {
    vi.mocked(k8sClient.core.listNamespacedPod).mockResolvedValue({
      metadata: { _continue: 'next-page' },
      items: [
        {
          metadata: {
            name: 'api-0',
            namespace: 'default',
            uid: 'pod-uid',
            creationTimestamp: '2024-01-01T00:00:00Z',
          },
          spec: { nodeName: 'worker-a' },
          status: {
            phase: 'Running',
            containerStatuses: [{ restartCount: 1 }, { restartCount: 2 }],
          },
        },
      ],
    } as never);

    await expect(
      listResourcesTool.handler({
        kind: 'Pod',
        namespace: 'default',
        label_selector: 'app=api',
        field_selector: 'status.phase=Running',
        limit: 50,
        continue_token: 'cursor-1',
      })
    ).resolves.toEqual({
      kind: 'Pod',
      namespace: 'default',
      total: 1,
      continue_token: 'next-page',
      items: [
        {
          name: 'api-0',
          namespace: 'default',
          uid: 'pod-uid',
          createdAt: '2024-01-01T00:00:00Z',
          phase: 'Running',
          nodeName: 'worker-a',
          restartCount: 3,
        },
      ],
    });

    expect(k8sClient.core.listNamespacedPod).toHaveBeenCalledWith({
      namespace: 'default',
      labelSelector: 'app=api',
      fieldSelector: 'status.phase=Running',
      limit: 50,
      _continue: 'cursor-1',
    });
  });

  it('lists deployments across all namespaces and summarizes replica status', async () => {
    vi.mocked(k8sClient.apps.listDeploymentForAllNamespaces).mockResolvedValue({
      metadata: {},
      items: [
        {
          metadata: {
            name: 'api',
            namespace: 'prod',
            uid: 'deploy-uid',
            creationTimestamp: '2024-01-02T00:00:00Z',
          },
          spec: { replicas: 3 },
          status: { readyReplicas: 2, availableReplicas: 2 },
        },
      ],
    } as never);

    await expect(
      listResourcesTool.handler({
        kind: 'Deployment',
        limit: 100,
      })
    ).resolves.toEqual({
      kind: 'Deployment',
      namespace: '*',
      total: 1,
      continue_token: '',
      items: [
        {
          name: 'api',
          namespace: 'prod',
          uid: 'deploy-uid',
          createdAt: '2024-01-02T00:00:00Z',
          replicas: 3,
          readyReplicas: 2,
          availableReplicas: 2,
        },
      ],
    });

    expect(k8sClient.apps.listDeploymentForAllNamespaces).toHaveBeenCalledWith({
      labelSelector: undefined,
      fieldSelector: undefined,
      limit: 100,
      _continue: undefined,
    });
  });

  it('lists cronjobs in a namespace and summarizes schedule activity', async () => {
    vi.mocked(k8sClient.batch.listNamespacedCronJob).mockResolvedValue({
      metadata: {},
      items: [
        {
          metadata: { name: 'nightly', namespace: 'ops', uid: 'cron-uid' },
          spec: { schedule: '0 0 * * *', suspend: true },
          status: {
            active: [{ name: 'nightly-123' }],
            lastScheduleTime: '2024-01-03T00:00:00Z',
          },
        },
      ],
    } as never);

    await expect(
      listResourcesTool.handler({
        kind: 'CronJob',
        namespace: 'ops',
        limit: 25,
      })
    ).resolves.toEqual({
      kind: 'CronJob',
      namespace: 'ops',
      total: 1,
      continue_token: '',
      items: [
        {
          name: 'nightly',
          namespace: 'ops',
          uid: 'cron-uid',
          createdAt: undefined,
          schedule: '0 0 * * *',
          suspend: true,
          active: 1,
          lastScheduleTime: '2024-01-03T00:00:00Z',
        },
      ],
    });
  });

  it('lists jobs across all namespaces and summarizes completion state', async () => {
    vi.mocked(k8sClient.batch.listJobForAllNamespaces).mockResolvedValue({
      metadata: {},
      items: [
        {
          metadata: { name: 'migration', namespace: 'ops', uid: 'job-uid' },
          spec: { completions: 2 },
          status: {
            succeeded: 1,
            failed: 0,
            active: 1,
            startTime: '2024-01-03T00:00:00Z',
            completionTime: '2024-01-03T00:01:00Z',
          },
        },
      ],
    } as never);

    await expect(listResourcesTool.handler({ kind: 'Job', limit: 100 })).resolves.toEqual({
      kind: 'Job',
      namespace: '*',
      total: 1,
      continue_token: '',
      items: [
        {
          name: 'migration',
          namespace: 'ops',
          uid: 'job-uid',
          createdAt: undefined,
          completions: 2,
          succeeded: 1,
          failed: 0,
          active: 1,
          startTime: '2024-01-03T00:00:00Z',
          completionTime: '2024-01-03T00:01:00Z',
        },
      ],
    });
  });

  it('lists services in a namespace and summarizes network fields', async () => {
    vi.mocked(k8sClient.core.listNamespacedService).mockResolvedValue({
      metadata: {},
      items: [
        {
          metadata: { name: 'api', namespace: 'default', uid: 'svc-uid' },
          spec: { type: 'LoadBalancer', clusterIP: '10.0.0.10' },
        },
      ],
    } as never);

    await expect(
      listResourcesTool.handler({
        kind: 'Service',
        namespace: 'default',
        limit: 10,
      })
    ).resolves.toEqual({
      kind: 'Service',
      namespace: 'default',
      total: 1,
      continue_token: '',
      items: [
        {
          name: 'api',
          namespace: 'default',
          uid: 'svc-uid',
          createdAt: undefined,
          type: 'LoadBalancer',
          clusterIP: '10.0.0.10',
        },
      ],
    });
  });

  it('lists namespaces through the cluster-scoped namespace api', async () => {
    vi.mocked(k8sClient.core.listNamespace).mockResolvedValue({
      metadata: {},
      items: [
        {
          metadata: { name: 'default', uid: 'ns-uid', creationTimestamp: '2024-01-01T00:00:00Z' },
        },
      ],
    } as never);

    await expect(listResourcesTool.handler({ kind: 'Namespace', limit: 100 })).resolves.toEqual({
      kind: 'Namespace',
      namespace: '*',
      total: 1,
      continue_token: '',
      items: [
        {
          name: 'default',
          namespace: undefined,
          uid: 'ns-uid',
          createdAt: '2024-01-01T00:00:00Z',
        },
      ],
    });
  });

  it('lists nodes through the cluster-scoped node api', async () => {
    vi.mocked(k8sClient.core.listNode).mockResolvedValue({
      metadata: {},
      items: [
        {
          metadata: { name: 'worker-a', uid: 'node-uid' },
          status: { phase: 'Ready' },
        },
      ],
    } as never);

    await expect(listResourcesTool.handler({ kind: 'Node', limit: 100 })).resolves.toEqual({
      kind: 'Node',
      namespace: '*',
      total: 1,
      continue_token: '',
      items: [
        {
          name: 'worker-a',
          namespace: undefined,
          uid: 'node-uid',
          createdAt: undefined,
          phase: 'Ready',
        },
      ],
    });
  });

  it('lists events across all namespaces and summarizes reason and message', async () => {
    vi.mocked(k8sClient.core.listEventForAllNamespaces).mockResolvedValue({
      metadata: {},
      items: [
        {
          metadata: { name: 'pod.123', namespace: 'default', uid: 'event-uid' },
          reason: 'BackOff',
          type: 'Warning',
          message: 'Back-off restarting failed container',
        },
      ],
    } as never);

    await expect(listResourcesTool.handler({ kind: 'Event', limit: 100 })).resolves.toEqual({
      kind: 'Event',
      namespace: '*',
      total: 1,
      continue_token: '',
      items: [
        {
          name: 'pod.123',
          namespace: 'default',
          uid: 'event-uid',
          createdAt: undefined,
          reason: 'BackOff',
          type: 'Warning',
          message: 'Back-off restarting failed container',
        },
      ],
    });
  });
});

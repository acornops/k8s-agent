import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ResourceCollector } from './resource-collector.js';
import { EventCollector } from './event-collector.js';
import { MetricsCollector } from './metrics-collector.js';
import { k8sClient } from '../../k8s/client.js';
import { DEFAULT_EXCLUDED_NAMESPACES } from '../../config.js';

vi.mock('../../k8s/client.js', () => ({
  k8sClient: {
    core: {
      listPodForAllNamespaces: vi.fn(),
      listServiceForAllNamespaces: vi.fn(),
      listPersistentVolumeClaimForAllNamespaces: vi.fn(),
      listNode: vi.fn(),
      listNamespace: vi.fn(),
      listEventForAllNamespaces: vi.fn(),
    },
    apps: {
      listDeploymentForAllNamespaces: vi.fn(),
      listStatefulSetForAllNamespaces: vi.fn(),
      listDaemonSetForAllNamespaces: vi.fn(),
    },
    batch: {
      listCronJobForAllNamespaces: vi.fn(),
      listJobForAllNamespaces: vi.fn(),
    },
    networking: {
      listIngressForAllNamespaces: vi.fn(),
    },
    customObjects: {
      listClusterCustomObject: vi.fn(),
    }
  }
}));

describe('Namespace Exclusion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should have DEFAULT_EXCLUDED_NAMESPACES defined', () => {
    expect(DEFAULT_EXCLUDED_NAMESPACES).toContain('kube-node-lease');
    expect(DEFAULT_EXCLUDED_NAMESPACES).toContain('kube-public');
  });

  it('should exclude kube-public and kube-node-lease from ResourceCollector', async () => {
    const mockPods = {
      items: [
        { metadata: { name: 'pod-default', namespace: 'default' } },
        { metadata: { name: 'pod-public', namespace: 'kube-public' } },
        { metadata: { name: 'pod-lease', namespace: 'kube-node-lease' } },
        { metadata: { name: 'pod-system', namespace: 'kube-system' } },
      ]
    };
    const mockDeps = {
      items: [
        { metadata: { name: 'dep-default', namespace: 'default' } },
        { metadata: { name: 'dep-public', namespace: 'kube-public' } },
      ]
    };
    const mockStatefulSets = {
      items: [
        { metadata: { name: 'sts-default', namespace: 'default' } },
        { metadata: { name: 'sts-public', namespace: 'kube-public' } },
      ]
    };
    const mockDaemonSets = {
      items: [
        { metadata: { name: 'ds-default', namespace: 'default' } },
        { metadata: { name: 'ds-lease', namespace: 'kube-node-lease' } },
      ]
    };
    const mockCronJobs = {
      items: [
        { metadata: { name: 'cron-default', namespace: 'default' } },
        { metadata: { name: 'cron-public', namespace: 'kube-public' } },
      ]
    };
    const mockJobs = {
      items: [
        { metadata: { name: 'job-default', namespace: 'default' } },
        { metadata: { name: 'job-lease', namespace: 'kube-node-lease' } },
      ]
    };
    const mockSvc = {
      items: [
        { metadata: { name: 'svc-default', namespace: 'default' } },
        { metadata: { name: 'svc-lease', namespace: 'kube-node-lease' } },
      ]
    };
    const mockIngress = {
      items: [
        { metadata: { name: 'ing-default', namespace: 'default' } },
        { metadata: { name: 'ing-public', namespace: 'kube-public' } },
      ]
    };
    const mockPVC = {
      items: [
        { metadata: { name: 'pvc-default', namespace: 'default' } },
        { metadata: { name: 'pvc-lease', namespace: 'kube-node-lease' } },
      ]
    };
    const mockNamespaces = {
      items: [
        { metadata: { name: 'default' } },
        { metadata: { name: 'kube-public' } },
        { metadata: { name: 'kube-node-lease' } },
        { metadata: { name: 'kube-system' } },
      ]
    };

    (k8sClient.core.listPodForAllNamespaces as any).mockResolvedValue(mockPods);
    (k8sClient.apps.listDeploymentForAllNamespaces as any).mockResolvedValue(mockDeps);
    (k8sClient.apps.listStatefulSetForAllNamespaces as any).mockResolvedValue(mockStatefulSets);
    (k8sClient.apps.listDaemonSetForAllNamespaces as any).mockResolvedValue(mockDaemonSets);
    (k8sClient.batch.listCronJobForAllNamespaces as any).mockResolvedValue(mockCronJobs);
    (k8sClient.batch.listJobForAllNamespaces as any).mockResolvedValue(mockJobs);
    (k8sClient.core.listServiceForAllNamespaces as any).mockResolvedValue(mockSvc);
    (k8sClient.networking.listIngressForAllNamespaces as any).mockResolvedValue(mockIngress);
    (k8sClient.core.listPersistentVolumeClaimForAllNamespaces as any).mockResolvedValue(mockPVC);
    (k8sClient.core.listNode as any).mockResolvedValue({ items: [] });
    (k8sClient.core.listNamespace as any).mockResolvedValue(mockNamespaces);

    const collector = new ResourceCollector();
    const result = await collector.collect();

    expect(result.pods.map((p: any) => p.namespace)).toEqual(['default', 'kube-system']);
    expect(result.deployments.map((d: any) => d.namespace)).toEqual(['default']);
    expect(result.statefulSets.map((s: any) => s.namespace)).toEqual(['default']);
    expect(result.daemonSets.map((d: any) => d.namespace)).toEqual(['default']);
    expect(result.cronJobs.map((c: any) => c.namespace)).toEqual(['default']);
    expect(result.jobs.map((j: any) => j.namespace)).toEqual(['default']);
    expect(result.services.map((s: any) => s.namespace)).toEqual(['default']);
    expect(result.ingresses.map((i: any) => i.namespace)).toEqual(['default']);
    expect(result.pvcs.map((pvc: any) => pvc.namespace)).toEqual(['default']);
    expect(result.namespaces.map((namespace: any) => namespace.name)).toEqual(['default', 'kube-system']);
  });

  it('should exclude kube-public and kube-node-lease from EventCollector', async () => {
    const mockEvents = {
      items: [
        { metadata: { namespace: 'default' }, involvedObject: { namespace: 'default' }, message: 'default event', lastTimestamp: new Date().toISOString() },
        { metadata: { namespace: 'kube-public' }, involvedObject: { namespace: 'kube-public' }, message: 'public event', lastTimestamp: new Date().toISOString() },
        { metadata: { namespace: 'kube-node-lease' }, involvedObject: { namespace: 'kube-node-lease' }, message: 'lease event', lastTimestamp: new Date().toISOString() },
        { metadata: { namespace: 'kube-system' }, involvedObject: { namespace: 'kube-system' }, message: 'system event', lastTimestamp: new Date().toISOString() },
      ]
    };

    (k8sClient.core.listEventForAllNamespaces as any).mockResolvedValue(mockEvents);

    const collector = new EventCollector();
    const result = await collector.collect();

    expect(result.map((e: any) => e.involvedObject.namespace)).toEqual(['default', 'kube-system']);
  });

  it('should exclude kube-public and kube-node-lease from MetricsCollector', async () => {
    // Mock checkMetricsApi to return true
    (k8sClient.customObjects.listClusterCustomObject as any).mockResolvedValue({ items: [] });

    // Mock the metrics API response
    (k8sClient.customObjects.listClusterCustomObject as any).mockImplementation(({ plural }: { plural: string }) => {
        if (plural === 'pods') {
            return Promise.resolve({
                items: [
                    { metadata: { name: 'pod-default', namespace: 'default' }, containers: [] },
                    { metadata: { name: 'pod-public', namespace: 'kube-public' }, containers: [] },
                    { metadata: { name: 'pod-system', namespace: 'kube-system' }, containers: [] },
                ]
            });
        }
        return Promise.resolve({ items: [] });
    });

    const collector = new MetricsCollector();
    const result = await collector.collect();

    expect(result.pods.map((p: any) => p.namespace)).toEqual(['default', 'kube-system']);
  });
});

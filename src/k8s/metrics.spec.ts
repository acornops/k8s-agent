import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./client.js', () => ({
  k8sClient: {
    customObjects: {
      listClusterCustomObject: vi.fn(),
      listNamespacedCustomObject: vi.fn(),
    },
  },
}));

import { k8sClient } from './client.js';
import {
  __resetMetricsApiProbeCacheForTest,
  checkMetricsApi,
  getNodeMetrics,
  getPodMetrics,
} from './metrics.js';

describe('metrics helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetMetricsApiProbeCacheForTest();
  });

  it('checks metrics api availability with a bounded probe', async () => {
    (k8sClient.customObjects.listClusterCustomObject as any).mockResolvedValue({ items: [] });
    await expect(checkMetricsApi()).resolves.toBe(true);

    expect(k8sClient.customObjects.listClusterCustomObject).toHaveBeenCalledWith({
      group: 'metrics.k8s.io',
      version: 'v1beta1',
      plural: 'pods',
      limit: 1,
    });
  });

  it('reports false when the metrics api probe fails', async () => {
    (k8sClient.customObjects.listClusterCustomObject as any).mockRejectedValue(new Error('missing'));
    await expect(checkMetricsApi()).resolves.toBe(false);
  });

  it('caches successful and failed metrics api probe results', async () => {
    (k8sClient.customObjects.listClusterCustomObject as any).mockResolvedValueOnce({ items: [] });
    await expect(checkMetricsApi()).resolves.toBe(true);
    await expect(checkMetricsApi()).resolves.toBe(true);
    expect(k8sClient.customObjects.listClusterCustomObject).toHaveBeenCalledTimes(1);

    __resetMetricsApiProbeCacheForTest();
    vi.clearAllMocks();

    (k8sClient.customObjects.listClusterCustomObject as any).mockRejectedValueOnce(new Error('missing'));
    await expect(checkMetricsApi()).resolves.toBe(false);
    await expect(checkMetricsApi()).resolves.toBe(false);
    expect(k8sClient.customObjects.listClusterCustomObject).toHaveBeenCalledTimes(1);
  });

  it('deduplicates concurrent metrics api probes', async () => {
    let resolveProbe: (value: unknown) => void = () => {};
    const probe = new Promise((resolve) => {
      resolveProbe = resolve;
    });
    (k8sClient.customObjects.listClusterCustomObject as any).mockReturnValue(probe);

    const first = checkMetricsApi();
    const second = checkMetricsApi();

    await vi.waitFor(() => {
      expect(k8sClient.customObjects.listClusterCustomObject).toHaveBeenCalledTimes(1);
    });
    expect(k8sClient.customObjects.listClusterCustomObject).toHaveBeenCalledTimes(1);
    resolveProbe({ items: [] });

    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
  });

  it('filters excluded namespaces from cluster-wide pod metrics', async () => {
    (k8sClient.customObjects.listClusterCustomObject as any).mockResolvedValue({
      items: [
        {
          metadata: { name: 'api', namespace: 'default' },
          containers: [{ name: 'app', usage: { cpu: '10m', memory: '32Mi' } }],
        },
        {
          metadata: { name: 'lease', namespace: 'kube-node-lease' },
          containers: [{ name: 'system', usage: { cpu: '1m', memory: '1Mi' } }],
        },
      ],
    });

    await expect(getPodMetrics()).resolves.toEqual([
      {
        name: 'api',
        namespace: 'default',
        containers: [{ name: 'app', usage: { cpu: '10m', memory: '32Mi' } }],
      },
    ]);
  });

  it('uses the namespaced metrics endpoint without cluster-wide filtering', async () => {
    (k8sClient.customObjects.listNamespacedCustomObject as any).mockResolvedValue({
      items: [
        {
          metadata: { name: 'public-app', namespace: 'kube-public' },
          containers: [{ name: 'app', usage: { cpu: '5m', memory: '8Mi' } }],
        },
      ],
    });

    await expect(getPodMetrics('kube-public')).resolves.toEqual([
      {
        name: 'public-app',
        namespace: 'kube-public',
        containers: [{ name: 'app', usage: { cpu: '5m', memory: '8Mi' } }],
      },
    ]);
    expect(k8sClient.customObjects.listNamespacedCustomObject).toHaveBeenCalledWith({
      group: 'metrics.k8s.io',
      version: 'v1beta1',
      namespace: 'kube-public',
      plural: 'pods',
      limit: 500,
      _continue: undefined,
    });
  });

  it('maps node metrics and returns an empty list when the api call fails', async () => {
    (k8sClient.customObjects.listClusterCustomObject as any).mockResolvedValue({
      items: [{ metadata: { name: 'node-1' }, usage: { cpu: '250m', memory: '1Gi' } }],
    });

    await expect(getNodeMetrics()).resolves.toEqual([
      { name: 'node-1', usage: { cpu: '250m', memory: '1Gi' } },
    ]);

    (k8sClient.customObjects.listClusterCustomObject as any).mockRejectedValue(new Error('boom'));
    await expect(getNodeMetrics()).resolves.toEqual([]);
  });
});

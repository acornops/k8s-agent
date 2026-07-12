import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../k8s/metrics.js', () => ({
  checkMetricsApi: vi.fn(),
  getPodMetrics: vi.fn(),
  getNodeMetrics: vi.fn(),
}));

vi.mock('../../runtime/namespace-scope.js', () => ({
  getWatchNamespaces: vi.fn(),
  isNamespaceAllowed: vi.fn(() => true),
}));

vi.mock('../../config.js', () => ({
  config: {
    ACORNOPS_AGENT_LOCAL_FALLBACK_ENABLED: false,
  },
}));

vi.mock('node:os', () => ({
  default: {
    loadavg: vi.fn(),
    totalmem: vi.fn(),
    freemem: vi.fn(),
    hostname: vi.fn(),
  },
}));

import os from 'node:os';
import { config } from '../../config.js';
import { checkMetricsApi, getNodeMetrics, getPodMetrics } from '../../k8s/metrics.js';
import { getWatchNamespaces } from '../../runtime/namespace-scope.js';
import { MetricsCollector } from './metrics-collector.js';

describe('MetricsCollector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    config.ACORNOPS_AGENT_LOCAL_FALLBACK_ENABLED = false;
    vi.mocked(getWatchNamespaces).mockReturnValue(undefined);
  });

  it('returns an unavailable payload when the metrics api is missing and fallback is disabled', async () => {
    vi.mocked(checkMetricsApi).mockResolvedValue(false);

    await expect(new MetricsCollector().collect()).resolves.toEqual({
      available: false,
      pods: [],
      nodes: [],
    });
  });

  it('uses local host metrics when fallback mode is enabled', async () => {
    vi.mocked(checkMetricsApi).mockResolvedValue(false);
    config.ACORNOPS_AGENT_LOCAL_FALLBACK_ENABLED = true;
    vi.mocked(os.loadavg).mockReturnValue([0, 0, 0]);
    vi.mocked(os.totalmem).mockReturnValue(512 * 1024 * 1024);
    vi.mocked(os.freemem).mockReturnValue(212 * 1024 * 1024);
    vi.mocked(os.hostname).mockReturnValue('local-node');

    await expect(new MetricsCollector().collect()).resolves.toEqual({
      available: false,
      source: 'local-fallback',
      pods: [],
      nodes: [
        {
          name: 'local-node',
          usage: {
            cpu: '100m',
            memory: '300Mi',
          },
        },
      ],
    });
  });

  it('collects metrics for each watched namespace when the api is available', async () => {
    vi.mocked(checkMetricsApi).mockResolvedValue(true);
    vi.mocked(getWatchNamespaces).mockReturnValue(['default', 'payments']);
    vi.mocked(getPodMetrics).mockImplementation(async (namespace?: string) => [
      {
        name: `${namespace}-pod`,
        namespace: namespace!,
        containers: [],
      },
    ]);
    vi.mocked(getNodeMetrics).mockResolvedValue([
      { name: 'node-1', usage: { cpu: '250m', memory: '1Gi' } },
    ]);

    await expect(new MetricsCollector().collect()).resolves.toEqual({
      available: true,
      pods: [
        { name: 'default-pod', namespace: 'default', containers: [] },
        { name: 'payments-pod', namespace: 'payments', containers: [] },
      ],
      nodes: [{ name: 'node-1', usage: { cpu: '250m', memory: '1Gi' } }],
    });

    expect(getPodMetrics).toHaveBeenNthCalledWith(1, 'default');
    expect(getPodMetrics).toHaveBeenNthCalledWith(2, 'payments');
  });

  it('falls back to cluster-wide pod metrics when no watch namespaces are configured', async () => {
    vi.mocked(checkMetricsApi).mockResolvedValue(true);
    vi.mocked(getPodMetrics).mockResolvedValue([
      { name: 'api', namespace: 'default', containers: [] },
    ]);
    vi.mocked(getNodeMetrics).mockResolvedValue([]);

    await expect(new MetricsCollector().collect()).resolves.toEqual({
      available: true,
      pods: [{ name: 'api', namespace: 'default', containers: [] }],
      nodes: [],
    });

    expect(getPodMetrics).toHaveBeenCalledWith();
  });

  it('preserves node metrics when namespace policy is bounded', async () => {
    vi.mocked(checkMetricsApi).mockResolvedValue(true);
    vi.mocked(getWatchNamespaces).mockReturnValue(['team-a']);
    vi.mocked(getPodMetrics).mockResolvedValue([]);
    vi.mocked(getNodeMetrics).mockResolvedValue([
      { name: 'node-1', usage: { cpu: '250m', memory: '1Gi' } },
    ]);

    await expect(new MetricsCollector().collect()).resolves.toEqual({
      available: true,
      pods: [],
      nodes: [{ name: 'node-1', usage: { cpu: '250m', memory: '1Gi' } }],
    });
    expect(getNodeMetrics).toHaveBeenCalledOnce();
  });
});

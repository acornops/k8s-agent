import os from 'node:os';
import { getPodMetrics, getNodeMetrics, checkMetricsApi } from '../../k8s/metrics.js';
import { Collector } from '../../types/collector.js';
import { config } from '../../config.js';
import { getWatchNamespaces } from '../../runtime/namespace-scope.js';

/**
 * Collector responsible for fetching CPU and Memory usage metrics from the metrics-server.
 * Handles missing metrics API gracefully.
 */
export class MetricsCollector implements Collector {
  public name = 'metrics';

  /** Collect pod and node metrics or local fallback metrics when unavailable. */
  public async collect(): Promise<any> {
    const isAvailable = await checkMetricsApi();
    if (!isAvailable) {
      if (config.ACORNOPS_AGENT_LOCAL_FALLBACK_ENABLED) {
        const loadAverage = os.loadavg()[0] || 0.1;
        const cpuMillicores = Math.max(50, Math.round(loadAverage * 1000));
        const usedBytes = Math.max(0, os.totalmem() - os.freemem());
        const usedMemoryMi = Math.max(1, Math.round(usedBytes / (1024 * 1024)));
        return {
          available: false,
          source: 'local-fallback',
          pods: [],
          nodes: [
            {
              name: os.hostname(),
              usage: {
                cpu: `${cpuMillicores}m`,
                memory: `${usedMemoryMi}Mi`
              }
            }
          ]
        };
      }
      return {
        available: false,
        pods: [],
        nodes: []
      };
    }

    const namespaces = getWatchNamespaces();

    // For metrics, we'll just fetch all or namespaced
    const [podMetrics, nodeMetrics] = await Promise.all([
        this.getAllPodMetrics(namespaces),
        getNodeMetrics(),
    ]);

    return {
      available: true,
      pods: podMetrics,
      nodes: nodeMetrics,
    };
  }

  private async getAllPodMetrics(namespaces?: string[]) {
      if (namespaces) {
          const results = await Promise.all(namespaces.map(ns => getPodMetrics(ns)));
          return results.flat();
      }
      return getPodMetrics();
  }
}

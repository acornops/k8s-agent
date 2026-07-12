import { k8sClient } from './client.js';
import pino from 'pino';
import { config } from '../config.js';
import { filterNamespaceItems, getWatchNamespaces } from '../runtime/namespace-scope.js';
import { withK8sApiLimit } from './api-limiter.js';
import { listAllPages } from './pagination.js';

const logger = pino({ level: config.ACORNOPS_AGENT_LOG_LEVEL });
const METRICS_API_PROBE_CACHE_MS = 60000;

let metricsApiProbeCache: { available: boolean; expiresAt: number } | null = null;
let metricsApiProbeInFlight: Promise<boolean> | null = null;

/**
 * Represents resource usage metrics for a Pod.
 */
export interface PodMetrics {
  name: string;
  namespace: string;
  containers: Array<{
    name: string;
    usage: {
      cpu: string;
      memory: string;
    };
  }>;
}

/**
 * Represents resource usage metrics for a Node.
 */
export interface NodeMetrics {
  name: string;
  usage: {
    cpu: string;
    memory: string;
  };
}

/**
 * Probes the cluster to check if the metrics.k8s.io API is available.
 * @returns A boolean indicating if the metrics API is responsive.
 */
export async function checkMetricsApi(): Promise<boolean> {
  const now = Date.now();
  if (metricsApiProbeCache && metricsApiProbeCache.expiresAt > now) {
    return metricsApiProbeCache.available;
  }

  if (metricsApiProbeInFlight) {
    return metricsApiProbeInFlight;
  }

  metricsApiProbeInFlight = probeMetricsApi()
    .then((available) => {
      metricsApiProbeCache = {
        available,
        expiresAt: Date.now() + METRICS_API_PROBE_CACHE_MS,
      };
      return available;
    })
    .finally(() => {
      metricsApiProbeInFlight = null;
    });

  return metricsApiProbeInFlight;
}

/** Probe the metrics API directly without cache coordination. */
async function probeMetricsApi(): Promise<boolean> {
  try {
    const namespaces = getWatchNamespaces();
    if (namespaces?.length === 0) return true;
    const res = await withK8sApiLimit(() => namespaces
      ? k8sClient.customObjects.listNamespacedCustomObject({
        group: 'metrics.k8s.io',
        version: 'v1beta1',
        namespace: namespaces[0]!,
        plural: 'pods',
        limit: 1,
      })
      : k8sClient.customObjects.listClusterCustomObject({
        group: 'metrics.k8s.io',
        version: 'v1beta1',
        plural: 'pods',
        limit: 1,
      }));
    return !!res;
  } catch (err) {
    logger.debug({ err }, 'Metrics API not available');
    return false;
  }
}

/** Reset metrics API probe cache for tests. */
export function __resetMetricsApiProbeCacheForTest(): void {
  metricsApiProbeCache = null;
  metricsApiProbeInFlight = null;
}

/**
 * Fetches resource usage metrics for all pods in a namespace or cluster-wide.
 * @param namespace Optional namespace to filter pods.
 * @returns Array of Pod metrics.
 */
export async function getPodMetrics(namespace?: string): Promise<PodMetrics[]> {
  try {
    const items = await listAllPages<any>((options) => {
      if (namespace) {
        return k8sClient.customObjects.listNamespacedCustomObject({
          group: 'metrics.k8s.io',
          version: 'v1beta1',
          namespace,
          plural: 'pods',
          ...options,
        }) as Promise<any>;
      }
      return k8sClient.customObjects.listClusterCustomObject({
          group: 'metrics.k8s.io',
          version: 'v1beta1',
          plural: 'pods',
          ...options,
      }) as Promise<any>;
    });

    const filteredItems = namespace
      ? items
      : filterNamespaceItems(items, (item) => item.metadata?.namespace);

    return filteredItems.map((item: any) => ({
      name: item.metadata.name,
      namespace: item.metadata.namespace,
      containers: item.containers.map((c: any) => ({
        name: c.name,
        usage: c.usage,
      })),
    }));
  } catch (err) {
    logger.error({ err }, 'Failed to fetch pod metrics');
    return [];
  }
}

/**
 * Fetches resource usage metrics for all nodes in the cluster.
 * @returns Array of Node metrics.
 */
export async function getNodeMetrics(): Promise<NodeMetrics[]> {
  try {
    const items = await listAllPages<any>((options) => k8sClient.customObjects.listClusterCustomObject({
        group: 'metrics.k8s.io',
        version: 'v1beta1',
        plural: 'nodes',
        ...options,
    }) as Promise<any>);

    return items.map((item: any) => ({
      name: item.metadata.name,
      usage: item.usage,
    }));
  } catch (err) {
    logger.error({ err }, 'Failed to fetch node metrics');
    return [];
  }
}

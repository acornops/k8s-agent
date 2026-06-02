import { z } from 'zod';
import fetch, { Headers } from 'node-fetch';
import { k8sClient } from '../../k8s/client.js';
import { ToolDefinition } from '../registry.js';
import { checkNamespaceAllowed } from '../utils.js';

const schema = z.object({
  name: z.string(),
  namespace: z.string(),
  container: z.string().optional(),
  previous: z.boolean().optional().default(false),
  tail_lines: z.number().int().min(1).max(5000).optional().default(200),
  since_seconds: z.number().int().min(1).optional(),
  limit_bytes: z.number().int().min(1).max(10 * 1024 * 1024).optional().default(1024 * 1024)
});

/** Build the Kubernetes pod logs API URL for a specific pod request. */
function buildPodLogUrl(name: string, namespace: string, params: {
  container?: string;
  previous: boolean;
  tail_lines: number;
  since_seconds?: number;
  limit_bytes: number;
}): URL {
  const cluster = k8sClient.kc.getCurrentCluster();
  if (!cluster?.server) {
    throw new Error('No active Kubernetes cluster');
  }

  const url = new URL(
    `/api/v1/namespaces/${encodeURIComponent(namespace)}/pods/${encodeURIComponent(name)}/log`,
    cluster.server.endsWith('/') ? cluster.server : `${cluster.server}/`
  );
  if (params.container) url.searchParams.set('container', params.container);
  url.searchParams.set('previous', String(params.previous));
  url.searchParams.set('tailLines', String(params.tail_lines));
  if (params.since_seconds) url.searchParams.set('sinceSeconds', String(params.since_seconds));
  url.searchParams.set('limitBytes', String(params.limit_bytes));
  return url;
}

/** Read pod logs as plain text from the Kubernetes API. */
export async function readPodLogsText(name: string, namespace: string, params: {
  container?: string;
  previous: boolean;
  tail_lines: number;
  since_seconds?: number;
  limit_bytes: number;
}): Promise<string> {
  const url = buildPodLogUrl(name, namespace, params);
  const requestInit = await k8sClient.kc.applyToFetchOptions({});
  const headers = new Headers(requestInit.headers);
  headers.set('accept', 'text/plain, */*');

  const response = await fetch(url.toString(), {
    ...requestInit,
    method: 'GET',
    headers
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(body.trim() || `Kubernetes pod log request failed with status ${response.status}`);
  }
  return body;
}

/** Handle the get_resource_logs tool request. */
async function handler(params: z.infer<typeof schema>) {
  const { name, namespace, container, previous, tail_lines, since_seconds, limit_bytes } = params;
  checkNamespaceAllowed(namespace);

  const logs = await readPodLogsText(name, namespace, {
    container,
    previous,
    tail_lines,
    since_seconds,
    limit_bytes
  });

  return {
    name,
    namespace,
    container: container || '',
    logs
  };
}

export const getResourceLogsTool: ToolDefinition = {
  name: 'get_resource_logs',
  description: 'Read logs from a Pod container with tail and time-range controls.',
  capability: 'read',
  timeoutMs: 20000,
  version: 'v1',
  schema,
  handler
};

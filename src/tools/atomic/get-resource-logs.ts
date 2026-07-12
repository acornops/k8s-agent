import { z } from 'zod';
import fetch, { Headers, Response } from 'node-fetch';
import { k8sClient } from '../../k8s/client.js';
import { ToolDefinition, ToolExecutionContext } from '../registry.js';
import { checkNamespaceAllowed } from '../utils.js';
import { containerNameSchema, kubernetesNameSchema, namespaceSchema } from '../schemas.js';
import { ToolExecutionError } from '../errors.js';

const MAX_LOG_BYTES = 1024 * 1024;

const schema = z.object({
  name: kubernetesNameSchema,
  namespace: namespaceSchema,
  container: containerNameSchema.optional(),
  previous: z.boolean().optional().default(false),
  tail_lines: z.number().int().min(1).max(5000).optional().default(200),
  since_seconds: z.number().int().min(1).optional(),
  limit_bytes: z.number().int().min(1).max(MAX_LOG_BYTES).optional().default(MAX_LOG_BYTES)
}).strict();

/** Consume a response body without allowing an oversized upstream response into memory. */
async function readBoundedBody(response: Response): Promise<string> {
  if (Buffer.isBuffer(response.body)) {
    if (response.body.length > MAX_LOG_BYTES) {
      throw new ToolExecutionError('OUTPUT_TOO_LARGE', 'Pod log response exceeds the 1 MiB limit');
    }
    return response.body.toString('utf8');
  }
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of response.body) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > MAX_LOG_BYTES) {
      throw new ToolExecutionError('OUTPUT_TOO_LARGE', 'Pod log response exceeds the 1 MiB limit');
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, bytes).toString('utf8');
}

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
  signal?: AbortSignal;
}): Promise<string> {
  const url = buildPodLogUrl(name, namespace, params);
  const requestInit = await k8sClient.kc.applyToFetchOptions({});
  const headers = new Headers(requestInit.headers);
  headers.set('accept', 'text/plain, */*');

  const response = await fetch(url.toString(), {
    ...requestInit,
    method: 'GET',
    headers,
    signal: params.signal,
  });
  const body = await readBoundedBody(response);
  if (!response.ok) {
    throw new Error(`Kubernetes pod log request failed with status ${response.status}`);
  }
  return body;
}

/** Handle the get_resource_logs tool request. */
async function handler(params: z.infer<typeof schema>, context?: ToolExecutionContext) {
  const { name, namespace, container, previous, tail_lines, since_seconds, limit_bytes } = params;
  checkNamespaceAllowed(namespace);

  const logs = await readPodLogsText(name, namespace, {
    container,
    previous,
    tail_lines,
    since_seconds,
    limit_bytes,
    signal: context?.signal,
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
  scopeResolver: (params) => ({ type: 'namespaced', namespace: params.namespace }),
  handler
};

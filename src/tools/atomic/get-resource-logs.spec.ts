import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getResourceLogsTool, readPodLogsText } from './get-resource-logs.js';
import { k8sClient } from '../../k8s/client.js';
import fetch, { Headers, Response } from 'node-fetch';

vi.mock('node-fetch', async () => {
  const actual = await vi.importActual<typeof import('node-fetch')>('node-fetch');
  return {
    ...actual,
    default: vi.fn()
  };
});

vi.mock('../../k8s/client.js', () => ({
  k8sClient: {
    kc: {
      getCurrentCluster: vi.fn(),
      applyToFetchOptions: vi.fn()
    },
    core: {
      readNamespacedPodLog: vi.fn()
    }
  }
}));

describe('Get Resource Logs Tool', () => {
  beforeEach(() => {
    vi.mocked(k8sClient.kc.getCurrentCluster).mockReturnValue({ server: 'https://kube.example' } as never);
    vi.mocked(k8sClient.kc.applyToFetchOptions).mockResolvedValue({
      headers: { authorization: 'Bearer test-token' }
    } as never);
    vi.mocked(fetch).mockResolvedValue(new Response('pod log text', { status: 200 }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reads pod logs as raw text instead of using the generated Kubernetes parser', async () => {
    const result = await getResourceLogsTool.handler({
      name: 'api-pod',
      namespace: 'default',
      container: 'api',
      previous: true,
      tail_lines: 300,
      since_seconds: 60,
      limit_bytes: 2048
    });

    expect(result).toEqual({
      name: 'api-pod',
      namespace: 'default',
      container: 'api',
      logs: 'pod log text'
    });
    expect(k8sClient.core.readNamespacedPodLog).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledWith(
      'https://kube.example/api/v1/namespaces/default/pods/api-pod/log?container=api&previous=true&tailLines=300&sinceSeconds=60&limitBytes=2048',
      expect.objectContaining({
        method: 'GET',
        headers: expect.any(Headers)
      })
    );
  });

  it('returns the body even when Kubernetes omits a content-type header', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('plain text without a content-type', { status: 200 }));

    await expect(
      readPodLogsText('pod name', 'default', {
        previous: false,
        tail_lines: 100,
        limit_bytes: 1024
      })
    ).resolves.toBe('plain text without a content-type');
  });

  it('does not surface Kubernetes error bodies when log retrieval fails', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('pods "missing" not found', { status: 404 }));

    await expect(
      readPodLogsText('missing', 'default', {
        previous: false,
        tail_lines: 100,
        limit_bytes: 1024
      })
    ).rejects.toThrow('Kubernetes pod log request failed with status 404');
  });

  it('rejects an upstream log body larger than the hard output limit', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('x'.repeat(1024 * 1024 + 1), { status: 200 }));

    await expect(readPodLogsText('api', 'default', {
      previous: false,
      tail_lines: 100,
      limit_bytes: 1024 * 1024,
    })).rejects.toMatchObject({ toolCode: 'OUTPUT_TOO_LARGE' });
  });
});

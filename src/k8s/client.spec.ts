import { describe, expect, it, vi } from 'vitest';

type ClientConfig = {
  ACORNOPS_AGENT_KUBECONFIG_REWRITE_LOOPBACK: boolean;
  ACORNOPS_AGENT_KUBECONFIG_HOST_ALIAS: string;
  ACORNOPS_AGENT_KUBECONFIG_SKIP_TLS_VERIFY: boolean;
};

async function importClientModule({
  configOverrides = {},
  clusters = [],
}: {
  configOverrides?: Partial<ClientConfig>;
  clusters?: Array<Record<string, unknown>>;
} = {}) {
  vi.resetModules();

  const loadFromDefault = vi.fn();
  const getClusters = vi.fn(() => clusters);
  const makeApiClient = vi.fn((Api: { name: string }) => ({ kind: Api.name }));

  class MockKubeConfig {
    loadFromDefault = loadFromDefault;
    getClusters = getClusters;
    makeApiClient = makeApiClient;
  }

  vi.doMock('@kubernetes/client-node', () => ({
    KubeConfig: MockKubeConfig,
    CoreV1Api: class CoreV1Api {},
    AppsV1Api: class AppsV1Api {},
    BatchV1Api: class BatchV1Api {},
    NetworkingV1Api: class NetworkingV1Api {},
    AutoscalingV2Api: class AutoscalingV2Api {},
    CoordinationV1Api: class CoordinationV1Api {},
    CustomObjectsApi: class CustomObjectsApi {},
  }));

  vi.doMock('../config.js', () => ({
    config: {
      ACORNOPS_AGENT_KUBECONFIG_REWRITE_LOOPBACK: false,
      ACORNOPS_AGENT_KUBECONFIG_HOST_ALIAS: 'host.docker.internal',
      ACORNOPS_AGENT_KUBECONFIG_SKIP_TLS_VERIFY: false,
      ...configOverrides,
    },
  }));

  const module = await import('./client.js');
  return {
    ...module,
    loadFromDefault,
    getClusters,
    makeApiClient,
  };
}

describe('k8sClient', () => {
  it('rewrites loopback kubeconfig servers and drops CA data when requested', async () => {
    const clusters = [
      {
        server: 'https://127.0.0.1:6443/api',
        caData: 'cert',
        caFile: '/tmp/ca.crt',
      },
    ];

    const { k8sClient, loadFromDefault, makeApiClient } = await importClientModule({
      clusters,
      configOverrides: {
        ACORNOPS_AGENT_KUBECONFIG_REWRITE_LOOPBACK: true,
        ACORNOPS_AGENT_KUBECONFIG_SKIP_TLS_VERIFY: true,
        ACORNOPS_AGENT_KUBECONFIG_HOST_ALIAS: 'cluster.internal',
      },
    });

    expect(loadFromDefault).toHaveBeenCalledTimes(1);
    expect(makeApiClient).toHaveBeenCalledTimes(7);
    expect(k8sClient.kc.getClusters()).toBe(clusters);
    expect(clusters[0]).toEqual({
      server: 'https://cluster.internal:6443',
      skipTLSVerify: true,
    });
  });

  it('leaves non-loopback and malformed servers untouched', async () => {
    const clusters = [
      { server: 'https://10.0.0.15:6443' },
      { server: 'not a valid url' },
    ];

    await importClientModule({
      clusters,
      configOverrides: {
        ACORNOPS_AGENT_KUBECONFIG_REWRITE_LOOPBACK: true,
      },
    });

    expect(clusters).toEqual([
      { server: 'https://10.0.0.15:6443' },
      { server: 'not a valid url' },
    ]);
  });

  it('skips kubeconfig rewriting when the feature flag is disabled', async () => {
    const clusters = [{ server: 'https://localhost:6443' }];

    await importClientModule({ clusters });

    expect(clusters).toEqual([{ server: 'https://localhost:6443' }]);
  });
});

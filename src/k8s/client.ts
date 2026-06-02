import * as k8s from '@kubernetes/client-node';
import { config } from '../config.js';

/**
 * Singleton class that manages the Kubernetes API client connections.
 * Loads configuration from the default kubeconfig or in-cluster service account.
 */
class K8sClient {
  private static instance: K8sClient;
  public kc: k8s.KubeConfig;
  public core: k8s.CoreV1Api;
  public apps: k8s.AppsV1Api;
  public batch: k8s.BatchV1Api;
  public networking: k8s.NetworkingV1Api;
  public autoscaling: k8s.AutoscalingV2Api;
  public coordination: k8s.CoordinationV1Api;
  public customObjects: k8s.CustomObjectsApi;

  private constructor() {
    this.kc = new k8s.KubeConfig();
    this.kc.loadFromDefault();
    this.rewriteLoopbackKubeconfigServers();

    this.core = this.kc.makeApiClient(k8s.CoreV1Api);
    this.apps = this.kc.makeApiClient(k8s.AppsV1Api);
    this.batch = this.kc.makeApiClient(k8s.BatchV1Api);
    this.networking = this.kc.makeApiClient(k8s.NetworkingV1Api);
    this.autoscaling = this.kc.makeApiClient(k8s.AutoscalingV2Api);
    this.coordination = this.kc.makeApiClient(k8s.CoordinationV1Api);
    this.customObjects = this.kc.makeApiClient(k8s.CustomObjectsApi);
  }

  /**
   * Returns the singleton instance of the K8sClient.
   * @returns The K8sClient instance.
   */
  public static getInstance(): K8sClient {
    if (!K8sClient.instance) {
      K8sClient.instance = new K8sClient();
    }
    return K8sClient.instance;
  }

  private rewriteLoopbackKubeconfigServers(): void {
    if (!config.ACORNOPS_AGENT_KUBECONFIG_REWRITE_LOOPBACK) {
      return;
    }

    const aliasHost = config.ACORNOPS_AGENT_KUBECONFIG_HOST_ALIAS;
    const loopbackHosts = new Set(['127.0.0.1', 'localhost', '0.0.0.0']);

    for (const cluster of this.kc.getClusters()) {
      if (!cluster.server) continue;

      try {
        const serverUrl = new URL(cluster.server);
        if (!loopbackHosts.has(serverUrl.hostname)) {
          continue;
        }
        serverUrl.hostname = aliasHost;
        // Normalize to protocol+host only; URL.toString() adds a trailing "/" and
        // @kubernetes/client-node may produce "//api/..." which some servers reject.
        (cluster as { server: string }).server = `${serverUrl.protocol}//${serverUrl.host}`;
        if (config.ACORNOPS_AGENT_KUBECONFIG_SKIP_TLS_VERIFY) {
          (cluster as { skipTLSVerify?: boolean; caData?: string; caFile?: string }).skipTLSVerify = true;
          delete (cluster as { caData?: string }).caData;
          delete (cluster as { caFile?: string }).caFile;
        }
      } catch {
        // Ignore malformed kubeconfig server URL and keep original value.
      }
    }
  }
}

export const k8sClient = K8sClient.getInstance();

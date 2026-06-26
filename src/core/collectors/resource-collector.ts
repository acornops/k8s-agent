import os from 'node:os';
import pino from 'pino';
import { k8sClient } from '../../k8s/client.js';
import { ListPageOptions, listAllPages } from '../../k8s/pagination.js';
import { Collector } from '../../types/collector.js';
import { config } from '../../config.js';
import { filterNamespaceItems, getWatchNamespaces, isNamespaceAllowed } from '../../runtime/namespace-scope.js';

const logger = pino({ level: config.ACORNOPS_AGENT_LOG_LEVEL }).child({ module: 'resource-collector' });

/**
 * Collector responsible for fetching standard Kubernetes resources.
 */
export class ResourceCollector implements Collector {
  public name = 'resources';

  /** Collect the Kubernetes resource snapshot for watched namespaces. */
  public async collect(): Promise<any> {
    const namespaces = getWatchNamespaces();

    const [pods, deployments, statefulSets, daemonSets, cronJobs, jobs, services, ingresses, pvcs, nodes, namespaceItems] = await Promise.all([
      this.getPods(namespaces).catch((err) => {
        logger.warn({ err }, 'Failed to collect pods');
        return [];
      }),
      this.getDeployments(namespaces).catch((err) => {
        logger.warn({ err }, 'Failed to collect deployments');
        return [];
      }),
      this.getStatefulSets(namespaces).catch((err) => {
        logger.warn({ err }, 'Failed to collect stateful sets');
        return [];
      }),
      this.getDaemonSets(namespaces).catch((err) => {
        logger.warn({ err }, 'Failed to collect daemon sets');
        return [];
      }),
      this.getCronJobs(namespaces).catch((err) => {
        logger.warn({ err }, 'Failed to collect cron jobs');
        return [];
      }),
      this.getJobs(namespaces).catch((err) => {
        logger.warn({ err }, 'Failed to collect jobs');
        return [];
      }),
      this.getServices(namespaces).catch((err) => {
        logger.warn({ err }, 'Failed to collect services');
        return [];
      }),
      this.getIngresses(namespaces).catch((err) => {
        logger.warn({ err }, 'Failed to collect ingresses');
        return [];
      }),
      this.getPVCs(namespaces).catch((err) => {
        logger.warn({ err }, 'Failed to collect PVCs');
        return [];
      }),
      this.getNodes().catch((err) => {
        logger.warn({ err }, 'Failed to collect nodes');
        return [];
      }),
      this.getNamespaces(namespaces).catch((err) => {
        logger.warn({ err }, 'Failed to collect namespaces');
        return [];
      }),
    ]);

    const safeNodes = nodes.length
      ? nodes
      : (config.ACORNOPS_AGENT_LOCAL_FALLBACK_ENABLED
          ? [
              {
                name: os.hostname(),
                uid: 'local-fallback-node',
                labels: {
                  'node-role.kubernetes.io/worker': ''
                },
                kubeletVersion: 'local-dev',
                status: {
                  conditions: [
                    {
                      type: 'Ready',
                      status: 'True',
                      reason: 'LocalFallback',
                      message: 'No Kubernetes API connection available in local mode.'
                    }
                  ]
                }
              }
            ]
          : []);

    return {
      pods,
      deployments,
      statefulSets,
      daemonSets,
      cronJobs,
      jobs,
      services,
      ingresses,
      pvcs,
      nodes: safeNodes,
      namespaces: namespaceItems,
    };
  }

  private isNamespaceInScope(namespace: string, namespaces?: string[]): boolean {
    if (namespaces) {
      return namespaces.includes(namespace);
    }
    return isNamespaceAllowed(namespace);
  }

  private async listNamespacedItems(
    namespaces: string[],
    fetchPage: (namespace: string, options: ListPageOptions) => Promise<any>
  ): Promise<any[]> {
    const results = await Promise.all(
      namespaces.map((namespace) => listAllPages((options) => fetchPage(namespace, options)))
    );
    return results.flat();
  }

  private async listClusterItems(fetchPage: (options: ListPageOptions) => Promise<any>): Promise<any[]> {
    return listAllPages((options) => fetchPage(options));
  }

  private async getPods(namespaces?: string[]) {
    let items;
    if (namespaces) {
      items = await this.listNamespacedItems(
        namespaces,
        (namespace, options) => k8sClient.core.listNamespacedPod({ namespace, ...options })
      );
    } else {
      const res = await this.listClusterItems((options) => k8sClient.core.listPodForAllNamespaces(options));
      items = filterNamespaceItems(res, (p) => p.metadata?.namespace);
    }

    return items.map(p => ({
      name: p.metadata?.name,
      namespace: p.metadata?.namespace,
      uid: p.metadata?.uid,
      labels: p.metadata?.labels,
      ownerReferences: p.metadata?.ownerReferences?.map((owner: any) => ({
        apiVersion: owner.apiVersion,
        kind: owner.kind,
        name: owner.name,
        uid: owner.uid,
        controller: owner.controller,
        blockOwnerDeletion: owner.blockOwnerDeletion,
      })),
      creationTimestamp: p.metadata?.creationTimestamp,
      phase: p.status?.phase,
      nodeName: p.spec?.nodeName,
      restartCount: (p.status?.containerStatuses || []).reduce((sum: number, status: any) => sum + (status.restartCount || 0), 0),
      containerStatuses: p.status?.containerStatuses?.map((cs: any) => ({
        name: cs.name,
        ready: cs.ready,
        restartCount: cs.restartCount,
        state: cs.state,
        lastState: cs.lastState,
      })),
    }));
  }

  private async getDeployments(namespaces?: string[]) {
    let items;
    if (namespaces) {
      items = await this.listNamespacedItems(
        namespaces,
        (namespace, options) => k8sClient.apps.listNamespacedDeployment({ namespace, ...options })
      );
    } else {
      const res = await this.listClusterItems((options) => k8sClient.apps.listDeploymentForAllNamespaces(options));
      items = filterNamespaceItems(res, (d) => d.metadata?.namespace);
    }

    return items.map(d => ({
      name: d.metadata?.name,
      namespace: d.metadata?.namespace,
      uid: d.metadata?.uid,
      creationTimestamp: d.metadata?.creationTimestamp,
      replicas: d.status?.replicas,
      availableReplicas: d.status?.availableReplicas,
      readyReplicas: d.status?.readyReplicas,
    }));
  }

  private async getStatefulSets(namespaces?: string[]) {
    let items;
    if (namespaces) {
      items = await this.listNamespacedItems(
        namespaces,
        (namespace, options) => k8sClient.apps.listNamespacedStatefulSet({ namespace, ...options })
      );
    } else {
      const res = await this.listClusterItems((options) => k8sClient.apps.listStatefulSetForAllNamespaces(options));
      items = filterNamespaceItems(res, (s) => s.metadata?.namespace);
    }

    return items.map(s => ({
      name: s.metadata?.name,
      namespace: s.metadata?.namespace,
      uid: s.metadata?.uid,
      creationTimestamp: s.metadata?.creationTimestamp,
      replicas: s.status?.replicas,
      availableReplicas: s.status?.availableReplicas,
      readyReplicas: s.status?.readyReplicas,
    }));
  }

  private async getDaemonSets(namespaces?: string[]) {
    let items;
    if (namespaces) {
      items = await this.listNamespacedItems(
        namespaces,
        (namespace, options) => k8sClient.apps.listNamespacedDaemonSet({ namespace, ...options })
      );
    } else {
      const res = await this.listClusterItems((options) => k8sClient.apps.listDaemonSetForAllNamespaces(options));
      items = filterNamespaceItems(res, (d) => d.metadata?.namespace);
    }

    return items.map(d => ({
      name: d.metadata?.name,
      namespace: d.metadata?.namespace,
      uid: d.metadata?.uid,
      creationTimestamp: d.metadata?.creationTimestamp,
      replicas: d.status?.desiredNumberScheduled,
      availableReplicas: d.status?.numberAvailable,
      readyReplicas: d.status?.numberReady,
    }));
  }

  private async getCronJobs(namespaces?: string[]) {
    let items;
    if (namespaces) {
      items = await this.listNamespacedItems(
        namespaces,
        (namespace, options) => k8sClient.batch.listNamespacedCronJob({ namespace, ...options })
      );
    } else {
      const res = await this.listClusterItems((options) => k8sClient.batch.listCronJobForAllNamespaces(options));
      items = filterNamespaceItems(res, (c) => c.metadata?.namespace);
    }

    return items.map(c => ({
      name: c.metadata?.name,
      namespace: c.metadata?.namespace,
      uid: c.metadata?.uid,
      creationTimestamp: c.metadata?.creationTimestamp,
      schedule: c.spec?.schedule,
      suspend: c.spec?.suspend,
      active: c.status?.active?.length || 0,
      lastScheduleTime: c.status?.lastScheduleTime,
    }));
  }

  private async getJobs(namespaces?: string[]) {
    let items;
    if (namespaces) {
      items = await this.listNamespacedItems(
        namespaces,
        (namespace, options) => k8sClient.batch.listNamespacedJob({ namespace, ...options })
      );
    } else {
      const res = await this.listClusterItems((options) => k8sClient.batch.listJobForAllNamespaces(options));
      items = filterNamespaceItems(res, (j) => j.metadata?.namespace);
    }

    return items.map(j => ({
      name: j.metadata?.name,
      namespace: j.metadata?.namespace,
      uid: j.metadata?.uid,
      creationTimestamp: j.metadata?.creationTimestamp,
      completions: j.spec?.completions,
      succeeded: j.status?.succeeded,
      failed: j.status?.failed,
      active: j.status?.active,
      startTime: j.status?.startTime,
      completionTime: j.status?.completionTime,
    }));
  }

  private async getServices(namespaces?: string[]) {
    let items;
    if (namespaces) {
      items = await this.listNamespacedItems(
        namespaces,
        (namespace, options) => k8sClient.core.listNamespacedService({ namespace, ...options })
      );
    } else {
      const res = await this.listClusterItems((options) => k8sClient.core.listServiceForAllNamespaces(options));
      items = filterNamespaceItems(res, (s) => s.metadata?.namespace);
    }

    return items.map(s => ({
      name: s.metadata?.name,
      namespace: s.metadata?.namespace,
      uid: s.metadata?.uid,
      creationTimestamp: s.metadata?.creationTimestamp,
      type: s.spec?.type,
      clusterIP: s.spec?.clusterIP,
      selector: s.spec?.selector || {},
      externalIPs: s.spec?.externalIPs || [],
      loadBalancerIP: s.spec?.loadBalancerIP,
      ports: s.spec?.ports?.map((port: any) => ({
        name: port.name,
        port: port.port,
        protocol: port.protocol,
        targetPort: port.targetPort,
        nodePort: port.nodePort,
      })) || [],
    }));
  }

  private async getIngresses(namespaces?: string[]) {
    let items;
    if (namespaces) {
      items = await this.listNamespacedItems(
        namespaces,
        (namespace, options) => k8sClient.networking.listNamespacedIngress({ namespace, ...options })
      );
    } else {
      const res = await this.listClusterItems((options) => k8sClient.networking.listIngressForAllNamespaces(options));
      items = filterNamespaceItems(res, (i) => i.metadata?.namespace);
    }

    return items.map(i => {
      const addresses = i.status?.loadBalancer?.ingress
        ?.map((entry: any) => entry.hostname || entry.ip)
        .filter((value: unknown): value is string => Boolean(value)) || [];
      const rules = i.spec?.rules
        ?.map((rule: any) => ({
          host: rule.host,
          paths: rule.http?.paths?.map((path: any) => ({
            path: path.path,
            pathType: path.pathType,
            serviceName: path.backend?.service?.name,
            servicePort: path.backend?.service?.port?.name || path.backend?.service?.port?.number,
          })) || [],
        })) || [];
      const hosts = rules
        .map((rule: any) => rule.host)
        .filter((value: unknown): value is string => Boolean(value)) || [];

      return {
        name: i.metadata?.name,
        namespace: i.metadata?.namespace,
        uid: i.metadata?.uid,
        creationTimestamp: i.metadata?.creationTimestamp,
        ingressClassName: i.spec?.ingressClassName,
        hosts,
        address: addresses.join(', '),
        rules,
        tls: i.spec?.tls?.map((tls: any) => ({
          hosts: tls.hosts || [],
          secretName: tls.secretName,
        })) || [],
      };
    });
  }

  private async getPVCs(namespaces?: string[]) {
    let items;
    if (namespaces) {
      items = await this.listNamespacedItems(
        namespaces,
        (namespace, options) => k8sClient.core.listNamespacedPersistentVolumeClaim({ namespace, ...options })
      );
    } else {
      const res = await this.listClusterItems((options) => k8sClient.core.listPersistentVolumeClaimForAllNamespaces(options));
      items = filterNamespaceItems(res, (pvc) => pvc.metadata?.namespace);
    }

    return items.map(pvc => ({
      name: pvc.metadata?.name,
      namespace: pvc.metadata?.namespace,
      uid: pvc.metadata?.uid,
      creationTimestamp: pvc.metadata?.creationTimestamp,
      status: pvc.status?.phase,
      capacity: pvc.status?.capacity?.storage,
      accessModes: pvc.spec?.accessModes || [],
      storageClass: pvc.spec?.storageClassName,
      volumeName: pvc.spec?.volumeName,
      volumeMode: pvc.spec?.volumeMode,
    }));
  }

  private async getNodes() {
    const items = await this.listClusterItems((options) => k8sClient.core.listNode(options));
    return items.map(n => ({
      name: n.metadata?.name,
      uid: n.metadata?.uid,
      labels: n.metadata?.labels || {},
      kubeletVersion: n.status?.nodeInfo?.kubeletVersion,
      osImage: n.status?.nodeInfo?.osImage,
      containerRuntimeVersion: n.status?.nodeInfo?.containerRuntimeVersion,
      architecture: n.status?.nodeInfo?.architecture,
      operatingSystem: n.status?.nodeInfo?.operatingSystem,
      capacity: n.status?.capacity || {},
      allocatable: n.status?.allocatable || {},
      status: {
        conditions: n.status?.conditions?.map((c: any) => ({
          type: c.type,
          status: c.status,
          reason: c.reason,
          message: c.message,
        })),
      },
    }));
  }

  private async getNamespaces(namespaces?: string[]) {
    const items = await this.listClusterItems((options) => k8sClient.core.listNamespace(options));
    return items
      .filter(ns => this.isNamespaceInScope(ns.metadata?.name || '', namespaces))
      .map(ns => ({
        name: ns.metadata?.name,
        uid: ns.metadata?.uid,
        creationTimestamp: ns.metadata?.creationTimestamp,
        labels: ns.metadata?.labels || {},
        status: ns.status?.phase,
      }));
  }
}

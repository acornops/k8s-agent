import { z } from 'zod';
import { KubernetesListObject, KubernetesObject } from '@kubernetes/client-node';
import { k8sClient } from '../../k8s/client.js';
import { ToolDefinition } from '../registry.js';
import { checkNamespaceAllowed } from '../utils.js';

const schema = z.object({
  kind: z.enum(['Pod', 'Deployment', 'StatefulSet', 'DaemonSet', 'CronJob', 'Job', 'Service', 'Namespace', 'Node', 'Event']),
  namespace: z.string().optional(),
  label_selector: z.string().optional(),
  field_selector: z.string().optional(),
  limit: z.number().int().min(1).max(1000).optional().default(100),
  continue_token: z.string().optional()
});

/** Convert a Kubernetes API object into a compact list item summary. */
function summarizeResource(kind: string, item: any): Record<string, unknown> {
  const metadata = item?.metadata || {};
  const base = {
    name: metadata.name || '',
    namespace: metadata.namespace || undefined,
    uid: metadata.uid || undefined,
    createdAt: metadata.creationTimestamp || undefined
  };

  if (kind === 'Pod') {
    const statuses = Array.isArray(item?.status?.containerStatuses) ? item.status.containerStatuses : [];
    const restartCount = statuses.reduce((acc: number, status: { restartCount?: number }) => acc + (status.restartCount || 0), 0);
    return {
      ...base,
      phase: item?.status?.phase || 'Unknown',
      nodeName: item?.spec?.nodeName || '',
      restartCount
    };
  }

  if (kind === 'Deployment' || kind === 'StatefulSet' || kind === 'DaemonSet') {
    return {
      ...base,
      replicas: item?.status?.replicas ?? item?.spec?.replicas ?? 0,
      readyReplicas: item?.status?.readyReplicas ?? 0,
      availableReplicas: item?.status?.availableReplicas ?? 0
    };
  }

  if (kind === 'CronJob') {
    return {
      ...base,
      schedule: item?.spec?.schedule || '',
      suspend: Boolean(item?.spec?.suspend),
      active: Array.isArray(item?.status?.active) ? item.status.active.length : 0,
      lastScheduleTime: item?.status?.lastScheduleTime || undefined
    };
  }

  if (kind === 'Job') {
    return {
      ...base,
      completions: item?.spec?.completions ?? 1,
      succeeded: item?.status?.succeeded ?? 0,
      failed: item?.status?.failed ?? 0,
      active: item?.status?.active ?? 0,
      startTime: item?.status?.startTime || undefined,
      completionTime: item?.status?.completionTime || undefined
    };
  }

  if (kind === 'Service') {
    return {
      ...base,
      type: item?.spec?.type || 'ClusterIP',
      clusterIP: item?.spec?.clusterIP || ''
    };
  }

  if (kind === 'Node') {
    return {
      ...base,
      phase: summarizeNodePhase(item)
    };
  }

  if (kind === 'Event') {
    return {
      ...base,
      reason: item?.reason || '',
      type: item?.type || '',
      message: item?.message || ''
    };
  }

  return base;
}

/** Derive the human-readable node phase from Kubernetes readiness conditions. */
function summarizeNodePhase(item: any): string {
  if (item?.status?.phase) {
    return item.status.phase;
  }

  const conditions = Array.isArray(item?.status?.conditions) ? item.status.conditions : [];
  const readyCondition = conditions.find((condition: any) => condition?.type === 'Ready');

  if (readyCondition?.status === 'True') {
    return 'Ready';
  }
  if (readyCondition?.status === 'False') {
    return 'NotReady';
  }

  return 'Unknown';
}

/** Handle a request to list Kubernetes resources by kind. */
async function handler(params: z.infer<typeof schema>) {
  const { kind, namespace, label_selector, field_selector, limit, continue_token } = params;
  checkNamespaceAllowed(namespace);

  const listOptions = {
    labelSelector: label_selector,
    fieldSelector: field_selector,
    limit,
    _continue: continue_token
  };

  let response: KubernetesListObject<KubernetesObject>;
  switch (kind) {
    case 'Pod':
      response = namespace
        ? await k8sClient.core.listNamespacedPod({ namespace, ...listOptions })
        : await k8sClient.core.listPodForAllNamespaces(listOptions);
      break;
    case 'Deployment':
      response = namespace
        ? await k8sClient.apps.listNamespacedDeployment({ namespace, ...listOptions })
        : await k8sClient.apps.listDeploymentForAllNamespaces(listOptions);
      break;
    case 'StatefulSet':
      response = namespace
        ? await k8sClient.apps.listNamespacedStatefulSet({ namespace, ...listOptions })
        : await k8sClient.apps.listStatefulSetForAllNamespaces(listOptions);
      break;
    case 'DaemonSet':
      response = namespace
        ? await k8sClient.apps.listNamespacedDaemonSet({ namespace, ...listOptions })
        : await k8sClient.apps.listDaemonSetForAllNamespaces(listOptions);
      break;
    case 'CronJob':
      response = namespace
        ? await k8sClient.batch.listNamespacedCronJob({ namespace, ...listOptions })
        : await k8sClient.batch.listCronJobForAllNamespaces(listOptions);
      break;
    case 'Job':
      response = namespace
        ? await k8sClient.batch.listNamespacedJob({ namespace, ...listOptions })
        : await k8sClient.batch.listJobForAllNamespaces(listOptions);
      break;
    case 'Service':
      response = namespace
        ? await k8sClient.core.listNamespacedService({ namespace, ...listOptions })
        : await k8sClient.core.listServiceForAllNamespaces(listOptions);
      break;
    case 'Namespace':
      response = await k8sClient.core.listNamespace(listOptions);
      break;
    case 'Node':
      response = await k8sClient.core.listNode(listOptions);
      break;
    case 'Event':
      response = namespace
        ? await k8sClient.core.listNamespacedEvent({ namespace, ...listOptions })
        : await k8sClient.core.listEventForAllNamespaces(listOptions);
      break;
    default:
      throw new Error(`Unsupported kind for list_resources: ${kind}`);
  }

  const items = Array.isArray(response?.items) ? response.items : [];
  return {
    kind,
    namespace: namespace || '*',
    total: items.length,
    continue_token: response?.metadata?._continue || '',
    items: items.map((item) => summarizeResource(kind, item))
  };
}

export const listResourcesTool: ToolDefinition = {
  name: 'list_resources',
  description: 'List Kubernetes resources by kind with optional namespace and selector filters.',
  capability: 'read',
  timeoutMs: 12000,
  version: 'v1',
  schema,
  handler
};

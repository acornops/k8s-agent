import { z } from 'zod';
import { createHash } from 'node:crypto';
import { config } from '../../config.js';
import { k8sClient } from '../../k8s/client.js';
import { ToolExecutionError } from '../errors.js';
import { ToolDefinition, ToolExecutionContext } from '../registry.js';
import { kubernetesNameSchema, namespaceSchema, reasonSchema } from '../schemas.js';
import { checkNamespaceAllowed, checkWriteEnabled, getAnnotations } from '../utils.js';
import { WriteReceipt } from '../write-receipt.js';

const schema = z.object({
  kind: z.enum(['Deployment', 'StatefulSet']),
  name: kubernetesNameSchema,
  namespace: namespaceSchema,
  replicas: z.number().int().min(0).max(config.ACORNOPS_AGENT_SCALE_MAX_REPLICAS),
  reason: reasonSchema,
  confirm_scale_to_zero: z.boolean().optional().default(false),
  confirm_hpa_override: z.boolean().optional().default(false),
  expected_current_replicas: z.number().int().min(0).optional(),
}).strict();

/** Read the current scalable workload. */
async function readWorkload(kind: z.infer<typeof schema>['kind'], name: string, namespace: string): Promise<any> {
  return kind === 'Deployment'
    ? k8sClient.apps.readNamespacedDeployment({ name, namespace })
    : k8sClient.apps.readNamespacedStatefulSet({ name, namespace });
}

/** Apply one atomic parent-resource JSON Patch for scaling and annotations. */
async function patchWorkload(kind: z.infer<typeof schema>['kind'], name: string, namespace: string, body: any[]): Promise<any> {
  return kind === 'Deployment'
    ? k8sClient.apps.patchNamespacedDeployment({ name, namespace, body })
    : k8sClient.apps.patchNamespacedStatefulSet({ name, namespace, body });
}

/** Build a minimal scale receipt without returning the workload specification. */
function buildReceipt(params: z.infer<typeof schema>, resource: any, operationId: string, previousReplicas: number, hpaOverride: boolean): WriteReceipt {
  return {
    success: true,
    operationId,
    target: {
      kind: params.kind,
      namespace: params.namespace,
      name: params.name,
      uid: String(resource.metadata?.uid || ''),
    },
    change: { type: 'scale', previousReplicas, requestedReplicas: params.replicas, hpaOverride },
    observed: {
      resourceVersion: String(resource.metadata?.resourceVersion || ''),
      ...(resource.metadata?.generation === undefined ? {} : { generation: resource.metadata.generation }),
    },
  };
}

/** Handle a guarded request to scale a Deployment or StatefulSet. */
async function handler(params: z.infer<typeof schema>, context?: ToolExecutionContext): Promise<WriteReceipt> {
  checkWriteEnabled();
  checkNamespaceAllowed(params.namespace);

  const operationId = context?.operationId || `direct-${Date.now()}`;
  const current = await readWorkload(params.kind, params.name, params.namespace);
  if (!current.metadata?.uid || !current.metadata?.resourceVersion) {
    throw new ToolExecutionError('PRECONDITION_FAILED', 'Workload identity is incomplete');
  }
  const previousReplicas = Number(current.spec?.replicas ?? 1);
  if (!Number.isInteger(previousReplicas) || previousReplicas < 0) {
    throw new ToolExecutionError('PRECONDITION_FAILED', 'Current workload replica state is invalid');
  }
  const operationHash = createHash('sha256').update(JSON.stringify(params)).digest('hex');
  const existingOperationId = current.metadata?.annotations?.['acornops.dev/operation-id'];
  if (existingOperationId === operationId) {
    const existingHash = current.metadata?.annotations?.['acornops.dev/operation-hash'];
    if (existingHash !== operationHash || previousReplicas !== params.replicas) {
      throw new ToolExecutionError('PRECONDITION_FAILED', 'Operation ID was already used with different scale arguments');
    }
    const recordedPrevious = Number(current.metadata?.annotations?.['acornops.dev/previous-replicas']);
    return buildReceipt(
      params,
      current,
      operationId,
      Number.isInteger(recordedPrevious) ? recordedPrevious : previousReplicas,
      current.metadata?.annotations?.['acornops.dev/hpa-override'] === 'true'
    );
  }
  if (params.expected_current_replicas !== undefined && params.expected_current_replicas !== previousReplicas) {
    throw new ToolExecutionError('PRECONDITION_FAILED', 'Current replicas do not match the expected value');
  }
  if (params.replicas === 0 && (!config.ACORNOPS_AGENT_ALLOW_SCALE_TO_ZERO || !params.confirm_scale_to_zero)) {
    throw new ToolExecutionError('PRECONDITION_FAILED', 'Scale-to-zero requires operator enablement and caller confirmation');
  }

  const hpas = await k8sClient.autoscaling.listNamespacedHorizontalPodAutoscaler({ namespace: params.namespace });
  const managedByHpa = (hpas.items || []).some((hpa: any) =>
    hpa.spec?.scaleTargetRef?.kind === params.kind && hpa.spec?.scaleTargetRef?.name === params.name
  );
  if (managedByHpa && !params.confirm_hpa_override) {
    throw new ToolExecutionError('PRECONDITION_FAILED', 'Workload is managed by an HPA; explicit override confirmation is required');
  }
  const annotations = {
    ...(current.metadata?.annotations ?? {}),
    ...getAnnotations(params.reason, operationId),
    'acornops.dev/operation-hash': operationHash,
    'acornops.dev/operation-kind': 'scale',
    'acornops.dev/previous-replicas': String(previousReplicas),
    'acornops.dev/requested-replicas': String(params.replicas),
    'acornops.dev/hpa-override': String(managedByHpa),
  };
  const updated = await patchWorkload(params.kind, params.name, params.namespace, [
    { op: 'test', path: '/metadata/uid', value: current.metadata.uid },
    { op: 'test', path: '/metadata/resourceVersion', value: current.metadata.resourceVersion },
    { op: 'add', path: '/spec/replicas', value: params.replicas },
    { op: 'add', path: '/metadata/annotations', value: annotations },
  ]);
  if (updated.metadata?.uid !== current.metadata.uid || !updated.metadata?.resourceVersion) {
    throw new ToolExecutionError('PRECONDITION_FAILED', 'Patched workload identity is inconsistent');
  }
  return buildReceipt(params, updated, operationId, previousReplicas, managedByHpa);
}

export const scaleWorkloadTool: ToolDefinition = {
  name: 'scale_workload',
  description: 'Scale a Deployment or StatefulSet to a guarded target replica count.',
  capability: 'write',
  timeoutMs: 15000,
  version: 'v1',
  schema,
  scopeResolver: (params) => ({ type: 'namespaced', namespace: params.namespace }),
  handler,
};

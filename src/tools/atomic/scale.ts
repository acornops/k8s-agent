import { z } from 'zod';
import { k8sClient } from '../../k8s/client.js';
import { ToolDefinition } from '../registry.js';
import { checkWriteEnabled, getAnnotations, checkNamespaceAllowed } from '../utils.js';

const schema = z.object({
  kind: z.enum(['Deployment', 'StatefulSet']),
  name: z.string(),
  namespace: z.string(),
  replicas: z.number().int().min(0),
  reason: z.string(),
});

/** Handle a request to scale a Deployment or StatefulSet. */
async function handler(params: z.infer<typeof schema>) {
  checkWriteEnabled();
  const { kind, name, namespace, replicas, reason } = params;
  checkNamespaceAllowed(namespace);

  const annotations = getAnnotations(reason);
  const scalePatch = [{ op: 'add', path: '/spec/replicas', value: replicas }];

  if (kind === 'Deployment') {
    await k8sClient.apps.patchNamespacedDeploymentScale({
      name,
      namespace,
      body: scalePatch
    });

    const current = await k8sClient.apps.readNamespacedDeployment({ name, namespace });
    const nextAnnotations = {
      ...(current.metadata?.annotations ?? {}),
      ...annotations
    };

    const res = await k8sClient.apps.patchNamespacedDeployment({
      name,
      namespace,
      body: [{ op: 'add', path: '/metadata/annotations', value: nextAnnotations }]
    });
    return { success: true, resource: res };
  } else {
    await k8sClient.apps.patchNamespacedStatefulSetScale({
      name,
      namespace,
      body: scalePatch
    });

    const current = await k8sClient.apps.readNamespacedStatefulSet({ name, namespace });
    const nextAnnotations = {
      ...(current.metadata?.annotations ?? {}),
      ...annotations
    };

    const res = await k8sClient.apps.patchNamespacedStatefulSet({
      name,
      namespace,
      body: [{ op: 'add', path: '/metadata/annotations', value: nextAnnotations }]
    });
    return { success: true, resource: res };
  }
}

export const scaleWorkloadTool: ToolDefinition = {
  name: 'scale_workload',
  description: 'Scale a Deployment or StatefulSet to a target replica count.',
  capability: 'write',
  timeoutMs: 15000,
  version: 'v1',
  schema,
  handler,
};

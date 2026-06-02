import { z } from 'zod';
import { k8sClient } from '../../k8s/client.js';
import { ToolDefinition } from '../registry.js';
import { checkNamespaceAllowed, checkWriteEnabled, getAnnotations } from '../utils.js';

const schema = z.object({
  kind: z.enum(['Deployment', 'StatefulSet', 'DaemonSet']),
  name: z.string(),
  namespace: z.string(),
  reason: z.string()
});

/** Handle a request to restart a scalable workload. */
async function handler(params: z.infer<typeof schema>) {
  checkWriteEnabled();
  const { kind, name, namespace, reason } = params;
  checkNamespaceAllowed(namespace);

  const annotations = {
    ...getAnnotations(reason),
    'kubectl.kubernetes.io/restartedAt': new Date().toISOString()
  };
  if (kind === 'Deployment') {
    const current = await k8sClient.apps.readNamespacedDeployment({ name, namespace });
    const templateMetadata = current.spec?.template?.metadata;
    const nextAnnotations = {
      ...(templateMetadata?.annotations ?? {}),
      ...annotations
    };
    const path = templateMetadata ? '/spec/template/metadata/annotations' : '/spec/template/metadata';
    const value = templateMetadata ? nextAnnotations : { annotations: nextAnnotations };
    const resource = await k8sClient.apps.patchNamespacedDeployment({
      name,
      namespace,
      body: [{ op: 'add', path, value }]
    });
    return { success: true, resource };
  }
  if (kind === 'StatefulSet') {
    const current = await k8sClient.apps.readNamespacedStatefulSet({ name, namespace });
    const templateMetadata = current.spec?.template?.metadata;
    const nextAnnotations = {
      ...(templateMetadata?.annotations ?? {}),
      ...annotations
    };
    const path = templateMetadata ? '/spec/template/metadata/annotations' : '/spec/template/metadata';
    const value = templateMetadata ? nextAnnotations : { annotations: nextAnnotations };
    const resource = await k8sClient.apps.patchNamespacedStatefulSet({
      name,
      namespace,
      body: [{ op: 'add', path, value }]
    });
    return { success: true, resource };
  }

  const current = await k8sClient.apps.readNamespacedDaemonSet({ name, namespace });
  const templateMetadata = current.spec?.template?.metadata;
  const nextAnnotations = {
    ...(templateMetadata?.annotations ?? {}),
    ...annotations
  };
  const path = templateMetadata ? '/spec/template/metadata/annotations' : '/spec/template/metadata';
  const value = templateMetadata ? nextAnnotations : { annotations: nextAnnotations };
  const resource = await k8sClient.apps.patchNamespacedDaemonSet({
    name,
    namespace,
    body: [{ op: 'add', path, value }]
  });
  return { success: true, resource };
}

export const restartWorkloadTool: ToolDefinition = {
  name: 'restart_workload',
  description: 'Trigger a rolling restart for a Deployment, StatefulSet, or DaemonSet.',
  capability: 'write',
  timeoutMs: 15000,
  version: 'v1',
  schema,
  handler
};

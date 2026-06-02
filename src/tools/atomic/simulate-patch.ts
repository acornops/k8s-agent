import { z } from 'zod';
import * as jsonpatch from 'fast-json-patch';
import { k8sClient } from '../../k8s/client.js';
import { ToolDefinition } from '../registry.js';
import { loadYaml } from '@kubernetes/client-node';
import { checkNamespaceAllowed } from '../utils.js';

const schema = z.object({
  resourceYaml: z.string(),
});

/** Handle a dry-run patch simulation request. */
async function handler(params: z.infer<typeof schema>) {
  const { resourceYaml } = params;

  // Parse YAML
  const doc = loadYaml(resourceYaml) as any;
  if (!doc || !doc.kind || !doc.metadata) {
      throw new Error('Invalid resource YAML');
  }

  const name = doc.metadata.name;
  const namespace = doc.metadata.namespace;
  const kind = doc.kind;
  checkNamespaceAllowed(namespace);

  // Fetch current state
  let current;
  try {
      current = await fetchResource(kind, name, namespace);
  } catch (err) {
      // Resource might not exist yet (create)
      current = null;
  }

  // Perform dry-run apply
  // Note: k8s-client-node doesn't have a generic "apply" that handles everything easily with dryRun
  // We'll use patch with server-side apply if possible, or just return the diff of what was provided

  // For simplicity in this agent, we'll return the diff between 'current' and 'doc'
  if (!current) {
      return {
          op: 'create',
          diff: [{ op: 'add', path: '/', value: doc }]
      };
  }

  const diff = jsonpatch.compare(current, doc);

  return {
      op: 'patch',
      diff,
      currentUid: current.metadata?.uid
  };
}

/** Fetch the current Kubernetes resource for patch comparison. */
async function fetchResource(kind: string, name: string, namespace?: string) {
    switch (kind) {
        case 'Pod': return (await k8sClient.core.readNamespacedPod({ name, namespace: namespace! }));
        case 'Deployment': return (await k8sClient.apps.readNamespacedDeployment({ name, namespace: namespace! }));
        case 'Service': return (await k8sClient.core.readNamespacedService({ name, namespace: namespace! }));
        case 'HorizontalPodAutoscaler': return (await k8sClient.autoscaling.readNamespacedHorizontalPodAutoscaler({ name, namespace: namespace! }));
        default:
            throw new Error(`Unsupported kind for simulation: ${kind}`);
    }
}

export const simulatePatchTool: ToolDefinition = {
  name: 'simulate_patch',
  description: 'Simulate a resource change and return a JSON Patch-style diff without applying it.',
  capability: 'read',
  timeoutMs: 15000,
  version: 'v1',
  schema,
  handler,
};

import { z } from 'zod';
import * as jsonpatch from 'fast-json-patch';
import { k8sClient } from '../../k8s/client.js';
import { ToolDefinition } from '../registry.js';
import { loadYaml } from '@kubernetes/client-node';
import { checkNamespaceAllowed } from '../utils.js';
import { redactKubernetesResource } from '../resource-redaction.js';
import { isKubernetesNotFound } from '../errors.js';
import { kubernetesNameSchema, namespaceSchema } from '../schemas.js';

const supportedKindSchema = z.enum(['Pod', 'Deployment', 'Service', 'HorizontalPodAutoscaler']);
const resourceDocumentSchema = z.object({
  kind: supportedKindSchema,
  metadata: z.object({
    name: kubernetesNameSchema,
    namespace: namespaceSchema,
  }).passthrough(),
}).passthrough();

/** Parse and validate the supported namespaced Kubernetes document. */
function parseResourceDocument(resourceYaml: string): z.infer<typeof resourceDocumentSchema> {
  return resourceDocumentSchema.parse(loadYaml(resourceYaml));
}

const schema = z.object({
  resourceYaml: z.string().min(1).max(256 * 1024),
}).strict().superRefine((value, ctx) => {
  try {
    parseResourceDocument(value.resourceYaml);
  } catch {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['resourceYaml'], message: 'A supported namespaced Kubernetes resource is required' });
  }
});

/** Handle a dry-run patch simulation request. */
async function handler(params: z.infer<typeof schema>) {
  const { resourceYaml } = params;

  // Parse YAML
  const doc = parseResourceDocument(resourceYaml);

  const name = doc.metadata.name;
  const namespace = doc.metadata.namespace;
  const kind = doc.kind;
  checkNamespaceAllowed(namespace);

  // Fetch current state
  let current;
  try {
      current = await fetchResource(kind, name, namespace);
  } catch (err) {
      if (!isKubernetesNotFound(err)) throw err;
      current = null;
  }

  // Perform dry-run apply
  // Note: k8s-client-node doesn't have a generic "apply" that handles everything easily with dryRun
  // We'll use patch with server-side apply if possible, or just return the diff of what was provided

  // For simplicity in this agent, we'll return the diff between 'current' and 'doc'
  if (!current) {
      return {
          op: 'create',
          diff: [{ op: 'add', path: '/', value: redactKubernetesResource(doc) }]
      };
  }

  const diff = jsonpatch.compare(redactKubernetesResource(current), redactKubernetesResource(doc));

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
  scopeResolver: (params) => {
    const doc = parseResourceDocument(params.resourceYaml);
    return { type: 'namespaced', namespace: doc.metadata.namespace };
  },
  handler,
};

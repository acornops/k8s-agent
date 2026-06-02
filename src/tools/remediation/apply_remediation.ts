import { z } from 'zod';
import { JSONPath } from 'jsonpath-plus';
import pino from 'pino';
import { config } from '../../config.js';
import { toolRegistry, ToolDefinition } from '../registry.js';
import { k8sClient } from '../../k8s/client.js';

const logger = pino({ level: config.ACORNOPS_AGENT_LOG_LEVEL }).child({ module: 'remediation' });

const stepSchema = z.object({
  tool: z.string(),
  arguments: z.record(z.any()),
  continueOnError: z.boolean().default(false),
  preCondition: z.object({
    path: z.string(),
    equals: z.any(),
  }).optional(),
});

const schema = z.object({
  remediationId: z.string().optional(),
  targetResourceUID: z.string().optional(),
  steps: z.array(stepSchema),
});

/**
 * Executes a sequence of atomic tools as a single remediation plan.
 * Supports wait steps, pre-conditions, and UID verification for target resources.
 * If a step fails and continueOnError is false, the remediation stops immediately.
 */
async function handler(params: z.infer<typeof schema>) {
  const { steps, targetResourceUID, remediationId = `rem-${Date.now()}` } = params;
  const results = [];

  logger.info({ remediationId, stepCount: steps.length }, 'Starting remediation');

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    logger.debug({ remediationId, stepIndex: i, tool: step.tool }, 'Processing step');

    try {
      // 1. Built-in 'wait' tool
      if (step.tool === 'wait') {
        const seconds = step.arguments.seconds || 0;
        logger.info({ remediationId, seconds }, 'Waiting...');
        await new Promise(resolve => setTimeout(resolve, seconds * 1000));
        results.push({ step: i, tool: 'wait', success: true });
        continue;
      }

      // 2. Resolve target tool
      const tool = toolRegistry.get(step.tool);
      if (!tool) {
        throw new Error(`Tool not found: ${step.tool}`);
      }

      // 3. Pre-condition check
      if (step.preCondition) {
        const { path, equals } = step.preCondition;
        // We need the resource to check the pre-condition.
        // This is tricky because we don't know the resource name/namespace from the step itself
        // unless it's in the arguments.
        const { name, namespace, kind } = step.arguments;
        if (name && kind) {
             const resource = await fetchResource(kind, name, namespace);
             const values = JSONPath({ path, json: resource });
             if (values[0] !== equals) {
                 logger.info({ remediationId, stepIndex: i, path, expected: equals, actual: values[0] }, 'Pre-condition not met, skipping step');
                 results.push({ step: i, tool: step.tool, skipped: true, reason: 'Pre-condition failed' });
                 continue;
             }
        }
      }

      // 4. UID Guard
      if (targetResourceUID) {
          const { name, namespace, kind } = step.arguments;
          if (name && kind) {
              const resource = await fetchResource(kind, name, namespace);
              if (resource.metadata?.uid !== targetResourceUID) {
                  throw new Error(`Target resource UID mismatch. Expected ${targetResourceUID}, got ${resource.metadata?.uid}`);
              }
          }
      }

      // 5. Execute tool
      const result = await tool.handler(step.arguments);
      results.push({ step: i, tool: step.tool, success: true, result });

    } catch (err: any) {
      logger.error({ remediationId, stepIndex: i, err }, 'Step failed');
      results.push({ step: i, tool: step.tool, success: false, error: err.message });

      if (!step.continueOnError) {
        logger.warn({ remediationId }, 'Stopping remediation due to failure');
        break;
      }
    }
  }

  return { remediationId, results };
}

/** Fetch a resource used for remediation precondition and UID checks. */
async function fetchResource(kind: string, name: string, namespace?: string): Promise<any> {
    switch (kind) {
        case 'Pod': return (await k8sClient.core.readNamespacedPod({ name, namespace: namespace! }));
        case 'Deployment': return (await k8sClient.apps.readNamespacedDeployment({ name, namespace: namespace! }));
        case 'Service': return (await k8sClient.core.readNamespacedService({ name, namespace: namespace! }));
        default:
            throw new Error(`Unsupported kind for pre-condition/UID check: ${kind}`);
    }
}

export const applyRemediationTool: ToolDefinition = {
  name: 'apply_remediation',
  description: 'Execute a guarded sequence of tool steps as one remediation plan.',
  capability: 'write',
  timeoutMs: 30000,
  version: 'v1',
  schema,
  handler,
};

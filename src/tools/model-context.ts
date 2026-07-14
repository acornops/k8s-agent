import { ArtifactPolicy, ModelContextEnvelope } from './registry.js';

export const MODEL_CONTEXT_MAX_BYTES = 12 * 1024;

const ERROR_RESULT_DATA_SCHEMA: Record<string, unknown> = {
  type: 'object',
  required: ['code', 'message', 'retryable'],
  properties: {
    code: { type: 'string' },
    message: { type: 'string' },
    retryable: { type: 'boolean' },
  },
  additionalProperties: true,
};

/** Build the advertised full-result schema for one typed success payload plus common errors. */
export function fullToolResultOutputSchema(successDataSchema: Record<string, unknown>): Record<string, unknown> {
  return {
    type: 'object',
    required: ['schemaVersion', 'data'],
    properties: {
      schemaVersion: { const: 'acornops.full-tool-result.v1' },
      data: { oneOf: [successDataSchema, ERROR_RESULT_DATA_SCHEMA] },
    },
    additionalProperties: false,
  };
}

/** Generic schema used only by isolated registry/router test tools. */
export const FULL_TOOL_RESULT_OUTPUT_SCHEMA: Record<string, unknown> = {
  type: 'object', required: ['schemaVersion', 'data'],
  properties: {
    schemaVersion: { const: 'acornops.full-tool-result.v1' },
    data: { type: 'object' },
  },
  additionalProperties: false,
};

export const WRITE_TOOL_RESULT_OUTPUT_SCHEMA = fullToolResultOutputSchema({
  type: 'object',
  required: ['success', 'operationId', 'target'],
  properties: {
    success: { const: true },
    operationId: { type: 'string' },
    target: { type: 'object' },
  },
  additionalProperties: true,
});

/** Return the UTF-8 size of one JSON-serializable value. */
function byteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value));
}

/** Validate a producer-owned model projection before it crosses the MCP boundary. */
export function validateModelContext(context: ModelContextEnvelope): ModelContextEnvelope {
  if (context.schemaVersion !== 'acornops.model-context.v1') {
    throw new Error('Invalid model context schema version');
  }
  if (!context.summary || context.summary.length > 500) {
    throw new Error('Model context summary must contain at most 500 characters');
  }
  if (byteLength(context) > MODEL_CONTEXT_MAX_BYTES) {
    throw new Error(`Model context exceeds the ${MODEL_CONTEXT_MAX_BYTES} byte limit`);
  }
  return context;
}

/** Build a standards-shaped MCP result with separate model and complete-result channels. */
export function buildCallToolResult(
  context: ModelContextEnvelope,
  fullResult: unknown,
  artifactPolicy: ArtifactPolicy,
  isError = false,
): Record<string, unknown> {
  const validated = validateModelContext(context);
  const contextText = JSON.stringify(validated);
  return {
    content: [{ type: 'text', text: contextText }],
    structuredContent: {
      schemaVersion: 'acornops.full-tool-result.v1',
      data: fullResult,
    },
    isError,
    _meta: {
      'acornops.dev/result': {
        contextSchemaVersion: 'v1',
        artifactPolicy,
        originalBytes: byteLength(fullResult),
        contextBytes: Buffer.byteLength(contextText),
      },
    },
  };
}

/** Extract stable Kubernetes identity and concurrency fields. */
export function identity(value: any): Record<string, unknown> {
  const metadata = value?.metadata || {};
  return {
    apiVersion: value?.apiVersion,
    kind: value?.kind,
    name: metadata.name,
    namespace: metadata.namespace,
    uid: metadata.uid,
    resourceVersion: metadata.resourceVersion,
    generation: metadata.generation,
  };
}

/** Bound a list by whole items, recording what was left out. */
export function boundedItems<T>(items: T[], maxItems: number, path = 'data.items'):
  { items: T[]; omissions: Array<Record<string, unknown>> } {
  const retained: T[] = [];
  for (const item of items.slice(0, maxItems)) {
    if (byteLength([...retained, item]) > 8 * 1024) break;
    retained.push(item);
  }
  if (items.length <= retained.length) return { items: retained, omissions: [] };
  return {
    items: retained,
    omissions: [{ path, reason: 'item_or_byte_limit', originalCount: items.length, retainedCount: retained.length }],
  };
}

/** Bound free-form diagnostic text without slicing the surrounding JSON. */
export function boundedText(value: unknown, maxChars = 500): string | undefined {
  if (typeof value !== 'string') return undefined;
  return value.length > maxChars ? value.slice(0, maxChars) : value;
}

/** Project a bounded structured write receipt for model verification. */
export function writeProjection(tool: string, result: any): ModelContextEnvelope {
  const target = result?.target || {};
  return {
    schemaVersion: 'acornops.model-context.v1',
    tool,
    status: 'success',
    summary: `${tool} completed for ${target.kind || 'resource'} ${target.namespace || ''}/${target.name || ''}.`.trim(),
    data: {
      success: result?.success,
      operationId: result?.operationId,
      target,
      change: result?.change,
      observed: result?.observed,
      warnings: result?.warnings || [],
      verification: {
        tool: 'get_resource',
        target,
        instruction: 'Re-read this exact UID-bound target and confirm the requested state and workload health before reporting remediation complete.',
      },
    },
    omissions: [],
  };
}

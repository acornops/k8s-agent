export const TOOL_RPC_ERRORS = {
  INVALID_ARGUMENTS: -32602,
  TOOL_NOT_ALLOWED: -32001,
  WRITE_DISABLED: -32002,
  TOOL_TIMEOUT: -32003,
  TOOL_BUSY: -32004,
  PRECONDITION_FAILED: -32005,
  OUTPUT_TOO_LARGE: -32006,
  KUBERNETES_ERROR: -32007,
  NAMESPACE_FORBIDDEN: -32008,
  RESOURCE_NOT_FOUND: -32009,
  KUBERNETES_FORBIDDEN: -32010,
  KUBERNETES_TIMEOUT: -32011,
  KUBERNETES_UNAVAILABLE: -32012,
} as const;

export type ToolErrorCode = keyof typeof TOOL_RPC_ERRORS;

/** A sanitized error that may cross the AgentK JSON-RPC boundary. */
export class ToolExecutionError extends Error {
  /** Create a boundary-safe tool execution error. */
  constructor(
    readonly toolCode: ToolErrorCode,
    message: string,
    readonly data?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'ToolExecutionError';
  }

  get rpcCode(): number {
    return TOOL_RPC_ERRORS[this.toolCode];
  }
}

/** Return whether an unknown Kubernetes client failure is a not-found response. */
export function isKubernetesNotFound(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const value = err as Record<string, any>;
  return value.statusCode === 404 || value.status === 404 || value.response?.statusCode === 404 || value.response?.status === 404;
}

/** Return whether Kubernetes rejected a resource-version or JSON Patch precondition. */
export function isKubernetesPreconditionFailure(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const value = err as Record<string, any>;
  const status = value.statusCode ?? value.status ?? value.response?.statusCode ?? value.response?.status;
  return status === 409 || status === 422;
}

/** Extract a numeric HTTP status from supported Kubernetes client error shapes. */
function kubernetesStatus(err: unknown): number | undefined {
  if (!err || typeof err !== 'object') return undefined;
  const value = err as Record<string, any>;
  const status = value.statusCode ?? value.status ?? value.response?.statusCode ?? value.response?.status;
  const parsed = typeof status === 'string' ? Number(status) : status;
  return Number.isInteger(parsed) ? parsed : undefined;
}

/** Select non-sensitive resource identity fields from validated tool arguments. */
function resourceContext(args: unknown): Record<string, string> {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return {};
  const value = args as Record<string, unknown>;
  return Object.fromEntries(
    ['kind', 'name', 'namespace']
      .filter((key) => typeof value[key] === 'string')
      .map((key) => [key, String(value[key])])
  );
}

/** Map common Kubernetes client failures to stable, sanitized tool errors. */
export function mapKubernetesError(err: unknown, args?: unknown): ToolExecutionError | undefined {
  const status = kubernetesStatus(err);
  const context = resourceContext(args);
  if (status === 404) {
    return new ToolExecutionError('RESOURCE_NOT_FOUND', 'Kubernetes resource was not found', {
      status: 404,
      reason: 'NotFound',
      ...context,
    });
  }
  if (status === 401 || status === 403) {
    return new ToolExecutionError('KUBERNETES_FORBIDDEN', 'Kubernetes denied access to the requested resource', {
      status,
      reason: status === 401 ? 'Unauthorized' : 'Forbidden',
      ...context,
    });
  }
  const value = err && typeof err === 'object' ? err as Record<string, any> : {};
  const code = String(value.code ?? value.cause?.code ?? '').toUpperCase();
  if (status === 408 || code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT') {
    return new ToolExecutionError('KUBERNETES_TIMEOUT', 'Kubernetes request timed out', {
      ...(status ? { status } : {}),
      reason: 'Timeout',
      ...context,
    });
  }
  if ((status !== undefined && (status === 429 || status >= 500)) ||
      ['ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH', 'ENETUNREACH'].includes(code)) {
    return new ToolExecutionError('KUBERNETES_UNAVAILABLE', 'Kubernetes API is temporarily unavailable', {
      ...(status ? { status } : {}),
      reason: status === 429 ? 'TooManyRequests' : 'Unavailable',
      ...context,
    });
  }
  return undefined;
}

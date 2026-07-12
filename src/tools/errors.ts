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

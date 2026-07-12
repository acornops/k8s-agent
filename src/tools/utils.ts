import { config } from '../config.js';
import { isNamespaceAllowed } from '../runtime/namespace-scope.js';
import { ToolExecutionError } from './errors.js';

/** Throw when write tools are disabled by configuration. */
export function checkWriteEnabled() {
  if (!config.ACORNOPS_AGENT_WRITE_ENABLED) {
    throw new ToolExecutionError('WRITE_DISABLED', 'Write operations are disabled');
  }
}

/** Throw when a namespace is outside the configured namespace scope. */
export function checkNamespaceAllowed(namespace?: string) {
  if (!namespace) return;
  if (!isNamespaceAllowed(namespace)) {
    throw new ToolExecutionError('NAMESPACE_FORBIDDEN', `Namespace is outside the allowed scope: ${namespace}`);
  }
}

/** Build standard AcornOps annotations for a write operation. */
export function getAnnotations(reason: string, operationId?: string) {
  return {
    'acornops.dev/applied-by': `cluster-${config.ACORNOPS_CLUSTER_ID}`,
    'acornops.dev/reason': reason,
    ...(operationId ? { 'acornops.dev/operation-id': operationId } : {}),
  };
}

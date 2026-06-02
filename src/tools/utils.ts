import { config } from '../config.js';
import { getNamespaceScope, isNamespaceAllowed } from '../runtime/namespace-scope.js';

/** Throw when write tools are disabled by configuration. */
export function checkWriteEnabled() {
  if (!config.ACORNOPS_AGENT_WRITE_ENABLED) {
    throw new Error('Write operations are disabled. Set ACORNOPS_AGENT_WRITE_ENABLED=true to enable.');
  }
}

/** Throw when a namespace is outside the configured namespace scope. */
export function checkNamespaceAllowed(namespace?: string) {
  if (!namespace) return;
  if (!isNamespaceAllowed(namespace)) {
    const scope = getNamespaceScope();
    const included = scope.include.length > 0 ? scope.include.join(', ') : 'all non-excluded namespaces';
    const excluded = scope.exclude.length > 0 ? ` Excluded namespaces: ${scope.exclude.join(', ')}.` : '';
    throw new Error(`Namespace '${namespace}' is outside the allowed namespace scope: ${included}.${excluded}`);
  }
}

/** Build standard AcornOps annotations for a write operation. */
export function getAnnotations(reason: string) {
  return {
    'acornops.dev/applied-by': `cluster-${config.ACORNOPS_CLUSTER_ID}`,
    'acornops.dev/reason': reason,
  };
}

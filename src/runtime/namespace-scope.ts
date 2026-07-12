import { config, DEFAULT_EXCLUDED_NAMESPACES } from '../config.js';
import { isKubernetesDnsLabel } from '../k8s/names.js';

export interface NamespaceScope {
  include: string[];
  exclude: string[];
}

/** Normalize an arbitrary namespace list into unique non-empty names. */
function normalizeNamespaceList(value: unknown, field: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 1000) {
    throw new Error(`${field} must be an array of at most 1000 namespaces`);
  }
  const seen = new Set<string>();
  const namespaces: string[] = [];

  for (const item of value) {
    if (typeof item !== 'string') throw new Error(`${field} must contain only namespace strings`);
    const namespace = item.trim();
    if (!isKubernetesDnsLabel(namespace)) throw new Error(`${field} contains an invalid Kubernetes namespace`);
    if (seen.has(namespace)) continue;
    seen.add(namespace);
    namespaces.push(namespace);
  }

  return namespaces;
}

const localMaximumScope: NamespaceScope = {
  include: config.ACORNOPS_AGENT_WATCH_NAMESPACES || [],
  exclude: config.ACORNOPS_AGENT_EXCLUDE_NAMESPACES || []
};

let remoteScope: NamespaceScope = { include: [], exclude: [] };

/** Return whether either authority provides a bounded namespace include-list. */
export function hasBoundedNamespaceInclude(): boolean {
  return localMaximumScope.include.length > 0 || remoteScope.include.length > 0;
}

/** Compute the effective scope without allowing either authority to bypass the other. */
export function computeEffectiveNamespaceScope(local: NamespaceScope, remote: NamespaceScope): NamespaceScope {
  const localInclude = local.include;
  const remoteInclude = remote.include;
  const remoteSet = new Set(remoteInclude);
  const include = localInclude.length === 0
    ? [...remoteInclude]
    : remoteInclude.length === 0
      ? [...localInclude]
      : localInclude.filter((namespace) => remoteSet.has(namespace));
  return {
    include,
    exclude: [...new Set([...DEFAULT_EXCLUDED_NAMESPACES, ...local.exclude, ...remote.exclude])]
  };
}

/** Return the effective intersection of local maximum and remote session scope. */
export function getEffectiveNamespaceScope(): NamespaceScope {
  return computeEffectiveNamespaceScope(localMaximumScope, remoteScope);
}

/** Return a defensive copy of the current namespace scope. */
export function getNamespaceScope(): NamespaceScope {
  return getEffectiveNamespaceScope();
}

/** Replace the current namespace scope and return the normalized result. */
export function setNamespaceScope(scope: unknown): NamespaceScope {
  if (!scope || typeof scope !== 'object' || Array.isArray(scope)) {
    throw new Error('namespaceScope must be an object');
  }
  const value = scope as Record<string, unknown>;
  const unknownFields = Object.keys(value).filter((key) => key !== 'include' && key !== 'exclude');
  if (unknownFields.length > 0) throw new Error(`namespaceScope contains unknown fields: ${unknownFields.join(', ')}`);
  remoteScope = {
    include: normalizeNamespaceList(value.include, 'namespaceScope.include'),
    exclude: normalizeNamespaceList(value.exclude, 'namespaceScope.exclude')
  };
  return getNamespaceScope();
}

/** Clear remote session scope while retaining the local maximum. */
export function clearRemoteNamespaceScope(): NamespaceScope {
  remoteScope = { include: [], exclude: [] };
  return getNamespaceScope();
}

/** Return explicitly watched namespaces after applying exclusions. */
export function getWatchNamespaces(): string[] | undefined {
  const scope = getEffectiveNamespaceScope();
  const excluded = new Set(scope.exclude);
  const included = scope.include.filter((namespace) => !excluded.has(namespace));
  return hasBoundedNamespaceInclude() ? included : undefined;
}

/** Return whether a namespace is currently allowed by include/exclude scope. */
export function isNamespaceAllowed(namespace?: string): boolean {
  if (!namespace) return true;
  const scope = getEffectiveNamespaceScope();
  if (scope.exclude.includes(namespace)) {
    return false;
  }
  return !hasBoundedNamespaceInclude() || scope.include.includes(namespace);
}

/** Return whether namespace or RBAC policy constrains the agent to namespaces. */
export function isNamespaceScoped(): boolean {
  return config.ACORNOPS_AGENT_RBAC_SCOPE === 'namespace' || hasBoundedNamespaceInclude();
}

/** Return whether AgentK should attempt a cluster-scoped read before Kubernetes RBAC. */
export function canAccessClusterScopedKind(kind: string): boolean {
  // Namespace policy has never limited Node visibility. Preserve that behavior
  // and let the Kubernetes API enforce the installation's existing Node RBAC.
  if (kind === 'Node') return true;
  if (kind === 'Namespace') return config.ACORNOPS_AGENT_RBAC_SCOPE !== 'namespace';
  return config.ACORNOPS_AGENT_RBAC_SCOPE !== 'namespace' && !isNamespaceScoped();
}

/** Filter Kubernetes items by namespace scope. */
export function filterNamespaceItems<T>(items: T[], getNamespace: (item: T) => string | undefined): T[] {
  return items.filter((item) => {
    const namespace = getNamespace(item);
    return typeof namespace === 'string' && namespace.length > 0 && isNamespaceAllowed(namespace);
  });
}

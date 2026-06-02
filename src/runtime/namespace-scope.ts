import { config, DEFAULT_EXCLUDED_NAMESPACES } from '../config.js';

export interface NamespaceScope {
  include: string[];
  exclude: string[];
}

/** Normalize an arbitrary namespace list into unique non-empty names. */
function normalizeNamespaceList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const namespaces: string[] = [];

  for (const item of value) {
    const namespace = String(item || '').trim();
    if (!namespace || seen.has(namespace)) continue;
    seen.add(namespace);
    namespaces.push(namespace);
  }

  return namespaces;
}

let currentScope: NamespaceScope = {
  include: config.ACORNOPS_AGENT_WATCH_NAMESPACES || [],
  exclude: []
};

/** Return a defensive copy of the current namespace scope. */
export function getNamespaceScope(): NamespaceScope {
  return {
    include: [...currentScope.include],
    exclude: [...currentScope.exclude]
  };
}

/** Replace the current namespace scope and return the normalized result. */
export function setNamespaceScope(scope: Partial<NamespaceScope>): NamespaceScope {
  currentScope = {
    include: normalizeNamespaceList(scope.include),
    exclude: normalizeNamespaceList(scope.exclude)
  };
  return getNamespaceScope();
}

/** Return explicitly watched namespaces after applying exclusions. */
export function getWatchNamespaces(): string[] | undefined {
  const excluded = new Set([...DEFAULT_EXCLUDED_NAMESPACES, ...currentScope.exclude]);
  const included = currentScope.include.filter((namespace) => !excluded.has(namespace));
  return included.length > 0 ? included : undefined;
}

/** Return whether a namespace is currently allowed by include/exclude scope. */
export function isNamespaceAllowed(namespace?: string): boolean {
  if (!namespace) return true;
  if (DEFAULT_EXCLUDED_NAMESPACES.includes(namespace) || currentScope.exclude.includes(namespace)) {
    return false;
  }
  return currentScope.include.length === 0 || currentScope.include.includes(namespace);
}

/** Filter Kubernetes items by namespace scope. */
export function filterNamespaceItems<T>(items: T[], getNamespace: (item: T) => string | undefined): T[] {
  return items.filter((item) => isNamespaceAllowed(getNamespace(item)));
}

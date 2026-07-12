import { afterEach, describe, expect, it } from 'vitest';
import {
  computeEffectiveNamespaceScope,
  canAccessClusterScopedKind,
  filterNamespaceItems,
  getNamespaceScope,
  getWatchNamespaces,
  isNamespaceAllowed,
  setNamespaceScope
} from './namespace-scope.js';

describe('runtime namespace scope', () => {
  afterEach(() => {
    setNamespaceScope({ include: [], exclude: [] });
  });

  it('applies include and exclude changes without restarting the process', () => {
    setNamespaceScope({ include: ['default', 'payments', 'sandbox'], exclude: ['sandbox'] });

    expect(getNamespaceScope()).toEqual({
      include: ['default', 'payments', 'sandbox'],
      exclude: ['kube-node-lease', 'kube-public', 'sandbox']
    });
    expect(getWatchNamespaces()).toEqual(['default', 'payments']);
    expect(isNamespaceAllowed('default')).toBe(true);
    expect(isNamespaceAllowed('payments')).toBe(true);
    expect(isNamespaceAllowed('sandbox')).toBe(false);
    expect(isNamespaceAllowed('kube-public')).toBe(false);
  });

  it('filters cluster-wide results through runtime exclusions', () => {
    setNamespaceScope({ include: [], exclude: ['staging'] });

    const items = filterNamespaceItems(
      [
        { namespace: 'default' },
        { namespace: 'staging' },
        { namespace: 'kube-node-lease' },
        { namespace: undefined }
      ],
      (item) => item.namespace
    );

    expect(getWatchNamespaces()).toBeUndefined();
    expect(items).toEqual([{ namespace: 'default' }]);
  });

  it('intersects local and remote includes and unions every exclusion', () => {
    expect(computeEffectiveNamespaceScope(
      { include: ['team-a', 'team-b'], exclude: ['local-deny'] },
      { include: ['team-b', 'team-c'], exclude: ['remote-deny'] }
    )).toEqual({
      include: ['team-b'],
      exclude: ['kube-node-lease', 'kube-public', 'local-deny', 'remote-deny'],
    });
  });

  it('rejects malformed namespace policy instead of silently widening scope', () => {
    expect(() => setNamespaceScope({ include: ['team-a'], unexpected: [] })).toThrow('unknown fields');
    expect(() => setNamespaceScope({ include: [42] })).toThrow('namespace strings');
    expect(() => setNamespaceScope({ include: ['Not-A-Namespace'] })).toThrow('invalid Kubernetes namespace');
  });

  it('does not use namespace policy to narrow existing Node visibility', () => {
    setNamespaceScope({ include: ['team-a'], exclude: [] });
    expect(canAccessClusterScopedKind('Node')).toBe(true);
  });
});

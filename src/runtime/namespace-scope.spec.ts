import { afterEach, describe, expect, it } from 'vitest';
import {
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
      exclude: ['sandbox']
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
        { namespace: 'kube-node-lease' }
      ],
      (item) => item.namespace
    );

    expect(getWatchNamespaces()).toBeUndefined();
    expect(items).toEqual([{ namespace: 'default' }]);
  });
});

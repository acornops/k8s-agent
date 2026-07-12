import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../config.js', () => ({
  config: {
    ACORNOPS_AGENT_WRITE_ENABLED: false,
    ACORNOPS_CLUSTER_ID: 'cluster-12345678',
    ACORNOPS_AGENT_KEY: 'agent-key-12345678',
  },
}));

vi.mock('../runtime/namespace-scope.js', () => ({
  isNamespaceAllowed: vi.fn(() => true),
}));

import { config } from '../config.js';
import { isNamespaceAllowed } from '../runtime/namespace-scope.js';
import { checkNamespaceAllowed, checkWriteEnabled, getAnnotations } from './utils.js';

describe('tool utils', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isNamespaceAllowed).mockReturnValue(true);
  });

  it('enforces the write-enabled flag', () => {
    config.ACORNOPS_AGENT_WRITE_ENABLED = false;
    expect(() => checkWriteEnabled()).toThrow('Write operations are disabled');

    config.ACORNOPS_AGENT_WRITE_ENABLED = true;
    expect(() => checkWriteEnabled()).not.toThrow();
  });

  it('allows missing namespaces and rejects disallowed namespaces with scope details', () => {
    expect(() => checkNamespaceAllowed()).not.toThrow();

    vi.mocked(isNamespaceAllowed).mockReturnValue(false);

    expect(() => checkNamespaceAllowed('sandbox')).toThrow('Namespace is outside the allowed scope: sandbox');
  });

  it('builds remediation annotations from the non-secret cluster id', () => {
    expect(getAnnotations('scaling test')).toEqual({
      'acornops.dev/applied-by': 'cluster-cluster-12345678',
      'acornops.dev/reason': 'scaling test',
    });
    expect(getAnnotations('scaling test')['acornops.dev/applied-by']).not.toContain(
      config.ACORNOPS_AGENT_KEY.substring(0, 8),
    );
  });
});

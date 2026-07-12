import { describe, expect, it } from 'vitest';
import { kubernetesNameSchema, namespaceSchema, reasonSchema } from './schemas.js';

describe('tool input schemas', () => {
  it('enforces Kubernetes DNS label and subdomain rules', () => {
    expect(kubernetesNameSchema.safeParse('api.example').success).toBe(true);
    expect(kubernetesNameSchema.safeParse('api..example').success).toBe(false);
    expect(namespaceSchema.safeParse('a'.repeat(64)).success).toBe(false);
    expect(namespaceSchema.safeParse('Team-A').success).toBe(false);
  });

  it('rejects control characters in write reasons', () => {
    expect(reasonSchema.safeParse('approved restart').success).toBe(true);
    expect(reasonSchema.safeParse('approved\nrestart').success).toBe(false);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../config.js', () => ({
  config: {
    ACORNOPS_AGENT_LOG_LEVEL: 'info',
  },
}));

vi.mock('../k8s/client.js', () => ({
  k8sClient: {
    coordination: {},
  },
}));

import { LeaderElector } from './leader-election.js';

interface Lease {
  metadata?: {
    name?: string;
    namespace?: string;
    resourceVersion?: string;
  };
  spec?: {
    holderIdentity?: string;
    leaseDurationSeconds?: number;
    renewTime?: string;
    acquireTime?: string;
    leaseTransitions?: number;
  };
}

function notFound(): Error & { statusCode: number } {
  return Object.assign(new Error('not found'), { statusCode: 404 });
}

class FakeLeaseApi {
  lease: Lease | null = null;
  failReplace: unknown = null;
  readGate: Promise<void> | null = null;
  createCalls = 0;
  replaceCalls = 0;

  async readNamespacedLease(): Promise<Lease> {
    if (this.readGate) await this.readGate;
    if (!this.lease) throw notFound();
    return this.lease;
  }

  async createNamespacedLease(_namespace: string, body: Lease): Promise<Lease> {
    this.createCalls++;
    this.lease = {
      ...body,
      metadata: {
        ...body.metadata,
        resourceVersion: String(this.createCalls + this.replaceCalls),
      },
    };
    return this.lease;
  }

  async replaceNamespacedLease(_name: string, _namespace: string, body: Lease): Promise<Lease> {
    this.replaceCalls++;
    if (this.failReplace) throw this.failReplace;
    if (this.lease?.metadata?.resourceVersion !== body.metadata?.resourceVersion) {
      throw Object.assign(new Error('conflict'), { statusCode: 409 });
    }
    this.lease = {
      ...body,
      metadata: {
        ...body.metadata,
        resourceVersion: String(this.createCalls + this.replaceCalls),
      },
    };
    return this.lease;
  }
}

function elector(api: FakeLeaseApi, callbacks?: { onAcquired?: () => void; onLost?: (reason: string) => void }) {
  return new LeaderElector({
    leaseName: 'agent-leader',
    leaseNamespace: 'acornops',
    holderIdentity: 'pod-uid-1',
    leaseDurationMs: 15000,
    renewDeadlineMs: 2000,
    retryPeriodMs: 1000,
    onAcquired: callbacks?.onAcquired ?? vi.fn(),
    onLost: callbacks?.onLost ?? vi.fn(),
    api,
  });
}

describe('LeaderElector', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-15T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('creates a missing Lease and reports leadership acquired', async () => {
    const api = new FakeLeaseApi();
    const onAcquired = vi.fn();
    const subject = elector(api, { onAcquired });

    subject.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(onAcquired).toHaveBeenCalledTimes(1);
    expect(subject.hasLeadership()).toBe(true);
    expect(api.lease?.spec?.holderIdentity).toBe('pod-uid-1');
  });

  it('stays passive while an unexpired Lease is held by another replica', async () => {
    const api = new FakeLeaseApi();
    api.lease = {
      metadata: { name: 'agent-leader', namespace: 'acornops', resourceVersion: '1' },
      spec: {
        holderIdentity: 'pod-uid-2',
        leaseDurationSeconds: 15,
        renewTime: new Date().toISOString(),
      },
    };
    const onAcquired = vi.fn();
    const subject = elector(api, { onAcquired });

    subject.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(onAcquired).not.toHaveBeenCalled();
    expect(subject.hasLeadership()).toBe(false);
    expect(api.replaceCalls).toBe(0);
  });

  it('takes over an expired Lease', async () => {
    const api = new FakeLeaseApi();
    api.lease = {
      metadata: { name: 'agent-leader', namespace: 'acornops', resourceVersion: '1' },
      spec: {
        holderIdentity: 'pod-uid-2',
        leaseDurationSeconds: 15,
        renewTime: new Date('2026-05-14T23:59:00.000Z').toISOString(),
        leaseTransitions: 3,
      },
    };
    const onAcquired = vi.fn();
    const subject = elector(api, { onAcquired });

    subject.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(onAcquired).toHaveBeenCalledTimes(1);
    expect(api.lease?.spec?.holderIdentity).toBe('pod-uid-1');
    expect(api.lease?.spec?.leaseTransitions).toBe(4);
  });

  it('loses leadership after renew failures exceed the deadline', async () => {
    const api = new FakeLeaseApi();
    api.lease = {
      metadata: { name: 'agent-leader', namespace: 'acornops', resourceVersion: '1' },
      spec: {
        holderIdentity: 'pod-uid-1',
        leaseDurationSeconds: 15,
        renewTime: new Date().toISOString(),
      },
    };
    const onAcquired = vi.fn();
    const onLost = vi.fn();
    const subject = elector(api, { onAcquired, onLost });

    subject.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(onAcquired).toHaveBeenCalledTimes(1);

    api.failReplace = Object.assign(new Error('api down'), { statusCode: 500 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(onLost).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1000);
    expect(onLost).toHaveBeenCalledWith('renew-failed-renew-deadline');
    expect(subject.hasLeadership()).toBe(false);
  });

  it('emits lost and releases the Lease on shutdown', async () => {
    const api = new FakeLeaseApi();
    const onLost = vi.fn();
    const subject = elector(api, { onLost });

    subject.start();
    await vi.advanceTimersByTimeAsync(0);

    await subject.stop();

    expect(onLost).toHaveBeenCalledWith('shutdown');
    expect(subject.hasLeadership()).toBe(false);
    expect(api.lease?.spec?.holderIdentity).toBeUndefined();
  });

  it('does not acquire leadership from a stale API response after stop', async () => {
    let releaseRead!: () => void;
    const api = new FakeLeaseApi();
    api.readGate = new Promise((resolve) => {
      releaseRead = resolve;
    });
    api.lease = {
      metadata: { name: 'agent-leader', namespace: 'acornops', resourceVersion: '1' },
      spec: {
        holderIdentity: 'pod-uid-2',
        leaseDurationSeconds: 15,
        renewTime: new Date('2026-05-14T23:59:00.000Z').toISOString(),
      },
    };
    const onAcquired = vi.fn();
    const subject = elector(api, { onAcquired });

    subject.start();
    await vi.advanceTimersByTimeAsync(0);
    await subject.stop();
    releaseRead();
    await Promise.resolve();

    expect(onAcquired).not.toHaveBeenCalled();
    expect(api.replaceCalls).toBe(0);
    expect(subject.hasLeadership()).toBe(false);
  });
});

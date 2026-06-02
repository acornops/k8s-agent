import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { gzipSync } from 'node:zlib';

const { pendingCollectors, ResourceCollector, MetricsCollector, EventCollector } = vi.hoisted(() => {
  const pendingCollectors: Array<() => void> = [];

  class MockCollector {
    constructor(readonly name: string) {}

    collect = vi.fn(() => new Promise((resolve) => {
      pendingCollectors.push(() => resolve({ ok: this.name }));
    }));
  }

  return {
    pendingCollectors,
    ResourceCollector: class extends MockCollector {
      constructor() {
        super('resources');
      }
    },
    MetricsCollector: class extends MockCollector {
      constructor() {
        super('metrics');
      }
    },
    EventCollector: class extends MockCollector {
      constructor() {
        super('events');
      }
    },
  };
});

vi.mock('../config.js', () => ({
  config: {
    ACORNOPS_AGENT_LOG_LEVEL: 'info',
  },
}));
vi.mock('./collectors/resource-collector.js', () => ({ ResourceCollector }));
vi.mock('./collectors/metrics-collector.js', () => ({ MetricsCollector }));
vi.mock('./collectors/event-collector.js', () => ({ EventCollector }));

import { SnapshotManager } from './snapshot-manager.js';

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

describe('SnapshotManager', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    pendingCollectors.length = 0;
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('does not emit an in-flight snapshot after stop', async () => {
    const sent: Array<Buffer | string> = [];
    const manager = new SnapshotManager((payload) => sent.push(payload), async (payload) => gzipSync(payload));

    manager.start(10);
    await Promise.resolve();
    expect(pendingCollectors).toHaveLength(3);

    manager.stop();
    pendingCollectors.splice(0).forEach((resolve) => resolve());
    await Promise.resolve();
    await Promise.resolve();

    expect(sent).toHaveLength(0);
  });

  it('skips interval snapshots and coalesces one manual snapshot while collection is in flight', async () => {
    const sent: Array<Buffer | string> = [];
    const manager = new SnapshotManager((payload) => sent.push(payload), async (payload) => gzipSync(payload));

    manager.start(10);
    await flushPromises();
    expect(pendingCollectors).toHaveLength(3);

    await vi.advanceTimersByTimeAsync(10_000);
    manager.triggerSnapshot();
    await flushPromises();
    expect(pendingCollectors).toHaveLength(3);

    pendingCollectors.splice(0).forEach((resolve) => resolve());
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    await vi.waitFor(() => expect(pendingCollectors).toHaveLength(3));

    pendingCollectors.splice(0).forEach((resolve) => resolve());
    await vi.waitFor(() => expect(sent).toHaveLength(2));
  });

  it('queues a new initial snapshot when start is called during stale in-flight collection', async () => {
    const sent: Array<Buffer | string> = [];
    const manager = new SnapshotManager((payload) => sent.push(payload), async (payload) => gzipSync(payload));

    manager.start(10);
    await flushPromises();
    expect(pendingCollectors).toHaveLength(3);

    manager.start(10);
    await flushPromises();
    expect(pendingCollectors).toHaveLength(3);

    pendingCollectors.splice(0).forEach((resolve) => resolve());
    await vi.waitFor(() => expect(pendingCollectors).toHaveLength(3));
    expect(sent).toHaveLength(0);

    pendingCollectors.splice(0).forEach((resolve) => resolve());
    await vi.waitFor(() => expect(sent).toHaveLength(1));
  });
});

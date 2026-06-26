import { beforeEach, describe, it, expect, vi } from 'vitest';
import { EventCollector } from './event-collector.js';
import { k8sClient } from '../../k8s/client.js';
import { setNamespaceScope } from '../../runtime/namespace-scope.js';

vi.mock('../../k8s/client.js', () => ({
  k8sClient: {
    core: {
      listEventForAllNamespaces: vi.fn(),
      listNamespacedEvent: vi.fn(),
    },
  }
}));

describe('EventCollector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setNamespaceScope({ include: [], exclude: [] });
  });

  it('should collect trimmed warning events from the last 60 seconds', async () => {
    const now = Date.now();
    const mockEvents = {
      items: [
        {
          involvedObject: { kind: 'Pod', name: 'pod1', namespace: 'default', uid: 'pod-uid-1' },
          reason: 'BackOff',
          message: 'Back-off restarting failed container',
          type: 'Warning',
          count: 3,
          firstTimestamp: new Date(now - 30000).toISOString(),
          lastTimestamp: new Date(now - 10000).toISOString(),
          reportingComponent: 'kubelet',
          metadata: { name: 'event1', uid: 'uid1' }
        },
        {
          involvedObject: { kind: 'Pod', name: 'pod2', namespace: 'default' },
          reason: 'Other',
          message: 'Old event',
          type: 'Warning',
          lastTimestamp: new Date(now - 120000).toISOString(),
        }
      ]
    };

    (k8sClient.core.listEventForAllNamespaces as any).mockResolvedValue(mockEvents);

    const collector = new EventCollector();
    const result = await collector.collect();

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      involvedObject: {
        kind: 'Pod',
        name: 'pod1',
        namespace: 'default',
        uid: 'pod-uid-1',
      },
      reason: 'BackOff',
      message: 'Back-off restarting failed container',
      type: 'Warning',
      count: 3,
      firstTimestamp: expect.any(String),
      lastTimestamp: expect.any(String),
      reportingComponent: 'kubelet',
    });
    expect(result[0].metadata).toBeUndefined();
  });

  it('collects warning events for each configured namespace', async () => {
    setNamespaceScope({ include: ['default', 'payments'], exclude: [] });
    (k8sClient.core.listNamespacedEvent as any).mockImplementation(({ namespace }: { namespace: string }) => ({
      items: [
        {
          involvedObject: { kind: 'Pod', name: `${namespace}-pod`, namespace },
          reason: 'BackOff',
          message: `${namespace} warning`,
          type: 'Warning',
          lastTimestamp: new Date().toISOString(),
        },
      ],
    }));

    const result = await new EventCollector().collect();

    expect(result.map((event: any) => event.involvedObject.namespace)).toEqual(['default', 'payments']);
    expect(k8sClient.core.listNamespacedEvent).toHaveBeenCalledWith({
      namespace: 'default',
      fieldSelector: 'type=Warning',
      limit: 500,
      _continue: undefined,
    });
    expect(k8sClient.core.listNamespacedEvent).toHaveBeenCalledWith({
      namespace: 'payments',
      fieldSelector: 'type=Warning',
      limit: 500,
      _continue: undefined,
    });
  });
});

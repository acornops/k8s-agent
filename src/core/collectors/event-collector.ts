import { k8sClient } from '../../k8s/client.js';
import pino from 'pino';
import { Collector } from '../../types/collector.js';
import { config } from '../../config.js';
import { filterNamespaceItems, getWatchNamespaces } from '../../runtime/namespace-scope.js';
import { listAllPages } from '../../k8s/pagination.js';

const logger = pino({ level: config.ACORNOPS_AGENT_LOG_LEVEL }).child({ module: 'event-collector' });

/**
 * Collector responsible for fetching Warning events from the last 60 seconds.
 */
export class EventCollector implements Collector {
  public name = 'events';

  /** Collect recent warning events from watched namespaces. */
  public async collect(): Promise<any> {
    try {
      const namespaces = getWatchNamespaces();

      let events;
      if (namespaces) {
          const results = await Promise.all(namespaces.map(namespace =>
              listAllPages((options) => k8sClient.core.listNamespacedEvent({
                  ...options,
                  namespace,
                  fieldSelector: `type=Warning`
              }))
          ));
          events = results.flat();
      } else {
          events = await listAllPages((options) =>
              k8sClient.core.listEventForAllNamespaces({
                  ...options,
                  fieldSelector: `type=Warning`
              })
          );
          events = filterNamespaceItems(events, (event) => event.metadata?.namespace || event.involvedObject?.namespace);
      }

      // Filter events newer than 'since' - k8s doesn't support time filtering in fieldSelector easily for all resources
      return events.filter(e => {
          const eventTime = e.lastTimestamp || e.eventTime || e.metadata?.creationTimestamp;
          if (!eventTime) return true;
          return new Date(eventTime as any).getTime() > (Date.now() - 60000);
      }).map(e => ({
          involvedObject: {
              kind: e.involvedObject?.kind,
              name: e.involvedObject?.name,
              namespace: e.involvedObject?.namespace,
          },
          reason: e.reason,
          message: e.message,
          type: e.type,
          lastTimestamp: e.lastTimestamp || e.eventTime || e.metadata?.creationTimestamp,
      }));
    } catch (err) {
      logger.warn({ err }, 'Failed to collect warning events');
      return [];
    }
  }
}

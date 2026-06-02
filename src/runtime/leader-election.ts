import type * as k8s from '@kubernetes/client-node';
import pino from 'pino';
import { config } from '../config.js';
import { k8sClient } from '../k8s/client.js';

const logger = pino({ level: config.ACORNOPS_AGENT_LOG_LEVEL }).child({ module: 'leader-election' });

type Lease = k8s.V1Lease;

interface LeaseApi {
  readNamespacedLease(name: string, namespace: string): Promise<Lease>;
  createNamespacedLease(namespace: string, body: Lease): Promise<Lease>;
  replaceNamespacedLease(name: string, namespace: string, body: Lease): Promise<Lease>;
}

export interface LeaderElectionOptions {
  leaseName: string;
  leaseNamespace: string;
  holderIdentity: string;
  leaseDurationMs: number;
  renewDeadlineMs: number;
  retryPeriodMs: number;
  podName?: string;
  podUid?: string;
  onAcquired: () => void | Promise<void>;
  onLost: (reason: string) => void | Promise<void>;
  api?: LeaseApi;
}

/** Extract an HTTP-like status code from Kubernetes client errors. */
function getErrorStatus(err: unknown): number | undefined {
  const candidate = err as {
    code?: number;
    statusCode?: number;
    response?: { statusCode?: number; status?: number };
  };
  return candidate.statusCode ?? candidate.code ?? candidate.response?.statusCode ?? candidate.response?.status;
}

/** Return the current time in Kubernetes MicroTime shape. */
function nowMicro(): k8s.V1MicroTime {
  return new Date() as k8s.V1MicroTime;
}

/** Return the latest renew or acquire timestamp for a Lease. */
function leaseRenewedAtMs(lease: Lease): number {
  const timestamp = lease.spec?.renewTime ?? lease.spec?.acquireTime;
  if (!timestamp) return 0;
  const parsed = timestamp instanceof Date
    ? timestamp.getTime()
    : new Date(timestamp as unknown as string).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Kubernetes Lease-based active-passive election. Leadership is fail-closed:
 * if renews cannot be confirmed within the renew deadline, the active runtime
 * is stopped and can only restart after a fresh successful acquire/renew.
 */
export class LeaderElector {
  private readonly api: LeaseApi;
  private stopped = true;
  private isLeader = false;
  private timer: NodeJS.Timeout | null = null;
  private tickInFlight = false;
  private lastSuccessfulRenewMs = 0;

  /** Initialize a Lease-backed leader elector. */
  constructor(private readonly options: LeaderElectionOptions) {
    this.api = options.api ?? {
      readNamespacedLease: (name, namespace) => k8sClient.coordination.readNamespacedLease({ name, namespace }),
      createNamespacedLease: (namespace, body) => k8sClient.coordination.createNamespacedLease({ namespace, body }),
      replaceNamespacedLease: (name, namespace, body) => k8sClient.coordination.replaceNamespacedLease({ name, namespace, body }),
    };
  }

  /** Start attempting to acquire or renew leadership. */
  public start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    logger.info(this.logFields(), 'Starting leader election');
    this.schedule(0);
  }

  /** Stop election and release leadership when held. */
  public async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    this.clearTimer();
    const wasLeader = this.isLeader;
    this.isLeader = false;

    if (wasLeader) {
      await this.emitLost('shutdown');
      await this.releaseLease();
    }
  }

  /** Return whether this replica currently holds leadership. */
  public hasLeadership(): boolean {
    return this.isLeader;
  }

  private schedule(delayMs: number): void {
    this.clearTimer();
    this.timer = setTimeout(() => {
      void this.tick();
    }, delayMs);
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private async tick(): Promise<void> {
    if (this.stopped || this.tickInFlight) return;
    this.tickInFlight = true;

    try {
      await this.tryAcquireOrRenew();
    } finally {
      this.tickInFlight = false;
      if (!this.stopped) {
        this.schedule(this.options.retryPeriodMs);
      }
    }
  }

  private async tryAcquireOrRenew(): Promise<void> {
    let lease: Lease | null = null;
    try {
      lease = await this.api.readNamespacedLease(this.options.leaseName, this.options.leaseNamespace);
    } catch (err) {
      if (this.stopped) return;
      if (getErrorStatus(err) === 404) {
        await this.createLease();
        return;
      }
      await this.handleApiFailure(err, 'read');
      return;
    }
    if (this.stopped) return;

    const holder = lease.spec?.holderIdentity || '';
    if (holder === this.options.holderIdentity) {
      await this.renewLease(lease, false);
      return;
    }

    if (this.isLeader) {
      await this.loseLeadership(`lease-held-by-${holder || 'empty'}`);
    }

    if (!holder || this.isExpired(lease)) {
      await this.renewLease(lease, true);
      return;
    }

    logger.debug({ ...this.logFields(), currentHolder: holder }, 'Lease is held by another replica');
  }

  private async createLease(): Promise<void> {
    const body = this.buildLease();

    try {
      const created = await this.api.createNamespacedLease(this.options.leaseNamespace, body);
      if (this.stopped) return;
      await this.markRenewed(created, 'created');
    } catch (err) {
      if (this.stopped) return;
      const status = getErrorStatus(err);
      if (status === 409) {
        logger.debug(this.logFields(), 'Lease was created by another replica');
        return;
      }
      await this.handleApiFailure(err, 'create');
    }
  }

  private async renewLease(existing: Lease, transition: boolean): Promise<void> {
    const body = this.buildLease(existing, transition);

    try {
      const renewed = await this.api.replaceNamespacedLease(
        this.options.leaseName,
        this.options.leaseNamespace,
        body
      );
      if (this.stopped) return;
      await this.markRenewed(renewed, transition ? 'acquired' : 'renewed');
    } catch (err) {
      if (this.stopped) return;
      const status = getErrorStatus(err);
      if (status === 409 && this.isLeader) {
        await this.loseLeadership('lease-update-conflict');
        return;
      }
      await this.handleApiFailure(err, transition ? 'acquire' : 'renew');
    }
  }

  private buildLease(existing?: Lease, transition = false): Lease {
    const priorTransitions = existing?.spec?.leaseTransitions ?? 0;
    const leaseTransitions = transition ? priorTransitions + 1 : priorTransitions;

    return {
      apiVersion: 'coordination.k8s.io/v1',
      kind: 'Lease',
      metadata: {
        name: this.options.leaseName,
        namespace: this.options.leaseNamespace,
        resourceVersion: existing?.metadata?.resourceVersion,
      },
      spec: {
        holderIdentity: this.options.holderIdentity,
        leaseDurationSeconds: Math.ceil(this.options.leaseDurationMs / 1000),
        acquireTime: transition || !existing?.spec?.acquireTime ? nowMicro() : existing.spec.acquireTime,
        renewTime: nowMicro(),
        leaseTransitions,
      },
    };
  }

  private isExpired(lease: Lease): boolean {
    const renewedAt = leaseRenewedAtMs(lease);
    if (renewedAt === 0) return true;
    const durationSeconds = lease.spec?.leaseDurationSeconds ?? Math.ceil(this.options.leaseDurationMs / 1000);
    return Date.now() - renewedAt > durationSeconds * 1000;
  }

  private async markRenewed(lease: Lease, action: 'created' | 'acquired' | 'renewed'): Promise<void> {
    this.lastSuccessfulRenewMs = leaseRenewedAtMs(lease) || Date.now();
    if (!this.isLeader) {
      this.isLeader = true;
      logger.info({ ...this.logFields(), action }, 'Lease acquired');
      await this.options.onAcquired();
      return;
    }

    logger.debug({ ...this.logFields(), action }, 'Lease renewed');
  }

  private async handleApiFailure(err: unknown, operation: string): Promise<void> {
    logger.warn({ ...this.logFields(), err, operation }, 'Leader election API operation failed');
    if (!this.isLeader) return;

    const elapsed = Date.now() - this.lastSuccessfulRenewMs;
    if (elapsed >= this.options.renewDeadlineMs) {
      await this.loseLeadership(`${operation}-failed-renew-deadline`);
    }
  }

  private async loseLeadership(reason: string): Promise<void> {
    if (!this.isLeader) return;
    this.isLeader = false;
    logger.warn({ ...this.logFields(), reason }, 'Lease lost');
    await this.emitLost(reason);
  }

  private async emitLost(reason: string): Promise<void> {
    await this.options.onLost(reason);
  }

  private async releaseLease(): Promise<void> {
    try {
      const lease = await this.api.readNamespacedLease(this.options.leaseName, this.options.leaseNamespace);
      if (lease.spec?.holderIdentity !== this.options.holderIdentity) return;

      const released: Lease = {
        ...lease,
        spec: {
          ...lease.spec,
          holderIdentity: undefined,
          renewTime: nowMicro(),
        },
      };
      await this.api.replaceNamespacedLease(this.options.leaseName, this.options.leaseNamespace, released);
      logger.info(this.logFields(), 'Lease released');
    } catch (err) {
      logger.warn({ ...this.logFields(), err }, 'Failed to release Lease during shutdown');
    }
  }

  private logFields(): Record<string, string | number | undefined> {
    return {
      leaseName: this.options.leaseName,
      leaseNamespace: this.options.leaseNamespace,
      holderIdentity: this.options.holderIdentity,
      podName: this.options.podName,
      podUid: this.options.podUid,
    };
  }
}

import { config } from '../config.js';

export class AsyncLimiter {
  private active = 0;
  private readonly queue: Array<() => void> = [];

  /** Initialize a concurrency limiter with a dynamic limit provider. */
  constructor(private readonly getLimit: () => number) {}

  /** Queue and run an asynchronous operation within the concurrency limit. */
  public run<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const task = () => {
        this.active += 1;
        void Promise.resolve()
          .then(fn)
          .then(resolve, reject)
          .finally(() => {
            this.active -= 1;
            this.drain();
          });
      };

      this.queue.push(task);
      this.drain();
    });
  }

  private drain(): void {
    const limit = Math.max(1, Math.floor(this.getLimit()));
    while (this.active < limit && this.queue.length > 0) {
      const next = this.queue.shift();
      if (!next) return;
      next();
    }
  }
}

const k8sApiLimiter = new AsyncLimiter(() => config.ACORNOPS_AGENT_K8S_CONCURRENCY ?? 8);

/** Run a Kubernetes API request through the shared concurrency limiter. */
export function withK8sApiLimit<T>(fn: () => Promise<T>): Promise<T> {
  return k8sApiLimiter.run(fn);
}

import { describe, expect, it } from 'vitest';
import { AsyncLimiter } from './api-limiter.js';

describe('AsyncLimiter', () => {
  it('does not exceed the configured concurrency', async () => {
    const limiter = new AsyncLimiter(() => 2);
    let active = 0;
    let maxActive = 0;

    await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        limiter.run(async () => {
          active += 1;
          maxActive = Math.max(maxActive, active);
          await new Promise((resolve) => setTimeout(resolve, 1));
          active -= 1;
          return index;
        })
      )
    );

    expect(maxActive).toBeLessThanOrEqual(2);
  });
});

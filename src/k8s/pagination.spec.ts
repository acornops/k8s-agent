import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../config.js', () => ({
  config: {
    ACORNOPS_AGENT_K8S_CONCURRENCY: 4,
    ACORNOPS_AGENT_K8S_LIST_PAGE_LIMIT: 2,
  },
}));

import { listAllPages } from './pagination.js';

describe('listAllPages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('accumulates all pages and passes continuation tokens', async () => {
    const fetchPage = vi.fn()
      .mockResolvedValueOnce({ items: ['a', 'b'], metadata: { _continue: 'next' } })
      .mockResolvedValueOnce({ items: ['c'], metadata: {} });

    await expect(listAllPages(fetchPage)).resolves.toEqual(['a', 'b', 'c']);
    expect(fetchPage).toHaveBeenNthCalledWith(1, { limit: 2, _continue: undefined });
    expect(fetchPage).toHaveBeenNthCalledWith(2, { limit: 2, _continue: 'next' });
  });
});

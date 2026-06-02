import { config } from '../config.js';
import { withK8sApiLimit } from './api-limiter.js';

export interface ListPageOptions {
  limit?: number;
  _continue?: string;
}

export interface ListPage<T> {
  items?: T[];
  metadata?: {
    _continue?: string;
  };
}

/** Fetch all Kubernetes list pages using continue tokens. */
export async function listAllPages<T>(
  fetchPage: (options: ListPageOptions) => Promise<ListPage<T>>
): Promise<T[]> {
  const items: T[] = [];
  let continueToken: string | undefined;
  const limit = config.ACORNOPS_AGENT_K8S_LIST_PAGE_LIMIT ?? 500;

  do {
    const page = await withK8sApiLimit(() => fetchPage({ limit, _continue: continueToken }));
    items.push(...(page.items || []));
    continueToken = page.metadata?._continue || undefined;
  } while (continueToken);

  return items;
}

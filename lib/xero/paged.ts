/**
 * Paged, rate-limit-aware fetching for Xero list endpoints.
 *
 * Nothing in this build paginates today: `getAccounts` is called once and
 * whatever came back is treated as the whole set. That is fine for a chart of
 * accounts and wrong for invoices, contacts, bank transactions and journals,
 * which is what Modules E, F, G, I and L all need. Five module plans each
 * budgeted their own version of this; five implementations means five
 * different backoff bugs against the client's real tenants.
 *
 * Xero's documented limits are 60 calls per minute and 5,000 per day per
 * tenant. A run that hits the cap stops and reports partial rather than
 * failing outright, because half a sync that says so is more useful than no
 * sync at all, and `sync_runs.status` already distinguishes the two.
 */

/** Xero returns at most 100 records per page on the endpoints that paginate. */
export const XERO_PAGE_SIZE = 100;

/**
 * Default ceiling on calls per run. Well under the 60/min limit, leaving room
 * for the other calls a sync makes and for a second sync running concurrently.
 */
export const DEFAULT_CALL_CAP = 40;

export interface PageRequest {
  page: number;
  /** Passed as `If-Modified-Since`. Only records changed after this are returned. */
  modifiedAfter?: Date;
}

export interface PagedResult<T> {
  items: T[];
  /** Calls actually made, including retries. */
  callsUsed: number;
  /** True when the cap stopped the loop before the data ran out. */
  capped: boolean;
  /** Pages that were retried after a 429, for the sync run detail. */
  rateLimitRetries: number;
}

export interface PagedOptions {
  callCap?: number;
  modifiedAfter?: Date;
  /** Retries per page after a 429. Beyond this the error propagates. */
  maxRetriesPerPage?: number;
  /** Injected so tests do not wait in real time. */
  sleep?: (ms: number) => Promise<void>;
}

/** Xero sends `Retry-After` in seconds. Absent or unparseable falls back to 60. */
export function retryAfterMs(headers: Record<string, unknown> | undefined): number {
  const raw = headers?.["retry-after"] ?? headers?.["Retry-After"];
  const seconds = Number(Array.isArray(raw) ? raw[0] : raw);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 60_000;
}

/** A 429 from Xero, however the SDK happens to surface the status. */
export function isRateLimited(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { statusCode?: number; status?: number; response?: { statusCode?: number } };
  return e.statusCode === 429 || e.status === 429 || e.response?.statusCode === 429;
}

function headersOf(err: unknown): Record<string, unknown> | undefined {
  if (!err || typeof err !== "object") return undefined;
  const e = err as { response?: { headers?: Record<string, unknown> } };
  return e.response?.headers;
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Walks pages until a short page, an empty page, or the call cap.
 *
 * `fetchPage` receives a 1-based page number and returns that page's records.
 * A page shorter than XERO_PAGE_SIZE is the last one, which is how Xero
 * signals the end; there is no total count to rely on.
 */
export async function fetchAllPages<T>(
  fetchPage: (request: PageRequest) => Promise<T[]>,
  options: PagedOptions = {}
): Promise<PagedResult<T>> {
  const callCap = options.callCap ?? DEFAULT_CALL_CAP;
  const maxRetries = options.maxRetriesPerPage ?? 2;
  const sleep = options.sleep ?? realSleep;

  const items: T[] = [];
  let callsUsed = 0;
  let rateLimitRetries = 0;
  let page = 1;

  while (callsUsed < callCap) {
    let pageItems: T[] | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      // A retry is a call. Counting it is what stops a rate-limited run from
      // spinning past the cap while making no progress.
      if (callsUsed >= callCap) break;

      try {
        callsUsed += 1;
        pageItems = await fetchPage({ page, modifiedAfter: options.modifiedAfter });
        break;
      } catch (err) {
        if (!isRateLimited(err) || attempt === maxRetries) throw err;
        rateLimitRetries += 1;
        await sleep(retryAfterMs(headersOf(err)));
      }
    }

    // The cap was reached mid-retry, so this page never completed.
    if (pageItems === null) {
      return { items, callsUsed, capped: true, rateLimitRetries };
    }

    items.push(...pageItems);

    // Short page means the data ran out, which is the only end signal Xero gives.
    if (pageItems.length < XERO_PAGE_SIZE) {
      return { items, callsUsed, capped: false, rateLimitRetries };
    }

    page += 1;
  }

  // Left the loop on the cap with a full last page, so there is more to fetch.
  return { items, callsUsed, capped: true, rateLimitRetries };
}

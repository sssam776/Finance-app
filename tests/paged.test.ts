import { describe, it, expect } from "vitest";
import {
  fetchAllPages,
  retryAfterMs,
  isRateLimited,
  XERO_PAGE_SIZE,
  DEFAULT_CALL_CAP,
} from "../lib/xero/paged";

/** Never actually waits. A real backoff would make the suite take minutes. */
const noSleep = async () => {};

/** A source of `total` records served in Xero-sized pages. */
function pagedSource(total: number) {
  const calls: number[] = [];
  return {
    calls,
    fetchPage: async ({ page }: { page: number }) => {
      calls.push(page);
      const start = (page - 1) * XERO_PAGE_SIZE;
      return Array.from(
        { length: Math.max(0, Math.min(XERO_PAGE_SIZE, total - start)) },
        (_, i) => start + i
      );
    },
  };
}

function rateLimitError(retryAfterSeconds?: number) {
  return {
    statusCode: 429,
    response: {
      headers: retryAfterSeconds === undefined ? {} : { "retry-after": String(retryAfterSeconds) },
    },
  };
}

describe("isRateLimited", () => {
  it("recognises a 429 however the SDK surfaces it", () => {
    expect(isRateLimited({ statusCode: 429 })).toBe(true);
    expect(isRateLimited({ status: 429 })).toBe(true);
    expect(isRateLimited({ response: { statusCode: 429 } })).toBe(true);
  });

  it("does not treat other failures as rate limiting", () => {
    // Retrying a 401 or a 500 on a backoff loop wastes the call budget and
    // delays a real error the operator needs to see.
    expect(isRateLimited({ statusCode: 500 })).toBe(false);
    expect(isRateLimited({ statusCode: 401 })).toBe(false);
    expect(isRateLimited(new Error("network"))).toBe(false);
    expect(isRateLimited(null)).toBe(false);
    expect(isRateLimited(undefined)).toBe(false);
  });
});

describe("retryAfterMs", () => {
  it("honours the header Xero sends, in seconds", () => {
    expect(retryAfterMs({ "retry-after": "30" })).toBe(30_000);
  });

  it("accepts the capitalised spelling", () => {
    expect(retryAfterMs({ "Retry-After": "5" })).toBe(5_000);
  });

  it("falls back to a minute when the header is missing or unusable", () => {
    // Xero's window is per minute, so a minute is the safe assumption.
    expect(retryAfterMs(undefined)).toBe(60_000);
    expect(retryAfterMs({})).toBe(60_000);
    expect(retryAfterMs({ "retry-after": "not-a-number" })).toBe(60_000);
    expect(retryAfterMs({ "retry-after": "-5" })).toBe(60_000);
  });
});

describe("fetchAllPages", () => {
  it("returns everything from a single short page", async () => {
    const source = pagedSource(42);
    const result = await fetchAllPages(source.fetchPage, { sleep: noSleep });

    expect(result.items).toHaveLength(42);
    expect(result.capped).toBe(false);
    expect(source.calls).toEqual([1]);
  });

  it("walks pages until the data runs out", async () => {
    const source = pagedSource(250);
    const result = await fetchAllPages(source.fetchPage, { sleep: noSleep });

    expect(result.items).toHaveLength(250);
    expect(source.calls).toEqual([1, 2, 3]);
    expect(result.capped).toBe(false);
  });

  it("makes one extra call when the total is an exact multiple of the page size", async () => {
    // A full page is indistinguishable from more data, so the loop must ask
    // again and get an empty page. Stopping early would silently truncate.
    const source = pagedSource(200);
    const result = await fetchAllPages(source.fetchPage, { sleep: noSleep });

    expect(result.items).toHaveLength(200);
    expect(source.calls).toEqual([1, 2, 3]);
  });

  it("handles an empty result set", async () => {
    const source = pagedSource(0);
    const result = await fetchAllPages(source.fetchPage, { sleep: noSleep });

    expect(result.items).toEqual([]);
    expect(result.capped).toBe(false);
  });

  it("stops at the call cap and reports it rather than running on", async () => {
    const source = pagedSource(10_000);
    const result = await fetchAllPages(source.fetchPage, { callCap: 3, sleep: noSleep });

    expect(result.callsUsed).toBe(3);
    expect(result.capped).toBe(true);
    expect(result.items).toHaveLength(300);
  });

  it("returns what it collected when capped, not nothing", async () => {
    // The caller marks the sync run partial. Half a sync that says so beats
    // no sync at all.
    const source = pagedSource(10_000);
    const result = await fetchAllPages(source.fetchPage, { callCap: 2, sleep: noSleep });
    expect(result.items.length).toBeGreaterThan(0);
  });

  it("retries a rate-limited page and then succeeds", async () => {
    let attempts = 0;
    const result = await fetchAllPages(
      async () => {
        attempts += 1;
        if (attempts === 1) throw rateLimitError(1);
        return [1, 2, 3];
      },
      { sleep: noSleep }
    );

    expect(result.items).toEqual([1, 2, 3]);
    expect(result.rateLimitRetries).toBe(1);
    expect(result.callsUsed).toBe(2);
  });

  it("gives up after the retry limit and propagates the 429", async () => {
    await expect(
      fetchAllPages(
        async () => {
          throw rateLimitError(1);
        },
        { maxRetriesPerPage: 2, sleep: noSleep }
      )
    ).rejects.toMatchObject({ statusCode: 429 });
  });

  it("counts retries against the call cap so a throttled run cannot spin", async () => {
    // Without counting retries, a tenant returning 429 forever would loop
    // making calls and never reach the cap.
    let calls = 0;
    const result = await fetchAllPages(
      async () => {
        calls += 1;
        throw rateLimitError(1);
      },
      { callCap: 3, maxRetriesPerPage: 99, sleep: noSleep }
    );

    expect(calls).toBeLessThanOrEqual(3);
    expect(result.capped).toBe(true);
  });

  it("does not retry a non-429 error", async () => {
    let calls = 0;
    await expect(
      fetchAllPages(
        async () => {
          calls += 1;
          throw { statusCode: 500 };
        },
        { sleep: noSleep }
      )
    ).rejects.toMatchObject({ statusCode: 500 });

    expect(calls).toBe(1);
  });

  it("waits for the interval Xero asked for", async () => {
    const waits: number[] = [];
    let attempts = 0;

    await fetchAllPages(
      async () => {
        attempts += 1;
        if (attempts === 1) throw rateLimitError(17);
        return [];
      },
      { sleep: async (ms) => void waits.push(ms) }
    );

    expect(waits).toEqual([17_000]);
  });

  it("passes the modified-after watermark to every page", async () => {
    const seen: (Date | undefined)[] = [];
    const since = new Date("2026-01-01T00:00:00Z");
    const source = pagedSource(150);

    await fetchAllPages(
      async (req) => {
        seen.push(req.modifiedAfter);
        return source.fetchPage(req);
      },
      { modifiedAfter: since, sleep: noSleep }
    );

    expect(seen).toHaveLength(2);
    expect(seen.every((d) => d === since)).toBe(true);
  });

  it("defaults to a cap well under Xero's per-minute limit", () => {
    expect(DEFAULT_CALL_CAP).toBeLessThan(60);
  });
});

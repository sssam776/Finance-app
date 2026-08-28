import { describe, it, expect } from "vitest";
import {
  daysUntil,
  urgencyOf,
  expiryWatch,
  valueWithin,
  BOARD_HORIZON_DAYS,
  type FacilityEventLike,
} from "../lib/portfolio/expiry";

const AS_OF = "2026-08-26";

function event(over: Partial<FacilityEventLike> = {}): FacilityEventLike {
  const base: FacilityEventLike = {
    facilityId: "fac-1",
    facilityReference: "ASB-001",
    lenderName: "ASB",
    entityShortCode: "KAYO",
    eventType: "term_expiry",
    eventDate: "2026-12-01",
    amount: "1000000.00",
    currency: "NZD",
    confirmed: false,
  };
  // A caller that names a reference without an id means a distinct facility,
  // which is what most of these cases are describing.
  const derived = over.facilityReference && !over.facilityId
    ? { facilityId: `fac-${over.facilityReference}` }
    : {};
  return { ...base, ...derived, ...over };
}

describe("daysUntil", () => {
  it("counts forward to a future date", () => {
    expect(daysUntil("2026-09-02", AS_OF)).toBe(7);
  });

  it("is zero on the day itself", () => {
    expect(daysUntil(AS_OF, AS_OF)).toBe(0);
  });

  it("goes negative once the date has passed", () => {
    expect(daysUntil("2026-08-19", AS_OF)).toBe(-7);
  });

  it("crosses a year boundary correctly", () => {
    expect(daysUntil("2027-08-26", AS_OF)).toBe(365);
  });
});

describe("urgencyOf", () => {
  it("calls a passed date overdue", () => {
    expect(urgencyOf(-1)).toBe("overdue");
    expect(urgencyOf(-400)).toBe("overdue");
  });

  it("treats the day itself as urgent, not overdue", () => {
    // A facility maturing today has not been missed. Reading it as overdue
    // would put a routine roll into the same band as a genuine lapse.
    expect(urgencyOf(0)).toBe("urgent");
  });

  it("bands three, twelve and eighteen months", () => {
    expect(urgencyOf(92)).toBe("urgent");
    expect(urgencyOf(93)).toBe("soon");
    expect(urgencyOf(365)).toBe("soon");
    expect(urgencyOf(366)).toBe("soon");
    expect(urgencyOf(367)).toBe("watch");
    expect(urgencyOf(549)).toBe("watch");
    expect(urgencyOf(550)).toBe("distant");
  });

  it("keeps a twelve-month anniversary inside the twelve-month band across a leap day", () => {
    /**
     * 2027-08-26 to 2028-08-26 is 366 days because 29 February falls between.
     * At a 365-day horizon the facility expiring on its own anniversary
     * dropped out of the figure headed "within twelve months".
     */
    const anniversary = daysUntil("2028-08-26", "2027-08-26");
    expect(anniversary).toBe(366);
    expect(urgencyOf(anniversary)).toBe("soon");

    const rows = expiryWatch(
      [event({ eventDate: "2028-08-26", amount: "4000000.00" })],
      "2027-08-26"
    );
    expect(valueWithin(rows, BOARD_HORIZON_DAYS)).toEqual([
      { currency: "NZD", amount: "4000000.00", facilityCount: 1 },
    ]);
  });
});

describe("expiryWatch", () => {
  it("orders soonest first, with overdue ahead of everything", () => {
    const rows = expiryWatch(
      [
        event({ facilityReference: "C", eventDate: "2027-06-01" }),
        event({ facilityReference: "A", eventDate: "2026-05-01" }),
        event({ facilityReference: "B", eventDate: "2026-10-01" }),
      ],
      AS_OF
    );
    expect(rows.map((r) => r.facilityReference)).toEqual(["A", "B", "C"]);
    expect(rows[0]!.urgency).toBe("overdue");
  });

  it("keeps distant events rather than dropping them", () => {
    // Filtering is the caller's decision. A facility removed here is one
    // nobody ever sees.
    const rows = expiryWatch([event({ eventDate: "2030-01-01" })], AS_OF);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.urgency).toBe("distant");
  });

  it("breaks a tie on the same date by reference, so the order is stable", () => {
    const rows = expiryWatch(
      [
        event({ facilityReference: "BNZ-2", eventDate: "2026-10-01" }),
        event({ facilityReference: "BNZ-1", eventDate: "2026-10-01" }),
      ],
      AS_OF
    );
    expect(rows.map((r) => r.facilityReference)).toEqual(["BNZ-1", "BNZ-2"]);
  });

  it("carries the confirmed flag through", () => {
    // A past term-expiry date is usually a facility that was rolled and never
    // recorded, not a default. The distinction has to survive to the screen.
    const rows = expiryWatch([event({ eventDate: "2026-01-01", confirmed: true })], AS_OF);
    expect(rows[0]!.urgency).toBe("overdue");
    expect(rows[0]!.confirmed).toBe(true);
  });

  it("returns nothing for no events", () => {
    expect(expiryWatch([], AS_OF)).toEqual([]);
  });
});

describe("valueWithin", () => {
  it("totals the debt maturing inside the horizon", () => {
    const rows = expiryWatch(
      [
        event({ facilityReference: "A", eventDate: "2026-10-01", amount: "5000000.00" }),
        event({ facilityReference: "B", eventDate: "2027-01-01", amount: "7000000.00" }),
        event({ facilityReference: "C", eventDate: "2029-01-01", amount: "9000000.00" }),
      ],
      AS_OF
    );
    expect(valueWithin(rows, BOARD_HORIZON_DAYS)).toEqual([
      { currency: "NZD", amount: "12000000.00", facilityCount: 2 },
    ]);
  });

  it("counts a facility once even when it has several events in the horizon", () => {
    // A loan with both a rate re-fix and a term expiry inside twelve months
    // exposes its balance once. Adding both would report twice the debt at
    // risk, which is the number a board would act on.
    const rows = expiryWatch(
      [
        event({ facilityId: "f1", facilityReference: "A", eventType: "rate_refix", eventDate: "2026-10-01", amount: "5000000.00" }),
        event({ facilityId: "f1", facilityReference: "A", eventType: "term_expiry", eventDate: "2026-12-01", amount: "5000000.00" }),
      ],
      AS_OF
    );
    expect(valueWithin(rows, BOARD_HORIZON_DAYS)).toEqual([
      { currency: "NZD", amount: "5000000.00", facilityCount: 1 },
    ]);
  });

  it("keeps two lenders' identical references apart", () => {
    /**
     * References are unique only per lender, and short ones are the norm.
     * Keying the dedupe on the reference made ASB "1" and BNZ "1" the same
     * facility: whichever event sorted first won and the other balance was
     * silently dropped, understating the board figure by the whole amount.
     */
    const rows = expiryWatch(
      [
        event({ facilityId: "asb-1", facilityReference: "1", lenderName: "ASB", eventDate: "2026-12-01", amount: "5000000.00" }),
        event({ facilityId: "bnz-1", facilityReference: "1", lenderName: "BNZ", eventDate: "2026-11-01", amount: "7000000.00" }),
      ],
      AS_OF
    );
    expect(valueWithin(rows, BOARD_HORIZON_DAYS)).toEqual([
      { currency: "NZD", amount: "12000000.00", facilityCount: 2 },
    ]);
  });

  it("keeps two entities' identical references apart", () => {
    // Two SPVs each holding an ASB facility referenced "1" is ordinary in a
    // property group.
    const rows = expiryWatch(
      [
        event({ facilityId: "kayo-1", facilityReference: "1", entityShortCode: "KAYO", amount: "2000000.00" }),
        event({ facilityId: "kerrs-1", facilityReference: "1", entityShortCode: "KERRS", amount: "3000000.00" }),
      ],
      AS_OF
    );
    expect(valueWithin(rows, BOARD_HORIZON_DAYS)).toEqual([
      { currency: "NZD", amount: "5000000.00", facilityCount: 2 },
    ]);
  });

  it("includes overdue facilities in the total", () => {
    // An expiry already passed is more at risk than one approaching, not less.
    const rows = expiryWatch(
      [event({ facilityReference: "A", eventDate: "2026-01-01", amount: "3000000.00" })],
      AS_OF
    );
    expect(valueWithin(rows, BOARD_HORIZON_DAYS)[0]!.amount).toBe("3000000.00");
  });

  it("reports each currency separately and never sums across them", () => {
    const rows = expiryWatch(
      [
        event({ facilityReference: "A", amount: "1000.00", currency: "NZD" }),
        event({ facilityReference: "B", amount: "2000.00", currency: "AUD" }),
      ],
      AS_OF
    );
    expect(valueWithin(rows, BOARD_HORIZON_DAYS)).toEqual([
      { currency: "AUD", amount: "2000.00", facilityCount: 1 },
      { currency: "NZD", amount: "1000.00", facilityCount: 1 },
    ]);
  });

  it("returns nothing when everything sits beyond the horizon", () => {
    const rows = expiryWatch([event({ eventDate: "2031-01-01" })], AS_OF);
    expect(valueWithin(rows, BOARD_HORIZON_DAYS)).toEqual([]);
  });
});

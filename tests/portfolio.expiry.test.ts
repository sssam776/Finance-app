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
  return {
    facilityReference: "ASB-001",
    lenderName: "ASB",
    entityShortCode: "KAYO",
    eventType: "term_expiry",
    eventDate: "2026-12-01",
    amount: "1000000.00",
    currency: "NZD",
    confirmed: false,
    ...over,
  };
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
    expect(urgencyOf(366)).toBe("watch");
    expect(urgencyOf(548)).toBe("watch");
    expect(urgencyOf(549)).toBe("distant");
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
        event({ facilityReference: "A", eventType: "rate_refix", eventDate: "2026-10-01", amount: "5000000.00" }),
        event({ facilityReference: "A", eventType: "term_expiry", eventDate: "2026-12-01", amount: "5000000.00" }),
      ],
      AS_OF
    );
    expect(valueWithin(rows, BOARD_HORIZON_DAYS)).toEqual([
      { currency: "NZD", amount: "5000000.00", facilityCount: 1 },
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

import { describe, it, expect } from "vitest";
import {
  isFavourable,
  computeMovements,
  rankByMateriality,
  summariseMovements,
  type PlRow,
} from "../lib/variance/plMovement";
import { resolveThreshold, type ThresholdRow } from "../lib/thresholds";

const THRESHOLD_ROWS: ThresholdRow[] = [
  { entityId: "*", context: "pnl_movement", absoluteAmount: "1000.00", percent: "10.00" },
];
const threshold = resolveThreshold(THRESHOLD_ROWS, "e1", "pnl_movement");

const revenue = (name: string, amount: string): PlRow => ({
  accountCode: null,
  accountName: name,
  sectionKind: "revenue",
  amount,
});

const expense = (name: string, amount: string): PlRow => ({
  accountCode: null,
  accountName: name,
  sectionKind: "operating_expense",
  amount,
});

describe("isFavourable — the sign convention", () => {
  it("treats revenue rising as good news", () => {
    expect(isFavourable("revenue", "500.00")).toBe(true);
  });

  it("treats revenue falling as bad news", () => {
    expect(isFavourable("revenue", "-500.00")).toBe(false);
  });

  it("treats cost rising as bad news", () => {
    // The inversion this module exists for. Arithmetically identical to
    // revenue rising, opposite in meaning.
    expect(isFavourable("operating_expense", "500.00")).toBe(false);
    expect(isFavourable("cost_of_sales", "500.00")).toBe(false);
    expect(isFavourable("other_expense", "500.00")).toBe(false);
  });

  it("treats cost falling as good news", () => {
    expect(isFavourable("operating_expense", "-500.00")).toBe(true);
  });

  it("treats other income like revenue, not like expense", () => {
    expect(isFavourable("other_income", "500.00")).toBe(true);
    expect(isFavourable("other_income", "-500.00")).toBe(false);
  });

  it("returns null for a zero movement rather than defaulting to favourable", () => {
    // A flat month reported as good news is how nothing gets read as a win.
    expect(isFavourable("revenue", "0.00")).toBeNull();
    expect(isFavourable("operating_expense", "0")).toBeNull();
  });

  it("returns null where the question does not apply", () => {
    expect(isFavourable("total", "500.00")).toBeNull();
    expect(isFavourable("unclassified", "500.00")).toBeNull();
  });
});

describe("computeMovements", () => {
  it("computes movement and percent against the comparative", () => {
    const [row] = computeMovements([revenue("Sales", "1100.00")], [revenue("Sales", "1000.00")], {
      threshold,
    });
    expect(row!.movement).toBe("100.00");
    expect(row!.percent).toBe("10.00");
    expect(row!.favourable).toBe(true);
  });

  it("reports a null percent when the comparative is zero", () => {
    // A percentage against nothing is not a number, and 'infinite growth' is
    // not a useful thing to print next to a figure.
    const [row] = computeMovements([revenue("Sales", "500.00")], [revenue("Sales", "0.00")], {
      threshold,
    });
    expect(row!.percent).toBeNull();
    expect(row!.movement).toBe("500.00");
  });

  it("treats an account new this period as a movement from zero", () => {
    const rows = computeMovements([expense("Legal fees", "4000.00")], [], { threshold });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.comparative).toBe("0.00");
    expect(rows[0]!.movement).toBe("4000.00");
    expect(rows[0]!.favourable).toBe(false);
  });

  it("keeps an account that disappeared this period", () => {
    // A cost line that stops is a real movement, not a missing row.
    const rows = computeMovements([], [expense("Contractors", "3000.00")], { threshold });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.actual).toBe("0.00");
    expect(rows[0]!.movement).toBe("-3000.00");
    expect(rows[0]!.favourable).toBe(true);
  });

  it("joins on account code when both sides carry one", () => {
    const actual: PlRow[] = [
      { accountCode: "200", accountName: "Sales renamed", sectionKind: "revenue", amount: "100.00" },
    ];
    const comparative: PlRow[] = [
      { accountCode: "200", accountName: "Sales", sectionKind: "revenue", amount: "80.00" },
    ];
    const rows = computeMovements(actual, comparative, { threshold });
    // One row, not two: a rename in Xero must not read as one account
    // disappearing and another appearing.
    expect(rows).toHaveLength(1);
    expect(rows[0]!.movement).toBe("20.00");
  });

  it("matches on name case-insensitively when there is no code", () => {
    const rows = computeMovements([revenue("SALES", "100.00")], [revenue("Sales", "80.00")], {
      threshold,
    });
    expect(rows).toHaveLength(1);
  });

  it("flags a movement over the threshold as an exception", () => {
    const rows = computeMovements([expense("Rent", "2500.00")], [expense("Rent", "1000.00")], {
      threshold,
    });
    expect(rows[0]!.isException).toBe(true);
  });

  it("does not flag a movement inside the threshold", () => {
    const rows = computeMovements([expense("Rent", "1050.00")], [expense("Rent", "1000.00")], {
      threshold,
    });
    expect(rows[0]!.isException).toBe(false);
  });

  it("does not drift on decimals the way floats would", () => {
    const rows = computeMovements([revenue("Sales", "0.30")], [revenue("Sales", "0.10")], {
      threshold,
    });
    expect(rows[0]!.movement).toBe("0.20");
  });
});

describe("rankByMateriality", () => {
  it("puts exceptions above larger non-exceptions", () => {
    // Sorting by size alone buries a small movement that breached a tight
    // threshold under a large one that did not.
    const rows = computeMovements(
      [expense("Small but flagged", "2000.00"), revenue("Large but fine", "50500.00")],
      [expense("Small but flagged", "500.00"), revenue("Large but fine", "50000.00")],
      { threshold }
    );
    const ranked = rankByMateriality(rows);
    expect(ranked[0]!.accountName).toBe("Small but flagged");
    expect(ranked[0]!.isException).toBe(true);
    expect(ranked[1]!.isException).toBe(false);
  });

  it("ranks by magnitude within the same exception status", () => {
    const rows = computeMovements(
      [expense("Bigger", "9000.00"), expense("Smaller", "3000.00")],
      [expense("Bigger", "0.00"), expense("Smaller", "0.00")],
      { threshold }
    );
    const ranked = rankByMateriality(rows);
    expect(ranked[0]!.accountName).toBe("Bigger");
  });

  it("ranks a large fall alongside a large rise, by magnitude not sign", () => {
    const rows = computeMovements(
      [revenue("Collapsed", "0.00"), revenue("Steady", "100.00")],
      [revenue("Collapsed", "80000.00"), revenue("Steady", "100.00")],
      { threshold }
    );
    expect(rankByMateriality(rows)[0]!.accountName).toBe("Collapsed");
  });

  it("does not mutate its input", () => {
    const rows = computeMovements([revenue("A", "2.00"), revenue("B", "9.00")], [], { threshold });
    const before = rows.map((r) => r.accountName);
    rankByMateriality(rows);
    expect(rows.map((r) => r.accountName)).toEqual(before);
  });
});

describe("summariseMovements", () => {
  it("counts exceptions, adverse and favourable rows", () => {
    const summary = summariseMovements(
      [revenue("Sales", "12000.00"), expense("Rent", "5000.00"), expense("Flat", "100.00")],
      [revenue("Sales", "10000.00"), expense("Rent", "1000.00"), expense("Flat", "100.00")],
      { threshold }
    );

    expect(summary.favourableCount).toBe(1); // sales up
    expect(summary.adverseCount).toBe(1); // rent up
    expect(summary.exceptionCount).toBe(2); // both breach 1000/10%
    // The flat row is neither favourable nor adverse.
    expect(summary.rows).toHaveLength(3);
  });

  it("returns nothing for two empty periods rather than throwing", () => {
    const summary = summariseMovements([], [], { threshold });
    expect(summary.rows).toEqual([]);
    expect(summary.exceptionCount).toBe(0);
  });

  it("flags nothing when no threshold is configured", () => {
    const summary = summariseMovements([expense("Rent", "99999.00")], [expense("Rent", "1.00")], {
      threshold: null,
    });
    expect(summary.exceptionCount).toBe(0);
    // The movement is still computed and still adverse; only the flag is absent.
    expect(summary.adverseCount).toBe(1);
  });
});

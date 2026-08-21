import { describe, it, expect } from "vitest";
import { Money, variancePercent } from "../lib/money";

describe("Money", () => {
  it("adds and subtracts without floating point drift", () => {
    const a = Money.of("0.1", "NZD");
    const b = Money.of("0.2", "NZD");
    expect(a.add(b).toFixedString(2)).toBe("0.30");
  });

  it("rejects mixing currencies", () => {
    const a = Money.of("10", "NZD");
    const b = Money.of("10", "AUD");
    expect(() => a.add(b)).toThrow(/Currency mismatch/);
  });

  it("preserves four decimal places in storage form", () => {
    const a = Money.of("123.456789", "NZD");
    expect(a.toStorageString()).toBe("123.4568");
  });

  it("computes variance amount and percent", () => {
    const bank = Money.of("1000.00", "NZD");
    const xero = Money.of("950.00", "NZD");
    const diff = bank.subtract(xero);
    expect(diff.toFixedString(2)).toBe("50.00");
    const pct = variancePercent(bank, xero);
    expect(pct?.toFixed(2)).toBe("5.26");
  });

  it("returns null variance percent when expected is zero", () => {
    expect(variancePercent(Money.of("5", "NZD"), Money.zero("NZD"))).toBeNull();
  });
});

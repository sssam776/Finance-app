import { describe, expect, it } from "vitest";
import { summariseCashFlow, type CashFlowSnapshot } from "@/lib/cashFlow";

function snapshot(
  entity: CashFlowSnapshot["entity"],
  currentCash: number,
  currentLiquidity: number,
  forecast: Record<string, number>,
  forecastLiquidity: Record<string, number>
): CashFlowSnapshot {
  return {
    entity,
    currentCash,
    asOf: "2026-09-17",
    monthEndForecast: forecast["2026-09"] ?? 0,
    forecastLow: Math.min(...Object.values(forecast)),
    lowMonth: "March 2027",
    fundingRequired: 0,
    status: "OK",
    refreshedAt: "2026-09-21T05:10:00Z",
    receivedAt: "2026-09-21T05:12:00Z",
    liquidityBasis: entity === "Kerrs" ? "credit_facility" : "cash",
    facilityLimit: entity === "Kerrs" ? 778822 : null,
    currentLiquidity,
    forecast,
    forecastLiquidity,
  };
}

describe("summariseCashFlow", () => {
  it("uses liquidity values rather than Kerrs' negative drawn balance", () => {
    const rows = [
      snapshot(
        "Kayo",
        73947.52,
        73947.52,
        { "2026-09": 25247.94, "2026-10": 17800.18 },
        { "2026-09": 25247.94, "2026-10": 17800.18 }
      ),
      snapshot(
        "Kerrs",
        -639397.29,
        139424.71,
        { "2026-09": -674852.27, "2026-10": -712563.41 },
        { "2026-09": 103969.73, "2026-10": 66258.59 }
      ),
    ];

    const result = summariseCashFlow(rows);

    expect(result.currentLiquidity).toBeCloseTo(213372.23, 2);
    expect(result.forecastLiquidity["2026-09"]).toBeCloseTo(129217.67, 2);
    expect(result.forecastLiquidity["2026-10"]).toBeCloseTo(84058.77, 2);
  });

  it("computes funding requirement from the consolidated low point", () => {
    const rows = [
      snapshot(
        "Ramwall",
        24528.98,
        24528.98,
        { "2026-09": -165396.39, "2026-10": -316239.9 },
        { "2026-09": -165396.39, "2026-10": -316239.9 }
      ),
      snapshot(
        "Hebcohg",
        66681.36,
        66681.36,
        { "2026-09": 136323.92, "2026-10": 143834.34 },
        { "2026-09": 136323.92, "2026-10": 143834.34 }
      ),
    ];

    const result = summariseCashFlow(rows);

    expect(result.firstNegativeMonth).toBe("2026-09");
    expect(result.lowMonth).toBe("2026-10");
    expect(result.forecastLow).toBeCloseTo(-172405.56, 2);
    expect(result.fundingRequired).toBeCloseTo(172405.56, 2);
  });

  it("does not treat a partial month as a complete consolidated forecast", () => {
    const rows = [
      snapshot(
        "Kayo",
        1,
        1,
        { "2026-09": 10, "2026-10": 20 },
        { "2026-09": 10, "2026-10": 20 }
      ),
      snapshot(
        "Vikat",
        1,
        1,
        { "2026-09": 30 },
        { "2026-09": 30 }
      ),
    ];

    const result = summariseCashFlow(rows);

    expect(result.completeMonths).toEqual(["2026-09"]);
    expect(result.lowMonth).toBe("2026-09");
    expect(result.monthCoverage["2026-10"]).toBe(1);
  });
});

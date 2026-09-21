export interface CashFlowSnapshot {
  entity: "Kayo" | "Vikat" | "Kerrs" | "Ramwall" | "Hebcohg";
  currentCash: number;
  asOf: string;
  monthEndForecast: number;
  forecastLow: number;
  lowMonth: string;
  fundingRequired: number;
  status: string;
  refreshedAt: string;
  receivedAt: string;
  liquidityBasis: "cash" | "credit_facility";
  facilityLimit: number | null;
  currentLiquidity: number;
  forecast: Record<string, number>;
  forecastLiquidity: Record<string, number>;
}

export interface CashFlowSummary {
  currentLiquidity: number;
  forecastLiquidity: Record<string, number>;
  monthCoverage: Record<string, number>;
  completeMonths: string[];
  forecastLow: number | null;
  lowMonth: string | null;
  firstNegativeMonth: string | null;
  fundingRequired: number;
}

export function summariseCashFlow(snapshots: CashFlowSnapshot[]): CashFlowSummary {
  if (snapshots.length === 0) {
    return {
      currentLiquidity: 0,
      forecastLiquidity: {},
      monthCoverage: {},
      completeMonths: [],
      forecastLow: null,
      lowMonth: null,
      firstNegativeMonth: null,
      fundingRequired: 0,
    };
  }

  const forecastLiquidity: Record<string, number> = {};
  const monthCoverage: Record<string, number> = {};

  for (const snapshot of snapshots) {
    for (const [month, amount] of Object.entries(snapshot.forecastLiquidity)) {
      forecastLiquidity[month] = (forecastLiquidity[month] ?? 0) + amount;
      monthCoverage[month] = (monthCoverage[month] ?? 0) + 1;
    }
  }

  const completeMonths = Object.keys(forecastLiquidity)
    .filter((month) => monthCoverage[month] === snapshots.length)
    .sort();

  const completeValues = completeMonths.map((month) => ({
    month,
    amount: forecastLiquidity[month],
  }));

  const low =
    completeValues.length === 0
      ? null
      : completeValues.reduce((lowest, row) =>
          row.amount < lowest.amount ? row : lowest
        );

  const firstNegative =
    completeValues.find((row) => row.amount < 0) ?? null;

  return {
    currentLiquidity: snapshots.reduce(
      (total, snapshot) => total + snapshot.currentLiquidity,
      0
    ),
    forecastLiquidity,
    monthCoverage,
    completeMonths,
    forecastLow: low?.amount ?? null,
    lowMonth: low?.month ?? null,
    firstNegativeMonth: firstNegative?.month ?? null,
    fundingRequired: low ? Math.max(0, -low.amount) : 0,
  };
}

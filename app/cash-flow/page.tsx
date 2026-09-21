"use client";

import { useEffect, useMemo, useState } from "react";
import {
  PageHeading,
  Panel,
  StatusPill,
  TableFrame,
  Thead,
  Th,
} from "../ui";

interface Snapshot {
  entity: "Kayo" | "Vikat" | "Kerrs" | "Ramwall" | "Hebcohg";
  currentCash: number;
  asOf: string;
  status: string;
  liquidityBasis: "cash" | "credit_facility";
  facilityLimit: number | null;
  currentLiquidity: number;
  forecast: Record<string, number>;
  forecastLiquidity: Record<string, number>;
}

interface Summary {
  currentLiquidity: number;
  forecastLiquidity: Record<string, number>;
  monthCoverage: Record<string, number>;
  completeMonths: string[];
  forecastLow: number | null;
  lowMonth: string | null;
  firstNegativeMonth: string | null;
  fundingRequired: number;
}

interface CashFlowResponse {
  scope: "group" | "restricted";
  snapshots: Snapshot[];
  summary: Summary;
}

const ENTITY_LABELS: Record<Snapshot["entity"], string> = {
  Kayo: "Kayo Investments",
  Vikat: "Vikat Holdings",
  Kerrs: "Kerrs Village",
  Ramwall: "Ramwall (2010)",
  Hebcohg: "Hebcohg",
};

function money(value: number): string {
  const formatted = new Intl.NumberFormat("en-NZ", {
    style: "currency",
    currency: "NZD",
    maximumFractionDigits: 0,
  }).format(Math.abs(value));

  return value < 0 ? `(${formatted})` : formatted;
}

function monthLabel(month: string): string {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Intl.DateTimeFormat("en-NZ", {
    month: "short",
    year: "2-digit",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, monthNumber - 1, 1)));
}

function longMonthLabel(month: string | null): string {
  if (!month) return "—";
  const [year, monthNumber] = month.split("-").map(Number);
  return new Intl.DateTimeFormat("en-NZ", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, monthNumber - 1, 1)));
}

function statusTone(status: string): "healthy" | "stale" | "exception" | "neutral" {
  if (status === "OK" || status === "Within Facility") return "healthy";
  if (
    status.includes("Risk") ||
    status.includes("Breach") ||
    status.includes("Funding")
  ) {
    return "exception";
  }
  return "neutral";
}

function negativeClass(value: number, snapshot?: Snapshot): string {
  if (value >= 0) return "text-slate-900";
  // Kerrs is a drawn facility. A negative bank balance is utilisation, not
  // itself a breach; the status and facility headroom carry that judgement.
  if (snapshot?.liquidityBasis === "credit_facility") return "text-slate-900";
  return "text-exception";
}

export default function CashFlowPage() {
  const [data, setData] = useState<CashFlowResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/cash-flow", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) {
          const body = await response.json().catch(() => null);
          throw new Error(body?.error ?? "Unable to load cash flow.");
        }
        return response.json();
      })
      .then((body) => setData(body))
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const months = useMemo(
    () => data?.summary.completeMonths ?? [],
    [data]
  );

  if (loading) {
    return <div className="text-slate-500">Loading cash flow…</div>;
  }

  if (error || !data) {
    return (
      <div className="max-w-prose rounded border border-exception/30 bg-exception-bg p-4 text-sm text-exception">
        {error ?? "Unable to load cash flow."}
      </div>
    );
  }

  if (data.snapshots.length === 0) {
    return (
      <div className="max-w-prose rounded border border-dashed border-slate-300 p-8 text-slate-500">
        No cash-flow entities are available for your account.
      </div>
    );
  }

  const summaryLabel =
    data.scope === "group" ? "Group liquidity" : "Visible-entity liquidity";

  return (
    <div className="space-y-6">
      <PageHeading title="Cash Flow Forecast">
        Monthly closing cash by entity, with Kerrs facility headroom used in consolidated liquidity.
      </PageHeading>

      <div className="grid gap-4 md:grid-cols-3">
        <Panel title={summaryLabel}>
          <div className="figures text-figure-hero text-slate-900">
            {money(data.summary.currentLiquidity)}
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Current liquidity. Kerrs contributes undrawn facility headroom rather than its negative drawn balance.
          </p>
        </Panel>

        <Panel title="Forecast low">
          <div
            className={`figures text-figure-hero ${
              (data.summary.forecastLow ?? 0) < 0
                ? "text-exception"
                : "text-slate-900"
            }`}
          >
            {data.summary.forecastLow === null
              ? "—"
              : money(data.summary.forecastLow)}
          </div>
          <p className="mt-1 text-xs text-slate-500">
            {data.summary.lowMonth
              ? longMonthLabel(data.summary.lowMonth)
              : "No complete forecast months"}
          </p>
        </Panel>

        <Panel title="First group deficit">
          <div className="figures text-figure-hero text-slate-900">
            {data.summary.firstNegativeMonth
              ? longMonthLabel(data.summary.firstNegativeMonth)
              : "None"}
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Peak funding requirement at the forecast low: {money(data.summary.fundingRequired)}.
          </p>
        </Panel>
      </div>

      <TableFrame>
        <Thead>
          <tr>
            <Th>Entity</Th>
            <Th align="right">Current cash</Th>
            {months.map((month) => (
              <Th key={month} align="right">
                {monthLabel(month)}
              </Th>
            ))}
            <Th>Status</Th>
          </tr>
        </Thead>
        <tbody>
          {data.snapshots.map((snapshot) => (
            <tr key={snapshot.entity} className="border-t border-slate-100">
              <td className="px-4 py-3">
                <div className="font-medium text-slate-900">
                  {ENTITY_LABELS[snapshot.entity]}
                </div>
                <div className="mt-0.5 text-xs text-slate-400">
                  As at {snapshot.asOf}
                </div>
                {snapshot.liquidityBasis === "credit_facility" && (
                  <div className="mt-0.5 text-xs text-slate-500">
                    Facility headroom {money(snapshot.currentLiquidity)}
                  </div>
                )}
              </td>
              <td
                className={`figures whitespace-nowrap px-4 py-3 text-right ${negativeClass(
                  snapshot.currentCash,
                  snapshot
                )}`}
              >
                {money(snapshot.currentCash)}
              </td>
              {months.map((month) => {
                const value = snapshot.forecast[month];
                return (
                  <td
                    key={month}
                    className={`figures whitespace-nowrap px-4 py-3 text-right ${negativeClass(
                      value,
                      snapshot
                    )}`}
                  >
                    {money(value)}
                  </td>
                );
              })}
              <td className="whitespace-nowrap px-4 py-3">
                <StatusPill tone={statusTone(snapshot.status)}>
                  {snapshot.status}
                </StatusPill>
              </td>
            </tr>
          ))}

          <tr className="border-t-2 border-slate-300 bg-slate-50 font-semibold">
            <td className="px-4 py-3 text-slate-900">
              {data.scope === "group"
                ? "Net Group Liquidity"
                : "Visible Entity Liquidity"}
            </td>
            <td
              className={`figures whitespace-nowrap px-4 py-3 text-right ${negativeClass(
                data.summary.currentLiquidity
              )}`}
            >
              {money(data.summary.currentLiquidity)}
            </td>
            {months.map((month) => {
              const value = data.summary.forecastLiquidity[month];
              return (
                <td
                  key={month}
                  className={`figures whitespace-nowrap px-4 py-3 text-right ${negativeClass(
                    value
                  )}`}
                >
                  {money(value)}
                </td>
              );
            })}
            <td className="px-4 py-3 text-xs font-normal text-slate-500">
              Includes Kerrs headroom
            </td>
          </tr>
        </tbody>
      </TableFrame>

      <p className="max-w-prose text-xs text-slate-400">
        Current cash is shown at each entity's source date. Consolidated liquidity uses Kerrs' facility headroom; entity rows continue to show Kerrs' drawn cash balance.
      </p>
    </div>
  );
}

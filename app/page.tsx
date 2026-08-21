"use client";

import { useEffect, useState } from "react";

interface CashAccountRow {
  entityId: string;
  entityShortCode: string;
  entityStatus: string;
  bankAccountId: string;
  bankName: string;
  accountName: string;
  isLoanFacility: boolean;
  bankBalance: string | null;
  bankBalanceDate: string | null;
  xeroBalance: string | null;
  xeroBalanceDate: string | null;
  variance: { amount: string; percent: string | null } | null;
  oldestSourceDate: string | null;
  stale: boolean;
}

interface CashPositionResponse {
  accounts: CashAccountRow[];
  totalAvailableCash: string;
  oldestSourceDate: string | null;
}

export default function CashPositionPage() {
  const [data, setData] = useState<CashPositionResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/cash-position")
      .then((res) => res.json())
      .then(setData)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-slate-500">Loading cash position…</div>;
  if (!data || data.accounts.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-slate-500">
        No bank accounts mapped yet. Go to <span className="font-medium">Entities</span> to add one, then{" "}
        <span className="font-medium">Bank Imports</span> to upload a statement.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Cash Position</h1>
          <p className="text-sm text-slate-500">
            Available cash (loan facilities excluded) — CASH-002
          </p>
        </div>
        <div className="text-right">
          <div className="text-3xl font-semibold">${data.totalAvailableCash}</div>
          {data.oldestSourceDate && (
            <div className="text-xs text-amber-600">
              Oldest underlying source date: {data.oldestSourceDate}
            </div>
          )}
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Entity</th>
              <th className="px-4 py-3">Account</th>
              <th className="px-4 py-3 text-right">Bank balance</th>
              <th className="px-4 py-3">As at</th>
              <th className="px-4 py-3 text-right">Xero balance</th>
              <th className="px-4 py-3">As at</th>
              <th className="px-4 py-3 text-right">Variance</th>
            </tr>
          </thead>
          <tbody>
            {data.accounts.map((row) => (
              <tr key={row.bankAccountId} className="border-t border-slate-100">
                <td className="px-4 py-3">
                  <div className="font-medium">{row.entityShortCode}</div>
                  {row.entityStatus === "unverified" && (
                    <div className="text-xs text-amber-600">unverified entity</div>
                  )}
                </td>
                <td className="px-4 py-3">
                  {row.bankName} — {row.accountName}
                  {row.isLoanFacility && (
                    <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">
                      loan (excluded)
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {row.bankBalance ? `$${row.bankBalance}` : "—"}
                </td>
                <td className="px-4 py-3 text-slate-500">{row.bankBalanceDate ?? "—"}</td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {row.xeroBalance ? `$${row.xeroBalance}` : "not synced"}
                </td>
                <td className="px-4 py-3 text-slate-500">{row.xeroBalanceDate ?? "—"}</td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {row.variance ? (
                    <span className={row.variance.amount !== "0.00" ? "text-red-600" : "text-emerald-600"}>
                      ${row.variance.amount}
                      {row.variance.percent && <span className="text-xs"> ({row.variance.percent}%)</span>}
                    </span>
                  ) : (
                    <span className="text-slate-400">n/a</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-slate-400">
        Xero-to-bank comparison is a control/variance check, not line-by-line bank reconciliation (spec 3.10, CASH-004).
      </p>
    </div>
  );
}

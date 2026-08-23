"use client";

import { useCallback, useEffect, useState } from "react";

interface Threshold {
  scope: "entity" | "group";
  absoluteAmount: string;
  percent: string | null;
}

interface BankEvidence {
  importId: string;
  sourceFileChecksum: string;
  importedByEmail: string;
  fileReceivedAt: string;
  parserVersion: string;
  sourceRowRef: string | null;
}

interface XeroEvidence {
  syncRunId: string;
  tenantId: string | null;
  xeroAccountId: string | null;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  recordsRead: number;
}

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
  threshold: Threshold | null;
  isException: boolean;
  evidence: { bank: BankEvidence | null; xero: XeroEvidence | null };
  oldestSourceDate: string | null;
  stale: boolean;
}

interface CashPositionResponse {
  accounts: CashAccountRow[];
  totalAvailableCash: string;
  oldestSourceDate: string | null;
  exceptionCount: number;
}

const GROUP_SCOPE = "*";

export default function CashPositionPage() {
  const [data, setData] = useState<CashPositionResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  const [amountLimit, setAmountLimit] = useState("");
  const [percentLimit, setPercentLimit] = useState("");
  const [savingThreshold, setSavingThreshold] = useState(false);
  const [thresholdMessage, setThresholdMessage] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch("/api/cash-position")
      .then((res) => (res.ok ? res.json() : null))
      .then(setData)
      .finally(() => setLoading(false));

    fetch("/api/thresholds")
      .then((res) => (res.ok ? res.json() : null))
      .then((d) => {
        const groupRow = d?.thresholds?.find((t: { entityId: string }) => t.entityId === GROUP_SCOPE);
        if (groupRow) {
          setAmountLimit(groupRow.absoluteAmount);
          setPercentLimit(groupRow.percent ?? "");
        }
      })
      .catch(() => {});

    fetch("/api/auth/me")
      .then((res) => (res.ok ? res.json() : null))
      .then((d) => setIsAdmin(d?.user?.role === "admin"))
      .catch(() => setIsAdmin(false));
  }, []);

  useEffect(load, [load]);

  async function saveThreshold(e: React.FormEvent) {
    e.preventDefault();
    setSavingThreshold(true);
    setThresholdMessage(null);

    const res = await fetch("/api/thresholds", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        entityId: GROUP_SCOPE,
        absoluteAmount: amountLimit,
        percent: percentLimit === "" ? null : percentLimit,
      }),
    });

    setThresholdMessage(res.ok ? "Threshold saved." : "Could not save — check the values are plain decimals.");
    setSavingThreshold(false);
    if (res.ok) load();
  }

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

      {data.exceptionCount > 0 && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {data.exceptionCount} account{data.exceptionCount === 1 ? "" : "s"} breach the configured variance
          threshold. Open a row to see the source records behind the figures.
        </div>
      )}

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
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {data.accounts.map((row) => (
              <FragmentRow
                key={row.bankAccountId}
                row={row}
                expanded={expanded === row.bankAccountId}
                onToggle={() =>
                  setExpanded(expanded === row.bankAccountId ? null : row.bankAccountId)
                }
              />
            ))}
          </tbody>
        </table>
      </div>

      {isAdmin && (
        <form
          onSubmit={saveThreshold}
          className="rounded-lg border border-slate-200 bg-white p-5 space-y-3"
        >
          <div>
            <h2 className="text-sm font-medium">Group variance threshold (CASH-005)</h2>
            <p className="text-xs text-slate-500">
              A variance is flagged when it exceeds either trigger. Applies to every entity without its
              own override.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-sm">
              <span className="text-slate-600">Amount over</span>
              <input
                className="mt-1 block w-40 rounded border border-slate-300 px-2 py-1.5"
                value={amountLimit}
                onChange={(e) => setAmountLimit(e.target.value)}
                placeholder="1000.00"
                required
              />
            </label>
            <label className="text-sm">
              <span className="text-slate-600">or percent over (optional)</span>
              <input
                className="mt-1 block w-40 rounded border border-slate-300 px-2 py-1.5"
                value={percentLimit}
                onChange={(e) => setPercentLimit(e.target.value)}
                placeholder="1.00"
              />
            </label>
            <button
              type="submit"
              disabled={savingThreshold}
              className="rounded bg-slate-800 px-3 py-1.5 text-sm text-white hover:bg-slate-700 disabled:opacity-50"
            >
              {savingThreshold ? "Saving…" : "Save threshold"}
            </button>
          </div>
          {thresholdMessage && <p className="text-sm text-slate-600">{thresholdMessage}</p>}
        </form>
      )}

      <p className="text-xs text-slate-400">
        Xero-to-bank comparison is a control/variance check, not line-by-line bank reconciliation (spec 3.10, CASH-004).
      </p>
    </div>
  );
}

function FragmentRow({
  row,
  expanded,
  onToggle,
}: {
  row: CashAccountRow;
  expanded: boolean;
  onToggle: () => void;
}) {
  const hasEvidence = Boolean(row.evidence.bank || row.evidence.xero);

  return (
    <>
      <tr className={`border-t border-slate-100 ${row.isException ? "bg-red-50/50" : ""}`}>
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
            <span className={row.isException ? "font-medium text-red-600" : "text-slate-700"}>
              ${row.variance.amount}
              {row.variance.percent && <span className="text-xs"> ({row.variance.percent}%)</span>}
              {row.isException && (
                <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-700">
                  exception
                </span>
              )}
            </span>
          ) : (
            <span className="text-slate-400">n/a</span>
          )}
        </td>
        <td className="px-4 py-3 text-right">
          {hasEvidence && (
            <button onClick={onToggle} className="text-xs text-slate-500 underline hover:text-slate-800">
              {expanded ? "Hide" : "Evidence"}
            </button>
          )}
        </td>
      </tr>

      {expanded && (
        <tr className="border-t border-slate-100 bg-slate-50">
          <td colSpan={8} className="px-4 py-4">
            <div className="grid gap-6 md:grid-cols-2">
              <EvidenceBlock title="Bank source (CASH-006)">
                {row.evidence.bank ? (
                  <>
                    <Fact label="Import" value={row.evidence.bank.importId} mono />
                    <Fact label="File checksum" value={row.evidence.bank.sourceFileChecksum} mono />
                    <Fact label="Imported by" value={row.evidence.bank.importedByEmail} />
                    <Fact label="File received" value={row.evidence.bank.fileReceivedAt} />
                    <Fact label="Parser version" value={row.evidence.bank.parserVersion} />
                    <Fact label="Source row" value={row.evidence.bank.sourceRowRef ?? "—"} />
                  </>
                ) : (
                  <p className="text-slate-400">No bank import behind this figure.</p>
                )}
              </EvidenceBlock>

              <EvidenceBlock title="Xero source (CASH-006)">
                {row.evidence.xero ? (
                  <>
                    <Fact label="Sync run" value={row.evidence.xero.syncRunId} mono />
                    <Fact label="Status" value={row.evidence.xero.status} />
                    <Fact label="Tenant" value={row.evidence.xero.tenantId ?? "—"} mono />
                    <Fact label="Xero account" value={row.evidence.xero.xeroAccountId ?? "—"} mono />
                    <Fact label="Started" value={row.evidence.xero.startedAt} />
                    <Fact label="Finished" value={row.evidence.xero.finishedAt ?? "—"} />
                    <Fact label="Records read" value={String(row.evidence.xero.recordsRead)} />
                  </>
                ) : (
                  <p className="text-slate-400">This account has not been synced from Xero.</p>
                )}
              </EvidenceBlock>
            </div>

            {row.threshold && (
              <p className="mt-4 text-xs text-slate-500">
                Threshold applied: ${row.threshold.absoluteAmount}
                {row.threshold.percent && ` or ${row.threshold.percent}%`} ({row.threshold.scope} scope)
              </p>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

function EvidenceBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">{title}</h3>
      <dl className="space-y-1 text-xs">{children}</dl>
    </div>
  );
}

function Fact({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex gap-2">
      <dt className="w-28 shrink-0 text-slate-400">{label}</dt>
      <dd className={`text-slate-700 ${mono ? "font-mono" : ""}`}>{value}</dd>
    </div>
  );
}

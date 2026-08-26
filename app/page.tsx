"use client";

import { useCallback, useEffect, useState } from "react";
import { ExportCsvLink } from "./ui";

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
  currency: string;
  variance: { amount: string; percent: string | null; currency: string } | null;
  currencyMismatch: boolean;
  threshold: Threshold | null;
  isException: boolean;
  evidence: { bank: BankEvidence | null; xero: XeroEvidence | null };
  oldestSourceDate: string | null;
  stale: boolean;
}

interface CashPositionResponse {
  accounts: CashAccountRow[];
  availableCashByCurrency: { currency: string; amount: string }[];
  totalAvailableCash: string;
  reportingCurrency: string;
  hasForeignCurrency: boolean;
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
      <div className="max-w-prose rounded border border-dashed border-slate-300 p-8 text-slate-500">
        No bank accounts mapped yet. Go to <span className="font-medium text-slate-700">Entities</span> to
        add one, then <span className="font-medium text-slate-700">Bank Imports</span> to upload a
        statement.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-[-0.02em] text-slate-900">Cash Position</h1>
          <p className="mt-1 text-sm text-slate-500">Available cash, loan facilities excluded</p>
          <div className="mt-3">
            {/* The export carries the evidence columns with the figures, so a
                variance taken into a spreadsheet keeps its source. */}
            <ExportCsvLink href="/api/cash-position?format=csv" />
          </div>
        </div>

        <div className="text-right">
          {data.availableCashByCurrency.length === 0 ? (
            <div className="text-figure-hero text-slate-400">—</div>
          ) : (
            data.availableCashByCurrency.map((total) => (
              <div key={total.currency} className="figures text-figure-hero text-slate-900">
                {total.amount}
                {/* Currency always sits with the amount: this app never sums
                    across currencies, so a bare number would imply it had. */}
                <span className="ml-1.5 text-sm font-normal text-slate-500">{total.currency}</span>
              </div>
            ))
          )}
          {data.hasForeignCurrency && (
            <div className="mt-1 max-w-xs text-xs text-stale">
              Shown per currency. No FX rate source is configured, so these are not added together.
            </div>
          )}
          {data.oldestSourceDate && (
            <div className="mt-1 text-xs text-stale">
              Oldest source date <span className="figures">{data.oldestSourceDate}</span>
            </div>
          )}
        </div>
      </div>

      {data.exceptionCount > 0 && (
        <div className="rounded border border-exception/30 bg-exception-bg px-4 py-3 text-sm text-exception">
          <span className="font-medium">
            {data.exceptionCount} account{data.exceptionCount === 1 ? "" : "s"}
          </span>{" "}
          {data.exceptionCount === 1 ? "breaches" : "breach"} the configured variance threshold. Open a row
          to see the source records behind the figures.
        </div>
      )}

      <div className="overflow-x-auto rounded border border-slate-200 bg-white shadow-panel">
        <table className="min-w-full text-sm">
          {/* Explicit widths: left to itself the browser gave the text columns
              the space and squeezed the dates until they broke mid-value. */}
          <colgroup>
            <col className="w-[13%]" />
            <col className="w-[22%]" />
            <col className="w-[13%]" />
            <col className="w-[10%]" />
            <col className="w-[13%]" />
            <col className="w-[10%]" />
            <col className="w-[13%]" />
            <col className="w-[6%]" />
          </colgroup>
          <thead className="border-b border-slate-200 bg-slate-100 text-left text-label uppercase text-slate-500">
            <tr>
              <th className="whitespace-nowrap px-4 py-2.5 font-medium">Entity</th>
              <th className="whitespace-nowrap px-4 py-2.5 font-medium">Account</th>
              <th className="whitespace-nowrap px-4 py-2.5 text-right font-medium">Bank</th>
              <th className="whitespace-nowrap px-4 py-2.5 font-medium">As at</th>
              <th className="whitespace-nowrap px-4 py-2.5 text-right font-medium">Xero</th>
              <th className="whitespace-nowrap px-4 py-2.5 font-medium">As at</th>
              <th className="whitespace-nowrap px-4 py-2.5 text-right font-medium">Variance</th>
              <th className="px-4 py-2.5" />
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
        <form onSubmit={saveThreshold} className="space-y-3 rounded border border-slate-200 bg-white p-5 shadow-panel">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Group variance threshold</h2>
            <p className="mt-0.5 max-w-prose text-xs text-slate-500">
              A variance is flagged when it exceeds either trigger. Applies to every entity without its
              own override.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-sm">
              <span className="text-slate-600">Amount over</span>
              <input
                className="figures mt-1 block w-40 rounded border border-slate-300 px-2 py-1.5 text-slate-900"
                value={amountLimit}
                onChange={(e) => setAmountLimit(e.target.value)}
                placeholder="1000.00"
                inputMode="decimal"
                required
              />
            </label>
            <label className="text-sm">
              <span className="text-slate-600">or percent over</span>
              <span className="ml-1 text-xs text-slate-400">optional</span>
              <input
                className="figures mt-1 block w-40 rounded border border-slate-300 px-2 py-1.5 text-slate-900"
                value={percentLimit}
                onChange={(e) => setPercentLimit(e.target.value)}
                placeholder="1.00"
                inputMode="decimal"
              />
            </label>
            <button
              type="submit"
              disabled={savingThreshold}
              className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
            >
              {savingThreshold ? "Saving…" : "Save threshold"}
            </button>
          </div>
          {thresholdMessage && <p className="text-sm text-slate-600">{thresholdMessage}</p>}
        </form>
      )}

      <p className="max-w-prose text-xs text-slate-400">
        The Xero-to-bank comparison is a control and variance check, not line-by-line bank
        reconciliation.
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
      <tr
        className={
          row.isException ? "border-t border-slate-100 bg-exception-bg" : "border-t border-slate-100"
        }
      >
        <td className="px-4 py-3 align-top">
          <div className="font-medium text-slate-900">{row.entityShortCode}</div>
          {row.isException && (
            // The badge lives in the first column, not beside the variance.
            // The table scrolls horizontally on a narrow viewport, and the
            // variance column goes off-screen first: putting the only
            // non-colour signal there left the row tint doing the work alone.
            <div className="mt-1">
              <span className="rounded bg-exception px-1.5 py-0.5 text-xs font-medium text-white">
                exception
              </span>
            </div>
          )}
          {row.entityStatus === "unverified" && (
            // Said in words, not implied by colour. These entities stay
            // unverified until the client confirms which have their own Xero
            // organisation, and nobody should read a figure without knowing.
            <div className="mt-1 text-xs text-stale">unverified entity</div>
          )}
        </td>
        <td className="px-4 py-3 align-top text-slate-700">
          {row.bankName} — {row.accountName}
          {row.isLoanFacility && (
            <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">
              loan, excluded
            </span>
          )}
        </td>
        <td className="figures whitespace-nowrap px-4 py-3 text-right align-top text-slate-900">
          {row.bankBalance ? (
            <>
              {row.bankBalance}
              <span className="ml-1 text-xs font-normal text-slate-400">{row.currency}</span>
            </>
          ) : (
            <span className="text-slate-400">—</span>
          )}
        </td>
        {/* A date that wraps mid-value is unreadable, and these are the dates
            the whole variance judgement rests on. */}
        <td className="figures whitespace-nowrap px-4 py-3 align-top text-slate-500">
          {row.bankBalanceDate ?? "—"}
        </td>
        <td className="figures whitespace-nowrap px-4 py-3 text-right align-top text-slate-900">
          {row.xeroBalance ? (
            <>
              {row.xeroBalance}
              {/* Currency here too. Showing it on one balance and not the other
                  invites the reader to assume they are the same unit. */}
              <span className="ml-1 text-xs font-normal text-slate-400">{row.currency}</span>
            </>
          ) : (
            <span className="text-slate-400">not synced</span>
          )}
        </td>
        <td className="figures whitespace-nowrap px-4 py-3 align-top text-slate-500">
          {row.xeroBalanceDate ?? "—"}
        </td>
        <td className="px-4 py-3 text-right align-top">
          {row.currencyMismatch ? (
            <span className="text-xs text-stale">currency mismatch</span>
          ) : row.variance ? (
            <div className={row.isException ? "text-exception" : "text-slate-700"}>
              <div className={`figures whitespace-nowrap ${row.isException ? "font-medium" : ""}`}>
                {row.variance.amount}
                <span className="ml-1 text-xs font-normal text-slate-400">
                  {row.variance.currency}
                </span>
                {row.variance.percent && (
                  <span className="ml-1 text-xs font-normal">({row.variance.percent}%)</span>
                )}
              </div>
            </div>
          ) : (
            <span className="text-slate-400">n/a</span>
          )}
        </td>
        <td className="px-4 py-3 text-right align-top">
          {hasEvidence && (
            <button
              onClick={onToggle}
              aria-expanded={expanded}
              className="rounded text-xs font-medium text-accent hover:text-accent-hover hover:underline"
            >
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
                Threshold applied{" "}
                <span className="figures text-slate-700">{row.threshold.absoluteAmount}</span>
                {row.threshold.percent && (
                  <>
                    {" or "}
                    <span className="figures text-slate-700">{row.threshold.percent}%</span>
                  </>
                )}
                , {row.threshold.scope} scope
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
      <h3 className="mb-2 text-label uppercase text-slate-500">{title}</h3>
      <dl className="space-y-1 text-xs">{children}</dl>
    </div>
  );
}

function Fact({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex gap-2">
      <dt className="w-28 shrink-0 text-slate-400">{label}</dt>
      {/* Identifiers and checksums get a monospace face so they can be compared
          character by character, which is the only reason anyone reads them. */}
      <dd className={mono ? "break-all font-mono text-slate-700" : "text-slate-700"}>{value}</dd>
    </div>
  );
}

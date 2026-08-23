"use client";

import { useEffect, useState } from "react";

interface BankAccount {
  id: string;
  entityId: string;
  bankName: string;
  accountName: string;
}

interface Entity {
  id: string;
  shortCode: string;
}

interface ImportRow {
  id: string;
  entityId: string;
  bankName: string;
  status: string;
  fileReceivedAt: string;
  processedAt: string | null;
  error: string | null;
}

export default function ImportsPage() {
  const [entities, setEntities] = useState<Entity[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [imports, setImports] = useState<ImportRow[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function reload() {
    fetch("/api/entities").then((r) => r.json()).then((d) => setEntities(d.entities));
    fetch("/api/bank-accounts").then((r) => r.json()).then((d) => setBankAccounts(d.bankAccounts));
    fetch("/api/imports").then((r) => r.json()).then((d) => setImports(d.imports));
  }

  useEffect(reload, []);

  function entityLabel(entityId: string) {
    return entities.find((e) => e.id === entityId)?.shortCode ?? entityId;
  }

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!file || !selectedAccountId) return;
    setBusy(true);
    setResult(null);
    const form = new FormData();
    form.set("file", file);
    form.set("entityBankAccountId", selectedAccountId);

    const res = await fetch("/api/imports", { method: "POST", body: form });
    const body = await res.json();
    setResult(
      res.ok
        ? `Parsed ${body.rowsParsed} rows — closing balance $${body.closingBalance} as at ${body.balanceDate}`
        : `Error: ${body.error}`
    );
    setBusy(false);
    reload();
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Bank Imports</h1>
        <p className="text-sm text-slate-500">
          ASB/BNZ CSV export with a running balance column. Server-side parsing only (REM-002/REM-003).
        </p>
      </div>

      <form onSubmit={handleUpload} className="rounded-lg border border-slate-200 bg-white p-5 space-y-3">
        <select
          className="w-full rounded border border-slate-300 px-2 py-1.5"
          value={selectedAccountId}
          onChange={(e) => setSelectedAccountId(e.target.value)}
          required
        >
          <option value="">Select bank account…</option>
          {bankAccounts.map((b) => (
            <option key={b.id} value={b.id}>
              {entityLabel(b.entityId)} — {b.bankName} {b.accountName}
            </option>
          ))}
        </select>
        <input
          type="file"
          accept=".csv"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="block w-full text-sm"
          required
        />
        <button
          type="submit"
          disabled={busy}
          className="rounded bg-slate-800 px-3 py-1.5 text-sm text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {busy ? "Uploading…" : "Upload and parse"}
        </button>
        {result && <p className="text-sm text-slate-600">{result}</p>}
      </form>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Entity</th>
              <th className="px-4 py-3">Bank</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Received</th>
              <th className="px-4 py-3">Error</th>
            </tr>
          </thead>
          <tbody>
            {imports.map((row) => (
              <tr key={row.id} className="border-t border-slate-100">
                <td className="px-4 py-3">{entityLabel(row.entityId)}</td>
                <td className="px-4 py-3">{row.bankName}</td>
                <td className="px-4 py-3">
                  <span
                    className={
                      row.status === "parsed"
                        ? "text-emerald-600"
                        : row.status === "failed"
                          ? "text-red-600"
                          : "text-slate-500"
                    }
                  >
                    {row.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-slate-500">{row.fileReceivedAt}</td>
                <td className="px-4 py-3 text-red-500">{row.error ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

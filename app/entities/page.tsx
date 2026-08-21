"use client";

import { useEffect, useState } from "react";

interface Entity {
  id: string;
  legalName: string;
  shortCode: string;
  status: string;
}

interface BankAccount {
  id: string;
  entityId: string;
  bankName: string;
  accountNumber: string;
  accountName: string;
  xeroAccountCode: string | null;
  isLoanFacility: boolean;
}

export default function EntitiesPage() {
  const [entities, setEntities] = useState<Entity[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [selectedEntityId, setSelectedEntityId] = useState<string>("");
  const [form, setForm] = useState({
    bankName: "ASB",
    accountNumber: "",
    accountName: "",
    xeroAccountCode: "",
    isLoanFacility: false,
  });
  const [syncStatus, setSyncStatus] = useState<Record<string, string>>({});

  function reload() {
    fetch("/api/entities")
      .then((r) => r.json())
      .then((d) => setEntities(d.entities));
    fetch("/api/bank-accounts")
      .then((r) => r.json())
      .then((d) => setBankAccounts(d.bankAccounts));
  }

  useEffect(reload, []);

  async function addBankAccount(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedEntityId) return;
    await fetch("/api/bank-accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        entityId: selectedEntityId,
        bankName: form.bankName,
        accountNumber: form.accountNumber,
        accountName: form.accountName,
        xeroAccountCode: form.xeroAccountCode || undefined,
        isLoanFacility: form.isLoanFacility,
      }),
    });
    setForm({ bankName: "ASB", accountNumber: "", accountName: "", xeroAccountCode: "", isLoanFacility: false });
    reload();
  }

  async function triggerSync(entityId: string) {
    setSyncStatus((s) => ({ ...s, [entityId]: "syncing…" }));
    const res = await fetch("/api/xero/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entityId }),
    });
    const body = await res.json();
    setSyncStatus((s) => ({
      ...s,
      [entityId]: res.ok ? `synced ${body.recordsWritten} accounts` : `error: ${body.error}`,
    }));
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Entities</h1>
        <p className="text-sm text-slate-500">
          Seeded from spec 7.1 as <span className="font-mono">unverified</span> — confirm which have a
          separate Xero organisation before treating any figure as live.
        </p>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Entity</th>
              <th className="px-4 py-3">Short code</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Bank accounts</th>
              <th className="px-4 py-3">Xero sync</th>
            </tr>
          </thead>
          <tbody>
            {entities.map((entity) => (
              <tr key={entity.id} className="border-t border-slate-100">
                <td className="px-4 py-3">{entity.legalName}</td>
                <td className="px-4 py-3 font-mono text-xs">{entity.shortCode}</td>
                <td className="px-4 py-3">
                  <span className="rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-700">
                    {entity.status}
                  </span>
                </td>
                <td className="px-4 py-3">
                  {bankAccounts.filter((b) => b.entityId === entity.id).length}
                </td>
                <td className="px-4 py-3">
                  <button
                    onClick={() => triggerSync(entity.id)}
                    className="rounded bg-slate-800 px-2 py-1 text-xs text-white hover:bg-slate-700"
                  >
                    Sync now
                  </button>
                  {syncStatus[entity.id] && (
                    <div className="mt-1 text-xs text-slate-500">{syncStatus[entity.id]}</div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="mb-3 font-medium">Add a bank account mapping</h2>
        <form onSubmit={addBankAccount} className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <select
            className="rounded border border-slate-300 px-2 py-1.5"
            value={selectedEntityId}
            onChange={(e) => setSelectedEntityId(e.target.value)}
            required
          >
            <option value="">Select entity…</option>
            {entities.map((e) => (
              <option key={e.id} value={e.id}>
                {e.shortCode}
              </option>
            ))}
          </select>
          <select
            className="rounded border border-slate-300 px-2 py-1.5"
            value={form.bankName}
            onChange={(e) => setForm((f) => ({ ...f, bankName: e.target.value }))}
          >
            <option value="ASB">ASB</option>
            <option value="BNZ">BNZ</option>
          </select>
          <input
            className="rounded border border-slate-300 px-2 py-1.5"
            placeholder="Account number"
            value={form.accountNumber}
            onChange={(e) => setForm((f) => ({ ...f, accountNumber: e.target.value }))}
            required
          />
          <input
            className="rounded border border-slate-300 px-2 py-1.5"
            placeholder="Account name / label"
            value={form.accountName}
            onChange={(e) => setForm((f) => ({ ...f, accountName: e.target.value }))}
            required
          />
          <input
            className="rounded border border-slate-300 px-2 py-1.5"
            placeholder="Xero account code (optional)"
            value={form.xeroAccountCode}
            onChange={(e) => setForm((f) => ({ ...f, xeroAccountCode: e.target.value }))}
          />
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={form.isLoanFacility}
              onChange={(e) => setForm((f) => ({ ...f, isLoanFacility: e.target.checked }))}
            />
            Loan facility (excluded from available cash)
          </label>
          <button type="submit" className="rounded bg-slate-800 px-3 py-1.5 text-sm text-white hover:bg-slate-700">
            Add mapping
          </button>
        </form>
      </div>
    </div>
  );
}

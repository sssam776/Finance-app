"use client";

import { useEffect, useState } from "react";
import {
  PageHeading,
  Panel,
  TableFrame,
  Thead,
  Th,
  Button,
  Field,
  Input,
  Select,
  StatusPill,
  EmptyRow,
} from "../ui";

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
  const [syncStatus, setSyncStatus] = useState<Record<string, { tone: "ok" | "error" | "busy"; text: string }>>({});

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
    setSyncStatus((s) => ({ ...s, [entityId]: { tone: "busy", text: "syncing…" } }));
    const res = await fetch("/api/xero/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entityId }),
    });
    const body = await res.json();
    setSyncStatus((s) => ({
      ...s,
      [entityId]: res.ok
        ? { tone: "ok", text: `synced ${body.recordsWritten} accounts` }
        : { tone: "error", text: body.error ?? "sync failed" },
    }));
  }

  return (
    <div className="space-y-8">
      <PageHeading title="Entities">
        Seeded as <span className="font-mono">unverified</span>. Confirm which have a separate Xero
        organisation before treating any figure as live.
      </PageHeading>

      <TableFrame>
        <Thead>
          <tr>
            <Th>Entity</Th>
            <Th>Short code</Th>
            <Th>Status</Th>
            <Th align="right">Bank accounts</Th>
            <Th>Xero sync</Th>
          </tr>
        </Thead>
        <tbody>
          {entities.map((entity) => {
            const status = syncStatus[entity.id];
            return (
              <tr key={entity.id} className="border-t border-slate-100">
                <td className="px-4 py-3 text-slate-900">{entity.legalName}</td>
                <td className="px-4 py-3 font-mono text-xs text-slate-600">{entity.shortCode}</td>
                <td className="px-4 py-3">
                  <StatusPill tone={entity.status === "active" ? "healthy" : "stale"}>
                    {entity.status}
                  </StatusPill>
                </td>
                <td className="figures px-4 py-3 text-right text-slate-700">
                  {bankAccounts.filter((b) => b.entityId === entity.id).length}
                </td>
                <td className="px-4 py-3">
                  <Button variant="secondary" onClick={() => triggerSync(entity.id)}>
                    Sync now
                  </Button>
                  {status && (
                    <div
                      className={`mt-1 max-w-xs text-xs ${
                        status.tone === "error" ? "text-exception" : "text-slate-500"
                      }`}
                    >
                      {status.text}
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
          {entities.length === 0 && <EmptyRow colSpan={5}>No entities seeded yet.</EmptyRow>}
        </tbody>
      </TableFrame>

      <Panel
        title="Add a bank account mapping"
        description="The Xero account code is what links a bank balance to its Xero counterpart. Without it the account shows a bank figure and no variance."
      >
        <form onSubmit={addBankAccount} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Entity">
            <Select
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
            </Select>
          </Field>

          <Field label="Bank">
            <Select
              value={form.bankName}
              onChange={(e) => setForm((f) => ({ ...f, bankName: e.target.value }))}
            >
              <option value="ASB">ASB</option>
              <option value="BNZ">BNZ</option>
            </Select>
          </Field>

          <Field label="Account number">
            <Input
              value={form.accountNumber}
              onChange={(e) => setForm((f) => ({ ...f, accountNumber: e.target.value }))}
              required
            />
          </Field>

          <Field label="Account name">
            <Input
              value={form.accountName}
              onChange={(e) => setForm((f) => ({ ...f, accountName: e.target.value }))}
              required
            />
          </Field>

          <Field label="Xero account code" hint="optional">
            <Input
              value={form.xeroAccountCode}
              onChange={(e) => setForm((f) => ({ ...f, xeroAccountCode: e.target.value }))}
            />
          </Field>

          <div className="flex flex-col justify-end gap-3">
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={form.isLoanFacility}
                onChange={(e) => setForm((f) => ({ ...f, isLoanFacility: e.target.checked }))}
              />
              Loan facility, excluded from available cash
            </label>
            <Button type="submit">Add mapping</Button>
          </div>
        </form>
      </Panel>
    </div>
  );
}

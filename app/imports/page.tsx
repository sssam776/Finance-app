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
  Notice,
  EmptyRow,
} from "../ui";

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
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
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
        ? {
            ok: true,
            text: `Parsed ${body.rowsParsed} rows. Closing balance ${body.closingBalance} as at ${body.balanceDate}.`,
          }
        : { ok: false, text: body.error ?? "The file could not be parsed." }
    );
    setBusy(false);
    reload();
  }

  return (
    <div className="space-y-8">
      <PageHeading title="Bank Imports">
        An ASB or BNZ CSV export with the running balance column included. Parsing happens on the
        server, and the original file is kept so a figure can always be traced back to it.
      </PageHeading>

      <Panel title="Upload a statement">
        <form onSubmit={handleUpload} className="space-y-3">
          <Field label="Bank account">
            <Select
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
            </Select>
          </Field>

          <Field label="CSV file" hint="must include a balance column">
            <Input
              type="file"
              accept=".csv"
              onChange={(e) => setFile((e.target as HTMLInputElement).files?.[0] ?? null)}
              required
            />
          </Field>

          <Button type="submit" disabled={busy}>
            {busy ? "Uploading…" : "Upload and parse"}
          </Button>

          {result && <Notice tone={result.ok ? "ok" : "error"}>{result.text}</Notice>}
        </form>
      </Panel>

      <TableFrame>
        <Thead>
          <tr>
            <Th>Entity</Th>
            <Th>Bank</Th>
            <Th>Status</Th>
            <Th>Received</Th>
            <Th>Error</Th>
          </tr>
        </Thead>
        <tbody>
          {imports.map((row) => (
            <tr key={row.id} className="border-t border-slate-100">
              <td className="px-4 py-3 text-slate-900">{entityLabel(row.entityId)}</td>
              <td className="px-4 py-3 text-slate-700">{row.bankName}</td>
              <td className="px-4 py-3">
                <StatusPill
                  tone={
                    row.status === "parsed" ? "healthy" : row.status === "failed" ? "exception" : "neutral"
                  }
                >
                  {row.status}
                </StatusPill>
              </td>
              <td className="figures whitespace-nowrap px-4 py-3 text-slate-500">
                {row.fileReceivedAt}
              </td>
              <td className="max-w-md px-4 py-3 text-exception">{row.error ?? ""}</td>
            </tr>
          ))}
          {imports.length === 0 && (
            <EmptyRow colSpan={5}>No statements imported yet.</EmptyRow>
          )}
        </tbody>
      </TableFrame>
    </div>
  );
}

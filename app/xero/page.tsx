"use client";

import { useEffect, useState } from "react";
import {
  PageHeading,
  TableFrame,
  Thead,
  Th,
  Button,
  Select,
  StatusPill,
  Notice,
  EmptyRow,
} from "../ui";

interface ConnectionHealth {
  level: "ok" | "warning" | "error";
  message: string | null;
  hoursSinceSuccess: number | null;
  stale: boolean;
  needsAttention: boolean;
}

interface SyncRunSummary {
  id: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  recordsRead: number;
  error: string | null;
}

interface XeroConnectionRow {
  id: string;
  xeroAppId: string;
  appDisplayName: string;
  appEnvironment: string;
  appTier: string;
  xeroTenantId: string;
  xeroOrganisationName: string;
  status: string;
  lastConnectedAt: string | null;
  lastSuccessfulCallAt: string | null;
  health: ConnectionHealth;
  capacity: { used: number; limit: number; remaining: number };
  lastSyncRun: SyncRunSummary | null;
}

interface Entity {
  id: string;
  shortCode: string;
}

export default function XeroPage() {
  const [connections, setConnections] = useState<XeroConnectionRow[]>([]);
  const [entities, setEntities] = useState<Entity[]>([]);
  const [assignEntityByConn, setAssignEntityByConn] = useState<Record<string, string>>({});
  const [assignResult, setAssignResult] = useState<string | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);

  function reload() {
    fetch("/api/xero/connections").then((r) => r.json()).then((d) => setConnections(d.connections));
    fetch("/api/entities").then((r) => r.json()).then((d) => setEntities(d.entities));
  }

  // Posted through fetch rather than a plain form so a 409 from the capacity
  // gate can be shown in place, instead of replacing the page with raw JSON.
  async function connect(e: React.FormEvent) {
    e.preventDefault();
    setConnectError(null);

    const res = await fetch("/api/xero/apps/ramwall_read_core_dev/oauth/start", { method: "POST" });
    if (res.redirected) {
      window.location.href = res.url;
      return;
    }
    const body = await res.json().catch(() => ({}));
    setConnectError(body.error ?? "Could not start the Xero connection.");
  }

  useEffect(reload, []);

  async function assign(connectionId: string) {
    const entityId = assignEntityByConn[connectionId];
    if (!entityId) return;
    const res = await fetch("/api/xero/assignments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entityId, purpose: "read_core", connectionId }),
    });
    const body = await res.json();
    setAssignResult(res.ok ? "Assignment created." : `Error: ${body.error}`);
  }

  return (
    <div className="space-y-8">
      <PageHeading title="Xero Connections">
        One development Starter app is seeded with read-only scopes. Connect it to the Xero Demo
        Company or a real organisation, then assign the resulting connection to an entity.
      </PageHeading>

      {connections.length > 0 && (
        <div className="rounded border border-slate-200 bg-white px-4 py-3 text-sm shadow-panel">
          <span className="text-slate-500">Connection capacity </span>
          <span className="figures font-medium text-slate-900">
            {connections[0]!.capacity.used} of {connections[0]!.capacity.limit}
          </span>
          <span className="text-slate-400"> on the {connections[0]!.appTier} tier</span>
          {connections[0]!.capacity.remaining === 0 && (
            <span className="ml-2">
              <StatusPill tone="stale">
                full, connecting another organisation needs a tier decision
              </StatusPill>
            </span>
          )}
        </div>
      )}

      <div className="space-y-3">
        <form onSubmit={connect}>
          <Button type="submit">Connect Xero organisation</Button>
        </form>
        {connectError && <Notice tone="error">{connectError}</Notice>}
        <p className="max-w-prose text-xs text-slate-400">
          Requires XERO_RAMWALL_READ_CORE_DEV_CLIENT_ID, _CLIENT_SECRET and
          XERO_TOKEN_ENCRYPTION_KEY_V1 to be set. See .env.example.
        </p>
      </div>

      <TableFrame>
        <Thead>
          <tr>
            <Th>App</Th>
            <Th>Organisation</Th>
            <Th>Status</Th>
            <Th>Assign to entity</Th>
          </tr>
        </Thead>
          <tbody>
            {connections.map((c) => (
              <tr key={c.id} className="border-t border-slate-100">
                <td className="px-4 py-3">
                  {c.appDisplayName}
                  <div className="text-xs text-slate-400">{c.appEnvironment}</div>
                </td>
                <td className="px-4 py-3">
                  {c.xeroOrganisationName}
                  <div className="text-xs text-slate-400 font-mono">{c.xeroTenantId}</div>
                </td>
                <td className="px-4 py-3 align-top">
                  {/* The status word carries the state, the pill's tone only
                      reinforces it. Health is the reason a stale figure looks
                      current, so it is never colour alone. */}
                  <StatusPill
                    tone={
                      c.health.level === "error"
                        ? "exception"
                        : c.health.level === "warning"
                          ? "stale"
                          : "healthy"
                    }
                  >
                    {c.status}
                  </StatusPill>
                  {c.health.message && (
                    <div className="mt-1 max-w-xs text-xs text-slate-500">{c.health.message}</div>
                  )}
                  {c.lastSyncRun && (
                    <div className="mt-0.5 text-xs text-slate-400">
                      Last sync {c.lastSyncRun.status}, {c.lastSyncRun.recordsRead} records
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 align-top">
                  <div className="flex gap-2">
                    <Select
                      className="w-40"
                      value={assignEntityByConn[c.id] ?? ""}
                      onChange={(e) =>
                        setAssignEntityByConn((s) => ({ ...s, [c.id]: e.target.value }))
                      }
                    >
                      <option value="">Select entity…</option>
                      {entities.map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.shortCode}
                        </option>
                      ))}
                    </Select>
                    <Button variant="secondary" onClick={() => assign(c.id)}>
                      Assign
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          {connections.length === 0 && (
            <EmptyRow colSpan={4}>
              No Xero organisations connected yet.
            </EmptyRow>
          )}
        </tbody>
      </TableFrame>
      {assignResult && <Notice tone={assignResult.startsWith("Error") ? "error" : "ok"}>{assignResult}</Notice>}
    </div>
  );
}

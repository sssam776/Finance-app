"use client";

import { useEffect, useState } from "react";

interface XeroConnectionRow {
  id: string;
  xeroAppId: string;
  appDisplayName: string;
  appEnvironment: string;
  xeroTenantId: string;
  xeroOrganisationName: string;
  status: string;
  lastConnectedAt: string | null;
  lastSuccessfulCallAt: string | null;
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

  function reload() {
    fetch("/api/xero/connections").then((r) => r.json()).then((d) => setConnections(d.connections));
    fetch("/api/entities").then((r) => r.json()).then((d) => setEntities(d.entities));
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
      <div>
        <h1 className="text-2xl font-semibold">Xero Connections</h1>
        <p className="text-sm text-slate-500">
          One development Starter app is seeded (read-only scopes). Connect it to the Xero Demo
          Company or a real organisation, then assign the resulting connection to an entity.
        </p>
      </div>

      <form action="/api/xero/apps/ramwall_read_core_dev/oauth/start" method="POST">
        <button type="submit" className="rounded bg-slate-800 px-3 py-1.5 text-sm text-white hover:bg-slate-700">
          Connect Xero organisation
        </button>
      </form>
      <p className="text-xs text-slate-400">
        Requires XERO_RAMWALL_READ_CORE_DEV_CLIENT_ID / _CLIENT_SECRET and XERO_TOKEN_ENCRYPTION_KEY_V1
        to be set — see .env.example.
      </p>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">App</th>
              <th className="px-4 py-3">Organisation</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Assign to entity (read_core)</th>
            </tr>
          </thead>
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
                <td className="px-4 py-3">{c.status}</td>
                <td className="px-4 py-3">
                  <div className="flex gap-2">
                    <select
                      className="rounded border border-slate-300 px-2 py-1 text-xs"
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
                    </select>
                    <button
                      onClick={() => assign(c.id)}
                      className="rounded bg-slate-800 px-2 py-1 text-xs text-white hover:bg-slate-700"
                    >
                      Assign
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {connections.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-slate-400">
                  No connections yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {assignResult && <p className="text-sm text-slate-600">{assignResult}</p>}
    </div>
  );
}

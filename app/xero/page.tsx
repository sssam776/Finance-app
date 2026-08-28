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

interface XeroAppRow {
  appKey: string;
  displayName: string;
  environment: string;
  tier: string;
  connectionLimit: number;
  connectionsUsed: number;
  connectionsRemaining: number;
  atCapacity: boolean;
  configured: boolean;
  clientIdEnvVar: string;
  clientSecretEnvVar: string;
}

export default function XeroPage() {
  const [connections, setConnections] = useState<XeroConnectionRow[]>([]);
  const [entities, setEntities] = useState<Entity[]>([]);
  const [apps, setApps] = useState<XeroAppRow[]>([]);
  const [selectedAppKey, setSelectedAppKey] = useState("");
  const [assignEntityByConn, setAssignEntityByConn] = useState<Record<string, string>>({});
  const [assignResult, setAssignResult] = useState<string | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);

  function reload() {
    fetch("/api/xero/connections").then((r) => r.json()).then((d) => setConnections(d.connections));
    fetch("/api/entities").then((r) => r.json()).then((d) => setEntities(d.entities));
    fetch("/api/xero/apps")
      .then((r) => r.json())
      .then((d) => {
        setApps(d.apps);
        // Default to the first app that can actually take a connection, rather
        // than to the first in the list. Selecting a full or unconfigured app by
        // default sends someone to a failure they did not choose.
        setSelectedAppKey((current) => {
          if (current) return current;
          const usable = d.apps.find((a: XeroAppRow) => !a.atCapacity && a.configured);
          return (usable ?? d.apps[0])?.appKey ?? "";
        });
      });
  }

  const selectedApp = apps.find((a) => a.appKey === selectedAppKey) ?? null;

  // Posted through fetch rather than a plain form so a 409 from the capacity
  // gate can be shown in place, instead of replacing the page with raw JSON.
  async function connect(e: React.FormEvent) {
    e.preventDefault();
    setConnectError(null);

    if (!selectedAppKey) {
      setConnectError("No Xero app is registered. Run the database seed first.");
      return;
    }

    const res = await fetch(`/api/xero/apps/${encodeURIComponent(selectedAppKey)}/oauth/start`, {
      method: "POST",
    });
    const body = await res.json().catch(() => ({}));

    // The route returns the consent URL rather than redirecting to it, because
    // fetch cannot follow a redirect to another origin — see the comment in
    // that route. Navigating here is what actually opens Xero's consent screen.
    if (res.ok && body.consentUrl) {
      window.location.href = body.consentUrl;
      return;
    }
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
        Development Starter apps are seeded with read-only scopes. Connect one to the Xero Demo
        Company or a real organisation, then assign the resulting connection to an entity. Capacity
        is per app and there is no automatic spillover — choosing which app an organisation connects
        through is a decision, not something the router makes for you.
      </PageHeading>

      {apps.length > 0 && (
        <div className="space-y-2 rounded bg-white px-4 py-3 text-sm shadow-panel">
          {/* Capacity is per registration, so each app reports its own. A single
              figure taken from one app misrepresents every other one. */}
          {apps.map((app) => (
            <div key={app.appKey} className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-slate-900">{app.displayName}</span>
              <span className="figures text-slate-500">
                {app.connectionsUsed} of {app.connectionLimit}
              </span>
              <span className="text-slate-400">on the {app.tier} tier</span>
              {app.atCapacity && (
                <StatusPill tone="stale">full, another organisation needs a tier decision</StatusPill>
              )}
              {!app.configured && <StatusPill tone="exception">credentials not set</StatusPill>}
            </div>
          ))}
        </div>
      )}

      <div className="space-y-3">
        <form onSubmit={connect} className="flex flex-wrap items-end gap-3">
          {apps.length > 1 && (
            <label className="text-sm">
              <span className="mb-1 block text-slate-500">Connect through</span>
              <Select
                value={selectedAppKey}
                onChange={(e) => setSelectedAppKey(e.target.value)}
                className="min-w-64"
              >
                {apps.map((app) => (
                  <option key={app.appKey} value={app.appKey}>
                    {app.displayName} — {app.connectionsRemaining} free
                    {app.configured ? "" : " (no credentials)"}
                  </option>
                ))}
              </Select>
            </label>
          )}
          <Button type="submit" disabled={!selectedApp || selectedApp.atCapacity}>
            Connect Xero organisation
          </Button>
        </form>
        {connectError && <Notice tone="error">{connectError}</Notice>}
        {selectedApp && !selectedApp.configured && (
          <Notice tone="warn">
            {selectedApp.displayName} has no credentials. Set {selectedApp.clientIdEnvVar} and{" "}
            {selectedApp.clientSecretEnvVar} in .env.local, then restart the dev server.
          </Notice>
        )}
        <p className="max-w-prose text-xs text-slate-400">
          Each app needs its own client ID and secret, plus XERO_TOKEN_ENCRYPTION_KEY_V1. See
          .env.example.
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

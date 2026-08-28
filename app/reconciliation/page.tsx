"use client";

import { useCallback, useEffect, useState } from "react";
import {
  PageHeading,
  Panel,
  TableFrame,
  Thead,
  Th,
  Field,
  Select,
  Input,
  Button,
  StatusPill,
  Notice,
  EmptyRow,
  ExportCsvLink,
} from "../ui";

interface Entity {
  id: string;
  shortCode: string;
}

interface Workpaper {
  id: string;
  accountCode: string;
  accountName: string;
  tbAmount: string;
  substantiationType: string;
  substantiatedAmount: string | null;
  difference: string | null;
  currency: string;
  status: string;
  isMaterial: boolean;
}

interface Response {
  available: boolean;
  reason?: string;
  period?: {
    id: string;
    status: string;
    lockedByEmail: string | null;
    lockedAt: string | null;
    lockAcknowledgedUnresolved: boolean;
  };
  readiness?: { ready: boolean; settled: number; outstanding: number; blocking: string[] };
  workpapers: Workpaper[];
  evidence?: {
    tbSnapshotId: string;
    syncRunId: string;
    tenantId: string;
    balanced: boolean | null;
    fetchedAt: string;
  } | null;
}

/**
 * Statuses that mean the balance is genuinely supported. Anything else is
 * shown in a tone that says so: a balance-sheet screen where everything looks
 * settled is the exact impression this module exists to avoid giving.
 */
const SETTLED = new Set(["reconciled", "reconciled_with_timing_difference", "reviewed", "locked"]);

function toneFor(status: string): "healthy" | "stale" | "exception" | "neutral" {
  if (SETTLED.has(status)) return "healthy";
  if (status === "unresolved") return "exception";
  if (status === "unsubstantiated" || status === "partial") return "stale";
  return "neutral";
}

function monthEnds(): string[] {
  const now = new Date();
  return Array.from({ length: 18 }, (_, i) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i + 1, 0));
    return d.toISOString().slice(0, 10);
  });
}

export default function ReconciliationPage() {
  const [entities, setEntities] = useState<Entity[]>([]);
  const [entityId, setEntityId] = useState("");
  const [periodEnd, setPeriodEnd] = useState(monthEnds()[1] ?? "");
  const [data, setData] = useState<Response | null>(null);
  const [loading, setLoading] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [reopenReason, setReopenReason] = useState("");

  useEffect(() => {
    fetch("/api/entities")
      .then((r) => (r.ok ? r.json() : { entities: [] }))
      .then((d) => {
        setEntities(d.entities);
        if (d.entities?.[0]) setEntityId(d.entities[0].id);
      })
      .catch(() => setEntities([]));

    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setIsAdmin(d?.user?.role === "admin"))
      .catch(() => setIsAdmin(false));
  }, []);

  const load = useCallback(() => {
    if (!entityId || !periodEnd) return;
    const controller = new AbortController();
    setLoading(true);

    fetch(`/api/reconciliation?entityId=${entityId}&periodEnd=${periodEnd}`, {
      signal: controller.signal,
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (!controller.signal.aborted) setData(body);
      })
      .catch((err) => {
        if (err?.name !== "AbortError") setData(null);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [entityId, periodEnd]);

  useEffect(() => {
    const cleanup = load();
    return cleanup;
  }, [load]);

  async function act(path: string, body: unknown, successText: string) {
    setBusy(true);
    setMessage(null);
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await res.json().catch(() => ({}));
    setMessage(
      res.ok
        ? { ok: true, text: successText }
        : { ok: false, text: typeof result.error === "string" ? result.error : "That did not work." }
    );
    setBusy(false);
    load();
  }

  const period = data?.period;
  const locked = period?.status === "locked";

  return (
    <div className="space-y-6">
      <PageHeading title="Balance Sheet">
        Every balance-sheet account, what supports it, and what does not. An account with no
        supporting source is never marked reconciled.
      </PageHeading>

      <Panel>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Entity">
            <Select value={entityId} onChange={(e) => setEntityId(e.target.value)}>
              {entities.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.shortCode}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Period end">
            <Select value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)}>
              {monthEnds().map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-slate-200 pt-4">
          {isAdmin && (
            <>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() =>
                  act(
                    "/api/xero/sync/trial-balance",
                    { entityId, periodEnd },
                    "Trial balance synced."
                  )
                }
              >
                Sync trial balance
              </Button>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() =>
                  act("/api/reconciliation", { entityId, periodEnd }, "Workpapers prepared.")
                }
              >
                Prepare workpapers
              </Button>
            </>
          )}
          <ExportCsvLink
            href={`/api/reconciliation?entityId=${encodeURIComponent(entityId)}&periodEnd=${encodeURIComponent(periodEnd)}&format=csv`}
            disabled={!data?.available}
          />
        </div>
        {message && (
          <div className="mt-3">
            <Notice tone={message.ok ? "ok" : "error"}>{message.text}</Notice>
          </div>
        )}
      </Panel>

      {loading && <p className="text-sm text-slate-500">Loading…</p>}

      {!loading && data && !data.available && <Notice tone="warn">{data.reason}</Notice>}

      {!loading && data?.available && (
        <>
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <StatusPill tone={locked ? "healthy" : "neutral"}>{period!.status}</StatusPill>
            <span className="text-slate-500">
              {data.readiness!.settled} settled · {data.readiness!.outstanding} outstanding
            </span>
            {data.readiness!.blocking.length > 0 && (
              <StatusPill tone="stale">
                {data.readiness!.blocking.length} material account(s) unsupported
              </StatusPill>
            )}
          </div>

          {period!.lockAcknowledgedUnresolved && (
            <Notice tone="warn">
              This period was locked while material accounts were still unsupported. The close was
              signed off knowing they were outstanding.
            </Notice>
          )}

          {data.evidence?.balanced === false && (
            <Notice tone="error">
              The trial balance behind these workpapers does not balance, so every figure here is
              suspect. Resolve that before relying on any of it.
            </Notice>
          )}

          <TableFrame>
            <Thead>
              <tr>
                <Th>Account</Th>
                <Th>Supported by</Th>
                <Th align="right">Per trial balance</Th>
                <Th align="right">Per source</Th>
                <Th align="right">Difference</Th>
                <Th>Status</Th>
              </tr>
            </Thead>
            <tbody>
              {data.workpapers.map((w) => (
                <tr
                  key={w.id}
                  className={
                    w.status === "unresolved"
                      ? "border-t border-slate-100 bg-exception-bg"
                      : "border-t border-slate-100"
                  }
                >
                  <td className="px-4 py-3 align-top">
                    <div className="text-slate-900">{w.accountName}</div>
                    <div className="font-mono text-xs text-slate-400">{w.accountCode}</div>
                    {w.isMaterial && (
                      <div className="mt-1">
                        <StatusPill tone="neutral">material</StatusPill>
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 align-top text-xs text-slate-500">
                    {w.substantiationType === "none"
                      ? "nothing attached"
                      : w.substantiationType.replace(/_/g, " ")}
                  </td>
                  <td className="figures whitespace-nowrap px-4 py-3 text-right align-top text-slate-900">
                    {w.tbAmount}
                  </td>
                  <td className="figures whitespace-nowrap px-4 py-3 text-right align-top text-slate-700">
                    {w.substantiatedAmount ?? <span className="text-slate-400">—</span>}
                  </td>
                  <td className="figures whitespace-nowrap px-4 py-3 text-right align-top text-slate-900">
                    {w.difference ?? <span className="text-slate-400">—</span>}
                  </td>
                  <td className="px-4 py-3 align-top">
                    <StatusPill tone={toneFor(w.status)}>{w.status.replace(/_/g, " ")}</StatusPill>
                  </td>
                </tr>
              ))}
              {data.workpapers.length === 0 && (
                <EmptyRow colSpan={6}>No workpapers for this period.</EmptyRow>
              )}
            </tbody>
          </TableFrame>

          {isAdmin && (
            <Panel title={locked ? "Reopen this period" : "Lock this period"}>
              {locked ? (
                <div className="space-y-3">
                  <p className="max-w-prose text-xs text-slate-500">
                    Locked by {period!.lockedByEmail} on {period!.lockedAt?.slice(0, 10)}.
                  </p>
                  <Field label="Reason for reopening">
                    <Input
                      value={reopenReason}
                      onChange={(e) => setReopenReason(e.target.value)}
                      placeholder="Why is this being reopened?"
                    />
                  </Field>
                  <Button
                    variant="secondary"
                    disabled={busy || reopenReason.trim() === ""}
                    onClick={() =>
                      act(
                        "/api/reconciliation/lock",
                        { periodId: period!.id, action: "reopen", reason: reopenReason },
                        "Period reopened."
                      )
                    }
                  >
                    Reopen
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="max-w-prose text-xs text-slate-500">
                    {data.readiness!.ready
                      ? "Every material account is supported."
                      : `${data.readiness!.blocking.length} material account(s) are unsupported. Locking anyway records that the close went ahead knowing.`}
                  </p>
                  <Button
                    disabled={busy}
                    onClick={() =>
                      act(
                        "/api/reconciliation/lock",
                        {
                          periodId: period!.id,
                          action: "lock",
                          acknowledgeUnresolved: !data.readiness!.ready,
                        },
                        "Period locked."
                      )
                    }
                  >
                    {data.readiness!.ready ? "Lock period" : "Lock, acknowledging the gaps"}
                  </Button>
                </div>
              )}
            </Panel>
          )}
        </>
      )}
    </div>
  );
}

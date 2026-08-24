"use client";

import { useEffect, useState } from "react";
import {
  PageHeading,
  Panel,
  TableFrame,
  Thead,
  Th,
  Field,
  Select,
  StatusPill,
  Notice,
  EmptyRow,
} from "../ui";

interface Entity {
  id: string;
  shortCode: string;
}

interface MovementRow {
  accountCode: string | null;
  accountName: string;
  sectionKind: string;
  currency: string;
  actual: string;
  comparative: string;
  movement: string;
  percent: string | null;
  favourable: boolean | null;
  isException: boolean;
}

interface VarianceResponse {
  available: boolean;
  reason?: string;
  entityShortCode?: string;
  periodLabel?: string;
  comparePeriodLabel?: string;
  currency?: string;
  rows?: MovementRow[];
  exceptionCount?: number;
  adverseCount?: number;
  favourableCount?: number;
  threshold?: { absoluteAmount: string; percent: string | null; scope: string } | null;
  evidence?: {
    reportSnapshotId: string;
    syncRunId: string;
    tenantId: string;
    parserVersion: string;
    fetchedAt: string;
    syncStatus: string | null;
  };
}

const COMPARISONS = [
  { value: "prior_month", label: "Prior month" },
  { value: "prior_year_month", label: "Same month last year" },
  { value: "budget", label: "Budget" },
];

/** Twelve months back from now, so the selector has something real to offer. */
function recentPeriods(): string[] {
  const now = new Date();
  return Array.from({ length: 18 }, (_, i) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  });
}

export default function VariancePage() {
  const [entities, setEntities] = useState<Entity[]>([]);
  const [entityId, setEntityId] = useState("");
  const [period, setPeriod] = useState(recentPeriods()[1] ?? "");
  const [comparison, setComparison] = useState("prior_month");
  const [data, setData] = useState<VarianceResponse | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/api/entities")
      .then((r) => (r.ok ? r.json() : { entities: [] }))
      .then((d) => {
        setEntities(d.entities);
        if (d.entities?.[0]) setEntityId(d.entities[0].id);
      })
      .catch(() => setEntities([]));
  }, []);

  useEffect(() => {
    if (!entityId || !period) return;

    // Superseded requests are aborted and their responses discarded. Without
    // this, selecting entity A then entity B shows A's figures under B's name
    // if A's response lands second, which is the worst kind of wrong: every
    // number is real and belongs to a different legal entity.
    const controller = new AbortController();
    setLoading(true);

    fetch(`/api/pl-variance?entityId=${entityId}&period=${period}&comparison=${comparison}`, {
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
  }, [entityId, period, comparison]);

  return (
    <div className="space-y-6">
      <PageHeading title="P&amp;L Movement">
        What changed between two periods, ranked so the movements worth explaining are at the top.
      </PageHeading>

      <Panel>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Entity">
            <Select value={entityId} onChange={(e) => setEntityId(e.target.value)}>
              {entities.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.shortCode}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Period">
            <Select value={period} onChange={(e) => setPeriod(e.target.value)}>
              {recentPeriods().map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Compared with">
            <Select value={comparison} onChange={(e) => setComparison(e.target.value)}>
              {COMPARISONS.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Panel>

      {loading && <p className="text-sm text-slate-500">Loading…</p>}

      {!loading && data && !data.available && <Notice tone="warn">{data.reason}</Notice>}

      {!loading && data?.available && (
        <>
          <div className="flex flex-wrap items-center gap-4 text-sm">
            {/* The entity the figures belong to, named from the response
                rather than the selector, so a mismatch is visible instead of
                being hidden behind whatever the dropdown happens to say. */}
            <span className="font-medium text-slate-900">{data.entityShortCode}</span>
            <span className="text-slate-500">
              {data.periodLabel} against {data.comparePeriodLabel}
            </span>
            {data.exceptionCount! > 0 && (
              <StatusPill tone="exception">
                {data.exceptionCount} over threshold
              </StatusPill>
            )}
            <span className="text-slate-400">
              {data.adverseCount} adverse · {data.favourableCount} favourable
            </span>
          </div>

          {!data.threshold && (
            // Without this, a page flagging nothing is indistinguishable from a
            // page where nothing breached. The first needs configuring; the
            // second is good news.
            <Notice tone="warn">
              No P&amp;L movement threshold is configured, so nothing is flagged as an exception.
              Rows below are ranked by size of movement only. Set a threshold on the Cash Position
              page to have breaches marked.
            </Notice>
          )}

          <TableFrame>
            <Thead>
              <tr>
                <Th>Account</Th>
                <Th>Section</Th>
                <Th align="right">{data.periodLabel}</Th>
                <Th align="right">{data.comparePeriodLabel}</Th>
                <Th align="right">Movement</Th>
                <Th>Effect</Th>
              </tr>
            </Thead>
            <tbody>
              {data.rows!.map((row) => (
                <tr
                  key={`${row.accountCode ?? ""}-${row.accountName}`}
                  className={
                    row.isException
                      ? "border-t border-slate-100 bg-exception-bg"
                      : "border-t border-slate-100"
                  }
                >
                  <td className="px-4 py-3 align-top">
                    <div className="text-slate-900">{row.accountName}</div>
                    {row.isException && (
                      <div className="mt-1">
                        <StatusPill tone="exception">exception</StatusPill>
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 align-top text-xs text-slate-500">
                    {row.sectionKind.replace(/_/g, " ")}
                  </td>
                  <td className="figures whitespace-nowrap px-4 py-3 text-right align-top text-slate-900">
                    {row.actual}
                  </td>
                  <td className="figures whitespace-nowrap px-4 py-3 text-right align-top text-slate-500">
                    {row.comparative}
                  </td>
                  <td className="figures whitespace-nowrap px-4 py-3 text-right align-top text-slate-900">
                    {row.movement}
                    {row.percent && (
                      <span className="ml-1 text-xs font-normal text-slate-400">
                        ({row.percent}%)
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 align-top">
                    {/* Spelled out, never colour alone: revenue rising and cost
                        rising are the same arithmetic and opposite news. */}
                    {row.favourable === null ? (
                      <span className="text-xs text-slate-400">—</span>
                    ) : (
                      <StatusPill tone={row.favourable ? "healthy" : "exception"}>
                        {row.favourable ? "favourable" : "adverse"}
                      </StatusPill>
                    )}
                  </td>
                </tr>
              ))}
              {data.rows!.length === 0 && (
                <EmptyRow colSpan={6}>No movement between these periods.</EmptyRow>
              )}
            </tbody>
          </TableFrame>

          {data.evidence && (
            <Panel title="Source">
              <dl className="grid gap-1 text-xs sm:grid-cols-2">
                <Fact label="Snapshot" value={data.evidence.reportSnapshotId} />
                <Fact label="Sync run" value={data.evidence.syncRunId} />
                <Fact label="Tenant" value={data.evidence.tenantId} />
                <Fact label="Parser" value={data.evidence.parserVersion} />
                <Fact label="Fetched" value={data.evidence.fetchedAt} />
                <Fact label="Sync status" value={data.evidence.syncStatus ?? "—"} />
              </dl>
              {data.threshold && (
                <p className="mt-3 text-xs text-slate-500">
                  Threshold {data.threshold.absoluteAmount}
                  {data.threshold.percent && ` or ${data.threshold.percent}%`}, {data.threshold.scope}{" "}
                  scope
                </p>
              )}
            </Panel>
          )}
        </>
      )}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="w-24 shrink-0 text-slate-400">{label}</dt>
      <dd className="break-all font-mono text-slate-700">{value}</dd>
    </div>
  );
}

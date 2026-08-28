"use client";

import { StatusPill, Notice, ExportCsvLink } from "../ui";

/**
 * The covenant and gearing position per security pool.
 *
 * Split out of the page rather than inlined because the page already carries
 * the facility register and its form; one file holding both would be the sort
 * of screen nobody wants to edit.
 */

export interface CovenantAssessmentView {
  outcome: "pass" | "breach" | "not_measurable" | "no_rule";
  actual: string | null;
  threshold: string | null;
  operator: "lte" | "gte" | null;
  ruleType: "covenant" | "monitoring" | "management_stress" | null;
  reason: string | null;
}

export interface PoolPositionView {
  poolId: string;
  poolName: string;
  lenderName: string;
  currency: string;
  targetLvr: string;
  stressRate: string;
  securityValue: string;
  drawnDebt: string;
  annualNoi: string;
  lvr: string | null;
  headroom: string;
  overLimitBy: string;
  debtYield: string | null;
  stressIcr: string | null;
  lvrCovenant: CovenantAssessmentView;
  icrCovenant: CovenantAssessmentView;
  propertyCount: number;
  facilityCount: number;
  gaps: string[];
}

export interface PositionResponse {
  asOf: string;
  basis: string;
  positions: PoolPositionView[];
  split: { investmentValue: string; developmentValue: string; heldForSaleValue: string };
  unpooled: { name: string; entityShortCode: string; value: string | null }[];
}

function pct(fraction: string | null, places = 1): string {
  return fraction === null ? "n/a" : `${(Number(fraction) * 100).toFixed(places)}%`;
}

function money(value: string): string {
  return Number(value).toLocaleString("en-NZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Four outcomes, three of which are not a breach and only one of which is a
 * pass. A lender with no express financial covenant is monitored rather than
 * failing, and a ratio that could not be computed is neither: collapsing any
 * of them into a boolean would draw a missing valuation as compliance.
 */
function CovenantCell({ label, assessment }: { label: string; assessment: CovenantAssessmentView }) {
  const tone =
    assessment.outcome === "breach"
      ? "exception"
      : assessment.outcome === "pass"
        ? "healthy"
        : assessment.outcome === "not_measurable"
          ? "stale"
          : "neutral";

  const text =
    assessment.outcome === "pass"
      ? "within covenant"
      : assessment.outcome === "breach"
        ? "breach"
        : assessment.outcome === "not_measurable"
          ? "cannot be measured"
          : "no covenant recorded";

  return (
    <div>
      <div className="text-label uppercase text-slate-500">{label}</div>
      <div className="mt-1">
        <StatusPill tone={tone}>{text}</StatusPill>
      </div>
      {assessment.threshold && (
        <div className="mt-1 text-xs text-slate-500">
          {assessment.operator === "lte" ? "max" : "min"} {assessment.threshold}
          {assessment.ruleType !== "covenant" && ` (${assessment.ruleType?.replace("_", " ")})`}
        </div>
      )}
      {assessment.outcome === "no_rule" && (
        <div className="mt-1 max-w-[15rem] text-xs text-slate-500">
          Monitored, not breaching. Record the term to test against it.
        </div>
      )}
    </div>
  );
}

export function PositionPanel({ data, asOf }: { data: PositionResponse | null; asOf: string }) {
  if (!data) return null;

  if (data.positions.length === 0) {
    return (
      <Notice tone="warn">
        No security pools have both properties and facilities yet. Add a property to a lender below,
        and its facilities join the same pool.
      </Notice>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-slate-500">
          Tested on {data.basis} valuations as at {data.asOf}
        </div>
        <ExportCsvLink href={`/api/portfolio/position?asOf=${encodeURIComponent(asOf)}&format=csv`} />
      </div>

      {data.positions.map((p) => (
        <div key={p.poolId} className="rounded bg-white shadow-panel">
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-100 px-4 py-3">
            <div className="font-medium text-slate-900">
              {p.lenderName}
              {p.poolName !== p.lenderName && <span className="text-slate-500"> · {p.poolName}</span>}
            </div>
            <div className="text-xs text-slate-500">
              {p.propertyCount} {p.propertyCount === 1 ? "property" : "properties"} ·{" "}
              {p.facilityCount} {p.facilityCount === 1 ? "facility" : "facilities"}
            </div>
          </div>

          <div className="grid gap-4 px-4 py-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <div className="text-label uppercase text-slate-500">Loan to value</div>
              <div className="figures mt-1 text-figure-hero text-slate-900">{pct(p.lvr)}</div>
              <div className="text-xs text-slate-500">target {pct(p.targetLvr, 0)}</div>
            </div>

            <div>
              <div className="text-label uppercase text-slate-500">
                {Number(p.overLimitBy) > 0 ? "Over limit by" : "Headroom"}
              </div>
              {/* Headroom and excess are the same axis read in opposite
                  directions. Showing a floored zero without saying which side
                  of the target the pool sits on hides the more urgent case. */}
              <div
                className={`figures mt-1 text-figure-hero ${
                  Number(p.overLimitBy) > 0 ? "text-exception" : "text-slate-900"
                }`}
              >
                {money(Number(p.overLimitBy) > 0 ? p.overLimitBy : p.headroom)}
              </div>
              <div className="text-xs text-slate-500">{p.currency} to target</div>
            </div>

            <CovenantCell label="LVR covenant" assessment={p.lvrCovenant} />
            <CovenantCell label="Interest cover" assessment={p.icrCovenant} />
          </div>

          <div className="grid gap-x-6 gap-y-2 border-t border-slate-100 px-4 py-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <span className="text-slate-500">Security </span>
              <span className="figures text-slate-900">{money(p.securityValue)}</span>
            </div>
            <div>
              <span className="text-slate-500">Drawn </span>
              <span className="figures text-slate-900">{money(p.drawnDebt)}</span>
            </div>
            <div>
              <span className="text-slate-500">Debt yield </span>
              <span className="figures text-slate-900">{pct(p.debtYield)}</span>
            </div>
            <div>
              <span className="text-slate-500">Cover at {pct(p.stressRate, 0)} </span>
              <span className="figures text-slate-900">
                {p.stressIcr === null ? "n/a" : `${Number(p.stressIcr).toFixed(2)}x`}
              </span>
            </div>
          </div>

          {p.gaps.length > 0 && (
            /* What the figures were computed from. A pool half of whose
               properties have no valuation still produces an LVR, and that
               number is worse than none unless the screen says so. */
            <div className="border-t border-slate-100 px-4 py-3">
              <div className="text-label uppercase text-slate-500">What this is missing</div>
              <ul className="mt-1 space-y-1">
                {p.gaps.map((g) => (
                  <li key={g} className="max-w-prose text-xs text-slate-600">
                    {g}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ))}

      {(Number(data.split.developmentValue) > 0 || Number(data.split.heldForSaleValue) > 0) && (
        <div className="rounded bg-white px-4 py-3 shadow-panel">
          <div className="text-label uppercase text-slate-500">Value by purpose</div>
          {/* Development stock sits outside the book a senior lender tests.
              Blending the two produces a group figure that flatters the
              investment book. */}
          <div className="mt-2 flex flex-wrap gap-x-8 gap-y-2 text-sm">
            <div>
              <span className="text-slate-500">Investment </span>
              <span className="figures text-slate-900">{money(data.split.investmentValue)}</span>
            </div>
            <div>
              <span className="text-slate-500">Development </span>
              <span className="figures text-slate-900">{money(data.split.developmentValue)}</span>
            </div>
            <div>
              <span className="text-slate-500">Held for sale </span>
              <span className="figures text-slate-900">{money(data.split.heldForSaleValue)}</span>
            </div>
          </div>
        </div>
      )}

      {data.unpooled.length > 0 && (
        <Notice tone="warn">
          {data.unpooled.length} propert{data.unpooled.length === 1 ? "y is" : "ies are"} charged to
          no pool and contribute to no covenant test:{" "}
          {data.unpooled.map((u) => u.name).join(", ")}.
        </Notice>
      )}
    </div>
  );
}

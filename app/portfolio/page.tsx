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
  SectionHeading,
} from "../ui";
import { PositionPanel, type PositionResponse } from "./PositionPanel";

interface Entity {
  id: string;
  shortCode: string;
  legalName: string;
}

interface WatchRow {
  facilityReference: string;
  lenderName: string;
  entityShortCode: string;
  eventType: string;
  eventDate: string;
  amount: string;
  currency: string;
  confirmed: boolean;
  daysUntil: number;
  urgency: "overdue" | "urgent" | "soon" | "watch" | "distant";
}

interface Facility {
  id: string;
  entityShortCode: string;
  lenderName: string;
  facilityReference: string;
  facilityType: string;
  drawnAmount: string;
  facilityLimit: string | null;
  currency: string;
  interestRate: string | null;
  rateType: string;
}

interface PortfolioResponse {
  asOf: string;
  facilities: Facility[];
  watch: WatchRow[];
  withinTwelveMonths: { currency: string; amount: string; facilityCount: number }[];
}

/**
 * Urgency drives colour, and only three tones exist for five bands. Overdue
 * and urgent are both exceptions because both need a decision now; watch and
 * distant are neutral because colouring them would leave nothing for the rows
 * that matter.
 */
const URGENCY_TONE: Record<WatchRow["urgency"], "exception" | "stale" | "neutral"> = {
  overdue: "exception",
  urgent: "exception",
  soon: "stale",
  watch: "neutral",
  distant: "neutral",
};

const URGENCY_LABEL: Record<WatchRow["urgency"], string> = {
  overdue: "overdue",
  urgent: "within 3 months",
  soon: "within 12 months",
  watch: "within 18 months",
  distant: "beyond 18 months",
};

function describeDays(days: number): string {
  if (days === 0) return "today";
  if (days < 0) return `${Math.abs(days)} days ago`;
  return `in ${days} days`;
}

export default function PortfolioPage() {
  const [entities, setEntities] = useState<Entity[]>([]);
  const [data, setData] = useState<PortfolioResponse | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [showDistant, setShowDistant] = useState(false);
  const [position, setPosition] = useState<PositionResponse | null>(null);
  const [propertyForm, setPropertyForm] = useState({
    entityId: "",
    name: "",
    lenderName: "",
    status: "investment",
    value: "",
    valuationDate: "",
    annualNoi: "",
    targetLvr: "0.65",
    stressRate: "0.07",
  });
  const [propertyMessage, setPropertyMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const [form, setForm] = useState({
    entityId: "",
    lenderName: "",
    facilityReference: "",
    facilityType: "term_loan",
    drawnAmount: "",
    facilityLimit: "",
    interestRate: "",
    rateType: "unknown",
    rateRefixDate: "",
    termExpiryDate: "",
    interestCapitalised: false,
  });

  const reload = useCallback(() => {
    fetch("/api/portfolio/facilities")
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData(null));
    fetch("/api/portfolio/position")
      .then((r) => r.json())
      .then(setPosition)
      .catch(() => setPosition(null));
  }, []);

  async function addProperty(e: React.FormEvent) {
    e.preventDefault();
    setPropertyMessage(null);

    // Optional fields are omitted rather than sent empty: the schema validates
    // shape, and "" is neither a decimal nor a date.
    const body: Record<string, unknown> = {
      entityId: propertyForm.entityId,
      name: propertyForm.name,
      lenderName: propertyForm.lenderName,
      status: propertyForm.status,
      value: propertyForm.value,
      targetLvr: propertyForm.targetLvr,
      stressRate: propertyForm.stressRate,
    };
    for (const key of ["valuationDate", "annualNoi"] as const) {
      if (propertyForm[key].trim() !== "") body[key] = propertyForm[key].trim();
    }

    const res = await fetch("/api/portfolio/properties", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      setPropertyMessage({ ok: false, text: payload.error ?? "Could not save the property." });
      return;
    }
    setPropertyMessage({ ok: true, text: `${propertyForm.name} added.` });
    setPropertyForm((f) => ({ ...f, name: "", value: "", valuationDate: "", annualNoi: "" }));
    reload();
  }

  useEffect(() => {
    fetch("/api/entities")
      .then((r) => r.json())
      .then((d) => setEntities(d.entities ?? []));
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => setIsAdmin(d?.user?.role === "admin"))
      .catch(() => setIsAdmin(false));
    reload();
  }, [reload]);

  async function addFacility(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);

    // Optional fields are omitted rather than sent empty: the schema validates
    // shape, and "" is not a valid decimal or date.
    const body: Record<string, unknown> = {
      entityId: form.entityId,
      lenderName: form.lenderName,
      facilityReference: form.facilityReference,
      facilityType: form.facilityType,
      drawnAmount: form.drawnAmount,
      rateType: form.rateType,
      interestCapitalised: form.interestCapitalised,
    };
    for (const key of ["facilityLimit", "interestRate", "rateRefixDate", "termExpiryDate"] as const) {
      if (form[key].trim() !== "") body[key] = form[key].trim();
    }

    const res = await fetch("/api/portfolio/facilities", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await res.json().catch(() => ({}));
    setBusy(false);

    if (!res.ok) {
      setMessage({ ok: false, text: payload.error ?? "Could not save the facility." });
      return;
    }
    setMessage({ ok: true, text: `${form.lenderName} ${form.facilityReference} added.` });
    setForm((f) => ({
      ...f,
      lenderName: "",
      facilityReference: "",
      drawnAmount: "",
      facilityLimit: "",
      interestRate: "",
      rateRefixDate: "",
      termExpiryDate: "",
    }));
    reload();
  }

  const visibleWatch = (data?.watch ?? []).filter(
    (r) => showDistant || r.urgency !== "distant"
  );

  return (
    <div className="space-y-8">
      <PageHeading title="Debt and Facilities">
        Gearing and covenant position per security pool, then the facilities behind it. Lenders
        hold a pool of properties rather than any single building, so a question about one property
        can only be answered from the whole pool.
      </PageHeading>

      <PositionPanel data={position} asOf={position?.asOf ?? ""} />

      <SectionHeading title="Facility expiry watch">
        Rate re-fixes and term expiries, soonest first. A facility that rolled over without anyone
        deciding to roll it is the avoidable version of a funding problem.
      </SectionHeading>

      {data && data.withinTwelveMonths.length > 0 && (
        <div className="rounded bg-white px-4 py-3 shadow-panel">
          <div className="text-label uppercase text-slate-500">Maturing or re-fixing within 12 months</div>
          <div className="mt-1 flex flex-wrap items-baseline gap-x-6 gap-y-2">
            {data.withinTwelveMonths.map((t) => (
              <div key={t.currency}>
                <span className="figures text-figure-hero text-slate-900">{t.amount}</span>
                {/* Currency sits with the amount: this app never sums across
                    currencies, so a bare figure would imply it had. */}
                <span className="ml-1.5 text-sm text-slate-500">{t.currency}</span>
                <span className="ml-2 text-sm text-slate-500">
                  across {t.facilityCount} {t.facilityCount === 1 ? "facility" : "facilities"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={showDistant}
              onChange={(e) => setShowDistant(e.target.checked)}
            />
            Include facilities beyond 18 months
          </label>
          <ExportCsvLink
            href="/api/portfolio/facilities?format=csv"
            disabled={!data || data.watch.length === 0}
          />
        </div>

        <TableFrame>
          <Thead>
            <tr>
              <Th>Entity</Th>
              <Th>Lender</Th>
              <Th>Facility</Th>
              <Th>Event</Th>
              <Th>Date</Th>
              <Th align="right">Drawn</Th>
              <Th>Urgency</Th>
            </tr>
          </Thead>
          <tbody>
            {visibleWatch.map((row) => (
              <tr key={`${row.facilityReference}-${row.eventType}-${row.eventDate}`} className="border-t border-slate-100">
                <td className="px-4 py-3 font-mono text-xs text-slate-600">{row.entityShortCode}</td>
                <td className="px-4 py-3 text-slate-700">{row.lenderName}</td>
                <td className="px-4 py-3 text-slate-900">{row.facilityReference}</td>
                <td className="px-4 py-3 text-slate-600">
                  {row.eventType === "rate_refix" ? "rate re-fix" : row.eventType.replace("_", " ")}
                </td>
                <td className="px-4 py-3">
                  <div className="figures text-slate-900">{row.eventDate}</div>
                  <div className="text-xs text-slate-500">{describeDays(row.daysUntil)}</div>
                </td>
                <td className="figures px-4 py-3 text-right text-slate-900">
                  {row.amount}
                  <span className="ml-1 text-xs font-normal text-slate-400">{row.currency}</span>
                </td>
                <td className="px-4 py-3">
                  <StatusPill tone={URGENCY_TONE[row.urgency]}>{URGENCY_LABEL[row.urgency]}</StatusPill>
                  {row.urgency === "overdue" && !row.confirmed && (
                    /* A past date is usually a facility that was rolled and
                       never recorded. Saying so stops a register gap being
                       read as a default. */
                    <div className="mt-1 max-w-[16rem] text-xs text-slate-500">
                      Unconfirmed. Check whether this was rolled.
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {visibleWatch.length === 0 && (
              <EmptyRow colSpan={7}>
                {data && data.watch.length > 0
                  ? "Nothing inside 18 months. Tick the box above to see the rest."
                  : "No facilities recorded yet."}
              </EmptyRow>
            )}
          </tbody>
        </TableFrame>
      </div>

      {isAdmin && (
        <Panel title="Add a property to the security register">
          <form onSubmit={addProperty} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Entity">
              <Select
                value={propertyForm.entityId}
                onChange={(e) => setPropertyForm((f) => ({ ...f, entityId: e.target.value }))}
                required
              >
                <option value="">Select…</option>
                {entities.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.shortCode}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Property">
              <Input
                value={propertyForm.name}
                onChange={(e) => setPropertyForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="367 Great South Road"
                required
              />
            </Field>

            <Field label="Charged to lender" hint="creates the pool on first use">
              <Input
                value={propertyForm.lenderName}
                onChange={(e) => setPropertyForm((f) => ({ ...f, lenderName: e.target.value }))}
                placeholder="ASB"
                required
              />
            </Field>

            <Field label="Purpose" hint="development sits outside the investment LVR">
              <Select
                value={propertyForm.status}
                onChange={(e) => setPropertyForm((f) => ({ ...f, status: e.target.value }))}
              >
                <option value="investment">Investment</option>
                <option value="development">Development</option>
                <option value="held_for_sale">Held for sale</option>
              </Select>
            </Field>

            <Field label="Bank valuation" hint="the basis a covenant is tested on, not sale price">
              <Input
                value={propertyForm.value}
                onChange={(e) => setPropertyForm((f) => ({ ...f, value: e.target.value }))}
                placeholder="3425000.00"
                required
              />
            </Field>

            <Field label="Valued on">
              <Input
                type="date"
                value={propertyForm.valuationDate}
                onChange={(e) => setPropertyForm((f) => ({ ...f, valuationDate: e.target.value }))}
              />
            </Field>

            <Field label="Annual NOI" hint="leave blank if income is not yet mapped">
              <Input
                value={propertyForm.annualNoi}
                onChange={(e) => setPropertyForm((f) => ({ ...f, annualNoi: e.target.value }))}
                placeholder="250000.00"
              />
            </Field>

            <Field label="Pool target LVR" hint="applied only when the pool is created">
              <Input
                value={propertyForm.targetLvr}
                onChange={(e) => setPropertyForm((f) => ({ ...f, targetLvr: e.target.value }))}
                placeholder="0.65"
              />
            </Field>

            <Field label="Pool stress rate" hint="internal assumption, not a facility term">
              <Input
                value={propertyForm.stressRate}
                onChange={(e) => setPropertyForm((f) => ({ ...f, stressRate: e.target.value }))}
                placeholder="0.07"
              />
            </Field>

            <div className="sm:col-span-2 lg:col-span-3">
              <Button type="submit">Add property</Button>
              <p className="mt-2 max-w-prose text-xs text-slate-400">
                Bank value is what the lender holds the security at and is what the covenant is
                tested against. It is not the sale price, and the two are not interchangeable.
              </p>
            </div>
          </form>
          {propertyMessage && (
            <div className="mt-3">
              <Notice tone={propertyMessage.ok ? "ok" : "error"}>{propertyMessage.text}</Notice>
            </div>
          )}
        </Panel>
      )}

      {isAdmin && (
        <Panel title="Add a facility">
          <form onSubmit={addFacility} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Entity">
              <Select
                value={form.entityId}
                onChange={(e) => setForm((f) => ({ ...f, entityId: e.target.value }))}
                required
              >
                <option value="">Select…</option>
                {entities.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.shortCode}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Lender">
              <Input
                value={form.lenderName}
                onChange={(e) => setForm((f) => ({ ...f, lenderName: e.target.value }))}
                placeholder="ASB"
                required
              />
            </Field>

            <Field label="Facility reference">
              <Input
                value={form.facilityReference}
                onChange={(e) => setForm((f) => ({ ...f, facilityReference: e.target.value }))}
                placeholder="639-92-003"
                required
              />
            </Field>

            <Field label="Facility type">
              <Select
                value={form.facilityType}
                onChange={(e) => setForm((f) => ({ ...f, facilityType: e.target.value }))}
              >
                <option value="term_loan">Term loan</option>
                <option value="revolving_credit">Revolving credit</option>
                <option value="overdraft">Overdraft</option>
                <option value="development">Development</option>
                <option value="other">Other</option>
              </Select>
            </Field>

            <Field label="Drawn amount">
              <Input
                value={form.drawnAmount}
                onChange={(e) => setForm((f) => ({ ...f, drawnAmount: e.target.value }))}
                placeholder="456440.27"
                required
              />
            </Field>

            <Field label="Facility limit" hint="optional, for undrawn headroom">
              <Input
                value={form.facilityLimit}
                onChange={(e) => setForm((f) => ({ ...f, facilityLimit: e.target.value }))}
                placeholder="500000.00"
              />
            </Field>

            <Field label="Interest rate" hint="decimal fraction, 0.0785 for 7.85%">
              <Input
                value={form.interestRate}
                onChange={(e) => setForm((f) => ({ ...f, interestRate: e.target.value }))}
                placeholder="0.0785"
              />
            </Field>

            <Field label="Rate re-fixes on" hint="at least one date is required">
              <Input
                type="date"
                value={form.rateRefixDate}
                onChange={(e) => setForm((f) => ({ ...f, rateRefixDate: e.target.value }))}
              />
            </Field>

            <Field label="Term expires on">
              <Input
                type="date"
                value={form.termExpiryDate}
                onChange={(e) => setForm((f) => ({ ...f, termExpiryDate: e.target.value }))}
              />
            </Field>

            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={form.interestCapitalised}
                onChange={(e) => setForm((f) => ({ ...f, interestCapitalised: e.target.checked }))}
              />
              Interest capitalises
            </label>

            <div className="sm:col-span-2 lg:col-span-3">
              <Button type="submit" disabled={busy}>
                {busy ? "Saving…" : "Add facility"}
              </Button>
              <p className="mt-2 max-w-prose text-xs text-slate-400">
                Interest that capitalises is not serviced out of income, so it is excluded from
                interest cover rather than averaged in.
              </p>
            </div>
          </form>
          {message && (
            <div className="mt-3">
              <Notice tone={message.ok ? "ok" : "error"}>{message.text}</Notice>
            </div>
          )}
        </Panel>
      )}
    </div>
  );
}

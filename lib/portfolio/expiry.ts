import Decimal from "decimal.js";
import { daysSince, type DateOnly } from "../dates";

/**
 * Facility expiry watch.
 *
 * A property group's most avoidable crisis is a facility that rolled over
 * without anyone deciding to roll it. Rate re-fixes and term expiries are
 * known months ahead and become urgent only through inattention, so the whole
 * value of this is arriving before the date does.
 *
 * Urgency bands follow the CFO schedule: overdue, then three, twelve and
 * eighteen months. Twelve is the headline because it is the horizon a board
 * paper covers.
 */

export const URGENCY_BANDS = ["overdue", "urgent", "soon", "watch", "distant"] as const;
export type Urgency = (typeof URGENCY_BANDS)[number];

/** Upper bound of each band in days, ordered. Overdue is anything negative. */
const URGENT_DAYS = 92; // about three months
/**
 * 366, not 365. A facility expiring on its twelve-month anniversary is 366
 * days out whenever 29 February falls in between, which dropped it out of the
 * figure headed "within twelve months" on exactly the date it matters.
 */
const SOON_DAYS = 366;
const WATCH_DAYS = 549; // about eighteen months, on the same basis

export interface FacilityEventLike {
  /**
   * The facility's own identifier. Aggregation keys on this rather than on the
   * reference, which is unique only per lender (`loan_facilities_lender_reference_unique`).
   */
  facilityId: string;
  facilityReference: string;
  lenderName: string;
  entityShortCode: string;
  eventType: "rate_refix" | "term_expiry" | "review" | "drawdown";
  eventDate: DateOnly;
  /** Drawn amount at risk when this event lands. Decimal string. */
  amount: string;
  currency: string;
  /**
   * Whether a past date has been checked. A term-expiry date in the past is
   * usually a facility that was rolled and never recorded, not a default, so
   * it must read as needing confirmation rather than as a crisis.
   */
  confirmed: boolean;
}

export interface ExpiryWatchRow extends FacilityEventLike {
  /** Negative when the date has passed. */
  daysUntil: number;
  urgency: Urgency;
}

/**
 * Days from `asOf` until the event. Negative once the date has passed.
 *
 * `daysSince` already handles the date-only arithmetic and the timezone trap
 * that comes with it, so this is its sign inverted rather than a second
 * implementation.
 */
export function daysUntil(eventDate: DateOnly, asOf: DateOnly): number {
  const remaining = -daysSince(eventDate, `${asOf}T00:00:00.000Z`);
  // Negating zero yields -0, which renders as "-0" next to a facility expiring
  // today. Normalised here rather than at each display site.
  return remaining === 0 ? 0 : remaining;
}

export function urgencyOf(daysRemaining: number): Urgency {
  if (daysRemaining < 0) return "overdue";
  if (daysRemaining <= URGENT_DAYS) return "urgent";
  if (daysRemaining <= SOON_DAYS) return "soon";
  if (daysRemaining <= WATCH_DAYS) return "watch";
  return "distant";
}

/**
 * Classifies and orders events, soonest first.
 *
 * Everything is returned including `distant`, because filtering is the
 * caller's decision and a facility dropped here is one nobody sees. Sorting is
 * by date rather than by band so two events in the same band still read in the
 * order they will arrive.
 */
export function expiryWatch(events: FacilityEventLike[], asOf: DateOnly): ExpiryWatchRow[] {
  return events
    .map((event) => {
      const remaining = daysUntil(event.eventDate, asOf);
      return { ...event, daysUntil: remaining, urgency: urgencyOf(remaining) };
    })
    .sort(
      (a, b) =>
        a.daysUntil - b.daysUntil ||
        a.lenderName.localeCompare(b.lenderName) ||
        a.facilityReference.localeCompare(b.facilityReference)
    );
}

export interface ExpiryTotal {
  currency: string;
  amount: string;
  facilityCount: number;
}

/**
 * Value maturing or re-fixing within a horizon, per currency.
 *
 * Totalled per currency and never summed across them, for the same reason the
 * cash position refuses to: converting needs a dated, approved rate and there
 * is no rate source in this build.
 *
 * A facility is counted once even when it carries several events inside the
 * horizon. Its balance is exposed once, and adding a re-fix to a term expiry
 * on the same loan would report twice the debt actually at risk.
 *
 * Identity is the facility id, not its reference. References are unique only
 * per lender, and short ones are the norm, so keying on the reference made
 * ASB "001" and BNZ "001" the same facility: whichever event sorted first won
 * and the other balance was silently discarded. That understated the
 * board-facing figure, in the same direction and for the same reason the
 * dedupe exists to prevent overstating it.
 */
export function valueWithin(rows: ExpiryWatchRow[], horizonDays: number): ExpiryTotal[] {
  const seen = new Set<string>();
  const totals = new Map<string, { amount: Decimal; count: number }>();

  for (const row of rows) {
    if (row.daysUntil > horizonDays) continue;
    if (seen.has(row.facilityId)) continue;
    seen.add(row.facilityId);

    const running = totals.get(row.currency) ?? { amount: new Decimal(0), count: 0 };
    totals.set(row.currency, {
      amount: running.amount.plus(new Decimal(row.amount)),
      count: running.count + 1,
    });
  }

  return [...totals.entries()]
    .map(([currency, t]) => ({
      currency,
      amount: t.amount.toFixed(2),
      facilityCount: t.count,
    }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
}

/** The twelve-month figure a board paper leads with. */
export const BOARD_HORIZON_DAYS = SOON_DAYS;

import { NextResponse } from "next/server";
import { computeCashPosition } from "@/lib/cashPosition";
import { requireSession, entityAccessFor } from "@/lib/session";
import { csvResponse, csvFilename } from "@/lib/csv/toCsv";
import { nzDateOnlyNow } from "@/lib/dates";

/**
 * CASH-001..006. The computation lives in lib/cashPosition.ts so that
 * accounting policy stays out of the route layer (REM-001) and later modules
 * can reuse it: they cannot import a route handler.
 *
 * This route is the session check and the serialisation, nothing else. The CSV
 * branch serialises the same computed result rather than querying again, so an
 * export cannot disagree with the screen it was taken from.
 */

export async function GET(request: Request) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;

  const position = computeCashPosition(entityAccessFor(actor));

  if (new URL(request.url).searchParams.get("format") === "csv") {
    return csvResponse(
      csvFilename(["cash-position", nzDateOnlyNow()]),
      [
        "Entity",
        "Entity status",
        "Bank",
        "Account",
        "Currency",
        "Loan facility",
        "Bank balance",
        "Bank balance date",
        "Xero balance",
        "Xero balance date",
        "Variance",
        "Variance %",
        "Exception",
        "Currency mismatch",
        "Stale",
        "Source file checksum",
        "Imported by",
        "Xero sync run",
      ],
      position.accounts.map((a) => [
        a.entityShortCode,
        a.entityStatus,
        a.bankName,
        a.accountName,
        a.currency,
        a.isLoanFacility ? "yes" : "no",
        a.bankBalance,
        a.bankBalanceDate,
        a.xeroBalance,
        a.xeroBalanceDate,
        a.variance?.amount ?? null,
        a.variance?.percent ?? null,
        a.isException ? "yes" : "no",
        a.currencyMismatch ? "yes" : "no",
        a.stale ? "yes" : "no",
        /**
         * The evidence columns travel with the figures. An exported variance
         * that cannot be traced back to the file it came from is a number in a
         * spreadsheet, and the whole point of this screen is that every figure
         * has a source.
         */
        a.evidence.bank?.sourceFileChecksum ?? null,
        a.evidence.bank?.importedByEmail ?? null,
        a.evidence.xero?.syncRunId ?? null,
      ])
    );
  }

  return NextResponse.json(position);
}

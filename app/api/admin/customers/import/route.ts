import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { importCustomers } from "@/lib/customers-store";
import { parseCustomerCsv, parseCustomerSpreadsheet, ParsedImportRow } from "@/lib/customer-import";

const MAX_BYTES = 5 * 1024 * 1024; // 5MB

// Admin-only: bulk-import customers from an uploaded CSV or Excel (.xls/
// .xlsx) file (see components/AdminCustomersManager.tsx's import panel).
// Accepts a header row with Name (required) plus optional Company, Email,
// Phone, Notes columns in any order/casing — see lib/customer-import.ts for
// the exact header matching and lib/customers-store.ts's importCustomers()
// for the create-vs-update-by-email merge logic.
export async function POST(req: NextRequest) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: 'No file uploaded (expected form field "file")' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "File is too large — 5MB max." }, { status: 400 });
  }

  const name = file.name.toLowerCase();
  const isCsv = name.endsWith(".csv") || file.type === "text/csv";
  const isSpreadsheet = name.endsWith(".xlsx") || name.endsWith(".xls") || file.type.includes("spreadsheet") || file.type.includes("excel");

  if (!isCsv && !isSpreadsheet) {
    return NextResponse.json({ error: "Unsupported file type. Upload a .csv, .xls, or .xlsx file." }, { status: 400 });
  }

  const parsed = isCsv
    ? parseCustomerCsv(await file.text())
    : await parseCustomerSpreadsheet(await file.arrayBuffer());

  if (parsed.error) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const goodRows = parsed.rows.filter((r): r is ParsedImportRow & { input: NonNullable<ParsedImportRow["input"]> } => Boolean(r.input));
  const skippedRows = parsed.rows.filter((r) => r.skipReason);

  if (goodRows.length === 0) {
    return NextResponse.json(
      { error: "No importable rows found — every row was missing a name." },
      { status: 400 }
    );
  }

  const { created, updated, persisted } = await importCustomers(goodRows.map((r) => r.input));

  return NextResponse.json({
    ok: true,
    created,
    updated,
    skipped: skippedRows.length,
    skippedRows: skippedRows.slice(0, 20).map((r) => ({ row: r.rowNumber, reason: r.skipReason })),
    totalRows: parsed.rows.length,
    persisted,
  });
}

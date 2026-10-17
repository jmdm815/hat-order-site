import { CustomerInput } from "./customers-store";

// ---------------------------------------------------------------------------
// Customer bulk-import file parsing (CSV / XLS / XLSX)
// ---------------------------------------------------------------------------
// Turns an uploaded spreadsheet into CustomerInput rows, tolerant of the
// header names a real customer list is likely to use (an export from
// another CRM, a spreadsheet someone hand-built, etc.) rather than
// requiring an exact "Name,Company,Email,Phone,Notes" header.
// ---------------------------------------------------------------------------

export type ParsedImportRow = {
  rowNumber: number; // 1-based, counting the header row as row 1
  input?: CustomerInput;
  skipReason?: string;
};

export type ParsedImport = {
  rows: ParsedImportRow[];
  error?: string; // set when the file couldn't be parsed/understood at all
};

const MAX_ROWS = 5000;

const HEADER_ALIASES: Record<keyof CustomerInput, string[]> = {
  name: ["name", "customername", "fullname", "contactname", "customer"],
  company: ["company", "companyname", "business", "businessname", "organization", "org"],
  email: ["email", "emailaddress", "e-mail", "emailaddr"],
  phone: ["phone", "phonenumber", "telephone", "tel", "mobile", "cell", "cellphone"],
  notes: ["notes", "note", "comments", "comment", "description"],
};

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Maps each recognized column index to the CustomerInput field it feeds.
//
// Some customer lists (a business-to-business contact list, say) only have
// a "Company Name" column and nothing separately labeled "Name" — for that
// kind of list, the company name IS the record's name. So when no column
// matches a "name" alias but one matches a "company" alias, that column is
// re-purposed as the name column instead of being dropped as unmatched —
// the row still needs *a* name, and "Company Name" is the closest thing
// this file has to one. A file that has both a real Name column and a
// separate Company column is unaffected, since hasName is already true by
// the time this fallback runs.
function matchHeaders(headerRow: string[]): { columns: Partial<Record<number, keyof CustomerInput>>; hasName: boolean } {
  const columns: Partial<Record<number, keyof CustomerInput>> = {};
  let hasName = false;
  let firstCompanyIndex: number | undefined;
  headerRow.forEach((raw, i) => {
    const normalized = normalizeHeader(raw);
    for (const [field, aliases] of Object.entries(HEADER_ALIASES) as [keyof CustomerInput, string[]][]) {
      if (aliases.includes(normalized)) {
        columns[i] = field;
        if (field === "name") hasName = true;
        if (field === "company" && firstCompanyIndex === undefined) firstCompanyIndex = i;
        break;
      }
    }
  });
  if (!hasName && firstCompanyIndex !== undefined) {
    columns[firstCompanyIndex] = "name";
    hasName = true;
  }
  return { columns, hasName };
}

function rowsToParsedImport(rows: string[][]): ParsedImport {
  // Drop fully-blank rows (trailing blank lines in an export are common).
  const nonBlank = rows.filter((r) => r.some((c) => c.trim() !== ""));
  if (nonBlank.length === 0) {
    return { rows: [], error: "The file is empty." };
  }

  const [headerRow, ...dataRows] = nonBlank;
  const { columns, hasName } = matchHeaders(headerRow);
  if (!hasName) {
    return {
      rows: [],
      error:
        'Couldn\'t find a "Name" column in the first row. Make sure the file has a header row with a column named Name (Company, Email, Phone, and Notes are optional).',
    };
  }

  if (dataRows.length > MAX_ROWS) {
    return {
      rows: [],
      error: `This file has ${dataRows.length} rows — split it into batches of ${MAX_ROWS} or fewer and import separately.`,
    };
  }

  const parsed: ParsedImportRow[] = dataRows.map((cells, i) => {
    const rowNumber = i + 2; // +1 for header, +1 for 1-based
    const values: Partial<Record<keyof CustomerInput, string>> = {};
    for (const [idxStr, field] of Object.entries(columns)) {
      const idx = Number(idxStr);
      const cell = cells[idx];
      if (field !== undefined && cell !== undefined) values[field] = cell.trim();
    }
    const name = values.name?.trim();
    if (!name) {
      return { rowNumber, skipReason: "No name" };
    }
    return {
      rowNumber,
      input: {
        name,
        company: values.company || undefined,
        email: values.email || undefined,
        phone: values.phone || undefined,
        notes: values.notes || undefined,
      },
    };
  });

  return { rows: parsed };
}

// Simple, dependency-free CSV parser (handles quoted fields, embedded
// commas/newlines, and doubled "" escapes) — good enough for the kind of
// CSV any spreadsheet app or CRM export produces.
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const len = text.length;

  while (i < len) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += char;
      i++;
      continue;
    }
    if (char === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (char === ",") {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (char === "\r") {
      i++;
      continue;
    }
    if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i++;
      continue;
    }
    field += char;
    i++;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export function parseCustomerCsv(text: string): ParsedImport {
  return rowsToParsedImport(parseCsv(text));
}

export async function parseCustomerSpreadsheet(buffer: ArrayBuffer): Promise<ParsedImport> {
  // Dynamic import: xlsx is a large parser only needed by this one route,
  // no need to pull it into every serverless function's bundle.
  const XLSX = await import("xlsx");
  let workbook;
  try {
    workbook = XLSX.read(buffer, { type: "array" });
  } catch (err) {
    console.error("customer-import: failed to parse spreadsheet", err);
    return { rows: [], error: "Couldn't read that file as an Excel spreadsheet (.xls/.xlsx)." };
  }
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    return { rows: [], error: "The spreadsheet has no sheets." };
  }
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: "", blankrows: false }) as unknown[][];
  const stringRows = rows.map((r) => r.map((cell) => (cell == null ? "" : String(cell))));
  return rowsToParsedImport(stringRows);
}

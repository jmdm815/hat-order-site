import type { Customer } from "./types";

// ---------------------------------------------------------------------------
// One-time cleanup helper: ShopVox exports put "Person(Company)" in a
// customer's name. Split that into the customer (company) name and the
// primary contact person. Returns null when the record should stay as is.
// ---------------------------------------------------------------------------

// Records whose parentheses aren't "person (company)".
const KEEP_AS_IS = new Set(["aliefisdpublicrelation", "bobspizzashacksample", "riverparkheb563"]);
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export function splitCustomer(c: Customer): { name: string; contactName: string } | null {
  if (c.contactName) return null; // already split
  // Company already in its own field: company becomes the name.
  if (c.company && norm(c.company) !== norm(c.name)) {
    return { name: c.company.trim(), contactName: c.name.trim() };
  }
  const m = c.name.match(/^\s*(.+?)\s*\(\s*(.+?)\s*\)\s*$/);
  if (!m || KEEP_AS_IS.has(norm(c.name))) return null;
  const [, outside, inside] = m;
  // "PGS(Parking Guidance Systems)", "CSR(KENT)": an acronym, not a person.
  if (/^[A-Z0-9&]{2,5}$/.test(outside.trim())) return null;
  return { name: inside.trim(), contactName: outside.trim() };
}

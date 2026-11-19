import { createHash, timingSafeEqual } from "crypto";
import { headers } from "next/headers";

// Partner (white-label) API auth. A partner site calls /api/partner/* from
// its own server with `Authorization: Bearer <key>`, where the key is one of
// the comma-separated values in PARTNER_API_KEYS. These routes are
// read-only pricing/catalog/mockup helpers — they never expose admin data,
// customers, quotes, catalog list prices or the markup table itself.
function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

export async function isPartnerAuthed(): Promise<boolean> {
  const keys = (process.env.PARTNER_API_KEYS ?? "")
    .split(",")
    .map((k) => k.trim())
    .filter((k) => k.length >= 24);
  if (!keys.length) return false;
  const auth = (await headers()).get("authorization");
  if (!auth?.startsWith("Bearer ")) return false;
  const token = auth.slice("Bearer ".length).trim();
  let ok = false;
  for (const k of keys) if (safeEqual(token, k)) ok = true;
  return ok;
}

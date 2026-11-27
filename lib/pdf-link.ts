import { createHmac, timingSafeEqual } from "crypto";

// Short-lived signed links to a quote/invoice PDF, handed out by the JM Admin
// connector's get_quote_pdf tool so Claude can download the PDF and show it
// to Jhairson. The link carries the record id, the PDF mode and an expiry,
// signed with a key derived from AGENT_API_KEY; nothing else is unlocked.

export const PDF_MODES = ["customer", "internal", "work-order", "invoice"] as const;
export type PdfMode = (typeof PDF_MODES)[number];
export const PDF_LINK_TTL_MS = 15 * 60 * 1000;

function key(): string | null {
  const k = process.env.AGENT_API_KEY;
  return k ? `pdf-link:${k}` : null;
}

const payload = (id: string, mode: PdfMode, exp: number) => `${id}|${mode}|${exp}`;

export function signPdfLink(origin: string, id: string, mode: PdfMode): { url: string; expiresAt: string } | null {
  const k = key();
  if (!k) return null;
  const exp = Date.now() + PDF_LINK_TTL_MS;
  const sig = createHmac("sha256", k).update(payload(id, mode, exp)).digest("base64url");
  const url = `${origin}/api/quote-pdf/${encodeURIComponent(id)}?mode=${mode}&exp=${exp}&sig=${sig}`;
  return { url, expiresAt: new Date(exp).toISOString() };
}

export function verifyPdfLink(id: string, mode: string, exp: string, sig: string): mode is PdfMode {
  const k = key();
  if (!k || !(PDF_MODES as readonly string[]).includes(mode)) return false;
  const expMs = Number(exp);
  if (!Number.isFinite(expMs) || expMs < Date.now() || expMs > Date.now() + PDF_LINK_TTL_MS + 60_000) return false;
  const want = createHmac("sha256", k).update(payload(id, mode as PdfMode, expMs)).digest();
  let got: Buffer;
  try {
    got = Buffer.from(sig, "base64url");
  } catch {
    return false;
  }
  return got.length === want.length && timingSafeEqual(got, want);
}

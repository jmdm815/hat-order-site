import sharp from "sharp";
import type { QuoteRecord } from "./quotes-store";
import { getJobFolderMockups } from "./quotes-store";
import { isTrustedBlobUrl } from "./item-photo";

// ---------------------------------------------------------------------------
// Job-folder mock-ups linked to quote/invoice lines, loaded for PDF rendering
// ---------------------------------------------------------------------------
// Returns lineId -> images (smallish JPEG buffers) for every mock-up linked
// to that line. `audience: "customer"` (quote/invoice PDFs the customer sees)
// skips mock-ups with showOnQuote === false; internal copies get them all.
// A failed image fetch just leaves that image off — never fails the PDF.
// ---------------------------------------------------------------------------

export type LineMockupImage = { id: string; buffer: Buffer; location?: string };
export type LineMockups = Record<string, LineMockupImage[]>;

export async function loadLineMockups(record: QuoteRecord, audience: "customer" | "internal"): Promise<LineMockups> {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  const mockups = getJobFolderMockups(record.jobFolder).filter(
    (m) => m.lineIds?.length && (audience === "internal" || m.showOnQuote !== false),
  );
  if (!token || mockups.length === 0) return {};
  const loaded = await Promise.all(
    mockups.map(async (m) => {
      if (!isTrustedBlobUrl(m.blobUrl)) return null;
      try {
        const res = await fetch(m.blobUrl, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
        if (!res.ok) return null;
        const buffer = await sharp(Buffer.from(await res.arrayBuffer()))
          .flatten({ background: "#ffffff" })
          .resize(500, 500, { fit: "inside", withoutEnlargement: true })
          .jpeg({ quality: 82 })
          .toBuffer();
        return { m, buffer };
      } catch (err) {
        console.error("loadLineMockups: fetch failed", err);
        return null;
      }
    }),
  );
  const out: LineMockups = {};
  for (const item of loaded) {
    if (!item) continue;
    for (const lineId of item.m.lineIds ?? []) {
      (out[lineId] ??= []).push({ id: item.m.id, buffer: item.buffer, location: item.m.location });
    }
  }
  return out;
}

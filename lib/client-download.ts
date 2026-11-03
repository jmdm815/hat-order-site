// Shared helper for the "fetch a PDF, open it in a new tab" pattern used
// across the admin (AdminQuoteBuilder.tsx's downloadPdf, AdminSavedQuotesList
// .tsx's downloadPdf, AdminJobFolderModal.tsx's downloadJobFolder) and the
// customer-facing pay page (InvoicePayClient.tsx's downloadPaymentReceipt).
//
// Every one of those routes already sets a good Content-Disposition
// filename server-side (e.g. "INV-0008-maddie-rusling-2026-11-02.pdf" — see
// app/api/admin/quotes/[id]/pdf/route.ts) — but that header is only used by
// the browser on a direct navigation. Once the response is fetched via JS
// and turned into a plain Blob for an object URL, the filename is lost:
// blob: URLs have no name of their own, so when the admin opens the PDF in
// its new tab and saves it (or even just the browser's own "Save As" on a
// blob: URL), the suggested filename falls back to the blob's random UUID
// — which is exactly the confusing "random characters" filename this was
// built to fix. Wrapping the Blob in a File first (File extends Blob, with
// a .name) is what makes the browser's PDF viewer/Save As dialog propose a
// real filename instead.
"use client";

export function filenameFromContentDisposition(headerValue: string | null): string | null {
  if (!headerValue) return null;
  // Matches the plain quoted form (filename="x.pdf") this codebase's own
  // routes always send; the unquoted/UTF-8-extended forms are matched too
  // since they cost nothing and some proxies/CDNs rewrite headers.
  const match = headerValue.match(/filename\*?=(?:UTF-8''|")?([^;"]+)"?/i);
  if (!match) return null;
  const raw = match[1].trim().replace(/"$/, "");
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

// Reads the suggested filename off the response (falling back to the given
// default if the header's missing or unparsable) and returns an object URL
// for a File carrying that name, instead of an anonymous Blob.
export async function responseToNamedObjectUrl(res: Response, fallbackName: string): Promise<string> {
  const blob = await res.blob();
  const filename = filenameFromContentDisposition(res.headers.get("Content-Disposition")) ?? fallbackName;
  const file = new File([blob], filename, { type: blob.type || "application/pdf" });
  return URL.createObjectURL(file);
}

// The connected Vercel Blob store is private, so a raw blob URL 403s for
// anyone without the BLOB_READ_WRITE_TOKEN (i.e. everyone except this
// server). Admin-uploaded item photos (see app/api/admin/item-image) are
// re-served through app/api/item-photo, which fetches from Blob
// server-side with that token and streams the bytes back — this helper
// builds/validates that proxy URL.

const BLOB_HOST_SUFFIX = ".blob.vercel-storage.com";

export function isTrustedBlobUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && u.hostname.endsWith(BLOB_HOST_SUFFIX);
  } catch {
    return false;
  }
}

export function itemPhotoUrl(blobUrl: string): string {
  return `/api/item-photo?url=${encodeURIComponent(blobUrl)}`;
}

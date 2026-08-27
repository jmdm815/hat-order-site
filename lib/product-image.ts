/**
 * SanMar product photos are shot on a white canvas but the product isn't
 * always centered in that canvas, so a plain object-contain crop can leave
 * the garment sitting near one edge with a big block of empty space on the
 * other side. Routing images through /api/product-image trims the excess
 * white border and re-pads the result onto a fresh centered square canvas,
 * so every thumbnail lines up the same way.
 *
 * For shirts, `originalUrl` is a derived "flat"/back photo URL that may not
 * actually exist on SanMar's CDN (see lib/sanmar.ts) — pass the original
 * on-model photo as `fallbackUrl` so the route can retry against it when the
 * derived photo turns out to be missing or a placeholder.
 */
export function productImageUrl(originalUrl: string, fallbackUrl?: string): string {
  if (!originalUrl) return originalUrl;
  const params = new URLSearchParams({ url: originalUrl });
  if (fallbackUrl) params.set("fallback", fallbackUrl);
  return `/api/product-image?${params.toString()}`;
}

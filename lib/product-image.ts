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

/**
 * Every browsing/preview thumbnail (catalog grid, curated homepage cards,
 * the quote tools, the plain color picker in the non-live-designer
 * customize flow, the admin catalog manager) used to call productImageUrl()
 * with the derived flat/no-model photo as primary and the on-model photo as
 * fallback — meaning some items showed a flat lay and others fell back to a
 * person wearing it, inconsistently, purely depending on whether SanMar
 * happens to have shot a flat photo for that particular style/color (many
 * don't). The on-model photo is the one photo SanMar's feed guarantees for
 * every item, so these preview surfaces show it first instead, giving a
 * uniform look across every tile; the derived flat photo is now only a
 * fallback for the rare case there's no model photo either.
 *
 * `imageUrl` is the item's primary photo as stored on Product/ProductColor
 * (the derived flat photo for shirts/polos, or the item's one real photo
 * for hats, which have no flat/model split at all — see lib/sanmar.ts).
 * `modelFallbackUrl` is that item's on-model photo when one exists
 * (ProductColor.imageFallbackUrl / Product.heroImageFallbackUrl); pass
 * whatever the call site already has for that field.
 *
 * This is deliberately NOT used by the interactive design/placement canvas
 * (components/GarmentPreview.tsx) — that always wants the flat/no-model
 * photo so artwork placement isn't obscured by a person's body, and falls
 * back to a generated vector illustration rather than a model photo when
 * SanMar has no flat photo. See that component's own strict-mode fetch.
 */
export function productPreviewImageUrl(imageUrl: string, modelFallbackUrl?: string): string {
  if (!modelFallbackUrl) return productImageUrl(imageUrl);
  return productImageUrl(modelFallbackUrl, imageUrl);
}

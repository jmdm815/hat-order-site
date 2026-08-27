"use client";

import { useEffect, useState } from "react";
import { productImageUrl } from "@/lib/product-image";
import ShirtSilhouette from "./ShirtSilhouette";

export type GarmentPhotoSource = "override" | "photo" | "illustration";

// SanMar's feed does include real flat/no-model photos for a lot of shirt
// styles (derived from the on-model URL — see lib/sanmar.ts's
// toFlatImageUrl) — just not all of them. The shirt design canvas should
// use the real photo whenever one genuinely exists (better fidelity than
// the vector fallback), but must NEVER fall back to showing a person when
// it doesn't — so this requests the flat photo in "strict" mode (see
// app/api/product-image/route.ts) and swaps to the generated
// ShirtSilhouette on a real 404, instead of the old behavior of silently
// retrying the on-model photo.
export default function GarmentPreview({
  url,
  view,
  colorHexes,
  className,
  isOverride,
  onSourceResolved,
}: {
  url?: string;
  view: "front" | "back";
  colorHexes?: string[];
  className?: string;
  // True when `url` is an admin-uploaded custom photo (see
  // lib/types.ts's ItemImageOverride / ProductColor.imageIsOverride) rather
  // than a SanMar-derived one. Custom photos are already pre-processed
  // (trimmed + padded onto a square canvas) at upload time, and the admin
  // explicitly chose them, so render directly rather than routing through
  // the SanMar-photo proxy's strict-mode 404 check.
  isOverride?: boolean;
  // Reports which of the three sources actually ended up on screen — the
  // admin-uploaded photo, a real SanMar photo, or the illustrated fallback.
  // The admin editor uses this to show a plain-language caption ("Showing:
  // real SanMar photo" / "SanMar has no photo — showing the illustration"),
  // since a customer/admin can't otherwise tell those apart just by looking.
  onSourceResolved?: (source: GarmentPhotoSource) => void;
}) {
  // Reset the broken flag when switching to a different photo (new color or
  // view) so it gets a fresh chance rather than staying stuck on silhouette.
  // Adjusting state during render (rather than in a useEffect) per React's
  // recommended pattern for resetting state when a prop changes.
  const [state, setState] = useState<{ url?: string; broken: boolean }>({ url, broken: false });
  if (state.url !== url) {
    setState({ url, broken: false });
  }
  const broken = state.broken;
  const showingPhoto = Boolean(url) && !broken;

  useEffect(() => {
    onSourceResolved?.(!showingPhoto ? "illustration" : isOverride ? "override" : "photo");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showingPhoto, isOverride]);

  if (!showingPhoto) {
    return <ShirtSilhouette view={view} colorHexes={colorHexes} className={className} />;
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={isOverride ? url : `${productImageUrl(url as string)}&strict=1`}
      alt=""
      onError={() => setState({ url, broken: true })}
      className={className}
      draggable={false}
    />
  );
}

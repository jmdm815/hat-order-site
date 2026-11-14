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
  altUrl,
  view,
  colorHexes,
  className,
  isOverride,
  onSourceResolved,
  onDisplayedSrc,
}: {
  url?: string;
  // A second real flat photo to try (e.g. S&S Activewear's photo of the same
  // style/color, see lib/designer-photos.ts) before the illustration.
  altUrl?: string;
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
  onSourceResolved?: (source: GarmentPhotoSource) => void;
  // The exact image URL on screen (null while showing the illustration) —
  // the designer shades artwork against it (lib/fabric-shade.ts).
  onDisplayedSrc?: (src: string | null) => void;
}) {
  // stage 0 = primary photo, 1 = alternate photo, 2 = illustration. Reset
  // when the photo changes (new color or view) — adjusting state during
  // render per React's recommended pattern for resetting on a prop change.
  const sources = [url, altUrl];
  const sig = `${url}|${altUrl}`;
  const [state, setState] = useState<{ sig: string; stage: number }>({ sig, stage: 0 });
  if (state.sig !== sig) setState({ sig, stage: 0 });
  let stage = state.sig === sig ? state.stage : 0;
  while (stage < 2 && !sources[stage]) stage++;

  const src =
    stage === 0
      ? isOverride
        ? (url as string)
        : `${productImageUrl(url as string)}&strict=1`
      : stage === 1
        ? `${productImageUrl(altUrl as string)}&strict=1`
        : null;

  useEffect(() => {
    onSourceResolved?.(src === null ? "illustration" : stage === 0 && isOverride ? "override" : "photo");
    onDisplayedSrc?.(src);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, isOverride]);

  if (src === null) {
    return <ShirtSilhouette view={view} colorHexes={colorHexes} className={className} />;
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      key={src}
      src={src}
      alt=""
      onError={() => setState({ sig, stage: stage + 1 })}
      className={className}
      draggable={false}
    />
  );
}

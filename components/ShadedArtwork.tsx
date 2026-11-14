"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { cleanArtworkUrl, shadeArtwork } from "@/lib/fabric-shade";

// Customer designers: an artwork image that picks up the garment's folds and
// texture (lib/fabric-shade.ts). Shows the plain artwork instantly, then swaps
// in the shaded version a moment after it stops moving. `raised` adds a soft
// shadow for patches and embroidery.
export default function ShadedArtwork({
  artSrc,
  garmentSrc,
  box,
  containerRef,
  insetPx,
  raised,
  className,
  alt = "",
}: {
  artSrc?: string;
  garmentSrc?: string | null;
  box: { x: number; y: number; width: number; height: number };
  containerRef: RefObject<HTMLDivElement | null>;
  insetPx: number;
  raised?: boolean;
  className?: string;
  alt?: string;
}) {
  const [shaded, setShaded] = useState<{ key: string; url: string } | null>(null);
  const lastUrl = useRef<string | null>(null);
  // Same artwork with a plain background cut away (preview only).
  const [clean, setClean] = useState<{ src: string; url: string } | null>(null);
  useEffect(() => {
    if (!artSrc) return;
    let cancelled = false;
    cleanArtworkUrl(artSrc).then((url) => {
      if (!cancelled) setClean({ src: artSrc, url });
    });
    return () => {
      cancelled = true;
    };
  }, [artSrc]);
  const key = `${artSrc}|${garmentSrc}|${box.x.toFixed(2)}|${box.y.toFixed(2)}|${box.width.toFixed(2)}|${box.height.toFixed(2)}`;

  useEffect(() => {
    if (!artSrc || !garmentSrc) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      const el = containerRef.current;
      if (!el) return;
      const url = await shadeArtwork({ artSrc, garmentSrc, box, containerPx: el.clientWidth, insetPx });
      if (cancelled || !url) {
        if (url) URL.revokeObjectURL(url);
        return;
      }
      if (lastUrl.current) URL.revokeObjectURL(lastUrl.current);
      lastUrl.current = url;
      setShaded({ key, url });
    }, 160);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // box values are captured through `key`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, insetPx]);

  useEffect(() => () => {
    if (lastUrl.current) URL.revokeObjectURL(lastUrl.current);
  }, []);

  const plain = clean && clean.src === artSrc ? clean.url : artSrc;
  const src = shaded && shaded.key === key ? shaded.url : plain;
  if (!src) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      draggable={false}
      className={className}
      style={raised ? { filter: "drop-shadow(0.5px 1px 1px rgba(0,0,0,0.35)) drop-shadow(0 0 0.5px rgba(0,0,0,0.25))" } : undefined}
    />
  );
}

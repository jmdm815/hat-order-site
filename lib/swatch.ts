import type { CSSProperties } from "react";
import type { ProductColor } from "./types";

// Color-picker dots. S&S gives real swatch hexes; SanMar doesn't, so for
// single-color SanMar items the dot shows the color sampled from the actual
// product photo (/api/swatch), with the name-based guess underneath while it
// loads. Multi-tone names ("Navy/ White") keep the split dot.
export function swatchStyle(c: Pick<ProductColor, "colorHexes" | "colorHexApprox" | "imageUrl" | "imageFallbackUrl" | "imageIsOverride">): CSSProperties {
  const hexes = c.colorHexes?.length ? c.colorHexes : ["#9a9a9a"];
  if (hexes.length === 2) return { backgroundImage: `linear-gradient(135deg, ${hexes[0]} 50%, ${hexes[1]} 50%)` };
  if (hexes.length > 2) {
    const step = 360 / hexes.length;
    return { backgroundImage: `conic-gradient(${hexes.map((h, i) => `${h} ${i * step}deg ${(i + 1) * step}deg`).join(", ")})` };
  }
  if (c.colorHexApprox && c.imageUrl && !c.imageIsOverride) {
    const q = new URLSearchParams({ url: c.imageUrl });
    if (c.imageFallbackUrl) q.set("fallback", c.imageFallbackUrl);
    return { backgroundColor: hexes[0], backgroundImage: `url(/api/swatch?${q.toString()})`, backgroundSize: "cover" };
  }
  return { backgroundColor: hexes[0] };
}

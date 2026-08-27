// A generic flat-lay garment illustration — deliberately NOT a photo of a
// person wearing the shirt. Used as a fallback in the live design canvas
// when SanMar has no real flat/no-model photo for a given style/color (see
// GarmentPreview.tsx, which tries the real photo first). This is a
// hand-drawn vector tee, tinted to the selected color, styled to read like
// a photographed flat-lay (soft drop shadow, fabric shading) rather than a
// flat cartoon icon.
//
// IMPORTANT: the viewBox is square (0 0 400 400) and the garment fills it
// edge-to-edge (small margin only), matching how a real product photo gets
// object-contain'd into the square preview frame. Print-location zones are
// stored as percent-of-frame (see lib/default-item-config.ts), so the
// garment needs to occupy a large, predictable, consistent portion of the
// frame for those zone boxes to land on the garment rather than floating
// off to one side or overflowing past its edges.
export default function ShirtSilhouette({
  view = "front",
  colorHexes,
  className,
}: {
  view?: "front" | "back";
  colorHexes?: string[];
  className?: string;
}) {
  const fill = colorHexes?.[0] || "#e2e2e2";
  const id = view; // unique-enough for the two instances typically on screen at once

  // Body outline: shoulders near the top, sleeves flaring to the frame's
  // edges, torso running down to a hem near the bottom. Torso spans
  // x:100–300 (25%–75%) so it lines up with the default zone's x:25/width:50.
  const body =
    "M130,15 L170,20 C185,35 215,35 230,20 L270,15 L370,90 L345,130 L300,105 L300,380 L100,380 L100,105 L55,130 L30,90 Z";

  return (
    <svg
      viewBox="0 0 400 400"
      className={className}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={`Flat ${view} view of the shirt`}
      // A CSS drop-shadow (not an SVG <filter> feDropShadow — support for
      // that varies enough across renderers to show up as a visible hard
      // rectangular halo in some of them) for a soft "resting on a table"
      // look, matching a photographed flat-lay rather than a flat icon.
      style={{ filter: "drop-shadow(0 6px 8px rgba(0,0,0,0.16))" }}
    >
      <defs>
        <linearGradient id={`shade-${id}`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#000000" stopOpacity="0.10" />
          <stop offset="18%" stopColor="#000000" stopOpacity="0" />
          <stop offset="82%" stopColor="#000000" stopOpacity="0" />
          <stop offset="100%" stopColor="#000000" stopOpacity="0.12" />
        </linearGradient>
        <linearGradient id={`sheen-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.10" />
          <stop offset="35%" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
      </defs>

      <path d={body} fill={fill} stroke="rgba(0,0,0,0.18)" strokeWidth="2" strokeLinejoin="round" />
      {/* fabric shading: darker toward the sleeve edges, a soft highlight up top */}
      <path d={body} fill={`url(#shade-${id})`} />
      <path d={body} fill={`url(#sheen-${id})`} />
      {view === "front" ? (
        <path d="M170,20 C185,35 215,35 230,20" fill="none" stroke="rgba(0,0,0,0.28)" strokeWidth="2.5" />
      ) : (
        <path d="M176,20 C185,30 215,30 224,20" fill="none" stroke="rgba(0,0,0,0.14)" strokeWidth="2" />
      )}
      {/* shoulder seams */}
      <path d="M130,15 L170,20 M230,20 L270,15" fill="none" stroke="rgba(0,0,0,0.12)" strokeWidth="1.5" />
      {/* side seams */}
      <path d="M300,105 L300,380 M100,105 L100,380" fill="none" stroke="rgba(0,0,0,0.08)" strokeWidth="1.5" />
    </svg>
  );
}

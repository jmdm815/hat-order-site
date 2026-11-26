// A round "patch" badge: text set on a circle around a needle-and-thread
// mark, with a running-stitch border. The ring of text turns slowly.
export default function StitchBadge() {
  return (
    <div className="badge" aria-hidden="true">
      <svg viewBox="0 0 200 200" width="100%" height="100%">
        <defs>
          <path id="ring" d="M100,100 m-68,0 a68,68 0 1,1 136,0 a68,68 0 1,1 -136,0" />
        </defs>
        <circle cx="100" cy="100" r="97" fill="#d42a32" />
        <circle cx="100" cy="100" r="88" fill="none" stroke="#fff" strokeWidth="2.5" strokeDasharray="7 6" />
        <g className="badge-ring">
          <text fontSize="17" fontWeight="800" fill="#fff" style={{ fontStretch: "75%" }}>
            <textPath href="#ring" textLength="421" lengthAdjust="spacing">EMBROIDERY ✚ PRINTING ✚ ROSENBERG, TX ✚</textPath>
          </text>
        </g>
        <circle cx="100" cy="100" r="44" fill="#1d2b4f" />
        {/* needle */}
        <g transform="rotate(-40 100 100)">
          <rect x="97.5" y="64" width="5" height="62" rx="2.5" fill="#fff" />
          <path d="M97.5 126 L100 140 L102.5 126 Z" fill="#fff" />
          <rect x="99" y="69" width="2" height="9" rx="1" fill="#1d2b4f" />
        </g>
        {/* thread */}
        <path d="M108 79 C 132 84, 128 110, 104 112 S 72 124, 86 138" fill="none" stroke="#ff6b70" strokeWidth="3" strokeLinecap="round" strokeDasharray="5 5" />
      </svg>
    </div>
  );
}

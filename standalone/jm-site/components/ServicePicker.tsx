"use client";

import { useState } from "react";

type Service = {
  name: string;
  text: string;
  for: readonly string[];
  link?: { href: string; label: string };
  img?: { src: string; alt: string; pos?: string };
  caption: string;
};

function TumblerArt() {
  return (
    <svg viewBox="0 0 400 300" width="100%" height="100%" role="img" aria-label="Illustration of a navy tumbler printed with a logo">
      <rect width="400" height="300" fill="#1d2b4f" />
      <g opacity=".14" stroke="#fff" strokeWidth="2" strokeDasharray="8 7" fill="none">
        <circle cx="200" cy="150" r="120" />
        <circle cx="200" cy="150" r="160" />
      </g>
      {/* straw */}
      <rect x="214" y="22" width="9" height="70" rx="4" transform="rotate(12 218 57)" fill="#ff6b70" />
      {/* lid */}
      <rect x="148" y="58" width="104" height="22" rx="8" fill="#e8ebf1" />
      <rect x="152" y="76" width="96" height="8" rx="3" fill="#c6ccd8" />
      {/* body */}
      <path d="M154 84 H246 L234 262 Q233 272 222 272 H178 Q167 272 166 262 Z" fill="#eceef2" />
      <path d="M154 84 H170 L180 272 H178 Q167 272 166 262 Z" fill="#fff" opacity=".7" />
      <path d="M232 84 H246 L234 262 Q233 272 222 272 H222 Z" fill="#c6ccd8" opacity=".8" />
      {/* printed logo */}
      <g transform="translate(200 168)">
        <rect x="-28" y="-28" width="56" height="56" rx="6" transform="rotate(45)" fill="#d42a32" />
        <rect x="-22" y="-22" width="44" height="44" rx="4" transform="rotate(45)" fill="none" stroke="#fff" strokeWidth="2" strokeDasharray="4 3" />
        <text x="0" y="7" textAnchor="middle" fontSize="22" fontWeight="800" fill="#fff" style={{ fontStretch: "75%" }}>
          LOGO
        </text>
      </g>
      <g fill="#fff">
        <path d="M300 92 l4 10 10 4 -10 4 -4 10 -4 -10 -10 -4 10 -4z" opacity=".85" />
        <path d="M96 190 l3 7 7 3 -7 3 -3 7 -3 -7 -7 -3 7 -3z" opacity=".6" />
      </g>
    </svg>
  );
}

export default function ServicePicker({ services }: { services: readonly Service[] }) {
  const [active, setActive] = useState(0);
  return (
    <div className="svc-layout">
      <ul className="svc-list">
        {services.map((s, n) => (
          <li
            className={n === active ? "svc on" : "svc"}
            key={s.name}
            onMouseEnter={() => setActive(n)}
            onFocus={() => setActive(n)}
            onClick={() => setActive(n)}
          >
            <h3>
              <button type="button" className="svc-btn" aria-pressed={n === active}>
                {s.name}
              </button>
            </h3>
            {s.link ? (
              <a className="more" href={s.link.href}>
                {s.link.label}
              </a>
            ) : (
              <span />
            )}
            <p>{s.text}</p>
            <div className="for">
              {s.for.map((f) => (
                <span key={f}>{f}</span>
              ))}
            </div>
          </li>
        ))}
      </ul>
      <div className="svc-side" aria-live="polite">
        <figure>
          <div className="svc-stage">
            {services.map((s, n) => (
              <div className={n === active ? "svc-frame on" : "svc-frame"} key={s.name} aria-hidden={n !== active}>
                {s.img ? (
                  <img src={s.img.src} alt={n === active ? s.img.alt : ""} style={{ objectPosition: s.img.pos }} loading="lazy" />
                ) : (
                  <TumblerArt />
                )}
              </div>
            ))}
          </div>
          <figcaption key={active}>{services[active].caption}</figcaption>
        </figure>
      </div>
    </div>
  );
}

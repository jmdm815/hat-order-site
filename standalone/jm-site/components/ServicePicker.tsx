"use client";

import { useState } from "react";

type Service = {
  name: string;
  text: string;
  for: readonly string[];
  link?: { href: string; label: string };
  img: { src: string; alt: string; pos?: string };
  caption: string;
};

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
                <img src={s.img.src} alt={n === active ? s.img.alt : ""} style={{ objectPosition: s.img.pos }} loading="lazy" />
              </div>
            ))}
          </div>
          <figcaption key={active}>{services[active].caption}</figcaption>
        </figure>
      </div>
    </div>
  );
}

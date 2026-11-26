"use client";

import { useEffect, useRef, useState } from "react";
import StitchBadge from "./StitchBadge";

const SLIDES = [
  { src: "/img/crew-back.webp", alt: "Crew member in a hi-vis shirt and cap with an embroidered company logo", caption: "Embroidered caps and printed hi-vis tees", pos: "50% 30%" },
  { src: "/img/doorstep-polo.webp", alt: "Service technician in an embroidered polo at a customer's door", caption: "Embroidered polos for service techs", pos: "62% 35%" },
  { src: "/img/showroom-polo.webp", alt: "Salesperson in a navy embroidered polo in a showroom", caption: "Staff polos for storefronts and sales teams", pos: "50% 30%" },
  { src: "/img/coach-jacket.webp", alt: "Coach in an embroidered team jacket and cap", caption: "Team jackets and caps", pos: "50% 25%" },
  { src: "/img/roofer-tee.webp", alt: "Roofer wearing a printed company long-sleeve shirt", caption: "Crew shirts for roofing companies", pos: "50% 35%" },
];

const DURATION = 5200;

export default function HeroSlider() {
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const [reduced, setReduced] = useState(false);
  const touchX = useRef<number | null>(null);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const set = () => setReduced(mq.matches);
    set();
    mq.addEventListener("change", set);
    return () => mq.removeEventListener("change", set);
  }, []);

  useEffect(() => {
    if (paused || reduced) return;
    const t = window.setTimeout(() => setI((n) => (n + 1) % SLIDES.length), DURATION);
    return () => window.clearTimeout(t);
  }, [i, paused, reduced]);

  const go = (n: number) => setI((n + SLIDES.length) % SLIDES.length);

  return (
    <div
      className="hero-photo"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      onTouchStart={(e) => (touchX.current = e.touches[0].clientX)}
      onTouchEnd={(e) => {
        if (touchX.current == null) return;
        const dx = e.changedTouches[0].clientX - touchX.current;
        if (Math.abs(dx) > 40) go(i + (dx < 0 ? 1 : -1));
        touchX.current = null;
      }}
      aria-roledescription="carousel"
      aria-label="Examples of our work"
    >
      <div className="main">
        {SLIDES.map((s, n) => (
          <img
            key={s.src}
            src={s.src}
            alt={n === i ? s.alt : ""}
            aria-hidden={n !== i}
            className={n === i ? "slide on" : "slide"}
            style={{ objectPosition: s.pos }}
            loading={n === 0 ? "eager" : "lazy"}
            fetchPriority={n === 0 ? "high" : "auto"}
          />
        ))}
      </div>
      <StitchBadge />
      <div className="slide-ui">
        <p className="tag" key={i} aria-live="polite">
          {SLIDES[i].caption}
        </p>
        <div className="dots" role="tablist" aria-label="Choose a photo">
          {SLIDES.map((s, n) => (
            <button
              key={s.src}
              role="tab"
              aria-selected={n === i}
              aria-label={s.caption}
              className={n === i ? "dot on" : "dot"}
              onClick={() => go(n)}
            >
              <span style={{ animationDuration: `${DURATION}ms`, animationPlayState: paused ? "paused" : "running" }} />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

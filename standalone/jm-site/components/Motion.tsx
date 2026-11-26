"use client";

import { useEffect } from "react";

// Page-wide motion helpers: marks the page as JS-enabled (so reveal styles
// only apply when they can be undone), reveals [data-reveal] blocks once as
// they scroll into view, and tightens the header after the first scroll.
export default function Motion() {
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add("js");

    const els = Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]"));
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add("in");
            io.unobserve(e.target);
          }
        }
      },
      { rootMargin: "0px 0px -12% 0px", threshold: 0.12 }
    );
    els.forEach((el) => io.observe(el));

    const header = document.querySelector(".top");
    const onScroll = () => header?.classList.toggle("scrolled", window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      io.disconnect();
      window.removeEventListener("scroll", onScroll);
    };
  }, []);
  return null;
}

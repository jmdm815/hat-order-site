"use client";

import { useState } from "react";

const LINKS = [
  ["#services", "Services"],
  ["#who", "Who we work with"],
  ["#process", "How it works"],
  ["#catalogs", "Catalogs"],
  ["#visit", "Visit"],
] as const;

export default function Header() {
  const [open, setOpen] = useState(false);
  return (
    <header className="top">
      <div className="wrap">
        <a className="brand" href="#top" aria-label="JM Digital Media home">
          <img src="/img/jm-logo.png" alt="" width={46} height={46} />
          <span>JM Digital Media</span>
        </a>
        <nav className={open ? "nav open" : "nav"} aria-label="Main">
          {LINKS.map(([href, label]) => (
            <a key={href} href={href} onClick={() => setOpen(false)}>
              {label}
            </a>
          ))}
        </nav>
        <a className="btn btn-red" href="#quote">
          Get a quote
        </a>
        <button
          className="menu-btn"
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
          </svg>
        </button>
      </div>
    </header>
  );
}

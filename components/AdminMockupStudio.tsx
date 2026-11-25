"use client";

import { useEffect, useRef } from "react";
import { mockupsTab } from "@/standalone/render-studio/src/mockups";
import { webPlatform } from "@/lib/mockup-web-platform";
import "./rs-mockups.css";

// Admin Garment Mockups tab: the same Mockups tool as the JM Render Studio
// Mac app (standalone/render-studio/src/mockups.ts), running on the website
// platform (server-side AI drawings, downloads instead of a folder).
export default function AdminMockupStudio() {
  const host = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = host.current;
    if (!el || el.childElementCount) return;
    if (!document.getElementById("rs-fonts")) {
      const link = document.createElement("link");
      link.id = "rs-fonts";
      link.rel = "stylesheet";
      link.href = "https://fonts.googleapis.com/css2?family=Anton&family=Inter:wght@400;600;700;800;900&display=swap";
      document.head.append(link);
    }
    el.append(mockupsTab(webPlatform));
  }, []);
  return <div ref={host} className="rs-app" />;
}

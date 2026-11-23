"use client";

import { useEffect, useState } from "react";
import { SHOPIFY_STORE } from "@/lib/gang-sheet";

type Status = {
  id: string; number: string; mode: "build" | "upload"; lengthIn: number; quantity: number; price: number;
  status: "rendering" | "ready" | "failed"; error?: string; designs: number; createdAt: string;
};

// Linked from the Shopify cart/order ("Print file"): shows the sheet preview
// and the 300 dpi print PNG download once it's rendered.
export default function GangSheetStatus({ id }: { id: string }) {
  const [s, setS] = useState<Status | null>(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      const res = await fetch(`/api/gang-sheet/${id}`, { cache: "no-store" });
      if (res.status === 404) { setMissing(true); return; }
      const data = (await res.json()) as Status;
      if (stop) return;
      setS(data);
      if (data.status === "rendering") timer = setTimeout(load, 4000);
    };
    load();
    return () => { stop = true; clearTimeout(timer); };
  }, [id]);

  return (
    <div className="min-h-screen bg-[#eef1f6] text-admin-ink">
      <header className="bg-[#1c2338] text-white">
        <div className="mx-auto max-w-3xl px-4 sm:px-6 py-4">
          <a href={SHOPIFY_STORE} className="text-xs uppercase tracking-[0.18em] text-white/60 hover:text-white">JM Digital Media</a>
          <h1 className="text-xl font-extrabold">DTF Gang Sheet {s ? s.number : ""}</h1>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 sm:px-6 py-6">
        {missing ? (
          <p className="text-center text-admin-ink/60 py-16">We couldn&apos;t find this gang sheet.</p>
        ) : !s ? (
          <p className="text-center text-admin-ink/60 py-16">Loading…</p>
        ) : (
          <div className="rounded-2xl border border-admin-ink/10 bg-white p-5 shadow-sm">
            <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
              <div><dt className="text-admin-ink/60">Size</dt><dd className="font-semibold">24 × {s.lengthIn} in</dd></div>
              <div><dt className="text-admin-ink/60">Copies</dt><dd className="font-semibold">{s.quantity}</dd></div>
              <div><dt className="text-admin-ink/60">Type</dt><dd className="font-semibold">{s.mode === "build" ? `Built · ${s.designs} designs` : "Uploaded sheet"}</dd></div>
              <div><dt className="text-admin-ink/60">Created</dt><dd className="font-semibold">{new Date(s.createdAt).toLocaleDateString()}</dd></div>
            </dl>
            <div className="mt-5">
              {s.status === "rendering" && <p className="rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-800">Preparing your 300 dpi print file… this page updates on its own.</p>}
              {s.status === "failed" && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">We couldn&apos;t build the print file ({s.error}). We&apos;ll take care of it — no need to re-order.</p>}
              {s.status === "ready" && (
                <>
                  <div className="gs-checker rounded-lg border border-admin-ink/10 p-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/gang-sheet/${s.id}/file?kind=preview`} alt={`Preview of ${s.number}`} className="mx-auto block max-h-[70vh] w-auto" />
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <a href={`/api/gang-sheet/${s.id}/file?kind=png&download=1`} className="gs-btn-primary">Download print file (PNG, 300 dpi)</a>
                    <a href={`/api/gang-sheet/${s.id}/file?kind=png`} target="_blank" rel="noreferrer" className="gs-btn">Open full size</a>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";

type ApiResponse = { logoUrl: string; isCustom: boolean; persistent: boolean };

// Site branding — lets an admin replace the customer-facing logo (homepage
// hero + the order-flow header) without a code change. See
// lib/pricing-store.ts's BrandSettings doc comment: the shipped default is a
// tiny 48x48 placeholder that looks blurry once displayed at real size.
export default function AdminLogoManager() {
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [isCustom, setIsCustom] = useState(false);
  const [persistent, setPersistent] = useState(true);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [reverting, setReverting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function load() {
    setLoading(true);
    fetch("/api/admin/logo")
      .then((r) => r.json())
      .then((data: ApiResponse) => {
        setLogoUrl(data.logoUrl);
        setIsCustom(data.isCustom);
        setPersistent(data.persistent);
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, []);

  async function handleFileChosen(file: File) {
    setUploading(true);
    setError(null);
    setMessage(null);
    try {
      const body = new FormData();
      body.set("file", file);
      const res = await fetch("/api/admin/logo", { method: "POST", body });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Upload failed");
      setLogoUrl(data.logoUrl);
      setIsCustom(true);
      setMessage(data.persisted ? "Logo updated." : "Logo updated for now, but changes will reset on redeploy.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleRevert() {
    if (!confirm("Revert to the default logo?")) return;
    setReverting(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/logo", { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to revert");
      setLogoUrl(data.logoUrl);
      setIsCustom(false);
      setMessage("Reverted to the default logo.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setReverting(false);
    }
  }

  if (loading) return <p className="text-navy/40 text-sm">Loading…</p>;

  return (
    <div className="bg-white border border-navy/10 rounded-xl p-4 max-w-xl">
      <h3 className="text-sm font-semibold text-navy">Site logo</h3>
      <p className="mt-1 text-xs text-navy/50">
        Shown on the homepage hero and the order-flow header. The built-in default is a tiny
        48×48 placeholder, which is why it looks blurry on the live site — upload a proper
        high-resolution logo (square, at least 512×512, PNG/SVG with a transparent background
        works best) to fix that.
      </p>

      {!persistent && (
        <p className="mt-3 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          No durable storage is connected to this deployment yet, so an uploaded logo won&apos;t
          survive a redeploy. Connect a Vercel Blob store to make this stick.
        </p>
      )}

      <div className="mt-4 flex items-center gap-4">
        <div className="w-20 h-20 rounded-lg border border-navy/10 bg-gray/30 flex items-center justify-center overflow-hidden shrink-0">
          {logoUrl && (
            // Admin preview of an arbitrary uploaded-image URL; next/image
            // would need the Blob host registered in next.config, and this
            // is a small fixed-size preview.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt="Current logo" className="max-w-full max-h-full object-contain" />
          )}
        </div>
        <div className="flex flex-col gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/svg+xml"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFileChosen(file);
            }}
            disabled={uploading}
            className="text-xs text-navy/70"
          />
          {isCustom && (
            <button
              onClick={handleRevert}
              disabled={reverting || uploading}
              className="self-start text-xs text-navy/60 px-2 py-1 rounded-lg border border-navy/20 hover:bg-navy/5 disabled:opacity-50"
            >
              {reverting ? "Reverting…" : "Revert to default"}
            </button>
          )}
        </div>
      </div>

      {uploading && <p className="mt-2 text-xs text-navy/50">Uploading…</p>}
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      {message && !error && <p className="mt-2 text-sm text-navy/60">{message}</p>}
    </div>
  );
}

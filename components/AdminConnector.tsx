"use client";

import { useEffect, useState } from "react";

type Info = { active: boolean; hint?: string; createdAt?: string; agentKeyConfigured?: boolean };

export default function AdminConnector() {
  const [info, setInfo] = useState<Info | null>(null);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch("/api/admin/connector")
      .then((r) => r.json())
      .then(setInfo)
      .catch(() => setError("Couldn't load the connector status."));
  }, []);

  async function create() {
    if (info?.active && !confirm("Make a new link? The current link stops working right away.")) return;
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/admin/connector", { method: "POST" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Couldn't make the link.");
      setUrl(j.url);
      setInfo((cur) => ({ ...cur, ...j }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't make the link.");
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    if (!confirm("Turn off the connector? Claude loses admin access until you make a new link.")) return;
    setBusy(true);
    await fetch("/api/admin/connector", { method: "DELETE" }).catch(() => {});
    setUrl("");
    setInfo((cur) => ({ ...cur, active: false }));
    setBusy(false);
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* the user can select the text instead */
    }
  }

  return (
    <div className="space-y-4 max-w-2xl">
      <section className="rounded-2xl bg-admin-card border border-admin-ink/10 p-5 shadow-sm space-y-3">
        <h2 className="font-semibold text-admin-ink">Status</h2>
        {!info ? (
          <p className="text-sm text-admin-ink/60">Loading…</p>
        ) : info.active ? (
          <p className="text-sm text-admin-ink">
            On. Link ending in <span className="font-mono">…{info.hint}</span>
            {info.createdAt ? `, made ${new Date(info.createdAt).toLocaleDateString()}` : ""}.
          </p>
        ) : (
          <p className="text-sm text-admin-ink">Off. Claude can&apos;t reach the admin.</p>
        )}
        {info && info.agentKeyConfigured === false && (
          <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
            AGENT_API_KEY isn&apos;t set on this Vercel project. Set it before making a link.
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <button
            onClick={create}
            disabled={busy}
            className="px-4 py-2 rounded-lg text-sm font-semibold bg-admin-accent text-admin-accent-ink disabled:opacity-60"
          >
            {info?.active ? "Make a new link" : "Make connector link"}
          </button>
          {info?.active && (
            <button
              onClick={turnOff}
              disabled={busy}
              className="px-4 py-2 rounded-lg text-sm font-semibold border border-admin-ink/20 text-admin-ink disabled:opacity-60"
            >
              Turn off
            </button>
          )}
        </div>
        {error && <p className="text-sm text-red-700">{error}</p>}
      </section>

      {url && (
        <section className="rounded-2xl bg-admin-card border-2 border-admin-accent p-5 shadow-sm space-y-3">
          <h2 className="font-semibold text-admin-ink">Your connector link</h2>
          <p className="text-sm text-admin-ink/80">
            This is shown only once. Anyone with it can use your admin, so paste it only into Claude.
          </p>
          <textarea
            readOnly
            value={url}
            rows={3}
            onFocus={(e) => e.currentTarget.select()}
            className="w-full font-mono text-xs rounded-lg border border-admin-ink/20 bg-admin-bg p-3 text-admin-ink"
          />
          <button onClick={copy} className="px-4 py-2 rounded-lg text-sm font-semibold bg-admin-accent text-admin-accent-ink">
            {copied ? "Copied" : "Copy link"}
          </button>
        </section>
      )}

      <section className="rounded-2xl bg-admin-card border border-admin-ink/10 p-5 shadow-sm space-y-2 text-sm text-admin-ink">
        <h2 className="font-semibold">Add it to Claude</h2>
        <ol className="list-decimal pl-5 space-y-1">
          <li>Tap <b>Make connector link</b>, then <b>Copy link</b>.</li>
          <li>In Claude, open <b>Settings → Connectors</b> and choose <b>Add custom connector</b>.</li>
          <li>Name it <b>JM Admin</b>, paste the link as the URL, and save.</li>
        </ol>
        <p className="text-admin-ink/70">
          Claude can then look up customers and products, price quotes with your pricing, save quotes and invoices, and
          email them. It asks you before emailing anyone.
        </p>
      </section>
    </div>
  );
}

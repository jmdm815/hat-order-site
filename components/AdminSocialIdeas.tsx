"use client";

import { useEffect, useState } from "react";
import type { IdeaBatch, PostIdea } from "@/lib/social-ideas";

// Social Studio "Ideas": research current custom-apparel / branding trends
// and suggest post ideas, each with a one-click "Generate post from idea".

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export default function AdminSocialIdeas({
  onGenerate,
  busyTitle,
}: {
  onGenerate: (idea: PostIdea) => void;
  busyTitle: string | null;
}) {
  const [batch, setBatch] = useState<IdeaBatch | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSources, setShowSources] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/admin/social/ideas")
      .then((r) => r.json())
      .then((j) => alive && j.batch && setBatch(j.batch))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  async function findIdeas() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/social/ideas", { method: "POST" });
      const j = await res.json().catch(() => ({ error: `Request failed (${res.status})` }));
      if (!res.ok) throw new Error(j.error || "Couldn't get ideas");
      setBatch(j.batch);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="border border-admin-ink/15 rounded-xl p-4 bg-admin-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-heading font-semibold uppercase tracking-wide">Trends & ideas</h2>
          <p className="text-sm text-admin-ink/65 mt-0.5">
            Searches the web for what&apos;s trending in custom apparel and branding, then suggests posts for JM Media.
          </p>
        </div>
        <button
          onClick={findIdeas}
          disabled={loading}
          className="px-4 py-2 rounded-xl bg-admin-accent text-admin-accent-ink font-semibold text-sm disabled:opacity-50"
        >
          {loading ? "Researching… (about a minute)" : batch ? "Find new ideas" : "Find trends & ideas"}
        </button>
      </div>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      {batch && (
        <div className="mt-4 space-y-3">
          <div className="rounded-lg bg-admin-ink/[0.04] p-3 text-sm">
            <p className="text-xs text-admin-ink/55 mb-1">
              {batch.live ? "Based on a live web search" : "Live search unavailable — seasonal ideas"} · {fmt(batch.createdAt)}
            </p>
            <p className="text-admin-ink/85">{batch.trends}</p>
            {batch.sources.length > 0 && (
              <div className="mt-2">
                <button onClick={() => setShowSources((v) => !v)} className="text-xs underline text-admin-ink/65">
                  {showSources ? "Hide sources" : `Sources (${batch.sources.length})`}
                </button>
                {showSources && (
                  <ul className="mt-1 space-y-0.5">
                    {batch.sources.map((s) => (
                      <li key={s.url} className="text-xs truncate">
                        <a href={s.url} target="_blank" rel="noreferrer" className="underline text-sky-700">
                          {s.title}
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            {batch.ideas.map((idea) => (
              <div key={idea.title} className="border border-admin-ink/12 rounded-xl p-3 flex flex-col">
                <p className="font-semibold">{idea.title}</p>
                <p className="text-sm text-admin-ink/80 mt-1">{idea.angle}</p>
                <p className="text-xs text-admin-ink/60 mt-1.5">
                  <span className="font-semibold">Why now:</span> {idea.why}
                </p>
                <div className="flex flex-wrap gap-1 mt-2">
                  {[idea.contentType.split(" (")[0], idea.industry, idea.decoration, idea.garment].filter(Boolean).map((t) => (
                    <span key={t} className="text-[11px] px-1.5 py-0.5 rounded bg-sky-50 text-sky-800 border border-sky-100">
                      {t}
                    </span>
                  ))}
                </div>
                <button
                  onClick={() => onGenerate(idea)}
                  disabled={Boolean(busyTitle)}
                  className="mt-3 self-start px-3 py-1.5 rounded-lg text-sm font-semibold border border-admin-accent text-admin-accent hover:bg-admin-accent hover:text-admin-accent-ink disabled:opacity-50"
                >
                  {busyTitle === idea.title ? "Writing…" : "Generate post from idea"}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

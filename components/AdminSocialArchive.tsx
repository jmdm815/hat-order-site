"use client";

import { useEffect, useMemo, useState } from "react";
import type { SocialPost } from "@/lib/social-archive-store";

// Social Studio archive: every post the tool has written, newest first, with
// its captions and images. Mark posts as posted, reopen one in the editor,
// or delete it. Also shows the recent mix of topics so it's easy to vary.

function CopyBtn({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {}
      }}
      className="text-xs px-2 py-0.5 rounded-md border border-admin-ink/20 text-admin-ink/80 hover:text-admin-ink"
    >
      {done ? "Copied ✓" : "Copy"}
    </button>
  );
}

const fmt = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

export default function AdminSocialArchive({
  refreshKey,
  onOpen,
}: {
  refreshKey: number;
  onOpen: (post: SocialPost) => void;
}) {
  const [posts, setPosts] = useState<SocialPost[] | null>(null);
  const [filter, setFilter] = useState<"all" | "draft" | "posted">("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [now] = useState(() => Date.now());

  useEffect(() => {
    let alive = true;
    fetch("/api/admin/social/posts", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => alive && setPosts(j.posts ?? []))
      .catch(() => alive && setPosts([]));
    return () => {
      alive = false;
    };
  }, [refreshKey, reload]);

  const mix = useMemo(() => {
    if (!posts) return [];
    const since = now - 30 * 86400000;
    const counts = new Map<string, number>();
    for (const p of posts) {
      if (new Date(p.createdAt).getTime() < since) continue;
      for (const k of [p.request.contentType, p.request.industry].filter(Boolean) as string[]) {
        counts.set(k, (counts.get(k) ?? 0) + 1);
      }
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [posts, now]);

  async function setStatus(p: SocialPost, status: "posted" | "draft") {
    setBusy(p.id);
    await fetch(`/api/admin/social/posts/${p.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    }).catch(() => {});
    setPosts((cur) => cur?.map((x) => (x.id === p.id ? { ...x, status } : x)) ?? null);
    setBusy(null);
  }

  async function remove(p: SocialPost) {
    if (!window.confirm("Delete this post and its images from the archive?")) return;
    setBusy(p.id);
    await fetch(`/api/admin/social/posts/${p.id}`, { method: "DELETE" }).catch(() => {});
    setPosts((cur) => cur?.filter((x) => x.id !== p.id) ?? null);
    setBusy(null);
  }

  const shown = (posts ?? []).filter((p) => filter === "all" || p.status === filter);

  return (
    <section className="border border-admin-ink/15 rounded-xl p-4 bg-admin-card">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <h2 className="font-heading font-semibold uppercase tracking-wide">
          Archive {posts ? `(${posts.length})` : ""}
        </h2>
        <div className="flex items-center gap-2">
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as typeof filter)}
            className="border border-admin-ink/20 rounded-lg px-2 py-1 text-sm bg-transparent"
          >
            <option value="all">All</option>
            <option value="draft">Not posted yet</option>
            <option value="posted">Posted</option>
          </select>
          <button onClick={() => setReload((n) => n + 1)} className="text-sm px-2 py-1 rounded-lg border border-admin-ink/20">
            Refresh
          </button>
        </div>
      </div>
      {mix.length > 0 && (
        <p className="text-xs text-admin-ink/65 mb-3">
          Last 30 days: {mix.map(([k, n]) => `${k} ×${n}`).join(" · ")}. New posts are written to avoid repeating recent
          openings, hashtags and image ideas.
        </p>
      )}
      {posts === null ? (
        <p className="text-sm text-admin-ink/60">Loading…</p>
      ) : shown.length === 0 ? (
        <p className="text-sm text-admin-ink/60">
          {posts.length ? "Nothing here with this filter." : "Posts you write are saved here automatically."}
        </p>
      ) : (
        <ul className="divide-y divide-admin-ink/10">
          {shown.map((p) => {
            const open = expanded === p.id;
            const latest = p.images[p.images.length - 1];
            return (
              <li key={p.id} className="py-3">
                <div className="flex gap-3">
                  {latest ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`/api/admin/social/posts/${p.id}/image?img=${latest.id}`}
                      alt=""
                      className="w-16 h-16 rounded-lg object-cover shrink-0 bg-admin-ink/5"
                      loading="lazy"
                    />
                  ) : (
                    <div className="w-16 h-16 rounded-lg shrink-0 bg-admin-ink/5 grid place-items-center text-[10px] text-admin-ink/45">
                      No image
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`text-[11px] font-semibold px-1.5 py-0.5 rounded ${
                          p.status === "posted" ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"
                        }`}
                      >
                        {p.status === "posted" ? "Posted" : "Not posted"}
                      </span>
                      <span className="text-xs text-admin-ink/60">{fmt(p.createdAt)}</span>
                      <span className="text-xs text-admin-ink/60">
                        {[p.request.contentType, p.request.industry, p.request.garment].filter(Boolean).join(" · ")}
                      </span>
                    </div>
                    <p className="text-sm mt-1 line-clamp-2">{p.result.posts[0]?.caption}</p>
                    <div className="flex flex-wrap gap-2 mt-2 text-xs">
                      <button onClick={() => setExpanded(open ? null : p.id)} className="px-2 py-1 rounded-md border border-admin-ink/20">
                        {open ? "Hide" : "Show captions"}
                      </button>
                      <button onClick={() => onOpen(p)} className="px-2 py-1 rounded-md border border-admin-ink/20">
                        Open in editor
                      </button>
                      <button
                        onClick={() => setStatus(p, p.status === "posted" ? "draft" : "posted")}
                        disabled={busy === p.id}
                        className="px-2 py-1 rounded-md border border-admin-ink/20"
                      >
                        {p.status === "posted" ? "Mark not posted" : "Mark posted"}
                      </button>
                      <button onClick={() => remove(p)} disabled={busy === p.id} className="px-2 py-1 rounded-md text-red-600 hover:bg-red-50">
                        Delete
                      </button>
                    </div>
                    {open && (
                      <div className="mt-3 space-y-3">
                        {p.result.posts.map((x) => {
                          const full = `${x.caption}${x.hashtags.length ? `\n\n${x.hashtags.join(" ")}` : ""}`;
                          return (
                            <div key={x.platform} className="border border-admin-ink/10 rounded-lg p-2.5">
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-[11px] font-semibold uppercase tracking-wide text-admin-ink/60">{x.platform}</span>
                                <CopyBtn text={full} />
                              </div>
                              <p className="text-sm whitespace-pre-wrap">{x.caption}</p>
                              {x.hashtags.length > 0 && <p className="text-xs text-admin-ink/55 mt-1">{x.hashtags.join(" ")}</p>}
                            </div>
                          );
                        })}
                        {p.images.length > 0 && (
                          <div className="flex flex-wrap gap-2">
                            {p.images.map((img) => (
                              <a
                                key={img.id}
                                href={`/api/admin/social/posts/${p.id}/image?img=${img.id}`}
                                download={`jm-social-${p.createdAt.slice(0, 10)}-${img.id}.jpg`}
                                title="Download"
                              >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={`/api/admin/social/posts/${p.id}/image?img=${img.id}`}
                                  alt=""
                                  className="w-28 h-28 rounded-lg object-cover"
                                  loading="lazy"
                                />
                              </a>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

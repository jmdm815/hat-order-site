"use client";

import { useEffect, useState } from "react";
import type { ShopTask } from "@/lib/shop-tasks-store";

// Built-in task list. Email-watcher tasks show the sender, a link to the
// Gmail thread and the draft quote (if one was started).
export default function ShopTasksPanel() {
  const [tasks, setTasks] = useState<ShopTask[]>([]);
  const [showDone, setShowDone] = useState(false);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let alive = true;
    fetch(`/api/admin/shop-tasks?status=${showDone ? "all" : "open"}&t=${reload}`)
      .then((r) => r.json())
      .then((d: { tasks?: ShopTask[]; error?: string }) => {
        if (!alive) return;
        if (d.error) setError(d.error);
        else setTasks(d.tasks ?? []);
      })
      .catch(() => alive && setError("Couldn't load tasks."))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [showDone, reload]);

  async function add() {
    if (!title.trim()) return;
    setBusy("new");
    const res = await fetch("/api/admin/shop-tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, due: due || undefined }),
    });
    setBusy(null);
    if (res.ok) {
      setTitle("");
      setDue("");
      setReload((n) => n + 1);
    } else setError("Couldn't add the task.");
  }

  async function toggle(t: ShopTask) {
    setBusy(t.id);
    const res = await fetch(`/api/admin/shop-tasks/${t.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: t.status === "open" ? "done" : "open" }),
    });
    setBusy(null);
    if (res.ok) {
      const { task } = await res.json();
      setTasks((ts) => (showDone ? ts.map((x) => (x.id === t.id ? task : x)) : ts.filter((x) => x.id !== t.id)));
    }
  }

  async function remove(t: ShopTask) {
    if (!window.confirm(`Delete "${t.title}"?`)) return;
    setBusy(t.id);
    await fetch(`/api/admin/shop-tasks/${t.id}`, { method: "DELETE" });
    setBusy(null);
    setTasks((ts) => ts.filter((x) => x.id !== t.id));
  }

  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  const open = tasks.filter((t) => t.status === "open");

  return (
    <div className="bg-admin-card border border-admin-ink/10 rounded-2xl p-4 sm:p-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-bold text-admin-ink">
            Shop tasks {open.length > 0 && <span className="ml-1 text-sm font-semibold text-admin-accent">({open.length} open)</span>}
          </h2>
          <p className="text-xs text-admin-ink/62">Includes emails the inbox watcher flagged, with any draft quote it started.</p>
        </div>
        <label className="text-sm text-admin-ink/80 flex items-center gap-2">
          <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> Show completed
        </label>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="Add a task…"
          className="flex-1 min-w-[12rem] rounded-lg border border-admin-ink/20 px-3 py-2 text-base bg-white"
        />
        <input type="date" value={due} onChange={(e) => setDue(e.target.value)} className="rounded-lg border border-admin-ink/20 px-3 py-2 bg-white" />
        <button onClick={add} disabled={busy === "new" || !title.trim()} className="px-4 py-2 rounded-lg bg-admin-accent text-admin-accent-ink font-semibold disabled:opacity-50">
          Add
        </button>
      </div>
      {error && <p className="mt-3 text-sm text-red-700">{error}</p>}

      <ul className="mt-4 divide-y divide-admin-ink/10">
        {loading && <li className="py-3 text-sm text-admin-ink/62">Loading…</li>}
        {!loading && tasks.length === 0 && <li className="py-3 text-sm text-admin-ink/62">Nothing open. 🎉</li>}
        {tasks.map((t) => {
          const overdue = t.status === "open" && t.due && t.due < today;
          return (
            <li key={t.id} className={`py-3 flex gap-3 ${t.status === "done" ? "opacity-50" : ""}`}>
              <input type="checkbox" className="mt-1 w-5 h-5 shrink-0" checked={t.status === "done"} disabled={busy === t.id} onChange={() => toggle(t)} aria-label="Done" />
              <div className="min-w-0 flex-1">
                <p className={`font-medium text-admin-ink ${t.status === "done" ? "line-through" : ""}`}>
                  {t.priority === "high" && <span className="mr-1.5 text-xs font-bold text-red-700 uppercase">Urgent</span>}
                  {t.title}
                </p>
                <p className="text-xs text-admin-ink/62 mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
                  {t.source === "email" && t.from && <span>✉️ {t.from}{t.account ? ` → ${t.account}` : ""}</span>}
                  {t.due && <span className={overdue ? "text-red-700 font-semibold" : ""}>Due {t.due}{overdue ? " (overdue)" : ""}</span>}
                  <span>Added {new Date(t.createdAt).toLocaleString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
                </p>
                {t.notes && <p className="text-sm text-admin-ink/80 mt-1 whitespace-pre-line">{t.notes}</p>}
                <div className="mt-1.5 flex flex-wrap gap-3 text-sm">
                  {t.emailUrl && <a href={t.emailUrl} target="_blank" rel="noreferrer" className="underline text-admin-ink">Open email</a>}
                  {t.quoteId && <a href={`/admin/quotes/${encodeURIComponent(t.quoteId)}`} className="underline text-admin-ink">Open draft quote</a>}
                  {t.draftReply && <span className="text-admin-ink/62">Draft reply waiting in Gmail</span>}
                  <button onClick={() => remove(t)} className="text-admin-ink/50 hover:text-red-700">Delete</button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

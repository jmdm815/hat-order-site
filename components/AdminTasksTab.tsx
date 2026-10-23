"use client";

import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { GoogleTask, GoogleTaskList } from "@/lib/google-tasks";

type StatusResponse = {
  configured: boolean;
  connected: boolean;
  connectedEmail?: string;
  lists: GoogleTaskList[];
  error?: string;
};

// Admin "Tasks" tab — a live view of the connected Google account's Google
// Tasks lists (add, check off, delete), via the OAuth integration in
// lib/google-tasks.ts / lib/google-tasks-store.ts. One shared connection
// for the whole site (not per-admin-user) — see that store's header
// comment. Before anything's connected, this is just a "Connect Google
// account" button; Google's own consent screen handles the actual sign-in.
export default function AdminTasksTab() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedListId, setSelectedListId] = useState<string>("");
  const [tasks, setTasks] = useState<GoogleTask[]>([]);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connectBanner, setConnectBanner] = useState<string | null>(null);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [adding, setAdding] = useState(false);
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
  const [showCompleted, setShowCompleted] = useState(false);

  // Surface the callback redirect's ?connected=1 / ?error= once, then strip
  // it from the URL so a refresh doesn't re-show it.
  useEffect(() => {
    const connected = searchParams.get("connected");
    const err = searchParams.get("error");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (connected) setConnectBanner("Connected to Google Tasks.");
    if (err) setError(err);
    if (connected || err) {
      const params = new URLSearchParams(searchParams.toString());
      params.delete("connected");
      params.delete("error");
      router.replace(`/admin?${params.toString()}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function loadStatus() {
    setLoading(true);
    fetch("/api/admin/google-tasks")
      .then((r) => r.json())
      .then((data: StatusResponse) => {
        setStatus(data);
        if (data.lists.length > 0) setSelectedListId((prev) => prev || data.lists[0].id);
      })
      .catch(() => setError("Failed to load Google Tasks status."))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadStatus();
  }, []);

  function loadTasks(listId: string) {
    if (!listId) return;
    setTasksLoading(true);
    fetch(`/api/admin/google-tasks/tasks?list=${encodeURIComponent(listId)}`)
      .then((r) => r.json())
      .then((data: { tasks?: GoogleTask[]; error?: string }) => {
        if (data.error) {
          setError(data.error);
          return;
        }
        setTasks(data.tasks ?? []);
      })
      .catch(() => setError("Failed to load tasks."))
      .finally(() => setTasksLoading(false));
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (selectedListId) loadTasks(selectedListId);
  }, [selectedListId]);

  async function addTask() {
    const title = newTaskTitle.trim();
    if (!title || !selectedListId) return;
    setAdding(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/google-tasks/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listId: selectedListId, title }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to add task");
      setTasks((prev) => [data.task, ...prev]);
      setNewTaskTitle("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setAdding(false);
    }
  }

  async function toggleTask(task: GoogleTask) {
    const nextStatus = task.status === "completed" ? "needsAction" : "completed";
    setBusyTaskId(task.id);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/google-tasks/tasks/${encodeURIComponent(task.id)}?list=${encodeURIComponent(selectedListId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: nextStatus }),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to update task");
      setTasks((prev) => prev.map((t) => (t.id === task.id ? data.task : t)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusyTaskId(null);
    }
  }

  async function removeTask(task: GoogleTask) {
    setBusyTaskId(task.id);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/google-tasks/tasks/${encodeURIComponent(task.id)}?list=${encodeURIComponent(selectedListId)}`,
        { method: "DELETE" }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to delete task");
      setTasks((prev) => prev.filter((t) => t.id !== task.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusyTaskId(null);
    }
  }

  async function disconnect() {
    if (!confirm("Disconnect this Google account from Tasks?")) return;
    try {
      await fetch("/api/admin/google-tasks", { method: "DELETE" });
      loadStatus();
      setTasks([]);
    } catch {
      setError("Failed to disconnect.");
    }
  }

  if (loading) {
    return <p className="text-white/40 text-sm">Loading…</p>;
  }

  if (!status?.configured) {
    return (
      <div className="bg-black border border-white/10 rounded-2xl p-6">
        <h2 className="text-lg font-bold text-white">Tasks</h2>
        <p className="mt-2 text-sm text-white/60">
          Google Tasks isn&apos;t set up on this deployment yet — GOOGLE_TASKS_CLIENT_ID and
          GOOGLE_TASKS_CLIENT_SECRET need to be configured first.
        </p>
      </div>
    );
  }

  if (!status.connected) {
    return (
      <div className="bg-black border border-white/10 rounded-2xl p-6">
        <h2 className="text-lg font-bold text-white">Tasks</h2>
        <p className="mt-2 text-sm text-white/60">
          Connect your Google account to see and manage your real Google Tasks right here.
        </p>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        <a
          href="/api/admin/google-tasks/auth"
          className="mt-4 inline-block text-sm px-4 py-2 rounded-xl bg-red text-navy font-semibold hover:bg-red/90"
        >
          Connect Google account
        </a>
      </div>
    );
  }

  const incomplete = tasks.filter((t) => t.status !== "completed");
  const completed = tasks.filter((t) => t.status === "completed");

  return (
    <div>
      <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
        <div>
          <h2 className="text-lg font-bold text-white">Tasks</h2>
          <p className="text-xs text-white/50">
            {status.connectedEmail ? `Connected as ${status.connectedEmail}` : "Connected"}
          </p>
        </div>
        <button
          onClick={disconnect}
          className="text-xs px-3 py-1.5 rounded-xl border border-white/20 text-white/60 hover:bg-white/5"
        >
          Disconnect
        </button>
      </div>

      {connectBanner && <p className="mb-3 text-sm text-green-700">{connectBanner}</p>}
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      {status.lists.length > 1 && (
        <label className="block text-xs text-white/60 mb-3 max-w-xs">
          List
          <select
            value={selectedListId}
            onChange={(e) => setSelectedListId(e.target.value)}
            className="mt-1 w-full border border-white/20 rounded-xl px-2 py-1.5 text-sm bg-black text-white"
          >
            {status.lists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.title}
              </option>
            ))}
          </select>
        </label>
      )}

      {status.lists.length === 0 ? (
        <p className="text-sm text-white/40">No task lists found on this Google account.</p>
      ) : (
        <div className="bg-black border border-white/10 rounded-2xl p-4 max-w-xl">
          <div className="flex items-center gap-2">
            <input
              value={newTaskTitle}
              onChange={(e) => setNewTaskTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addTask();
                }
              }}
              placeholder="Add a task…"
              className="flex-1 bg-black border border-white/20 rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-red focus:ring-2 focus:ring-red/20"
            />
            <button
              onClick={addTask}
              disabled={adding || !newTaskTitle.trim()}
              className="shrink-0 text-sm px-4 py-2 rounded-xl bg-red text-navy font-semibold hover:bg-red/90 disabled:opacity-40"
            >
              {adding ? "Adding…" : "Add"}
            </button>
          </div>

          {tasksLoading ? (
            <p className="mt-4 text-sm text-white/40">Loading tasks…</p>
          ) : (
            <>
              <div className="mt-4 space-y-1.5">
                {incomplete.length === 0 ? (
                  <p className="text-sm text-white/40">Nothing on your list right now.</p>
                ) : (
                  incomplete.map((t) => (
                    <div key={t.id} className="flex items-start gap-2 px-1 py-1.5 rounded-lg hover:bg-white/5">
                      <input
                        type="checkbox"
                        checked={false}
                        onChange={() => toggleTask(t)}
                        disabled={busyTaskId === t.id}
                        className="mt-0.5 shrink-0"
                      />
                      <span className="text-sm text-white flex-1 min-w-0">{t.title}</span>
                      <button
                        onClick={() => removeTask(t)}
                        disabled={busyTaskId === t.id}
                        className="text-xs text-red-600 hover:underline shrink-0 disabled:text-white/20"
                      >
                        Delete
                      </button>
                    </div>
                  ))
                )}
              </div>

              {completed.length > 0 && (
                <div className="mt-4 pt-3 border-t border-white/10">
                  <button
                    onClick={() => setShowCompleted((v) => !v)}
                    className="text-xs text-white/40 hover:text-white/60"
                  >
                    {showCompleted ? "Hide" : "Show"} completed ({completed.length})
                  </button>
                  {showCompleted && (
                    <div className="mt-2 space-y-1.5">
                      {completed.map((t) => (
                        <div key={t.id} className="flex items-start gap-2 px-1 py-1.5 rounded-lg hover:bg-white/5">
                          <input
                            type="checkbox"
                            checked
                            onChange={() => toggleTask(t)}
                            disabled={busyTaskId === t.id}
                            className="mt-0.5 shrink-0"
                          />
                          <span className="text-sm text-white/40 line-through flex-1 min-w-0">{t.title}</span>
                          <button
                            onClick={() => removeTask(t)}
                            disabled={busyTaskId === t.id}
                            className="text-xs text-red-600 hover:underline shrink-0 disabled:text-white/20"
                          >
                            Delete
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

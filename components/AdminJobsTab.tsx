"use client";

import { useEffect, useState } from "react";
import { Job, JobStatus } from "@/lib/jobs-store";

const STATUS_LABEL: Record<JobStatus, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  done: "Done",
};

const STATUS_CLASS: Record<JobStatus, string> = {
  not_started: "bg-admin-ink/10 text-admin-ink/88",
  in_progress: "bg-amber-100 text-amber-800",
  done: "bg-green-100 text-green-800",
};

// No-decoration jobs (a garment-only line, no embroidery/print/etc. applied)
// get their own column rather than being dropped, so nothing sent to
// production silently disappears — but it always sorts last since it's not
// really a "station".
const NO_DECORATION_KEY = "__none__";
const NO_DECORATION_LABEL = "No Decoration";

function stationKey(job: Job): string {
  return job.decorationLabel?.trim() || NO_DECORATION_KEY;
}

function jobTitle(job: Job): string {
  if (job.customerSupplied) return job.itemDescription || "Customer-supplied item";
  return [job.brandName, job.productName].filter(Boolean).join(" ") || "Item";
}

// Production jobs board (lib/jobs-store.ts) — one card per line item sent
// to production from a saved quote/invoice (AdminSavedQuotesList.tsx's
// "Send to Jobs" button), grouped into a column per station (the line's
// decoration type) so the admin can see everything queued for Embroidery,
// Digital Print, etc. at a glance, and move each job through
// Not Started -> In Progress -> Done.
export default function AdminJobsTab() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [persistent, setPersistent] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notesDraft, setNotesDraft] = useState<Record<string, string>>({});
  const [hideDone, setHideDone] = useState(false);

  function load() {
    fetch("/api/admin/jobs")
      .then((r) => r.json())
      .then((data: { jobs: Job[]; persistent: boolean }) => {
        setJobs(data.jobs ?? []);
        setPersistent(data.persistent);
      })
      .catch(() => setError("Failed to load jobs."))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
  }, []);

  async function setStatus(id: string, status: JobStatus) {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/jobs/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to update job");
      setJobs((prev) => prev.map((j) => (j.id === id ? data.job : j)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusyId(null);
    }
  }

  async function saveNotes(id: string) {
    const notes = notesDraft[id];
    if (notes === undefined) return;
    try {
      const res = await fetch(`/api/admin/jobs/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes }),
      });
      const data = await res.json();
      if (res.ok) setJobs((prev) => prev.map((j) => (j.id === id ? data.job : j)));
    } catch {
      // Best-effort — notes aren't critical path; leave the draft as typed.
    }
  }

  async function removeJob(id: string) {
    if (!confirm("Remove this job from the board? This doesn't affect the quote it came from.")) return;
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/jobs/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to remove job");
      setJobs((prev) => prev.filter((j) => j.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusyId(null);
    }
  }

  if (loading) {
    return <p className="text-admin-ink/62 text-sm">Loading…</p>;
  }

  const visibleJobs = hideDone ? jobs.filter((j) => j.status !== "done") : jobs;
  const stations = new Map<string, Job[]>();
  for (const job of visibleJobs) {
    const key = stationKey(job);
    if (!stations.has(key)) stations.set(key, []);
    stations.get(key)!.push(job);
  }
  const stationKeys = Array.from(stations.keys()).sort((a, b) => {
    if (a === NO_DECORATION_KEY) return 1;
    if (b === NO_DECORATION_KEY) return -1;
    return a.localeCompare(b);
  });

  return (
    <div>
      <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
        <div>
          <h2 className="text-lg font-bold text-admin-ink">Jobs</h2>
          <p className="text-xs text-admin-ink/72">
            Line items sent to production from saved quotes/invoices, grouped by station. Use the
            &quot;Send to Jobs&quot; button on a quote in the Quotes tab to add items here.
          </p>
        </div>
        <label className="flex items-center gap-1.5 text-xs text-admin-ink/80">
          <input type="checkbox" checked={hideDone} onChange={(e) => setHideDone(e.target.checked)} />
          Hide done
        </label>
      </div>

      {!persistent && (
        <p className="mb-4 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
          No durable storage is connected to this deployment yet, so jobs only last until the next cold
          start or redeploy.
        </p>
      )}
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      {jobs.length === 0 ? (
        <p className="text-sm text-admin-ink/62">
          No jobs yet — open a saved quote or invoice in the Quotes tab and hit &quot;Send to Jobs.&quot;
        </p>
      ) : stationKeys.length === 0 ? (
        <p className="text-sm text-admin-ink/62">Nothing to show — everything&apos;s marked done.</p>
      ) : (
        <div className="flex gap-4 overflow-x-auto pb-2">
          {stationKeys.map((key) => {
            const stationJobs = stations.get(key)!;
            const label = key === NO_DECORATION_KEY ? NO_DECORATION_LABEL : key;
            const notStarted = stationJobs.filter((j) => j.status === "not_started").length;
            const inProgress = stationJobs.filter((j) => j.status === "in_progress").length;
            return (
              <div key={key} className="w-80 shrink-0">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold text-admin-ink">{label}</h3>
                  <span className="text-xs text-admin-ink/62">
                    {stationJobs.length} · {notStarted} new
                    {inProgress ? `, ${inProgress} in progress` : ""}
                  </span>
                </div>
                <div className="space-y-2">
                  {stationJobs.map((job) => {
                    const isBusy = busyId === job.id;
                    return (
                      <div
                        key={job.id}
                        className="bg-admin-card border border-admin-ink/10 rounded-2xl p-3 shadow-lg shadow-black/30"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-xs font-medium text-admin-ink/62">{job.jobNumber}</p>
                            <p className="text-sm font-medium text-admin-ink truncate">{jobTitle(job)}</p>
                            {!job.customerSupplied && job.colorName && (
                              <p className="text-xs text-admin-ink/72">{job.colorName}</p>
                            )}
                          </div>
                          <span
                            className={`shrink-0 px-2 py-0.5 rounded-full text-[11px] font-medium ${STATUS_CLASS[job.status]}`}
                          >
                            {STATUS_LABEL[job.status]}
                          </span>
                        </div>

                        <p className="mt-1.5 text-xs text-admin-ink/80">
                          {job.customerCompany || job.customerName || "(no customer name)"} ·{" "}
                          {job.quantity} total
                        </p>
                        {job.sizes.length > 0 && (
                          <p className="mt-1 text-xs text-admin-ink/62">
                            {job.sizes.map((s) => `${s.name} × ${s.quantity}`).join(", ")}
                          </p>
                        )}
                        <p className="mt-1 text-[11px] text-admin-ink/50">
                          From {job.invoiceNumber ? `Invoice ${job.invoiceNumber}` : job.quoteNumber ? `Quote ${job.quoteNumber}` : "a saved quote"}
                        </p>

                        <textarea
                          value={notesDraft[job.id] ?? job.notes ?? ""}
                          onChange={(e) => setNotesDraft((prev) => ({ ...prev, [job.id]: e.target.value }))}
                          onBlur={() => saveNotes(job.id)}
                          placeholder="Notes for production…"
                          rows={1}
                          className="mt-2 w-full bg-admin-ink/5 border border-admin-ink/10 rounded-lg px-2 py-1 text-xs text-admin-ink outline-none focus:border-admin-accent resize-none"
                        />

                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          {job.status === "not_started" && (
                            <button
                              onClick={() => setStatus(job.id, "in_progress")}
                              disabled={isBusy}
                              className="text-xs px-2.5 py-1 rounded-xl bg-admin-bg text-admin-ink hover:bg-admin-bg/90 disabled:opacity-40"
                            >
                              Start
                            </button>
                          )}
                          {job.status === "in_progress" && (
                            <>
                              <button
                                onClick={() => setStatus(job.id, "done")}
                                disabled={isBusy}
                                className="text-xs px-2.5 py-1 rounded-xl bg-admin-accent text-admin-accent-ink hover:bg-admin-accent/90 disabled:opacity-40"
                              >
                                Mark done
                              </button>
                              <button
                                onClick={() => setStatus(job.id, "not_started")}
                                disabled={isBusy}
                                className="text-xs px-2.5 py-1 rounded-xl border border-admin-ink/20 text-admin-ink/80 hover:bg-admin-ink/5 disabled:opacity-40"
                              >
                                Reset
                              </button>
                            </>
                          )}
                          {job.status === "done" && (
                            <button
                              onClick={() => setStatus(job.id, "in_progress")}
                              disabled={isBusy}
                              className="text-xs px-2.5 py-1 rounded-xl border border-admin-ink/20 text-admin-ink/80 hover:bg-admin-ink/5 disabled:opacity-40"
                            >
                              Reopen
                            </button>
                          )}
                          <button
                            onClick={() => removeJob(job.id)}
                            disabled={isBusy}
                            className="text-xs px-2 py-1 text-red-600 hover:underline disabled:text-admin-ink/35 ml-auto"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

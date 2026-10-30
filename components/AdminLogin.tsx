"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function AdminLogin() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Login failed");
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="max-w-sm border border-admin-ink/10 shadow-lg shadow-black/30 rounded-2xl bg-admin-card p-6"
    >
      <label className="block">
        <span className="text-sm font-medium text-admin-ink">Admin password</span>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
          className="mt-1 w-full border border-admin-ink/20 rounded-xl px-3 py-2 text-sm"
        />
      </label>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={submitting || !password}
        className="mt-4 w-full py-2.5 rounded-full bg-admin-bg text-admin-ink font-semibold hover:bg-admin-accent hover:text-admin-accent-ink transition disabled:bg-admin-bg/20"
      >
        {submitting ? "Checking…" : "Log in"}
      </button>
    </form>
  );
}

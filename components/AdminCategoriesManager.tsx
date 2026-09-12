"use client";

import { useEffect, useState } from "react";
import { Category } from "@/lib/types";

type ApiResponse = { categories: Category[]; persistent: boolean };

export default function AdminCategoriesManager() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [persistent, setPersistent] = useState(true);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [error, setError] = useState<string | null>(null);

  function load() {
    setLoading(true);
    fetch("/api/admin/categories")
      .then((r) => r.json())
      .then((data: ApiResponse) => {
        setCategories(data.categories);
        setPersistent(data.persistent);
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, []);

  async function handleAdd() {
    const name = newName.trim();
    if (!name) return;
    setAdding(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to add category");
      setCategories((prev) => [...prev, data.category]);
      setNewName("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setAdding(false);
    }
  }

  async function handleRename(id: string) {
    const name = editingName.trim();
    if (!name) return;
    const res = await fetch("/api/admin/categories", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, name }),
    });
    const data = await res.json();
    if (res.ok) {
      setCategories((prev) => prev.map((c) => (c.id === id ? data.category : c)));
    }
    setEditingId(null);
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this category? Items assigned to it will just no longer show under it.")) return;
    const res = await fetch(`/api/admin/categories?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (res.ok) setCategories((prev) => prev.filter((c) => c.id !== id));
  }

  async function handleReorder(id: string, direction: "up" | "down") {
    const index = categories.findIndex((c) => c.id === id);
    const swapWith = direction === "up" ? index - 1 : index + 1;
    if (swapWith < 0 || swapWith >= categories.length) return;
    const next = [...categories];
    [next[index], next[swapWith]] = [next[swapWith], next[index]];
    setCategories(next);
    await fetch("/api/admin/categories", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order: next.map((c) => c.id) }),
    });
  }

  if (loading) return <p className="text-navy/40 text-sm">Loading categories…</p>;

  return (
    <div>
      {!persistent && (
        <p className="mb-4 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          No durable storage is connected to this deployment yet, so category changes only last
          until the next cold start or redeploy. Connect a Vercel Blob store to make changes stick.
        </p>
      )}

      <div className="flex items-center gap-2 max-w-md">
        <input
          type="text"
          placeholder="New category name, e.g. Hats"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          className="flex-1 border border-navy/20 rounded-lg px-3 py-2 text-sm"
        />
        <button
          onClick={handleAdd}
          disabled={adding || !newName.trim()}
          className="px-4 py-2 rounded-full bg-red text-white text-sm font-semibold hover:bg-navy transition disabled:bg-navy/20"
        >
          {adding ? "Adding…" : "+ Add"}
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

      {categories.length === 0 ? (
        <p className="mt-6 text-sm text-navy/50">
          No categories yet. Add one above, then assign products to it from the Catalog tab
          (&quot;Configure decorations&quot; on any item).
        </p>
      ) : (
        <div className="mt-6 divide-y divide-navy/10 border border-navy/10 rounded-xl max-w-md overflow-hidden">
          {categories.map((c, i) => (
            <div key={c.id} className="flex items-center gap-2 p-3 bg-white">
              <div className="flex flex-col gap-0.5">
                <button
                  onClick={() => handleReorder(c.id, "up")}
                  disabled={i === 0}
                  className="text-navy/40 hover:text-navy disabled:opacity-20 text-xs leading-none"
                  aria-label="Move up"
                >
                  ▲
                </button>
                <button
                  onClick={() => handleReorder(c.id, "down")}
                  disabled={i === categories.length - 1}
                  className="text-navy/40 hover:text-navy disabled:opacity-20 text-xs leading-none"
                  aria-label="Move down"
                >
                  ▼
                </button>
              </div>
              {editingId === c.id ? (
                <input
                  type="text"
                  value={editingName}
                  onChange={(e) => setEditingName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleRename(c.id)}
                  onBlur={() => handleRename(c.id)}
                  autoFocus
                  className="flex-1 border border-navy/20 rounded-lg px-2 py-1.5 text-sm"
                />
              ) : (
                <span
                  className="flex-1 text-sm font-medium text-navy cursor-pointer"
                  onClick={() => {
                    setEditingId(c.id);
                    setEditingName(c.name);
                  }}
                >
                  {c.name}
                </span>
              )}
              <button
                onClick={() => handleDelete(c.id)}
                className="text-xs text-red-600 px-2 py-1 hover:bg-red-50 rounded"
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  DecorationMethodSettings,
  MockupSettings,
  PatchMaterial,
  PatchShape,
  PatchShapeGeometry,
  PatchSize,
  PatchTextureType,
} from "@/lib/mockup-types";
import type { MockupConfig } from "@/lib/mockup-store";

// ---------------------------------------------------------------------------
// Admin CRUD UI for the Custom Hat Mockup Generator's catalog data (phase 1):
// patch materials, patch shapes, patch sizes, and the two settings
// singletons. Visual style mirrors AdminDecorationTypesManager.tsx
// (expand-to-edit cards, "+ Add new", a draft-object-plus-apply-patch-helper
// pattern, inline validation, a Save button per card, Delete with a plain
// confirm()).
//
// NOTE: Hat calibration (MockupHatCalibration) is deliberately NOT part of
// this component. It will be added to the per-hat "Configure decorations"
// flow in a later phase, since that's where admins already go per-style to
// set up an item (see AdminCatalogManager.tsx / the item config editor).
// ---------------------------------------------------------------------------

const SUB_TABS = [
  { id: "materials", label: "Patch Materials" },
  { id: "shapes", label: "Patch Shapes" },
  { id: "sizes", label: "Patch Sizes" },
  { id: "methods", label: "Method Settings" },
  { id: "mockup", label: "Mockup Settings" },
] as const;
type SubTab = (typeof SUB_TABS)[number]["id"];

const TEXTURE_TYPES: PatchTextureType[] = ["leatherette", "smooth", "canvas", "none"];
const SHAPE_GEOMETRIES: PatchShapeGeometry[] = [
  "rectangle",
  "roundedRectangle",
  "square",
  "roundedSquare",
  "circle",
  "oval",
  "hexagon",
  "shield",
];

function NotPersistentBanner() {
  return (
    <p className="mb-4 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
      No durable storage is connected to this deployment yet, so changes only
      last until the next cold start or redeploy. Connect a Vercel Blob store
      to this project (Vercel dashboard → Storage → Create Database → Blob →
      Connect to Project) to make changes stick.
    </p>
  );
}

// ---------------------------------------------------------------------------
// Small visual previews
// ---------------------------------------------------------------------------

function ColorSwatch({ hex, title }: { hex: string; title?: string }) {
  return (
    <span
      title={title ?? hex}
      className="inline-block w-5 h-5 rounded border border-navy/20 align-middle"
      style={{ backgroundColor: /^#/.test(hex) ? hex : "#ffffff" }}
    />
  );
}

function ShapeThumbnail({ geometry, cornerRadiusPct }: { geometry: PatchShapeGeometry; cornerRadiusPct?: number }) {
  const r = cornerRadiusPct ?? 0;
  let inner: React.ReactNode;
  switch (geometry) {
    case "rectangle":
      inner = <rect x="10" y="25" width="80" height="50" rx="0" />;
      break;
    case "roundedRectangle":
      inner = <rect x="10" y="25" width="80" height="50" rx={Math.min(25, r)} />;
      break;
    case "square":
      inner = <rect x="20" y="20" width="60" height="60" rx="0" />;
      break;
    case "roundedSquare":
      inner = <rect x="20" y="20" width="60" height="60" rx={Math.min(30, r)} />;
      break;
    case "circle":
      inner = <circle cx="50" cy="50" r="35" />;
      break;
    case "oval":
      inner = <ellipse cx="50" cy="50" rx="42" ry="28" />;
      break;
    case "hexagon":
      inner = <polygon points="30,15 70,15 90,50 70,85 30,85 10,50" />;
      break;
    case "shield":
      inner = <path d="M50 12 L85 25 L85 52 C85 72 70 85 50 90 C30 85 15 72 15 52 L15 25 Z" />;
      break;
    default:
      inner = <rect x="10" y="25" width="80" height="50" />;
  }
  return (
    <svg viewBox="0 0 100 100" className="w-8 h-8 shrink-0" aria-hidden>
      <g fill="none" stroke="currentColor" strokeWidth={4} className="text-navy/60">
        {inner}
      </g>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Generic card list shell (used by materials/shapes/sizes panels)
// ---------------------------------------------------------------------------

function AddNewCard({
  label,
  creating,
  onStart,
  onCancel,
  onSubmit,
  disabled,
  children,
}: {
  label: string;
  creating: boolean;
  onStart: () => void;
  onCancel: () => void;
  onSubmit: () => void;
  disabled: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-6 border border-dashed border-navy/20 rounded-xl">
      {!creating ? (
        <button
          onClick={onStart}
          className="w-full p-4 text-sm font-medium text-navy/70 hover:bg-navy/5 rounded-xl"
        >
          + Add {label}
        </button>
      ) : (
        <div className="p-4">
          <h3 className="font-semibold text-navy">New {label}</h3>
          {children}
          <div className="mt-4 flex items-center gap-3">
            <button
              onClick={onSubmit}
              disabled={disabled}
              className="px-5 py-2 rounded-full bg-red text-white text-sm font-semibold hover:bg-navy transition disabled:bg-navy/20"
            >
              Add
            </button>
            <button
              onClick={onCancel}
              className="px-4 py-2 rounded-full border border-navy/20 text-sm font-medium hover:bg-navy/5"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Patch Materials panel
// ---------------------------------------------------------------------------

type MaterialDraft = Omit<PatchMaterial, "id">;

const BLANK_MATERIAL: MaterialDraft = {
  name: "",
  internalSku: "",
  supplier: "",
  supplierSku: "",
  surfaceColorHex: "#c98a4b",
  engravingColorHex: "#241a12",
  edgeColorHex: "#1a1a1a",
  textureType: "leatherette",
  textureStrength: 55,
  referenceImageUrl: "",
  swatchImageUrl: "",
  availableForEngraving: true,
  availableForUv: false,
  active: true,
  sortOrder: 0,
};

function materialFields(
  draft: MaterialDraft,
  apply: (patch: Partial<MaterialDraft>) => void
) {
  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="text-sm text-navy/70">
          Name
          <input
            type="text"
            value={draft.name}
            onChange={(e) => apply({ name: e.target.value })}
            className="mt-1 w-full border border-navy/20 rounded-lg px-2 py-1.5 text-sm"
          />
        </label>
        <label className="text-sm text-navy/70">
          Internal SKU
          <input
            type="text"
            value={draft.internalSku ?? ""}
            onChange={(e) => apply({ internalSku: e.target.value })}
            className="mt-1 w-full border border-navy/20 rounded-lg px-2 py-1.5 text-sm"
          />
        </label>
        <label className="text-sm text-navy/70">
          Supplier
          <input
            type="text"
            value={draft.supplier ?? ""}
            onChange={(e) => apply({ supplier: e.target.value })}
            className="mt-1 w-full border border-navy/20 rounded-lg px-2 py-1.5 text-sm"
          />
        </label>
        <label className="text-sm text-navy/70">
          Supplier SKU
          <input
            type="text"
            value={draft.supplierSku ?? ""}
            onChange={(e) => apply({ supplierSku: e.target.value })}
            className="mt-1 w-full border border-navy/20 rounded-lg px-2 py-1.5 text-sm"
          />
        </label>
      </div>

      <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
        <label className="text-sm text-navy/70">
          Surface color
          <div className="mt-1 flex items-center gap-2">
            <ColorSwatch hex={draft.surfaceColorHex} />
            <input
              type="text"
              value={draft.surfaceColorHex}
              onChange={(e) => apply({ surfaceColorHex: e.target.value })}
              className="w-full border border-navy/20 rounded-lg px-2 py-1.5 text-sm"
            />
          </div>
        </label>
        <label className="text-sm text-navy/70">
          Engraving / ink color
          <div className="mt-1 flex items-center gap-2">
            <ColorSwatch hex={draft.engravingColorHex} />
            <input
              type="text"
              value={draft.engravingColorHex}
              onChange={(e) => apply({ engravingColorHex: e.target.value })}
              className="w-full border border-navy/20 rounded-lg px-2 py-1.5 text-sm"
            />
          </div>
        </label>
        <label className="text-sm text-navy/70">
          Edge color
          <div className="mt-1 flex items-center gap-2">
            <ColorSwatch hex={draft.edgeColorHex ?? "#000000"} />
            <input
              type="text"
              value={draft.edgeColorHex ?? ""}
              onChange={(e) => apply({ edgeColorHex: e.target.value })}
              className="w-full border border-navy/20 rounded-lg px-2 py-1.5 text-sm"
            />
          </div>
        </label>
      </div>

      <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="text-sm text-navy/70">
          Texture type
          <select
            value={draft.textureType}
            onChange={(e) => apply({ textureType: e.target.value as PatchTextureType })}
            className="mt-1 w-full border border-navy/20 rounded-lg px-2 py-1.5 text-sm"
          >
            {TEXTURE_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm text-navy/70">
          Texture strength (0-100)
          <input
            type="number"
            min={0}
            max={100}
            value={draft.textureStrength}
            onChange={(e) => apply({ textureStrength: Math.min(100, Math.max(0, Number(e.target.value) || 0)) })}
            className="mt-1 w-full border border-navy/20 rounded-lg px-2 py-1.5 text-sm"
          />
        </label>
      </div>

      <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="text-sm text-navy/70">
          Reference image URL
          <input
            type="text"
            value={draft.referenceImageUrl ?? ""}
            onChange={(e) => apply({ referenceImageUrl: e.target.value })}
            className="mt-1 w-full border border-navy/20 rounded-lg px-2 py-1.5 text-sm"
          />
        </label>
        <label className="text-sm text-navy/70">
          Swatch image URL
          <input
            type="text"
            value={draft.swatchImageUrl ?? ""}
            onChange={(e) => apply({ swatchImageUrl: e.target.value })}
            className="mt-1 w-full border border-navy/20 rounded-lg px-2 py-1.5 text-sm"
          />
        </label>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-4 text-sm text-navy/70">
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={draft.availableForEngraving}
            onChange={(e) => apply({ availableForEngraving: e.target.checked })}
          />
          Available for engraving
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={draft.availableForUv}
            onChange={(e) => apply({ availableForUv: e.target.checked })}
          />
          Available for UV printing
        </label>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={draft.active} onChange={(e) => apply({ active: e.target.checked })} />
          Active
        </label>
        <label className="flex items-center gap-1.5">
          Sort order
          <input
            type="number"
            value={draft.sortOrder}
            onChange={(e) => apply({ sortOrder: Number(e.target.value) || 0 })}
            className="w-16 border border-navy/20 rounded-lg px-2 py-1 text-sm"
          />
        </label>
      </div>
    </>
  );
}

function MaterialsPanel({
  materials,
  reload,
  setMessage,
}: {
  materials: PatchMaterial[];
  reload: () => void;
  setMessage: (m: string | null) => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, MaterialDraft>>(() =>
    Object.fromEntries(materials.map((m) => [m.id, { ...m }]))
  );
  const [creating, setCreating] = useState(false);
  const [newDraft, setNewDraft] = useState<MaterialDraft>(BLANK_MATERIAL);
  const [savingId, setSavingId] = useState<string | null>(null);

  function updateDraft(id: string, patch: Partial<MaterialDraft>) {
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  async function handleSave(id: string) {
    const draft = drafts[id];
    if (!draft) return;
    setSavingId(id);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/mockup-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resource: "material", id, fields: draft }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Save failed");
      setMessage(data.persisted ? "Saved." : "Saved for now — no durable storage connected.");
      reload();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setSavingId(null);
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Delete material "${name}"?`)) return;
    setSavingId(id);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/mockup-config?resource=material&id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Delete failed");
      setOpenId(null);
      reload();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setSavingId(null);
    }
  }

  async function handleCreate() {
    setSavingId("__new__");
    setMessage(null);
    try {
      const res = await fetch("/api/admin/mockup-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resource: "material", fields: newDraft }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Create failed");
      setCreating(false);
      setNewDraft(BLANK_MATERIAL);
      setMessage(data.persisted ? "Added." : "Added for now — no durable storage connected.");
      reload();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div>
      <div className="space-y-4">
        {materials.map((m) => {
          const draft = drafts[m.id] ?? { ...m };
          const isOpen = openId === m.id;
          return (
            <div key={m.id} className="border border-navy/10 rounded-xl bg-white overflow-hidden">
              <div className="flex items-center gap-3 p-4">
                <ColorSwatch hex={m.surfaceColorHex} />
                <div className="flex-1">
                  <div className="font-semibold text-navy">{m.name}</div>
                  <div className="text-xs text-navy/50 mt-0.5">
                    {m.textureType} · {m.availableForEngraving ? "engraving" : ""}
                    {m.availableForEngraving && m.availableForUv ? " · " : ""}
                    {m.availableForUv ? "UV" : ""}
                    {!m.active && " · inactive"}
                  </div>
                </div>
                <button
                  onClick={() => setOpenId(isOpen ? null : m.id)}
                  className="text-sm text-navy/70 px-3 py-1.5 rounded-lg border border-navy/20 hover:bg-navy/5"
                >
                  {isOpen ? "Close" : "Edit"}
                </button>
                <button
                  onClick={() => handleDelete(m.id, m.name)}
                  disabled={savingId === m.id}
                  className="text-sm text-red-600 px-2 hover:underline disabled:text-navy/20"
                >
                  Delete
                </button>
              </div>
              {isOpen && (
                <div className="p-4 border-t border-navy/10 bg-navy/[0.02]">
                  {materialFields(draft, (patch) => updateDraft(m.id, patch))}
                  <div className="mt-4">
                    <button
                      onClick={() => handleSave(m.id)}
                      disabled={savingId === m.id}
                      className="px-5 py-2 rounded-full bg-red text-white text-sm font-semibold hover:bg-navy transition disabled:bg-navy/20"
                    >
                      {savingId === m.id ? "Saving…" : "Save changes"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <AddNewCard
        label="patch material"
        creating={creating}
        onStart={() => setCreating(true)}
        onCancel={() => {
          setCreating(false);
          setNewDraft(BLANK_MATERIAL);
        }}
        onSubmit={handleCreate}
        disabled={savingId === "__new__" || !newDraft.name.trim()}
      >
        {materialFields(newDraft, (patch) => setNewDraft((prev) => ({ ...prev, ...patch })))}
      </AddNewCard>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Patch Shapes panel
// ---------------------------------------------------------------------------

type ShapeDraft = Omit<PatchShape, "id">;

const BLANK_SHAPE: ShapeDraft = {
  name: "",
  geometry: "roundedRectangle",
  cornerRadiusPct: 18,
  svgPath: "",
  availableForEngraving: true,
  availableForUv: true,
  active: true,
  sortOrder: 0,
};

function shapeFields(draft: ShapeDraft, apply: (patch: Partial<ShapeDraft>) => void) {
  const showCornerRadius = draft.geometry === "roundedRectangle" || draft.geometry === "roundedSquare";
  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="text-sm text-navy/70">
          Name
          <input
            type="text"
            value={draft.name}
            onChange={(e) => apply({ name: e.target.value })}
            className="mt-1 w-full border border-navy/20 rounded-lg px-2 py-1.5 text-sm"
          />
        </label>
        <label className="text-sm text-navy/70">
          Geometry
          <select
            value={draft.geometry}
            onChange={(e) => apply({ geometry: e.target.value as PatchShapeGeometry })}
            className="mt-1 w-full border border-navy/20 rounded-lg px-2 py-1.5 text-sm"
          >
            {SHAPE_GEOMETRIES.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </label>
      </div>

      {showCornerRadius && (
        <label className="mt-3 block text-sm text-navy/70 max-w-xs">
          Corner radius (% of shorter side, 0-50)
          <input
            type="number"
            min={0}
            max={50}
            value={draft.cornerRadiusPct ?? 0}
            onChange={(e) => apply({ cornerRadiusPct: Math.min(50, Math.max(0, Number(e.target.value) || 0)) })}
            className="mt-1 w-full border border-navy/20 rounded-lg px-2 py-1.5 text-sm"
          />
        </label>
      )}

      <label className="mt-3 block text-sm text-navy/70">
        Custom SVG path override (optional, viewBox &quot;0 0 100 100&quot;)
        <input
          type="text"
          value={draft.svgPath ?? ""}
          onChange={(e) => apply({ svgPath: e.target.value })}
          className="mt-1 w-full border border-navy/20 rounded-lg px-2 py-1.5 text-sm font-mono"
        />
      </label>

      <div className="mt-3 flex flex-wrap items-center gap-4 text-sm text-navy/70">
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={draft.availableForEngraving}
            onChange={(e) => apply({ availableForEngraving: e.target.checked })}
          />
          Available for engraving
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={draft.availableForUv}
            onChange={(e) => apply({ availableForUv: e.target.checked })}
          />
          Available for UV printing
        </label>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={draft.active} onChange={(e) => apply({ active: e.target.checked })} />
          Active
        </label>
        <label className="flex items-center gap-1.5">
          Sort order
          <input
            type="number"
            value={draft.sortOrder}
            onChange={(e) => apply({ sortOrder: Number(e.target.value) || 0 })}
            className="w-16 border border-navy/20 rounded-lg px-2 py-1 text-sm"
          />
        </label>
      </div>
    </>
  );
}

function ShapesPanel({
  shapes,
  reload,
  setMessage,
}: {
  shapes: PatchShape[];
  reload: () => void;
  setMessage: (m: string | null) => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, ShapeDraft>>(() =>
    Object.fromEntries(shapes.map((s) => [s.id, { ...s }]))
  );
  const [creating, setCreating] = useState(false);
  const [newDraft, setNewDraft] = useState<ShapeDraft>(BLANK_SHAPE);
  const [savingId, setSavingId] = useState<string | null>(null);

  function updateDraft(id: string, patch: Partial<ShapeDraft>) {
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  async function handleSave(id: string) {
    const draft = drafts[id];
    if (!draft) return;
    setSavingId(id);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/mockup-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resource: "shape", id, fields: draft }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Save failed");
      setMessage(data.persisted ? "Saved." : "Saved for now — no durable storage connected.");
      reload();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setSavingId(null);
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Delete shape "${name}"?`)) return;
    setSavingId(id);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/mockup-config?resource=shape&id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Delete failed");
      setOpenId(null);
      reload();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setSavingId(null);
    }
  }

  async function handleCreate() {
    setSavingId("__new__");
    setMessage(null);
    try {
      const res = await fetch("/api/admin/mockup-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resource: "shape", fields: newDraft }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Create failed");
      setCreating(false);
      setNewDraft(BLANK_SHAPE);
      setMessage(data.persisted ? "Added." : "Added for now — no durable storage connected.");
      reload();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div>
      <div className="space-y-4">
        {shapes.map((s) => {
          const draft = drafts[s.id] ?? { ...s };
          const isOpen = openId === s.id;
          return (
            <div key={s.id} className="border border-navy/10 rounded-xl bg-white overflow-hidden">
              <div className="flex items-center gap-3 p-4">
                <ShapeThumbnail geometry={s.geometry} cornerRadiusPct={s.cornerRadiusPct} />
                <div className="flex-1">
                  <div className="font-semibold text-navy">{s.name}</div>
                  <div className="text-xs text-navy/50 mt-0.5">
                    {s.geometry}
                    {!s.active && " · inactive"}
                  </div>
                </div>
                <button
                  onClick={() => setOpenId(isOpen ? null : s.id)}
                  className="text-sm text-navy/70 px-3 py-1.5 rounded-lg border border-navy/20 hover:bg-navy/5"
                >
                  {isOpen ? "Close" : "Edit"}
                </button>
                <button
                  onClick={() => handleDelete(s.id, s.name)}
                  disabled={savingId === s.id}
                  className="text-sm text-red-600 px-2 hover:underline disabled:text-navy/20"
                >
                  Delete
                </button>
              </div>
              {isOpen && (
                <div className="p-4 border-t border-navy/10 bg-navy/[0.02]">
                  {shapeFields(draft, (patch) => updateDraft(s.id, patch))}
                  <div className="mt-4">
                    <button
                      onClick={() => handleSave(s.id)}
                      disabled={savingId === s.id}
                      className="px-5 py-2 rounded-full bg-red text-white text-sm font-semibold hover:bg-navy transition disabled:bg-navy/20"
                    >
                      {savingId === s.id ? "Saving…" : "Save changes"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <AddNewCard
        label="patch shape"
        creating={creating}
        onStart={() => setCreating(true)}
        onCancel={() => {
          setCreating(false);
          setNewDraft(BLANK_SHAPE);
        }}
        onSubmit={handleCreate}
        disabled={savingId === "__new__" || !newDraft.name.trim()}
      >
        {shapeFields(newDraft, (patch) => setNewDraft((prev) => ({ ...prev, ...patch })))}
      </AddNewCard>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Patch Sizes panel
// ---------------------------------------------------------------------------

type SizeDraft = Omit<PatchSize, "id">;

const BLANK_SIZE: SizeDraft = {
  name: "",
  widthIn: 3,
  heightIn: 2,
  applicableShapeIds: [],
  applicableMethods: ["engraved", "uv"],
  active: true,
  sortOrder: 0,
};

function sizeFields(
  draft: SizeDraft,
  apply: (patch: Partial<SizeDraft>) => void,
  allShapes: PatchShape[]
) {
  function toggleMethod(method: "engraved" | "uv", checked: boolean) {
    const next = checked
      ? [...draft.applicableMethods, method]
      : draft.applicableMethods.filter((m) => m !== method);
    apply({ applicableMethods: next });
  }

  function toggleShape(shapeId: string, checked: boolean) {
    const next = checked
      ? [...draft.applicableShapeIds, shapeId]
      : draft.applicableShapeIds.filter((id) => id !== shapeId);
    apply({ applicableShapeIds: next });
  }

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <label className="text-sm text-navy/70">
          Name
          <input
            type="text"
            value={draft.name}
            onChange={(e) => apply({ name: e.target.value })}
            placeholder='e.g. 3" x 2"'
            className="mt-1 w-full border border-navy/20 rounded-lg px-2 py-1.5 text-sm"
          />
        </label>
        <label className="text-sm text-navy/70">
          Width (in)
          <input
            type="number"
            step="0.1"
            min={0.1}
            value={draft.widthIn}
            onChange={(e) => apply({ widthIn: Math.max(0.1, Number(e.target.value) || 0.1) })}
            className="mt-1 w-full border border-navy/20 rounded-lg px-2 py-1.5 text-sm"
          />
        </label>
        <label className="text-sm text-navy/70">
          Height (in)
          <input
            type="number"
            step="0.1"
            min={0.1}
            value={draft.heightIn}
            onChange={(e) => apply({ heightIn: Math.max(0.1, Number(e.target.value) || 0.1) })}
            className="mt-1 w-full border border-navy/20 rounded-lg px-2 py-1.5 text-sm"
          />
        </label>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-4 text-sm text-navy/70">
        <span className="font-medium text-navy">Applicable methods</span>
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={draft.applicableMethods.includes("engraved")}
            onChange={(e) => toggleMethod("engraved", e.target.checked)}
          />
          Engraved
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={draft.applicableMethods.includes("uv")}
            onChange={(e) => toggleMethod("uv", e.target.checked)}
          />
          UV Printed
        </label>
      </div>

      <div className="mt-3">
        <span className="text-sm font-medium text-navy">Applicable shapes</span>
        <p className="text-xs text-navy/50 mt-0.5">Leave all unchecked to allow every shape.</p>
        <div className="mt-2 flex flex-wrap gap-3 text-sm text-navy/70">
          {allShapes.map((shape) => (
            <label key={shape.id} className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={draft.applicableShapeIds.includes(shape.id)}
                onChange={(e) => toggleShape(shape.id, e.target.checked)}
              />
              {shape.name}
            </label>
          ))}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-4 text-sm text-navy/70">
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={draft.active} onChange={(e) => apply({ active: e.target.checked })} />
          Active
        </label>
        <label className="flex items-center gap-1.5">
          Sort order
          <input
            type="number"
            value={draft.sortOrder}
            onChange={(e) => apply({ sortOrder: Number(e.target.value) || 0 })}
            className="w-16 border border-navy/20 rounded-lg px-2 py-1 text-sm"
          />
        </label>
      </div>
    </>
  );
}

function SizesPanel({
  sizes,
  shapes,
  reload,
  setMessage,
}: {
  sizes: PatchSize[];
  shapes: PatchShape[];
  reload: () => void;
  setMessage: (m: string | null) => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, SizeDraft>>(() =>
    Object.fromEntries(sizes.map((s) => [s.id, { ...s }]))
  );
  const [creating, setCreating] = useState(false);
  const [newDraft, setNewDraft] = useState<SizeDraft>(BLANK_SIZE);
  const [savingId, setSavingId] = useState<string | null>(null);

  function updateDraft(id: string, patch: Partial<SizeDraft>) {
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  async function handleSave(id: string) {
    const draft = drafts[id];
    if (!draft) return;
    setSavingId(id);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/mockup-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resource: "size", id, fields: draft }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Save failed");
      setMessage(data.persisted ? "Saved." : "Saved for now — no durable storage connected.");
      reload();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setSavingId(null);
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Delete size "${name}"?`)) return;
    setSavingId(id);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/mockup-config?resource=size&id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Delete failed");
      setOpenId(null);
      reload();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setSavingId(null);
    }
  }

  async function handleCreate() {
    setSavingId("__new__");
    setMessage(null);
    try {
      const res = await fetch("/api/admin/mockup-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resource: "size", fields: newDraft }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Create failed");
      setCreating(false);
      setNewDraft(BLANK_SIZE);
      setMessage(data.persisted ? "Added." : "Added for now — no durable storage connected.");
      reload();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div>
      <div className="space-y-4">
        {sizes.map((s) => {
          const draft = drafts[s.id] ?? { ...s };
          const isOpen = openId === s.id;
          return (
            <div key={s.id} className="border border-navy/10 rounded-xl bg-white overflow-hidden">
              <div className="flex items-center gap-3 p-4">
                <div className="flex-1">
                  <div className="font-semibold text-navy">{s.name}</div>
                  <div className="text-xs text-navy/50 mt-0.5">
                    {s.applicableMethods.join(" & ")}
                    {!s.active && " · inactive"}
                  </div>
                </div>
                <button
                  onClick={() => setOpenId(isOpen ? null : s.id)}
                  className="text-sm text-navy/70 px-3 py-1.5 rounded-lg border border-navy/20 hover:bg-navy/5"
                >
                  {isOpen ? "Close" : "Edit"}
                </button>
                <button
                  onClick={() => handleDelete(s.id, s.name)}
                  disabled={savingId === s.id}
                  className="text-sm text-red-600 px-2 hover:underline disabled:text-navy/20"
                >
                  Delete
                </button>
              </div>
              {isOpen && (
                <div className="p-4 border-t border-navy/10 bg-navy/[0.02]">
                  {sizeFields(draft, (patch) => updateDraft(s.id, patch), shapes)}
                  <div className="mt-4">
                    <button
                      onClick={() => handleSave(s.id)}
                      disabled={savingId === s.id}
                      className="px-5 py-2 rounded-full bg-red text-white text-sm font-semibold hover:bg-navy transition disabled:bg-navy/20"
                    >
                      {savingId === s.id ? "Saving…" : "Save changes"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <AddNewCard
        label="patch size"
        creating={creating}
        onStart={() => setCreating(true)}
        onCancel={() => {
          setCreating(false);
          setNewDraft(BLANK_SIZE);
        }}
        onSubmit={handleCreate}
        disabled={savingId === "__new__" || !newDraft.name.trim()}
      >
        {sizeFields(newDraft, (patch) => setNewDraft((prev) => ({ ...prev, ...patch })), shapes)}
      </AddNewCard>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Method Settings panel (singleton flat form)
// ---------------------------------------------------------------------------

function MethodSettingsPanel({
  settings,
  reload,
  setMessage,
}: {
  settings: DecorationMethodSettings;
  reload: () => void;
  setMessage: (m: string | null) => void;
}) {
  const [draft, setDraft] = useState<DecorationMethodSettings>(settings);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/mockup-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resource: "methodSettings", fields: draft }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Save failed");
      setMessage(data.persisted ? "Saved." : "Saved for now — no durable storage connected.");
      reload();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  function numberField(
    label: string,
    value: number,
    onChange: (v: number) => void,
    opts?: { step?: string; min?: number; max?: number }
  ) {
    return (
      <label className="text-sm text-navy/70">
        {label}
        <input
          type="number"
          step={opts?.step ?? "1"}
          min={opts?.min}
          max={opts?.max}
          value={value}
          onChange={(e) => onChange(Number(e.target.value) || 0)}
          className="mt-1 w-full border border-navy/20 rounded-lg px-2 py-1.5 text-sm"
        />
      </label>
    );
  }

  return (
    <div className="max-w-2xl">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        <div>
          <h3 className="font-semibold text-navy mb-2">Embroidery</h3>
          <div className="space-y-3">
            {numberField("Thread texture intensity (0-100)", draft.embroidery.threadTextureIntensity, (v) =>
              setDraft((d) => ({ ...d, embroidery: { ...d.embroidery, threadTextureIntensity: v } }))
            , { min: 0, max: 100 })}
            {numberField("Stitch depth (0-100)", draft.embroidery.stitchDepth, (v) =>
              setDraft((d) => ({ ...d, embroidery: { ...d.embroidery, stitchDepth: v } }))
            , { min: 0, max: 100 })}
            {numberField("Default max width (in)", draft.embroidery.defaultMaxWidthIn, (v) =>
              setDraft((d) => ({ ...d, embroidery: { ...d.embroidery, defaultMaxWidthIn: v } }))
            , { step: "0.1", min: 0.1 })}
            {numberField("Default max height (in)", draft.embroidery.defaultMaxHeightIn, (v) =>
              setDraft((d) => ({ ...d, embroidery: { ...d.embroidery, defaultMaxHeightIn: v } }))
            , { step: "0.1", min: 0.1 })}
            {numberField("Perspective amount (0-100)", draft.embroidery.perspectiveAmount, (v) =>
              setDraft((d) => ({ ...d, embroidery: { ...d.embroidery, perspectiveAmount: v } }))
            , { min: 0, max: 100 })}
            {numberField("Shadow intensity (0-100)", draft.embroidery.shadowIntensity, (v) =>
              setDraft((d) => ({ ...d, embroidery: { ...d.embroidery, shadowIntensity: v } }))
            , { min: 0, max: 100 })}
          </div>
        </div>

        <div>
          <h3 className="font-semibold text-navy mb-2">Engraving</h3>
          <div className="space-y-3">
            {numberField("Contrast (0-100)", draft.engraving.contrast, (v) =>
              setDraft((d) => ({ ...d, engraving: { ...d.engraving, contrast: v } }))
            , { min: 0, max: 100 })}
            {numberField("Texture strength (0-100)", draft.engraving.textureStrength, (v) =>
              setDraft((d) => ({ ...d, engraving: { ...d.engraving, textureStrength: v } }))
            , { min: 0, max: 100 })}
            {numberField("Edge burn (0-100)", draft.engraving.edgeBurn, (v) =>
              setDraft((d) => ({ ...d, engraving: { ...d.engraving, edgeBurn: v } }))
            , { min: 0, max: 100 })}
            {numberField("Patch depth (0-100)", draft.engraving.patchDepth, (v) =>
              setDraft((d) => ({ ...d, engraving: { ...d.engraving, patchDepth: v } }))
            , { min: 0, max: 100 })}
            {numberField("Perspective amount (0-100)", draft.engraving.perspectiveAmount, (v) =>
              setDraft((d) => ({ ...d, engraving: { ...d.engraving, perspectiveAmount: v } }))
            , { min: 0, max: 100 })}
          </div>
        </div>

        <div>
          <h3 className="font-semibold text-navy mb-2">UV Printing</h3>
          <div className="space-y-3">
            {numberField("Print saturation (0-100)", draft.uv.printSaturation, (v) =>
              setDraft((d) => ({ ...d, uv: { ...d.uv, printSaturation: v } }))
            , { min: 0, max: 100 })}
            {numberField("Print depth (0-100)", draft.uv.printDepth, (v) =>
              setDraft((d) => ({ ...d, uv: { ...d.uv, printDepth: v } }))
            , { min: 0, max: 100 })}
            {numberField("Texture visibility (0-100)", draft.uv.textureVisibility, (v) =>
              setDraft((d) => ({ ...d, uv: { ...d.uv, textureVisibility: v } }))
            , { min: 0, max: 100 })}
            {numberField("Patch depth (0-100)", draft.uv.patchDepth, (v) =>
              setDraft((d) => ({ ...d, uv: { ...d.uv, patchDepth: v } }))
            , { min: 0, max: 100 })}
            {numberField("Perspective amount (0-100)", draft.uv.perspectiveAmount, (v) =>
              setDraft((d) => ({ ...d, uv: { ...d.uv, perspectiveAmount: v } }))
            , { min: 0, max: 100 })}
          </div>
        </div>
      </div>

      <div className="mt-6">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-5 py-2 rounded-full bg-red text-white text-sm font-semibold hover:bg-navy transition disabled:bg-navy/20"
        >
          {saving ? "Saving…" : "Save method settings"}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mockup Settings panel (singleton flat form)
// ---------------------------------------------------------------------------

function MockupSettingsPanel({
  settings,
  reload,
  setMessage,
}: {
  settings: MockupSettings;
  reload: () => void;
  setMessage: (m: string | null) => void;
}) {
  const [draft, setDraft] = useState<MockupSettings>(settings);
  const [saving, setSaving] = useState(false);

  function apply(patch: Partial<MockupSettings>) {
    setDraft((d) => ({ ...d, ...patch }));
  }

  async function handleSave() {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/mockup-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resource: "mockupSettings", fields: draft }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Save failed");
      setMessage(data.persisted ? "Saved." : "Saved for now — no durable storage connected.");
      reload();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-2xl">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="text-sm text-navy/70">
          Background color
          <div className="mt-1 flex items-center gap-2">
            <ColorSwatch hex={draft.backgroundColor} />
            <input
              type="text"
              value={draft.backgroundColor}
              onChange={(e) => apply({ backgroundColor: e.target.value })}
              className="w-full border border-navy/20 rounded-lg px-2 py-1.5 text-sm"
            />
          </div>
        </label>
        <label className="text-sm text-navy/70">
          Export resolution multiplier
          <select
            value={draft.exportResolutionMultiplier}
            onChange={(e) => apply({ exportResolutionMultiplier: Number(e.target.value) as 1 | 2 | 3 })}
            className="mt-1 w-full border border-navy/20 rounded-lg px-2 py-1.5 text-sm"
          >
            <option value={1}>1x</option>
            <option value={2}>2x</option>
            <option value={3}>3x</option>
          </select>
        </label>
        <label className="text-sm text-navy/70">
          Export width (px)
          <input
            type="number"
            min={1}
            value={draft.exportWidth}
            onChange={(e) => apply({ exportWidth: Math.max(1, Number(e.target.value) || 1) })}
            className="mt-1 w-full border border-navy/20 rounded-lg px-2 py-1.5 text-sm"
          />
        </label>
        <label className="text-sm text-navy/70">
          Export height (px)
          <input
            type="number"
            min={1}
            value={draft.exportHeight}
            onChange={(e) => apply({ exportHeight: Math.max(1, Number(e.target.value) || 1) })}
            className="mt-1 w-full border border-navy/20 rounded-lg px-2 py-1.5 text-sm"
          />
        </label>
        <label className="text-sm text-navy/70">
          Hat scale (% of canvas)
          <input
            type="number"
            min={0}
            max={100}
            value={draft.hatScalePct}
            onChange={(e) => apply({ hatScalePct: Math.min(100, Math.max(0, Number(e.target.value) || 0)) })}
            className="mt-1 w-full border border-navy/20 rounded-lg px-2 py-1.5 text-sm"
          />
        </label>
        <label className="text-sm text-navy/70">
          Hat vertical offset (%, -50..50)
          <input
            type="number"
            min={-50}
            max={50}
            value={draft.hatOffsetYPct}
            onChange={(e) => apply({ hatOffsetYPct: Math.min(50, Math.max(-50, Number(e.target.value) || 0)) })}
            className="mt-1 w-full border border-navy/20 rounded-lg px-2 py-1.5 text-sm"
          />
        </label>
        <label className="text-sm text-navy/70">
          Banner width (% of export width)
          <input
            type="number"
            min={0}
            max={100}
            value={draft.bannerWidthPct}
            onChange={(e) => apply({ bannerWidthPct: Math.min(100, Math.max(0, Number(e.target.value) || 0)) })}
            className="mt-1 w-full border border-navy/20 rounded-lg px-2 py-1.5 text-sm"
          />
        </label>
        <label className="text-sm text-navy/70">
          Banner height (px)
          <input
            type="number"
            min={1}
            value={draft.bannerHeightPx}
            onChange={(e) => apply({ bannerHeightPx: Math.max(1, Number(e.target.value) || 1) })}
            className="mt-1 w-full border border-navy/20 rounded-lg px-2 py-1.5 text-sm"
          />
        </label>
        <label className="text-sm text-navy/70">
          Banner spacing (px)
          <input
            type="number"
            min={0}
            value={draft.bannerSpacingPx}
            onChange={(e) => apply({ bannerSpacingPx: Math.max(0, Number(e.target.value) || 0) })}
            className="mt-1 w-full border border-navy/20 rounded-lg px-2 py-1.5 text-sm"
          />
        </label>
        <label className="text-sm text-navy/70">
          Default hat style number
          <input
            type="text"
            value={draft.defaultHatStyleNumber ?? ""}
            onChange={(e) => apply({ defaultHatStyleNumber: e.target.value })}
            className="mt-1 w-full border border-navy/20 rounded-lg px-2 py-1.5 text-sm"
          />
        </label>
        <label className="text-sm text-navy/70">
          Default decoration method
          <select
            value={draft.defaultMethod}
            onChange={(e) => apply({ defaultMethod: e.target.value as MockupSettings["defaultMethod"] })}
            className="mt-1 w-full border border-navy/20 rounded-lg px-2 py-1.5 text-sm"
          >
            <option value="embroidered">Embroidered</option>
            <option value="engraved">Engraved Patch</option>
            <option value="uv">UV Printed Patch</option>
          </select>
        </label>
        <label className="text-sm text-navy/70">
          Default material id
          <input
            type="text"
            value={draft.defaultMaterialId ?? ""}
            onChange={(e) => apply({ defaultMaterialId: e.target.value })}
            className="mt-1 w-full border border-navy/20 rounded-lg px-2 py-1.5 text-sm"
          />
        </label>
      </div>

      <label className="mt-3 flex items-center gap-1.5 text-sm text-navy/70 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={draft.showSafeAreaGuideInEditor}
          onChange={(e) => apply({ showSafeAreaGuideInEditor: e.target.checked })}
        />
        Show safe-area guide in editor (never affects export)
      </label>

      <div className="mt-6">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-5 py-2 rounded-full bg-red text-white text-sm font-semibold hover:bg-navy transition disabled:bg-navy/20"
        >
          {saving ? "Saving…" : "Save mockup settings"}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Root component
// ---------------------------------------------------------------------------

export default function AdminMockupGeneratorManager() {
  const router = useRouter();
  const [subTab, setSubTab] = useState<SubTab>("materials");
  const [config, setConfig] = useState<MockupConfig | null>(null);
  const [persistent, setPersistent] = useState(true);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  // Bumped on every successful load so panels below remount with fresh
  // initial draft state (via `key`) instead of syncing props into state
  // inside an effect.
  const [version, setVersion] = useState(0);

  function load() {
    fetch("/api/admin/mockup-config")
      .then((r) => {
        if (r.status === 401) throw new Error("unauthorized");
        return r.json();
      })
      .then((data: { config: MockupConfig; persistent: boolean }) => {
        setConfig(data.config);
        setPersistent(data.persistent);
        setVersion((v) => v + 1);
      })
      .catch(() => router.refresh())
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  if (loading || !config) {
    return <p className="text-navy/40 text-sm">Loading…</p>;
  }

  return (
    <div>
      {!persistent && <NotPersistentBanner />}

      <div className="flex flex-wrap gap-1 border-b border-navy/10 mb-4">
        {SUB_TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setSubTab(t.id)}
            className={`px-3 py-1.5 text-sm font-medium border-b-2 -mb-px transition ${
              subTab === t.id
                ? "border-red text-navy"
                : "border-transparent text-navy/50 hover:text-navy"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {subTab === "materials" && (
        <MaterialsPanel
          key={version}
          materials={config.patchMaterials}
          reload={load}
          setMessage={setMessage}
        />
      )}
      {subTab === "shapes" && (
        <ShapesPanel key={version} shapes={config.patchShapes} reload={load} setMessage={setMessage} />
      )}
      {subTab === "sizes" && (
        <SizesPanel
          key={version}
          sizes={config.patchSizes}
          shapes={config.patchShapes}
          reload={load}
          setMessage={setMessage}
        />
      )}
      {subTab === "methods" && (
        <MethodSettingsPanel
          key={version}
          settings={config.methodSettings}
          reload={load}
          setMessage={setMessage}
        />
      )}
      {subTab === "mockup" && (
        <MockupSettingsPanel
          key={version}
          settings={config.mockupSettings}
          reload={load}
          setMessage={setMessage}
        />
      )}

      {message && <p className="mt-4 text-sm text-navy/70">{message}</p>}

      {/* Hat calibration (MockupHatCalibration) is intentionally not managed
          here — it will be added to the per-hat "Configure decorations" flow
          in a later phase, alongside the existing PlacementZone editor. */}
    </div>
  );
}

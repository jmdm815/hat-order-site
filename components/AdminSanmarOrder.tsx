"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

// ---------------------------------------------------------------------------
// SanMar Order (/admin/sanmar-order): build the list of blanks to buy from
// SanMar — from one or more quotes, or by searching a style — with live
// account cost and stock by warehouse, then hand it to Claude to put in the
// sanmar.com shopping box (checkout stays with the shop). Also shows recent
// SanMar orders and tracking.
// ---------------------------------------------------------------------------

type Source = { quoteId: string; label: string; qty: number };
type Item = { style: string; color: string; size: string; qty: number; sources: Source[] };
type OrderList = { items: Item[]; status: "draft" | "in-shopping-box"; updatedAt: string; addedToBoxAt?: string };
type Warehouse = { id: string; name: string; qty: number };
type SizeInfo = { size: string; cost: number | null; total: number; dallas: number; warehouses: Warehouse[] };
type Lookup = { style: string; colors: string[]; color: string | null; sizes: SizeInfo[]; priced: boolean };
type QuoteRow = {
  id: string;
  number: string;
  customer: string;
  status: string;
  createdAt: string;
  sanmarPieces: number;
  styles: string;
};
type OrderStatus = { salesOrder: string; status: string; expectedShipDate?: string; updatedAt?: string };
type Shipment = { shipDate?: string; carrier?: string; service?: string; tracking: string[]; fromWarehouse?: string };

const money = (n: number) => `$${n.toFixed(2)}`;
const SIZE_ORDER = ["XXS", "XS", "S", "M", "L", "XL", "2XL", "XXL", "3XL", "4XL", "5XL", "6XL", "OSFA"];
const sizeRank = (s: string) => {
  const i = SIZE_ORDER.indexOf(s.toUpperCase());
  return i === -1 ? 50 : i;
};
const shortDate = (iso?: string) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "");
const groupKey = (i: { style: string; color: string }) => `${i.style}|${i.color}`;

function trackingUrl(carrier: string | undefined, num: string) {
  if ((carrier ?? "").toUpperCase().includes("FEDEX")) return `https://www.fedex.com/fedextrack/?trknbr=${num}`;
  if ((carrier ?? "").toUpperCase().includes("USPS")) return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${num}`;
  return `https://www.ups.com/track?tracknum=${num}`;
}

export default function AdminSanmarOrder() {
  const [order, setOrder] = useState<OrderList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<Record<string, Lookup | "loading" | "error">>({});

  const [quotes, setQuotes] = useState<QuoteRow[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [showAllQuotes, setShowAllQuotes] = useState(false);

  const [style, setStyle] = useState("");
  const [search, setSearch] = useState<Lookup | null>(null);
  const [searchColor, setSearchColor] = useState("");
  const [searchQty, setSearchQty] = useState<Record<string, string>>({});
  const [searchMsg, setSearchMsg] = useState<string | null>(null);

  const [history, setHistory] = useState<OrderStatus[] | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [tracking, setTracking] = useState<Record<string, Shipment[] | "loading" | "error">>({});

  const loadOrder = useCallback(async () => {
    const res = await fetch("/api/admin/sanmar-order", { cache: "no-store" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Couldn't load the order list");
    setOrder(data.order);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadOrder().catch((e) => setError(e.message));
    fetch("/api/admin/quotes", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        const rows: QuoteRow[] = [];
        for (const q of d.quotes ?? []) {
          if (q.deletedAt) continue;
          const lines = (q.input?.lines ?? []).filter(
            (l: { customerSupplied?: boolean; styleNumber?: string; colorName?: string; catalogSource?: string }) =>
              !l.customerSupplied && l.styleNumber && l.colorName && (!l.catalogSource || l.catalogSource === "sanmar")
          );
          if (!lines.length) continue;
          const pieces = lines.reduce(
            (n: number, l: { sizes: { quantity: number }[] }) => n + l.sizes.reduce((m, s) => m + (Number(s.quantity) || 0), 0),
            0
          );
          if (!pieces) continue;
          rows.push({
            id: q.id,
            number: q.invoiceNumber || q.quoteNumber || "Quote",
            customer: q.computed?.customerCompany || q.computed?.customerName || "",
            status: q.status === "invoice" ? `Invoice${q.invoiceStatus ? ` · ${String(q.invoiceStatus).replace("_", " ")}` : ""}` : "Quote",
            createdAt: q.createdAt,
            sanmarPieces: pieces,
            styles: Array.from(new Set(lines.map((l: { styleNumber: string }) => l.styleNumber))).join(", "),
          });
        }
        rows.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
        setQuotes(rows);
      })
      .catch(() => setQuotes([]));
    fetch("/api/admin/sanmar-order/history", { cache: "no-store" })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "Couldn't reach SanMar");
        setHistory(d.orders);
      })
      .catch((e) => setHistoryError(e.message));
  }, [loadOrder]);

  // Live cost + stock for every style/color on the list.
  const groups = useMemo(() => {
    const map = new Map<string, { style: string; color: string; items: Item[] }>();
    for (const i of order?.items ?? []) {
      const k = groupKey(i);
      if (!map.has(k)) map.set(k, { style: i.style, color: i.color, items: [] });
      map.get(k)!.items.push(i);
    }
    const out = Array.from(map.values());
    out.forEach((g) => g.items.sort((a, b) => sizeRank(a.size) - sizeRank(b.size)));
    return out.sort((a, b) => a.style.localeCompare(b.style) || a.color.localeCompare(b.color));
  }, [order]);

  useEffect(() => {
    for (const g of groups) {
      const k = groupKey(g);
      if (info[k]) continue;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setInfo((prev) => ({ ...prev, [k]: "loading" }));
      fetch(`/api/admin/sanmar-order/lookup?style=${encodeURIComponent(g.style)}&color=${encodeURIComponent(g.color)}`)
        .then(async (r) => {
          const d = await r.json();
          if (!r.ok) throw new Error(d.error);
          setInfo((prev) => ({ ...prev, [k]: d }));
        })
        .catch(() => setInfo((prev) => ({ ...prev, [k]: "error" })));
    }
  }, [groups, info]);

  function sizeInfo(i: Item): SizeInfo | undefined {
    const l = info[groupKey(i)];
    if (!l || typeof l === "string") return undefined;
    return l.sizes.find((s) => s.size.toUpperCase() === i.size.toUpperCase());
  }

  const totals = useMemo(() => {
    let pieces = 0;
    let cost = 0;
    let unpriced = 0;
    for (const i of order?.items ?? []) {
      pieces += i.qty;
      const c = sizeInfo(i)?.cost;
      if (c) cost += c * i.qty;
      else unpriced += i.qty;
    }
    return { pieces, cost, unpriced };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order, info]);

  async function post(body: unknown) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/sanmar-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      setOrder(data.order);
      return data;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function saveItems(items: Item[], status?: OrderList["status"]) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/sanmar-order", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items, status }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      setOrder(data.order);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function addQuotes() {
    if (!picked.size) return;
    const data = await post({ action: "add-quotes", quoteIds: Array.from(picked) });
    if (data) {
      setPicked(new Set());
      if (data.skipped?.length) setError(`Already on the list, skipped: ${data.skipped.join(", ")}`);
    }
  }

  function setQty(target: Item, qty: number) {
    if (!order) return;
    const items = order.items.map((i) =>
      groupKey(i) === groupKey(target) && i.size === target.size ? { ...i, qty: Math.max(0, qty) } : i
    );
    setOrder({ ...order, items });
  }

  async function lookupStyle(color?: string) {
    const s = style.trim().toUpperCase();
    if (!s) return;
    setSearchMsg(null);
    setSearch(null);
    try {
      const res = await fetch(`/api/admin/sanmar-order/lookup?style=${encodeURIComponent(s)}${color ? `&color=${encodeURIComponent(color)}` : ""}`);
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      setSearch(d);
      setSearchColor(d.color ?? "");
      setSearchQty({});
    } catch (e) {
      setSearchMsg(e instanceof Error ? e.message : "Lookup failed");
    }
  }

  async function addSearched() {
    if (!search?.color) return;
    const items = Object.entries(searchQty)
      .map(([size, q]) => ({ style: search.style, color: search.color!, size, qty: Number(q) || 0, sources: [] }))
      .filter((i) => i.qty > 0);
    if (!items.length) return;
    const ok = await post({ action: "add-items", items });
    if (ok) {
      setSearchQty({});
      setSearchMsg(`Added ${items.reduce((n, i) => n + i.qty, 0)} × ${search.style} ${search.color}.`);
    }
  }

  async function loadTracking(so: string) {
    setTracking((t) => ({ ...t, [so]: "loading" }));
    try {
      const r = await fetch(`/api/admin/sanmar-order/history?so=${so}`);
      const d = await r.json();
      if (!r.ok) throw new Error();
      setTracking((t) => ({ ...t, [so]: d.shipments }));
    } catch {
      setTracking((t) => ({ ...t, [so]: "error" }));
    }
  }

  const visibleQuotes = (quotes ?? []).slice(0, showAllQuotes ? 60 : 12);
  const onList = new Set((order?.items ?? []).flatMap((i) => i.sources.map((s) => s.quoteId)));
  const card = "bg-admin-card border border-admin-ink/15 rounded-2xl p-4 sm:p-5";
  const btn = "px-3 py-1.5 rounded-xl text-sm font-medium disabled:opacity-50";

  return (
    <div className="space-y-5">
      {error && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{error}</p>}

      {/* ---- Order list ---- */}
      <section className={card}>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div>
            <h2 className="font-heading font-semibold uppercase tracking-wide">Order list</h2>
            <p className="text-xs text-admin-ink/70">
              {order?.status === "in-shopping-box"
                ? `In your SanMar shopping box${order.addedToBoxAt ? ` since ${shortDate(order.addedToBoxAt)}` : ""} — check out on sanmar.com.`
                : "Draft — when it's ready, ask Claude to add it to your SanMar shopping box."}
            </p>
          </div>
          <div className="flex gap-2">
            {order && order.items.length > 0 && (
              <>
                <button
                  className={`${btn} border border-admin-ink/25`}
                  disabled={busy}
                  onClick={() => saveItems(order.items, order.status === "in-shopping-box" ? "draft" : "in-shopping-box")}
                >
                  {order.status === "in-shopping-box" ? "Back to draft" : "Mark added to box"}
                </button>
                <button
                  className={`${btn} border border-red-300 text-red-700`}
                  disabled={busy}
                  onClick={() => confirm("Clear the whole order list?") && post({ action: "clear" })}
                >
                  Clear
                </button>
              </>
            )}
          </div>
        </div>

        {!order ? (
          <p className="text-sm text-admin-ink/70">Loading…</p>
        ) : order.items.length === 0 ? (
          <p className="text-sm text-admin-ink/70">Nothing on the list yet. Add quotes or search a style below.</p>
        ) : (
          <div className="space-y-4">
            {groups.map((g) => {
              const l = info[groupKey(g)];
              return (
                <div key={groupKey(g)} className="border border-admin-ink/10 rounded-xl overflow-hidden">
                  <div className="bg-admin-bg px-3 py-2 flex flex-wrap justify-between gap-2 text-sm">
                    <span className="font-semibold">
                      {g.style} · {g.color}
                    </span>
                    <span className="text-xs text-admin-ink/70">
                      {Array.from(new Set(g.items.flatMap((i) => i.sources.map((s) => s.label)))).join(" · ") || "Added by hand"}
                    </span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="text-xs text-admin-ink/60">
                        <tr>
                          <th className="text-left px-3 py-1.5">Size</th>
                          <th className="text-left px-2">Qty</th>
                          <th className="text-right px-2">Your cost</th>
                          <th className="text-right px-2">Line</th>
                          <th className="text-left px-3">Stock</th>
                        </tr>
                      </thead>
                      <tbody>
                        {g.items.map((i) => {
                          const s = sizeInfo(i);
                          const short = s && s.dallas < i.qty;
                          const alt = short ? s!.warehouses.find((w) => w.name !== "Dallas" && w.qty >= i.qty) : undefined;
                          return (
                            <tr key={i.size} className="border-t border-admin-ink/5">
                              <td className="px-3 py-1.5 font-medium">{i.size}</td>
                              <td className="px-2">
                                <input
                                  type="number"
                                  min={0}
                                  value={i.qty}
                                  onChange={(e) => setQty(i, Number(e.target.value))}
                                  onBlur={() => order && saveItems(order.items)}
                                  className="w-16 border border-admin-ink/20 rounded-lg px-2 py-0.5 bg-white"
                                />
                              </td>
                              <td className="px-2 text-right">{s?.cost ? money(s.cost) : l === "loading" ? "…" : "—"}</td>
                              <td className="px-2 text-right">{s?.cost ? money(s.cost * i.qty) : ""}</td>
                              <td className="px-3 text-xs">
                                {l === "loading" ? (
                                  "…"
                                ) : l === "error" ? (
                                  <span className="text-red-700">couldn&apos;t check</span>
                                ) : !s ? (
                                  <span className="text-red-700">size not found</span>
                                ) : short ? (
                                  <span className="text-amber-700">
                                    Dallas {s.dallas} — {alt ? `${alt.name} has ${alt.qty}` : `only ${s.total} total`}
                                  </span>
                                ) : (
                                  <span className="text-green-700">Dallas {s.dallas}</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
            <div className="flex flex-wrap justify-end gap-4 text-sm">
              <span>
                <span className="text-admin-ink/70">Pieces:</span> <b>{totals.pieces}</b>
              </span>
              <span>
                <span className="text-admin-ink/70">Est. cost:</span> <b>{money(totals.cost)}</b>
                {totals.unpriced > 0 && <span className="text-amber-700"> (+{totals.unpriced} unpriced)</span>}
              </span>
            </div>
          </div>
        )}
      </section>

      {/* ---- From quotes ---- */}
      <section className={card}>
        <div className="flex items-center justify-between gap-2 mb-2">
          <h2 className="font-heading font-semibold uppercase tracking-wide">Add from quotes</h2>
          <button className={`${btn} bg-admin-ink text-white`} disabled={busy || !picked.size} onClick={addQuotes}>
            Add {picked.size || ""} selected
          </button>
        </div>
        {!quotes ? (
          <p className="text-sm text-admin-ink/70">Loading quotes…</p>
        ) : quotes.length === 0 ? (
          <p className="text-sm text-admin-ink/70">No quotes with SanMar garments.</p>
        ) : (
          <>
            <ul className="divide-y divide-admin-ink/10">
              {visibleQuotes.map((q) => {
                const added = onList.has(q.id);
                return (
                  <li key={q.id} className="py-2 flex items-center gap-3 text-sm">
                    <input
                      type="checkbox"
                      disabled={added}
                      checked={picked.has(q.id)}
                      onChange={(e) => {
                        const next = new Set(picked);
                        if (e.target.checked) next.add(q.id);
                        else next.delete(q.id);
                        setPicked(next);
                      }}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">
                        {q.number} · {q.customer}
                      </div>
                      <div className="text-xs text-admin-ink/70 truncate">
                        {q.sanmarPieces} pcs · {q.styles} · {q.status} · {shortDate(q.createdAt)}
                      </div>
                    </div>
                    {added && <span className="text-xs text-green-700">on list</span>}
                  </li>
                );
              })}
            </ul>
            {quotes.length > 12 && (
              <button className="mt-2 text-sm underline text-admin-ink/80" onClick={() => setShowAllQuotes(!showAllQuotes)}>
                {showAllQuotes ? "Show fewer" : `Show more (${quotes.length})`}
              </button>
            )}
          </>
        )}
      </section>

      {/* ---- Search ---- */}
      <section className={card}>
        <h2 className="font-heading font-semibold uppercase tracking-wide mb-2">Add by style</h2>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            lookupStyle();
          }}
        >
          <input
            value={style}
            onChange={(e) => setStyle(e.target.value)}
            placeholder="Style number, e.g. PC54"
            className="flex-1 border border-admin-ink/20 rounded-xl px-3 py-1.5 bg-white text-sm uppercase"
          />
          <button className={`${btn} bg-admin-ink text-white`} type="submit">
            Look up
          </button>
        </form>
        {searchMsg && <p className="text-sm mt-2 text-admin-ink/80">{searchMsg}</p>}
        {search && (
          <div className="mt-3 space-y-3">
            <select
              value={searchColor}
              onChange={(e) => {
                setSearchColor(e.target.value);
                lookupStyle(e.target.value);
              }}
              className="border border-admin-ink/20 rounded-xl px-3 py-1.5 bg-white text-sm"
            >
              <option value="">Pick a color ({search.colors.length})</option>
              {search.colors.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            {search.color && (
              <>
                {!search.priced && <p className="text-xs text-amber-700">Live price unavailable right now — stock only.</p>}
                <div className="overflow-x-auto">
                  <table className="text-sm">
                    <thead className="text-xs text-admin-ink/60">
                      <tr>
                        <th className="text-left pr-4">Size</th>
                        <th className="text-right pr-4">Cost</th>
                        <th className="text-right pr-4">Dallas</th>
                        <th className="text-right pr-4">All</th>
                        <th className="text-left">Qty</th>
                      </tr>
                    </thead>
                    <tbody>
                      {search.sizes.map((s) => (
                        <tr key={s.size}>
                          <td className="pr-4 py-0.5 font-medium">{s.size}</td>
                          <td className="pr-4 text-right">{s.cost ? money(s.cost) : "—"}</td>
                          <td className="pr-4 text-right">{s.dallas}</td>
                          <td className="pr-4 text-right text-admin-ink/70">{s.total}</td>
                          <td>
                            <input
                              type="number"
                              min={0}
                              value={searchQty[s.size] ?? ""}
                              onChange={(e) => setSearchQty({ ...searchQty, [s.size]: e.target.value })}
                              className="w-16 border border-admin-ink/20 rounded-lg px-2 py-0.5 bg-white"
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <button className={`${btn} bg-admin-ink text-white`} disabled={busy} onClick={addSearched}>
                  Add to list
                </button>
              </>
            )}
          </div>
        )}
      </section>

      {/* ---- History ---- */}
      <section className={card}>
        <h2 className="font-heading font-semibold uppercase tracking-wide mb-2">Recent SanMar orders</h2>
        {historyError ? (
          <p className="text-sm text-red-700">{historyError}</p>
        ) : !history ? (
          <p className="text-sm text-admin-ink/70">Checking SanMar…</p>
        ) : history.length === 0 ? (
          <p className="text-sm text-admin-ink/70">No orders in the last 30 days.</p>
        ) : (
          <ul className="divide-y divide-admin-ink/10">
            {history.map((o) => {
              const t = tracking[o.salesOrder];
              return (
                <li key={o.salesOrder} className="py-2 text-sm">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="font-medium">SO-{o.salesOrder}</span>
                    <span className="text-admin-ink/70">{o.status}</span>
                    <span className="text-xs text-admin-ink/60">{shortDate(o.updatedAt)}</span>
                    {!t && (
                      <button className="text-xs underline ml-auto" onClick={() => loadTracking(o.salesOrder)}>
                        Tracking
                      </button>
                    )}
                  </div>
                  {t === "loading" && <p className="text-xs text-admin-ink/60 mt-1">Loading…</p>}
                  {t === "error" && <p className="text-xs text-red-700 mt-1">Couldn&apos;t get tracking.</p>}
                  {Array.isArray(t) &&
                    (t.length === 0 ? (
                      <p className="text-xs text-admin-ink/60 mt-1">No shipments yet.</p>
                    ) : (
                      <ul className="mt-1 space-y-0.5">
                        {t.map((s, idx) => (
                          <li key={idx} className="text-xs text-admin-ink/80">
                            {s.fromWarehouse} · {s.carrier} {s.service} · {shortDate(s.shipDate)} ·{" "}
                            {s.tracking.map((n) => (
                              <a key={n} href={trackingUrl(s.carrier, n)} target="_blank" rel="noopener noreferrer" className="underline mr-2">
                                {n}
                              </a>
                            ))}
                          </li>
                        ))}
                      </ul>
                    ))}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

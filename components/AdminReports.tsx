"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { SalesTaxReport } from "@/lib/sales-tax-report";

// Admin → Reports. Sales Tax: invoices dated in a range, split taxable /
// non-taxable, with tax collected — the numbers for the monthly Texas
// Comptroller sales tax filing.

type Preset = "this-month" | "last-month" | "this-quarter" | "last-quarter" | "this-year" | "custom";

const PRESETS: { id: Preset; label: string }[] = [
  { id: "this-month", label: "This month" },
  { id: "last-month", label: "Last month" },
  { id: "this-quarter", label: "This quarter" },
  { id: "last-quarter", label: "Last quarter" },
  { id: "this-year", label: "Year to date" },
  { id: "custom", label: "Custom" },
];

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function shopToday(): Date {
  const s = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function rangeFor(p: Exclude<Preset, "custom">): { from: string; to: string } {
  const t = shopToday();
  const y = t.getFullYear(), m = t.getMonth();
  const q = Math.floor(m / 3);
  switch (p) {
    case "this-month":
      return { from: ymd(new Date(y, m, 1)), to: ymd(new Date(y, m + 1, 0)) };
    case "last-month":
      return { from: ymd(new Date(y, m - 1, 1)), to: ymd(new Date(y, m, 0)) };
    case "this-quarter":
      return { from: ymd(new Date(y, q * 3, 1)), to: ymd(new Date(y, q * 3 + 3, 0)) };
    case "last-quarter":
      return { from: ymd(new Date(y, q * 3 - 3, 1)), to: ymd(new Date(y, q * 3, 0)) };
    case "this-year":
      return { from: ymd(new Date(y, 0, 1)), to: ymd(t) };
  }
}

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
const prettyDate = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { weekday: "short", month: "2-digit", day: "2-digit", year: "numeric" });
};

export default function AdminReports() {
  return (
    <div className="space-y-4">
      <div className="inline-flex rounded-xl bg-admin-card border border-admin-ink/10 p-1 shadow-sm">
        <span className="px-4 py-2 rounded-lg text-sm font-semibold bg-admin-accent text-admin-accent-ink">Sales Tax</span>
      </div>
      <SalesTaxReportView />
    </div>
  );
}

function SalesTaxReportView() {
  const [preset, setPreset] = useState<Preset>("last-month");
  const [range, setRange] = useState(() => rangeFor("last-month"));
  const [report, setReport] = useState<SalesTaxReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showRows, setShowRows] = useState(true);

  const valid = Boolean(range.from && range.to && range.from <= range.to);

  useEffect(() => {
    if (!valid) return;
    let cancelled = false;
    const t = setTimeout(() => {
      setLoading(true);
      setError(null);
      fetch(`/api/admin/reports/sales-tax?from=${range.from}&to=${range.to}`)
        .then(async (r) => {
          const j = await r.json();
          if (!r.ok) throw new Error(j.error || "Couldn't run the report.");
          return j as SalesTaxReport;
        })
        .then((j) => !cancelled && setReport(j))
        .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Couldn't run the report."))
        .finally(() => !cancelled && setLoading(false));
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [range.from, range.to, valid]);

  function pick(p: Preset) {
    setPreset(p);
    if (p !== "custom") setRange(rangeFor(p));
  }

  const csv = useMemo(() => {
    if (!report) return "";
    const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
    const head = ["Date", "Invoice", "Customer", "Tax rate %", "Total sales", "Taxable sales", "Non-taxable sales", "Tax collected", "Invoice total", "Payment status"];
    const lines = report.rows.map((r) =>
      [r.date, r.invoiceNumber, r.customer, r.taxRatePercent, r.totalSales, r.taxableSales, r.nonTaxableSales, r.taxCollected, r.invoiceTotal, r.paymentStatus].map(esc).join(",")
    );
    const t = report.totals;
    lines.push(["", "TOTAL", "", "", t.totalSales, t.taxableSales, t.nonTaxableSales, t.taxCollected, "", ""].map(esc).join(","));
    return [head.map(esc).join(","), ...lines].join("\n");
  }, [report]);

  function downloadCsv() {
    if (!report) return;
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `sales-tax-${report.from}-to-${report.to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const card = "rounded-xl bg-admin-card border border-admin-ink/10 shadow-sm";
  const t = report?.totals;

  return (
    <div className="space-y-4">
      {/* Range */}
      <div className={`${card} p-4 sm:p-5`}>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => pick(p.id)}
              className={`px-3.5 py-1.5 rounded-full text-sm border transition ${
                preset === p.id
                  ? "bg-admin-accent text-admin-accent-ink border-admin-accent font-semibold"
                  : "bg-admin-card border-admin-ink/15 text-admin-ink/70 hover:border-admin-ink/35"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="text-xs font-semibold text-admin-ink/60">
            From
            <input
              type="date"
              value={range.from}
              onChange={(e) => {
                setPreset("custom");
                setRange((r) => ({ ...r, from: e.target.value }));
              }}
              className="mt-1 block border border-admin-ink/20 rounded-lg px-3 py-2 text-sm text-admin-ink bg-admin-card"
            />
          </label>
          <label className="text-xs font-semibold text-admin-ink/60">
            To
            <input
              type="date"
              value={range.to}
              onChange={(e) => {
                setPreset("custom");
                setRange((r) => ({ ...r, to: e.target.value }));
              }}
              className="mt-1 block border border-admin-ink/20 rounded-lg px-3 py-2 text-sm text-admin-ink bg-admin-card"
            />
          </label>
          <div className="text-sm text-admin-ink/60 pb-2">
            {valid ? `${prettyDate(range.from)} — ${prettyDate(range.to)}` : "“From” must be on or before “To”."}
            {loading && <span className="ml-2 text-admin-ink/45">Running…</span>}
          </div>
          <div className="ml-auto flex gap-2">
            <button
              type="button"
              onClick={downloadCsv}
              disabled={!report}
              className="px-3.5 py-2 rounded-lg border border-admin-ink/15 text-sm font-semibold text-admin-ink hover:bg-admin-ink/5 disabled:opacity-50"
            >
              Download CSV
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              disabled={!report}
              className="px-3.5 py-2 rounded-lg border border-admin-ink/15 text-sm font-semibold text-admin-ink hover:bg-admin-ink/5 disabled:opacity-50"
            >
              Print
            </button>
          </div>
        </div>
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>}

      {/* Totals */}
      {t && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { label: "Total Sales", value: t.totalSales, note: `${t.invoices} invoice${t.invoices === 1 ? "" : "s"}` },
            { label: "Taxable Sales", value: t.taxableSales },
            { label: "Non-Taxable Sales", value: t.nonTaxableSales },
            { label: "Tax Collected", value: t.taxCollected, strong: true },
          ].map((k) => (
            <div key={k.label} className={`${card} p-4 sm:p-5 ${k.strong ? "ring-1 ring-admin-accent/30" : ""}`}>
              <div className="text-sm text-admin-ink/60">{k.label}</div>
              <div className={`mt-1 text-2xl sm:text-[28px] font-bold tracking-tight ${k.strong ? "text-admin-accent" : "text-admin-ink"}`}>
                {usd(k.value)}
              </div>
              {k.note && <div className="mt-0.5 text-xs text-admin-ink/50">{k.note}</div>}
            </div>
          ))}
        </div>
      )}

      {report && report.byRate.length > 0 && (
        <div className={`${card} p-4 sm:p-5`}>
          <div className="text-sm font-semibold text-admin-ink">By tax rate</div>
          <table className="mt-2 w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-admin-ink/50">
                <th className="py-1.5 font-semibold">Rate</th>
                <th className="py-1.5 font-semibold text-right">Invoices</th>
                <th className="py-1.5 font-semibold text-right">Taxable sales</th>
                <th className="py-1.5 font-semibold text-right">Tax collected</th>
              </tr>
            </thead>
            <tbody>
              {report.byRate.map((r) => (
                <tr key={r.ratePercent} className="border-t border-admin-ink/5">
                  <td className="py-1.5">{r.ratePercent}%</td>
                  <td className="py-1.5 text-right">{r.invoices}</td>
                  <td className="py-1.5 text-right">{usd(r.taxableSales)}</td>
                  <td className="py-1.5 text-right font-semibold">{usd(r.taxCollected)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Invoices */}
      {report && (
        <div className={card}>
          <button
            type="button"
            onClick={() => setShowRows((v) => !v)}
            className="w-full flex items-center justify-between px-4 sm:px-5 py-3.5 text-sm font-semibold text-admin-ink"
          >
            Invoices in this report ({report.rows.length})
            <span className="text-admin-ink/50">{showRows ? "Hide" : "Show"}</span>
          </button>
          {showRows &&
            (report.rows.length === 0 ? (
              <p className="px-5 pb-5 text-sm text-admin-ink/60">No invoices dated in this range.</p>
            ) : (
              <div className="overflow-x-auto border-t border-admin-ink/10">
                <table className="w-full text-sm min-w-[720px]">
                  <thead className="bg-admin-bg/60">
                    <tr className="text-left text-xs text-admin-ink/55">
                      <th className="px-4 py-2 font-semibold">Date</th>
                      <th className="px-2 py-2 font-semibold">Invoice</th>
                      <th className="px-2 py-2 font-semibold">Customer</th>
                      <th className="px-2 py-2 font-semibold text-right">Tax</th>
                      <th className="px-2 py-2 font-semibold text-right">Taxable</th>
                      <th className="px-2 py-2 font-semibold text-right">Non-taxable</th>
                      <th className="px-4 py-2 font-semibold text-right">Tax collected</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.rows.map((r) => (
                      <tr key={r.id} className="border-t border-admin-ink/5 hover:bg-admin-ink/[0.02]">
                        <td className="px-4 py-2 whitespace-nowrap text-admin-ink/70">{r.date.slice(5).replace("-", "/")}</td>
                        <td className="px-2 py-2 whitespace-nowrap">
                          <Link href={`/admin/quotes/${r.id}`} className="font-semibold text-admin-accent hover:underline">
                            {r.invoiceNumber}
                          </Link>
                        </td>
                        <td className="px-2 py-2 max-w-[220px] truncate">{r.customer}</td>
                        <td className="px-2 py-2 text-right text-admin-ink/60">{r.taxRatePercent > 0 ? `${r.taxRatePercent}%` : "Off"}</td>
                        <td className="px-2 py-2 text-right">{usd(r.taxableSales)}</td>
                        <td className="px-2 py-2 text-right">{usd(r.nonTaxableSales)}</td>
                        <td className="px-4 py-2 text-right font-semibold">{usd(r.taxCollected)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          {report.skipped.length > 0 && (
            <p className="px-5 py-3 border-t border-admin-ink/10 text-xs text-admin-ink/55">
              Not counted (no pricing saved): {report.skipped.map((s) => s.invoiceNumber).join(", ")}
            </p>
          )}
        </div>
      )}

      <p className="text-xs text-admin-ink/50">
        Counts invoices on this site by invoice date. Taxable = invoices with tax turned on (lines marked non-taxable excluded);
        everything else is non-taxable. Amounts are after discounts and before tax. Invoices still in ShopVox aren&apos;t included.
      </p>
    </div>
  );
}

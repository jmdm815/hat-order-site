import Link from "next/link";

// Shared list-row pieces: the quote/invoice number as a button-style link
// and the customer name with an initials badge (linking to the customer
// page when we know who it is). Both stop the click from also triggering
// the row's own click handler.

export function initials(name: string) {
  const words = name
    .replace(/\(.*?\)/g, " ")
    .replace(/[^A-Za-z0-9& ]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return "?";
  return (words.length === 1 ? words[0].slice(0, 2) : words[0][0] + words[1][0]).toUpperCase();
}

const BADGE_COLORS = [
  "bg-sky-100 text-sky-800",
  "bg-emerald-100 text-emerald-800",
  "bg-violet-100 text-violet-800",
  "bg-amber-100 text-amber-800",
  "bg-rose-100 text-rose-800",
  "bg-teal-100 text-teal-800",
  "bg-indigo-100 text-indigo-800",
];
function badgeColor(name: string) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return BADGE_COLORS[h % BADGE_COLORS.length];
}

export function DocNumberButton({ id, number, title }: { id: string; number: string; title?: string }) {
  return (
    <Link
      href={`/admin/quotes/${id}`}
      onClick={(e) => e.stopPropagation()}
      title={title ?? `Open ${number}`}
      className="inline-flex items-center px-2.5 py-1 rounded-lg border border-sky-200 bg-sky-50 text-sky-700 font-semibold text-[13px] tabular-nums hover:bg-sky-100 hover:border-sky-300 transition-colors"
    >
      {number}
    </Link>
  );
}

export function CustomerNameLink({ name, customerId }: { name: string; customerId?: string }) {
  const badge = (
    <span className={`grid place-items-center w-8 h-8 rounded-full text-[11px] font-bold shrink-0 ${badgeColor(name)}`} aria-hidden>
      {initials(name)}
    </span>
  );
  if (!customerId) {
    return (
      <span className="flex items-center gap-2.5 min-w-0">
        {badge}
        <span className="truncate font-medium text-admin-ink">{name}</span>
      </span>
    );
  }
  return (
    <Link
      href={`/admin/customers/${customerId}`}
      onClick={(e) => e.stopPropagation()}
      title={`Open ${name}'s customer page`}
      className="group flex items-center gap-2.5 min-w-0"
    >
      {badge}
      <span className="truncate font-medium text-admin-ink group-hover:underline">{name}</span>
    </Link>
  );
}

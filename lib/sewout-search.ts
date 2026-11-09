// Client-safe search helpers for the sewout library (no server imports), used
// by both /api/admin/sewouts?q= and the library page.

export type SearchableSewout = {
  customerName: string;
  designName: string;
  placement?: string;
  threadColors?: string;
  notes?: string;
  tags?: string;
};

// Typo-tolerant search shared by the API (for Claude / other callers) and the
// library page: every word in the query must match a word in the record —
// as a substring, a prefix, or within one typo for longer words. Apostrophes
// and punctuation are ignored, so "doziers bbq" finds "Dozier's BBQ".
export function normalizeSearch(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

function withinOneEdit(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else {
      i++;
      j++;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

export function sewoutSearchText(s: Pick<SearchableSewout, keyof SearchableSewout>) {
  return [s.customerName, s.designName, s.placement, s.threadColors, s.notes, s.tags].filter(Boolean).join(" ");
}

export function scoreSewout(record: Parameters<typeof sewoutSearchText>[0], query: string): number {
  const q = normalizeSearch(query);
  if (q.length === 0) return 1;
  const words = normalizeSearch(sewoutSearchText(record));
  const nameWords = new Set(normalizeSearch(`${record.customerName} ${record.designName}`));
  let score = 0;
  for (const t of q) {
    let best = 0;
    for (const w of words) {
      const s =
        w === t ? 3 : w.startsWith(t) ? 2.5 : w.includes(t) ? 2 : t.length >= 4 && withinOneEdit(t, w) ? 1.5 : 0;
      const boosted = s && nameWords.has(w) ? s + 1 : s;
      if (boosted > best) best = boosted;
    }
    if (best === 0) return 0;
    score += best;
  }
  return score;
}

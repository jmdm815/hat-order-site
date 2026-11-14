import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { getCustomers, replaceCustomers } from "@/lib/customers-store";
import { getQuotes, setQuoteCustomerId } from "@/lib/quotes-store";
import { splitCustomer } from "@/lib/customer-split";
import type { Customer, CustomerContact } from "@/lib/types";
import { v4 as uuid } from "uuid";

// Customer data cleanup tools (admin/agent only).
//
// POST { action: "split", apply?: boolean }
//   Split "Person(Company)" names into name = company + contactName = person.
//   Without apply: returns the plan only.
//
// POST { action: "merge", targetId, sourceIds: string[], apply?: boolean }
//   Fold other customer records into one: each source's primary contact and
//   extra contacts become contacts on the target, quotes linked to a source
//   move to the target, and the sources are removed.
export async function POST(req: NextRequest) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));

  if (body.action === "split") {
    const all = await getCustomers();
    const plan = all
      .map((c) => ({ c, s: splitCustomer(c) }))
      .filter((x): x is { c: Customer; s: { name: string; contactName: string } } => Boolean(x.s))
      .map(({ c, s }) => ({ id: c.id, before: c.name, name: s.name, contactName: s.contactName }));
    if (!body.apply) return NextResponse.json({ plan });
    const byId = new Map(plan.map((p) => [p.id, p]));
    const { persisted } = await replaceCustomers((cs) =>
      cs.map((c) => {
        const p = byId.get(c.id);
        if (!p || c.contactName) return c;
        return { ...c, name: p.name, contactName: p.contactName, company: undefined, updatedAt: new Date().toISOString() };
      })
    );
    return NextResponse.json({ applied: plan.length, persisted });
  }

  if (body.action === "merge") {
    // One merge ({targetId, sourceIds}) or several ({merges: [...]}) — all
    // applied in a single save so nothing can be undone by a stale read.
    const merges: { targetId: string; sourceIds: string[] }[] = (
      Array.isArray(body.merges) ? body.merges : [{ targetId: body.targetId, sourceIds: body.sourceIds }]
    ).map((m: { targetId?: unknown; sourceIds?: unknown }) => ({
      targetId: String(m.targetId ?? ""),
      sourceIds: (Array.isArray(m.sourceIds) ? m.sourceIds : []).map(String).filter((id: string) => id !== String(m.targetId)),
    }));
    const n = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
    // A source with no person's name whose name is just the company again
    // ("HOLY ROSARY CATHOLIC SCHOOL" into "Holy Rosary"): name the contact
    // from the email instead ("cvega@…" -> "Cvega").
    const personName = (c: Customer, target: Customer) => {
      if (c.contactName) return c.contactName;
      const sameCompany = n(c.name).includes(n(target.name)) || n(target.name).includes(n(c.name));
      if (sameCompany && c.email) {
        return c.email
          .split("@")[0]
          .split(/[._-]+/)
          .filter(Boolean)
          .map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase())
          .join(" ");
      }
      return c.name;
    };
    const plan = (all: Customer[]) =>
      merges.map(({ targetId, sourceIds }) => {
        const target = all.find((c) => c.id === targetId);
        const sources = sourceIds.map((id) => all.find((c) => c.id === id)).filter((c): c is Customer => Boolean(c));
        if (!target) return { targetId, sourceIds, target: undefined, added: [] as CustomerContact[], sources };
        const existingEmails = new Set(
          [target.email, ...(target.contacts ?? []).map((x) => x.email)].filter(Boolean).map((e) => e!.toLowerCase())
        );
        const added = sources
          .flatMap((c): CustomerContact[] => [
            { id: uuid(), name: personName(c, target), email: c.email, phone: c.phone, notes: c.notes },
            ...(c.contacts ?? []),
          ])
          .filter((ct) => !(ct.email && existingEmails.has(ct.email.toLowerCase())) && ct.name !== (target.contactName || target.name));
        return { targetId, sourceIds, target, added, sources };
      });
    const describe = (p: ReturnType<typeof plan>) =>
      p.map((m) => ({
        target: m.target?.name ?? `missing ${m.targetId}`,
        addContacts: m.added.map((a) => `${a.name}${a.email ? ` <${a.email}>` : ""}`),
        remove: m.sources.map((x) => x.name),
      }));
    if (!body.apply) return NextResponse.json({ preview: describe(plan(await getCustomers())) });
    let applied: ReturnType<typeof plan> = [];
    const { persisted } = await replaceCustomers((cs) => {
      applied = plan(cs).filter((m) => m.target && m.sources.length);
      const remove = new Set(applied.flatMap((m) => m.sources.map((x) => x.id)));
      const addTo = new Map(applied.map((m) => [m.targetId, m.added]));
      return cs
        .filter((c) => !remove.has(c.id))
        .map((c) =>
          addTo.has(c.id) ? { ...c, contacts: [...(c.contacts ?? []), ...addTo.get(c.id)!], updatedAt: new Date().toISOString() } : c
        );
    });
    // Quotes explicitly linked to a removed source now point at its target.
    const moveTo = new Map(applied.flatMap((m) => m.sources.map((x) => [x.id, m.targetId] as const)));
    let relinked = 0;
    for (const r of await getQuotes()) {
      const to = r.input.customerId && moveTo.get(r.input.customerId);
      if (to) {
        await setQuoteCustomerId(r.id, to);
        relinked++;
      }
    }
    return NextResponse.json({ merged: describe(applied), relinked, persisted });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}

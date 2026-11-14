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
    const targetId = String(body.targetId ?? "");
    const sourceIds: string[] = Array.isArray(body.sourceIds) ? body.sourceIds.map(String).filter((id: string) => id !== targetId) : [];
    const all = await getCustomers();
    const target = all.find((c) => c.id === targetId);
    const sources = sourceIds.map((id) => all.find((c) => c.id === id)).filter((c): c is Customer => Boolean(c));
    if (!target || !sources.length) return NextResponse.json({ error: "Target or sources not found" }, { status: 404 });
    const n = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
    // A source with no person's name whose name is just the company again
    // ("HOLY ROSARY CATHOLIC SCHOOL" into "Holy Rosary"): name the contact
    // from the email instead ("cvega@…" -> "Cvega").
    const personName = (c: Customer) => {
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
    const asContacts = (c: Customer): CustomerContact[] => [
      {
        id: uuid(),
        name: personName(c),
        email: c.email,
        phone: c.phone,
        notes: c.notes,
      },
      ...(c.contacts ?? []),
    ];
    const existingEmails = new Set(
      [target.email, ...(target.contacts ?? []).map((x) => x.email)].filter(Boolean).map((e) => e!.toLowerCase())
    );
    const added = sources
      .flatMap(asContacts)
      .filter((ct) => !(ct.email && existingEmails.has(ct.email.toLowerCase())) && !(ct.name === (target.contactName || target.name)));
    const preview = { target: target.name, addContacts: added.map((a) => `${a.name}${a.email ? ` <${a.email}>` : ""}`), remove: sources.map((s) => s.name) };
    if (!body.apply) return NextResponse.json({ preview });
    const { persisted } = await replaceCustomers((cs) =>
      cs
        .filter((c) => !sourceIds.includes(c.id))
        .map((c) =>
          c.id === targetId
            ? { ...c, contacts: [...(c.contacts ?? []), ...added], updatedAt: new Date().toISOString() }
            : c
        )
    );
    // Quotes explicitly linked to a removed source now point at the target.
    let relinked = 0;
    for (const r of await getQuotes()) {
      if (r.input.customerId && sourceIds.includes(r.input.customerId)) {
        await setQuoteCustomerId(r.id, targetId);
        relinked++;
      }
    }
    return NextResponse.json({ ...preview, relinked, persisted });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}

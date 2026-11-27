import { NextRequest, NextResponse } from "next/server";
import { verifyConnectorKey } from "@/lib/connector-key-store";
import { signPdfLink, type PdfMode } from "@/lib/pdf-link";

// ---------------------------------------------------------------------------
// JM Admin connector (MCP over Streamable HTTP, stateless JSON responses)
// ---------------------------------------------------------------------------
// Added to Claude as a custom connector with the URL from /admin/connector
// (…/api/mcp?key=…). Each tool is a thin wrapper over an existing admin API
// route, called on this same deployment with the server-side AGENT_API_KEY,
// so quotes priced here are exactly what the Quote Builder would produce and
// every rule those routes enforce (unconfirmed SanMar cost, email checks,
// duplicate guards) still applies. The connector key itself never grants
// more than these tools.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const maxDuration = 60;

const SERVER_INFO = { name: "jm-admin", title: "JM Admin", version: "1.0.0" };
const SUPPORTED_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

type Json = Record<string, unknown>;
type Ctx = { origin: string };
type Tool = {
  name: string;
  title: string;
  description: string;
  inputSchema: Json;
  annotations: Json;
  run: (args: Json, ctx: Ctx) => Promise<unknown>;
};

class ToolError extends Error {}

// ------------------------------------------------------------------ helpers

async function admin(ctx: Ctx, path: string, init?: { method?: string; body?: unknown }) {
  const res = await fetch(`${ctx.origin}${path}`, {
    method: init?.method ?? "GET",
    headers: {
      Authorization: `Bearer ${process.env.AGENT_API_KEY}`,
      ...(init?.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ToolError((data as Json).error ? String((data as Json).error) : `Admin request failed (${res.status})`);
  return data as Json;
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const lc = (v: unknown) => str(v).toLowerCase();
const round = (n: unknown) => (typeof n === "number" ? Math.round(n * 100) / 100 : n);

function summarizeComputed(c: Json | undefined) {
  if (!c) return undefined;
  const lines = (c.lines as Json[] | undefined) ?? [];
  return {
    lines: lines.map((l) => ({
      item: [l.styleNumber, l.productName, l.colorName].filter(Boolean).join(" · ") || l.itemDescription,
      decoration: [l.decorationLabel, l.priceColumnLabel].filter(Boolean).join(", ") || undefined,
      sizes: ((l.sizes as Json[]) ?? []).map((s) => ({ size: s.size, qty: s.quantity, unitPrice: round(s.unitPrice), total: round(s.lineTotal) })),
      quantity: l.quantity,
      subtotal: round(l.subtotal),
      optional: l.optional || undefined,
    })),
    setupCharges: ((c.setupCharges as Json[]) ?? []).map((s) => ({ label: s.label ?? s.name, price: round(s.price) })),
    miscFees: ((c.miscFees as Json[]) ?? []).map((m) => ({ label: m.label, total: round(m.lineTotal) })),
    totalQuantity: c.totalQuantity,
    subtotalBeforeTax: round(c.subtotalBeforeTax),
    discount: round(c.discountAmount),
    taxRatePercent: c.taxRatePercent,
    tax: round(c.taxAmount),
    grandTotal: round(c.grandTotal),
    depositPercent: c.depositPercent,
  };
}

function summarizeRecord(r: Json, ctx: Ctx, full = false) {
  const input = (r.input as Json) ?? {};
  const computed = r.computed as Json | undefined;
  return {
    id: r.id,
    number: r.invoiceNumber ?? r.quoteNumber ?? (r.potential ? "Potential quote" : undefined),
    status: r.potential ? "potential" : r.status,
    invoiceStatus: r.invoiceStatus,
    customer: [input.customerName, input.customerCompany].filter(Boolean).join(" / ") || undefined,
    customerEmail: input.customerEmail,
    customerId: input.customerId,
    date: input.quoteDate ?? r.createdAt,
    grandTotal: round(computed?.grandTotal),
    amountPaid: round(r.amountPaid),
    archived: r.archivedAt ? true : undefined,
    payPageUrl: `${ctx.origin}/pay/${r.id}`,
    adminUrl: `${ctx.origin}/admin?tab=${r.status === "invoice" ? "invoices" : "quotes"}`,
    ...(full ? { details: summarizeComputed(computed), customerNotes: input.customerNotes, internalNotes: input.notes, input } : {}),
  };
}

async function findRecord(ctx: Ctx, idOrNumber: string): Promise<Json> {
  const want = idOrNumber.trim();
  if (!want) throw new ToolError("Give a quote id or number.");
  const { quotes } = await admin(ctx, "/api/admin/quotes");
  const match = (quotes as Json[]).find(
    (q) => q.id === want || lc(q.quoteNumber) === want.toLowerCase() || lc(q.invoiceNumber) === want.toLowerCase()
  );
  if (!match) throw new ToolError(`No quote or invoice "${want}".`);
  return match;
}

const QUOTE_INPUT_DOC = `Quote input object (same as the admin Quote Builder):
{
  customerId?, customerName?, customerCompany?, customerEmail?  (use search_customers first and pass customerId when the customer exists),
  lines: [{
    styleNumber: "ST640", catalogSource?: "sanmar" (default) | "ss" | "pitbull" | "custom" | "customer-supplied",
    colorName: "Black"  (exact color name from get_product),
    sizes: [{ size: "L", quantity: 5 }],
    decorationId?: "embroidered" | "screen-print" | "uv-patch" | ...  (ids from get_product),
    priceColumnId?: e.g. "stitch-0-12000"  (the decoration's price column, e.g. stitch band),
    personalization?: string, optional?: boolean, lineItem?: number,
    customerSupplied?: true + itemDescription + itemType ("apparel"|"hat"|"other") for items the customer brings in
  }],
  setupChargeIds?: string[], miscFees?: [{ label, amount, quantity?, taxable? }],
  taxRatePercent?: number (8.25 is Rosenberg, TX; 0 for resale/exempt),
  depositPercent?: 1-100, militaryDiscount?: boolean, netTermsDays?: number,
  showPaymentLink?: true  (put the "Pay online" button + QR on a QUOTE's PDF and email; invoices always have it),
  customerNotes?: string (printed on the PDF), notes?: string (internal only, never on customer PDFs),
  dueDate?: "YYYY-MM-DD"
}
Prices are computed server-side from the live SanMar account cost, the garment markup table and the decoration price grids. Never pass made-up prices; only use the size-level priceOverride or decorationUnitPriceOverride when Jhairson gives a specific price.`;

// ------------------------------------------------------------------ tools

const TOOLS: Tool[] = [
  {
    name: "search_customers",
    title: "Search customers",
    description: "Find saved customers by name, company, contact, email or phone. Returns ids to use in quotes.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string", description: "Part of a name, company, email or phone." } },
      required: ["query"],
    },
    annotations: { readOnlyHint: true },
    run: async (a, ctx) => {
      const q = lc(a.query).replace(/[^\p{L}\p{N}@. ]/gu, "");
      const digits = q.replace(/\D/g, "");
      const { customers } = await admin(ctx, "/api/admin/customers");
      const hits = (customers as Json[]).filter((c) => {
        const hay = JSON.stringify([c.name, c.contactName, c.company, c.email, c.contacts]).toLowerCase();
        const phone = String(c.phone ?? "").replace(/\D/g, "");
        return (q && hay.includes(q)) || (digits.length >= 7 && phone.includes(digits));
      });
      return {
        count: hits.length,
        customers: hits.slice(0, 25).map((c) => ({
          id: c.id,
          name: c.name,
          contactName: c.contactName,
          company: c.company,
          email: c.email,
          phone: c.phone,
          defaultDepositPercent: c.defaultDepositPercent,
          notes: c.notes,
        })),
      };
    },
  },
  {
    name: "create_customer",
    title: "Add a customer",
    description: "Save a new customer in the admin. Search first so you don't make a duplicate.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Company name, or the person's name for an individual." },
        contactName: { type: "string" },
        email: { type: "string" },
        phone: { type: "string" },
        notes: { type: "string" },
      },
      required: ["name"],
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
    run: async (a, ctx) => {
      const { customer } = await admin(ctx, "/api/admin/customers", { method: "POST", body: a });
      return { customer };
    },
  },
  {
    name: "get_product",
    title: "Look up a product",
    description:
      "Colors, sizes, stock and selling price (live SanMar account cost already marked up with the garment markup table) for a style number, plus the decorations available on it with their price grids and price column ids.",
    inputSchema: {
      type: "object",
      properties: { styleNumber: { type: "string", description: "e.g. ST640, PC54, 112" } },
      required: ["styleNumber"],
    },
    annotations: { readOnlyHint: true },
    run: async (a, ctx) => {
      const style = encodeURIComponent(str(a.styleNumber).toUpperCase());
      const res = await fetch(`${ctx.origin}/api/products/${style}`, { cache: "no-store" });
      const data = (await res.json().catch(() => ({}))) as Json;
      if (!res.ok) throw new ToolError(String(data.error ?? `Product lookup failed (${res.status})`));
      const p = data.product as Json;
      return {
        styleNumber: p.styleNumber,
        name: p.productName,
        brand: p.brandName,
        type: p.productType,
        livePricing: data.livePricingApplied === true,
        colors: ((p.colors as Json[]) ?? []).map((c) => ({
          color: c.colorName,
          sizes: ((c.sizes as Json[]) ?? []).map((s) => ({ size: s.name, price: s.price, stock: s.inventory })),
        })),
        decorations: ((data.decorations as Json[]) ?? []).map((d) => ({
          id: d.id,
          label: d.label,
          setupFee: d.setupFeeEnabled ? d.setupFee : 0,
          quoteRequired: d.quoteRequired,
          priceColumns: d.priceColumns,
          tiers: d.pricingTiers,
          placements: ((d.zones as Json[]) ?? []).map((z) => z.label),
        })),
      };
    },
  },
  {
    name: "list_setup_charges",
    title: "List setup charges",
    description: "The admin's setup charges (digitizing, screens, etc.) with ids for a quote's setupChargeIds.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
    run: async (_a, ctx) => admin(ctx, "/api/admin/setup-charges"),
  },
  {
    name: "list_quotes",
    title: "List quotes and invoices",
    description: "Recent quotes, invoices and potential quotes, newest first. Filter by customer text or status.",
    inputSchema: {
      type: "object",
      properties: {
        customer: { type: "string", description: "Part of the customer name, company or email." },
        customerId: { type: "string" },
        status: { type: "string", enum: ["quote", "invoice", "potential", "unpaid", "all"] },
        includeArchived: { type: "boolean" },
        limit: { type: "number", description: "Default 20, max 100." },
      },
    },
    annotations: { readOnlyHint: true },
    run: async (a, ctx) => {
      const { quotes } = await admin(ctx, "/api/admin/quotes");
      const want = lc(a.customer);
      const status = str(a.status) || "all";
      const limit = Math.min(100, Math.max(1, Number(a.limit) || 20));
      const rows = (quotes as Json[]).filter((q) => {
        const input = (q.input as Json) ?? {};
        if (q.archivedAt && !a.includeArchived) return false;
        if (a.customerId && input.customerId !== a.customerId) return false;
        if (want && !JSON.stringify([input.customerName, input.customerCompany, input.customerEmail]).toLowerCase().includes(want)) return false;
        if (status === "potential") return q.potential === true;
        if (status === "quote") return q.status === "quote" && !q.potential;
        if (status === "invoice") return q.status === "invoice";
        if (status === "unpaid") return q.status === "invoice" && q.invoiceStatus !== "paid";
        return true;
      });
      return { count: rows.length, records: rows.slice(0, limit).map((q) => summarizeRecord(q, ctx)) };
    },
  },
  {
    name: "get_quote",
    title: "Get a quote or invoice",
    description: "Full detail of one quote or invoice by id or number (e.g. QT-1042, INV-1043): lines, prices, totals, notes, pay page link and the stored input (to edit and pass to update_quote).",
    inputSchema: { type: "object", properties: { id: { type: "string", description: "Record id or number." } }, required: ["id"] },
    annotations: { readOnlyHint: true },
    run: async (a, ctx) => summarizeRecord(await findRecord(ctx, str(a.id)), ctx, true),
  },
  {
    name: "get_quote_pdf",
    title: "Get a quote or invoice PDF",
    description:
      'A private download link (valid 15 minutes) to the PDF of a quote or invoice, by id or number. mode: "customer" (default, what the customer gets), "invoice" (converted records), "internal" (with costs and internal notes; never send it to a customer) or "work-order" (production copy). Download it and show it to Jhairson; do not share the link with customers.',
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Record id or number." },
        mode: { type: "string", enum: ["customer", "invoice", "internal", "work-order"] },
      },
      required: ["id"],
    },
    annotations: { readOnlyHint: true },
    run: async (a, ctx) => {
      const rec = await findRecord(ctx, str(a.id));
      const asked = str(a.mode);
      const mode: PdfMode =
        asked === "internal" || asked === "work-order"
          ? asked
          : asked === "invoice" || (!asked && rec.status === "invoice")
            ? rec.status === "invoice"
              ? "invoice"
              : "customer"
            : "customer";
      const link = signPdfLink(ctx.origin, String(rec.id), mode);
      if (!link) throw new ToolError("AGENT_API_KEY isn't set, so PDF links can't be made.");
      const number = rec.invoiceNumber ?? rec.quoteNumber ?? "quote";
      return { number, mode, url: link.url, expiresAt: link.expiresAt, filename: `${number}${mode === "customer" || mode === "invoice" ? "" : `-${mode}`}.pdf` };
    },
  },
  {
    name: "preview_quote",
    title: "Price a quote (no save)",
    description: `Compute prices and totals for a quote without saving anything. Use this to check numbers before create_quote.\n\n${QUOTE_INPUT_DOC}`,
    inputSchema: { type: "object", properties: { input: { type: "object", description: "Quote input object." } }, required: ["input"] },
    annotations: { readOnlyHint: true },
    run: async (a, ctx) => {
      const { quote } = await admin(ctx, "/api/admin/quote", { method: "POST", body: a.input });
      const q = quote as Json;
      const unconfirmed = ((q.lines as Json[]) ?? [])
        .filter((l) => ((l.sizes as Json[]) ?? []).some((s) => s.costSource === "catalog"))
        .map((l) => l.styleNumber);
      return { ...summarizeComputed(q), ...(unconfirmed.length ? { warning: `Live SanMar cost not confirmed for ${unconfirmed.join(", ")}.` } : {}) };
    },
  },
  {
    name: "create_quote",
    title: "Save a quote or invoice",
    description: `Save a new quote (default) or invoice in the admin. It gets a number, a PDF and a pay page. Set potential: true to save it to Potential Quotes instead of the Quotes list (for quotes drafted from emails that Jhairson hasn't reviewed).\n\n${QUOTE_INPUT_DOC}`,
    inputSchema: {
      type: "object",
      properties: {
        input: { type: "object", description: "Quote input object." },
        kind: { type: "string", enum: ["quote", "invoice"] },
        potential: { type: "boolean" },
      },
      required: ["input"],
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
    run: async (a, ctx) => {
      const body = { ...(a.input as Json), kind: a.kind === "invoice" ? "invoice" : "quote", potential: a.potential === true };
      const { record, duplicate } = await admin(ctx, "/api/admin/quotes", { method: "POST", body });
      return { saved: true, duplicate: duplicate || undefined, ...summarizeRecord(record as Json, ctx, true) };
    },
  },
  {
    name: "update_quote",
    title: "Change a quote or invoice",
    description: `Replace the content of an existing quote or invoice (get_quote returns its current input; change it and send the whole object back). Prices are recomputed.\n\n${QUOTE_INPUT_DOC}`,
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" }, input: { type: "object" } },
      required: ["id", "input"],
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
    run: async (a, ctx) => {
      const rec = await findRecord(ctx, str(a.id));
      const { record } = await admin(ctx, `/api/admin/quotes/${rec.id}`, { method: "PUT", body: a.input });
      return { updated: true, ...summarizeRecord(record as Json, ctx, true) };
    },
  },
  {
    name: "convert_to_invoice",
    title: "Turn a quote into an invoice",
    description: "Convert an accepted quote into an invoice (the quote is archived, not deleted).",
    inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    annotations: { readOnlyHint: false, destructiveHint: false },
    run: async (a, ctx) => {
      const rec = await findRecord(ctx, str(a.id));
      const data = await admin(ctx, `/api/admin/quotes/${rec.id}/convert`, { method: "POST", body: {} });
      const inv = (data.invoice ?? data.record) as Json | undefined;
      return inv ? { converted: true, ...summarizeRecord(inv, ctx) } : { converted: true };
    },
  },
  {
    name: "email_quote",
    title: "Email a quote or invoice",
    description:
      "Email the customer PDF of a quote or invoice, with its pay page link, from JM Digital Media. This sends a real email: only call it when Jhairson has explicitly asked to send it to these addresses.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Record id or number." },
        emails: { type: "array", items: { type: "string" }, description: "Recipient addresses." },
      },
      required: ["id", "emails"],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    run: async (a, ctx) => {
      const rec = await findRecord(ctx, str(a.id));
      const emails = Array.isArray(a.emails) ? a.emails.map(String) : [];
      await admin(ctx, `/api/admin/quotes/${rec.id}/send`, { method: "POST", body: { emails } });
      return { sent: true, to: emails, number: rec.invoiceNumber ?? rec.quoteNumber, payPageUrl: `${ctx.origin}/pay/${rec.id}` };
    },
  },
];

const toolByName = new Map(TOOLS.map((t) => [t.name, t]));

// ------------------------------------------------------------------ JSON-RPC

type RpcReq = { jsonrpc: "2.0"; id?: string | number | null; method: string; params?: Json };

async function handle(msg: RpcReq, ctx: Ctx): Promise<Json | null> {
  const isNotification = msg.id === undefined || msg.id === null;
  const ok = (result: unknown) => ({ jsonrpc: "2.0", id: msg.id, result });
  const err = (code: number, message: string) => ({ jsonrpc: "2.0", id: msg.id ?? null, error: { code, message } });

  switch (msg.method) {
    case "initialize": {
      const asked = str(msg.params?.protocolVersion);
      return ok({
        protocolVersion: SUPPORTED_VERSIONS.includes(asked) ? asked : SUPPORTED_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions:
          "JM Media's admin (quotes, invoices, customers, products). Look up the customer and product first, price with preview_quote, then save with create_quote. Never email a customer unless Jhairson explicitly asks to send it.",
      });
    }
    case "ping":
      return ok({});
    case "tools/list":
      return ok({
        tools: TOOLS.map(({ name, title, description, inputSchema, annotations }) => ({ name, title, description, inputSchema, annotations })),
      });
    case "tools/call": {
      const tool = toolByName.get(str(msg.params?.name));
      if (!tool) return err(-32602, `Unknown tool: ${str(msg.params?.name)}`);
      try {
        const result = await tool.run((msg.params?.arguments as Json) ?? {}, ctx);
        return ok({ content: [{ type: "text", text: JSON.stringify(result, null, 1) }], structuredContent: result });
      } catch (e) {
        const message = e instanceof ToolError ? e.message : "Something went wrong in the admin.";
        if (!(e instanceof ToolError)) console.error(`mcp tool ${tool.name} failed`, e);
        return ok({ content: [{ type: "text", text: message }], isError: true });
      }
    }
    default:
      if (isNotification) return null;
      return err(-32601, `Method not found: ${msg.method}`);
  }
}

function unauthorized() {
  return NextResponse.json(
    { jsonrpc: "2.0", id: null, error: { code: -32001, message: "Connector key missing or turned off. Make a new link at /admin/connector." } },
    { status: 401 }
  );
}

export async function POST(req: NextRequest) {
  const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const key = req.nextUrl.searchParams.get("key") || bearer;
  if (!(await verifyConnectorKey(key))) return unauthorized();
  if (!process.env.AGENT_API_KEY) {
    return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32002, message: "AGENT_API_KEY isn't set." } }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, { status: 400 });
  }

  const ctx: Ctx = { origin: req.nextUrl.origin };
  const messages = (Array.isArray(body) ? body : [body]) as RpcReq[];
  const replies = (await Promise.all(messages.map((m) => handle(m, ctx)))).filter(Boolean);
  if (replies.length === 0) return new NextResponse(null, { status: 202 });
  return NextResponse.json(Array.isArray(body) ? replies : replies[0]);
}

// No server-initiated stream in this stateless server.
export function GET() {
  return new NextResponse(null, { status: 405, headers: { Allow: "POST" } });
}

export function DELETE() {
  return new NextResponse(null, { status: 405, headers: { Allow: "POST" } });
}

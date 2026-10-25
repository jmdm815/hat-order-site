"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ComputedQuote, QuoteLineInput, QuoteSizeInput } from "@/lib/quote";
import { QuoteRecord } from "@/lib/quotes-store";
import { DecorationOption, SetupChargeType, PaymentTermOption, TaxRateOption } from "@/lib/types";
import { formatUSD } from "@/lib/pricing";
import { ManualQuoteProduct, ManualQuoteSizeRow } from "@/app/api/admin/quote/manual-product/route";
import { ManualQuoteSearchResult } from "@/app/api/admin/quote/search-products/route";
import { Customer } from "@/lib/types";
import { productPreviewImageUrl } from "@/lib/product-image";
import AdminSendDocumentModal from "./AdminSendDocumentModal";

type CatalogSource = "sanmar" | "custom" | "ss" | "customer-supplied";
const CATALOG_OPTIONS: { id: CatalogSource; label: string; disabled?: boolean }[] = [
  { id: "sanmar", label: "SanMar" },
  { id: "ss", label: "S&S Activewear" },
  { id: "custom", label: "Custom" },
  { id: "customer-supplied", label: "Customer-Supplied Item" },
];

export type PendingLine = QuoteLineInput & {
  key: string;
  brandName: string;
  productName: string;
  // Thumbnail for this exact color, carried over from the product/color
  // picker (see ManualQuoteColor.imageUrl) so the "Quote lines" list can
  // show a photo per line, mirroring the reference quoting tool — not
  // persisted with the saved quote record, so it's only present for lines
  // added this session, not ones loaded back from a saved quote.
  imageUrl?: string;
  imageFallbackUrl?: string;
};

// A one-off, ad-hoc charge added directly to this quote — e.g. a rush fee
// or a shipping surcharge. Distinct from Setup Charges (lib/types.ts's
// SetupChargeType), which are a named, reusable charge type managed on the
// "Setup Charges" tab; a misc fee only exists on this one quote. See
// lib/quote.ts's QuoteInput.miscFees.
type PendingMiscFee = {
  id: string;
  label: string;
  amount: number; // per-unit price
  quantity: number; // multiplies amount — e.g. a $0.35 polymailer x 50
  taxable: boolean;
};

type PdfMode = "customer" | "internal" | "work-order" | "invoice";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

// Remembers the Item Markup hide/show toggle across refreshes and across
// remounts (switching which saved quote is loaded remounts this component —
// see Props' comment on initialRecord) so it stays wherever the admin last
// left it, rather than always coming back on. Scoped to this browser/device
// only (localStorage), which is fine here — it's a UI preference, not data.
const SHOW_MARKUP_STORAGE_KEY = "admin-quote-builder-show-markup";

// A garment color with no per-size pricing (e.g. a one-size hat like
// Richardson 112) has an empty `sizes` array from the catalog — there's
// nothing to build a SizeGrid out of. This is the synthetic size key used
// for a plain quantity input in that case instead. computeQuote (lib/quote.ts)
// looks up `color.sizes?.find((sz) => sz.name === s.size)` and falls back to
// the product's base price whenever that lookup misses, so this label is
// purely cosmetic for pricing purposes — it just has to be a non-empty,
// stable string so the line round-trips through save/reload correctly.
const ONE_SIZE_LABEL = "One Size";

function loadShowMarkup(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const stored = window.localStorage.getItem(SHOW_MARKUP_STORAGE_KEY);
    return stored === null ? true : stored === "true";
  } catch {
    return true;
  }
}

type Props = {
  // A previously saved quote/invoice to load into the builder for editing
  // (see AdminSavedQuotesList's "Edit" action, wired up in AdminQuotesTab).
  // The parent renders this component with `key={initialRecord?.id ?? "new"}`
  // so switching which record is being edited remounts the builder with
  // fresh initial state, rather than mutating state from a prop change.
  initialRecord?: QuoteRecord | null;
  // Called after a successful save/update so a parent can refresh its
  // saved-quotes list and keep track of which record is now active.
  onSaved?: (record: QuoteRecord) => void;
  // "quick" powers the Quick Quote tab (components/AdminQuickQuoteTab.tsx) —
  // a fast price check with no customer/date/notes/payment-terms fields and
  // no save/convert/PDF actions. Instead of saving, it offers a single
  // "Create quote" button (onCreateQuote) that hands the admin's in-progress
  // lines + setup charges to the full Quotes tab so they can add customer
  // info and save for real. Defaults to "full", the original behavior.
  mode?: "full" | "quick";
  // Seeds a brand-new (unsaved) builder with lines/setup charges carried
  // over from a Quick Quote — ignored once initialRecord is set, since
  // editing a saved record always wins. See AdminQuotesTab's `seed` prop.
  initialLines?: PendingLine[];
  initialSetupChargeIds?: string[];
  // mode "quick" only: called with the current lines + setup charges when
  // the admin taps "Create quote" after a customer decides to order.
  onCreateQuote?: (lines: PendingLine[], setupChargeIds: string[]) => void;
  // Brand-new record only (ignored once initialRecord is set): whether the
  // first save creates a plain quote (the default) or an invoice directly —
  // see AdminQuotesTab's "+ New invoice" button and
  // app/admin/quotes/new/page.tsx's ?kind=invoice.
  createAs?: "quote" | "invoice";
};

function linesFromRecord(record: QuoteRecord): PendingLine[] {
  return record.input.lines.map((l, i) => {
    const computedLine = record.computed.lines[i];
    return {
      key: `${l.customerSupplied ? "cs" : l.styleNumber}-${l.colorName ?? ""}-${i}-${Date.now()}`,
      styleNumber: l.styleNumber,
      colorName: l.colorName,
      sizes: l.sizes,
      decorationId: l.decorationId,
      priceColumnId: l.priceColumnId,
      customerSupplied: l.customerSupplied,
      itemDescription: l.itemDescription,
      taxable: l.taxable ?? true,
      brandName: computedLine?.brandName ?? "",
      productName: computedLine?.productName ?? "",
    };
  });
}

export default function AdminQuoteBuilder({
  initialRecord,
  onSaved,
  mode = "full",
  initialLines,
  initialSetupChargeIds,
  onCreateQuote,
  createAs = "quote",
}: Props) {
  const router = useRouter();
  const [decorations, setDecorations] = useState<DecorationOption[]>([]);
  const [decorationsLoaded, setDecorationsLoaded] = useState(false);
  const [setupCharges, setSetupCharges] = useState<SetupChargeType[]>([]);
  const [selectedSetupChargeIds, setSelectedSetupChargeIds] = useState<string[]>(
    () => initialRecord?.input.setupChargeIds ?? initialSetupChargeIds ?? []
  );
  // Dropdown picker for setup charges — replaces the old always-expanded
  // checkbox block. The dropdown also doubles as a lightweight editor for
  // the shared Setup Charges catalog (edit/delete any charge, or add a new
  // custom one) right from the quote builder, instead of needing to jump to
  // the separate "Setup Charges" admin tab — see lib/setup-charges-store.ts.
  const [setupDropdownOpen, setSetupDropdownOpen] = useState(false);
  const setupDropdownRef = useRef<HTMLDivElement | null>(null);
  const [editingChargeId, setEditingChargeId] = useState<string | null>(null);
  const [chargeEditDraft, setChargeEditDraft] = useState<{ label: string; price: number; taxable: boolean }>({
    label: "",
    price: 0,
    taxable: true,
  });
  const [creatingCharge, setCreatingCharge] = useState(false);
  const [newChargeDraft, setNewChargeDraft] = useState<{ label: string; price: number; taxable: boolean }>({
    label: "",
    price: 0,
    taxable: true,
  });
  const [chargeBusyId, setChargeBusyId] = useState<string | null>(null);
  const [chargeError, setChargeError] = useState<string | null>(null);

  // Ad-hoc miscellaneous fees — see PendingMiscFee above. Only surfaced in
  // "full" mode (Quick Quote has no save/customer-info step either, so it
  // doesn't carry these over).
  const [miscFees, setMiscFees] = useState<PendingMiscFee[]>(
    () =>
      initialRecord?.input.miscFees?.map((f, i) => ({
        id: `misc-initial-${i}`,
        label: f.label,
        amount: f.amount,
        quantity: f.quantity ?? 1,
        taxable: f.taxable ?? true,
      })) ?? []
  );
  const [miscFeeLabel, setMiscFeeLabel] = useState("");
  const [miscFeeAmount, setMiscFeeAmount] = useState("");
  const [miscFeeQuantity, setMiscFeeQuantity] = useState("1");
  const [miscFeeTaxable, setMiscFeeTaxable] = useState(true);
  const [miscFeeError, setMiscFeeError] = useState<string | null>(null);

  // Customer / quote header fields.
  const [customerName, setCustomerName] = useState(() => initialRecord?.input.customerName ?? "");
  const [customerCompany, setCustomerCompany] = useState(
    () => initialRecord?.input.customerCompany ?? ""
  );
  const [customerEmail, setCustomerEmail] = useState(() => initialRecord?.input.customerEmail ?? "");
  const [quoteDate, setQuoteDate] = useState(() => initialRecord?.input.quoteDate ?? todayIso());
  const [notes, setNotes] = useState(() => initialRecord?.input.notes ?? "");
  // Payment terms — 100 means "pay in full" (the common case); anything
  // less is a deposit-now / balance-later split (most often 50-50). See
  // lib/quote.ts's QuoteInput.depositPercent and lib/types.ts's
  // Customer.defaultDepositPercent, which this is pre-filled from when a
  // saved customer is picked below.
  const [depositPercent, setDepositPercent] = useState<number>(
    () => initialRecord?.input.depositPercent ?? 100
  );

  // Payment terms — a dropdown of admin-editable, reusable presets (e.g.
  // "Pay in full", "50% deposit, 50% on pickup") that each just set
  // depositPercent above, plus a "Custom %" option for a one-off split that
  // isn't saved to the shared list. Same dropdown-doubles-as-editor pattern
  // as the Setup charges picker below. See lib/payment-terms-store.ts.
  const [paymentTerms, setPaymentTerms] = useState<PaymentTermOption[]>([]);
  const [paymentTermsOpen, setPaymentTermsOpen] = useState(false);
  const paymentTermsRef = useRef<HTMLDivElement | null>(null);
  const [customPercentMode, setCustomPercentMode] = useState(false);
  const [editingTermId, setEditingTermId] = useState<string | null>(null);
  const [termEditDraft, setTermEditDraft] = useState<{ label: string; depositPercent: number }>({
    label: "",
    depositPercent: 100,
  });
  const [creatingTerm, setCreatingTerm] = useState(false);
  const [newTermDraft, setNewTermDraft] = useState<{ label: string; depositPercent: number }>({
    label: "",
    depositPercent: 100,
  });
  const [termBusyId, setTermBusyId] = useState<string | null>(null);
  const [termError, setTermError] = useState<string | null>(null);

  // Tax rate — a dropdown of admin-editable, reusable presets (e.g. "No
  // tax", "8.25% sales tax") that each just set taxRatePercent below, plus
  // a "Custom %" option for a one-off rate that isn't saved to the shared
  // list. Same dropdown-doubles-as-editor pattern as Payment terms and
  // Setup charges. See lib/tax-rates-store.ts.
  const [taxRatePercent, setTaxRatePercent] = useState<number>(
    () => initialRecord?.input.taxRatePercent ?? 0
  );
  const [taxRates, setTaxRates] = useState<TaxRateOption[]>([]);
  const [taxDropdownOpen, setTaxDropdownOpen] = useState(false);
  const taxDropdownRef = useRef<HTMLDivElement | null>(null);
  const [customTaxMode, setCustomTaxMode] = useState(false);
  const [editingTaxId, setEditingTaxId] = useState<string | null>(null);
  const [taxEditDraft, setTaxEditDraft] = useState<{ label: string; ratePercent: number }>({
    label: "",
    ratePercent: 0,
  });
  const [creatingTaxRate, setCreatingTaxRate] = useState(false);
  const [newTaxRateDraft, setNewTaxRateDraft] = useState<{ label: string; ratePercent: number }>({
    label: "",
    ratePercent: 0,
  });
  const [taxBusyId, setTaxBusyId] = useState<string | null>(null);
  const [taxError, setTaxError] = useState<string | null>(null);

  // Saved customer picker — loads the whole list once (see Customers tab)
  // and filters client-side, since this is expected to stay a small
  // address book, not a full CRM. Picking one just fills the three fields
  // above; it doesn't link the quote to the customer record in any
  // durable way (QuoteInput has no customerId), so editing/deleting a
  // customer later never affects a quote already saved.
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerQuery, setCustomerQuery] = useState("");
  const [customerSuggestionsOpen, setCustomerSuggestionsOpen] = useState(false);

  // "Add a garment" — guided flow: decoration -> catalog -> product (live
  // search-as-you-type) -> color -> sizes -> locations, mirroring the shop's
  // other quoting tool. Decoration is picked first (as in that tool) since
  // it decides whether the last step is "Locations" (Digital Print) or
  // "Stitch count" (Embroidered) or nothing at all (UV/Engraved Patch).
  const [selectedDecorationId, setSelectedDecorationId] = useState("");
  const [selectedColumnId, setSelectedColumnId] = useState("");
  const [catalogSource, setCatalogSource] = useState<CatalogSource>("sanmar");
  // Whether the next garment line added (via either the catalog flow or the
  // customer-supplied flow below) counts toward the taxable subtotal. See
  // lib/quote.ts's QuoteLineInput.taxable.
  const [lineTaxable, setLineTaxable] = useState(true);

  // Decoration type picker — a dropdown (same pattern as Setup charges)
  // that doubles as a lightweight editor for the shared decoration-types
  // catalog: rename any type in place, or quick-add a brand-new one with
  // sane $0 defaults (full pricing/turnaround/file-type setup stays on the
  // Pricing tab — see components/AdminDecorationTypesManager.tsx). This is
  // the "possible line items to add" dropdown from the quote builder.
  const [decorationDropdownOpen, setDecorationDropdownOpen] = useState(false);
  const decorationDropdownRef = useRef<HTMLDivElement | null>(null);
  const [editingDecorationId, setEditingDecorationId] = useState<string | null>(null);
  const [decorationEditLabel, setDecorationEditLabel] = useState("");
  const [creatingDecoration, setCreatingDecoration] = useState(false);
  const [newDecorationLabel, setNewDecorationLabel] = useState("");
  const [decorationBusyId, setDecorationBusyId] = useState<string | null>(null);
  const [decorationError, setDecorationError] = useState<string | null>(null);

  const [productQuery, setProductQuery] = useState("");
  const [productSuggestions, setProductSuggestions] = useState<ManualQuoteSearchResult[]>([]);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [foundProduct, setFoundProduct] = useState<ManualQuoteProduct | null>(null);
  const [foundProductLive, setFoundProductLive] = useState(false);
  const [selectedColor, setSelectedColor] = useState("");
  const [sizeQty, setSizeQty] = useState<Record<string, number>>({});

  // "Customer-Supplied Item" — catalogSource === "customer-supplied": the
  // customer brought the item(s) in themselves, so there's no product to
  // search for. Just a free-text description plus either a flat total
  // quantity or a size-by-size breakdown (the admin picks which).
  const [csDescription, setCsDescription] = useState("");
  const [csQuantityMode, setCsQuantityMode] = useState<"flat" | "sizes">("flat");
  const [csFlatQuantity, setCsFlatQuantity] = useState(0);
  const [csSizeRows, setCsSizeRows] = useState<{ size: string; quantity: number }[]>([
    { size: "", quantity: 0 },
  ]);
  const [csError, setCsError] = useState<string | null>(null);

  const [lines, setLines] = useState<PendingLine[]>(() =>
    initialRecord ? linesFromRecord(initialRecord) : initialLines ?? []
  );

  // Which "Add item" panel (if any) is currently open below the unified
  // Items list — Setup charges / Other charges / Garments stay the three
  // distinct item types they've always been, just reached through one "+
  // Add item" dropdown instead of three permanently-open cards. null means
  // every item type's picker/form is collapsed; the unified list above it
  // is always visible regardless.
  const [addItemMode, setAddItemMode] = useState<"setup" | "misc" | "garment" | null>(null);
  const [addItemMenuOpen, setAddItemMenuOpen] = useState(false);
  const addItemMenuRef = useRef<HTMLDivElement | null>(null);

  const [quote, setQuote] = useState<ComputedQuote | null>(() => initialRecord?.computed ?? null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [pdfLoading, setPdfLoading] = useState<PdfMode | null>(null);
  const [sendModalOpen, setSendModalOpen] = useState(false);

  // The saved record currently loaded into the builder, if any — null means
  // "unsaved, brand-new quote." Set at mount from initialRecord, or by a
  // successful save/update/convert.
  const [activeRecord, setActiveRecord] = useState<QuoteRecord | null>(initialRecord ?? null);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [converting, setConverting] = useState(false);
  const [convertingToQuote, setConvertingToQuote] = useState(false);

  // Hide/show toggle for the admin-only cost/markup breakdown (the "Item
  // Cost" and "Item Markup" rows in the size grid below, and the matching
  // "Cost"/"Markup" columns in the Preview table) — handy for Quick Quote
  // when a customer is looking at the screen and only the final price
  // should be visible. Persisted to localStorage (see loadShowMarkup above)
  // so it stays however it was last left, across refreshes and tabs.
  const [showMarkup, setShowMarkup] = useState<boolean>(loadShowMarkup);

  useEffect(() => {
    try {
      window.localStorage.setItem(SHOW_MARKUP_STORAGE_KEY, String(showMarkup));
    } catch {
      // Private browsing / storage disabled — the toggle still works for
      // this page view, it just won't be remembered next time.
    }
  }, [showMarkup]);

  useEffect(() => {
    fetch("/api/decorations")
      .then((r) => r.json())
      .then((d: DecorationOption[]) => setDecorations(d))
      .catch(() => setDecorations([]))
      .finally(() => setDecorationsLoaded(true));
    fetch("/api/admin/setup-charges")
      .then((r) => r.json())
      .then((d: { setupCharges: SetupChargeType[] }) => setSetupCharges(d.setupCharges ?? []))
      .catch(() => setSetupCharges([]));
    fetch("/api/admin/payment-terms")
      .then((r) => r.json())
      .then((d: { paymentTerms: PaymentTermOption[] }) => {
        const terms = d.paymentTerms ?? [];
        setPaymentTerms(terms);
        // If the quote's initial deposit % doesn't match any known preset
        // (e.g. a saved quote's one-off split), show it as "Custom" rather
        // than silently matching the wrong preset.
        if (!terms.some((t) => t.depositPercent === depositPercent)) {
          setCustomPercentMode(true);
        }
      })
      .catch(() => setPaymentTerms([]));
    fetch("/api/admin/tax-rates")
      .then((r) => r.json())
      .then((d: { taxRates: TaxRateOption[] }) => {
        const rates = d.taxRates ?? [];
        setTaxRates(rates);
        // If the quote's initial tax rate doesn't match any known preset
        // (e.g. a saved quote's one-off rate), show it as "Custom" rather
        // than silently matching the wrong preset.
        if (!rates.some((t) => t.ratePercent === taxRatePercent)) {
          setCustomTaxMode(true);
        }
      })
      .catch(() => setTaxRates([]));
    fetch("/api/admin/customers")
      .then((r) => r.json())
      .then((d: { customers: Customer[] }) => setCustomers(d.customers ?? []))
      .catch(() => setCustomers([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const customerSuggestions =
    customerQuery.trim().length < 1
      ? []
      : customers
          .filter((c) =>
            [c.name, c.company, c.email].some((f) =>
              f?.toLowerCase().includes(customerQuery.trim().toLowerCase())
            )
          )
          .slice(0, 8);

  function selectCustomer(c: Customer) {
    setCustomerName(c.name);
    setCustomerCompany(c.company ?? "");
    setCustomerEmail(c.email ?? "");
    setDepositPercent(c.defaultDepositPercent ?? 100);
    setCustomerQuery("");
    setCustomerSuggestionsOpen(false);
  }

  function startNewQuote() {
    setActiveRecord(null);
    setCustomerName("");
    setCustomerCompany("");
    setCustomerEmail("");
    setQuoteDate(todayIso());
    setNotes("");
    setDepositPercent(100);
    setSelectedSetupChargeIds([]);
    setMiscFees([]);
    setMiscFeeLabel("");
    setMiscFeeAmount("");
    setMiscFeeError(null);
    setLines([]);
    setQuote(null);
    setFoundProduct(null);
    setQuoteError(null);
    setSaveMessage(null);
  }

  function toggleSetupCharge(id: string, checked: boolean) {
    setSelectedSetupChargeIds((prev) => (checked ? [...prev, id] : prev.filter((x) => x !== id)));
    setQuote(null);
  }

  // Close the setup-charges dropdown (and any in-progress edit/create form
  // inside it) on an outside click — needed instead of a simple onBlur
  // because the dropdown contains its own inputs/buttons, whose clicks
  // would otherwise blur-and-close the panel before the click registers.
  useEffect(() => {
    if (!setupDropdownOpen) return;
    function handleClick(e: MouseEvent) {
      if (setupDropdownRef.current && !setupDropdownRef.current.contains(e.target as Node)) {
        setSetupDropdownOpen(false);
        setEditingChargeId(null);
        setCreatingCharge(false);
        setChargeError(null);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [setupDropdownOpen]);

  useEffect(() => {
    if (!addItemMenuOpen) return;
    function handleClick(e: MouseEvent) {
      if (addItemMenuRef.current && !addItemMenuRef.current.contains(e.target as Node)) {
        setAddItemMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [addItemMenuOpen]);

  useEffect(() => {
    if (!paymentTermsOpen) return;
    function handleClick(e: MouseEvent) {
      if (paymentTermsRef.current && !paymentTermsRef.current.contains(e.target as Node)) {
        setPaymentTermsOpen(false);
        setEditingTermId(null);
        setCreatingTerm(false);
        setTermError(null);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [paymentTermsOpen]);

  useEffect(() => {
    if (!taxDropdownOpen) return;
    function handleClick(e: MouseEvent) {
      if (taxDropdownRef.current && !taxDropdownRef.current.contains(e.target as Node)) {
        setTaxDropdownOpen(false);
        setEditingTaxId(null);
        setCreatingTaxRate(false);
        setTaxError(null);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [taxDropdownOpen]);

  useEffect(() => {
    if (!decorationDropdownOpen) return;
    function handleClick(e: MouseEvent) {
      if (decorationDropdownRef.current && !decorationDropdownRef.current.contains(e.target as Node)) {
        setDecorationDropdownOpen(false);
        setEditingDecorationId(null);
        setCreatingDecoration(false);
        setDecorationError(null);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [decorationDropdownOpen]);

  function selectPaymentTerm(term: PaymentTermOption) {
    setDepositPercent(term.depositPercent);
    setCustomPercentMode(false);
    setPaymentTermsOpen(false);
  }

  function startEditTerm(t: PaymentTermOption) {
    setEditingTermId(t.id);
    setTermEditDraft({ label: t.label, depositPercent: t.depositPercent });
    setCreatingTerm(false);
    setTermError(null);
  }

  async function saveTermEdit(id: string) {
    if (!termEditDraft.label.trim()) {
      setTermError("Enter a label before saving.");
      return;
    }
    setTermBusyId(id);
    setTermError(null);
    try {
      const res = await fetch("/api/admin/payment-terms", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          label: termEditDraft.label.trim(),
          depositPercent: termEditDraft.depositPercent,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Save failed");
      setPaymentTerms((prev) => prev.map((t) => (t.id === id ? data.term : t)));
      setEditingTermId(null);
    } catch (e) {
      setTermError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setTermBusyId(null);
    }
  }

  async function handleDeleteTerm(t: PaymentTermOption) {
    if (!confirm(`Delete "${t.label}" from the payment terms list? This removes it everywhere, not just this quote.`)) {
      return;
    }
    setTermBusyId(t.id);
    setTermError(null);
    try {
      const res = await fetch(`/api/admin/payment-terms?id=${encodeURIComponent(t.id)}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Delete failed");
      setPaymentTerms((prev) => prev.filter((x) => x.id !== t.id));
      if (editingTermId === t.id) setEditingTermId(null);
    } catch (e) {
      setTermError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setTermBusyId(null);
    }
  }

  async function handleCreateTerm() {
    const label = newTermDraft.label.trim();
    if (!label) {
      setTermError("Enter a label before adding.");
      return;
    }
    setTermBusyId("__new__");
    setTermError(null);
    try {
      const res = await fetch("/api/admin/payment-terms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label, depositPercent: newTermDraft.depositPercent }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Create failed");
      setPaymentTerms((prev) => [...prev, data.term]);
      setDepositPercent(data.term.depositPercent);
      setCustomPercentMode(false);
      setNewTermDraft({ label: "", depositPercent: 100 });
      setCreatingTerm(false);
      setPaymentTermsOpen(false);
    } catch (e) {
      setTermError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setTermBusyId(null);
    }
  }

  function selectTaxRate(rate: TaxRateOption) {
    setTaxRatePercent(rate.ratePercent);
    setCustomTaxMode(false);
    setTaxDropdownOpen(false);
  }

  function startEditTaxRate(t: TaxRateOption) {
    setEditingTaxId(t.id);
    setTaxEditDraft({ label: t.label, ratePercent: t.ratePercent });
    setCreatingTaxRate(false);
    setTaxError(null);
  }

  async function saveTaxRateEdit(id: string) {
    if (!taxEditDraft.label.trim()) {
      setTaxError("Enter a label before saving.");
      return;
    }
    setTaxBusyId(id);
    setTaxError(null);
    try {
      const res = await fetch("/api/admin/tax-rates", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          label: taxEditDraft.label.trim(),
          ratePercent: taxEditDraft.ratePercent,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Save failed");
      setTaxRates((prev) => prev.map((t) => (t.id === id ? data.rate : t)));
      setEditingTaxId(null);
    } catch (e) {
      setTaxError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setTaxBusyId(null);
    }
  }

  async function handleDeleteTaxRate(t: TaxRateOption) {
    if (!confirm(`Delete "${t.label}" from the tax rates list? This removes it everywhere, not just this quote.`)) {
      return;
    }
    setTaxBusyId(t.id);
    setTaxError(null);
    try {
      const res = await fetch(`/api/admin/tax-rates?id=${encodeURIComponent(t.id)}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Delete failed");
      setTaxRates((prev) => prev.filter((x) => x.id !== t.id));
      if (editingTaxId === t.id) setEditingTaxId(null);
    } catch (e) {
      setTaxError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setTaxBusyId(null);
    }
  }

  async function handleCreateTaxRate() {
    const label = newTaxRateDraft.label.trim();
    if (!label) {
      setTaxError("Enter a label before adding.");
      return;
    }
    setTaxBusyId("__new__");
    setTaxError(null);
    try {
      const res = await fetch("/api/admin/tax-rates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label, ratePercent: newTaxRateDraft.ratePercent }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Create failed");
      setTaxRates((prev) => [...prev, data.rate]);
      setTaxRatePercent(data.rate.ratePercent);
      setCustomTaxMode(false);
      setNewTaxRateDraft({ label: "", ratePercent: 0 });
      setCreatingTaxRate(false);
      setTaxDropdownOpen(false);
    } catch (e) {
      setTaxError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setTaxBusyId(null);
    }
  }

  function startEditDecoration(d: DecorationOption) {
    setEditingDecorationId(d.id);
    setDecorationEditLabel(d.label);
    setCreatingDecoration(false);
    setDecorationError(null);
  }

  async function saveDecorationEdit(id: string) {
    const label = decorationEditLabel.trim();
    if (!label) {
      setDecorationError("Enter a name before saving.");
      return;
    }
    const existing = decorations.find((d) => d.id === id);
    if (!existing) return;
    setDecorationBusyId(id);
    setDecorationError(null);
    try {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { id: _ignored, ...fields } = existing;
      const res = await fetch("/api/admin/decoration-types", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...fields, label }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Save failed");
      setDecorations((prev) => prev.map((d) => (d.id === id ? data.decoration : d)));
      setEditingDecorationId(null);
    } catch (e) {
      setDecorationError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setDecorationBusyId(null);
    }
  }

  async function handleDeleteDecoration(d: DecorationOption) {
    if (
      !confirm(
        `Delete "${d.label}" from decoration types? This removes it everywhere — including the customer-facing catalog — not just this quote.`
      )
    ) {
      return;
    }
    setDecorationBusyId(d.id);
    setDecorationError(null);
    try {
      const res = await fetch(`/api/admin/decoration-types?id=${encodeURIComponent(d.id)}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Delete failed");
      setDecorations((prev) => prev.filter((x) => x.id !== d.id));
      if (selectedDecorationId === d.id) setSelectedDecorationId("");
      if (editingDecorationId === d.id) setEditingDecorationId(null);
    } catch (e) {
      setDecorationError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setDecorationBusyId(null);
    }
  }

  // Quick-add a brand-new decoration type right from this dropdown, with
  // sane $0 defaults — full pricing/turnaround/file-type setup can be
  // filled in later from the Pricing tab's AdminDecorationTypesManager.
  async function handleCreateDecoration() {
    const label = newDecorationLabel.trim();
    if (!label) {
      setDecorationError("Enter a name before adding.");
      return;
    }
    setDecorationBusyId("__new__");
    setDecorationError(null);
    try {
      const res = await fetch("/api/admin/decoration-types", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label,
          shortLabel: label,
          description: "",
          productTypes: ["hat", "shirt", "tumbler", "polo"],
          minQuantity: 0,
          setupFee: 0,
          setupFeeEnabled: false,
          pricingTiers: [{ minQty: 1, pricePerUnit: 0 }],
          turnaroundDays: "",
          acceptedFileTypes: [],
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Create failed");
      setDecorations((prev) => [...prev, data.decoration]);
      setSelectedDecorationId(data.decoration.id);
      setSelectedColumnId("");
      setNewDecorationLabel("");
      setCreatingDecoration(false);
      setDecorationDropdownOpen(false);
    } catch (e) {
      setDecorationError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setDecorationBusyId(null);
    }
  }

  function startEditCharge(c: SetupChargeType) {
    setEditingChargeId(c.id);
    setChargeEditDraft({ label: c.label, price: c.price, taxable: c.taxable ?? true });
    setCreatingCharge(false);
    setChargeError(null);
  }

  async function saveChargeEdit(id: string) {
    if (!chargeEditDraft.label.trim()) {
      setChargeError("Enter a label before saving.");
      return;
    }
    setChargeBusyId(id);
    setChargeError(null);
    try {
      const res = await fetch("/api/admin/setup-charges", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          label: chargeEditDraft.label.trim(),
          price: chargeEditDraft.price,
          taxable: chargeEditDraft.taxable,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Save failed");
      setSetupCharges((prev) => prev.map((c) => (c.id === id ? data.charge : c)));
      setEditingChargeId(null);
      setQuote(null);
    } catch (e) {
      setChargeError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setChargeBusyId(null);
    }
  }

  // Deletes a charge from the shared catalog entirely (not just this quote)
  // — matches AdminSetupChargesManager's own delete behavior, since this is
  // the same underlying list. Also drops it from this quote's selection if
  // it was checked.
  async function handleDeleteCharge(c: SetupChargeType) {
    if (!confirm(`Delete "${c.label}" from the setup charges list? This removes it everywhere, not just this quote.`)) {
      return;
    }
    setChargeBusyId(c.id);
    setChargeError(null);
    try {
      const res = await fetch(`/api/admin/setup-charges?id=${encodeURIComponent(c.id)}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Delete failed");
      setSetupCharges((prev) => prev.filter((x) => x.id !== c.id));
      setSelectedSetupChargeIds((prev) => prev.filter((x) => x !== c.id));
      if (editingChargeId === c.id) setEditingChargeId(null);
      setQuote(null);
    } catch (e) {
      setChargeError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setChargeBusyId(null);
    }
  }

  // Creates a brand-new reusable setup charge (saved to the shared catalog,
  // same as adding one on the "Setup Charges" tab) and immediately selects
  // it for this quote.
  async function handleCreateCharge() {
    const label = newChargeDraft.label.trim();
    if (!label) {
      setChargeError("Enter a label before adding.");
      return;
    }
    setChargeBusyId("__new__");
    setChargeError(null);
    try {
      const res = await fetch("/api/admin/setup-charges", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label, price: newChargeDraft.price, taxable: newChargeDraft.taxable }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Create failed");
      setSetupCharges((prev) => [...prev, data.charge]);
      setSelectedSetupChargeIds((prev) => [...prev, data.charge.id]);
      setNewChargeDraft({ label: "", price: 0, taxable: true });
      setCreatingCharge(false);
      setQuote(null);
    } catch (e) {
      setChargeError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setChargeBusyId(null);
    }
  }

  function addMiscFee() {
    const label = miscFeeLabel.trim();
    const amount = Number(miscFeeAmount);
    const quantity = Number(miscFeeQuantity);
    if (!label) {
      setMiscFeeError("Enter a description before adding.");
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      setMiscFeeError("Enter an amount greater than 0.");
      return;
    }
    if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isInteger(quantity)) {
      setMiscFeeError("Enter a quantity of 1 or more.");
      return;
    }
    const feeId = `misc-${Date.now()}`;
    setMiscFees((prev) => [...prev, { id: feeId, label, amount, quantity, taxable: miscFeeTaxable }]);
    setMiscFeeLabel("");
    setMiscFeeAmount("");
    setMiscFeeQuantity("1");
    setMiscFeeTaxable(true);
    setMiscFeeError(null);
    setQuote(null);
  }

  function removeMiscFee(id: string) {
    setMiscFees((prev) => prev.filter((f) => f.id !== id));
    setQuote(null);
  }

  const selectedDecoration = decorations.find((d) => d.id === selectedDecorationId);
  const columnLabel =
    selectedDecoration?.priceColumns?.some((c) => c.label.toLowerCase().includes("stitch"))
      ? "Stitch count"
      : "Locations";

  function resetProductPicker() {
    setProductQuery("");
    setProductSuggestions([]);
    setSuggestionsOpen(false);
    setFoundProduct(null);
    setFoundProductLive(false);
    setSelectedColor("");
    setSizeQty({});
    setLookupError(null);
  }

  function resetCustomerSuppliedForm() {
    setCsDescription("");
    setCsQuantityMode("flat");
    setCsFlatQuantity(0);
    setCsSizeRows([{ size: "", quantity: 0 }]);
    setCsError(null);
  }

  function onCatalogChange(next: CatalogSource) {
    setCatalogSource(next);
    resetProductPicker();
    resetCustomerSuppliedForm();
  }

  function onProductQueryChange(value: string) {
    setProductQuery(value);
    setFoundProduct(null);
    if (searchDebounce.current) clearTimeout(searchDebounce.current);
    const q = value.trim();
    if (q.length < 2) {
      setProductSuggestions([]);
      setSuggestionsOpen(false);
      return;
    }
    searchDebounce.current = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const res = await fetch(
          `/api/admin/quote/search-products?catalog=${catalogSource}&q=${encodeURIComponent(q)}`
        );
        const data = await res.json();
        setProductSuggestions(data.results ?? []);
        setSuggestionsOpen(true);
      } catch {
        setProductSuggestions([]);
      } finally {
        setSearchLoading(false);
      }
    }, 250);
  }

  async function selectProduct(result: ManualQuoteSearchResult) {
    setSuggestionsOpen(false);
    setProductQuery(`${result.styleNumber} — ${result.name}`);
    setLookupLoading(true);
    setLookupError(null);
    setFoundProduct(null);
    try {
      const res = await fetch(
        `/api/admin/quote/manual-product?catalog=${catalogSource}&style=${encodeURIComponent(result.styleNumber)}`
      );
      const data = await res.json();
      if (!res.ok) {
        setLookupError(data.error || "Failed to load that product");
        return;
      }
      const product = data.product as ManualQuoteProduct;
      setFoundProduct(product);
      setFoundProductLive(Boolean(data.livePricingApplied));
      setSelectedColor(product.colors[0]?.colorName ?? "");
      const initialQty: Record<string, number> = {};
      const initialSizes = product.colors[0]?.sizes ?? [];
      if (initialSizes.length > 0) {
        for (const sz of initialSizes) initialQty[sz.name] = 0;
      } else {
        initialQty[ONE_SIZE_LABEL] = 0;
      }
      setSizeQty(initialQty);
    } catch {
      setLookupError("Failed to load that product — check your connection and try again.");
    } finally {
      setLookupLoading(false);
    }
  }

  const selectedColorRow = foundProduct?.colors.find((c) => c.colorName === selectedColor);
  // Colors come back from the catalog API in whatever order the feed has
  // them (not alphabetical) — sort just for display here so the admin can
  // scan/find a color quickly; doesn't affect selectedColor/selectedColorRow
  // lookups above, which still match by name regardless of list order.
  const sortedProductColors = foundProduct
    ? [...foundProduct.colors].sort((a, b) => a.colorName.localeCompare(b.colorName))
    : [];

  function fillOneEach() {
    if (!selectedColorRow) return;
    const next: Record<string, number> = {};
    for (const sz of selectedColorRow.sizes) next[sz.name] = 1;
    setSizeQty(next);
  }

  function clearQuantities() {
    if (!selectedColorRow) return;
    const next: Record<string, number> = {};
    for (const sz of selectedColorRow.sizes) next[sz.name] = 0;
    setSizeQty(next);
  }

  function addLine() {
    if (!foundProduct) return;
    const sizes = Object.entries(sizeQty)
      .filter(([, qty]) => qty > 0)
      .map(([size, quantity]) => ({ size, quantity }));
    if (sizes.length === 0) {
      setLookupError("Enter a quantity for at least one size before adding.");
      return;
    }
    // Looked up fresh here (rather than reading the render-scoped
    // selectedColorRow above) so this function stays a plain, self-contained
    // event handler for the purposes of React's purity analysis.
    const colorRow = foundProduct.colors.find((c) => c.colorName === selectedColor);
    const lineKey = `${foundProduct.styleNumber}-${selectedColor}-${Date.now()}`;
    const line: PendingLine = {
      key: lineKey,
      styleNumber: foundProduct.styleNumber,
      brandName: foundProduct.brandName,
      productName: foundProduct.productName,
      colorName: selectedColor,
      sizes,
      decorationId: selectedDecorationId || undefined,
      priceColumnId: selectedColumnId || undefined,
      taxable: lineTaxable,
      imageUrl: colorRow?.imageUrl,
      imageFallbackUrl: colorRow?.imageFallbackUrl,
    };
    setLines((prev) => [...prev, line]);
    // Reset the product picker for the next garment, but keep the chosen
    // decoration/catalog/locations — a real order is usually several
    // styles/colors under the same decoration and location count.
    resetProductPicker();
    setQuote(null);
  }

  // "Add to quote" for a customer-supplied item (see CatalogSource ===
  // "customer-supplied" above) — no product/color lookup, just a
  // description plus either a flat quantity or a size-by-size breakdown.
  function addCustomerSuppliedLine() {
    const description = csDescription.trim();
    if (!description) {
      setCsError("Enter an item description before adding.");
      return;
    }

    let sizes: QuoteSizeInput[];
    if (csQuantityMode === "flat") {
      if (csFlatQuantity <= 0) {
        setCsError("Enter a quantity greater than 0 before adding.");
        return;
      }
      sizes = [{ size: "Items", quantity: csFlatQuantity }];
    } else {
      sizes = csSizeRows
        .filter((r) => r.size.trim() && r.quantity > 0)
        .map((r) => ({ size: r.size.trim(), quantity: r.quantity }));
      if (sizes.length === 0) {
        setCsError("Add at least one size with a quantity greater than 0.");
        return;
      }
    }

    const line: PendingLine = {
      key: `customer-supplied-${Date.now()}`,
      customerSupplied: true,
      itemDescription: description,
      sizes,
      decorationId: selectedDecorationId || undefined,
      priceColumnId: selectedColumnId || undefined,
      brandName: "Customer-supplied item",
      productName: description,
      taxable: lineTaxable,
    };
    setLines((prev) => [...prev, line]);
    resetCustomerSuppliedForm();
    setQuote(null);
  }

  function removeLine(key: string) {
    setLines((prev) => prev.filter((l) => l.key !== key));
    setQuote(null);
  }

  function buildQuoteInput() {
    return {
      customerName: customerName || undefined,
      customerCompany: customerCompany || undefined,
      customerEmail: customerEmail || undefined,
      quoteDate,
      notes: notes || undefined,
      depositPercent: depositPercent < 100 ? depositPercent : undefined,
      taxRatePercent: taxRatePercent > 0 ? taxRatePercent : undefined,
      lines: lines.map((l) => ({
        styleNumber: l.styleNumber,
        colorName: l.colorName,
        sizes: l.sizes,
        decorationId: l.decorationId,
        priceColumnId: l.priceColumnId,
        customerSupplied: l.customerSupplied,
        itemDescription: l.itemDescription,
        taxable: l.taxable,
      })),
      setupChargeIds: selectedSetupChargeIds,
      miscFees:
        miscFees.length > 0
          ? miscFees.map(({ label, amount, quantity, taxable }) => ({ label, amount, quantity, taxable }))
          : undefined,
    };
  }

  async function generateQuote() {
    if (lines.length === 0 && selectedSetupChargeIds.length === 0 && miscFees.length === 0) return;
    setQuoteLoading(true);
    setQuoteError(null);
    setQuote(null);
    try {
      const res = await fetch("/api/admin/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildQuoteInput()),
      });
      const data = await res.json();
      if (!res.ok) {
        setQuoteError(data.error || "Failed to compute quote");
        return;
      }
      setQuote(data.quote as ComputedQuote);
    } catch {
      setQuoteError("Failed to compute quote — check your connection and try again.");
    } finally {
      setQuoteLoading(false);
    }
  }

  // Keep the Preview section's total always in sync with the current lines
  // and setup charges, instead of only computing it once and then going
  // stale until the admin remembers to click "Preview quote" again — a
  // short debounce (rather than firing on every keystroke of a quantity
  // input) coalesces rapid edits into one recompute.
  useEffect(() => {
    const timer = setTimeout(() => {
      if (lines.length === 0 && selectedSetupChargeIds.length === 0 && miscFees.length === 0) {
        setQuote(null);
        return;
      }
      generateQuote();
    }, 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, selectedSetupChargeIds, miscFees, taxRatePercent]);

  // Autosave on a saved record: previously, adding/removing a garment,
  // setup charge, or other charge only updated this component's in-memory
  // state — nothing reached the server until the admin scrolled back up and
  // explicitly clicked "Save changes" again. Several reports of a saved
  // quote reopening with its items missing turned out to be this: the admin
  // added items after the first save, then navigated away (e.g. "Back to
  // quotes") without a second explicit save, and nothing had actually been
  // persisted. Once a record exists (activeRecord is set — i.e. it's been
  // saved at least once), every further change to the items themselves is
  // now pushed to the server automatically on the same short debounce as
  // the live preview, so leaving the page can never silently drop an edit.
  // Skipped entirely for a brand-new, not-yet-saved quote (no activeRecord
  // yet) and for the Quick Quote builder (mode "quick" has no save step at
  // all) — and skipped on the very first run after a record loads/saves,
  // so hydrating from the server doesn't immediately re-PUT the same data.
  const skipNextAutosaveRef = useRef(true);
  useEffect(() => {
    if (skipNextAutosaveRef.current) {
      skipNextAutosaveRef.current = false;
      return;
    }
    if (mode !== "full" || !activeRecord) return;
    const timer = setTimeout(() => {
      saveQuote();
    }, 800);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, selectedSetupChargeIds, miscFees]);

  async function downloadPdf(mode: PdfMode) {
    setPdfLoading(mode);
    setQuoteError(null);
    // Open the tab synchronously, in direct response to the click, and
    // navigate it to the PDF once it's ready — opening it only after the
    // `await` below (or just setting a.download on a same-tab anchor, which
    // mobile Safari largely ignores) is what was actually navigating the
    // admin's current tab away to view the PDF instead of leaving it open
    // in a new one. Most desktop/mobile browsers allow a synchronous
    // window.open() from a click handler even though this function is
    // async; a null return (popup blocked) falls back to opening it once
    // the blob is ready instead.
    const tab = window.open("", "_blank");
    try {
      // A saved record renders from its stored pricing snapshot (so the
      // document matches what was actually saved, and invoice mode has the
      // invoice number/payment status to show) — an unsaved quote falls
      // back to the ad-hoc compute-and-render endpoint.
      const res = activeRecord
        ? await fetch(`/api/admin/quotes/${activeRecord.id}/pdf?mode=${mode}`)
        : await fetch("/api/admin/quote/pdf", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...buildQuoteInput(), mode }),
          });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setQuoteError(data.error || "Failed to generate PDF");
        tab?.close();
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      if (tab) {
        tab.location.href = url;
      } else {
        window.open(url, "_blank");
      }
      // Give the new tab time to actually load the blob before revoking it.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      setQuoteError("Failed to generate PDF — check your connection and try again.");
      tab?.close();
    } finally {
      setPdfLoading(null);
    }
  }

  async function saveQuote() {
    setSaving(true);
    setSaveMessage(null);
    setQuoteError(null);
    try {
      const isUpdate = !!activeRecord;
      const res = await fetch(isUpdate ? `/api/admin/quotes/${activeRecord!.id}` : "/api/admin/quotes", {
        method: isUpdate ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(isUpdate ? buildQuoteInput() : { ...buildQuoteInput(), kind: createAs }),
      });
      const data = await res.json();
      if (!res.ok) {
        setQuoteError(data.error || "Failed to save quote");
        return;
      }
      const record = data.record as QuoteRecord;
      setActiveRecord(record);
      setQuote(record.computed);
      setSaveMessage(
        (isUpdate ? "Quote updated." : record.status === "invoice" ? "Invoice saved." : "Quote saved.") +
          (data.persisted === false ? " No durable storage connected yet — see the list below." : "")
      );
      onSaved?.(record);
    } catch {
      setQuoteError("Failed to save quote — check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  // Creates (or, if this quote was already converted before, just opens)
  // the linked invoice — a brand-new, separate record (see
  // lib/quotes-store.ts's convertQuoteToInvoice), not this same one with a
  // flipped status. Navigates the admin straight there, same as clicking
  // Edit on it from the Invoices tab, since this builder instance is still
  // showing the quote.
  async function convertToInvoice() {
    if (!activeRecord) return;
    setConverting(true);
    setQuoteError(null);
    try {
      const res = await fetch(`/api/admin/quotes/${activeRecord.id}/convert`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setQuoteError(data.error || "Failed to convert to invoice");
        return;
      }
      const record = data.record as QuoteRecord;
      router.push(`/admin/quotes/${record.id}`);
    } catch {
      setQuoteError("Failed to convert to invoice — check your connection and try again.");
    } finally {
      setConverting(false);
    }
  }

  // The reverse — creates (or opens) a linked quote from this invoice. See
  // convertInvoiceToQuote's comment: the invoice's own payment/payment-link
  // state is left untouched, only the pricing content is used for the new
  // quote.
  async function convertToQuote() {
    if (!activeRecord) return;
    setConvertingToQuote(true);
    setQuoteError(null);
    try {
      const res = await fetch(`/api/admin/quotes/${activeRecord.id}/convert-to-quote`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setQuoteError(data.error || "Failed to convert to quote");
        return;
      }
      const record = data.record as QuoteRecord;
      router.push(`/admin/quotes/${record.id}`);
    } catch {
      setQuoteError("Failed to convert to quote — check your connection and try again.");
    } finally {
      setConvertingToQuote(false);
    }
  }

  return (
    <>
    <div className="space-y-8">
      {activeRecord && (
        <div className="flex items-center justify-between gap-3 bg-white/5 border border-white/10 shadow-lg shadow-black/30 rounded-2xl px-4 py-2.5 text-sm">
          <div className="text-white/70">
            Editing{" "}
            {activeRecord.status === "invoice"
              ? `invoice ${activeRecord.invoiceNumber}`
              : activeRecord.quoteNumber
                ? `quote ${activeRecord.quoteNumber}`
                : "saved quote"}{" "}
            <span className="text-white/40">
              (saved {new Date(activeRecord.updatedAt).toLocaleDateString()})
            </span>
            {activeRecord.status === "invoice" && activeRecord.invoiceStatus && (
              <span
                className={`ml-2 px-2 py-0.5 rounded-full text-xs font-medium ${
                  activeRecord.invoiceStatus === "paid"
                    ? "bg-green-100 text-green-800"
                    : activeRecord.invoiceStatus === "partially_paid"
                      ? "bg-amber-100 text-amber-800"
                      : "bg-red-100 text-red-700"
                }`}
              >
                {activeRecord.invoiceStatus.replace("_", " ")}
              </span>
            )}
            {activeRecord.status === "quote" && activeRecord.linkedInvoiceId && (
              <button
                onClick={() => router.push(`/admin/quotes/${activeRecord.linkedInvoiceId}`)}
                className="ml-2 px-2 py-0.5 rounded-full text-xs font-medium border border-white/20 text-white/70 hover:bg-white/5"
                title="Open the invoice created from this quote"
              >
                → Invoice {activeRecord.linkedInvoiceNumber ?? ""}
              </button>
            )}
            {activeRecord.status === "invoice" && activeRecord.linkedQuoteId && (
              <button
                onClick={() => router.push(`/admin/quotes/${activeRecord.linkedQuoteId}`)}
                className="ml-2 px-2 py-0.5 rounded-full text-xs font-medium border border-white/20 text-white/70 hover:bg-white/5"
                title="Open the quote this invoice was created from"
              >
                from Quote {activeRecord.linkedQuoteNumber ?? ""}
              </button>
            )}
          </div>
          <button
            onClick={startNewQuote}
            className="text-xs text-white/60 px-3 py-1 rounded-xl border border-white/20 hover:bg-black shrink-0"
          >
            Start a new quote
          </button>
        </div>
      )}

      {/* Customer / quote header — skipped entirely in "quick" mode (Quick
          Quote tab): no customer to look up, no payment terms to set. */}
      {mode === "full" && (
      <section className="bg-black border border-white/10 shadow-lg shadow-black/30 rounded-2xl p-4">
        <h3 className="text-sm font-semibold text-white mb-3">Quote details</h3>

        {customers.length > 0 && (
          <div className="relative max-w-sm mb-3">
            <label className="text-xs text-white/60">
              Load a saved customer (optional)
              <input
                value={customerQuery}
                onChange={(e) => {
                  setCustomerQuery(e.target.value);
                  setCustomerSuggestionsOpen(true);
                }}
                onFocus={() => setCustomerSuggestionsOpen(true)}
                onBlur={() => setTimeout(() => setCustomerSuggestionsOpen(false), 150)}
                className="mt-1 w-full border border-white/20 rounded-xl px-2 py-1.5 text-sm"
                placeholder="Search by name, company, or email…"
              />
            </label>
            {customerSuggestionsOpen && customerSuggestions.length > 0 && (
              <ul className="absolute z-40 mt-1 w-full max-h-56 overflow-y-auto bg-black border border-white/20 rounded-xl shadow-lg text-sm">
                {customerSuggestions.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onMouseDown={() => selectCustomer(c)}
                      className="block w-full text-left px-3 py-2 hover:bg-white/5"
                    >
                      <span className="font-medium text-white">{c.name}</span>{" "}
                      <span className="text-white/40">
                        {[c.company, c.email].filter(Boolean).join(" · ")}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <label className="text-xs text-white/60">
            Customer name
            <input
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              className="mt-1 w-full border border-white/20 rounded-xl px-2 py-1.5 text-sm"
              placeholder="Jane Smith"
            />
          </label>
          <label className="text-xs text-white/60">
            Company (optional)
            <input
              value={customerCompany}
              onChange={(e) => setCustomerCompany(e.target.value)}
              className="mt-1 w-full border border-white/20 rounded-xl px-2 py-1.5 text-sm"
            />
          </label>
          <label className="text-xs text-white/60">
            Email (optional)
            <input
              value={customerEmail}
              onChange={(e) => setCustomerEmail(e.target.value)}
              className="mt-1 w-full border border-white/20 rounded-xl px-2 py-1.5 text-sm"
            />
          </label>
          <label className="text-xs text-white/60">
            Quote date
            <input
              type="date"
              value={quoteDate}
              onChange={(e) => setQuoteDate(e.target.value)}
              className="mt-1 w-full border border-white/20 rounded-xl px-2 py-1.5 text-sm"
            />
          </label>
        </div>
        <label className="block text-xs text-white/60 mt-3">
          Notes (optional, printed on the PDF)
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="mt-1 w-full border border-white/20 rounded-xl px-2 py-1.5 text-sm"
            rows={2}
          />
        </label>

        <div className="mt-3">
          <p className="text-xs text-white/60 mb-1">Payment terms</p>
          <div className="relative inline-block" ref={paymentTermsRef}>
            <button
              type="button"
              onClick={() => setPaymentTermsOpen((o) => !o)}
              className="flex items-center gap-2 text-sm px-3 py-1.5 rounded-xl border border-white/20 hover:bg-white/5"
            >
              {customPercentMode
                ? `Custom — ${depositPercent}% deposit`
                : (paymentTerms.find((t) => t.depositPercent === depositPercent)?.label ??
                  `${depositPercent}% deposit`)}
              <span className="text-white/40">{paymentTermsOpen ? "▲" : "▼"}</span>
            </button>

            {paymentTermsOpen && (
              <div className="absolute z-40 mt-1 w-80 bg-black border border-white/20 rounded-2xl shadow-xl p-2 max-h-96 overflow-y-auto">
                {paymentTerms.map((t) => {
                  const isEditing = editingTermId === t.id;
                  const busy = termBusyId === t.id;
                  if (isEditing) {
                    return (
                      <div key={t.id} className="px-2 py-2 border-b border-white/5 last:border-b-0">
                        <div className="flex flex-col gap-1.5">
                          <input
                            value={termEditDraft.label}
                            onChange={(e) => setTermEditDraft((d) => ({ ...d, label: e.target.value }))}
                            className="w-full border border-white/20 rounded-xl px-2 py-1 text-sm"
                            placeholder="Label"
                          />
                          <label className="flex items-center gap-1.5 text-xs text-white/60">
                            Deposit
                            <input
                              type="number"
                              min={1}
                              max={100}
                              value={termEditDraft.depositPercent}
                              onChange={(e) =>
                                setTermEditDraft((d) => ({
                                  ...d,
                                  depositPercent: Math.min(100, Math.max(1, Number(e.target.value) || 0)),
                                }))
                              }
                              className="w-16 border border-white/20 rounded-xl px-2 py-1 text-sm"
                            />
                            %
                          </label>
                          <div className="flex items-center gap-3">
                            <button
                              type="button"
                              onClick={() => saveTermEdit(t.id)}
                              disabled={busy}
                              className="text-xs font-semibold text-red hover:underline disabled:text-white/20"
                            >
                              {busy ? "Saving…" : "Save"}
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingTermId(null)}
                              className="text-xs text-white/60 hover:underline"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  }
                  return (
                    <div
                      key={t.id}
                      className="flex items-center gap-2 px-2 py-1.5 rounded-xl hover:bg-white/5 border-b border-white/5 last:border-b-0"
                    >
                      <button
                        type="button"
                        onClick={() => selectPaymentTerm(t)}
                        className="flex-1 min-w-0 text-left text-sm text-white/80"
                      >
                        <span className="truncate">{t.label}</span>{" "}
                        <span className="text-white/40">({t.depositPercent}%)</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => startEditTerm(t)}
                        className="text-xs text-white/50 hover:text-white hover:underline shrink-0"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteTerm(t)}
                        disabled={busy}
                        className="text-xs text-red-600 hover:underline shrink-0 disabled:text-white/20"
                      >
                        {busy ? "…" : "Delete"}
                      </button>
                    </div>
                  );
                })}

                <button
                  type="button"
                  onClick={() => {
                    setCustomPercentMode(true);
                    setPaymentTermsOpen(false);
                  }}
                  className="w-full text-left text-sm text-white/80 px-2 py-1.5 rounded-xl hover:bg-white/5 border-b border-white/5"
                >
                  Custom % (this quote only)
                </button>

                <div className="mt-1 pt-1 border-t border-white/10">
                  {!creatingTerm ? (
                    <button
                      type="button"
                      onClick={() => {
                        setCreatingTerm(true);
                        setEditingTermId(null);
                        setTermError(null);
                      }}
                      className="w-full text-left text-sm font-medium text-red px-2 py-1.5 rounded-xl hover:bg-white/5"
                    >
                      + Add custom payment term
                    </button>
                  ) : (
                    <div className="px-2 py-1.5 flex flex-col gap-1.5">
                      <input
                        value={newTermDraft.label}
                        onChange={(e) => setNewTermDraft((d) => ({ ...d, label: e.target.value }))}
                        placeholder="e.g. 25% deposit, balance on delivery"
                        className="w-full border border-white/20 rounded-xl px-2 py-1 text-sm"
                        autoFocus
                      />
                      <label className="flex items-center gap-1.5 text-xs text-white/60">
                        Deposit
                        <input
                          type="number"
                          min={1}
                          max={100}
                          value={newTermDraft.depositPercent}
                          onChange={(e) =>
                            setNewTermDraft((d) => ({
                              ...d,
                              depositPercent: Math.min(100, Math.max(1, Number(e.target.value) || 0)),
                            }))
                          }
                          className="w-16 border border-white/20 rounded-xl px-2 py-1 text-sm"
                        />
                        %
                      </label>
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={handleCreateTerm}
                          disabled={termBusyId === "__new__"}
                          className="text-xs font-semibold text-red hover:underline disabled:text-white/20"
                        >
                          {termBusyId === "__new__" ? "Adding…" : "Add & select"}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setCreatingTerm(false);
                            setNewTermDraft({ label: "", depositPercent: 100 });
                            setTermError(null);
                          }}
                          className="text-xs text-white/60 hover:underline"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {termError && <p className="px-2 py-1.5 text-xs text-red-500">{termError}</p>}
              </div>
            )}
          </div>

          {customPercentMode && (
            <label className="mt-2 flex items-center gap-1.5 text-xs text-white/60">
              Deposit
              <input
                type="number"
                min={1}
                max={99}
                value={depositPercent}
                onChange={(e) => setDepositPercent(Math.min(99, Math.max(1, Number(e.target.value) || 0)))}
                className="w-16 border border-white/20 rounded-xl px-2 py-1 text-sm"
              />
              %
            </label>
          )}

          {depositPercent < 100 && (
            <p className="mt-1.5 text-xs text-white/40">
              {depositPercent}% deposit due now, {100 - depositPercent}% balance due at pickup
            </p>
          )}
        </div>

        <div className="mt-3">
          <p className="text-xs text-white/60 mb-1">Tax</p>
          <div className="relative inline-block" ref={taxDropdownRef}>
            <button
              type="button"
              onClick={() => setTaxDropdownOpen((o) => !o)}
              className="flex items-center gap-2 text-sm px-3 py-1.5 rounded-xl border border-white/20 hover:bg-white/5"
            >
              {customTaxMode
                ? `Custom — ${taxRatePercent}% tax`
                : (taxRates.find((t) => t.ratePercent === taxRatePercent)?.label ??
                  (taxRatePercent === 0 ? "No tax" : `${taxRatePercent}% tax`))}
              <span className="text-white/40">{taxDropdownOpen ? "▲" : "▼"}</span>
            </button>

            {taxDropdownOpen && (
              <div className="absolute z-40 mt-1 w-80 bg-black border border-white/20 rounded-2xl shadow-xl p-2 max-h-96 overflow-y-auto">
                {taxRates.map((t) => {
                  const isEditing = editingTaxId === t.id;
                  const busy = taxBusyId === t.id;
                  if (isEditing) {
                    return (
                      <div key={t.id} className="px-2 py-2 border-b border-white/5 last:border-b-0">
                        <div className="flex flex-col gap-1.5">
                          <input
                            value={taxEditDraft.label}
                            onChange={(e) => setTaxEditDraft((d) => ({ ...d, label: e.target.value }))}
                            className="w-full border border-white/20 rounded-xl px-2 py-1 text-sm"
                            placeholder="Label"
                          />
                          <label className="flex items-center gap-1.5 text-xs text-white/60">
                            Rate
                            <input
                              type="number"
                              min={0}
                              max={100}
                              step="0.01"
                              value={taxEditDraft.ratePercent}
                              onChange={(e) =>
                                setTaxEditDraft((d) => ({
                                  ...d,
                                  ratePercent: Math.min(100, Math.max(0, Number(e.target.value) || 0)),
                                }))
                              }
                              className="w-20 border border-white/20 rounded-xl px-2 py-1 text-sm"
                            />
                            %
                          </label>
                          <div className="flex items-center gap-3">
                            <button
                              type="button"
                              onClick={() => saveTaxRateEdit(t.id)}
                              disabled={busy}
                              className="text-xs font-semibold text-red hover:underline disabled:text-white/20"
                            >
                              {busy ? "Saving…" : "Save"}
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingTaxId(null)}
                              className="text-xs text-white/60 hover:underline"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  }
                  return (
                    <div
                      key={t.id}
                      className="flex items-center gap-2 px-2 py-1.5 rounded-xl hover:bg-white/5 border-b border-white/5 last:border-b-0"
                    >
                      <button
                        type="button"
                        onClick={() => selectTaxRate(t)}
                        className="flex-1 min-w-0 text-left text-sm text-white/80"
                      >
                        <span className="truncate">{t.label}</span>{" "}
                        <span className="text-white/40">({t.ratePercent}%)</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => startEditTaxRate(t)}
                        className="text-xs text-white/50 hover:text-white hover:underline shrink-0"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteTaxRate(t)}
                        disabled={busy}
                        className="text-xs text-red-600 hover:underline shrink-0 disabled:text-white/20"
                      >
                        {busy ? "…" : "Delete"}
                      </button>
                    </div>
                  );
                })}

                <button
                  type="button"
                  onClick={() => {
                    setCustomTaxMode(true);
                    setTaxDropdownOpen(false);
                  }}
                  className="w-full text-left text-sm text-white/80 px-2 py-1.5 rounded-xl hover:bg-white/5 border-b border-white/5"
                >
                  Custom % (this quote only)
                </button>

                <div className="mt-1 pt-1 border-t border-white/10">
                  {!creatingTaxRate ? (
                    <button
                      type="button"
                      onClick={() => {
                        setCreatingTaxRate(true);
                        setEditingTaxId(null);
                        setTaxError(null);
                      }}
                      className="w-full text-left text-sm font-medium text-red px-2 py-1.5 rounded-xl hover:bg-white/5"
                    >
                      + Add custom tax rate
                    </button>
                  ) : (
                    <div className="px-2 py-1.5 flex flex-col gap-1.5">
                      <input
                        value={newTaxRateDraft.label}
                        onChange={(e) => setNewTaxRateDraft((d) => ({ ...d, label: e.target.value }))}
                        placeholder="e.g. 8.25% sales tax"
                        className="w-full border border-white/20 rounded-xl px-2 py-1 text-sm"
                        autoFocus
                      />
                      <label className="flex items-center gap-1.5 text-xs text-white/60">
                        Rate
                        <input
                          type="number"
                          min={0}
                          max={100}
                          step="0.01"
                          value={newTaxRateDraft.ratePercent}
                          onChange={(e) =>
                            setNewTaxRateDraft((d) => ({
                              ...d,
                              ratePercent: Math.min(100, Math.max(0, Number(e.target.value) || 0)),
                            }))
                          }
                          className="w-20 border border-white/20 rounded-xl px-2 py-1 text-sm"
                        />
                        %
                      </label>
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={handleCreateTaxRate}
                          disabled={taxBusyId === "__new__"}
                          className="text-xs font-semibold text-red hover:underline disabled:text-white/20"
                        >
                          {taxBusyId === "__new__" ? "Adding…" : "Add & select"}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setCreatingTaxRate(false);
                            setNewTaxRateDraft({ label: "", ratePercent: 0 });
                            setTaxError(null);
                          }}
                          className="text-xs text-white/60 hover:underline"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {taxError && <p className="px-2 py-1.5 text-xs text-red-500">{taxError}</p>}
              </div>
            )}
          </div>

          {customTaxMode && (
            <label className="mt-2 flex items-center gap-1.5 text-xs text-white/60">
              Rate
              <input
                type="number"
                min={0}
                max={100}
                step="0.01"
                value={taxRatePercent}
                onChange={(e) => setTaxRatePercent(Math.min(100, Math.max(0, Number(e.target.value) || 0)))}
                className="w-20 border border-white/20 rounded-xl px-2 py-1 text-sm"
              />
              %
            </label>
          )}
        </div>
      </section>
      )}

      {mode === "full" && !activeRecord && (
        <div className="flex flex-col items-start gap-2">
          <button
            onClick={saveQuote}
            disabled={saving}
            className="text-sm font-semibold px-6 py-2.5 rounded-xl bg-green-600 text-white hover:bg-green-700 disabled:opacity-40"
          >
            {saving ? "Saving…" : "Save & add line item"}
          </button>
          <p className="text-xs text-white/40">
            Saves the customer details, payment terms, and tax above, assigns this quote a quote
            number, and unlocks the Items section below so you can add garments and charges.
          </p>
          {quoteError && <p className="text-xs text-red-600">{quoteError}</p>}
        </div>
      )}

      {/* Items — everything that adds to the quote total, grouped into its
          own clearly separate sections: Setup charges, Other charges (ad-hoc
          one-off fees), and Garments. Each stays its own card below, same as
          before — this just gives them a shared heading, matching the
          "Quote details" section above it. Hidden until the quote has been
          saved at least once in "full" mode (see the "Save & add line
          item" button above) so a brand-new quote always has an explicit
          save step — mirroring the reference quoting tool's two-phase flow. */}
      {(mode === "quick" || activeRecord) && (
      <div>
        <h2 className="text-lg font-bold text-white mb-1">Items</h2>
        <p className="text-sm text-white/50 mb-4">
          Everything that adds to this quote&apos;s total — garments, setup charges, and any other
          one-off charges. Starts blank; use &quot;+ Add item&quot; below to add a garment, a setup
          charge, or another one-off charge, and it shows up here right away.
        </p>

        <div className="space-y-6">

        {/* Unified running list of every item on this quote so far — garment
            lines, selected setup charges, and ad-hoc other charges together,
            in the order they were added, each removable right from this
            list. Blank by design until something's added (no empty
            "Setup charges" / "Garments" cards sitting around with nothing
            in them), matching the reference quoting tool's single central
            Items list. */}
        <section className="bg-black border border-white/10 shadow-lg shadow-black/30 rounded-2xl p-4">
          <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
            <h3 className="text-sm font-semibold text-white">
              Items ({lines.length + selectedSetupChargeIds.length + miscFees.length})
            </h3>
            <div className="relative" ref={addItemMenuRef}>
              <button
                type="button"
                onClick={() => setAddItemMenuOpen((o) => !o)}
                className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-xl bg-red text-navy font-semibold hover:bg-red/90"
              >
                + Add item <span className="text-navy/60">{addItemMenuOpen ? "▲" : "▼"}</span>
              </button>
              {addItemMenuOpen && (
                <div className="absolute right-0 z-40 mt-1 w-48 bg-black border border-white/20 rounded-2xl shadow-xl p-1.5">
                  {(
                    [
                      ["garment", "Garment"],
                      ["setup", "Setup charge"],
                      ["misc", "Other charge"],
                    ] as const
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => {
                        setAddItemMode(key);
                        setAddItemMenuOpen(false);
                      }}
                      className="w-full text-left text-sm text-white/80 px-2.5 py-1.5 rounded-xl hover:bg-white/5"
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {lines.length === 0 && selectedSetupChargeIds.length === 0 && miscFees.length === 0 ? (
            <p className="text-sm text-white/40">
              No items yet — tap &quot;+ Add item&quot; above to add a garment or a charge.
            </p>
          ) : (
            <div className="space-y-2">
              {lines.map((line, idx) => {
                const decoration = decorations.find((d) => d.id === line.decorationId);
                const column = decoration?.priceColumns?.find((c) => c.id === line.priceColumnId);
                const totalQty = line.sizes.reduce((sum, s) => sum + s.quantity, 0);
                return (
                  <div
                    key={line.key}
                    className="flex items-start gap-3 border border-white/15 rounded-xl px-3 py-2.5 bg-white/[0.015]"
                  >
                    {line.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={productPreviewImageUrl(line.imageUrl, line.imageFallbackUrl)}
                        alt=""
                        className="shrink-0 w-10 h-10 rounded-lg object-contain bg-white/5 border border-white/10"
                      />
                    ) : (
                      <div className="shrink-0 w-6 h-6 mt-0.5 rounded-full bg-white/10 text-white/60 text-xs font-semibold flex items-center justify-center">
                        {idx + 1}
                      </div>
                    )}
                    <div className="flex-1 min-w-0 flex items-start justify-between gap-3">
                      <div className="text-sm text-white">
                        {line.customerSupplied ? (
                          <>
                            <span className="font-medium">Customer-supplied item</span>{" "}
                            <span className="text-white/40">({line.itemDescription})</span>
                          </>
                        ) : (
                          <>
                            <span className="font-medium">
                              {line.brandName} {line.productName}
                            </span>{" "}
                            <span className="text-white/40">
                              ({line.styleNumber} — {line.colorName})
                            </span>
                          </>
                        )}
                        <div className="text-xs text-white/60 mt-0.5">
                          {line.sizes.map((s) => `${s.size}×${s.quantity}`).join(", ")} · {totalQty} total
                          {decoration ? ` · ${decoration.label}${column ? ` (${column.label})` : ""}` : ""}
                        </div>
                      </div>
                      <button
                        onClick={() => removeLine(line.key)}
                        className="text-xs text-red-600 hover:underline shrink-0"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                );
              })}

              {selectedSetupChargeIds.map((id) => {
                const c = setupCharges.find((sc) => sc.id === id);
                if (!c) return null;
                return (
                  <div
                    key={id}
                    className="flex items-center gap-3 border border-white/15 rounded-xl px-3 py-2.5 bg-white/[0.015]"
                  >
                    <div className="shrink-0 w-6 h-6 rounded-full bg-white/10 text-white/60 text-xs font-semibold flex items-center justify-center">
                      $
                    </div>
                    <div className="flex-1 min-w-0 flex items-center justify-between gap-3">
                      <div className="text-sm text-white">
                        <span className="font-medium">{c.label}</span>{" "}
                        <span className="text-white/40">({formatUSD(c.price)}) · Setup charge</span>
                      </div>
                      <button
                        onClick={() => toggleSetupCharge(id, false)}
                        className="text-xs text-red-600 hover:underline shrink-0"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                );
              })}

              {miscFees.map((f) => (
                <div
                  key={f.id}
                  className="flex items-center gap-3 border border-white/15 rounded-xl px-3 py-2.5 bg-white/[0.015]"
                >
                  <div className="shrink-0 w-6 h-6 rounded-full bg-white/10 text-white/60 text-xs font-semibold flex items-center justify-center">
                    $
                  </div>
                  <div className="flex-1 min-w-0 flex items-center justify-between gap-3">
                    <div className="text-sm text-white">
                      <span className="font-medium">{f.label}</span>{" "}
                      <span className="text-white/40">
                        (
                        {f.quantity > 1
                          ? `${f.quantity} × ${formatUSD(f.amount)} = ${formatUSD(f.amount * f.quantity)}`
                          : formatUSD(f.amount)}
                        ) · Other charge
                      </span>
                    </div>
                    <button
                      onClick={() => removeMiscFee(f.id)}
                      className="text-xs text-red-600 hover:underline shrink-0"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="mt-4 flex flex-wrap gap-2 border-t border-white/10 pt-4">
            <button
              onClick={generateQuote}
              disabled={quoteLoading}
              className="text-sm px-4 py-1.5 rounded-xl bg-navy text-white hover:bg-navy/90 disabled:opacity-40"
            >
              {quoteLoading ? "Calculating…" : "Preview quote"}
            </button>
            {mode === "full" ? (
              <>
                <button
                  onClick={saveQuote}
                  disabled={saving}
                  className="text-sm px-4 py-1.5 rounded-xl bg-red text-navy hover:bg-red/90 disabled:opacity-40"
                >
                  {saving ? "Saving…" : activeRecord ? "Save changes" : "Save quote"}
                </button>
                {activeRecord && activeRecord.status === "quote" && (
                  <button
                    onClick={convertToInvoice}
                    disabled={converting}
                    className="text-sm px-4 py-1.5 rounded-xl border border-white/20 hover:bg-white/5 disabled:opacity-40"
                  >
                    {converting ? "Converting…" : "Convert to invoice"}
                  </button>
                )}
                {activeRecord && activeRecord.status === "invoice" && (
                  <button
                    onClick={convertToQuote}
                    disabled={convertingToQuote}
                    className="text-sm px-4 py-1.5 rounded-xl border border-white/20 hover:bg-white/5 disabled:opacity-40"
                  >
                    {convertingToQuote ? "Converting…" : "Convert to quote"}
                  </button>
                )}
              </>
            ) : (
              <button
                onClick={() => onCreateQuote?.(lines, selectedSetupChargeIds)}
                disabled={lines.length === 0}
                className="text-sm px-4 py-1.5 rounded-xl bg-red text-navy hover:bg-red/90 disabled:opacity-40"
                title="Carry these items into a full quote where you can add the customer's info and save it"
              >
                Create quote
              </button>
            )}
          </div>

          {mode === "full" && (
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                onClick={() => downloadPdf("customer")}
                disabled={pdfLoading !== null}
                className="text-sm px-4 py-1.5 rounded-xl border border-white/20 hover:bg-white/5 disabled:opacity-40"
              >
                {pdfLoading === "customer" ? "Generating…" : "Download customer PDF"}
              </button>
              <button
                onClick={() => downloadPdf("internal")}
                disabled={pdfLoading !== null}
                className="text-sm px-4 py-1.5 rounded-xl border border-red/30 text-red hover:bg-red/5 disabled:opacity-40"
              >
                {pdfLoading === "internal" ? "Generating…" : "Download company PDF (with cost)"}
              </button>
              <button
                onClick={() => downloadPdf("work-order")}
                disabled={pdfLoading !== null}
                className="text-sm px-4 py-1.5 rounded-xl border border-white/20 hover:bg-white/5 disabled:opacity-40"
              >
                {pdfLoading === "work-order" ? "Generating…" : "Download work order"}
              </button>
              {activeRecord?.status === "invoice" && (
                <button
                  onClick={() => downloadPdf("invoice")}
                  disabled={pdfLoading !== null}
                  className="text-sm px-4 py-1.5 rounded-xl border border-green-600/30 text-green-700 hover:bg-green-50 disabled:opacity-40"
                >
                  {pdfLoading === "invoice" ? "Generating…" : "Download invoice PDF"}
                </button>
              )}
              {activeRecord && (
                <button
                  onClick={() => setSendModalOpen(true)}
                  className="text-sm px-4 py-1.5 rounded-xl bg-white/10 text-white hover:bg-white/15"
                >
                  Send to customer
                </button>
              )}
            </div>
          )}
          <p className="mt-2 text-xs text-white/40">
            {mode === "full" ? (
              <>
                The customer PDF shows only the final unit price and totals. The company PDF adds
                garment cost and decoration cost columns and is marked &quot;internal use only.&quot;
                The work order has no pricing at all — just garments, sizes, quantities, and
                decoration details for production staff. Saving keeps this quote on the &quot;Saved
                quotes &amp; invoices&quot; list below so it can be reopened, edited, or converted to
                an invoice later.
              </>
            ) : (
              <>
                This is just a quick price check — nothing is saved yet. If the customer wants to
                order, tap &quot;Create quote&quot; to carry these items over to the Quotes tab, where
                you can add their info and save it for real.
              </>
            )}
          </p>
          {mode === "full" && saveMessage && <p className="mt-2 text-xs text-green-700">{saveMessage}</p>}
          {quoteError && <p className="mt-2 text-xs text-red-600">{quoteError}</p>}
        </section>

      {/* Setup charges — flat, quote-wide, independent of any decoration.
          A dropdown picker that also doubles as an inline editor for the
          shared catalog (edit label/price, delete, or add a brand-new
          custom one) — applies to every charge in the list, including the
          three seeded defaults (Digitizing, Logo vectorization, Screen
          print screen fee), not just ones added here. Only shown while
          "Setup charge" is the open "+ Add item" panel — the charges
          already picked live in the unified Items list above, not here. */}
      {addItemMode === "setup" && (
      <section className="bg-black border border-white/10 shadow-lg shadow-black/30 rounded-2xl p-4">
        <div className="flex items-start justify-between gap-3 mb-1">
          <h3 className="text-sm font-semibold text-white">Add a setup charge</h3>
          <button
            type="button"
            onClick={() => setAddItemMode(null)}
            className="text-xs text-white/40 hover:text-white shrink-0"
          >
            ✕ Close
          </button>
        </div>
        <p className="text-xs text-white/50 mb-3">
          One-time charges for this quote as a whole — not tied to any garment or decoration.
        </p>

        <div className="relative inline-block" ref={setupDropdownRef}>
          <button
            type="button"
            onClick={() => setSetupDropdownOpen((o) => !o)}
            className="flex items-center gap-2 text-sm px-3 py-1.5 rounded-xl border border-white/20 hover:bg-white/5"
          >
            {selectedSetupChargeIds.length > 0
              ? `${selectedSetupChargeIds.length} setup charge${selectedSetupChargeIds.length === 1 ? "" : "s"} selected`
              : "Add setup charges"}
            <span className="text-white/40">{setupDropdownOpen ? "▲" : "▼"}</span>
          </button>

          {setupDropdownOpen && (
            <div className="absolute z-40 mt-1 w-80 bg-black border border-white/20 rounded-2xl shadow-xl p-2 max-h-96 overflow-y-auto">
              {setupCharges.length === 0 && !creatingCharge && (
                <p className="text-xs text-white/40 px-2 py-2">No setup charges configured yet.</p>
              )}
              {setupCharges.map((c) => {
                const checked = selectedSetupChargeIds.includes(c.id);
                const isEditing = editingChargeId === c.id;
                const busy = chargeBusyId === c.id;
                if (isEditing) {
                  return (
                    <div key={c.id} className="px-2 py-2 border-b border-white/5 last:border-b-0">
                      <div className="flex flex-col gap-1.5">
                        <input
                          value={chargeEditDraft.label}
                          onChange={(e) => setChargeEditDraft((d) => ({ ...d, label: e.target.value }))}
                          className="w-full border border-white/20 rounded-xl px-2 py-1 text-sm"
                          placeholder="Label"
                        />
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          value={chargeEditDraft.price}
                          onChange={(e) =>
                            setChargeEditDraft((d) => ({ ...d, price: Math.max(0, Number(e.target.value) || 0) }))
                          }
                          className="w-28 border border-white/20 rounded-xl px-2 py-1 text-sm"
                          placeholder="Price"
                        />
                        <label className="flex items-center gap-1.5 text-xs text-white/60">
                          <input
                            type="checkbox"
                            checked={chargeEditDraft.taxable}
                            onChange={(e) =>
                              setChargeEditDraft((d) => ({ ...d, taxable: e.target.checked }))
                            }
                          />
                          Taxable
                        </label>
                        <div className="flex items-center gap-3">
                          <button
                            type="button"
                            onClick={() => saveChargeEdit(c.id)}
                            disabled={busy}
                            className="text-xs font-semibold text-red hover:underline disabled:text-white/20"
                          >
                            {busy ? "Saving…" : "Save"}
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingChargeId(null)}
                            className="text-xs text-white/60 hover:underline"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                }
                return (
                  <div
                    key={c.id}
                    className="flex items-center gap-2 px-2 py-1.5 rounded-xl hover:bg-white/5 border-b border-white/5 last:border-b-0"
                  >
                    <label className="flex items-center gap-2 flex-1 min-w-0 text-sm text-white/80 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => toggleSetupCharge(c.id, e.target.checked)}
                      />
                      <span className="truncate">{c.label}</span>
                      <span className="text-white/40 shrink-0">({formatUSD(c.price)})</span>
                    </label>
                    <button
                      type="button"
                      onClick={() => startEditCharge(c)}
                      className="text-xs text-white/50 hover:text-white hover:underline shrink-0"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteCharge(c)}
                      disabled={busy}
                      className="text-xs text-red-600 hover:underline shrink-0 disabled:text-white/20"
                    >
                      {busy ? "…" : "Delete"}
                    </button>
                  </div>
                );
              })}

              <div className="mt-1 pt-1 border-t border-white/10">
                {!creatingCharge ? (
                  <button
                    type="button"
                    onClick={() => {
                      setCreatingCharge(true);
                      setEditingChargeId(null);
                      setChargeError(null);
                    }}
                    className="w-full text-left text-sm font-medium text-red px-2 py-1.5 rounded-xl hover:bg-white/5"
                  >
                    + Add custom setup charge
                  </button>
                ) : (
                  <div className="px-2 py-1.5 flex flex-col gap-1.5">
                    <input
                      value={newChargeDraft.label}
                      onChange={(e) => setNewChargeDraft((d) => ({ ...d, label: e.target.value }))}
                      placeholder="e.g. Rush digitizing"
                      className="w-full border border-white/20 rounded-xl px-2 py-1 text-sm"
                      autoFocus
                    />
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={newChargeDraft.price}
                      onChange={(e) =>
                        setNewChargeDraft((d) => ({ ...d, price: Math.max(0, Number(e.target.value) || 0) }))
                      }
                      placeholder="Price"
                      className="w-28 border border-white/20 rounded-xl px-2 py-1 text-sm"
                    />
                    <label className="flex items-center gap-1.5 text-xs text-white/60">
                      <input
                        type="checkbox"
                        checked={newChargeDraft.taxable}
                        onChange={(e) => setNewChargeDraft((d) => ({ ...d, taxable: e.target.checked }))}
                      />
                      Taxable
                    </label>
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={handleCreateCharge}
                        disabled={chargeBusyId === "__new__"}
                        className="text-xs font-semibold text-red hover:underline disabled:text-white/20"
                      >
                        {chargeBusyId === "__new__" ? "Adding…" : "Add & select"}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setCreatingCharge(false);
                          setNewChargeDraft({ label: "", price: 0, taxable: true });
                          setChargeError(null);
                        }}
                        className="text-xs text-white/60 hover:underline"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {chargeError && <p className="px-2 py-1.5 text-xs text-red-500">{chargeError}</p>}
            </div>
          )}
        </div>

        {selectedSetupChargeIds.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {selectedSetupChargeIds.map((id) => {
              const c = setupCharges.find((sc) => sc.id === id);
              if (!c) return null;
              return (
                <span
                  key={id}
                  className="flex items-center gap-1.5 text-xs bg-white/5 border border-white/10 shadow-lg shadow-black/30 rounded-full pl-3 pr-1.5 py-1 text-white/80"
                >
                  {c.label} <span className="text-white/40">({formatUSD(c.price)})</span>
                  <button
                    type="button"
                    onClick={() => toggleSetupCharge(id, false)}
                    aria-label={`Remove ${c.label} from this quote`}
                    className="w-4 h-4 flex items-center justify-center rounded-full hover:bg-white/10 text-white/50 hover:text-white"
                  >
                    ✕
                  </button>
                </span>
              );
            })}
          </div>
        )}
      </section>
      )}

      {/* Other charges — ad-hoc, one-off charges for this quote only (a rush
          fee, a shipping surcharge), distinct from the reusable Setup
          Charges above. Internally still "misc fees" (lib/quote.ts's
          QuoteInput.miscFees) — only the admin-facing label changed. Only
          shown in "full" mode, and only while "Other charge" is the open
          "+ Add item" panel — fees already added live in the unified Items
          list above, not here. */}
      {mode === "full" && addItemMode === "misc" && (
      <section className="bg-black border border-white/10 shadow-lg shadow-black/30 rounded-2xl p-4">
        <div className="flex items-start justify-between gap-3 mb-1">
          <h3 className="text-sm font-semibold text-white">Add another charge</h3>
          <button
            type="button"
            onClick={() => setAddItemMode(null)}
            className="text-xs text-white/40 hover:text-white shrink-0"
          >
            ✕ Close
          </button>
        </div>
        <p className="text-xs text-white/50 mb-3">
          One-off charges for this quote only — a rush fee, a shipping surcharge, anything that
          isn&apos;t a garment or a reusable setup charge. These aren&apos;t added to the Setup
          Charges list.
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-white/60">
            Description
            <input
              value={miscFeeLabel}
              onChange={(e) => setMiscFeeLabel(e.target.value)}
              placeholder="e.g. Rush fee, Shipping"
              className="mt-1 w-48 border border-white/20 rounded-xl px-2 py-1.5 text-sm"
            />
          </label>
          <label className="text-xs text-white/60">
            Amount
            <input
              type="number"
              min={0}
              step="0.01"
              value={miscFeeAmount}
              onChange={(e) => setMiscFeeAmount(e.target.value)}
              placeholder="0.00"
              className="mt-1 w-28 border border-white/20 rounded-xl px-2 py-1.5 text-sm"
            />
          </label>
          <label className="text-xs text-white/60">
            Quantity
            <input
              type="number"
              min={1}
              step="1"
              value={miscFeeQuantity}
              onChange={(e) => setMiscFeeQuantity(e.target.value)}
              placeholder="1"
              className="mt-1 w-20 border border-white/20 rounded-xl px-2 py-1.5 text-sm"
            />
          </label>
          <label className="flex items-center gap-1.5 text-xs text-white/60 pb-1.5">
            <input
              type="checkbox"
              checked={miscFeeTaxable}
              onChange={(e) => setMiscFeeTaxable(e.target.checked)}
            />
            Taxable
          </label>
          <button
            type="button"
            onClick={addMiscFee}
            className="text-sm px-4 py-1.5 rounded-xl bg-red text-navy hover:bg-red/90"
          >
            + Add fee
          </button>
          {(() => {
            const amt = Math.max(0, Number(miscFeeAmount) || 0);
            const qty = Math.max(1, Number(miscFeeQuantity) || 1);
            return amt > 0 ? (
              <span className="text-xs text-white/50 pb-1.5">
                Total: <span className="font-semibold text-white">{formatUSD(amt * qty)}</span>
              </span>
            ) : null;
          })()}
        </div>
        {miscFeeError && <p className="mt-2 text-xs text-red-600">{miscFeeError}</p>}
      </section>
      )}

      {/* Add a garment — guided flow: decoration, catalog, product, color,
          sizes, locations, in that order, matching the shop's other
          quoting tool. Only shown while "Garment" is the open "+ Add item"
          panel; stays open after each "Add to quote" (rather than
          auto-closing) since a real order is usually several
          styles/colors added back-to-back under the same decoration. */}
      {addItemMode === "garment" && (
      <section className="bg-black border border-white/10 shadow-lg shadow-black/30 rounded-2xl p-4">
        <div className="flex items-start justify-between gap-3 mb-3">
          <h3 className="text-sm font-semibold text-white">Add a garment</h3>
          <button
            type="button"
            onClick={() => setAddItemMode(null)}
            className="text-xs text-white/40 hover:text-white shrink-0"
          >
            ✕ Close
          </button>
        </div>

        <label className="flex items-center gap-1.5 text-xs text-white/60 mb-3">
          <input
            type="checkbox"
            checked={lineTaxable}
            onChange={(e) => setLineTaxable(e.target.checked)}
          />
          Taxable (applies to the next garment added below)
        </label>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-w-xl">
          <div className="text-xs text-white/60">
            Decoration type
            <div className="relative mt-1" ref={decorationDropdownRef}>
              <button
                type="button"
                onClick={() => setDecorationDropdownOpen((o) => !o)}
                className="flex items-center justify-between gap-2 w-full text-sm px-2 py-1.5 rounded-xl border border-white/20 hover:bg-white/5 text-left"
              >
                <span className="truncate">
                  {selectedDecorationId
                    ? (decorations.find((d) => d.id === selectedDecorationId)?.label ?? "—")
                    : "None — garment only"}
                </span>
                <span className="text-white/40 shrink-0">{decorationDropdownOpen ? "▲" : "▼"}</span>
              </button>

              {decorationDropdownOpen && (
                <div className="absolute z-40 mt-1 w-80 bg-black border border-white/20 rounded-2xl shadow-xl p-2 max-h-96 overflow-y-auto">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedDecorationId("");
                      setSelectedColumnId("");
                      setDecorationDropdownOpen(false);
                    }}
                    className="w-full text-left text-sm text-white/80 px-2 py-1.5 rounded-xl hover:bg-white/5 border-b border-white/5"
                  >
                    None — garment only
                  </button>
                  {decorationsLoaded && decorations.length === 0 && !creatingDecoration && (
                    <p className="text-xs text-white/40 px-2 py-2">No decoration types configured yet.</p>
                  )}
                  {decorations.map((d) => {
                    const isEditing = editingDecorationId === d.id;
                    const busy = decorationBusyId === d.id;
                    if (isEditing) {
                      return (
                        <div key={d.id} className="px-2 py-2 border-b border-white/5 last:border-b-0">
                          <div className="flex flex-col gap-1.5">
                            <input
                              value={decorationEditLabel}
                              onChange={(e) => setDecorationEditLabel(e.target.value)}
                              className="w-full border border-white/20 rounded-xl px-2 py-1 text-sm"
                              placeholder="Name"
                              autoFocus
                            />
                            <div className="flex items-center gap-3">
                              <button
                                type="button"
                                onClick={() => saveDecorationEdit(d.id)}
                                disabled={busy}
                                className="text-xs font-semibold text-red hover:underline disabled:text-white/20"
                              >
                                {busy ? "Saving…" : "Save"}
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingDecorationId(null)}
                                className="text-xs text-white/60 hover:underline"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    }
                    return (
                      <div
                        key={d.id}
                        className="flex items-center gap-2 px-2 py-1.5 rounded-xl hover:bg-white/5 border-b border-white/5 last:border-b-0"
                      >
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedDecorationId(d.id);
                            setSelectedColumnId("");
                            setDecorationDropdownOpen(false);
                          }}
                          className="flex-1 min-w-0 text-left text-sm text-white/80 truncate"
                        >
                          {d.label}
                        </button>
                        <button
                          type="button"
                          onClick={() => startEditDecoration(d)}
                          className="text-xs text-white/50 hover:text-white hover:underline shrink-0"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteDecoration(d)}
                          disabled={busy}
                          className="text-xs text-red-600 hover:underline shrink-0 disabled:text-white/20"
                        >
                          {busy ? "…" : "Delete"}
                        </button>
                      </div>
                    );
                  })}

                  <div className="mt-1 pt-1 border-t border-white/10">
                    {!creatingDecoration ? (
                      <button
                        type="button"
                        onClick={() => {
                          setCreatingDecoration(true);
                          setEditingDecorationId(null);
                          setDecorationError(null);
                        }}
                        className="w-full text-left text-sm font-medium text-red px-2 py-1.5 rounded-xl hover:bg-white/5"
                      >
                        + Add decoration type
                      </button>
                    ) : (
                      <div className="px-2 py-1.5 flex flex-col gap-1.5">
                        <input
                          value={newDecorationLabel}
                          onChange={(e) => setNewDecorationLabel(e.target.value)}
                          placeholder="e.g. Banner, Vinyl Decal"
                          className="w-full border border-white/20 rounded-xl px-2 py-1 text-sm"
                          autoFocus
                        />
                        <div className="flex items-center gap-3">
                          <button
                            type="button"
                            onClick={handleCreateDecoration}
                            disabled={decorationBusyId === "__new__"}
                            className="text-xs font-semibold text-red hover:underline disabled:text-white/20"
                          >
                            {decorationBusyId === "__new__" ? "Adding…" : "Add & select"}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setCreatingDecoration(false);
                              setNewDecorationLabel("");
                              setDecorationError(null);
                            }}
                            className="text-xs text-white/60 hover:underline"
                          >
                            Cancel
                          </button>
                        </div>
                        <p className="text-[11px] text-white/40">
                          Added with $0 pricing — fine-tune its price, turnaround, and file types on the
                          Pricing tab.
                        </p>
                      </div>
                    )}
                  </div>

                  {decorationError && <p className="px-2 py-1.5 text-xs text-red-500">{decorationError}</p>}
                </div>
              )}
            </div>
          </div>

          <label className="text-xs text-white/60">
            Catalog
            <select
              value={catalogSource}
              onChange={(e) => onCatalogChange(e.target.value as CatalogSource)}
              className="mt-1 w-full border border-white/20 rounded-xl px-2 py-1.5 text-sm"
            >
              {CATALOG_OPTIONS.map((c) => (
                <option key={c.id} value={c.id} disabled={c.disabled}>
                  {c.label}
                  {c.disabled ? " (not connected)" : ""}
                </option>
              ))}
            </select>
          </label>
        </div>

        {catalogSource === "customer-supplied" ? (
          <div className="mt-4 border-t border-white/10 pt-4 max-w-xl">
            <label className="block text-xs text-white/60">
              Item description
              <input
                value={csDescription}
                onChange={(e) => setCsDescription(e.target.value)}
                className="mt-1 w-full border border-white/20 rounded-xl px-2 py-1.5 text-sm"
                placeholder="e.g. Hat, Shirt, Bag, Custom item"
              />
            </label>

            <div className="mt-3 flex flex-wrap gap-4 text-sm text-white/70">
              <label className="flex items-center gap-1.5">
                <input
                  type="radio"
                  name="csQuantityMode"
                  checked={csQuantityMode === "flat"}
                  onChange={() => setCsQuantityMode("flat")}
                />
                Just a total quantity
              </label>
              <label className="flex items-center gap-1.5">
                <input
                  type="radio"
                  name="csQuantityMode"
                  checked={csQuantityMode === "sizes"}
                  onChange={() => setCsQuantityMode("sizes")}
                />
                Break down by size
              </label>
            </div>

            {csQuantityMode === "flat" ? (
              <label className="block text-xs text-white/60 mt-3 max-w-[160px]">
                Number of items
                <input
                  type="number"
                  min={0}
                  value={csFlatQuantity}
                  onChange={(e) => setCsFlatQuantity(Math.max(0, Number(e.target.value) || 0))}
                  className="mt-1 w-full border border-white/20 rounded-xl px-2 py-1.5 text-sm"
                />
              </label>
            ) : (
              <div className="mt-3">
                <span className="text-xs font-medium text-white/60 uppercase tracking-wide">
                  Sizes &amp; quantities
                </span>
                <div className="mt-1.5 space-y-1.5">
                  {csSizeRows.map((row, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input
                        value={row.size}
                        onChange={(e) => {
                          const next = [...csSizeRows];
                          next[i] = { ...next[i], size: e.target.value };
                          setCsSizeRows(next);
                        }}
                        placeholder="Size (e.g. M, OSFA)"
                        className="w-32 border border-white/20 rounded-xl px-2 py-1 text-sm"
                      />
                      <input
                        type="number"
                        min={0}
                        value={row.quantity}
                        onChange={(e) => {
                          const next = [...csSizeRows];
                          next[i] = { ...next[i], quantity: Math.max(0, Number(e.target.value) || 0) };
                          setCsSizeRows(next);
                        }}
                        placeholder="Qty"
                        className="w-20 border border-white/20 rounded-xl px-2 py-1 text-sm"
                      />
                      <button
                        type="button"
                        onClick={() => setCsSizeRows((prev) => prev.filter((_, idx) => idx !== i))}
                        className="text-xs text-red-600 hover:underline"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => setCsSizeRows((prev) => [...prev, { size: "", quantity: 0 }])}
                  className="mt-2 text-xs px-2 py-1 rounded-xl border border-white/20 hover:bg-white/5"
                >
                  + Add size row
                </button>
              </div>
            )}

            {selectedDecoration?.priceColumns && selectedDecoration.priceColumns.length > 0 && (
              <label className="block text-xs text-white/60 mt-4 max-w-xs">
                {columnLabel}
                <select
                  value={selectedColumnId}
                  onChange={(e) => setSelectedColumnId(e.target.value)}
                  className="mt-1 w-full border border-white/20 rounded-xl px-2 py-1.5 text-sm"
                >
                  <option value="">Select…</option>
                  {selectedDecoration.priceColumns.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {selectedDecoration?.quoteRequired && (
              <p className="mt-2 text-xs text-amber-700">
                This decoration type is marked &quot;quote required&quot; site-wide, so it will price at $0
                here too — set an explicit price on the Pricing tab if you want this quote to reflect a
                real cost.
              </p>
            )}

            <p className="mt-2 text-xs text-white/40">
              No garment cost is charged for a customer-supplied item — only decoration pricing (if a
              decoration type is selected above) applies.
            </p>

            {csError && <p className="mt-2 text-xs text-red-600">{csError}</p>}

            <button
              onClick={addCustomerSuppliedLine}
              className="mt-4 text-sm px-4 py-1.5 rounded-xl bg-red text-navy hover:bg-red/90"
            >
              Add to quote
            </button>
          </div>
        ) : (
          <>
            <div className="relative mt-3 max-w-xl">
              <label className="text-xs text-white/60">
                Product
                <input
                  value={productQuery}
                  onChange={(e) => onProductQueryChange(e.target.value)}
                  onFocus={() => productSuggestions.length > 0 && setSuggestionsOpen(true)}
                  onBlur={() => setTimeout(() => setSuggestionsOpen(false), 150)}
                  className="mt-1 w-full border border-white/20 rounded-xl px-2 py-1.5 text-sm disabled:opacity-40 disabled:bg-white/5"
                  placeholder={
                    catalogSource === "ss"
                      ? "Start typing a style number or name — e.g. 2000"
                      : "Start typing a style number or name — e.g. st640"
                  }
                />
              </label>
              {searchLoading && (
                <span className="absolute right-2 top-8 text-[11px] text-white/30">searching…</span>
              )}
              {suggestionsOpen && productSuggestions.length > 0 && (
                <ul className="absolute z-40 mt-1 w-full max-h-64 overflow-y-auto bg-black border border-white/20 rounded-xl shadow-lg text-sm">
                  {productSuggestions.map((r) => (
                    <li key={r.styleNumber}>
                      <button
                        type="button"
                        // onMouseDown (not onClick) fires before the input's onBlur closes the list.
                        onMouseDown={() => selectProduct(r)}
                        className="flex items-center gap-2 w-full text-left px-3 py-2 hover:bg-white/5"
                      >
                        {r.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={productPreviewImageUrl(r.imageUrl)}
                            alt=""
                            className="w-8 h-8 shrink-0 rounded-md object-contain bg-white/5"
                          />
                        ) : (
                          <span className="w-8 h-8 shrink-0 rounded-md bg-white/5" />
                        )}
                        <span className="min-w-0">
                          <span className="font-medium text-white">{r.name}</span>{" "}
                          <span className="text-white/40">
                            {r.brand} · {r.styleNumber}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {suggestionsOpen &&
                !searchLoading &&
                productSuggestions.length === 0 &&
                productQuery.trim().length >= 2 && (
                  <p className="mt-1 text-xs text-white/40">No matches for &quot;{productQuery}&quot;.</p>
                )}
            </div>
            {lookupLoading && <p className="mt-2 text-xs text-white/40">Loading product…</p>}
            {lookupError && <p className="mt-2 text-xs text-red-600">{lookupError}</p>}

            {foundProduct && (
              <div className="mt-4 border-t border-white/10 pt-4">
                <div className="flex items-start gap-3">
                  {selectedColorRow?.imageUrl && (
                    // A picture of the shirt and color being selected — mirrors
                    // the reference quoting tool showing a product photo as
                    // soon as a color is picked, instead of plain text only.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={productPreviewImageUrl(selectedColorRow.imageUrl, selectedColorRow.imageFallbackUrl)}
                      alt={`${foundProduct.productName} — ${selectedColor}`}
                      className="w-20 h-20 shrink-0 rounded-xl object-contain bg-white/5 border border-white/10"
                    />
                  )}
                  <p className="text-sm font-medium text-white">
                    {foundProduct.brandName} {foundProduct.productName}{" "}
                    <span className="text-white/40 font-normal">({foundProduct.styleNumber})</span>
                    {catalogSource === "sanmar" && (
                      <span className="ml-2 text-[11px] text-white/40">
                        {foundProductLive ? "live SanMar pricing" : "catalog list price (live pricing unavailable)"}
                      </span>
                    )}
                    {catalogSource === "ss" && (
                      <span className="ml-2 text-[11px] text-white/40">live S&amp;S Activewear pricing</span>
                    )}
                  </p>
                </div>

                <label className="block text-xs text-white/60 mt-3 max-w-xs">
                  Color
                  <select
                    value={selectedColor}
                    onChange={(e) => {
                      setSelectedColor(e.target.value);
                      const color = foundProduct.colors.find((c) => c.colorName === e.target.value);
                      const next: Record<string, number> = {};
                      const nextSizes = color?.sizes ?? [];
                      if (nextSizes.length > 0) {
                        for (const sz of nextSizes) next[sz.name] = 0;
                      } else {
                        next[ONE_SIZE_LABEL] = 0;
                      }
                      setSizeQty(next);
                    }}
                    className="mt-1 w-full border border-white/20 rounded-xl px-2 py-1.5 text-sm"
                  >
                    {sortedProductColors.map((c) => (
                      <option key={c.colorName} value={c.colorName}>
                        {c.colorName}
                      </option>
                    ))}
                  </select>
                </label>

                {selectedColorRow && selectedColorRow.sizes.length > 0 ? (
                  <div className="mt-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-white/60 uppercase tracking-wide">Sizes</span>
                      <div className="flex gap-2">
                        <button
                          onClick={() => setShowMarkup((v) => !v)}
                          title={
                            showMarkup
                              ? "Hide item cost and item markup — show only the item price"
                              : "Show item cost and item markup"
                          }
                          className="text-xs px-2 py-1 rounded-xl border border-white/20 hover:bg-white/5"
                        >
                          {showMarkup ? "Item Markup" : "IM%"}
                        </button>
                        <button
                          onClick={fillOneEach}
                          className="text-xs px-2 py-1 rounded-xl border border-white/20 hover:bg-white/5"
                        >
                          Fill 1 of each
                        </button>
                        <button
                          onClick={clearQuantities}
                          className="text-xs px-2 py-1 rounded-xl border border-white/20 hover:bg-white/5"
                        >
                          Clear
                        </button>
                      </div>
                    </div>
                    <SizeGrid
                      sizes={selectedColorRow.sizes}
                      sizeQty={sizeQty}
                      setSizeQty={setSizeQty}
                      showMarkup={showMarkup}
                    />
                  </div>
                ) : (
                  <div className="mt-3 max-w-[10rem]">
                    <label className="text-xs text-white/60">
                      Quantity (one-size item)
                      <input
                        type="number"
                        min={0}
                        value={sizeQty[ONE_SIZE_LABEL] ?? 0}
                        onChange={(e) =>
                          setSizeQty({ [ONE_SIZE_LABEL]: Math.max(0, Number(e.target.value) || 0) })
                        }
                        className="mt-1 w-full border border-white/20 rounded-xl px-2 py-1.5 text-sm"
                      />
                    </label>
                  </div>
                )}

                {selectedDecoration?.priceColumns && selectedDecoration.priceColumns.length > 0 && (
                  <label className="block text-xs text-white/60 mt-4 max-w-xs">
                    {columnLabel}
                    <select
                      value={selectedColumnId}
                      onChange={(e) => setSelectedColumnId(e.target.value)}
                      className="mt-1 w-full border border-white/20 rounded-xl px-2 py-1.5 text-sm"
                    >
                      <option value="">Select…</option>
                      {selectedDecoration.priceColumns.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </label>
                )}

                {selectedDecoration?.quoteRequired && (
                  <p className="mt-2 text-xs text-amber-700">
                    This decoration type is marked &quot;quote required&quot; site-wide, so it will price at
                    $0 here too — set an explicit price on the Pricing tab if you want this quote to
                    reflect a real cost.
                  </p>
                )}

                <button
                  onClick={addLine}
                  className="mt-4 text-sm px-4 py-1.5 rounded-xl bg-red text-navy hover:bg-red/90"
                >
                  Add to quote
                </button>
              </div>
            )}
          </>
        )}
      </section>
      )}

        </div>
      </div>
      )}

      {/* Computed preview */}
      {quote && (
        <section className="bg-black border border-white/10 shadow-lg shadow-black/30 rounded-2xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-white">Preview</h3>
            <button
              onClick={() => setShowMarkup((v) => !v)}
              title={
                showMarkup
                  ? "Hide item cost and item markup — show only the item price"
                  : "Show item cost and item markup"
              }
              className="text-xs px-2 py-1 rounded-xl border border-white/20 hover:bg-white/5"
            >
              {showMarkup ? "Item Markup" : "IM%"}
            </button>
          </div>
          {quote.lines.map((line, i) => (
            <div key={i} className="mb-4">
              <p className="text-sm font-medium text-white">
                {line.customerSupplied ? (
                  <>
                    Customer-supplied item{" "}
                    <span className="text-white/40 font-normal">
                      ({line.itemDescription})
                      {line.decorationLabel ? ` · ${line.decorationLabel}` : ""}
                      {line.priceColumnLabel ? ` (${line.priceColumnLabel})` : ""}
                    </span>
                  </>
                ) : (
                  <>
                    {line.brandName} {line.productName}{" "}
                    <span className="text-white/40 font-normal">
                      ({line.styleNumber} — {line.colorName})
                      {line.decorationLabel ? ` · ${line.decorationLabel}` : ""}
                      {line.priceColumnLabel ? ` (${line.priceColumnLabel})` : ""}
                    </span>
                  </>
                )}
              </p>
              <div className="mt-1 overflow-x-auto">
                <table className="text-sm border-collapse w-full">
                  <thead>
                    <tr className="text-xs text-white/60">
                      <th className="text-left pr-3 pb-1">Size</th>
                      <th className="text-left pr-3 pb-1">Qty</th>
                      {showMarkup && (
                        <>
                          <th className="text-left pr-3 pb-1">Cost</th>
                          <th className="text-left pr-3 pb-1">Markup</th>
                        </>
                      )}
                      <th className="text-left pr-3 pb-1">Garment price</th>
                      <th className="text-left pr-3 pb-1">Decoration</th>
                      <th className="text-left pr-3 pb-1">Unit</th>
                      <th className="text-right pb-1">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {line.sizes.map((s) => (
                      <tr key={s.size} className="border-t border-white/5">
                        <td className="pr-3 py-1">{s.size}</td>
                        <td className="pr-3 py-1">{s.quantity}</td>
                        {showMarkup && (
                          <>
                            <td className="pr-3 py-1">
                              ${(s.garmentCost ?? s.garmentUnitPrice).toFixed(2)}
                            </td>
                            <td className="pr-3 py-1">
                              {(s.garmentMarkupAmount ?? 0) > 0
                                ? `+$${(s.garmentMarkupAmount ?? 0).toFixed(2)}`
                                : "—"}
                            </td>
                          </>
                        )}
                        <td className="pr-3 py-1">${s.garmentUnitPrice.toFixed(2)}</td>
                        <td className="pr-3 py-1">
                          {s.decorationUnitPrice > 0 ? `+$${s.decorationUnitPrice.toFixed(2)}` : "—"}
                        </td>
                        <td className="pr-3 py-1">${s.unitPrice.toFixed(2)}</td>
                        <td className="py-1 text-right">${s.lineTotal.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
          {quote.setupCharges.length > 0 && (
            <div className="border-t border-white/10 pt-3 mb-3">
              <div className="text-xs font-medium text-white/60 uppercase tracking-wide mb-1">
                Setup charges
              </div>
              {quote.setupCharges.map((c) => (
                <div key={c.id} className="text-sm text-white/70">
                  {c.label} — ${c.price.toFixed(2)}
                </div>
              ))}
            </div>
          )}
          {quote.miscFees.length > 0 && (
            <div className="border-t border-white/10 pt-3 mb-3">
              <div className="text-xs font-medium text-white/60 uppercase tracking-wide mb-1">
                Other charges
              </div>
              {quote.miscFees.map((f, i) => (
                <div key={i} className="text-sm text-white/70">
                  {f.label}
                  {f.quantity > 1 ? ` × ${f.quantity} @ $${f.amount.toFixed(2)}` : ""} — $
                  {f.lineTotal.toFixed(2)}
                </div>
              ))}
            </div>
          )}
          <div className="border-t border-white/10 pt-3 flex justify-end">
            <div className="text-sm text-white space-y-1 text-right">
              <div>
                Total units: <span className="font-medium">{quote.totalQuantity}</span>
              </div>
              <div>
                Subtotal: <span className="font-medium">${quote.subtotalBeforeTax.toFixed(2)}</span>
              </div>
              {quote.taxRatePercent > 0 && (
                <div>
                  Tax ({quote.taxRatePercent}% on ${quote.taxableSubtotal.toFixed(2)} taxable):{" "}
                  <span className="font-medium">${quote.taxAmount.toFixed(2)}</span>
                </div>
              )}
              <div className="text-lg font-semibold text-red">
                Grand total: ${quote.grandTotal.toFixed(2)}
              </div>
              <div className="text-xs text-white/40">(setup charges included above)</div>
              {depositPercent < 100 && (
                <div className="text-xs text-white/60 pt-1 border-t border-white/10 mt-1">
                  <div>
                    Deposit due ({depositPercent}%): $
                    {(quote.grandTotal * (depositPercent / 100)).toFixed(2)}
                  </div>
                  <div>
                    Balance due at pickup ({100 - depositPercent}%): $
                    {(quote.grandTotal * ((100 - depositPercent) / 100)).toFixed(2)}
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* Persistent bottom bar — mirrors the reference quoting tool's
          always-visible Subtotal/Tax/Total strip, so the running total is
          visible without scrolling down to the Preview section, especially
          on a long quote with many garments. Always rendered once the
          Items section itself is showing — starts zeroed out ($0.00
          everywhere) before anything's been added, same as the reference
          tool, rather than disappearing entirely; the debounced recompute
          effect above (see generateQuote's useEffect) keeps it live as
          items are added, edited, or removed. */}
      {(mode === "quick" || activeRecord) && (
        <div className="sticky bottom-0 left-0 right-0 -mx-4 sm:mx-0 bg-black/95 backdrop-blur border-t border-white/10 shadow-lg shadow-black/50 px-4 py-3 flex flex-wrap items-center justify-end gap-4 text-sm text-white z-30">
          <span className="text-white/60">
            Subtotal{" "}
            <span className="text-white font-medium">${(quote?.subtotalBeforeTax ?? 0).toFixed(2)}</span>
          </span>
          <span className="text-white/60">
            Tax{quote && quote.taxRatePercent > 0 ? ` (${quote.taxRatePercent}%)` : ""}{" "}
            <span className="text-white font-medium">${(quote?.taxAmount ?? 0).toFixed(2)}</span>
          </span>
          <span className="text-base font-semibold text-red">
            Total ${(quote?.grandTotal ?? 0).toFixed(2)}
          </span>
        </div>
      )}
    </div>
    {sendModalOpen && activeRecord && (
      <AdminSendDocumentModal record={activeRecord} onClose={() => setSendModalOpen(false)} />
    )}
    </>
  );
}

// One size per column, matching the reference quoting tool's layout
// exactly: Quantity (editable), Item Cost, Item Markup (%), Item Price
// (cost with that markup applied — this is what actually feeds
// garmentUnitPrice once "Add to quote" runs it through /api/admin/quote),
// and a running per-size line total. Decoration cost isn't shown here since
// it's priced across the whole quote's combined quantity, not per garment
// line — see the Preview section below once "Preview quote" is run.
function SizeGrid({
  sizes,
  sizeQty,
  setSizeQty,
  showMarkup,
}: {
  sizes: ManualQuoteSizeRow[];
  sizeQty: Record<string, number>;
  setSizeQty: (updater: (prev: Record<string, number>) => Record<string, number>) => void;
  // When false, hides the Item Cost and Item Markup (%) rows — just the
  // editable Quantity, the final Item Price, and the Line total stay
  // visible. See AdminQuoteBuilder's showMarkup state/toggle.
  showMarkup: boolean;
}) {
  // Live running count across every size column — updates as the admin
  // types each size's quantity, same idea as ShopVox's inline item count
  // while building a line, so there's no need to add it all up by hand
  // before hitting "Add to quote".
  const totalQty = sizes.reduce((sum, sz) => sum + (sizeQty[sz.name] ?? 0), 0);

  return (
    <div className="mt-2 overflow-x-auto">
      {totalQty > 0 && (
        <p className="mb-1.5 text-xs font-semibold text-white">
          Total: <span className="text-red">{totalQty}</span> {totalQty === 1 ? "unit" : "units"}
        </p>
      )}
      <table className="text-xs border-collapse w-full min-w-[480px]">
        <thead>
          <tr>
            <th className="text-left pr-3 py-1 text-white/50 font-medium">Size</th>
            {sizes.map((sz) => (
              <th key={sz.name} className="text-center px-2 py-1 text-white font-semibold">
                {sz.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr className="border-t border-white/10">
            <td className="pr-3 py-1.5 text-white/50">Quantity</td>
            {sizes.map((sz) => (
              <td key={sz.name} className="px-1 py-1.5">
                <input
                  type="number"
                  min={0}
                  value={sizeQty[sz.name] ?? 0}
                  onChange={(e) => {
                    const v = Math.max(0, Number(e.target.value) || 0);
                    setSizeQty((prev) => ({ ...prev, [sz.name]: v }));
                  }}
                  className="w-16 border border-white/20 rounded-xl px-1.5 py-1 text-center text-sm"
                />
              </td>
            ))}
          </tr>
          {showMarkup && (
            <>
              <tr className="border-t border-white/5">
                <td className="pr-3 py-1 text-white/50">Item Cost</td>
                {sizes.map((sz) => (
                  <td key={sz.name} className="px-2 py-1 text-center text-white/70">
                    ${sz.cost.toFixed(2)}
                  </td>
                ))}
              </tr>
              <tr className="border-t border-white/5">
                <td className="pr-3 py-1 text-white/50">Item Markup (%)</td>
                {sizes.map((sz) => (
                  <td key={sz.name} className="px-2 py-1 text-center text-white/70">
                    {sz.markupPercent}
                  </td>
                ))}
              </tr>
            </>
          )}
          <tr className="border-t border-white/5">
            <td className="pr-3 py-1 text-white/50">Item Price</td>
            {sizes.map((sz) => (
              <td key={sz.name} className="px-2 py-1 text-center font-medium text-white">
                ${sz.price.toFixed(2)}
              </td>
            ))}
          </tr>
          <tr className="border-t border-white/10">
            <td className="pr-3 py-1 text-white/50">Line total</td>
            {sizes.map((sz) => {
              const qty = sizeQty[sz.name] ?? 0;
              return (
                <td key={sz.name} className="px-2 py-1 text-center text-white/70">
                  {qty > 0 ? `$${(qty * sz.price).toFixed(2)}` : "—"}
                </td>
              );
            })}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

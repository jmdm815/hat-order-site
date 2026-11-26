"use client";

import { useState } from "react";

const ENDPOINT = process.env.NEXT_PUBLIC_INQUIRY_URL || "https://hat-order-site.vercel.app/api/inquiry";

type Status = { kind: "idle" } | { kind: "sending" } | { kind: "ok" } | { kind: "err"; msg: string };

export default function QuoteForm() {
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    const file = data.get("logo");
    if (file instanceof File && file.size > 4 * 1024 * 1024) {
      setStatus({ kind: "err", msg: "That logo file is over 4 MB. Attach a smaller copy, or email it to purchasing@buyjmmedia.com after you send this." });
      return;
    }
    if (file instanceof File && file.size === 0) data.delete("logo");
    setStatus({ kind: "sending" });
    try {
      const res = await fetch(ENDPOINT, { method: "POST", body: data });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "The request didn't go through.");
      form.reset();
      setStatus({ kind: "ok" });
    } catch (err) {
      setStatus({
        kind: "err",
        msg: `${err instanceof Error ? err.message : "The request didn't go through."} You can also text 281-344-1772 or email purchasing@buyjmmedia.com.`,
      });
    }
  }

  return (
    <form className="form" onSubmit={onSubmit} noValidate={false}>
      <div className="field">
        <label htmlFor="q-name">Your name</label>
        <input id="q-name" name="name" required autoComplete="name" />
      </div>
      <div className="field">
        <label htmlFor="q-company">
          Business <span className="opt">(optional)</span>
        </label>
        <input id="q-company" name="company" autoComplete="organization" />
      </div>
      <div className="field">
        <label htmlFor="q-email">Email</label>
        <input id="q-email" name="email" type="email" required autoComplete="email" />
      </div>
      <div className="field">
        <label htmlFor="q-phone">
          Phone <span className="opt">(optional)</span>
        </label>
        <input id="q-phone" name="phone" type="tel" autoComplete="tel" />
      </div>
      <div className="field">
        <label htmlFor="q-service">What do you need?</label>
        <select id="q-service" name="service" defaultValue="">
          <option value="" disabled>
            Pick one
          </option>
          <option>Embroidered shirts, polos or jackets</option>
          <option>Embroidered or patch hats</option>
          <option>Printed t-shirts (DTF or screen print)</option>
          <option>UV printed tumblers or cups</option>
          <option>DTF transfers only</option>
          <option>Not sure yet</option>
        </select>
      </div>
      <div className="field">
        <label htmlFor="q-qty">
          Rough quantity <span className="opt">(optional)</span>
        </label>
        <input id="q-qty" name="quantity" inputMode="numeric" placeholder="e.g. 24" />
      </div>
      <div className="field full">
        <label htmlFor="q-msg">Tell us about the order</label>
        <textarea id="q-msg" name="message" required placeholder="Garments or brands you like, colors, where the logo goes, and when you need it." />
      </div>
      <div className="field full">
        <label htmlFor="q-logo">
          Logo <span className="opt">(optional, up to 4 MB)</span>
        </label>
        <input id="q-logo" name="logo" type="file" accept=".png,.jpg,.jpeg,.pdf,.svg,.ai,.eps,image/*,application/pdf" />
        <span className="hint">Any format works. If it isn&apos;t print-ready, we&apos;ll clean it up or vectorize it.</span>
      </div>
      <div className="hp" aria-hidden="true">
        <label htmlFor="q-website">Website</label>
        <input id="q-website" name="website" tabIndex={-1} autoComplete="off" />
      </div>
      {status.kind === "ok" && (
        <p className="form-status ok" role="status">
          Thanks, we got it. We&apos;ll get back to you with pricing and next steps.
        </p>
      )}
      {status.kind === "err" && (
        <p className="form-status err" role="alert">
          {status.msg}
        </p>
      )}
      <button className="btn btn-red" type="submit" disabled={status.kind === "sending"}>
        {status.kind === "sending" ? "Sending…" : "Send quote request"}
      </button>
    </form>
  );
}

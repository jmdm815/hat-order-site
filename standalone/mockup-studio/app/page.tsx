import MockupStudio from "@/components/MockupStudio";

// Standalone AI Mockup Studio. The heavy lifting (catalogs, AI edits,
// rendering) runs on the JM hat-order-site API; components/MockupStudio.tsx
// is the same file as hat-order-site/components/MockupStudio.tsx — copy it
// over when that one changes.
const API = process.env.NEXT_PUBLIC_MOCKUP_API ?? "https://hat-order-site.vercel.app";

export default function Home() {
  return (
    <main className="min-h-screen">
      <div className="mx-auto max-w-5xl px-4 py-8 sm:py-12">
        <header className="mb-6">
          <p className="text-xs font-semibold uppercase tracking-widest text-red-600">JM Digital Media</p>
          <h1 className="mt-1 text-3xl sm:text-4xl font-extrabold text-slate-900">See your logo on shirts</h1>
          <p className="mt-2 max-w-2xl text-slate-600">
            Upload your logo, pick a blank in as many colors as you like, and get mockups in under a minute. We tweak your logo
            for each color so it always reads clearly.
          </p>
        </header>
        <MockupStudio apiBase={API} mode="public" />
        <footer className="mt-10 text-center text-sm text-slate-500">
          Ready to order? Email <a className="underline" href="mailto:purchasing@buyjmmedia.com">purchasing@buyjmmedia.com</a> or text{" "}
          <a className="underline" href="sms:+12813441772">281-344-1772</a> · <a className="underline" href="https://buyjmmedia.com">buyjmmedia.com</a>
        </footer>
      </div>
    </main>
  );
}

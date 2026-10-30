// Every /admin page sits on the lighter admin-only palette (see the
// "admin-*" color tokens in app/globals.css) instead of the customer
// storefront's navy/black/white scheme set on <body> by the root layout.
// flex-1 so this fills the body's flex column and the canvas reaches the
// bottom of the viewport even on short pages.
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <div className="flex-1 flex flex-col bg-admin-bg text-admin-ink">{children}</div>;
}

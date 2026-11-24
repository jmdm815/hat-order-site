import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Free Shirt Mockup Tool — JM Digital Media",
  description: "Upload your logo, pick shirts in any color, and see mockups in seconds — adjusted so your logo looks right on every color.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased font-sans">{children}</body>
    </html>
  );
}

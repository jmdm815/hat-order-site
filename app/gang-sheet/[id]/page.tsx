import type { Metadata } from "next";
import GangSheetStatus from "@/components/GangSheetStatus";

export const metadata: Metadata = { title: "Gang Sheet — JM Digital Media", robots: { index: false } };

export default async function GangSheetStatusPage({ params }: { params: Promise<{ id: string }> }) {
  return <GangSheetStatus id={(await params).id} />;
}

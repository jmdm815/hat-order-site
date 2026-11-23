import type { Metadata } from "next";
import GangSheetBuilder from "@/components/GangSheetBuilder";

export const metadata: Metadata = {
  title: "DTF Gang Sheet Builder — JM Digital Media",
  description: "Build or upload a 24\"-wide DTF gang sheet, up to 192\" long, and add it to your cart.",
};

export default function GangSheetPage() {
  return <GangSheetBuilder />;
}

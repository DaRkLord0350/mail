import type { Metadata } from "next";
import { SuppressionsView } from "@/components/suppressions-view";

export const metadata: Metadata = { title: "Suppression" };

export default function SuppressionsPage() {
  return <SuppressionsView />;
}

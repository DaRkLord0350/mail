import type { Metadata } from "next";
import { HistoryView } from "@/components/history-view";

export const metadata: Metadata = { title: "Send History" };

export default function HistoryPage() {
  return <HistoryView />;
}

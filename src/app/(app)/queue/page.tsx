import type { Metadata } from "next";
import { QueueView } from "@/components/queue-view";

export const metadata: Metadata = { title: "Email Queue" };

export default function QueuePage() {
  return <QueueView />;
}

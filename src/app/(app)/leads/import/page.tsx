import type { Metadata } from "next";
import { ImportWizard } from "@/components/leads/import-wizard";

export const metadata: Metadata = { title: "Import leads" };

export default function ImportPage() {
  return <ImportWizard />;
}

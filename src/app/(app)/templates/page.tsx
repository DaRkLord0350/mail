import type { Metadata } from "next";
import { TemplatesList } from "@/components/templates/templates-list";

export const metadata: Metadata = { title: "Templates" };

export default function TemplatesPage() {
  return <TemplatesList />;
}

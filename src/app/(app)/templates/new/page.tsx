import type { Metadata } from "next";
import { TemplateEditor } from "@/components/templates/template-editor";

export const metadata: Metadata = { title: "New template" };

export default function NewTemplatePage() {
  return <TemplateEditor templateId={null} />;
}

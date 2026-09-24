import { z } from "zod";
import { handler, json, badRequest } from "@/lib/server/http";
import { commitImport, readCsvUpload } from "@/lib/server/leads";
import { importSummaryDTO } from "@/lib/server/dto";
import { LEAD_FIELDS, type ColumnMapping } from "@/lib/types";

export const maxDuration = 300;

const Mapping = z.object(Object.fromEntries(LEAD_FIELDS.map((f) => [f, z.string().max(500).nullable().optional()]))).loose();

export const POST = handler(async (req) => {
  const form = await req.formData().catch(() => {
    throw badRequest("Upload the CSV as multipart/form-data.");
  });
  const { fileName, parsed } = await readCsvUpload(form);
  let raw: unknown;
  try {
    raw = JSON.parse(String(form.get("mapping") ?? "{}"));
  } catch {
    throw badRequest("`mapping` must be a JSON object.");
  }
  const m = Mapping.parse(raw) as Record<string, string | null | undefined>;
  const mapping = Object.fromEntries(LEAD_FIELDS.map((f) => [f, m[f] || null])) as ColumnMapping;
  const batch = await commitImport(fileName, parsed, mapping);
  return json(importSummaryDTO(batch));
});

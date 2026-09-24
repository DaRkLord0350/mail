import { handler, json, badRequest } from "@/lib/server/http";
import { importPreview, readCsvUpload } from "@/lib/server/leads";

export const POST = handler(async (req) => {
  const form = await req.formData().catch(() => {
    throw badRequest("Upload the CSV as multipart/form-data.");
  });
  const { fileName, parsed } = await readCsvUpload(form);
  return json(importPreview(fileName, parsed));
});

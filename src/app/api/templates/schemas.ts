import { z } from "zod";

export const TemplateBody = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  subject: z.string().max(998),
  body: z.string().max(100_000),
});

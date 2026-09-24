import { z } from "zod";
import { prisma } from "@/lib/server/db";
import { badRequest, handler, json, notFound, readJson } from "@/lib/server/http";

const MAX_PDF_BYTES = 8 * 1024 * 1024;
const AttachmentBody = z.object({
  name: z.string().trim().min(1).max(255),
  mimeType: z.literal("application/pdf"),
  dataBase64: z.string().min(1).max(Math.ceil(MAX_PDF_BYTES * 1.4)),
});

function decodePdf(dataBase64: string): Buffer {
  const data = Buffer.from(dataBase64, "base64");
  if (data.length === 0 || data.length > MAX_PDF_BYTES) throw badRequest("PDF must be smaller than 8 MB.");
  if (data.subarray(0, 4).toString("ascii") !== "%PDF") throw badRequest("The selected file is not a valid PDF.");
  return data;
}

export const GET = handler<{ id: string }>(async (_req, { params }) => {
  const t = await prisma.template.findUnique({ where: { id: (await params).id }, select: { attachmentName: true, attachmentMimeType: true, attachmentData: true } });
  if (!t) throw notFound("Template not found");
  if (!t.attachmentName || t.attachmentMimeType !== "application/pdf" || !t.attachmentData) return json({ attachment: null });
  return json({ attachment: { name: t.attachmentName, mimeType: t.attachmentMimeType, sizeBytes: Math.floor((t.attachmentData.length * 3) / 4) } });
});

export const PUT = handler<{ id: string }>(async (req, { params }) => {
  const id = (await params).id;
  const exists = await prisma.template.findUnique({ where: { id }, select: { id: true } });
  if (!exists) throw notFound("Template not found");
  const input = await readJson(req, AttachmentBody);
  decodePdf(input.dataBase64);
  await prisma.template.update({ where: { id }, data: { attachmentName: input.name, attachmentMimeType: input.mimeType, attachmentData: input.dataBase64 } });
  return json({ ok: true, attachment: { name: input.name, mimeType: input.mimeType, sizeBytes: Buffer.from(input.dataBase64, "base64").length } });
});

export const DELETE = handler<{ id: string }>(async (_req, { params }) => {
  const id = (await params).id;
  await prisma.template.update({ where: { id }, data: { attachmentName: null, attachmentMimeType: null, attachmentData: null } });
  return json({ ok: true });
});

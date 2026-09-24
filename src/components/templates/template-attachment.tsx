"use client";

import { useEffect, useRef, useState } from "react";
import { FileText, Paperclip, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Alert } from "@/components/ui/feedback";

type AttachmentDTO = { name: string; mimeType: "application/pdf"; sizeBytes: number };
const MAX_BYTES = 8 * 1024 * 1024;

function formatBytes(bytes: number) { return `${(bytes / 1024 / 1024).toFixed(2)} MB`; }
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error ?? new Error("Could not read the PDF."));
    reader.readAsDataURL(file);
  });
}

export function TemplateAttachment({ templateId }: { templateId: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [attachment, setAttachment] = useState<AttachmentDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    try { const r = await api.get<{ attachment: AttachmentDTO | null }>(`/api/templates/${templateId}/attachment`); setAttachment(r.attachment); }
    catch (e) { toast.error(`Couldn't load attachment: ${e instanceof Error ? e.message : String(e)}`); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, [templateId]);

  async function upload(file: File) {
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) { toast.error("Only PDF files are supported."); return; }
    if (file.size > MAX_BYTES) { toast.error("PDF must be smaller than 8 MB."); return; }
    setBusy(true);
    try {
      const dataBase64 = await fileToBase64(file);
      const r = await api.put<{ attachment: AttachmentDTO }>(`/api/templates/${templateId}/attachment`, { name: file.name, mimeType: "application/pdf", dataBase64 });
      setAttachment(r.attachment);
      toast.success("PDF attached to template");
    } catch (e) { toast.error(`Upload failed: ${e instanceof Error ? e.message : String(e)}`); }
    finally { setBusy(false); if (inputRef.current) inputRef.current.value = ""; }
  }

  async function remove() {
    setBusy(true);
    try { await api.del(`/api/templates/${templateId}/attachment`); setAttachment(null); toast.success("PDF removed"); }
    catch (e) { toast.error(`Remove failed: ${e instanceof Error ? e.message : String(e)}`); }
    finally { setBusy(false); }
  }

  return (
    <Card>
      <CardHeader title="PDF attachment" description="Optional. The same PDF will be attached to every email sent from campaigns using this template." />
      <CardBody className="space-y-3">
        <input ref={inputRef} type="file" accept="application/pdf,.pdf" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) void upload(file); }} />
        {loading ? <p className="text-sm text-slate-500">Loading attachment…</p> : attachment ? (
          <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-3"><div className="rounded-lg bg-white p-2 shadow-sm"><FileText className="size-5 text-red-600" /></div><div className="min-w-0"><p className="truncate text-sm font-medium text-slate-900">{attachment.name}</p><p className="text-xs text-slate-500">PDF · {formatBytes(attachment.sizeBytes)}</p></div></div>
            <Button variant="ghost" size="sm" onClick={() => void remove()} loading={busy}><Trash2 /> Remove</Button>
          </div>
        ) : (
          <div className="flex flex-col gap-3 rounded-lg border border-dashed border-slate-300 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div><p className="text-sm font-medium text-slate-800">No PDF attached</p><p className="text-xs text-slate-500">Upload one PDF, up to 8 MB. It will be sent with every campaign email using this template.</p></div>
            <Button variant="secondary" onClick={() => inputRef.current?.click()} disabled={busy}><Paperclip /> Attach PDF</Button>
          </div>
        )}
        <Alert tone="info" title="Optional attachment">Save the template first, then attach or remove the PDF here. Existing campaigns keep their own attachment snapshot.</Alert>
      </CardBody>
    </Card>
  );
}

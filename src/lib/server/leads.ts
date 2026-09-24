import type { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { t } from "./sql";
import { leadDTO, leadName } from "./dto";
import { analyzeImport, parseCsv, suggestMapping, type ParsedCsv } from "@/lib/csv/parse";
import { badRequest } from "./http";
import {
  LEAD_FIELDS,
  LEAD_FIELD_LABELS,
  LEAD_STATUSES,
  type ColumnMapping,
  type ImportPreviewDTO,
  type LeadDTO,
  type LeadStatus,
  type StatusCounts,
  type TemplateVariableDTO,
} from "@/lib/types";
import { SYSTEM_VARIABLES } from "@/lib/template/render";

export interface LeadQuery {
  search?: string;
  status?: LeadStatus;
  notContacted?: boolean;
}

export function leadWhere(q: LeadQuery): Prisma.LeadWhereInput {
  const where: Prisma.LeadWhereInput = {};
  if (q.status) where.status = q.status;
  if (q.notContacted) where.sendCount = 0;
  const s = q.search?.trim();
  if (s) {
    const c = { contains: s, mode: "insensitive" as const };
    where.OR = [
      { email: c },
      { firstName: c },
      { lastName: c },
      { companyName: c },
      { displayName: c },
      { customDomain: c },
      { website: c },
    ];
  }
  return where;
}

const SORTS: Record<string, (o: Prisma.SortOrder) => Prisma.LeadOrderByWithRelationInput[]> = {
  name: (o) => [{ firstName: { sort: o, nulls: "last" } }, { lastName: { sort: o, nulls: "last" } }],
  company: (o) => [{ companyName: { sort: o, nulls: "last" } }],
  status: (o) => [{ status: o }],
  lastSent: (o) => [{ lastSentAt: { sort: o, nulls: "last" } }],
  createdAt: (o) => [{ createdAt: o }],
  email: (o) => [{ email: o }],
};

/** Attach suppression + last campaign info for a page of leads. */
export async function enrichLeads(leads: Awaited<ReturnType<typeof prisma.lead.findMany>>): Promise<LeadDTO[]> {
  if (!leads.length) return [];
  const [supp, deliveries] = await Promise.all([
    prisma.suppression.findMany({ where: { email: { in: leads.map((l) => l.email) } }, select: { email: true } }),
    prisma.emailDelivery.findMany({
      where: { leadId: { in: leads.map((l) => l.id) } },
      orderBy: { createdAt: "desc" },
      distinct: ["leadId"],
      select: { leadId: true, campaign: { select: { id: true, name: true } } },
    }),
  ]);
  const suppressed = new Set(supp.map((s) => s.email));
  const lastCampaign = new Map(deliveries.map((d) => [d.leadId, d.campaign]));
  return leads.map((l) => leadDTO(l, { suppressed: suppressed.has(l.email), lastCampaign: lastCampaign.get(l.id) ?? null }));
}

export async function listLeads(q: LeadQuery & { sort?: string; order?: string; skip: number; take: number }) {
  const where = leadWhere(q);
  const order: Prisma.SortOrder = q.order === "asc" ? "asc" : "desc";
  const orderBy = [...(SORTS[q.sort ?? "createdAt"] ?? SORTS.createdAt)(order), { id: "asc" as const }];
  const [items, total] = await Promise.all([prisma.lead.findMany({ where, orderBy, skip: q.skip, take: q.take }), prisma.lead.count({ where })]);
  return { items: await enrichLeads(items), total };
}

export async function leadStatusCounts(search?: string): Promise<StatusCounts<LeadStatus>> {
  const groups = await prisma.lead.groupBy({ by: ["status"], where: leadWhere({ search }), _count: { _all: true } });
  const counts = Object.fromEntries(LEAD_STATUSES.map((s) => [s, 0])) as Record<LeadStatus, number>;
  let total = 0;
  for (const g of groups) {
    counts[g.status] = g._count._all;
    total += g._count._all;
  }
  return { total, counts };
}

export async function leadOptions(search?: string) {
  const leads = await prisma.lead.findMany({ where: leadWhere({ search }), orderBy: [{ companyName: "asc" }, { email: "asc" }], take: 50 });
  return leads.map((l) => ({ id: l.id, email: l.email, name: leadName(l), companyName: l.companyName }));
}

/** Every variable a template can use: canonical fields, all CSV columns seen, system vars. */
export async function templateVariables(): Promise<TemplateVariableDTO[]> {
  const total = await prisma.lead.count();
  const rows = await prisma.$queryRaw<{ key: string; filled: bigint; sample: string | null }[]>`
    SELECT kv.key AS "key",
           COUNT(*) FILTER (WHERE btrim(kv.value) <> '') AS "filled",
           MIN(kv.value) FILTER (WHERE btrim(kv.value) <> '') AS "sample"
    FROM ${t("Lead")} l, jsonb_each_text(l."metadata") AS kv
    GROUP BY kv.key
    ORDER BY kv.key`;
  const csv = new Map(rows.map((r) => [r.key, r]));

  const fieldColumn: Record<string, Prisma.LeadScalarFieldEnum> = {
    email: "email",
    first_name: "firstName",
    last_name: "lastName",
    company_name: "companyName",
    display_name: "displayName",
    website: "website",
    custom_domain: "customDomain",
    phone: "phone",
  };
  const first = await prisma.lead.findFirst({ orderBy: { createdAt: "asc" } });
  const out: TemplateVariableDTO[] = [];
  for (const f of LEAD_FIELDS) {
    const col = fieldColumn[f];
    // `email` is non-nullable: Prisma rejects `{ not: null }` on it (validation error).
    const nonEmpty: Prisma.LeadWhereInput =
      col === "email" ? { NOT: { email: "" } } : { AND: [{ [col]: { not: null } }, { NOT: { [col]: "" } }] };
    const filled = total ? await prisma.lead.count({ where: nonEmpty }) : 0;
    const sample = first ? ((first as unknown as Record<string, string | null>)[col] ?? null) : null;
    out.push({ key: f, label: LEAD_FIELD_LABELS[f], source: "field", sampleValue: sample, coverage: total ? filled / total : 0 });
    csv.delete(f);
  }
  for (const [key, r] of csv) {
    out.push({ key, label: key, source: "csv", sampleValue: r.sample, coverage: total ? Number(r.filled) / total : 0 });
  }
  for (const key of SYSTEM_VARIABLES) out.push({ key, label: "Unsubscribe link", source: "system", sampleValue: null, coverage: 1 });
  return out;
}

export async function knownVariableKeys(): Promise<Set<string>> {
  const vars = await templateVariables();
  return new Set([...vars.map((v) => v.key), "full_name"]);
}

// ─── CSV import ─────────────────────────────────────────────────────────────

export const MAX_CSV_BYTES = 10 * 1024 * 1024;

export async function readCsvUpload(form: FormData): Promise<{ fileName: string; parsed: ParsedCsv }> {
  const file = form.get("file");
  if (!file || typeof file === "string") throw badRequest("Attach a CSV file in the `file` field.");
  if (file.size === 0) throw badRequest("The file is empty.");
  if (file.size > MAX_CSV_BYTES) throw badRequest("CSV is larger than 10 MB. Split it into smaller files.");
  const name = (file as File).name || "upload.csv";
  if (!/\.(csv|txt|tsv)$/i.test(name)) throw badRequest("Only .csv files are supported.");
  const text = await file.text();
  if (text.includes("\u0000")) throw badRequest("This does not look like a text CSV file.");
  const parsed = parseCsv(text);
  if (!parsed.headers.length) throw badRequest(parsed.errors[0] ?? "Could not find a header row.");
  if (parsed.errors.length && !parsed.rows.length) throw badRequest(`Could not parse CSV: ${parsed.errors[0]}`);
  return { fileName: name.slice(0, 200), parsed };
}

export function importPreview(fileName: string, parsed: ParsedCsv): ImportPreviewDTO {
  const sampleRows = parsed.rows.slice(0, 5).map((r) => Object.fromEntries(parsed.headers.map((h, i) => [h, (r[i] ?? "").trim()])));
  return { fileName, columns: parsed.headers, suggestedMapping: suggestMapping(parsed.headers), sampleRows, totalRows: parsed.rows.length };
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export async function commitImport(fileName: string, parsed: ParsedCsv, mapping: ColumnMapping) {
  for (const [field, header] of Object.entries(mapping)) {
    if (header && !parsed.headers.includes(header)) throw badRequest(`Mapped column "${header}" (for ${field}) is not in the CSV.`);
  }
  if (!mapping.email) throw badRequest("Map a column to Email — it is required.");

  // DB context: existing leads + suppression list for every email in the file.
  const emailIdx = parsed.headers.indexOf(mapping.email);
  const fileEmails = [...new Set(parsed.rows.map((r) => (r[emailIdx] ?? "").trim().toLowerCase()).filter(Boolean))];
  const existing = new Map<string, { sendCount: number; id: string; metadata: unknown }>();
  const suppressed = new Set<string>();
  for (const part of chunk(fileEmails, 1000)) {
    const [ls, ss] = await Promise.all([
      prisma.lead.findMany({ where: { email: { in: part } }, select: { id: true, email: true, sendCount: true, metadata: true } }),
      prisma.suppression.findMany({ where: { email: { in: part } }, select: { email: true } }),
    ]);
    ls.forEach((l) => existing.set(l.email, l));
    ss.forEach((s) => suppressed.add(s.email));
  }

  const analysis = analyzeImport(parsed, mapping, { existing, suppressed });
  const { counts } = analysis;

  const batch = await prisma.importBatch.create({
    data: {
      fileName,
      columns: parsed.headers,
      mapping: mapping as unknown as Prisma.InputJsonValue,
      totalRows: counts.totalRows,
      validLeads: counts.validLeads,
      createdLeads: 0,
      updatedLeads: 0,
      invalidEmails: counts.invalidEmails,
      duplicateEmails: counts.duplicateEmails,
      blankRows: counts.blankRows,
      malformedRows: counts.malformedRows,
      missingNames: counts.missingNames,
      missingCompanies: counts.missingCompanies,
      alreadyContacted: counts.alreadyContacted,
      readyToSend: counts.readyToSend,
      issues: analysis.issues as unknown as Prisma.InputJsonValue,
    },
  });

  const fields = (l: (typeof analysis.leads)[number]) => ({
    firstName: l.firstName,
    lastName: l.lastName,
    companyName: l.companyName,
    displayName: l.displayName,
    website: l.website,
    customDomain: l.customDomain,
    phone: l.phone,
  });

  let created = 0;
  for (const part of chunk(analysis.leads.filter((l) => !l.exists), 1000)) {
    const r = await prisma.lead.createMany({
      data: part.map((l) => ({ email: l.email, ...fields(l), metadata: l.metadata, importBatchId: batch.id })),
      skipDuplicates: true,
    });
    created += r.count;
  }

  // Existing leads: refresh mapped fields (only non-empty values) and merge
  // metadata. Status / send history are never touched by an import.
  let updated = 0;
  for (const part of chunk(analysis.leads.filter((l) => l.exists), 200)) {
    await prisma.$transaction(
      part.map((l) => {
        const prev = existing.get(l.email)!;
        const prevMeta = prev.metadata && typeof prev.metadata === "object" ? (prev.metadata as Record<string, string>) : {};
        const nonEmpty = Object.fromEntries(Object.entries(fields(l)).filter(([, v]) => v != null && v !== ""));
        return prisma.lead.update({ where: { id: prev.id }, data: { ...nonEmpty, metadata: { ...prevMeta, ...l.metadata }, importBatchId: batch.id } });
      }),
    );
    updated += part.length;
  }

  return prisma.importBatch.update({ where: { id: batch.id }, data: { createdLeads: created, updatedLeads: updated } });
}

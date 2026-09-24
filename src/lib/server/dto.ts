import type { Campaign, EmailDelivery, ImportBatch, Lead, Suppression, Template } from "@prisma/client";
import { iso } from "./http";
import type {
  CampaignDTO,
  DeliveryDetailDTO,
  DeliveryDTO,
  DeliveryStatus,
  ImportIssue,
  ImportSummaryDTO,
  LeadDTO,
  SuppressionDTO,
  TemplateDTO,
} from "@/lib/types";

export function metadataRecord(v: unknown): Record<string, string> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = val == null ? "" : String(val);
  return out;
}

export function leadName(l: Pick<Lead, "firstName" | "lastName" | "displayName">): string | null {
  const n = [l.firstName, l.lastName].filter(Boolean).join(" ").trim();
  return n || l.displayName || null;
}

export function leadDTO(l: Lead, extra: { suppressed?: boolean; lastCampaign?: { id: string; name: string } | null } = {}): LeadDTO {
  return {
    id: l.id,
    email: l.email,
    firstName: l.firstName,
    lastName: l.lastName,
    companyName: l.companyName,
    displayName: l.displayName,
    website: l.website,
    customDomain: l.customDomain,
    phone: l.phone,
    status: l.status,
    lastSentAt: iso(l.lastSentAt),
    sendCount: l.sendCount,
    metadata: metadataRecord(l.metadata),
    createdAt: l.createdAt.toISOString(),
    suppressed: extra.suppressed ?? false,
    lastCampaign: extra.lastCampaign ?? null,
  };
}

export const emptyDeliveryCounts = (): Record<DeliveryStatus, number> => ({ PENDING: 0, PROCESSING: 0, SENT: 0, FAILED: 0, SKIPPED: 0 });

export function campaignDTO(
  c: Campaign,
  recipientCount: number,
  counts: Record<DeliveryStatus, number> = emptyDeliveryCounts(),
  sendingHaltedReason: string | null = null,
): CampaignDTO {
  return {
    id: c.id,
    name: c.name,
    status: c.status,
    templateId: c.templateId,
    subjectTemplate: c.subjectTemplate,
    bodyTemplate: c.bodyTemplate,
    dailyLimit: c.dailyLimit,
    scheduledAt: iso(c.scheduledAt),
    timezone: c.timezone,
    lastError: c.lastError,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
    startedAt: iso(c.startedAt),
    pausedAt: iso(c.pausedAt),
    completedAt: iso(c.completedAt),
    recipientCount,
    counts,
    sendingHaltedReason,
  };
}

type DeliveryWithRefs = EmailDelivery & {
  campaign: Pick<Campaign, "name">;
  lead: Pick<Lead, "firstName" | "lastName" | "displayName" | "companyName">;
};

export function deliveryDTO(d: DeliveryWithRefs): DeliveryDTO {
  return {
    id: d.id,
    campaignId: d.campaignId,
    campaignName: d.campaign.name,
    leadId: d.leadId,
    email: d.email,
    leadName: leadName(d.lead),
    companyName: d.lead.companyName,
    renderedSubject: d.renderedSubject,
    status: d.status,
    providerMessageId: d.providerMessageId,
    attempts: d.attempts,
    errorMessage: d.errorMessage,
    errorCode: d.errorCode,
    sentAt: iso(d.sentAt),
    lastAttemptAt: iso(d.lastAttemptAt),
    nextAttemptAt: d.nextAttemptAt.toISOString(),
    createdAt: d.createdAt.toISOString(),
  };
}

export function deliveryDetailDTO(d: DeliveryWithRefs): DeliveryDetailDTO {
  return {
    ...deliveryDTO(d),
    renderedBody: d.renderedBody,
    subjectTemplate: d.subjectTemplate,
    bodyTemplate: d.bodyTemplate,
    updatedAt: d.updatedAt.toISOString(),
  };
}

export const deliveryInclude = {
  campaign: { select: { name: true } },
  lead: { select: { firstName: true, lastName: true, displayName: true, companyName: true } },
} as const;

export function templateDTO(t: Template): TemplateDTO {
  return { id: t.id, name: t.name, subject: t.subject, body: t.body, createdAt: t.createdAt.toISOString(), updatedAt: t.updatedAt.toISOString() };
}

export function suppressionDTO(s: Suppression): SuppressionDTO {
  return { id: s.id, email: s.email, reason: s.reason, source: s.source, createdAt: s.createdAt.toISOString() };
}

export function importSummaryDTO(b: ImportBatch, maxIssues = Infinity): ImportSummaryDTO {
  const issues = (Array.isArray(b.issues) ? (b.issues as unknown as ImportIssue[]) : []).slice(0, maxIssues);
  return {
    id: b.id,
    fileName: b.fileName,
    totalRows: b.totalRows,
    validLeads: b.validLeads,
    createdLeads: b.createdLeads,
    updatedLeads: b.updatedLeads,
    invalidEmails: b.invalidEmails,
    duplicateEmails: b.duplicateEmails,
    blankRows: b.blankRows,
    malformedRows: b.malformedRows,
    missingNames: b.missingNames,
    missingCompanies: b.missingCompanies,
    alreadyContacted: b.alreadyContacted,
    readyToSend: b.readyToSend,
    issues,
    createdAt: b.createdAt.toISOString(),
  };
}

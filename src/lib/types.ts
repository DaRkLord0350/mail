// Shared DTO types used by API routes (server) and UI (client).
// This file must stay free of server-only imports.

export const LEAD_STATUSES = ["READY", "PENDING", "SENT", "FAILED", "SKIPPED"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];
export const DELIVERY_STATUSES = ["PENDING", "PROCESSING", "SENT", "FAILED", "SKIPPED"] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];
export const CAMPAIGN_STATUSES = ["DRAFT", "READY", "SCHEDULED", "RUNNING", "PAUSED", "COMPLETED", "STOPPED"] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];
export const MISSING_VARIABLE_BEHAVIORS = ["FALLBACK", "REMOVE", "SKIP"] as const;
export type MissingVariableBehavior = (typeof MISSING_VARIABLE_BEHAVIORS)[number];
export const LEAD_FIELDS = ["email", "first_name", "last_name", "company_name", "display_name", "website", "custom_domain", "phone"] as const;
export type LeadField = (typeof LEAD_FIELDS)[number];
export const LEAD_FIELD_LABELS: Record<LeadField, string> = { email: "Email", first_name: "First Name", last_name: "Last Name", company_name: "Company", display_name: "Display Name", website: "Website", custom_domain: "Custom Domain", phone: "Phone" };
export type ColumnMapping = Record<LeadField, string | null>;
export interface ApiError { error: string; details?: unknown; }
export interface Paginated<T> { items: T[]; total: number; page: number; pageSize: number; }
export interface UsageDTO { date: string; timezone: string; sent: number; limit: number; remaining: number; }
export interface StatusCounts<S extends string> { total: number; counts: Record<S, number>; }
export interface LeadDTO { id: string; email: string; firstName: string | null; lastName: string | null; companyName: string | null; displayName: string | null; website: string | null; customDomain: string | null; phone: string | null; status: LeadStatus; lastSentAt: string | null; sendCount: number; metadata: Record<string, string>; createdAt: string; suppressed: boolean; lastCampaign: { id: string; name: string } | null; }
export interface ImportIssue { row: number; type: "invalid_email" | "missing_email" | "duplicate_in_file" | "blank_row" | "malformed_row" | "missing_name" | "missing_company" | "already_contacted" | "suppressed"; message: string; email?: string; }
export interface ImportPreviewDTO { fileName: string; columns: string[]; suggestedMapping: ColumnMapping; sampleRows: Record<string, string>[]; totalRows: number; }
export interface ImportSummaryDTO { id: string; fileName: string; totalRows: number; validLeads: number; createdLeads: number; updatedLeads: number; invalidEmails: number; duplicateEmails: number; blankRows: number; malformedRows: number; missingNames: number; missingCompanies: number; alreadyContacted: number; readyToSend: number; issues: ImportIssue[]; createdAt: string; }
export interface TemplateVariableDTO { key: string; label: string; source: "field" | "csv" | "system"; sampleValue: string | null; coverage: number; }
export interface TemplateDTO { id: string; name: string; subject: string; body: string; createdAt: string; updatedAt: string; }
export interface RenderPreviewDTO { to: string; subject: string; body: string; html: string; missing: string[]; unknown: string[]; skipped: boolean; skipReason: string | null; }
export interface CampaignDTO { id: string; name: string; status: CampaignStatus; templateId: string | null; subjectTemplate: string; bodyTemplate: string; dailyLimit: number; scheduledAt: string | null; timezone: string; lastError: string | null; createdAt: string; updatedAt: string; startedAt: string | null; pausedAt: string | null; completedAt: string | null; recipientCount: number; counts: Record<DeliveryStatus, number>; sendingHaltedReason: string | null; }
export interface CampaignPreviewItemDTO { leadId: string; to: string; name: string; companyName: string | null; subject: string; body: string; missing: string[]; skipped: boolean; skipReason: string | null; }
export interface CampaignPreviewDTO { items: CampaignPreviewItemDTO[]; summary: { recipients: number; willSend: number; willSkip: number; suppressed: number; alreadySent: number; missingVariables: number; queuedElsewhere: number; unknownVariables: string[]; effectiveDailyLimit: number; remainingToday: number; estimatedDays: number; }; }
export interface DeliveryDTO { id: string; campaignId: string; campaignName: string; leadId: string; email: string; leadName: string | null; companyName: string | null; renderedSubject: string; status: DeliveryStatus; providerMessageId: string | null; attempts: number; errorMessage: string | null; errorCode: string | null; sentAt: string | null; lastAttemptAt: string | null; nextAttemptAt: string; createdAt: string; }
export interface DeliveryDetailDTO extends DeliveryDTO { renderedBody: string; subjectTemplate: string; bodyTemplate: string; updatedAt: string; }
export interface SuppressionDTO { id: string; email: string; reason: string | null; source: "MANUAL" | "UNSUBSCRIBE" | "BOUNCE" | "COMPLAINT"; createdAt: string; }
export interface SettingsDTO { fromName: string; fromEmail: string; replyTo: string; dailyLimit: number; dailyLimitCeiling: number; sendDelaySeconds: number; maxRetries: number; missingVariableBehavior: MissingVariableBehavior; fallbackValues: Record<string, string>; timezone: string; gmail: { configured: boolean; keyHint: string | null }; cron: { configured: boolean; batchSize: number }; sender: { configured: boolean; formatted: string | null }; }
export interface WorkerResultDTO { startedAt: string; finishedAt: string; recovered: number; promotedCampaigns: number; completedCampaigns: number; processed: number; sent: number; failed: number; skipped: number; retried: number; stopReason: "batch_complete" | "queue_empty" | "quota_reached" | "time_budget" | "paced" | "auth_error" | "not_configured" | "error"; message: string; usage: UsageDTO; }
export interface DashboardDTO { usage: UsageDTO; leads: StatusCounts<LeadStatus>; deliveries: StatusCounts<DeliveryStatus>; campaigns: CampaignDTO[]; recent: DeliveryDTO[]; worker: { lastRunAt: string | null; nextSendAt: string | null; lastResult: WorkerResultDTO | null; haltedReason: string | null; }; setup: { gmailConfigured: boolean; senderConfigured: boolean; hasLeads: boolean; hasTemplates: boolean; hasCampaigns: boolean; }; }

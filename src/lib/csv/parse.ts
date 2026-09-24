// CSV parsing, column detection and import analysis. Pure (no DB) so it can
// be unit tested; the import service feeds it DB context.
import Papa from "papaparse";
import { isValidEmail, normalizeEmail } from "@/lib/email-address";
import { LEAD_FIELDS, type ColumnMapping, type ImportIssue, type LeadField } from "@/lib/types";

export interface ParsedCsv {
  /** Original header labels, in file order. */
  headers: string[];
  /** Normalized variable key for each header (same order), unique. */
  keys: string[];
  /** Data rows (header excluded). */
  rows: string[][];
  /** Fatal parse problems (e.g. unterminated quotes, empty file). */
  errors: string[];
}

/** "Company Name" -> "company_name", "E-mail" -> "e_mail". */
export function normalizeKey(header: string): string {
  const k = header
    .replace(/^﻿/, "")
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!k) return "";
  return /^[0-9]/.test(k) ? `col_${k}` : k;
}

export function parseCsv(text: string): ParsedCsv {
  const clean = text.replace(/^﻿/, "");
  if (!clean.trim()) return { headers: [], keys: [], rows: [], errors: ["The file is empty."] };

  const result = Papa.parse<string[]>(clean, { header: false, skipEmptyLines: false, delimitersToGuess: [",", ";", "\t", "|"] });
  const errors: string[] = [];
  for (const e of result.errors) {
    // Field-count mismatches are handled per row as "malformed"; anything else
    // (e.g. MissingQuotes) is reported.
    if (e.type === "FieldMismatch") continue;
    if (e.code === "UndetectableDelimiter") continue;
    errors.push(`${e.message}${typeof e.row === "number" ? ` (line ${e.row + 2})` : ""}`);
  }

  const data = result.data as string[][];
  // First non-empty line is the header.
  const headerIdx = data.findIndex((r) => r.some((c) => (c ?? "").trim() !== ""));
  if (headerIdx === -1) return { headers: [], keys: [], rows: [], errors: ["No header row found."] };
  const headers = data[headerIdx].map((h) => (h ?? "").replace(/^﻿/, "").trim());

  const seen = new Map<string, number>();
  const keys = headers.map((h, i) => {
    let k = normalizeKey(h) || `column_${i + 1}`;
    const n = seen.get(k) ?? 0;
    seen.set(k, n + 1);
    if (n > 0) k = `${k}_${n + 1}`;
    return k;
  });

  let rows = data.slice(headerIdx + 1);
  // Papa yields a trailing [""] for a final newline; drop trailing fully-empty lines.
  while (rows.length && rows[rows.length - 1].every((c) => (c ?? "").trim() === "")) rows = rows.slice(0, -1);

  if (!headers.some(Boolean)) errors.push("Header row is empty.");
  return { headers, keys, rows, errors };
}

// Normalized header keys that map onto each canonical field, best first.
const SYNONYMS: Record<LeadField, string[]> = {
  email: ["email", "email_address", "e_mail", "mail", "contact_email", "primary_email", "work_email", "business_email"],
  first_name: ["first_name", "firstname", "first", "given_name", "fname", "contact_first_name", "owner_first_name"],
  last_name: ["last_name", "lastname", "last", "surname", "family_name", "lname", "contact_last_name"],
  company_name: ["company_name", "company", "companyname", "organization", "organisation", "business_name", "brand", "brand_name", "store_name", "account_name", "billing_address_company_name"],
  display_name: ["display_name", "displayname", "full_name", "name", "contact_name", "store"],
  website: ["website", "website_url", "url", "site", "web", "homepage", "domain", "custom_domain", "store_url"],
  custom_domain: ["custom_domain", "domain", "store_domain", "shop_domain"],
  phone: ["phone", "phone_number", "mobile", "mobile_number", "contact_number", "telephone", "tel", "billing_address_contact_number", "whatsapp"],
};

const CONTAINS: Partial<Record<LeadField, string[]>> = {
  email: ["email"],
  phone: ["phone", "mobile"],
  website: ["website", "url"],
  company_name: ["company"],
};

/** Suggest a CSV header for each canonical field (manual correction in the UI). */
export function suggestMapping(headers: string[]): ColumnMapping {
  const keys = headers.map((h) => normalizeKey(h));
  const mapping = Object.fromEntries(LEAD_FIELDS.map((f) => [f, null])) as ColumnMapping;
  const used = new Set<number>();

  for (const field of LEAD_FIELDS) {
    // `website` may share a column with custom_domain (e.g. only a domain column exists).
    const canReuse = field === "website";
    let idx = -1;
    for (const syn of SYNONYMS[field]) {
      idx = keys.findIndex((k, i) => k === syn && (canReuse || !used.has(i)));
      if (idx !== -1) break;
    }
    if (idx === -1 && CONTAINS[field]) {
      idx = keys.findIndex((k, i) => (canReuse || !used.has(i)) && CONTAINS[field]!.some((c) => k.includes(c)));
    }
    if (idx !== -1) {
      mapping[field] = headers[idx];
      if (!canReuse) used.add(idx);
    }
  }
  return mapping;
}

export interface ImportContext {
  /** Existing leads by normalized email. */
  existing: Map<string, { sendCount: number }>;
  suppressed: Set<string>;
}

export interface AnalyzedLead {
  row: number;
  email: string;
  firstName: string | null;
  lastName: string | null;
  companyName: string | null;
  displayName: string | null;
  website: string | null;
  customDomain: string | null;
  phone: string | null;
  metadata: Record<string, string>;
  exists: boolean;
  alreadyContacted: boolean;
  suppressed: boolean;
}

export interface ImportAnalysis {
  leads: AnalyzedLead[];
  issues: ImportIssue[];
  counts: {
    totalRows: number;
    validLeads: number;
    invalidEmails: number;
    duplicateEmails: number;
    blankRows: number;
    malformedRows: number;
    missingNames: number;
    missingCompanies: number;
    alreadyContacted: number;
    readyToSend: number;
    newLeads: number;
    existingLeads: number;
  };
}

const MAX_ISSUES = 5000;

function clean(v: string | undefined | null): string | null {
  const s = (v ?? "").trim();
  return s ? s : null;
}

/**
 * Validate every row and build lead records. Nothing is silently dropped:
 * every skipped row produces an issue.
 */
export function analyzeImport(parsed: ParsedCsv, mapping: ColumnMapping, ctx: ImportContext): ImportAnalysis {
  const { headers, keys, rows } = parsed;
  const col = (field: LeadField) => {
    const h = mapping[field];
    if (!h) return -1;
    return headers.indexOf(h);
  };
  const idx = Object.fromEntries(LEAD_FIELDS.map((f) => [f, col(f)])) as Record<LeadField, number>;
  if (idx.email === -1) throw new Error("An email column must be mapped.");

  const issues: ImportIssue[] = [];
  const push = (i: ImportIssue) => {
    if (issues.length < MAX_ISSUES) issues.push(i);
  };
  const counts: ImportAnalysis["counts"] = {
    totalRows: rows.length,
    validLeads: 0,
    invalidEmails: 0,
    duplicateEmails: 0,
    blankRows: 0,
    malformedRows: 0,
    missingNames: 0,
    missingCompanies: 0,
    alreadyContacted: 0,
    readyToSend: 0,
    newLeads: 0,
    existingLeads: 0,
  };
  const seen = new Set<string>();
  const leads: AnalyzedLead[] = [];

  rows.forEach((cells, i) => {
    const row = i + 1;
    if (cells.every((c) => (c ?? "").trim() === "")) {
      counts.blankRows++;
      push({ row, type: "blank_row", message: "Blank row — skipped." });
      return;
    }
    if (cells.length > headers.length) {
      counts.malformedRows++;
      push({ row, type: "malformed_row", message: `Row has ${cells.length} fields but the header has ${headers.length} — skipped (check for unquoted commas).` });
      return;
    }
    if (cells.length < headers.length) {
      counts.malformedRows++;
      push({ row, type: "malformed_row", message: `Row has ${cells.length} of ${headers.length} fields — missing values treated as empty.` });
    }
    const get = (f: LeadField) => (idx[f] === -1 ? null : clean(cells[idx[f]]));

    const rawEmail = get("email");
    if (!rawEmail) {
      counts.invalidEmails++;
      push({ row, type: "missing_email", message: "No email address — skipped." });
      return;
    }
    const email = normalizeEmail(rawEmail);
    if (!isValidEmail(email)) {
      counts.invalidEmails++;
      push({ row, type: "invalid_email", message: `Invalid email "${rawEmail}" — skipped.`, email: rawEmail });
      return;
    }
    if (seen.has(email)) {
      counts.duplicateEmails++;
      push({ row, type: "duplicate_in_file", message: `Duplicate of an earlier row — skipped (first occurrence kept).`, email });
      return;
    }
    seen.add(email);

    const metadata: Record<string, string> = {};
    keys.forEach((k, ci) => {
      metadata[k] = (cells[ci] ?? "").trim();
    });

    const lead: AnalyzedLead = {
      row,
      email,
      firstName: get("first_name"),
      lastName: get("last_name"),
      companyName: get("company_name"),
      displayName: get("display_name"),
      website: get("website"),
      customDomain: get("custom_domain"),
      phone: get("phone"),
      metadata,
      exists: ctx.existing.has(email),
      alreadyContacted: (ctx.existing.get(email)?.sendCount ?? 0) > 0,
      suppressed: ctx.suppressed.has(email),
    };
    counts.validLeads++;
    if (lead.exists) counts.existingLeads++;
    else counts.newLeads++;

    if (!lead.firstName) {
      counts.missingNames++;
      push({ row, type: "missing_name", message: "No first name — {{first_name}} will use the missing-variable rule.", email });
    }
    if (!lead.companyName) {
      counts.missingCompanies++;
      push({ row, type: "missing_company", message: "No company name.", email });
    }
    if (lead.alreadyContacted) {
      counts.alreadyContacted++;
      push({ row, type: "already_contacted", message: "Already emailed before (existing lead updated).", email });
    }
    if (lead.suppressed) {
      push({ row, type: "suppressed", message: "On the suppression list — will never be emailed.", email });
    }
    if (!lead.alreadyContacted && !lead.suppressed) counts.readyToSend++;
    leads.push(lead);
  });

  return { leads, issues, counts };
}

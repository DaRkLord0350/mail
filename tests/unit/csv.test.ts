import { describe, expect, it } from "vitest";
import { analyzeImport, normalizeKey, parseCsv, suggestMapping, type ImportContext } from "@/lib/csv/parse";

const emptyCtx = (): ImportContext => ({ existing: new Map(), suppressed: new Set() });

function analyze(text: string, ctx: ImportContext = emptyCtx()) {
  const parsed = parseCsv(text);
  return { parsed, ...analyzeImport(parsed, suggestMapping(parsed.headers), ctx) };
}

describe("CSV parsing and import analysis", () => {
  it("parses a valid CSV", () => {
    const { parsed, leads, counts, issues } = analyze("email,first_name,last_name,company_name\na@x.com,Ann,Lee,Acme\nb@y.io,Ben,Ray,Beta\n");
    expect(parsed.headers).toEqual(["email", "first_name", "last_name", "company_name"]);
    expect(parsed.errors).toEqual([]);
    expect(counts.totalRows).toBe(2);
    expect(counts.validLeads).toBe(2);
    expect(counts.readyToSend).toBe(2);
    expect(leads[0]).toMatchObject({ email: "a@x.com", firstName: "Ann", lastName: "Lee", companyName: "Acme", row: 1 });
    expect(issues).toEqual([]);
  });

  it("flags invalid emails and skips them", () => {
    const { leads, counts, issues } = analyze("email,first_name\nnot-an-email,A\nfoo@bar,B\ngood@ok.com,C\na@@b.com,D");
    expect(counts.invalidEmails).toBe(3);
    expect(leads.map((l) => l.email)).toEqual(["good@ok.com"]);
    expect(issues.filter((i) => i.type === "invalid_email").map((i) => i.row)).toEqual([1, 2, 4]);
  });

  it("detects in-file duplicates case-insensitively and keeps the first occurrence", () => {
    const { leads, counts, issues } = analyze("email,first_name\nA@X.com,First\n  a@x.COM ,Second\nb@x.com,Other");
    expect(counts.duplicateEmails).toBe(1);
    expect(leads.map((l) => [l.email, l.firstName])).toEqual([
      ["a@x.com", "First"],
      ["b@x.com", "Other"],
    ]);
    expect(issues.find((i) => i.type === "duplicate_in_file")?.row).toBe(2);
  });

  it("rows with a missing email are skipped with an issue", () => {
    const { counts, issues, leads } = analyze("email,first_name\n,NoEmail\n   ,Blank\nok@x.com,Ok");
    expect(leads).toHaveLength(1);
    expect(counts.invalidEmails).toBe(2);
    expect(issues.filter((i) => i.type === "missing_email")).toHaveLength(2);
  });

  it("counts blank rows (including whitespace/comma-only lines) and ignores trailing newlines", () => {
    const { counts, leads } = analyze("email,first_name\na@x.com,A\n\n,\n  \nb@x.com,B\n\n\n");
    expect(leads).toHaveLength(2);
    expect(counts.blankRows).toBe(3);
    expect(counts.totalRows).toBe(5);
  });

  it("malformed rows: too many fields are skipped, too few are kept with empty values", () => {
    const { counts, leads, issues } = analyze("email,first_name,company_name\na@x.com,A,Acme,EXTRA\nb@x.com,B\nc@x.com,C,Co");
    expect(counts.malformedRows).toBe(2);
    expect(leads.map((l) => l.email)).toEqual(["b@x.com", "c@x.com"]);
    expect(leads[0].companyName).toBeNull();
    expect(issues.filter((i) => i.type === "malformed_row").map((i) => i.row)).toEqual([1, 2]);
  });

  it("handles quoted fields containing commas, quotes and newlines", () => {
    const { leads, counts } = analyze('email,company_name,notes\na@x.com,"Acme, Inc.","He said ""hi""\nsecond line"');
    expect(counts.malformedRows).toBe(0);
    expect(leads[0].companyName).toBe("Acme, Inc.");
    expect(leads[0].metadata.notes).toBe('He said "hi"\nsecond line');
  });

  it("strips a UTF-8 BOM from the first header", () => {
    const { parsed, leads } = analyze("﻿email,first_name\r\na@x.com,A\r\n");
    expect(parsed.headers[0]).toBe("email");
    expect(parsed.keys[0]).toBe("email");
    expect(leads).toHaveLength(1);
    expect(suggestMapping(parsed.headers).email).toBe("email");
  });

  it("keeps unknown columns in metadata under normalized keys", () => {
    const { parsed, leads } = analyze("Email,Instagram Handle,Follower Count,  Shop URL ,2024 Revenue,instagramHandle\na@x.com,@shop,1200,https://s.io,50k,dup");
    expect(parsed.keys).toEqual(["email", "instagram_handle", "follower_count", "shop_url", "col_2024_revenue", "instagram_handle_2"]);
    expect(leads[0].metadata).toEqual({
      email: "a@x.com",
      instagram_handle: "@shop",
      follower_count: "1200",
      shop_url: "https://s.io",
      col_2024_revenue: "50k",
      instagram_handle_2: "dup",
    });
  });

  it("normalizeKey handles common header styles", () => {
    expect(normalizeKey("Company Name")).toBe("company_name");
    expect(normalizeKey("E-mail")).toBe("e_mail");
    expect(normalizeKey("firstName")).toBe("first_name");
    expect(normalizeKey("  Instagram Handle ")).toBe("instagram_handle");
    expect(normalizeKey("!!!")).toBe("");
  });

  it("suggestMapping for the real sample header set", () => {
    const headers = "source_csv_row,display_name,billing_address_company_name,custom_domain,website_active,company_name,first_name,last_name,email,phone,source_columns_used".split(",");
    const m = suggestMapping(headers);
    expect(m.email).toBe("email");
    expect(m.first_name).toBe("first_name");
    expect(m.last_name).toBe("last_name");
    expect(m.company_name).toBe("company_name");
    expect(m.display_name).toBe("display_name");
    expect(m.custom_domain).toBe("custom_domain");
    expect(m.website).toBe("custom_domain");
    expect(m.phone).toBe("phone");
  });

  it("suggestMapping for alternative headers", () => {
    const m = suggestMapping(["E-mail", "First Name", "Last Name", "Company", "Website", "Mobile"]);
    expect(m).toMatchObject({ email: "E-mail", first_name: "First Name", last_name: "Last Name", company_name: "Company", website: "Website", phone: "Mobile" });
    const m2 = suggestMapping(["Email Address", "Given Name", "Surname", "Organization", "URL", "Phone Number"]);
    expect(m2).toMatchObject({ email: "Email Address", first_name: "Given Name", last_name: "Surname", company_name: "Organization", website: "URL", phone: "Phone Number" });
  });

  it("suggestMapping leaves fields unmapped when nothing matches", () => {
    const m = suggestMapping(["foo", "bar"]);
    expect(Object.values(m).every((v) => v === null)).toBe(true);
  });

  it("counts already-contacted and suppressed leads from the ImportContext", () => {
    const ctx: ImportContext = {
      existing: new Map([
        ["old@x.com", { sendCount: 2 }],
        ["known@x.com", { sendCount: 0 }],
      ]),
      suppressed: new Set(["blocked@x.com"]),
    };
    const { counts, leads, issues } = analyze("email,first_name,company_name\nold@x.com,O,Co\nknown@x.com,K,Co\nblocked@x.com,B,Co\nnew@x.com,N,Co", ctx);
    expect(counts.validLeads).toBe(4);
    expect(counts.alreadyContacted).toBe(1);
    expect(counts.existingLeads).toBe(2);
    expect(counts.newLeads).toBe(2);
    expect(counts.readyToSend).toBe(2); // known + new
    expect(leads.find((l) => l.email === "blocked@x.com")?.suppressed).toBe(true);
    expect(issues.filter((i) => i.type === "suppressed")).toHaveLength(1);
    expect(issues.filter((i) => i.type === "already_contacted")).toHaveLength(1);
  });

  it("counts missing names and companies", () => {
    const { counts } = analyze("email,first_name,company_name\na@x.com,,\nb@x.com,B,\nc@x.com,C,Co");
    expect(counts.missingNames).toBe(1);
    expect(counts.missingCompanies).toBe(2);
  });

  it("empty file reports an error", () => {
    expect(parseCsv("").errors.length).toBeGreaterThan(0);
    expect(parseCsv("   \n\n").headers).toEqual([]);
  });

  it("analyzeImport requires an email mapping", () => {
    const parsed = parseCsv("name\nx");
    expect(() => analyzeImport(parsed, suggestMapping(parsed.headers), emptyCtx())).toThrow();
  });
});

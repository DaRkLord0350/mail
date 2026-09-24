import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/server/db";
import { HttpError } from "@/lib/server/http";
import { sendTestEmail } from "@/lib/server/test-email";
import { setTransport } from "@/lib/email/resend";
import { parseCsv, suggestMapping } from "@/lib/csv/parse";
import { commitImport } from "@/lib/server/leads";
import { startCampaign } from "@/lib/server/campaigns";
import { FakeTransport, createLeads, deliveryByEmail, errorResult, setupCampaign, updateSettings, work } from "./helpers";

describe("suppression", () => {
  it("a lead suppressed before start gets a SKIPPED delivery and is never sent", async () => {
    await prisma.suppression.create({ data: { email: "lead0002@example.com", source: "MANUAL" } });
    const { campaignId } = await setupCampaign({ leads: 3 });
    const d2 = await deliveryByEmail(campaignId, "lead0002@example.com");
    expect(d2.status).toBe("SKIPPED");
    expect(d2.errorCode).toBe("suppressed");
    const tr = new FakeTransport();
    await work(tr);
    expect(tr.recipients.sort()).toEqual(["lead0001@example.com", "lead0003@example.com"]);
  });

  it("a lead suppressed after start is marked SKIPPED by the worker and the transport is never called for it", async () => {
    const { campaignId } = await setupCampaign({ leads: 3 });
    await prisma.suppression.create({ data: { email: "lead0001@example.com", source: "UNSUBSCRIBE" } });
    const tr = new FakeTransport();
    const r = await work(tr);
    expect(r.skipped).toBe(1);
    expect(tr.recipients).not.toContain("lead0001@example.com");
    expect(tr.calls).toHaveLength(2);
    const d = await deliveryByEmail(campaignId, "lead0001@example.com");
    expect(d.status).toBe("SKIPPED");
    expect((await prisma.lead.findUniqueOrThrow({ where: { email: "lead0001@example.com" } })).status).toBe("SKIPPED");
    expect((await prisma.campaign.findUniqueOrThrow({ where: { id: campaignId } })).status).toBe("COMPLETED");
  });
});

describe("missing variables", () => {
  const seeds = [
    { email: "has@example.com", firstName: "Asha", companyName: "Acme" },
    { email: "missing@example.com", firstName: null, companyName: "Beta" },
  ];

  it("SKIP: a lead missing {{first_name}} gets a SKIPPED delivery with the reason; others are sent", async () => {
    await updateSettings({ missingVariableBehavior: "SKIP" });
    const { campaignId } = await setupCampaign({ leads: seeds });
    const d = await deliveryByEmail(campaignId, "missing@example.com");
    expect(d.status).toBe("SKIPPED");
    expect(d.errorCode).toBe("render_skipped");
    expect(d.errorMessage).toContain("{{first_name}}");
    const tr = new FakeTransport();
    await work(tr);
    expect(tr.recipients).toEqual(["has@example.com"]);
  });

  it("FALLBACK + settings fallback: the lead is sent with the fallback value", async () => {
    await updateSettings({ missingVariableBehavior: "FALLBACK", fallbackValues: { first_name: "there" } });
    const { campaignId } = await setupCampaign({ leads: seeds, subject: "Quick question, {{first_name}}", body: "Hi {{first_name}},\nre {{company_name}}" });
    const tr = new FakeTransport();
    await work(tr);
    const call = tr.calls.find((c) => c.to === "missing@example.com")!;
    expect(call.subject).toBe("Quick question, there");
    expect(call.text.startsWith("Hi there,\nre Beta")).toBe(true);
    expect((await deliveryByEmail(campaignId, "missing@example.com")).status).toBe("SENT");
  });

  it("FALLBACK without a configured fallback skips the lead", async () => {
    await updateSettings({ missingVariableBehavior: "FALLBACK", fallbackValues: {} });
    const { campaignId } = await setupCampaign({ leads: seeds });
    expect((await deliveryByEmail(campaignId, "missing@example.com")).status).toBe("SKIPPED");
  });

  it("stored renderedSubject/renderedBody equal exactly what the transport received", async () => {
    const { campaignId } = await setupCampaign({ leads: 3, subject: "Hi {{first_name}} from {{company_name}}", body: "Hello {{first_name}} {{last_name}},\nVisit https://example.com/x?a=1&b=2" });
    const tr = new FakeTransport();
    await work(tr);
    for (const call of tr.calls) {
      const d = await deliveryByEmail(campaignId, call.to);
      expect(call.subject).toBe(d.renderedSubject);
      expect(call.text).toBe(d.renderedBody);
      // Personal 1:1 mail by default: no unsubscribe footer, no bulk-mail headers.
      expect(d.renderedBody).not.toContain("/unsubscribe?e=");
      expect(call.from).toBe('"Test Sender" <sender@example.com>');
      expect(call.headers?.["List-Unsubscribe"]).toBeUndefined();
      expect(call.html).toMatch(/^<div dir="ltr">/);
    }
  });

  it("the optional unsubscribe footer + List-Unsubscribe headers are added only when enabled", async () => {
    await updateSettings({ includeUnsubscribe: true });
    const { campaignId } = await setupCampaign({ leads: 1 });
    const tr = new FakeTransport();
    await work(tr);
    const d = await deliveryByEmail(campaignId, tr.calls[0].to);
    expect(d.renderedBody).toContain("/unsubscribe?e=");
    expect(tr.calls[0].headers?.["List-Unsubscribe"]).toContain("/api/unsubscribe?e=");
  });

  it("unknown variables block the start (400)", async () => {
    const { campaignId } = await setupCampaign({ leads: 1, start: false, subject: "Hi {{nonexistent_col}}" });
    const err = await startCampaign(campaignId).catch((e) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(400);
  });

  it("CSV-only (metadata) variables can be used in templates", async () => {
    const { campaignId } = await setupCampaign({
      leads: [{ email: "ig@example.com", firstName: "Ravi", metadata: { instagram_handle: "@ravi.shop" } }],
      subject: "Loved {{instagram_handle}}",
      body: "Hi {{first_name}}",
    });
    expect((await deliveryByEmail(campaignId, "ig@example.com")).renderedSubject).toBe("Loved @ravi.shop");
  });
});

describe("test email", () => {
  it("sends via the transport with a [TEST] subject, logs a TestEmail row and does NOT touch DailyUsage", async () => {
    const [lead] = await createLeads([{ email: "real-lead@example.com", firstName: "Meera", companyName: "Acme" }]);
    const tr = new FakeTransport();
    setTransport(tr);
    const res = await sendTestEmail({ to: "Me@Example.com", leadId: lead.id, subject: "Hi {{first_name}}", body: "Hello {{first_name}} at {{company_name}}" });
    expect(res.ok).toBe(true);
    expect(tr.calls).toHaveLength(1);
    expect(tr.calls[0].to).toBe("me@example.com");
    expect(tr.calls[0].subject).toBe("[TEST] Hi Meera");
    expect(tr.calls[0].text).toContain("Hello Meera at Acme");
    // Unsubscribe link targets the tester, never the real lead.
    expect(tr.calls[0].text).toContain("e=me%40example.com");
    expect(tr.calls[0].text).not.toContain("e=real-lead%40example.com");
    const rows = await prisma.testEmail.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("SENT");
    expect(rows[0].leadId).toBe(lead.id);
    expect(await prisma.dailyUsage.count()).toBe(0);
    expect(await prisma.emailDelivery.count()).toBe(0);
    const after = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(after.status).toBe("READY");
    expect(after.sendCount).toBe(0);
  });

  it("a rejected test email is logged as FAILED and surfaces a 502", async () => {
    const [lead] = await createLeads([{ email: "x@example.com", firstName: "X" }]);
    setTransport(new FakeTransport([errorResult("validation_error", 422, "bad")]));
    const err = await sendTestEmail({ to: "me@example.com", leadId: lead.id, subject: "s", body: "b" }).catch((e) => e);
    expect((err as HttpError).status).toBe(502);
    expect((await prisma.testEmail.findFirstOrThrow()).status).toBe("FAILED");
    expect(await prisma.dailyUsage.count()).toBe(0);
  });
});

describe("CSV import end-to-end (commitImport)", () => {
  const csv = [
    "Email,First Name,Last Name,Company,Website,Instagram Handle,Notes",
    "alice@example.com,Alice,Smith,Acme Inc,acme.com,@acme,\"likes, commas\"",
    "BOB@Example.com,Bob,,\"Bob's Shop, LLC\",bob.shop,@bob,",
    "not-an-email,Carl,,C Co,c.com,@c,",
    "bob@example.com,Bobby,,Dup Co,dup.com,@dup,duplicate",
    ",NoEmail,,N Co,n.com,,",
    "",
    "dana@example.com,Dana,Lee,,,,",
  ].join("\n");

  it("counts are correct and leads are persisted with metadata", async () => {
    const parsed = parseCsv(csv);
    const mapping = suggestMapping(parsed.headers);
    expect(mapping.email).toBe("Email");
    const batch = await commitImport("leads.csv", parsed, mapping);
    expect(batch.totalRows).toBe(7);
    expect(batch.validLeads).toBe(3);
    expect(batch.createdLeads).toBe(3);
    expect(batch.updatedLeads).toBe(0);
    expect(batch.invalidEmails).toBe(2); // invalid + missing
    expect(batch.duplicateEmails).toBe(1);
    expect(batch.blankRows).toBe(1);
    expect(batch.missingCompanies).toBe(1);

    const bob = await prisma.lead.findUniqueOrThrow({ where: { email: "bob@example.com" } });
    expect(bob.firstName).toBe("Bob"); // first occurrence kept
    expect(bob.companyName).toBe("Bob's Shop, LLC");
    expect(bob.importBatchId).toBe(batch.id);
    const alice = await prisma.lead.findUniqueOrThrow({ where: { email: "alice@example.com" } });
    expect(alice.metadata).toMatchObject({ instagram_handle: "@acme", notes: "likes, commas", first_name: "Alice" });
    expect(alice.website).toBe("acme.com");
    expect(await prisma.lead.count()).toBe(3);
  });

  it("re-import updates existing leads without touching status / sendCount, and counts them as already contacted", async () => {
    const parsed = parseCsv(csv);
    await commitImport("leads.csv", parsed, suggestMapping(parsed.headers));
    await prisma.lead.update({ where: { email: "alice@example.com" }, data: { status: "SENT", sendCount: 2, lastSentAt: new Date() } });

    const csv2 = ["Email,First Name,Company,Instagram Handle,Tier", "ALICE@example.com,Alicia,,@acme_new,gold", "erin@example.com,Erin,E Co,@erin,silver"].join("\n");
    const p2 = parseCsv(csv2);
    const batch = await commitImport("leads2.csv", p2, suggestMapping(p2.headers));
    expect(batch.createdLeads).toBe(1);
    expect(batch.updatedLeads).toBe(1);
    expect(batch.alreadyContacted).toBe(1);
    expect(batch.readyToSend).toBe(1);

    const alice = await prisma.lead.findUniqueOrThrow({ where: { email: "alice@example.com" } });
    expect(alice.status).toBe("SENT");
    expect(alice.sendCount).toBe(2);
    expect(alice.firstName).toBe("Alicia");
    expect(alice.companyName).toBe("Acme Inc"); // empty value does not wipe existing data
    expect(alice.metadata).toMatchObject({ instagram_handle: "@acme_new", tier: "gold", notes: "likes, commas" });
    expect(await prisma.lead.count()).toBe(4);
  });

  it("suppressed addresses are imported but not counted as ready to send", async () => {
    await prisma.suppression.create({ data: { email: "dana@example.com" } });
    const parsed = parseCsv(csv);
    const batch = await commitImport("leads.csv", parsed, suggestMapping(parsed.headers));
    expect(batch.readyToSend).toBe(2);
  });
});

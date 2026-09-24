import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/server/db";
import { campaignDTOById, createCampaign, previewCampaign, retryFailed, startCampaign, stopCampaign, updateRecipients } from "@/lib/server/campaigns";
import { getDashboard } from "@/lib/server/dashboard";
import { FakeTransport, deliveryByEmail, errorResult, globalUsage, setupCampaign, updateSettings, work } from "./helpers";

const E1 = "lead0001@example.com";

/** A second (not yet started) campaign with the given leads as recipients. */
async function secondCampaign(leadIds: string[], name = "Second") {
  const c = await createCampaign({ name, subjectTemplate: "Hi {{first_name}}", bodyTemplate: "Hello {{company_name}}" });
  await updateRecipients(c.id, { mode: "set", leadIds });
  return c.id;
}

describe("one active campaign per lead", () => {
  it("a lead queued in campaign A is skipped when B starts (errorCode queued_elsewhere) and counted in B's preview", async () => {
    const { leads } = await setupCampaign({ leads: 2, name: "Alpha" });
    const extra = await prisma.lead.create({ data: { email: "fresh@example.com", firstName: "Fresh", companyName: "Co" } });
    const b = await secondCampaign([leads[0].id, extra.id]);

    const preview = await previewCampaign(b, {});
    expect(preview.summary.queuedElsewhere).toBe(1);
    expect(preview.summary.willSend).toBe(1);
    expect(preview.items.find((i) => i.to === E1)?.skipReason).toBe('Already queued in campaign "Alpha"');

    const r = await startCampaign(b);
    expect(r.enqueued).toBe(1);
    expect(r.skipped).toBe(1);
    const d = await deliveryByEmail(b, E1);
    expect(d.status).toBe("SKIPPED");
    expect(d.errorCode).toBe("queued_elsewhere");
    // The lead is still pending for campaign A.
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: leads[0].id } })).status).toBe("PENDING");
  });

  it("two campaigns with the same leads started concurrently queue each lead exactly once", async () => {
    const { campaignId: a, leads } = await setupCampaign({ leads: 4, start: false, name: "A" });
    const b = await secondCampaign(leads.map((l) => l.id), "B");
    const results = await Promise.allSettled([startCampaign(a), startCampaign(b)]);
    expect(results.every((x) => x.status === "fulfilled")).toBe(true);
    const pending = await prisma.emailDelivery.findMany({ where: { status: "PENDING" }, select: { leadId: true } });
    expect(pending).toHaveLength(4);
    expect(new Set(pending.map((p) => p.leadId)).size).toBe(4);
    const tr = new FakeTransport();
    await work(tr);
    expect(tr.calls).toHaveLength(4);
  });

  it("a send in flight when the campaign was stopped that comes back PENDING is skipped, and frees the lead for other campaigns", async () => {
    const { campaignId: a, leads } = await setupCampaign({ leads: 2, name: "A" });
    const d0 = await deliveryByEmail(a, E1);
    const past = new Date(Date.now() - 11 * 60_000);
    await prisma.emailDelivery.update({ where: { id: d0.id }, data: { status: "PROCESSING", lockedAt: past, lastAttemptAt: past, lockToken: "dead", attempts: 1 } });
    await stopCampaign(a);

    // A stale PROCESSING row still blocks the lead (it may be sent right now).
    const b = await secondCampaign([leads[0].id], "B");
    expect((await previewCampaign(b, {})).summary.queuedElsewhere).toBe(1);

    // Crash recovery puts it back to PENDING; the stopped campaign will never send it.
    const tr = new FakeTransport();
    const r = await work(tr);
    expect(tr.calls).toHaveLength(0);
    expect(r.skipped).toBe(1);
    const d = await deliveryByEmail(a, E1);
    expect(d.status).toBe("SKIPPED");
    expect(d.errorCode).toBe("campaign_stopped");
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: leads[0].id } })).status).toBe("SKIPPED");

    const started = await startCampaign(b);
    expect(started.enqueued).toBe(1);
    await work(tr);
    expect(tr.recipients).toEqual([E1]);
  });

  it("retry-failed does not requeue a lead that another campaign has queued meanwhile", async () => {
    await updateSettings({ maxRetries: 1 });
    const { campaignId: a, leads } = await setupCampaign({ leads: 1, name: "A" });
    await work(new FakeTransport([errorResult("rate_limit_exceeded", 429)]));
    expect((await deliveryByEmail(a, E1)).status).toBe("FAILED");

    const b = await secondCampaign([leads[0].id], "B");
    expect((await startCampaign(b)).enqueued).toBe(1);
    const res = await retryFailed(a);
    expect(res.requeued).toBe(0);
    expect((await deliveryByEmail(a, E1)).status).toBe("FAILED");
  });
});

describe("halt visibility and bookkeeping", () => {
  it("the circuit breaker gives the rejected sends' quota back and exposes the halt reason in DTOs", async () => {
    const { campaignId } = await setupCampaign({ leads: 4 });
    const tr = new FakeTransport();
    for (let i = 1; i <= 4; i++) tr.byEmail.set(`lead000${i}@example.com`, errorResult("validation_error", 422, "The domain is not verified"));
    const r = await work(tr);
    expect(r.stopReason).toBe("auth_error");
    expect(await globalUsage()).toBe(0);
    const campUsage = await prisma.dailyUsage.findMany({ where: { scope: campaignId } });
    expect(campUsage.reduce((a, u) => a + u.emailsSent, 0)).toBe(0);

    expect((await campaignDTOById(campaignId)).sendingHaltedReason).toMatch(/3 emails in a row/);
    expect((await getDashboard()).worker.haltedReason).toMatch(/3 emails in a row/);
  });

  it("unknown-outcome recovery marks the lead FAILED (not stuck PENDING)", async () => {
    const { campaignId, leads } = await setupCampaign({ leads: 1 });
    const d0 = await deliveryByEmail(campaignId, E1);
    const old = new Date(Date.now() - 24 * 3600_000);
    await prisma.emailDelivery.update({ where: { id: d0.id }, data: { status: "PROCESSING", lockedAt: old, lastAttemptAt: old, lockToken: "dead", attempts: 1, idempotencyKey: "k" } });
    await work(new FakeTransport());
    expect((await deliveryByEmail(campaignId, E1)).status).toBe("FAILED");
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: leads[0].id } })).status).toBe("FAILED");
  });
});

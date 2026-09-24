import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/server/db";
import { retryFailed } from "@/lib/server/campaigns";
import { FakeTransport, deliveryByEmail, errorResult, makeDue, setupCampaign, updateSettings, work } from "./helpers";

const E1 = "lead0001@example.com";

describe("worker safeguards", () => {
  it("circuit breaker: 3 identical permanent failures in a row halt sending and pause campaigns", async () => {
    const { campaignId } = await setupCampaign({ leads: 5 });
    const tr = new FakeTransport();
    for (let i = 1; i <= 5; i++) tr.byEmail.set(`lead000${i}@example.com`, errorResult("validation_error", 422, "The domain is not verified"));
    const r = await work(tr);
    expect(r.stopReason).toBe("auth_error");
    expect(tr.calls).toHaveLength(3);
    expect((await prisma.campaign.findUniqueOrThrow({ where: { id: campaignId } })).status).toBe("PAUSED");
    expect((await prisma.workerState.findUniqueOrThrow({ where: { id: 1 } })).haltedReason).toMatch(/3 emails in a row/);
    expect((await deliveryByEmail(campaignId, "lead0004@example.com")).status).toBe("PENDING");
    // The leads that tripped the breaker were rejected (not sent) → requeued, not stuck as FAILED.
    for (let i = 1; i <= 3; i++) {
      const d = await deliveryByEmail(campaignId, `lead000${i}@example.com`);
      expect(d.status).toBe("PENDING");
      expect(d.attempts).toBe(0);
    }
    expect(r.failed).toBe(0);
  });

  it("distinct permanent errors do not trip the breaker", async () => {
    await setupCampaign({ leads: 4 });
    const tr = new FakeTransport();
    for (let i = 1; i <= 3; i++) tr.byEmail.set(`lead000${i}@example.com`, errorResult("validation_error", 422, `bad recipient ${i}`));
    const r = await work(tr);
    expect(r.failed).toBe(3);
    expect(r.sent).toBe(1);
    expect(r.stopReason).toBe("queue_empty");
  });

  it("a retry with the same idempotency key resends the frozen payload even if settings changed", async () => {
    const { campaignId } = await setupCampaign({ leads: 1 });
    const tr = new FakeTransport([errorResult("internal_server_error", 500)]);
    await work(tr);
    await updateSettings({ fromName: "Changed Name", replyTo: "reply@example.com" });
    await makeDue(campaignId);
    await work(tr);
    expect(tr.calls).toHaveLength(2);
    expect(tr.calls[1]).toEqual(tr.calls[0]);
    expect(tr.calls[1].from).toBe('"Test Sender" <sender@example.com>');
  });

  it("retry-failed leaves a keyed failure older than the 23h idempotency window FAILED", async () => {
    await updateSettings({ maxRetries: 1 });
    const { campaignId } = await setupCampaign({ leads: 2 });
    const tr = new FakeTransport();
    tr.byEmail.set("lead0001@example.com", errorResult("internal_server_error", 500));
    tr.byEmail.set("lead0002@example.com", errorResult("internal_server_error", 502));
    await work(tr);
    const old = await deliveryByEmail(campaignId, "lead0001@example.com");
    expect(old.status).toBe("FAILED");
    expect(old.idempotencyKey).toBeTruthy();
    await prisma.emailDelivery.update({ where: { id: old.id }, data: { lastAttemptAt: new Date(Date.now() - 24 * 3600_000) } });
    const res = await retryFailed(campaignId);
    expect(res.requeued).toBe(1);
    expect((await deliveryByEmail(campaignId, "lead0001@example.com")).status).toBe("FAILED");
    expect((await deliveryByEmail(campaignId, "lead0002@example.com")).status).toBe("PENDING");
  });

  it("with a real send delay the worker stops as 'paced' instead of busy-looping when work is waiting", async () => {
    await setupCampaign({ leads: 3 });
    const tr = new FakeTransport();
    const r = await work(tr, { delaySeconds: 3600, maxRuntimeMs: 30_000 });
    expect(r.sent).toBe(1);
    expect(r.stopReason).toBe("paced");
    const r2 = await work(tr, { delaySeconds: 3600, maxRuntimeMs: 30_000 });
    expect(r2.sent).toBe(0);
    expect(tr.calls).toHaveLength(1);
  });

  it("a pass with nothing due reports queue_empty (no sleeping on the pacing gate)", async () => {
    await setupCampaign({ leads: 1 });
    await work(new FakeTransport(), { delaySeconds: 3600 });
    const r = await work(new FakeTransport(), { delaySeconds: 3600 });
    expect(r.stopReason).toBe("queue_empty");
  });

  it("no sender configured → not_configured, nothing sent", async () => {
    await updateSettings({ fromEmail: null });
    await setupCampaign({ leads: 1 });
    const tr = new FakeTransport();
    const r = await work(tr);
    expect(r.stopReason).toBe("not_configured");
    expect(tr.calls).toHaveLength(0);
    expect((await prisma.lead.findUniqueOrThrow({ where: { email: E1 } })).status).toBe("PENDING");
  });
});

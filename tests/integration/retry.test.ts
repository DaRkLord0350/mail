import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/server/db";
import { clearHalt } from "@/lib/server/worker";
import { resumeCampaign, retryFailed } from "@/lib/server/campaigns";
import { FakeTransport, deliveryByEmail, errorResult, globalUsage, makeDue, setupCampaign, updateSettings, work } from "./helpers";

const E1 = "lead0001@example.com";

describe("retries and failures", () => {
  it("transient 500 → back to PENDING, attempts=1, nextAttemptAt in the future, idempotency key kept; retry succeeds with the SAME key", async () => {
    const { campaignId } = await setupCampaign({ leads: 1 });
    const tr = new FakeTransport([errorResult("internal_server_error", 500)]);
    const r1 = await work(tr);
    expect(r1.retried).toBe(1);
    let d = await deliveryByEmail(campaignId, E1);
    expect(d.status).toBe("PENDING");
    expect(d.attempts).toBe(1);
    expect(d.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
    expect(d.idempotencyKey).toBeTruthy();
    expect(d.idempotencyKey).toBe(tr.calls[0].idempotencyKey);
    expect(d.errorKind).toBe("TRANSIENT");

    // Not due yet: a new pass sends nothing.
    const r2 = await work(tr);
    expect(r2.processed).toBe(0);
    expect(tr.calls).toHaveLength(1);

    await makeDue(campaignId);
    const r3 = await work(tr);
    expect(r3.sent).toBe(1);
    expect(tr.calls).toHaveLength(2);
    expect(tr.calls[1].idempotencyKey).toBe(tr.calls[0].idempotencyKey);
    // The payload must be byte-identical across retries for Resend's idempotency.
    expect(tr.calls[1]).toEqual(tr.calls[0]);
    d = await deliveryByEmail(campaignId, E1);
    expect(d.status).toBe("SENT");
    expect(d.attempts).toBe(2);
    expect(d.providerMessageId).toBeTruthy();
    expect(d.errorMessage).toBeNull();
    const lead = await prisma.lead.findUniqueOrThrow({ where: { email: E1 } });
    expect(lead.sendCount).toBe(1);
  });

  it("network error / timeout keep the key too", async () => {
    const { campaignId } = await setupCampaign({ leads: 1 });
    const tr = new FakeTransport([errorResult("network_error", null)]);
    await work(tr);
    const d = await deliveryByEmail(campaignId, E1);
    expect(d.status).toBe("PENDING");
    expect(d.idempotencyKey).toBe(tr.calls[0].idempotencyKey);
  });

  it("429 → PENDING with the idempotency key cleared; the retry uses a new key", async () => {
    const { campaignId } = await setupCampaign({ leads: 1 });
    const tr = new FakeTransport([errorResult("rate_limit_exceeded", 429)]);
    await work(tr);
    let d = await deliveryByEmail(campaignId, E1);
    expect(d.status).toBe("PENDING");
    expect(d.attempts).toBe(1);
    expect(d.idempotencyKey).toBeNull();
    await makeDue(campaignId);
    await work(tr);
    d = await deliveryByEmail(campaignId, E1);
    expect(d.status).toBe("SENT");
    expect(tr.calls).toHaveLength(2);
    expect(tr.calls[1].idempotencyKey).toBeTruthy();
    expect(tr.calls[1].idempotencyKey).not.toBe(tr.calls[0].idempotencyKey);
  });

  it("permanent 422 → FAILED immediately and not retried; other leads still sent (1 SENT, 2 SENT, 3 FAILED, 4 SENT)", async () => {
    const { campaignId } = await setupCampaign({ leads: 4 });
    const tr = new FakeTransport();
    tr.byEmail.set("lead0003@example.com", errorResult("validation_error", 422, "Invalid `to` field"));
    const r = await work(tr);
    expect(r.sent).toBe(3);
    expect(r.failed).toBe(1);
    const status = async (n: number) => (await deliveryByEmail(campaignId, `lead000${n}@example.com`)).status;
    expect([await status(1), await status(2), await status(3), await status(4)]).toEqual(["SENT", "SENT", "FAILED", "SENT"]);
    // Queue order followed the recipient order.
    expect(tr.recipients).toEqual(["lead0001@example.com", "lead0002@example.com", "lead0003@example.com", "lead0004@example.com"]);
    const failed = await deliveryByEmail(campaignId, "lead0003@example.com");
    expect(failed.errorKind).toBe("PERMANENT");
    expect(failed.attempts).toBe(1);
    expect((await prisma.lead.findUniqueOrThrow({ where: { email: "lead0003@example.com" } })).status).toBe("FAILED");

    await makeDue();
    await work(tr);
    expect(tr.calls).toHaveLength(4); // never retried
    expect((await prisma.campaign.findUniqueOrThrow({ where: { id: campaignId } })).status).toBe("COMPLETED");
  });

  it("maxRetries=3 → FAILED after exactly 3 attempts", async () => {
    await updateSettings({ maxRetries: 3 });
    const { campaignId } = await setupCampaign({ leads: 1 });
    const tr = new FakeTransport();
    tr.byEmail.set(E1, errorResult("internal_server_error", 500));
    for (let i = 0; i < 5; i++) {
      await work(tr);
      await makeDue(campaignId);
    }
    expect(tr.calls).toHaveLength(3);
    const d = await deliveryByEmail(campaignId, E1);
    expect(d.status).toBe("FAILED");
    expect(d.attempts).toBe(3);
    expect(d.errorKind).toBe("TRANSIENT");
    // All three attempts reused one key (5xx: outcome unknown).
    expect(new Set(tr.calls.map((c) => c.idempotencyKey)).size).toBe(1);
  });

  it("invalid_idempotent_request → FAILED as UNKNOWN_OUTCOME, never resent", async () => {
    const { campaignId } = await setupCampaign({ leads: 1 });
    const tr = new FakeTransport([errorResult("invalid_idempotent_request", 400)]);
    await work(tr);
    const d = await deliveryByEmail(campaignId, E1);
    expect(d.status).toBe("FAILED");
    expect(d.errorKind).toBe("UNKNOWN_OUTCOME");
    await makeDue();
    await work(tr);
    expect(tr.calls).toHaveLength(1);
  });

  it("auth error (401 invalid_api_key) → delivery back to PENDING (attempts unchanged), campaign PAUSED, worker halted until clearHalt/resume", async () => {
    const { campaignId } = await setupCampaign({ leads: 3 });
    const tr = new FakeTransport([errorResult("invalid_api_key", 401, "API key is invalid")]);
    const r = await work(tr);
    expect(r.stopReason).toBe("auth_error");
    expect(tr.calls).toHaveLength(1);

    const d = await deliveryByEmail(campaignId, E1);
    expect(d.status).toBe("PENDING");
    expect(d.attempts).toBe(0);
    expect(d.lockToken).toBeNull();
    const c = await prisma.campaign.findUniqueOrThrow({ where: { id: campaignId } });
    expect(c.status).toBe("PAUSED");
    expect(c.lastError).toMatch(/API key is invalid/);
    const ws = await prisma.workerState.findUniqueOrThrow({ where: { id: 1 } });
    expect(ws.haltedReason).toMatch(/API key is invalid/);
    // Nothing was sent, so the reserved quota slot was refunded.
    expect(await globalUsage()).toBe(0);
    // Halted: nothing is sent, even if the campaign is forced back to RUNNING.
    await prisma.campaign.update({ where: { id: campaignId }, data: { status: "RUNNING" } });
    const r2 = await work(tr);
    expect(r2.stopReason).toBe("auth_error");
    expect(tr.calls).toHaveLength(1);

    await clearHalt();
    const r3 = await work(tr);
    expect(r3.sent).toBe(3);
    expect(tr.calls).toHaveLength(4);
    expect(await globalUsage()).toBe(3);
  });

  it("auth halt is cleared by resuming the paused campaign", async () => {
    const { campaignId } = await setupCampaign({ leads: 2 });
    const tr = new FakeTransport([errorResult("invalid_api_key", 401)]);
    await work(tr);
    expect((await prisma.campaign.findUniqueOrThrow({ where: { id: campaignId } })).status).toBe("PAUSED");
    await resumeCampaign(campaignId);
    expect((await prisma.workerState.findUniqueOrThrow({ where: { id: 1 } })).haltedReason).toBeNull();
    const r = await work(tr);
    expect(r.sent).toBe(2);
    const c = await prisma.campaign.findUniqueOrThrow({ where: { id: campaignId } });
    expect(c.status).toBe("COMPLETED");
    expect(c.lastError).toBeNull();
  });

  it("403 testing-domain restriction halts sending like an auth error", async () => {
    const { campaignId } = await setupCampaign({ leads: 2 });
    const tr = new FakeTransport([errorResult("validation_error", 403, "You can only send testing emails to your own email address")]);
    const r = await work(tr);
    expect(r.stopReason).toBe("auth_error");
    expect((await deliveryByEmail(campaignId, E1)).status).toBe("PENDING");
    expect((await prisma.campaign.findUniqueOrThrow({ where: { id: campaignId } })).status).toBe("PAUSED");
  });

  it("retry-failed requeues TRANSIENT failures but not PERMANENT ones", async () => {
    await updateSettings({ maxRetries: 1 });
    const { campaignId } = await setupCampaign({ leads: 3 });
    const tr = new FakeTransport();
    tr.byEmail.set("lead0001@example.com", errorResult("internal_server_error", 500));
    tr.byEmail.set("lead0002@example.com", errorResult("validation_error", 422));
    await work(tr);
    expect((await deliveryByEmail(campaignId, "lead0001@example.com")).status).toBe("FAILED");
    expect((await deliveryByEmail(campaignId, "lead0002@example.com")).status).toBe("FAILED");
    expect((await prisma.campaign.findUniqueOrThrow({ where: { id: campaignId } })).status).toBe("COMPLETED");

    const res = await retryFailed(campaignId);
    expect(res.requeued).toBe(1);
    const t1 = await deliveryByEmail(campaignId, "lead0001@example.com");
    expect(t1.status).toBe("PENDING");
    expect(t1.attempts).toBe(0);
    // 5xx = ambiguous outcome: requeued with the SAME idempotency key.
    const firstKey = tr.calls.find((c) => c.to === "lead0001@example.com")!.idempotencyKey;
    expect(t1.idempotencyKey).toBe(firstKey);
    expect((await deliveryByEmail(campaignId, "lead0002@example.com")).status).toBe("FAILED");
    expect((await prisma.campaign.findUniqueOrThrow({ where: { id: campaignId } })).status).toBe("RUNNING");

    tr.byEmail.clear();
    await work(tr);
    expect((await deliveryByEmail(campaignId, "lead0001@example.com")).status).toBe("SENT");
    expect((await deliveryByEmail(campaignId, "lead0002@example.com")).status).toBe("FAILED");
    expect(tr.recipients.filter((e) => e === "lead0002@example.com")).toHaveLength(1);
    expect(tr.calls[tr.calls.length - 1].idempotencyKey).toBe(firstKey);
  });
});

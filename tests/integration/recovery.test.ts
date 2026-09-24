import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/server/db";
import type { SendResult } from "@/lib/email/resend";
import { FakeTransport, deliveryByEmail, setupCampaign, work } from "./helpers";

const E1 = "lead0001@example.com";

async function waitFor(cond: () => Promise<boolean> | boolean, timeoutMs = 60_000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await cond()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("waitFor timed out");
}

describe("crash recovery", () => {
  it("PROCESSING with a lock older than 10 min → recovered to PENDING and resent with the SAME idempotency key", async () => {
    const { campaignId } = await setupCampaign({ leads: 1 });
    const d0 = await deliveryByEmail(campaignId, E1);
    const past = new Date(Date.now() - 11 * 60_000);
    await prisma.emailDelivery.update({
      where: { id: d0.id },
      data: { status: "PROCESSING", lockedAt: past, lastAttemptAt: past, lockToken: "dead-worker", attempts: 1, idempotencyKey: "mail-crashed-key-1" },
    });
    const tr = new FakeTransport();
    const r = await work(tr);
    expect(r.recovered).toBe(1);
    expect(r.sent).toBe(1);
    expect(tr.calls).toHaveLength(1);
    expect(tr.calls[0].idempotencyKey).toBe("mail-crashed-key-1");
    const d = await deliveryByEmail(campaignId, E1);
    expect(d.status).toBe("SENT");
    expect(d.attempts).toBe(2);
    expect(d.lockToken).toBeNull();
  });

  it("a fresh PROCESSING lock (< 10 min) is left alone", async () => {
    const { campaignId } = await setupCampaign({ leads: 1 });
    const d0 = await deliveryByEmail(campaignId, E1);
    await prisma.emailDelivery.update({ where: { id: d0.id }, data: { status: "PROCESSING", lockedAt: new Date(), lastAttemptAt: new Date(), lockToken: "live", attempts: 1 } });
    const tr = new FakeTransport();
    const r = await work(tr);
    expect(r.recovered).toBe(0);
    expect(tr.calls).toHaveLength(0);
    expect((await deliveryByEmail(campaignId, E1)).status).toBe("PROCESSING");
    expect((await prisma.campaign.findUniqueOrThrow({ where: { id: campaignId } })).status).toBe("RUNNING");
  });

  it("stuck PROCESSING whose last attempt is > 23h old → FAILED with errorKind UNKNOWN_OUTCOME, never resent", async () => {
    const { campaignId } = await setupCampaign({ leads: 1 });
    const d0 = await deliveryByEmail(campaignId, E1);
    const old = new Date(Date.now() - 24 * 3600_000);
    await prisma.emailDelivery.update({
      where: { id: d0.id },
      data: { status: "PROCESSING", lockedAt: old, lastAttemptAt: old, lockToken: "dead", attempts: 1, idempotencyKey: "mail-old" },
    });
    const tr = new FakeTransport();
    const r = await work(tr);
    expect(r.recovered).toBe(1);
    expect(tr.calls).toHaveLength(0);
    const d = await deliveryByEmail(campaignId, E1);
    expect(d.status).toBe("FAILED");
    expect(d.errorKind).toBe("UNKNOWN_OUTCOME");
    expect(d.lockToken).toBeNull();
  });

  it("fencing: a worker whose lock expired mid-send cannot overwrite the row after it was recovered and re-claimed", async () => {
    const { campaignId } = await setupCampaign({ leads: 1 });
    let release!: (r: SendResult) => void;
    const slow = new FakeTransport([() => new Promise<SendResult>((res) => (release = res))]);
    const pA = work(slow);

    // Worker A has claimed and is blocked inside transport.send().
    await waitFor(async () => slow.calls.length === 1);
    const claimed = await deliveryByEmail(campaignId, E1);
    expect(claimed.status).toBe("PROCESSING");
    const tokenA = claimed.lockToken;
    expect(tokenA).toBeTruthy();

    // A's lock goes stale; worker B recovers + re-claims + sends + finalizes.
    await prisma.emailDelivery.update({ where: { id: claimed.id }, data: { lockedAt: new Date(Date.now() - 11 * 60_000) } });
    const fast = new FakeTransport();
    const rB = await work(fast);
    expect(rB.recovered).toBe(1);
    expect(rB.sent).toBe(1);
    expect(fast.calls[0].idempotencyKey).toBe(slow.calls[0].idempotencyKey);
    expect(fast.calls[0]).toEqual(slow.calls[0]); // byte-identical payload for Resend dedupe
    const afterB = await deliveryByEmail(campaignId, E1);
    expect(afterB.status).toBe("SENT");
    const bMessageId = afterB.providerMessageId;

    // Now A's send "returns" — its stale finalize must be a no-op.
    release({ ok: true, id: "stale-worker-message-id" });
    const rA = await pA;
    expect(rA.sent).toBe(0);
    const final = await deliveryByEmail(campaignId, E1);
    expect(final.status).toBe("SENT");
    expect(final.providerMessageId).toBe(bMessageId);
    const lead = await prisma.lead.findUniqueOrThrow({ where: { email: E1 } });
    expect(lead.sendCount).toBe(1);
  });

  it("fencing: a stale worker's FAILURE does not overwrite a SENT row either", async () => {
    const { campaignId } = await setupCampaign({ leads: 1 });
    let release!: (r: SendResult) => void;
    const slow = new FakeTransport([() => new Promise<SendResult>((res) => (release = res))]);
    const pA = work(slow);
    await waitFor(async () => slow.calls.length === 1);
    const claimed = await deliveryByEmail(campaignId, E1);
    await prisma.emailDelivery.update({ where: { id: claimed.id }, data: { lockedAt: new Date(Date.now() - 11 * 60_000) } });
    await work(new FakeTransport());
    release({ ok: false, error: { code: "validation_error", message: "late failure", statusCode: 422 } });
    await pA;
    const final = await deliveryByEmail(campaignId, E1);
    expect(final.status).toBe("SENT");
    expect(final.errorMessage).toBeNull();
    expect((await prisma.lead.findUniqueOrThrow({ where: { email: E1 } })).status).toBe("SENT");
  });
});

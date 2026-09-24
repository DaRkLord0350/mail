import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/server/db";
import { dayKey, reserveQuota } from "@/lib/server/quota";
import { FakeTransport, deliveries, globalUsage, setupCampaign, updateSettings, work } from "./helpers";

const today = () => dayKey("Asia/Kolkata");

async function seedUsage(sent: number, limit = 100) {
  await prisma.dailyUsage.create({ data: { date: today(), scope: "global", emailsSent: sent, dailyLimit: limit } });
}

describe("daily quota (reserveQuota)", () => {
  it("0/100 → reserve succeeds and returns 1", async () => {
    expect(await reserveQuota(prisma, today(), "global", 100)).toBe(1);
  });

  it("99/100 → one more succeeds (100), the next returns null", async () => {
    await seedUsage(99);
    expect(await reserveQuota(prisma, today(), "global", 100)).toBe(100);
    expect(await reserveQuota(prisma, today(), "global", 100)).toBeNull();
    expect(await globalUsage()).toBe(100);
  });

  it("100/100 → null and the counter is unchanged", async () => {
    await seedUsage(100);
    expect(await reserveQuota(prisma, today(), "global", 100)).toBeNull();
    expect(await globalUsage()).toBe(100);
  });

  it("limit 0 → always null", async () => {
    expect(await reserveQuota(prisma, today(), "global", 0)).toBeNull();
  });

  it("50 concurrent reservations with limit 20 → exactly 20 succeed", async () => {
    const results = await Promise.all(Array.from({ length: 50 }, () => reserveQuota(prisma, today(), "global", 20)));
    const ok = results.filter((r) => r !== null);
    expect(ok).toHaveLength(20);
    expect(new Set(ok).size).toBe(20); // every success saw a distinct count 1..20
    expect(await globalUsage()).toBe(20);
  });
});

describe("daily quota enforced by the worker", () => {
  it("101 pending with limit 100 → sends exactly 100, 1 stays PENDING, stopReason quota_reached", { timeout: 900_000 }, async () => {
    await updateSettings({ dailyLimit: 100 });
    const { campaignId } = await setupCampaign({ leads: 101, dailyLimit: 100 });
    const tr = new FakeTransport();
    const r = await work(tr);
    expect(tr.calls).toHaveLength(100);
    expect(r.sent).toBe(100);
    expect(r.stopReason).toBe("quota_reached");
    const ds = await deliveries(campaignId);
    expect(ds.filter((d) => d.status === "SENT")).toHaveLength(100);
    expect(ds.filter((d) => d.status === "PENDING")).toHaveLength(1);
    expect(await globalUsage()).toBe(100);
    // A second pass the same day sends nothing more.
    const again = await work(tr);
    expect(again.sent).toBe(0);
    expect(again.stopReason).toBe("quota_reached");
    expect(tr.calls).toHaveLength(100);
    expect((await prisma.campaign.findUniqueOrThrow({ where: { id: campaignId } })).status).toBe("RUNNING");
  });

  it("per-campaign dailyLimit smaller than global is respected and does not starve other campaigns", async () => {
    await updateSettings({ dailyLimit: 10 });
    const a = await setupCampaign({ leads: 6, dailyLimit: 3, prefix: "a", name: "A" });
    const b = await setupCampaign({ leads: 5, dailyLimit: 100, prefix: "b", name: "B" });
    const tr = new FakeTransport();
    const r = await work(tr);
    expect(r.sent).toBe(8);
    const aSent = tr.recipients.filter((e) => e.startsWith("a"));
    const bSent = tr.recipients.filter((e) => e.startsWith("b"));
    expect(aSent).toHaveLength(3);
    expect(bSent).toHaveLength(5);
    const ad = await deliveries(a.campaignId);
    expect(ad.filter((d) => d.status === "PENDING")).toHaveLength(3);
    const campaignUsage = await prisma.dailyUsage.findUniqueOrThrow({ where: { date_scope: { date: today(), scope: a.campaignId } } });
    expect(campaignUsage.emailsSent).toBe(3);
    expect(await globalUsage()).toBe(8);
    expect((await deliveries(b.campaignId)).every((d) => d.status === "SENT")).toBe(true);
  });

  it("global limit caps the sum across campaigns", async () => {
    await updateSettings({ dailyLimit: 4 });
    await setupCampaign({ leads: 3, prefix: "a", name: "A" });
    await setupCampaign({ leads: 3, prefix: "b", name: "B" });
    const tr = new FakeTransport();
    const r = await work(tr);
    expect(tr.calls).toHaveLength(4);
    expect(r.stopReason).toBe("quota_reached");
    expect(await globalUsage()).toBe(4);
  });
});

describe("concurrent workers", () => {
  it("5 parallel workers, limit 10, 30 pending → exactly 10 sends, no delivery sent twice", async () => {
    await updateSettings({ dailyLimit: 10 });
    const { campaignId } = await setupCampaign({ leads: 30, dailyLimit: 100 });
    const tr = new FakeTransport();
    const results = await Promise.all(Array.from({ length: 5 }, () => work(tr)));
    expect(tr.calls).toHaveLength(10);
    expect(new Set(tr.recipients).size).toBe(10);
    expect(new Set(tr.calls.map((c) => c.idempotencyKey)).size).toBe(10);
    expect(results.reduce((a, r) => a + r.sent, 0)).toBe(10);
    expect(await globalUsage()).toBe(10);
    const ds = await deliveries(campaignId);
    expect(ds.filter((d) => d.status === "SENT")).toHaveLength(10);
    expect(ds.filter((d) => d.status === "PENDING")).toHaveLength(20);
    expect(ds.filter((d) => d.status === "PROCESSING")).toHaveLength(0);
    // Every SENT delivery was attempted exactly once.
    expect(ds.filter((d) => d.status === "SENT").every((d) => d.attempts === 1)).toBe(true);
  });

  it("parallel workers with plenty of quota send every delivery exactly once", async () => {
    await updateSettings({ dailyLimit: 100 });
    const { campaignId } = await setupCampaign({ leads: 12 });
    const tr = new FakeTransport();
    await Promise.all(Array.from({ length: 4 }, () => work(tr)));
    expect(tr.calls).toHaveLength(12);
    expect(new Set(tr.recipients).size).toBe(12);
    const ds = await deliveries(campaignId);
    expect(ds.every((d) => d.status === "SENT")).toBe(true);
    const leads = await prisma.lead.findMany();
    expect(leads.every((l) => l.sendCount === 1)).toBe(true);
    expect((await prisma.campaign.findUniqueOrThrow({ where: { id: campaignId } })).status).toBe("COMPLETED");
  });
});

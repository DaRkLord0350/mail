import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/server/db";
import { HttpError } from "@/lib/server/http";
import { startCampaign } from "@/lib/server/campaigns";
import { FakeTransport, deliveries, setupCampaign, work } from "./helpers";

async function expect409(p: Promise<unknown>) {
  const err = await p.then(
    () => null,
    (e) => e,
  );
  expect(err).toBeInstanceOf(HttpError);
  expect((err as HttpError).status).toBe(409);
}

describe("duplicate protection", () => {
  it("starting the same campaign twice (sequentially) → one delivery per lead, second call 409", async () => {
    const { campaignId, leads } = await setupCampaign({ leads: 4 });
    await expect409(startCampaign(campaignId));
    const ds = await deliveries(campaignId);
    expect(ds).toHaveLength(4);
    expect(new Set(ds.map((d) => d.leadId)).size).toBe(leads.length);
  });

  it("starting the same campaign twice concurrently → exactly one succeeds, the other 409, one delivery per lead", async () => {
    const { campaignId } = await setupCampaign({ leads: 5, start: false });
    const results = await Promise.allSettled([startCampaign(campaignId), startCampaign(campaignId), startCampaign(campaignId)]);
    const ok = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(2);
    for (const f of failed) {
      expect(f.reason).toBeInstanceOf(HttpError);
      expect((f.reason as HttpError).status).toBe(409);
    }
    expect(await deliveries(campaignId)).toHaveLength(5);
  });

  it("unique constraints reject a manual duplicate delivery (campaignId+leadId and campaignId+email)", async () => {
    const { campaignId, leads } = await setupCampaign({ leads: 2 });
    const base = { campaignId, renderedSubject: "s", renderedBody: "b", subjectTemplate: "s", bodyTemplate: "b" };
    // Same lead again.
    const e1 = await prisma.emailDelivery.create({ data: { ...base, leadId: leads[0].id, email: "other@example.com" } }).catch((e) => e);
    expect(e1).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    expect((e1 as Prisma.PrismaClientKnownRequestError).code).toBe("P2002");
    // Different lead id, same address (e.g. a re-imported lead).
    const extra = await prisma.lead.create({ data: { email: "someone-else@example.com" } });
    const e2 = await prisma.emailDelivery.create({ data: { ...base, leadId: extra.id, email: leads[1].email } }).catch((e) => e);
    expect(e2).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    expect((e2 as Prisma.PrismaClientKnownRequestError).code).toBe("P2002");
    expect(await deliveries(campaignId)).toHaveLength(2);
  });

  it("re-running the worker after everything is SENT sends nothing more ('page refresh')", async () => {
    const { campaignId } = await setupCampaign({ leads: 3 });
    const tr = new FakeTransport();
    const first = await work(tr);
    expect(first.sent).toBe(3);
    for (let i = 0; i < 3; i++) {
      const r = await work(tr);
      expect(r.sent).toBe(0);
      expect(r.processed).toBe(0);
    }
    expect(tr.calls).toHaveLength(3);
    const leads = await prisma.lead.findMany();
    expect(leads.every((l) => l.sendCount === 1 && l.status === "SENT")).toBe(true);
    expect((await prisma.campaign.findUniqueOrThrow({ where: { id: campaignId } })).status).toBe("COMPLETED");
  });

  it("a completed campaign cannot be started again", async () => {
    const { campaignId } = await setupCampaign({ leads: 1 });
    await work(new FakeTransport());
    await expect409(startCampaign(campaignId));
  });
});

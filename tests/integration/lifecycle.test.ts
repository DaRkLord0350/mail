import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/server/db";
import { HttpError } from "@/lib/server/http";
import { pauseCampaign, resumeCampaign, startCampaign, stopCampaign } from "@/lib/server/campaigns";
import { FakeTransport, deliveries, setupCampaign, work } from "./helpers";

async function status(id: string) {
  return (await prisma.campaign.findUniqueOrThrow({ where: { id } })).status;
}

function tomorrowIst(): string {
  const d = new Date(Date.now() + 2 * 24 * 3600_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

describe("campaign lifecycle", () => {
  it("pause → worker sends nothing; resume continues from the pending queue without re-sending", async () => {
    const { campaignId } = await setupCampaign({ leads: 6 });
    const tr = new FakeTransport();
    const r1 = await work(tr, { batchSize: 2 });
    expect(r1.sent).toBe(2);
    expect(tr.recipients).toEqual(["lead0001@example.com", "lead0002@example.com"]);

    await pauseCampaign(campaignId);
    expect(await status(campaignId)).toBe("PAUSED");
    const r2 = await work(tr);
    expect(r2.processed).toBe(0);
    expect(tr.calls).toHaveLength(2);

    await resumeCampaign(campaignId);
    expect(await status(campaignId)).toBe("RUNNING");
    const r3 = await work(tr);
    expect(r3.sent).toBe(4);
    // Continues with lead #3 — never back to lead #1.
    expect(tr.recipients).toEqual(["lead0001", "lead0002", "lead0003", "lead0004", "lead0005", "lead0006"].map((e) => `${e}@example.com`));
    expect(new Set(tr.recipients).size).toBe(6);
    expect(await status(campaignId)).toBe("COMPLETED");
    const c = await prisma.campaign.findUniqueOrThrow({ where: { id: campaignId } });
    expect(c.completedAt).not.toBeNull();
  });

  it("stop → remaining PENDING become SKIPPED, campaign STOPPED, nothing more is sent, cannot be restarted (409)", async () => {
    const { campaignId } = await setupCampaign({ leads: 5 });
    const tr = new FakeTransport();
    await work(tr, { batchSize: 2 });
    await stopCampaign(campaignId);
    expect(await status(campaignId)).toBe("STOPPED");
    const ds = await deliveries(campaignId);
    expect(ds.filter((d) => d.status === "SENT")).toHaveLength(2);
    const skipped = ds.filter((d) => d.status === "SKIPPED");
    expect(skipped).toHaveLength(3);
    expect(skipped.every((d) => d.errorCode === "campaign_stopped")).toBe(true);
    expect(skipped.every((d) => d.lead.status === "SKIPPED")).toBe(true);

    await work(tr);
    expect(tr.calls).toHaveLength(2);

    const err = await startCampaign(campaignId).catch((e) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(409);
    const err2 = await resumeCampaign(campaignId).catch((e) => e);
    expect((err2 as HttpError).status).toBe(409);
  });

  it("scheduled start → SCHEDULED and not sent early; once scheduledAt passes the worker promotes to RUNNING and sends", async () => {
    const { campaignId } = await setupCampaign({ leads: 2, schedule: { date: tomorrowIst(), time: "09:00", timezone: "Asia/Kolkata" } });
    expect(await status(campaignId)).toBe("SCHEDULED");
    const tr = new FakeTransport();
    const r1 = await work(tr);
    expect(r1.processed).toBe(0);
    expect(r1.promotedCampaigns).toBe(0);
    expect(tr.calls).toHaveLength(0);

    await prisma.campaign.update({ where: { id: campaignId }, data: { scheduledAt: new Date(Date.now() - 60_000) } });
    const r2 = await work(tr);
    expect(r2.promotedCampaigns).toBe(1);
    expect(r2.sent).toBe(2);
    const c = await prisma.campaign.findUniqueOrThrow({ where: { id: campaignId } });
    expect(c.startedAt).not.toBeNull();
    expect(c.status).toBe("COMPLETED");
  });

  it("a schedule in the past is rejected", async () => {
    const { campaignId } = await setupCampaign({ leads: 1, start: false });
    const err = await startCampaign(campaignId, { date: "2020-01-01", time: "09:00", timezone: "Asia/Kolkata" }).catch((e) => e);
    expect((err as HttpError).status).toBe(400);
    expect(await status(campaignId)).toBe("READY");
  });

  it("completion → COMPLETED only when nothing is pending or processing", async () => {
    const { campaignId } = await setupCampaign({ leads: 3 });
    const tr = new FakeTransport();
    await work(tr, { batchSize: 2 });
    expect(await status(campaignId)).toBe("RUNNING");
    await work(tr);
    expect(await status(campaignId)).toBe("COMPLETED");
  });

  it("template edits are rejected (409) once the campaign is running; stored rendered content never changes", async () => {
    const { updateCampaign } = await import("@/lib/server/campaigns");
    const { campaignId } = await setupCampaign({ leads: 2, subject: "Original {{first_name}}" });
    const before = await deliveries(campaignId);
    const err = await updateCampaign(campaignId, { subjectTemplate: "Changed {{first_name}}" }).catch((e) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(409);
    // Renaming is still allowed.
    await updateCampaign(campaignId, { name: "Renamed" });
    const tr = new FakeTransport();
    await work(tr);
    expect(tr.calls.map((c) => c.subject)).toEqual(before.map((d) => d.renderedSubject));
    expect(tr.calls[0].subject).toBe("Original First1");
  });
});

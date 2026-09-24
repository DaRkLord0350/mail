import type { Metadata } from "next";
import { CampaignWorkspace } from "@/components/campaigns/campaign-workspace";

export const metadata: Metadata = { title: "Campaign" };

export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CampaignWorkspace campaignId={id} />;
}

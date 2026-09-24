import type { Metadata } from "next";
import { NewCampaignForm } from "@/components/campaigns/new-campaign-form";

export const metadata: Metadata = { title: "New campaign" };

export default function NewCampaignPage() {
  return <NewCampaignForm />;
}
